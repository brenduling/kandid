-- READ ONLY. Run against the positively identified KANDID local database only.
-- Privilege functions report effective grants, including PUBLIC and inherited
-- role grants. The new anchor function is expected to be absent before migration.

select
  role_name,
  table_name,
  has_table_privilege(role_name, table_name, 'SELECT') as can_select,
  has_table_privilege(role_name, table_name, 'INSERT') as can_insert,
  has_table_privilege(role_name, table_name, 'UPDATE') as can_update,
  has_table_privilege(role_name, table_name, 'DELETE') as can_delete,
  has_table_privilege(role_name, table_name, 'TRUNCATE') as can_truncate,
  has_table_privilege(role_name, table_name, 'TRIGGER') as can_trigger,
  has_table_privilege(role_name, table_name, 'REFERENCES') as can_reference
from (values ('anon'), ('authenticated'), ('service_role')) roles(role_name)
cross join (values ('public.votes'::regclass), ('public.vote_ballots'::regclass)) tables(table_name)
order by table_name::text, role_name;

select
  role_name,
  has_sequence_privilege(role_name, 'public.votes_id_seq', 'USAGE') as can_use,
  has_sequence_privilege(role_name, 'public.votes_id_seq', 'SELECT') as can_select,
  has_sequence_privilege(role_name, 'public.votes_id_seq', 'UPDATE') as can_update
from (values ('anon'), ('authenticated'), ('service_role')) roles(role_name)
order by role_name;

-- postgres is the expected SECURITY DEFINER owner for trusted submission. It
-- must retain nextval rights after browser/service-role sequence revocation.
select
  has_sequence_privilege('postgres', 'public.votes_id_seq', 'USAGE') as postgres_can_use,
  has_sequence_privilege('postgres', 'public.votes_id_seq', 'UPDATE') as postgres_can_advance;

-- Enumerate reachable role memberships. The privilege results above remain the
-- authoritative effective-access check because they include PUBLIC ACLs too.
with requested_roles as (
  select role_name, role_name::regrole::oid as role_oid
  from (values ('anon'), ('authenticated'), ('service_role')) roles(role_name)
)
select
  requested.role_name as requesting_role,
  granted.rolname as reachable_role,
  pg_has_role(requested.role_oid, granted.oid, 'USAGE') as inherits_privileges_without_set_role,
  pg_has_role(requested.role_oid, granted.oid, 'MEMBER') as can_set_role
from requested_roles requested
join pg_roles granted on granted.oid <> requested.role_oid
where pg_has_role(requested.role_oid, granted.oid, 'MEMBER')
order by requesting_role, reachable_role;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename in ('votes', 'vote_ballots')
order by tablename, policyname;

-- Resolve signatures non-throwingly and inspect owner, SECURITY DEFINER flag,
-- pinned settings, and effective EXECUTE rights. No function is invoked.
with signatures(signature, expected_executor, expected_pre_migration_absence) as (
  values
    ('public.insert_v2_vote_rows(integer,integer,jsonb)', 'service_role', false),
    ('public.claim_next_vote_anchor()', 'service_role', false),
    ('public.claim_next_ballot_anchor()', 'service_role', false),
    ('public.mark_vote_anchor_success(integer,text,text,text,text,bigint)', 'service_role', false),
    ('public.mark_vote_anchor_failure(integer,text,text)', 'service_role', false),
    ('public.mark_vote_anchor_manual_review(integer,text,text)', 'service_role', false),
    ('public.acquire_ballot_anchor_signer_lease(text,integer)', 'service_role', false),
    ('public.release_ballot_anchor_signer_lease(text)', 'service_role', false),
    ('public.claim_next_submitted_ballot_anchor()', 'service_role', false),
    ('public.mark_ballot_anchor_submitted(uuid,text,text,text,text)', 'service_role', false),
    ('public.mark_ballot_anchor_success(uuid,text,text,bigint,timestamp with time zone)', 'service_role', false),
    ('public.mark_ballot_anchor_failure(uuid,text,text,boolean)', 'service_role', false),
    ('public.mark_ballot_manual_review(uuid,text,text)', 'service_role', false),
    ('public.kandid_record_verified_legacy_vote_anchor(integer,text,text,text,bigint,timestamp with time zone)', 'service_role', true),
    ('public.kandid_get_board_electorate_preview(integer)', 'authenticated', false),
    ('public.kandid_lock_board_electorate(integer)', 'authenticated', false),
    ('public.kandid_is_locked_electorate_member(integer,integer)', 'service_role', false),
    ('public.kandid_get_election_turnout(integer)', 'authenticated', false),
    ('public.kandid_get_board_election_report_package(integer)', 'authenticated', false),
    ('private.kandid_election_turnout_summary(integer)', 'none', false)
), resolved as (
  select signature, expected_executor, expected_pre_migration_absence, to_regprocedure(signature) as procedure_oid
  from signatures
)
select
  signature,
  procedure_oid is not null as function_exists,
  case
    when procedure_oid is not null then 'PRESENT'
    when expected_pre_migration_absence then 'INFO: expected absent until migration'
    else 'MISSING: trusted prerequisite'
  end as status,
  expected_executor,
  case when procedure_oid is not null then pg_get_userbyid(definition.proowner) end as function_owner,
  case when procedure_oid is not null then definition.prosecdef end as is_security_definer,
  case when procedure_oid is not null then definition.proconfig end as function_settings,
  case when procedure_oid is not null then definition.proacl end as function_acl,
  case when procedure_oid is not null then has_function_privilege('anon', procedure_oid, 'EXECUTE') end as anon_can_execute,
  case when procedure_oid is not null then has_function_privilege('authenticated', procedure_oid, 'EXECUTE') end as authenticated_can_execute,
  case when procedure_oid is not null then has_function_privilege('service_role', procedure_oid, 'EXECUTE') end as service_role_can_execute,
  case
    when procedure_oid is null then null
    when expected_executor = 'service_role' then has_function_privilege('service_role', procedure_oid, 'EXECUTE')
      and not has_function_privilege('anon', procedure_oid, 'EXECUTE')
      and not has_function_privilege('authenticated', procedure_oid, 'EXECUTE')
    when expected_executor = 'authenticated' then has_function_privilege('authenticated', procedure_oid, 'EXECUTE')
      and not has_function_privilege('anon', procedure_oid, 'EXECUTE')
      and not has_function_privilege('service_role', procedure_oid, 'EXECUTE')
    when expected_executor = 'none' then not has_function_privilege('anon', procedure_oid, 'EXECUTE')
      and not has_function_privilege('authenticated', procedure_oid, 'EXECUTE')
      and not has_function_privilege('service_role', procedure_oid, 'EXECUTE')
  end as expected_execution_contract_holds
from resolved
left join pg_proc definition on definition.oid = resolved.procedure_oid
order by signature;
