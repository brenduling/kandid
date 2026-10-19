[CmdletBinding()]
param(
    [switch] $ReviewOnly,
    [switch] $Execute
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$expectedContainer = 'supabase_db_kandid-security-fullstack-20261013-c8e4'
$expectedProject = 'kandid-security-fullstack-20261013-c8e4'
$migrationRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'supabase\migrations'
$migrationPaths = @(
    (Join-Path $migrationRoot '20261021100000_candidate_eligibility_uses_election_term.sql'),
    (Join-Path $migrationRoot '20261021110000_publication_and_board_privacy_contract.sql')
)

function Get-ReviewedMigrationBody {
    param([Parameter(Mandatory = $true)][string] $Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw 'MIGRATION_FILE_MISSING'
    }

    $text = [IO.File]::ReadAllText($Path)
    if ($text -match '(?m)^\s*\\') {
        throw 'PSQL_META_COMMAND_PRESENT'
    }

    $lines = $text -split "`r?`n"
    while ($lines.Count -gt 0 -and [string]::IsNullOrWhiteSpace($lines[-1])) {
        if ($lines.Count -eq 1) { $lines = @(); break }
        $lines = $lines[0..($lines.Count - 2)]
    }
    if ($lines.Count -lt 3 -or $lines[0].Trim() -notmatch '^begin\s*;\s*$' -or $lines[-1].Trim() -notmatch '^commit\s*;\s*$') {
        throw 'TRANSACTION_BOUNDARIES_NOT_EXACTLY_RECOGNIZED'
    }

    $body = ($lines[1..($lines.Count - 2)] -join "`n")
    if ($body -match '(?im)^\s*(commit|rollback)\s*;\s*$') {
        throw 'NESTED_OR_EARLY_TRANSACTION_CONTROL'
    }
    if ($body -match '(?im)^\s*(create|drop)\s+extension\b|^\s*alter\s+system\b|^\s*(create|drop)\s+database\b|\bdblink\s*\(|\bpg_read_file\s*\(|\bpg_write_file\s*\(|\bcopy\b[^;]*\bprogram\b') {
        throw 'IRREVERSIBLE_OR_EXTERNAL_OPERATION_FOUND'
    }

    $doMatches = [regex]::Matches($body, '(?is)\bdo\s+\$(?<tag>[A-Za-z_][A-Za-z0-9_]*)\$(?<block>.*?)\$\k<tag>\$\s*;')
    foreach ($match in $doMatches) {
        if ($match.Groups['block'].Value.Trim() -notmatch '(?is)\bend\s*;\s*$') {
            throw ('PLPGSQL_DO_BLOCK_MISSING_END_SEMICOLON:' + $Path)
        }
    }
    if ([regex]::Matches($body, '(?im)^\s*do\s+\$').Count -ne $doMatches.Count) {
        throw ('DO_BLOCK_PARSE_FAILED:' + $Path)
    }

    return $body
}

function Get-CatalogSnapshotSql {
@'
create temp table kandid_migration_catalog_baseline as
select 'functions'::text as kind, md5(coalesce(string_agg(
  p.oid::text || '|' || p.proowner::text || '|' || p.prosecdef::text || '|' || coalesce(p.proconfig::text,'') || '|' ||
  pg_catalog.pg_get_functiondef(p.oid) || '|' || coalesce(p.proacl::text,''), E'\n' order by p.oid),'')) as digest
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private')
union all
select 'policies', md5(coalesce(string_agg(
  schemaname || '|' || tablename || '|' || policyname || '|' || roles::text || '|' || cmd || '|' || coalesce(qual,'') || '|' || coalesce(with_check,''), E'\n'
  order by schemaname,tablename,policyname),''))
from pg_catalog.pg_policies where schemaname in ('public','private')
union all
select 'relations', md5(coalesce(string_agg(
  c.oid::text || '|' || c.relrowsecurity::text || '|' || c.relforcerowsecurity::text || '|' || coalesce(c.relacl::text,''), E'\n' order by c.oid),''))
from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','private')
union all
select 'columns', md5(coalesce(string_agg(
  a.attrelid::text || '|' || a.attnum::text || '|' || a.attname || '|' || coalesce(a.attacl::text,''), E'\n' order by a.attrelid,a.attnum),''))
from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid=a.attrelid
join pg_catalog.pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','private') and a.attnum>0 and not a.attisdropped
union all
select 'schemas', md5(coalesce(string_agg(n.oid::text || '|' || n.nspname || '|' || coalesce(n.nspacl::text,''), E'\n' order by n.oid),''))
from pg_catalog.pg_namespace n where n.nspname in ('public','private')
union all
select 'triggers', md5(coalesce(string_agg(t.oid::text || '|' || t.tgrelid::text || '|' || t.tgfoid::text || '|' || t.tgtype::text || '|' || t.tgenabled::text || '|' || t.tgargs::text, E'\n' order by t.oid),''))
from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid
join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private')
union all
select 'event_triggers', md5(coalesce(string_agg(e.oid::text || '|' || e.evtname || '|' || e.evtevent || '|' || e.evtowner::text || '|' ||
  e.evtenabled::text || '|' || coalesce(e.evttags::text,'') || '|' || e.evtfoid::text, E'\n' order by e.oid),''))
from pg_catalog.pg_event_trigger e
union all
select 'candidate_duplicate_checker_role', md5(
  coalesce((select string_agg(r.rolname || '|' || r.rolcanlogin::text || '|' || r.rolsuper::text || '|' ||
    r.rolcreatedb::text || '|' || r.rolcreaterole::text || '|' || r.rolinherit::text || '|' ||
    r.rolreplication::text || '|' || r.rolbypassrls::text, E'\n' order by r.rolname)
    from pg_catalog.pg_roles r where r.rolname='kandid_candidate_duplicate_checker'), '') || '|' ||
  coalesce((select string_agg(m.roleid::text || '|' || m.member::text || '|' || m.grantor::text || '|' ||
      m.admin_option::text || '|' || m.inherit_option::text || '|' || m.set_option::text, E'\n'
    order by m.roleid,m.member,m.grantor) from pg_catalog.pg_auth_members m
    where m.roleid=(select oid from pg_catalog.pg_roles where rolname='kandid_candidate_duplicate_checker')
       or m.member=(select oid from pg_catalog.pg_roles where rolname='kandid_candidate_duplicate_checker')), ''));
'@
}

function Get-DataSnapshotSql {
    param([Parameter(Mandatory = $true)][string] $TableName)
@"
create temp table $TableName as
select 'public.admin_users'::text as relation_name, count(*)::bigint as row_count,
  md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' order by to_jsonb(t)::text),'')) as digest from public.admin_users t
union all
select 'public.students', count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' order by to_jsonb(t)::text),'')) from public.students t
union all
select 'public.organizations', count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' order by to_jsonb(t)::text),'')) from public.organizations t
union all
select 'public.academic_terms', count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' order by to_jsonb(t)::text),'')) from public.academic_terms t
union all
select 'public.elections', count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' order by to_jsonb(t)::text),'')) from public.elections t
union all
select 'public.positions', count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' order by to_jsonb(t)::text),'')) from public.positions t
union all
select 'public.candidates', count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' order by to_jsonb(t)::text),'')) from public.candidates t
union all
select 'public.partylists', count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' order by to_jsonb(t)::text),'')) from public.partylists t
union all
select 'public.votes', count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' order by to_jsonb(t)::text),'')) from public.votes t
union all
select 'public.vote_ballots', count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' order by to_jsonb(t)::text),'')) from public.vote_ballots t
union all
select 'public.audit_logs', count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' order by to_jsonb(t)::text),'')) from public.audit_logs t
union all
select 'auth.users', count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' order by to_jsonb(t)::text),'')) from auth.users t
union all
select 'auth.identities', count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' order by to_jsonb(t)::text),'')) from auth.identities t
union all
select 'sequences', count(*)::bigint,
  md5(coalesce(string_agg(schemaname || '.' || sequencename || '|' || coalesce(last_value::text,'NULL'), E'\n' order by schemaname,sequencename),''))
from pg_catalog.pg_sequences where schemaname in ('public','auth');
"@
}

function Get-ActorAuthorizationSql {
@'
-- Suppress only row-audit writes for the test tables. DDL is transactional and
-- the catalog snapshot proves these triggers are restored by the final rollback.
do $actor_trigger_preflight$
declare unexpected_count integer;
begin
  -- Serialize runs. Explicit random IDs prevent non-transactional identity
  -- sequences from advancing when the transaction rolls back.
  perform pg_catalog.pg_advisory_xact_lock(1948156251, 21110000);
  if (select count(*) from pg_catalog.pg_trigger t where t.tgrelid='public.elections'::regclass and not t.tgisinternal
      and t.tgname in ('audit_elections_mutations','audit_elections_mutations_update')) <> 2
     or (select count(*) from pg_catalog.pg_trigger t where t.tgrelid='public.positions'::regclass and not t.tgisinternal
      and t.tgname='audit_positions_mutations') <> 1
     or (select count(*) from pg_catalog.pg_trigger t where t.tgrelid='public.candidates'::regclass and not t.tgisinternal
      and t.tgname='audit_candidates_mutations') <> 1 then
    raise exception 'ACTOR_SETUP_EXPECTED_AUDIT_TRIGGERS_MISSING';
  end if;
  select count(*) into unexpected_count
  from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in ('elections','positions','candidates')
    and not t.tgisinternal
    and not ((c.relname='elections' and t.tgname in ('audit_elections_mutations','audit_elections_mutations_update',
          'elections_assign_academic_term','elections_guard_frozen_electorate','elections_guard_result_release_fields','trg_sync_election_fields'))
      or (c.relname='positions' and t.tgname in ('audit_positions_mutations','positions_prevent_election_change'))
      or (c.relname='candidates' and t.tgname in ('audit_candidates_mutations','candidates_one_student_per_election_guard','candidates_trusted_mutation_guard')));
  if unexpected_count<>0 then raise exception 'ACTOR_SETUP_UNREVIEWED_APPLICATION_TRIGGER_PRESENT'; end if;
  if exists (
    select 1 from (values
      ('public.elections','audit_elections_mutations','public','kandid_audit_admin_row_change'),
      ('public.elections','audit_elections_mutations_update','public','kandid_audit_admin_row_change'),
      ('public.positions','audit_positions_mutations','public','kandid_audit_admin_row_change'),
      ('public.candidates','audit_candidates_mutations','public','kandid_audit_admin_row_change'),
      ('public.elections','elections_assign_academic_term','private','kandid_assign_election_academic_term'),
      ('public.elections','elections_guard_frozen_electorate','private','kandid_guard_frozen_electorate'),
      ('public.elections','elections_guard_result_release_fields','public','kandid_guard_result_release_fields'),
      ('public.elections','trg_sync_election_fields','public','sync_election_fields'),
      ('public.positions','positions_prevent_election_change','public','prevent_position_election_change'),
      ('public.candidates','candidates_one_student_per_election_guard','public','prevent_duplicate_candidate_per_election'),
      ('public.candidates','candidates_trusted_mutation_guard','public','kandid_guard_candidate_mutation')
    ) expected(relation_name,trigger_name,function_schema,function_name)
    left join pg_catalog.pg_trigger t
      on t.tgrelid=expected.relation_name::regclass and t.tgname=expected.trigger_name and not t.tgisinternal
    left join pg_catalog.pg_proc p on p.oid=t.tgfoid
    left join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where t.oid is null or n.nspname is distinct from expected.function_schema or p.proname is distinct from expected.function_name
  ) then raise exception 'ACTOR_SETUP_TRIGGER_FUNCTION_IDENTITY_MISMATCH'; end if;
end;
$actor_trigger_preflight$;
alter table public.elections disable trigger audit_elections_mutations;
alter table public.elections disable trigger audit_elections_mutations_update;
alter table public.positions disable trigger audit_positions_mutations;
alter table public.candidates disable trigger audit_candidates_mutations;

do $actor_fixture_setup$
declare
  board_a_uid uuid; board_a_org integer; board_b_org integer;
  super_uid uuid; student_uid uuid; student_id_value integer; term_id_value integer;
  board_b_uid uuid := extensions.gen_random_uuid();
  inactive_uid uuid := extensions.gen_random_uuid();
  e_a integer; e_a_archived_private integer; e_a_pre integer; e_a_draft integer; e_b integer;
  p_hidden integer; p_managed integer; c_hidden integer;
  attempt_id integer; inactive_admin_id integer; board_assignment_count integer; super_assignment_count integer;
begin
  if exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid='auth.users'::regclass and not t.tgisinternal) then
    raise exception 'ACTOR_SETUP_AUTH_TRIGGER_REQUIRES_REVIEW';
  end if;
  if exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid='public.admin_users'::regclass and not t.tgisinternal) then
    raise exception 'ACTOR_SETUP_ADMIN_TRIGGER_REQUIRES_REVIEW';
  end if;
  select a.auth_user_id, a.organization_id into board_a_uid, board_a_org
    from public.admin_users a where a.role='electoral_board' and a.status='active'
      and a.auth_user_id is not null and a.organization_id is not null order by a.id limit 1;
  select o.id into board_b_org from public.organizations o where o.id<>board_a_org order by o.id limit 1;
  select a.auth_user_id into super_uid from public.admin_users a
    where a.role='super_admin' and a.status='active' and a.auth_user_id is not null order by a.id limit 1;
  select count(*) into board_assignment_count from public.admin_users a
    where a.auth_user_id=board_a_uid and a.role='electoral_board' and a.status='active' and a.organization_id is not null;
  select count(*) into super_assignment_count from public.admin_users a
    where a.auth_user_id=super_uid and a.role='super_admin' and a.status='active';
  select s.id,s.auth_user_id,t.id into student_id_value,student_uid,term_id_value
    from public.students s
    join lateral (select at.id from public.academic_terms at where at.status='active'
      order by at.created_at desc,at.id desc limit 1) t on true
    cross join lateral public.resolve_student_organization_participation(s.id,board_a_org,t.id) participation
    where s.status='active' and s.auth_user_id is not null and participation.allowed is true
    order by s.id limit 1;
  if board_assignment_count<>1 or super_assignment_count<>1
     or board_a_uid is null or board_a_org is null or board_b_org is null or super_uid is null
     or student_uid is null or student_id_value is null or term_id_value is null then
    raise exception 'ACTOR_SETUP_REQUIRED_ACTIVE_IDENTITIES_OR_ORGANIZATIONS_MISSING';
  end if;
  if not exists (select 1 from auth.users u where u.id=board_a_uid)
     or not exists (select 1 from auth.users u where u.id=super_uid)
     or not exists (select 1 from auth.users u where u.id=student_uid) then
    raise exception 'ACTOR_SETUP_AUTH_LINK_MISSING';
  end if;

  while exists (select 1 from auth.users where id in (board_b_uid,inactive_uid))
     or exists (select 1 from public.admin_users where auth_user_id in (board_b_uid,inactive_uid)) loop
    board_b_uid := extensions.gen_random_uuid(); inactive_uid := extensions.gen_random_uuid();
  end loop;

  insert into auth.users (id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values (board_b_uid,'authenticated','authenticated',
    'kandid-rollback-board-' || replace(board_b_uid::text,'-','') || '@example.invalid','',
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now());
  attempt_id := (1 + floor(random()*2147483646))::integer;
  while exists (select 1 from public.admin_users where id=attempt_id) loop
    attempt_id := (1 + floor(random()*2147483646))::integer;
  end loop;
  insert into public.admin_users(id,full_name,email,role,organization_id,status,auth_user_id)
  values (attempt_id,'Rollback Board B','kandid-rollback-board-' || replace(board_b_uid::text,'-','') || '@example.invalid',
    'electoral_board',board_b_org,'active',board_b_uid);
  inactive_admin_id := (1 + floor(random()*2147483646))::integer;
  while inactive_admin_id=attempt_id or exists (select 1 from public.admin_users where id=inactive_admin_id) loop
    inactive_admin_id := (1 + floor(random()*2147483646))::integer;
  end loop;
  insert into auth.users (id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values (inactive_uid,'authenticated','authenticated',
    'kandid-rollback-inactive-' || replace(inactive_uid::text,'-','') || '@example.invalid','',
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now());
  insert into public.admin_users(id,full_name,email,role,organization_id,status,auth_user_id)
  values (inactive_admin_id,'Rollback Inactive Board','kandid-rollback-inactive-' || replace(inactive_uid::text,'-','') || '@example.invalid',
    'electoral_board',board_a_org,'disabled',inactive_uid);

  e_a := (1 + floor(random()*2147483646))::integer;
  while exists (select 1 from public.elections where id=e_a) loop e_a := (1 + floor(random()*2147483646))::integer; end loop;
  e_a_archived_private := (1 + floor(random()*2147483646))::integer;
  while e_a_archived_private=e_a or exists (select 1 from public.elections where id=e_a_archived_private) loop
    e_a_archived_private := (1 + floor(random()*2147483646))::integer;
  end loop;
  e_a_pre := (1 + floor(random()*2147483646))::integer;
  while e_a_pre in (e_a,e_a_archived_private) or exists (select 1 from public.elections where id=e_a_pre) loop e_a_pre := (1 + floor(random()*2147483646))::integer; end loop;
  e_a_draft := (1 + floor(random()*2147483646))::integer;
  while e_a_draft in (e_a,e_a_archived_private,e_a_pre) or exists (select 1 from public.elections where id=e_a_draft) loop e_a_draft := (1 + floor(random()*2147483646))::integer; end loop;
  e_b := (1 + floor(random()*2147483646))::integer;
  while e_b in (e_a,e_a_archived_private,e_a_pre,e_a_draft) or exists (select 1 from public.elections where id=e_b) loop e_b := (1 + floor(random()*2147483646))::integer; end loop;
  p_hidden := (1 + floor(random()*2147483646))::integer;
  while exists (select 1 from public.positions where id=p_hidden) loop p_hidden := (1 + floor(random()*2147483646))::integer; end loop;
  p_managed := (1 + floor(random()*2147483646))::integer;
  while p_managed=p_hidden or exists (select 1 from public.positions where id=p_managed) loop p_managed := (1 + floor(random()*2147483646))::integer; end loop;
  c_hidden := (1 + floor(random()*2147483646))::integer;
  while exists (select 1 from public.candidates where id=c_hidden) loop c_hidden := (1 + floor(random()*2147483646))::integer; end loop;

  perform set_config('kandid.test.board_a_uid',board_a_uid::text,true);
  perform set_config('kandid.test.board_a_org',board_a_org::text,true);
  perform set_config('kandid.test.board_b_uid',board_b_uid::text,true);
  perform set_config('kandid.test.inactive_uid',inactive_uid::text,true);
  perform set_config('kandid.test.board_b_org',board_b_org::text,true);
  perform set_config('kandid.test.super_uid',super_uid::text,true);
  perform set_config('kandid.test.student_uid',student_uid::text,true);
  perform set_config('kandid.test.student_id',student_id_value::text,true);
  perform set_config('kandid.test.term_id',term_id_value::text,true);
  perform set_config('kandid.test.e_a',e_a::text,true);
  perform set_config('kandid.test.e_a_archived_private',e_a_archived_private::text,true);
  perform set_config('kandid.test.e_a_pre',e_a_pre::text,true);
  perform set_config('kandid.test.e_a_draft',e_a_draft::text,true);
  perform set_config('kandid.test.e_b',e_b::text,true);
  perform set_config('kandid.test.p_hidden',p_hidden::text,true);
  perform set_config('kandid.test.p_managed',p_managed::text,true);
  perform set_config('kandid.test.c_hidden',c_hidden::text,true);

  perform set_config('request.jwt.claim.sub',board_a_uid::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',board_a_uid,'role','authenticated')::text,true);
  perform set_config('kandid.allow_result_release_write','on',true);
  insert into public.elections(id,organization_id,title,status,academic_term_id,results_released_at,geo_lat,geo_lng,geo_radius_meters,campaign_start,campaign_end)
    values (e_a,board_a_org,'Rollback Actor Released Archive','archived',term_id_value,now(),14.500000,121.000000,20,null,null),
      (e_a_archived_private,board_a_org,'Rollback Actor Unreleased Archive','archived',term_id_value,null,14.500004,121.000004,20,null,null),
      (e_a_pre,board_a_org,'Rollback Actor Pre-release Election','active',term_id_value,null,14.500001,121.000001,20,
        timezone('Asia/Manila',clock_timestamp())-interval '1 day',timezone('Asia/Manila',clock_timestamp())+interval '1 day'),
      (e_a_draft,board_a_org,'Rollback Actor Draft Election','draft',term_id_value,null,14.500002,121.000002,20,null,null),
      (e_b,board_b_org,'Rollback Actor Organization B Election','active',term_id_value,null,14.500003,121.000003,20,null,null);
  perform set_config('kandid.allow_result_release_write','off',true);
  insert into public.positions(id,election_id,name,display_order,status)
    values (p_hidden,e_a_pre,'Rollback Hidden Candidate Position',1,'active'),
      (p_managed,e_a_pre,'Rollback Managed Candidate Position',2,'active');
  insert into public.candidates(id,position_id,student_id,campaign_status)
    values (c_hidden,p_hidden,student_id_value,'hidden');
end;
$actor_fixture_setup$;

set local role anon;
do $actor_anonymous$
declare visible_count integer; released_result jsonb; ignored jsonb;
begin
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
   select count(*) into visible_count from public.elections where id=current_setting('kandid.test.e_a_draft')::integer;
  if visible_count<>0 then raise exception 'ACTOR_ANON_DRAFT_ELECTION_VISIBLE'; end if;
  select count(*) into visible_count from public.elections where id=current_setting('kandid.test.e_a')::integer;
  if visible_count<>1 then raise exception 'ACTOR_ANON_PUBLISHED_ELECTION_HIDDEN'; end if;
  select count(*) into visible_count from public.elections where id=current_setting('kandid.test.e_a_archived_private')::integer;
  if visible_count<>0 then raise exception 'ACTOR_ANON_UNRELEASED_ARCHIVE_VISIBLE'; end if;
  if has_table_privilege('anon','public.candidates','SELECT') or has_table_privilege('anon','public.votes','SELECT')
     or has_table_privilege('anon','public.vote_ballots','SELECT') or has_table_privilege('anon','public.admin_users','SELECT')
      or has_table_privilege('anon','public.election_access_tokens','SELECT')
      or has_table_privilege('anon','public.students','SELECT') then
    raise exception 'ACTOR_ANON_PRIVATE_TABLE_GRANT_PRESENT';
  end if;
  if has_column_privilege('anon','public.elections','geo_lat','SELECT')
     or has_column_privilege('anon','public.elections','geo_lng','SELECT')
     or has_column_privilege('anon','public.elections','geo_radius_meters','SELECT') then
    raise exception 'ACTOR_ANON_GEOFENCE_GRANT_PRESENT';
  end if;
  begin
    perform geo_lat from public.elections where id=current_setting('kandid.test.e_a')::integer;
    raise exception 'ACTOR_ANON_DIRECT_GEOFENCE_READ_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.vote_ballots limit 1;
    raise exception 'ACTOR_ANON_RAW_BALLOT_READ_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.votes limit 1;
    raise exception 'ACTOR_ANON_RAW_VOTE_READ_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.election_access_tokens limit 1;
    raise exception 'ACTOR_ANON_ELECTION_ACCESS_TOKEN_READ_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.students limit 1;
    raise exception 'ACTOR_ANON_STUDENT_TABLE_READ_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  begin
    select public.kandid_get_public_released_election_results(current_setting('kandid.test.e_a_pre')::integer) into ignored;
    raise exception 'ACTOR_ANON_UNRELEASED_RESULTS_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  begin
    select public.kandid_get_public_released_election_results(current_setting('kandid.test.e_a_archived_private')::integer) into ignored;
    raise exception 'ACTOR_ANON_UNRELEASED_ARCHIVE_RESULTS_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  released_result := public.kandid_get_public_released_election_results(current_setting('kandid.test.e_a')::integer);
  if released_result->'election'->>'id' is distinct from current_setting('kandid.test.e_a')
     or released_result::text ilike '%student_id%' or released_result::text ilike '%ballot_id%' then
    raise exception 'ACTOR_ANON_PUBLIC_RESULTS_CONTRACT_INVALID';
  end if;
end;
$actor_anonymous$;
select 'ANONYMOUS=PASS';
reset role;

set local role authenticated;
do $actor_student$
declare visible_count integer; candidates_result jsonb; ignored jsonb;
begin
  perform set_config('request.jwt.claim.sub',current_setting('kandid.test.student_uid'),true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('kandid.test.student_uid'),'role','authenticated')::text,true);
  select count(*) into visible_count from public.students where id=current_setting('kandid.test.student_id')::integer;
  if visible_count<>1 then raise exception 'ACTOR_STUDENT_OWN_SAFE_PROFILE_HIDDEN'; end if;
  select count(*) into visible_count from public.elections where id=current_setting('kandid.test.e_a_draft')::integer;
  if visible_count<>0 then raise exception 'ACTOR_STUDENT_DRAFT_ELECTION_VISIBLE'; end if;
  select count(*) into visible_count from public.elections where id=current_setting('kandid.test.e_a_archived_private')::integer;
  if visible_count<>0 then raise exception 'ACTOR_STUDENT_UNRELEASED_ARCHIVE_VISIBLE'; end if;
  select count(*) into visible_count from public.candidates where campaign_status<>'published';
  if visible_count<>0 then raise exception 'ACTOR_STUDENT_HIDDEN_CANDIDATE_VISIBLE'; end if;
  -- The authenticated database role is shared by Students and administrators.
  -- Assert the sensitive candidate link and private columns are not granted to
  -- that role; table-level token SELECT is intentionally granted for Boards,
  -- with RLS enforcing active role and organization scope per request.
  if has_column_privilege('authenticated','public.candidates','student_id','SELECT') then
    raise exception 'ACTOR_STUDENT_CANDIDATE_STUDENT_ID_COLUMN_GRANT_PRESENT';
  end if;
  if has_table_privilege('authenticated','public.votes','SELECT') then
    raise exception 'ACTOR_STUDENT_RAW_VOTES_TABLE_GRANT_PRESENT';
  end if;
  if has_table_privilege('authenticated','public.vote_ballots','SELECT') then
    raise exception 'ACTOR_STUDENT_RAW_BALLOTS_TABLE_GRANT_PRESENT';
  end if;
  if has_table_privilege('authenticated','public.admin_users','SELECT') then
    raise exception 'ACTOR_STUDENT_ADMIN_USERS_TABLE_GRANT_PRESENT';
  end if;
  if has_column_privilege('authenticated','public.elections','geo_lat','SELECT')
     or has_column_privilege('authenticated','public.elections','geo_lng','SELECT')
     or has_column_privilege('authenticated','public.elections','geo_radius_meters','SELECT') then
    raise exception 'ACTOR_STUDENT_GEOFENCE_COLUMN_GRANT_PRESENT';
  end if;
  if has_column_privilege('authenticated','public.students','email','SELECT')
     or has_column_privilege('authenticated','public.students','password','SELECT')
     or has_column_privilege('authenticated','public.students','auth_user_id','SELECT') then
    raise exception 'ACTOR_STUDENT_PRIVATE_STUDENT_COLUMN_GRANT_PRESENT';
  end if;
  begin
    perform student_id from public.candidates where id=current_setting('kandid.test.c_hidden')::integer;
    raise exception 'ACTOR_STUDENT_DIRECT_CANDIDATE_LINK_READ_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  begin
    perform student_number from public.students where id=current_setting('kandid.test.student_id')::integer;
    raise exception 'ACTOR_STUDENT_PRIVATE_IDENTIFIER_READ_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  -- Authenticated has table SELECT for Board token management. Student
  -- authorization is therefore verified through RLS-filtered visibility.
  select count(*) into visible_count from public.election_access_tokens;
  if visible_count<>0 then raise exception 'ACTOR_STUDENT_ELECTION_ACCESS_TOKEN_VISIBLE'; end if;
  begin
    perform geo_lat from public.elections where id=current_setting('kandid.test.e_a_pre')::integer;
    raise exception 'ACTOR_STUDENT_DIRECT_GEOFENCE_READ_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.vote_ballots limit 1;
    raise exception 'ACTOR_STUDENT_RAW_BALLOT_READ_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.votes limit 1;
    raise exception 'ACTOR_STUDENT_RAW_VOTE_READ_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  candidates_result := public.kandid_get_student_ballot_candidates(current_setting('kandid.test.e_a_pre')::integer);
  if jsonb_typeof(candidates_result) is distinct from 'array' then raise exception 'ACTOR_STUDENT_BALLOT_CANDIDATE_CONTRACT_INVALID'; end if;
  begin
    ignored := public.kandid_get_admin_election_geofence(current_setting('kandid.test.e_a_pre')::integer);
    raise exception 'ACTOR_STUDENT_ADMIN_GEOFENCE_RPC_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  begin
    ignored := public.kandid_admin_candidate_directory(array[current_setting('kandid.test.e_a_pre')::integer],null);
    raise exception 'ACTOR_STUDENT_ADMIN_CANDIDATE_RPC_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  begin
    ignored := public.kandid_get_student_result_candidates(current_setting('kandid.test.e_a_pre')::integer);
    raise exception 'ACTOR_STUDENT_PRE_RELEASE_RESULTS_ALLOWED';
  exception when insufficient_privilege then null;
  end;
end;
$actor_student$;
select 'STUDENT=PASS';
reset role;
delete from public.candidates where id=current_setting('kandid.test.c_hidden')::integer;

set local role authenticated;
do $actor_board_a$
declare visible_count integer; changed_count integer; payload jsonb; denial_seen boolean := false;
  actual_candidate_vote_total text;
  duplicate_candidate integer := (1 + floor(random()*2147483646))::integer;
  unauthorized_candidate_id integer := (1 + floor(random()*2147483646))::integer;
  duplicate_sqlstate text; duplicate_message text; authorization_sqlstate text; authorization_message text;
  new_position integer := (1 + floor(random()*2147483646))::integer;
  new_candidate integer := (1 + floor(random()*2147483646))::integer;
  foreign_position integer := (1 + floor(random()*2147483646))::integer;
begin
  if current_user <> 'authenticated' then raise exception 'ACTOR_BOARD_A_ROLE_SIMULATION_INVALID'; end if;
  perform set_config('request.jwt.claim.sub',current_setting('kandid.test.board_a_uid'),true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('kandid.test.board_a_uid'),'role','authenticated')::text,true);
  while new_position in (current_setting('kandid.test.p_hidden')::integer,current_setting('kandid.test.p_managed')::integer)
     or exists (select 1 from public.positions where id=new_position) loop new_position := (1 + floor(random()*2147483646))::integer; end loop;
  while new_candidate=current_setting('kandid.test.c_hidden')::integer
     or exists (select 1 from public.candidates where id=new_candidate) loop new_candidate := (1 + floor(random()*2147483646))::integer; end loop;
  while foreign_position in (new_position,current_setting('kandid.test.p_hidden')::integer,current_setting('kandid.test.p_managed')::integer)
     or exists (select 1 from public.positions where id=foreign_position) loop foreign_position := (1 + floor(random()*2147483646))::integer; end loop;
  select count(*) into visible_count from public.elections where id=current_setting('kandid.test.e_a_draft')::integer;
  if visible_count<>1 then raise exception 'ACTOR_BOARD_A_CANNOT_READ_OWN_DRAFT'; end if;
  select count(*) into visible_count from public.elections where organization_id<>current_setting('kandid.test.board_a_org')::integer;
  if visible_count<>0 then raise exception 'ACTOR_BOARD_A_CROSS_ORGANIZATION_READ'; end if;
  update public.elections set title=title || ' updated' where id=current_setting('kandid.test.e_a_pre')::integer;
  get diagnostics changed_count=row_count;
  if changed_count<>1 then raise exception 'ACTOR_BOARD_A_OWN_ELECTION_UPDATE_DENIED'; end if;
  insert into public.positions(id,election_id,name,display_order,status)
    values (new_position,current_setting('kandid.test.e_a_pre')::integer,'Rollback Board Position',3,'active');
  insert into public.candidates(id,position_id,student_id,campaign_status)
    values (new_candidate,new_position,current_setting('kandid.test.student_id')::integer,'draft');
  select count(*) into visible_count from public.students where id=current_setting('kandid.test.student_id')::integer;
  if visible_count<>1 then raise exception 'ACTOR_BOARD_A_CANDIDATE_STUDENT_READ_DENIED'; end if;
  update public.candidates set campaign_status='published'
    where id=new_candidate and position_id=new_position;
  get diagnostics changed_count=row_count;
  if changed_count<>1 then raise exception 'ACTOR_BOARD_A_OWN_CANDIDATE_UPDATE_DENIED'; end if;

  while duplicate_candidate in (new_candidate,current_setting('kandid.test.c_hidden')::integer)
     or exists (select 1 from public.candidates where id=duplicate_candidate) loop
    duplicate_candidate := (1 + floor(random()*2147483646))::integer;
  end loop;
  denial_seen := false;
  begin
    insert into public.candidates(id,position_id,student_id,campaign_status)
      values (duplicate_candidate,current_setting('kandid.test.p_managed')::integer,
        current_setting('kandid.test.student_id')::integer,'draft');
  exception when raise_exception then
    get stacked diagnostics duplicate_sqlstate = returned_sqlstate, duplicate_message = message_text;
    if duplicate_sqlstate <> 'P0001'
       or duplicate_message not like 'This student is already a candidate for % in this election.' then
      raise exception 'ACTOR_BOARD_DUPLICATE_CANDIDATE_ERROR_CONTRACT_INVALID';
    end if;
    denial_seen := true;
  end;
  if not denial_seen then raise exception 'ACTOR_BOARD_DUPLICATE_CANDIDATE_ALLOWED'; end if;

  while unauthorized_candidate_id in (new_candidate,duplicate_candidate)
     or exists (select 1 from public.candidates where id=unauthorized_candidate_id) loop
    unauthorized_candidate_id := (1 + floor(random()*2147483646))::integer;
  end loop;
  denial_seen := false;
  perform set_config('request.jwt.claim.sub',current_setting('kandid.test.board_b_uid'),true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('kandid.test.board_b_uid'),'role','authenticated')::text,true);
  begin
    insert into public.candidates(id,position_id,student_id,campaign_status)
      values (unauthorized_candidate_id,current_setting('kandid.test.p_managed')::integer,
        current_setting('kandid.test.student_id')::integer,'draft');
  exception when insufficient_privilege then
    get stacked diagnostics authorization_sqlstate = returned_sqlstate, authorization_message = message_text;
    if authorization_sqlstate <> '42501'
       or authorization_message <> 'Candidate changes are not authorized for this election.' then
      raise exception 'ACTOR_BOARD_FOREIGN_CANDIDATE_DENIAL_CONTRACT_INVALID';
    end if;
    denial_seen := true;
  end;
  if not denial_seen then raise exception 'ACTOR_BOARD_FOREIGN_CANDIDATE_INSERT_ALLOWED'; end if;
  perform set_config('request.jwt.claim.sub',current_setting('kandid.test.board_a_uid'),true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('kandid.test.board_a_uid'),'role','authenticated')::text,true);

  perform set_config('kandid.test.board_candidate_id',new_candidate::text,true);

  begin
    insert into public.positions(id,election_id,name,display_order,status)
      values (foreign_position,current_setting('kandid.test.e_b')::integer,'Unauthorized Foreign Position',4,'active');
  exception when insufficient_privilege then denial_seen := true;
  end;
  if not denial_seen then raise exception 'ACTOR_BOARD_A_CROSS_ORGANIZATION_INSERT_ALLOWED'; end if;
  denial_seen := false;
  begin
    update public.candidates set position_id=null where id=new_candidate;
    get diagnostics changed_count=row_count;
    if changed_count=0 then denial_seen := true; end if;
  exception when insufficient_privilege then denial_seen := true;
  end;
  if not denial_seen then raise exception 'ACTOR_BOARD_CANDIDATE_DETACH_ALLOWED'; end if;

  select public.kandid_get_board_election_report_package(current_setting('kandid.test.e_a_pre')::integer) into payload;
  if payload is null or jsonb_typeof(payload) is distinct from 'object' or jsonb_typeof(payload->'voting_summary') is distinct from 'object'
     or payload->'voting_summary'->'positions' is null
     or (payload->'voting_summary')::text ilike '%ballot_id%' then
    raise exception 'ACTOR_BOARD_PRE_RELEASE_REPORT_UNAVAILABLE_OR_BALLOT_DATA_PRESENT';
  end if;
  -- Earlier positions intentionally have no candidate fixtures. Locate the
  -- exact Board A fixture candidate rather than assuming array index zero.
  select candidate_item.candidate_json->>'vote_total'
    into actual_candidate_vote_total
  from jsonb_array_elements(coalesce(payload->'voting_summary'->'positions','[]'::jsonb)) as position_item(position_json)
  cross join lateral jsonb_array_elements(coalesce(position_item.position_json->'candidates','[]'::jsonb)) as candidate_item(candidate_json)
  where candidate_item.candidate_json->>'candidate_id'=current_setting('kandid.test.board_candidate_id')
  limit 1;
  if not found then
    raise exception 'ACTOR_BOARD_PRIVATE_CANDIDATE_TOTAL_UNAVAILABLE expected_candidate_id=% expected_vote_total=0 actual_candidate=ABSENT actor=BoardA invoking_role=%',
      current_setting('kandid.test.board_candidate_id'), current_user;
  end if;
  if actual_candidate_vote_total is distinct from '0' then
    raise exception 'ACTOR_BOARD_PRIVATE_CANDIDATE_TOTAL_UNAVAILABLE expected_candidate_id=% expected_vote_total=0 actual_candidate_id=% actual_vote_total=% actor=BoardA invoking_role=%',
      current_setting('kandid.test.board_candidate_id'), current_setting('kandid.test.board_candidate_id'),
      coalesce(actual_candidate_vote_total,'NULL'), current_user;
  end if;
  payload := public.kandid_get_admin_election_geofence(current_setting('kandid.test.e_a_pre')::integer);
  if payload->>'geo_lat' is null or payload->>'geo_lng' is null then
    raise exception 'ACTOR_BOARD_OWN_GEOFENCE_RPC_DENIED';
  end if;
  select public.kandid_get_board_voting_monitor(current_setting('kandid.test.e_a_pre')::integer,0,10) into payload;
  if payload is null or payload::text ilike '%student_id%' or payload::text ilike '%student_number%'
     or payload::text ilike '%ballot_hash%' or payload::text ilike '%first_name%'
     or jsonb_typeof(payload->'summary') is distinct from 'object'
     or jsonb_typeof(payload->'ballots') is distinct from 'array' or jsonb_array_length(payload->'ballots')<>0 then
    raise exception 'ACTOR_BOARD_MONITOR_EXPOSES_IDENTITY_OR_BALLOT';
  end if;
  begin
    perform public.kandid_list_super_admin_audit_events();
    raise exception 'ACTOR_BOARD_SUPER_ADMIN_RPC_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.kandid_get_board_election_report_package(current_setting('kandid.test.e_b')::integer);
    raise exception 'ACTOR_BOARD_A_FOREIGN_PRIVATE_RESULTS_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  select count(*) into visible_count from public.kandid_admin_candidate_directory(array[current_setting('kandid.test.e_a_pre')::integer],null);
  if visible_count<1 then raise exception 'ACTOR_BOARD_A_CANDIDATE_MANAGEMENT_READ_DENIED'; end if;
end;
$actor_board_a$;
select 'BOARD_SAME_ORGANIZATION=PASS';
select 'BOARD_MANAGEMENT_WRITES=PASS';
select 'BOARD_PRIVATE_RESULTS=PASS';
select 'BOARD_DUPLICATE_PREVENTION=PASS';
select 'BOARD_UNAUTHORIZED_CANDIDATE_DENIAL=PASS';

reset role;
set local role authenticated;
do $actor_student_published$
declare result_rows jsonb; campaign_result jsonb; visible_count integer;
begin
  perform set_config('request.jwt.claim.sub',current_setting('kandid.test.student_uid'),true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('kandid.test.student_uid'),'role','authenticated')::text,true);
  result_rows := public.kandid_get_student_ballot_candidates(current_setting('kandid.test.e_a_pre')::integer);
  if jsonb_typeof(result_rows) is distinct from 'array' or jsonb_array_length(result_rows)<1
     or result_rows::text ilike '%student_id%' then
    raise exception 'ACTOR_STUDENT_PUBLISHED_BALLOT_CANDIDATE_CONTRACT_INVALID';
  end if;
  campaign_result := public.kandid_get_student_published_campaign(current_setting('kandid.test.e_a_pre')::integer);
  if campaign_result->>'status' is distinct from 'AVAILABLE'
     or jsonb_typeof(campaign_result->'data'->'candidates') is distinct from 'array'
     or jsonb_array_length(campaign_result->'data'->'candidates')<1
     or campaign_result::text ilike '%student_id%' then
    raise exception 'ACTOR_STUDENT_PUBLISHED_CAMPAIGN_CONTRACT_INVALID';
  end if;
  select count(*) into visible_count from public.candidates
    where id=current_setting('kandid.test.board_candidate_id')::integer;
  if visible_count<>1 then raise exception 'ACTOR_STUDENT_PUBLISHED_CANDIDATE_ROW_NOT_VISIBLE'; end if;
end;
$actor_student_published$;
select 'STUDENT_PUBLISHED_CAMPAIGN=PASS';

reset role;
set local role authenticated;
do $actor_board_b$
declare visible_count integer; changed_count integer; denial_seen boolean := false;
  foreign_position integer := (1 + floor(random()*2147483646))::integer;
begin
  perform set_config('request.jwt.claim.sub',current_setting('kandid.test.board_b_uid'),true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('kandid.test.board_b_uid'),'role','authenticated')::text,true);
  select count(*) into visible_count from public.elections where id=current_setting('kandid.test.e_b')::integer;
  if visible_count<>1 then raise exception 'ACTOR_BOARD_B_CANNOT_READ_ASSIGNED_ORGANIZATION'; end if;
  -- The released archived election is intentionally public to anonymous
  -- visitors and is tested in the anonymous actor block. Keep this assertion
  -- limited to Board A's private/unreleased management records.
  select count(*) into visible_count from public.elections where id in
    (current_setting('kandid.test.e_a_archived_private')::integer,
     current_setting('kandid.test.e_a_pre')::integer,current_setting('kandid.test.e_a_draft')::integer);
  if visible_count<>0 then raise exception 'ACTOR_BOARD_B_CROSS_ORGANIZATION_READ'; end if;
  select count(*) into visible_count from public.positions p join public.elections e on e.id=p.election_id
    where e.id=current_setting('kandid.test.e_a_pre')::integer;
  if visible_count<>0 then raise exception 'ACTOR_BOARD_B_CROSS_ORGANIZATION_POSITION_READ'; end if;
  select count(*) into visible_count from public.students where id=current_setting('kandid.test.student_id')::integer;
  if visible_count<>0 then raise exception 'ACTOR_BOARD_B_CROSS_ORGANIZATION_STUDENT_READ_ALLOWED'; end if;
  select count(*) into visible_count
  from public.kandid_admin_candidate_directory(array[current_setting('kandid.test.e_a_pre')::integer],null);
  if visible_count<>0 then raise exception 'ACTOR_BOARD_B_FOREIGN_CANDIDATE_DIRECTORY_ALLOWED'; end if;
  begin
    while exists (select 1 from public.positions where id=foreign_position) loop foreign_position := (1 + floor(random()*2147483646))::integer; end loop;
    insert into public.positions(id,election_id,name,display_order,status)
      values (foreign_position,current_setting('kandid.test.e_a_pre')::integer,'Unauthorized Board B Position',5,'active');
  exception when insufficient_privilege then denial_seen := true;
  end;
  if not denial_seen then raise exception 'ACTOR_BOARD_B_CROSS_ORGANIZATION_INSERT_ALLOWED'; end if;
end;
$actor_board_b$;
select 'BOARD_CROSS_ORGANIZATION=PASS';

reset role;
set local role authenticated;
do $actor_inactive$
declare visible_count integer; allowed_value boolean;
begin
  perform set_config('request.jwt.claim.sub',current_setting('kandid.test.inactive_uid'),true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('kandid.test.inactive_uid'),'role','authenticated')::text,true);
  allowed_value := private.kandid_active_admin_can_access_organization(current_setting('kandid.test.board_a_org')::bigint);
  select count(*) into visible_count from public.elections where id=current_setting('kandid.test.e_a_pre')::integer;
  if allowed_value or visible_count<>0 then raise exception 'ACTOR_INACTIVE_OR_UNKNOWN_ACCOUNT_ALLOWED'; end if;
  begin
    perform public.kandid_get_board_voting_monitor(current_setting('kandid.test.e_a_pre')::integer,0,10);
    raise exception 'ACTOR_INACTIVE_BOARD_MONITOR_ALLOWED';
  exception when insufficient_privilege then null;
  end;
end;
$actor_inactive$;
select 'INACTIVE_ACCOUNT=PASS';

reset role;
set local role authenticated;
do $actor_super_admin$
declare visible_count integer; payload jsonb; changed_count integer;
begin
  perform set_config('request.jwt.claim.sub',current_setting('kandid.test.super_uid'),true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('kandid.test.super_uid'),'role','authenticated')::text,true);
  select count(*) into visible_count from public.elections where id in
    (current_setting('kandid.test.e_a')::integer,current_setting('kandid.test.e_a_archived_private')::integer,
     current_setting('kandid.test.e_a_pre')::integer,current_setting('kandid.test.e_a_draft')::integer,
     current_setting('kandid.test.e_b')::integer);
  if visible_count<>5 then raise exception 'ACTOR_SUPER_ADMIN_SYSTEM_WIDE_READ_DENIED'; end if;
  select count(*) into visible_count from public.kandid_admin_candidate_directory(array[current_setting('kandid.test.e_a_pre')::integer],null);
  if visible_count<1 then raise exception 'ACTOR_SUPER_ADMIN_CANDIDATE_DIRECTORY_DENIED'; end if;
  payload := public.kandid_get_admin_election_geofence(current_setting('kandid.test.e_b')::integer);
  if payload->>'geo_lat' is null or payload->>'geo_lng' is null then raise exception 'ACTOR_SUPER_ADMIN_GEOFENCE_RPC_DENIED'; end if;
  perform public.kandid_list_super_admin_audit_events();
  update public.candidates set position_id=null where id=current_setting('kandid.test.board_candidate_id')::integer;
  get diagnostics changed_count=row_count;
  if changed_count<>1 then raise exception 'ACTOR_SUPER_ADMIN_CANDIDATE_DETACH_DENIED'; end if;
end;
$actor_super_admin$;
select 'SUPER_ADMIN=PASS';
select 'PRIVACY_CHECKS=PASS';
reset role;
do $actor_pass_marker$
begin
  raise notice 'ACTOR_AUTHORIZATION_TESTS=PASS';
end;
$actor_pass_marker$;
'@
}

function Get-InTransactionVerificationSql {
@'
do $rollback_test_assertions$
begin
  if to_regprocedure('public.kandid_guard_candidate_mutation()') is null
     or to_regprocedure('private.kandid_active_admin_can_access_organization(bigint)') is null
     or to_regprocedure('private.kandid_student_can_read_election(integer)') is null
     or to_regprocedure('public.kandid_admin_candidate_directory(integer[],integer[])') is null
     or to_regprocedure('public.kandid_get_admin_election_geofence(integer)') is null
     or to_regprocedure('public.kandid_get_public_released_election_results(integer)') is null
     or to_regprocedure('public.kandid_get_student_published_campaign(integer)') is null
     or to_regprocedure('public.kandid_get_student_ballot_candidates(integer)') is null
     or to_regprocedure('public.kandid_get_student_result_candidates(integer)') is null
     or to_regprocedure('public.kandid_get_board_voting_monitor(integer,integer,integer)') is null then
    raise exception 'ROLLBACK_TEST_REQUIRED_FUNCTION_MISSING';
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname='public' and tablename='elections' and policyname='elections_public_published_read')
     or not exists (select 1 from pg_catalog.pg_policies where schemaname='public' and tablename='elections' and policyname='elections_authenticated_scoped_read')
     or not exists (select 1 from pg_catalog.pg_policies where schemaname='public' and tablename='positions' and policyname='positions_public_published_read')
     or not exists (select 1 from pg_catalog.pg_policies where schemaname='public' and tablename='candidates' and policyname='candidates_authenticated_scoped_read')
     or not exists (select 1 from pg_catalog.pg_policies where schemaname='public' and tablename='candidates' and policyname='candidates_update_authorized_election') then
    raise exception 'ROLLBACK_TEST_REQUIRED_POLICY_MISSING';
  end if;
  if has_column_privilege('anon','public.candidates','student_id','SELECT')
     or has_column_privilege('authenticated','public.candidates','student_id','SELECT')
     or has_column_privilege('anon','public.elections','geo_lat','SELECT')
     or has_column_privilege('authenticated','public.elections','geo_lat','SELECT')
     or has_table_privilege('anon','public.candidates','SELECT')
     or has_table_privilege('anon','public.partylists','SELECT') then
    raise exception 'ROLLBACK_TEST_SENSITIVE_PRIVILEGE_REMAINS';
  end if;
  if not exists (select 1 from pg_catalog.pg_proc p where p.oid=to_regprocedure('public.kandid_get_board_voting_monitor(integer,integer,integer)')
      and p.prosecdef and 'search_path=pg_catalog'=any(coalesce(p.proconfig,array[]::text[]))) then
    raise exception 'ROLLBACK_TEST_FUNCTION_SECURITY_CONTRACT_MISMATCH';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid=to_regprocedure('public.prevent_duplicate_candidate_per_election()')
      and p.proowner=(select oid from pg_catalog.pg_roles where rolname='kandid_candidate_duplicate_checker')
      and p.prosecdef and 'search_path=pg_catalog'=any(coalesce(p.proconfig,array[]::text[]))
  ) or exists (
    select 1 from pg_catalog.pg_auth_members m
    where (m.roleid=(select oid from pg_catalog.pg_roles where rolname='kandid_candidate_duplicate_checker')
       or m.member=(select oid from pg_catalog.pg_roles where rolname='kandid_candidate_duplicate_checker'))
      and not (
        m.roleid=(select oid from pg_catalog.pg_roles where rolname='kandid_candidate_duplicate_checker')
        and exists (select 1 from pg_catalog.pg_roles creator
          where creator.oid=m.member and creator.rolname=current_user
            and creator.rolcreaterole and not creator.rolsuper)
        and m.admin_option and not m.inherit_option and not m.set_option
        and exists (select 1 from pg_catalog.pg_roles grantor where grantor.oid=m.grantor and grantor.rolsuper)
      )
  ) or has_schema_privilege('kandid_candidate_duplicate_checker','public','CREATE')
    or (not coalesce((select rolsuper from pg_catalog.pg_roles where rolname=current_user), false)
      and pg_has_role(current_user,'kandid_candidate_duplicate_checker','SET'))
    or pg_has_role('anon','kandid_candidate_duplicate_checker','SET')
    or pg_has_role('authenticated','kandid_candidate_duplicate_checker','SET')
    or pg_has_role('service_role','kandid_candidate_duplicate_checker','SET')
    or has_table_privilege('kandid_candidate_duplicate_checker','public.candidates','SELECT')
    or has_table_privilege('kandid_candidate_duplicate_checker','public.positions','SELECT')
    or has_table_privilege('kandid_candidate_duplicate_checker','public.elections','SELECT')
    or has_column_privilege('authenticated','public.candidates','student_id','SELECT')
    or has_function_privilege('authenticated','public.prevent_duplicate_candidate_per_election()','EXECUTE')
    or has_function_privilege('anon','public.prevent_duplicate_candidate_per_election()','EXECUTE')
    or has_function_privilege('service_role','public.prevent_duplicate_candidate_per_election()','EXECUTE') then
    raise exception 'ROLLBACK_TEST_DUPLICATE_CHECKER_SECURITY_CONTRACT_MISMATCH';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles r
    where r.rolname='kandid_candidate_duplicate_checker'
      and not r.rolcanlogin and not r.rolsuper and not r.rolcreatedb and not r.rolcreaterole
      and not r.rolinherit and not r.rolreplication and not r.rolbypassrls
  ) or exists (
    select 1
    from pg_catalog.pg_attribute a
    where a.attrelid in ('public.elections'::regclass,'public.positions'::regclass,'public.candidates'::regclass)
      and a.attnum>0 and not a.attisdropped
      and has_column_privilege('kandid_candidate_duplicate_checker',a.attrelid,a.attname,'SELECT')
      and not (
        (a.attrelid='public.elections'::regclass and a.attname in ('id','organization_id'))
        or (a.attrelid='public.positions'::regclass and a.attname in ('id','election_id','name'))
        or (a.attrelid='public.candidates'::regclass and a.attname in ('id','student_id','position_id'))
      )
  ) or not has_function_privilege('kandid_candidate_duplicate_checker',
      'public.prevent_duplicate_candidate_per_election()','EXECUTE') then
    raise exception 'ROLLBACK_TEST_DUPLICATE_CHECKER_EFFECTIVE_PRIVILEGES_MISMATCH';
  end if;
  if not has_column_privilege('kandid_candidate_duplicate_checker','public.candidates','student_id','SELECT')
     or not has_column_privilege('kandid_candidate_duplicate_checker','public.positions','name','SELECT')
     or not has_column_privilege('kandid_candidate_duplicate_checker','public.elections','organization_id','SELECT')
     or not has_function_privilege('kandid_candidate_duplicate_checker','public.kandid_can_mutate_election_positions(integer)','EXECUTE')
     or not has_function_privilege('kandid_candidate_duplicate_checker','private.kandid_active_admin_can_access_organization(bigint)','EXECUTE') then
    raise exception 'ROLLBACK_TEST_DUPLICATE_CHECKER_REQUIRED_PRIVILEGE_MISSING';
  end if;
end;
$rollback_test_assertions$;
'@
}

if ($ReviewOnly -and $Execute) { throw 'SELECT_ONE_MODE_ONLY' }
if (-not $ReviewOnly -and -not $Execute) { throw 'SPECIFY_REVIEWONLY_OR_EXECUTE' }

try {
    if ($migrationPaths.Count -ne 2) { throw 'MIGRATION_ORDER_INVALID' }
    $body1 = Get-ReviewedMigrationBody -Path $migrationPaths[0]
    $body2 = Get-ReviewedMigrationBody -Path $migrationPaths[1]
    if ($body1 -notmatch 'eligibility_term_id\s*:=\s*new_election_term_id' -or
        $body2 -notmatch 'Candidate election-term eligibility correction must be applied first') {
        throw 'MIGRATION_DEPENDENCY_ORDER_OR_MARKER_INVALID'
    }
    $aclRevokeAt = $body2.IndexOf('revoke all on function public.prevent_duplicate_candidate_per_election()', [StringComparison]::OrdinalIgnoreCase)
    $checkerTransferAt = $body2.IndexOf('do $transfer_candidate_checker_ownership$', [StringComparison]::OrdinalIgnoreCase)
    $checkerPostflightAt = $body2.IndexOf('do $duplicate_checker_postflight$', [StringComparison]::OrdinalIgnoreCase)
    $checkerRoleAt = $body2.IndexOf('create role kandid_candidate_duplicate_checker', [StringComparison]::OrdinalIgnoreCase)
    if ($aclRevokeAt -lt 0 -or $checkerTransferAt -le $aclRevokeAt -or $checkerPostflightAt -le $checkerTransferAt -or $checkerRoleAt -le 0) {
        throw 'CHECKER_FUNCTION_ACL_OWNERSHIP_ORDER_INVALID'
    }
    if ($body2.IndexOf('revoke all on function public.prevent_duplicate_candidate_per_election()', $checkerTransferAt, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
        throw 'CHECKER_FUNCTION_ACL_CHANGE_AFTER_OWNERSHIP_TRANSFER'
    }
    if ($body1.IndexOf('migration executor lacks required function or schema ownership authority', [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
        $body2.IndexOf('migration executor lacks ownership authority over an affected table', [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
        $body2.IndexOf('migration executor cannot create the restricted checker role', [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        throw 'MIGRATION_EXECUTOR_PREFLIGHT_CONTRACT_MISSING'
    }
    if ($body2 -notmatch 'statement_timestamp\(\)\s*\)\s*<\s*e\.campaign_end' -or
        $body2 -notmatch 'grant select \(id, organization_id, election_id, name, description, logo_url\)\s+on public\.partylists to authenticated') {
        throw 'CAMPAIGN_PUBLICATION_OR_PARTYLIST_PROJECTION_CONTRACT_MISSING'
    }
    if ($body2.IndexOf("p.cmd='ALL'", [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
        $body2.IndexOf('Affected-table mutation policy inventory differs from the reviewed authorization baseline', [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
        $body2.IndexOf('kandid_board_can_read_candidate_student(integer)', [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
        $body2.IndexOf('Board candidate-Student visibility helper grants differ', [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        throw 'MUTATION_POLICY_INVENTORY_OR_STUDENT_VISIBILITY_CONTRACT_MISSING'
    }
    $snapshot = Get-CatalogSnapshotSql
    $postSnapshot = $snapshot -replace 'kandid_migration_catalog_baseline', 'kandid_migration_catalog_after'
    $dataSnapshot = Get-DataSnapshotSql -TableName 'kandid_actor_data_baseline'
    $postDataSnapshot = Get-DataSnapshotSql -TableName 'kandid_actor_data_after'
    $verify = Get-InTransactionVerificationSql
    $actorSql = Get-ActorAuthorizationSql
    foreach ($requiredActorTest in @(
        'set local role anon', 'set local role authenticated', 'kandid.test.board_a_uid',
        'kandid.test.board_b_uid', 'kandid.test.inactive_uid', 'kandid.test.student_uid',
        'kandid.test.super_uid', 'ACTOR_BOARD_CANDIDATE_DETACH_ALLOWED',
        'ACTOR_STUDENT_OWN_SAFE_PROFILE_HIDDEN', 'ACTOR_BOARD_A_CANDIDATE_STUDENT_READ_DENIED',
        'ACTOR_BOARD_B_CROSS_ORGANIZATION_STUDENT_READ_ALLOWED',
        'ACTOR_BOARD_A_CROSS_ORGANIZATION_INSERT_ALLOWED', 'ACTOR_SUPER_ADMIN_CANDIDATE_DETACH_DENIED',
        'ACTOR_BOARD_PRIVATE_CANDIDATE_TOTAL_UNAVAILABLE',
        'ACTOR_BOARD_B_FOREIGN_CANDIDATE_DIRECTORY_ALLOWED',
        'ACTOR_SUPER_ADMIN_SYSTEM_WIDE_READ_DENIED',
        'kandid_get_student_published_campaign', 'kandid_get_public_released_election_results',
        'kandid_get_board_voting_monitor', 'kandid_get_board_election_report_package')) {
        if ($actorSql.IndexOf($requiredActorTest, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
            throw 'ACTOR_TEST_STREAM_REQUIRED_CASE_MISSING'
        }
    }
    if ($actorSql.IndexOf("candidate_item.candidate_json->>'candidate_id'=current_setting('kandid.test.board_candidate_id')", [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
        $actorSql.IndexOf("actual_candidate_vote_total is distinct from '0'", [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
        $actorSql.IndexOf('actual_candidate=ABSENT', [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
        $actorSql.IndexOf('actual_vote_total=%', [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        throw 'BOARD_PRIVATE_RESULT_FIXTURE_ASSERTION_INVALID'
    }
    $boardBActor = [regex]::Match($actorSql, '(?is)do \$actor_board_b\$(.*?)\$actor_board_b\$;').Groups[1].Value
    if (-not $boardBActor -or
        $boardBActor.IndexOf('from public.kandid_admin_candidate_directory(', [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
        $boardBActor.IndexOf('select count(*) into visible_count', [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
        $boardBActor.IndexOf("current_setting('kandid.test.e_a')::integer", [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
        $boardBActor.IndexOf("if visible_count<>0 then raise exception 'ACTOR_BOARD_B_FOREIGN_CANDIDATE_DIRECTORY_ALLOWED'", [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        throw 'BOARD_CROSS_ORGANIZATION_EMPTY_RESULT_ASSERTION_INVALID'
    }
    $superActor = [regex]::Match($actorSql, '(?is)do \$actor_super_admin\$(.*?)\$actor_super_admin\$;').Groups[1].Value
    if (-not $superActor -or
        $superActor.IndexOf("current_setting('kandid.test.e_a_draft')", [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
        $superActor.IndexOf('visible_count<>5', [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        throw 'SUPER_ADMIN_DRAFT_VISIBILITY_ASSERTION_INVALID'
    }
    if ($actorSql -match '(?im)^\s*(begin|commit|rollback)\s*;\s*$') { throw 'ACTOR_TEST_STREAM_TRANSACTION_CONTROL_FORBIDDEN' }
    $sql = @"
$('\set ON_ERROR_STOP on')
$snapshot
$dataSnapshot
begin;
$body1
$body2
$verify
$actorSql
rollback;
$postSnapshot
$postDataSnapshot
do `$rollback_test_postcheck`$
begin
  if exists ((select kind,digest from kandid_migration_catalog_baseline except select kind,digest from kandid_migration_catalog_after)
             union all
             (select kind,digest from kandid_migration_catalog_after except select kind,digest from kandid_migration_catalog_baseline)) then
    raise exception 'ROLLBACK_POSTCHECK_CATALOG_DIFFERS';
  end if;
  if exists ((select relation_name,row_count,digest from kandid_actor_data_baseline except select relation_name,row_count,digest from kandid_actor_data_after)
             union all
             (select relation_name,row_count,digest from kandid_actor_data_after except select relation_name,row_count,digest from kandid_actor_data_baseline)) then
    raise exception 'ROLLBACK_POSTCHECK_DATA_DIFFERS';
  end if;
end;
`$rollback_test_postcheck`$;
select 'POST_ROLLBACK_CATALOG=UNCHANGED';
select 'POST_ROLLBACK_DATA=UNCHANGED';
"@
    $transactionControls = [regex]::Matches($sql, '(?im)^\s*(begin|commit|rollback)\s*;\s*$')
    $begins = @($transactionControls | Where-Object { $_.Groups[1].Value -match '^(?i:begin)$' }).Count
    $commits = @($transactionControls | Where-Object { $_.Groups[1].Value -match '^(?i:commit)$' }).Count
    $rollbacks = @($transactionControls | Where-Object { $_.Groups[1].Value -match '^(?i:rollback)$' }).Count
    if ($begins -ne 1 -or $commits -ne 0 -or $rollbacks -ne 1) { throw 'GENERATED_SQL_TRANSACTION_BOUNDARY_CHECK_FAILED' }
    $beginAt = $sql.IndexOf("`nbegin;`n", [StringComparison]::OrdinalIgnoreCase)
    $migration1At = $sql.IndexOf('Candidate term-eligibility correction preflight failed', [StringComparison]::Ordinal)
    $migration2At = $sql.IndexOf('KANDID publication migration prerequisites are missing.', [StringComparison]::Ordinal)
    $verifyAt = $sql.IndexOf('ROLLBACK_TEST_REQUIRED_FUNCTION_MISSING', [StringComparison]::Ordinal)
    $actorAt = $sql.IndexOf('ACTOR_AUTHORIZATION_TESTS=PASS', [StringComparison]::Ordinal)
    $rollbackAt = $sql.IndexOf("`nrollback;`n", [StringComparison]::OrdinalIgnoreCase)
    $postcheckAt = $sql.IndexOf('POST_ROLLBACK_CATALOG=UNCHANGED', [StringComparison]::Ordinal)
    $dataPostcheckAt = $sql.IndexOf('POST_ROLLBACK_DATA=UNCHANGED', [StringComparison]::Ordinal)
    if ($beginAt -lt 0 -or $migration1At -lt $beginAt -or $migration2At -lt $migration1At -or
        $verifyAt -lt $migration2At -or $actorAt -lt $verifyAt -or $rollbackAt -lt $actorAt -or
        $postcheckAt -lt $rollbackAt -or $dataPostcheckAt -lt $postcheckAt) {
        throw 'GENERATED_SQL_ORDER_CHECK_FAILED'
    }
    $metaLines = [regex]::Matches($sql, '(?m)^\s*\\[^\r\n]*')
    if ($metaLines.Count -ne 1 -or $metaLines[0].Value.Trim() -ne '\set ON_ERROR_STOP on') { throw 'GENERATED_SQL_PSQL_DIRECTIVE_CHECK_FAILED' }
    $notifyMatches = [regex]::Matches($sql, '(?im)^\s*notify\s+pgrst\s*,\s*''reload schema''\s*;\s*$')
    if ($notifyMatches.Count -ne 1 -or $notifyMatches[0].Index -lt $beginAt -or $notifyMatches[0].Index -gt $rollbackAt) {
        throw 'GENERATED_SQL_NOTIFICATION_NOT_ROLLBACK_SCOPED'
    }
    if ($sql -match '(?im)^\s*(create|drop)\s+extension\b|^\s*alter\s+system\b|^\s*(create|drop)\s+database\b|\bdblink\s*\(|\bpg_(read|write)_file\s*\(|\bcopy\b[^;]*\bprogram\b') {
        throw 'GENERATED_SQL_SIDE_EFFECT_CHECK_FAILED'
    }
    'STATIC_REVIEW=PASS'
    'BOUNDARY_COMMIT_HANDLING=ONLY_EXACT_OUTER_WRAPPERS_REMOVED_FROM_TEMP_TEST_COPY'
    'DEPENDENCY_ORDER=PASS'
    'GENERATED_SQL_TRANSACTION=one BEGIN / zero COMMIT / one ROLLBACK'
    'GENERATED_SQL_ORDER=baseline data+catalog / migration 1 / migration 2 / catalog checks / actor tests / ROLLBACK / postchecks'
    'GENERATED_SQL_ACTORS=anonymous,student,board-a,board-b,super-admin,disabled-admin'
    'GENERATED_SQL_NOTIFY=transactional_and_discarded_by_rollback'
    'GENERATED_SQL_SIDE_EFFECTS=PASS'
    if ($ReviewOnly) { 'REVIEW_ONLY=PASS'; exit 0 }

    $docker = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $docker) { throw 'DOCKER_COMMAND_UNAVAILABLE' }
    $name = & docker inspect --type container --format '{{.Name}}' $expectedContainer 2>$null
    $inspectExit = $LASTEXITCODE
    if ($inspectExit -ne 0 -or (($name -join '').Trim() -ne ('/' + $expectedContainer))) { throw 'EXACT_DATABASE_CONTAINER_IDENTITY_FAILED' }
    $state = & docker inspect --type container --format '{{.State.Status}}' $expectedContainer 2>$null
    if ($LASTEXITCODE -ne 0 -or (($state -join '').Trim() -ne 'running')) { throw 'DATABASE_CONTAINER_NOT_RUNNING' }
    $labelsJson = & docker inspect --type container --format '{{json .Config.Labels}}' $expectedContainer 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'DATABASE_CONTAINER_LABEL_INSPECTION_FAILED' }
    $labels = ($labelsJson -join "`n") | ConvertFrom-Json
    if ($labels.'com.supabase.cli.project' -ne $expectedProject -or
        ($labels.'com.docker.compose.project' -and $labels.'com.docker.compose.project' -ne $expectedProject)) {
        throw 'DATABASE_CONTAINER_PROJECT_IDENTITY_FAILED'
    }

    $tempSql = Join-Path $env:TEMP ('kandid-rollback-' + [guid]::NewGuid().ToString('N') + '.sql')
    try {
        [IO.File]::WriteAllText($tempSql, $sql, (New-Object Text.UTF8Encoding($false)))
        Get-Content -LiteralPath $tempSql -Raw | & docker exec -i $expectedContainer psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres
        if ($LASTEXITCODE -ne 0) { throw ('PSQL_FAILED_EXIT_' + $LASTEXITCODE) }
    }
    finally {
        if (Test-Path -LiteralPath $tempSql) { Remove-Item -LiteralPath $tempSql -Force -ErrorAction SilentlyContinue }
    }
    'POSTGRES_EXECUTION=PASS'
    'MIGRATION_1=PASS'
    'MIGRATION_2=PASS'
    'POLICY_AND_GRANT_CHECKS=PASS'
    'ANONYMOUS=PASS'
    'STUDENT=PASS'
    'BOARD_SAME_ORGANIZATION=PASS'
    'BOARD_CROSS_ORGANIZATION=PASS'
    'BOARD_MANAGEMENT_WRITES=PASS'
    'BOARD_PRIVATE_RESULTS=PASS'
    'SUPER_ADMIN=PASS'
    'INACTIVE_ACCOUNT=PASS'
    'PRIVACY_CHECKS=PASS'
    'ACTOR_TESTS=PASS'
    'POST_ROLLBACK_CATALOG=PASS'
    'POST_ROLLBACK_DATA=PASS'
    'POST_ROLLBACK_VERIFICATION=PASS'
}
catch {
    $safe = $_.Exception.Message -replace '[^A-Za-z0-9_:\-]', '_'
    'ROLLBACK_HARNESS=BLOCKED reason=' + $safe
    exit 1
}
