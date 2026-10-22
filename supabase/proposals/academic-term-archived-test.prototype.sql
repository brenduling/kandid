-- ISOLATED DESIGN PROTOTYPE, NOT A PRODUCTION MIGRATION.
-- Does not classify a term or create a draft by itself. Production is refused.
begin;
set local lock_timeout='2s';
set local statement_timeout='20s';
do $guard$
declare actual_dependencies oid[]; reviewed_dependencies oid[];
begin
  if current_database() !~ '^kandid_term_archive_[a-f0-9]{12}$' or current_user <> 'postgres' then
    raise exception 'LOCAL_PROTOTYPE_ONLY: reviewed disposable fixture required';
  end if;
  if (select pg_get_constraintdef(oid) from pg_constraint
      where conrelid='public.academic_terms'::regclass and conname='academic_terms_unique_term')
      is distinct from 'UNIQUE (academic_year, semester)' then
    raise exception 'Year/semester uniqueness baseline differs';
  end if;
  if exists(select 1 from pg_constraint where contype='f'
      and confrelid='public.academic_terms'::regclass and confkey <> array[1]::smallint[]) then
    raise exception 'A term FK does not target the reviewed ID key';
  end if;
  with recursive dependencies(oid) as (
    select 'public.academic_terms'::regclass::oid
    union select c.conrelid from pg_constraint c join dependencies d on c.confrelid=d.oid where c.contype='f'
  ) select array_agg(oid order by oid) into actual_dependencies from dependencies;
  select array_agg(name::regclass::oid order by name::regclass::oid) into reviewed_dependencies from unnest(array[
    'public.academic_terms','public.elections','public.positions','public.partylists','public.candidates',
    'public.candidate_media','public.vote_ballots','public.votes','private.election_eligible_voters',
    'private.ballot_anchor_exclusions','public.election_access_tokens','public.eligibility_rules',
    'public.masterlist_imports','public.masterlist_import_rows','public.student_term_enrollments',
    'public.student_organization_terms','public.officers','public.officer_new_roster',
    'public.officer_leadership_releases','public.election_campaign_snapshots',
    'public.election_officer_publications','public.election_officer_publication_entries','public.archived_elections'
  ]) name;
  if actual_dependencies is distinct from reviewed_dependencies then
    raise exception 'Unreviewed academic-term dependency; reassess archive guards';
  end if;
  if (select count(*) from pg_trigger where tgname like 'kandid_preserve_%' and tgenabled='O')<>4 then
    raise exception 'Existing ballot preservation guards differ';
  end if;
end;
$guard$;

-- Archive provenance stays in the existing authorized audit registry. Only the
-- non-sensitive classification is added to the existing publicly readable term.
alter table public.academic_terms add column term_classification text not null default 'official';
alter table public.academic_terms add constraint academic_terms_classification_check
  check(term_classification in ('official','archived_test'));
alter table public.academic_terms add constraint academic_terms_archived_test_closed_check
  check(term_classification <> 'archived_test' or
    (status='closed' and activated_at is not null and closed_at is not null));
alter table public.academic_terms drop constraint academic_terms_unique_term;
create unique index academic_terms_unique_official_term
  on public.academic_terms(academic_year,semester) where term_classification='official';
-- academic_terms_one_active_idx / the fixture's equivalent is NOT changed.

create function private.kandid_archived_test_term_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog as $function$
begin
  if tg_op='INSERT' then
    if new.term_classification <> 'official' then
      raise exception using errcode='42501',message='Archived test terms require a reviewed existing term';
    end if;
    return new;
  end if;
  if old.term_classification='archived_test' then
    raise exception using errcode='42501',message='Archived test term identity and lifecycle are immutable';
  end if;
  if tg_op='DELETE' then return old; end if;
  if new.term_classification='archived_test' then
    if old.id<>2 or old.status<>'closed'
       or (to_jsonb(new)-'term_classification') is distinct from (to_jsonb(old)-'term_classification')
       or not exists(select 1 from public.audit_logs a join public.admin_users u on u.id=a.user_id
         where a.entity_type='academic_term' and a.entity_id=old.id::text
           and a.event_type='academic_term_test_archived'
           and a.metadata->>'transaction_id'=txid_current()::text
           and a.metadata->>'expected_term_md5'=md5(to_jsonb(old)::text)
           and u.role='super_admin' and u.status='active') then
      raise exception using errcode='42501',message='Exact reviewed term-2 archive audit required';
    end if;
  end if;
  return new;
end;
$function$;
revoke all on function private.kandid_archived_test_term_guard() from public,anon,authenticated,service_role;
create trigger academic_terms_archived_test_guard before insert or update or delete
  on public.academic_terms for each row execute function private.kandid_archived_test_term_guard();

-- Fixed-ID operator-only prototype. There is no browser/Edge archive endpoint.
create function private.kandid_archive_test_term_2_prototype(
  p_actor_auth_user_id uuid,p_expected_active jsonb,p_expected_target jsonb,p_reason text
)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $function$
declare actor bigint; target public.academic_terms%rowtype;
begin
  perform private.kandid_lock_term_transition_inputs();
  actor:=private.kandid_term_transition_actor(p_actor_auth_user_id);
  if (select count(*) from public.academic_terms where status='active')<>1
    or (select to_jsonb(t) from public.academic_terms t where id=1 and status='active') is distinct from p_expected_active then
    raise exception using errcode='55000',message='Exact active term 1 snapshot required';
  end if;
  select * into target from public.academic_terms where id=2 for update;
  if not found or target.status<>'closed' or target.term_classification<>'official'
     or target.academic_year<>'2026-2027' or target.semester<>'2nd Semester'
     or to_jsonb(target) is distinct from p_expected_target or length(btrim(coalesce(p_reason,'')))<20 then
    raise exception using errcode='55000',message='Exact closed term 2 and explicit test provenance required';
  end if;
  insert into public.audit_logs(user_id,actor_name,actor_role,action,event_type,event_category,
    entity_type,entity_id,entity_label,status,event_origin,metadata)
    select actor,u.full_name,'super_admin','Academic test term archived','academic_term_test_archived','system',
      'academic_term','2','2nd Semester AY 2026-2027','completed','trusted_database',
      jsonb_build_object('reason',p_reason,'transaction_id',txid_current()::text,
        'expected_term_md5',md5(to_jsonb(target)::text),'before',to_jsonb(target),
        'classification_after','archived_test','active_term_id',1)
    from public.admin_users u where u.id=actor;
  update public.academic_terms set term_classification='archived_test' where id=2;
  return (select to_jsonb(t) from public.academic_terms t where id=2);
end;
$function$;
revoke all on function private.kandid_archive_test_term_2_prototype(uuid,jsonb,jsonb,text)
  from public,anon,authenticated,service_role;

-- Existing term/election FKs remain authoritative. Resolve only ancestors of
-- the changed row; shared student/organization identity is never an archive key.
create function private.kandid_history_row_term_ids(p_row jsonb)
returns integer[] language sql stable security definer set search_path=pg_catalog as $function$
  with officer as (
    select o.* from public.officers o where o.id=(p_row->>'source_officer_id')::integer
  ), candidates as (
    select c.* from public.candidates c where c.id=(p_row->>'candidate_id')::integer
      or c.id in(select candidate_id from officer)
  ), positions as (
    select p.* from public.positions p where p.id=(p_row->>'position_id')::integer
      or p.id in(select position_id from candidates) or p.id in(select position_id from officer)
  ), election_ids as (
    select (p_row->>'election_id')::integer id
    union select election_id from positions
    union select election_id from officer
    union select election_id from public.vote_ballots where id=(p_row->>'ballot_id')::uuid
    union select election_id from public.election_officer_publications where id=(p_row->>'publication_id')::uuid
    union select election_id from public.election_campaign_snapshots where id=(p_row->>'campaign_snapshot_id')::uuid
  ), term_ids as (
    select (p_row->>'academic_term_id')::integer id
    union select academic_term_id from public.elections where id in(select id from election_ids)
    union select academic_term_id from public.masterlist_imports where id=(p_row->>'import_id')::integer
    union select academic_term_id from officer
  ) select coalesce(array_agg(distinct id order by id),'{}'::integer[]) from term_ids where id is not null;
$function$;
revoke all on function private.kandid_history_row_term_ids(jsonb) from public,anon,authenticated,service_role;

create function private.kandid_archived_test_history_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog as $function$
declare term_ids integer[]:='{}';
begin
  if tg_op<>'INSERT' then term_ids:=private.kandid_history_row_term_ids(to_jsonb(old)); end if;
  if tg_op<>'DELETE' then term_ids:=term_ids||private.kandid_history_row_term_ids(to_jsonb(new)); end if;
  perform id from public.academic_terms where id=any(term_ids) order by id for share;
  if exists(select 1 from public.academic_terms where id=any(term_ids) and term_classification='archived_test') then
    raise exception using errcode='42501',message='Archived test history is read-only; no new participation or reassignment';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$function$;
revoke all on function private.kandid_archived_test_history_guard() from public,anon,authenticated,service_role;

-- The 22 captured term-dependent relations. Audit events remain appendable;
-- existing FK, RLS, ballot/exclusion immutability and grants remain untouched.
do $triggers$
declare relation_name text;
begin
  foreach relation_name in array array[
    'public.elections','public.positions','public.partylists','public.candidates',
    'public.candidate_media','public.vote_ballots','public.votes','private.election_eligible_voters',
    'private.ballot_anchor_exclusions','public.election_access_tokens','public.eligibility_rules',
    'public.masterlist_imports','public.masterlist_import_rows','public.student_term_enrollments',
    'public.student_organization_terms','public.officers','public.officer_new_roster',
    'public.officer_leadership_releases','public.election_campaign_snapshots',
    'public.election_officer_publications','public.election_officer_publication_entries','public.archived_elections'
  ] loop
    execute format('create trigger aaa_archived_test_history_guard before insert or update or delete on %s for each row execute function private.kandid_archived_test_history_guard()',relation_name::regclass);
  end loop;
end;
$triggers$;
commit;
