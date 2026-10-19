begin;

-- Prepared publication and organization boundary. This migration is local-only
-- until separately reviewed and authorized for a deployment.
do $preflight$
begin
  if current_user <> 'postgres' then
    raise exception 'KANDID publication migration must run as the reviewed postgres migration role.';
  end if;
  if to_regclass('public.elections') is null
     or to_regclass('public.positions') is null
     or to_regclass('public.candidates') is null
     or to_regclass('public.partylists') is null
     or to_regclass('public.students') is null
     or to_regprocedure('public.resolve_student_organization_participation(integer,integer,integer)') is null
     or to_regprocedure('auth.uid()') is null
     or to_regprocedure('public.kandid_can_mutate_election_positions(integer)') is null
     or to_regprocedure('public.kandid_guard_candidate_mutation()') is null
     or to_regprocedure('public.prevent_duplicate_candidate_per_election()') is null then
    raise exception 'KANDID publication migration prerequisites are missing.';
  end if;
  if to_regnamespace('private') is null
     or (select count(*) from pg_catalog.pg_roles where rolname in ('postgres','anon','authenticated','service_role')) <> 4 then
    raise exception 'KANDID publication migration requires the reviewed Supabase schemas and roles.';
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname='kandid_candidate_duplicate_checker') then
    raise exception 'Candidate duplicate-checker role already exists; inspect its grants before proceeding.';
  end if;
  if not coalesce((select r.rolsuper or r.rolcreaterole from pg_catalog.pg_roles r where r.rolname=current_user), false) then
    raise exception 'KANDID publication migration executor cannot create the restricted checker role.';
  end if;
  if not pg_catalog.has_schema_privilege(current_user,'public','CREATE')
     or not pg_catalog.has_schema_privilege(current_user,'private','CREATE')
     or (not coalesce((select r.rolsuper from pg_catalog.pg_roles r where r.rolname=current_user), false)
        and not pg_catalog.pg_has_role(current_user,
          (select n.nspowner from pg_catalog.pg_namespace n where n.nspname='public'),'USAGE'))
     or (not coalesce((select r.rolsuper from pg_catalog.pg_roles r where r.rolname=current_user), false)
        and not pg_catalog.pg_has_role(current_user,
          (select n.nspowner from pg_catalog.pg_namespace n where n.nspname='private'),'USAGE')) then
    raise exception 'KANDID publication migration executor lacks required schema ownership authority.';
  end if;
  if exists (
    select 1 from pg_catalog.pg_roles r
    where r.rolname=current_user and r.rolcreaterole and not r.rolsuper
  ) and current_setting('createrole_self_grant') <> '' then
    raise exception 'CREATEROLE self-grant settings are not compatible with the isolated checker owner.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid='public.prevent_duplicate_candidate_per_election()'::pg_catalog.regprocedure
      and p.proowner=(select oid from pg_catalog.pg_roles where rolname='postgres')
      and not p.prosecdef
      and p.proconfig=array['search_path=public, pg_temp']::text[]
  ) or not exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid='public.candidates'::regclass
      and t.tgname='candidates_one_student_per_election_guard'
      and t.tgfoid='public.prevent_duplicate_candidate_per_election()'::pg_catalog.regprocedure
      and not t.tgisinternal and t.tgenabled='O'
  ) then
    raise exception 'Candidate duplicate-check trigger baseline differs from the reviewed definition.';
  end if;
  -- RLS/ACL changes require table ownership. Verify this before any object is
  -- changed so a restricted executor fails closed at preflight.
  if not coalesce((select r.rolsuper from pg_catalog.pg_roles r where r.rolname=current_user), false)
     and exists (
       select 1 from pg_catalog.pg_class c
       where c.oid in ('public.elections'::regclass,'public.positions'::regclass,
                       'public.candidates'::regclass,'public.partylists'::regclass,
                       'public.students'::regclass)
         and not pg_catalog.pg_has_role(current_user,c.relowner,'USAGE')
     ) then
    raise exception 'KANDID publication migration executor lacks ownership authority over an affected table.';
  end if;
  if not coalesce((select r.rolsuper or r.rolbypassrls from pg_catalog.pg_roles r where r.rolname=current_user), false)
     and exists (
       select 1 from pg_catalog.pg_class c
       where c.oid in ('public.elections'::regclass,'public.positions'::regclass,
                       'public.candidates'::regclass,'public.partylists'::regclass,
                       'public.students'::regclass,'public.admin_users'::regclass,
                       'public.votes'::regclass,'public.vote_ballots'::regclass)
         and (c.relowner<>(select r.oid from pg_catalog.pg_roles r where r.rolname=current_user)
           or c.relforcerowsecurity)
     ) then
    raise exception 'KANDID publication migration executor cannot provide the reviewed SECURITY DEFINER data access context.';
  end if;
  -- Existing routines that are replaced or have ACLs changed must retain the
  -- reviewed postgres owner; new routines are created under that same role.
  if not coalesce((select r.rolsuper from pg_catalog.pg_roles r where r.rolname=current_user), false)
     and exists (
       select 1
       from (values
         ('private.kandid_active_admin_can_access_organization(bigint)'),
         ('private.kandid_student_can_read_election(integer)'),
         ('private.kandid_board_can_read_candidate_student(integer)'),
         ('public.prevent_duplicate_candidate_per_election()'),
         ('public.kandid_admin_candidate_directory(integer[],integer[])'),
         ('public.get_student_campaign(integer)'),
         ('public.kandid_get_admin_election_geofence(integer)'),
         ('public.kandid_get_public_released_election_results(integer)'),
         ('public.kandid_get_student_published_campaign(integer)'),
         ('public.kandid_get_student_ballot_candidates(integer)'),
         ('public.kandid_get_student_result_candidates(integer)'),
         ('public.kandid_get_board_voting_monitor(integer,integer,integer)')
       ) expected(signature)
       join pg_catalog.pg_proc p on p.oid=pg_catalog.to_regprocedure(expected.signature)
       where p.proowner<>(select r.oid from pg_catalog.pg_roles r where r.rolname=current_user)
     ) then
    raise exception 'KANDID publication migration executor lacks ownership authority over an affected function.';
  end if;
  if not coalesce((select r.rolsuper from pg_catalog.pg_roles r where r.rolname=current_user), false)
     and not pg_catalog.pg_has_role(current_user,
       (select p.proowner from pg_catalog.pg_proc p
        where p.oid='public.kandid_can_mutate_election_positions(integer)'::pg_catalog.regprocedure),'USAGE') then
    raise exception 'KANDID publication migration executor cannot grant the checker its trusted mutation predicate.';
  end if;
  if pg_catalog.pg_get_functiondef('public.kandid_guard_candidate_mutation()'::pg_catalog.regprocedure)
       not like '%eligibility_term_id := new_election_term_id%' then
    raise exception 'Candidate election-term eligibility correction must be applied first.';
  end if;
  if not exists (select 1 from pg_attribute where attrelid='public.elections'::regclass and attname='geo_lat' and attnum > 0 and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid='public.elections'::regclass and attname='geo_lng' and attnum > 0 and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid='public.elections'::regclass and attname='geo_radius_meters' and attnum > 0 and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid='public.candidates'::regclass and attname='campaign_status' and attnum > 0 and not attisdropped)
     or (select count(*) from pg_attribute where attrelid='public.partylists'::regclass
       and attname in ('id','organization_id','election_id','name','description','logo_url')
       and attnum>0 and not attisdropped) <> 6 then
    raise exception 'KANDID publication columns differ from the reviewed schema.';
  end if;
  if exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname='public' and p.tablename in ('elections','positions','candidates','partylists')
      and (p.cmd='ALL' or (p.cmd in ('INSERT','UPDATE','DELETE') and not (
        (p.tablename='elections' and p.policyname in ('elections_insert_active_admin_scope','elections_update_active_admin_scope','elections_delete_active_admin_scope'))
        or (p.tablename='positions' and p.policyname in ('positions_insert_authorized_election','positions_update_authorized_election','positions_delete_authorized_election'))
        or (p.tablename='candidates' and p.policyname in ('candidates_insert_authorized_election','candidates_update_authorized_election','candidates_delete_authorized_election'))
        or (p.tablename='partylists' and p.policyname in ('partylists_insert_authorized_organization','partylists_update_authorized_organization','partylists_delete_authorized_organization'))
      )))
  ) or exists (
    select 1 from (values
      ('elections','elections_insert_active_admin_scope','INSERT'),
      ('elections','elections_update_active_admin_scope','UPDATE'),
      ('elections','elections_delete_active_admin_scope','DELETE'),
      ('positions','positions_insert_authorized_election','INSERT'),
      ('positions','positions_update_authorized_election','UPDATE'),
      ('positions','positions_delete_authorized_election','DELETE'),
      ('candidates','candidates_insert_authorized_election','INSERT'),
      ('candidates','candidates_update_authorized_election','UPDATE'),
      ('candidates','candidates_delete_authorized_election','DELETE'),
      ('partylists','partylists_insert_authorized_organization','INSERT'),
      ('partylists','partylists_update_authorized_organization','UPDATE'),
      ('partylists','partylists_delete_authorized_organization','DELETE')
    ) expected(tablename,policyname,cmd)
    where not exists (select 1 from pg_catalog.pg_policies p where p.schemaname='public'
      and p.tablename=expected.tablename and p.policyname=expected.policyname and p.cmd=expected.cmd)
  ) then
    raise exception 'Affected-table mutation policy inventory differs from the reviewed authorization baseline.';
  end if;
end;
$preflight$;

create or replace function private.kandid_active_admin_can_access_organization(
  p_organization_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select count(*) = 1 and coalesce(bool_or(
    a.role = 'super_admin'
    or (a.role = 'electoral_board' and a.organization_id = p_organization_id)
  ), false)
  from public.admin_users a
  where a.auth_user_id = auth.uid() and a.status = 'active'
$function$;

create or replace function private.kandid_student_can_read_election(
  p_election_id integer
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  student_count integer;
  student_id_value integer;
  organization_id_value integer;
  term_id_value integer;
  allowed_value boolean := false;
begin
  if auth.uid() is null or p_election_id is null then return false; end if;
  select count(*)::integer, min(s.id)
    into student_count, student_id_value
  from public.students s
  where s.auth_user_id = auth.uid() and s.status = 'active';
  if student_count <> 1 then return false; end if;

  select e.organization_id, coalesce(e.academic_term_id, active_term.id)
    into organization_id_value, term_id_value
  from public.elections e
  left join lateral (
    select t.id from public.academic_terms t
    where t.status = 'active'
    order by t.created_at desc, t.id desc limit 1
  ) active_term on true
  where e.id = p_election_id
    and e.status <> 'draft'
    and (e.status <> 'archived' or e.results_released_at is not null);
  if not found or organization_id_value is null or term_id_value is null then return false; end if;

  select coalesce(participation.allowed, false)
    into allowed_value
  from public.resolve_student_organization_participation(
    student_id_value, organization_id_value, term_id_value
  ) participation;
  return coalesce(allowed_value, false);
end;
$function$;

create or replace function private.kandid_board_can_read_candidate_student(
  p_student_id integer
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select auth.uid() is not null and p_student_id is not null and exists (
    select 1
    from public.admin_users a
    join public.candidates c on c.student_id=p_student_id
    join public.positions p on p.id=c.position_id
    join public.elections e on e.id=p.election_id
    where a.auth_user_id=auth.uid() and a.role='electoral_board'
      and a.status='active' and a.organization_id=e.organization_id
      and private.kandid_active_admin_can_access_organization(e.organization_id)
  )
$function$;

revoke all on function private.kandid_active_admin_can_access_organization(bigint) from public, anon, authenticated, service_role;
revoke all on function private.kandid_student_can_read_election(integer) from public, anon, authenticated, service_role;
revoke all on function private.kandid_board_can_read_candidate_student(integer) from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;
grant execute on function private.kandid_active_admin_can_access_organization(bigint) to authenticated;
grant execute on function private.kandid_student_can_read_election(integer) to authenticated;
grant execute on function private.kandid_board_can_read_candidate_student(integer) to authenticated;

-- Public election rows exclude drafts and unreleased archives. Anonymous column
-- grants remain an explicit allow-list, and geofence coordinates are removed
-- from both browser roles. Authorized election managers retrieve those values
-- through the checked RPC below.
do $drop_election_select_policies$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='elections' and cmd='SELECT' loop
    execute format('drop policy %I on public.elections', p.policyname);
  end loop;
end;
$drop_election_select_policies$;
revoke select on table public.elections from public, anon, authenticated;
do $clear_election_column_select$
declare column_name text;
begin
  for column_name in select a.attname from pg_attribute a
    where a.attrelid='public.elections'::regclass and a.attnum>0 and not a.attisdropped loop
    execute format('revoke select (%I) on table public.elections from public, anon, authenticated', column_name);
  end loop;
end;
$clear_election_column_select$;
grant select (id, organization_id, academic_term_id, title, cover_url,
  campaign_start, campaign_end, start_date, end_date, status,
  student_result_visibility, results_released_at, voting_access_mode,
  location_label, created_at) on public.elections to anon;
grant select (id, organization_id, academic_term_id, title, cover_url,
  campaign_start, campaign_end, start_date, end_date, status,
  student_result_visibility, results_released_at, voting_access_mode,
  location_label, created_at, voting_results_visible,
  electorate_policy_version, electorate_frozen_at)
  on public.elections to authenticated;
create policy elections_public_published_read on public.elections for select to anon
  using (status <> 'draft' and (status <> 'archived' or results_released_at is not null));
create policy elections_authenticated_scoped_read on public.elections for select to authenticated
  using (
    private.kandid_active_admin_can_access_organization(organization_id)
    or private.kandid_student_can_read_election(id)
  );

-- Public positions are structural election information. Candidate campaigns
-- and party lists require an eligible authenticated Student or scoped admin.
do $drop_content_select_policies$
declare p record;
begin
  for p in select policyname, tablename from pg_policies
    where schemaname='public' and tablename in ('positions','candidates','partylists') and cmd='SELECT' loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end;
$drop_content_select_policies$;
revoke all privileges on table public.positions, public.candidates, public.partylists from public, anon;
do $clear_public_content_column_acls$
declare table_name text; column_name text;
begin
  foreach table_name in array array['positions','candidates','partylists'] loop
    for column_name in select a.attname from pg_attribute a
      where a.attrelid=format('public.%I',table_name)::regclass and a.attnum>0 and not a.attisdropped loop
      execute format('revoke all privileges (%I) on table public.%I from public, anon', column_name, table_name);
    end loop;
  end loop;
end;
$clear_public_content_column_acls$;
grant select on table public.positions to anon, authenticated;
revoke select on table public.partylists from public, anon, authenticated;
do $clear_partylist_column_select$
declare column_name text;
begin
  for column_name in select a.attname from pg_attribute a
    where a.attrelid='public.partylists'::regclass and a.attnum>0 and not a.attisdropped loop
    execute format('revoke select (%I) on table public.partylists from public, anon, authenticated', column_name);
  end loop;
end;
$clear_partylist_column_select$;
grant select (id, organization_id, election_id, name, description, logo_url)
  on public.partylists to authenticated;

-- Candidate linkage is an internal identifier. Browser roles receive only the
-- fields needed for published campaign content; administrator workflows use
-- the auth.uid()-checked directory RPC below.
revoke select on table public.candidates from public, anon, authenticated;
do $clear_candidate_column_select$
declare column_name text;
begin
  for column_name in select a.attname from pg_attribute a
    where a.attrelid='public.candidates'::regclass and a.attnum>0 and not a.attisdropped loop
    execute format('revoke select (%I) on table public.candidates from public, anon, authenticated', column_name);
  end loop;
end;
$clear_candidate_column_select$;
grant select (id, position_id, partylist_id, photo, bio, platform, credentials,
  campaign_status, campaign_materials, campaign_media_urls)
  on public.candidates to authenticated;

create policy positions_public_published_read on public.positions for select to anon
  using (exists (select 1 from public.elections e where e.id=positions.election_id
    and e.status <> 'draft' and (e.status <> 'archived' or e.results_released_at is not null)));
create policy positions_authenticated_scoped_read on public.positions for select to authenticated
  using (exists (select 1 from public.elections e where e.id=positions.election_id and (
    private.kandid_active_admin_can_access_organization(e.organization_id)
    or private.kandid_student_can_read_election(e.id)
  )));

create policy candidates_authenticated_scoped_read on public.candidates for select to authenticated
  using (
    (position_id is null and private.kandid_active_admin_can_access_organization(null))
    or exists (
      select 1 from public.positions p join public.elections e on e.id=p.election_id
      where p.id=candidates.position_id
        and (private.kandid_active_admin_can_access_organization(e.organization_id)
          or (candidates.campaign_status='published'
            and private.kandid_student_can_read_election(e.id)
            and e.campaign_start is not null and e.campaign_end is not null
            and pg_catalog.timezone('Asia/Manila',pg_catalog.statement_timestamp()) >= e.campaign_start
            and pg_catalog.timezone('Asia/Manila',pg_catalog.statement_timestamp()) < e.campaign_end))
    )
  );

create policy partylists_authenticated_scoped_read on public.partylists for select to authenticated
  using (
    private.kandid_active_admin_can_access_organization(organization_id)
    or exists (
      select 1 from public.elections e
      where e.organization_id=partylists.organization_id
        and (partylists.election_id is null or partylists.election_id=e.id)
        and private.kandid_student_can_read_election(e.id)
        and e.campaign_start is not null and e.campaign_end is not null
        and pg_catalog.timezone('Asia/Manila',pg_catalog.statement_timestamp()) >= e.campaign_start
        and pg_catalog.timezone('Asia/Manila',pg_catalog.statement_timestamp()) < e.campaign_end
        and exists (select 1 from public.candidates c where c.partylist_id=partylists.id and c.campaign_status='published')
    )
  );

-- The duplicate trigger must inspect candidate linkage without granting that
-- identifier to browser roles. Its NOLOGIN owner receives only the columns it
-- needs, and its RLS policies limit rows to the caller's active Board scope (or
-- Super Admin scope). The existing candidate mutation guard remains authoritative.
create role kandid_candidate_duplicate_checker with
  nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
grant usage on schema public to kandid_candidate_duplicate_checker;
grant select (id, organization_id) on public.elections to kandid_candidate_duplicate_checker;
grant select (id, election_id, name) on public.positions to kandid_candidate_duplicate_checker;
grant select (id, student_id, position_id) on public.candidates to kandid_candidate_duplicate_checker;
grant execute on function public.kandid_can_mutate_election_positions(integer)
  to kandid_candidate_duplicate_checker;
grant usage on schema private to kandid_candidate_duplicate_checker;
grant execute on function private.kandid_active_admin_can_access_organization(bigint)
  to kandid_candidate_duplicate_checker;

create policy elections_candidate_duplicate_checker_read
on public.elections for select to kandid_candidate_duplicate_checker
using (private.kandid_active_admin_can_access_organization(organization_id));
create policy positions_candidate_duplicate_checker_read
on public.positions for select to kandid_candidate_duplicate_checker
using (exists (
  select 1 from public.elections e
  where e.id=positions.election_id
    and private.kandid_active_admin_can_access_organization(e.organization_id)
));
create policy candidates_candidate_duplicate_checker_read
on public.candidates for select to kandid_candidate_duplicate_checker
using (
  position_id is not null and exists (
    select 1 from public.positions p join public.elections e on e.id=p.election_id
    where p.id=candidates.position_id
      and private.kandid_active_admin_can_access_organization(e.organization_id)
  )
);

create or replace function public.prevent_duplicate_candidate_per_election()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target_election_id integer;
  duplicate_position text;
begin
  if new.student_id is null or new.position_id is null then
    return new;
  end if;

  select p.election_id into target_election_id
  from public.positions p where p.id=new.position_id;

  -- The checker role's position RLS hides foreign and non-mutable elections.
  -- Leave the final authorization decision to the trusted mutation trigger.
  if target_election_id is null then return new; end if;

  if not public.kandid_can_mutate_election_positions(target_election_id) then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(target_election_id,new.student_id);

  select p.name into duplicate_position
  from public.candidates c
  join public.positions p on p.id=c.position_id
  where c.student_id=new.student_id
    and p.election_id=target_election_id
    and c.id is distinct from new.id
  order by p.id
  limit 1;

  if duplicate_position is not null then
    raise exception 'This student is already a candidate for % in this election.', duplicate_position;
  end if;

  return new;
end;
$function$;
-- Remove direct and PUBLIC execution while the function still has its trusted
-- baseline owner. The restricted checker owner is intentionally not permitted
-- to alter ACLs after the ownership transfer.
revoke all on function public.prevent_duplicate_candidate_per_election() from public, anon, authenticated, service_role;

-- PostgreSQL requires the migration role to be able to SET ROLE to the new
-- owner, and the new owner to hold CREATE on the function schema during the
-- transfer. Keep both capabilities local to this atomic ownership operation.
do $transfer_candidate_checker_ownership$
begin
  execute 'grant create on schema public to kandid_candidate_duplicate_checker';
  execute 'grant kandid_candidate_duplicate_checker to current_user with inherit false, set true';
  execute 'alter function public.prevent_duplicate_candidate_per_election() owner to kandid_candidate_duplicate_checker';
  execute 'revoke create on schema public from kandid_candidate_duplicate_checker';
  execute 'revoke kandid_candidate_duplicate_checker from current_user';

  if exists (
       select 1 from pg_catalog.pg_auth_members m
       where (m.roleid=(select oid from pg_catalog.pg_roles where rolname='kandid_candidate_duplicate_checker')
          or m.member=(select oid from pg_catalog.pg_roles where rolname='kandid_candidate_duplicate_checker'))
         and not (
           -- PostgreSQL 17 gives a non-superuser CREATEROLE role an
           -- unavoidable bootstrap-granted ADMIN-only membership on roles it
           -- creates. It grants neither inheritance nor SET ROLE capability.
           m.roleid=(select oid from pg_catalog.pg_roles where rolname='kandid_candidate_duplicate_checker')
           and exists (select 1 from pg_catalog.pg_roles creator
             where creator.oid=m.member and creator.rolname=current_user
               and creator.rolcreaterole and not creator.rolsuper)
           and m.admin_option and not m.inherit_option and not m.set_option
           and exists (select 1 from pg_catalog.pg_roles g where g.oid=m.grantor and g.rolsuper)
         )
     )
     or pg_catalog.has_schema_privilege('kandid_candidate_duplicate_checker','public','CREATE')
     or (not coalesce((select rolsuper from pg_catalog.pg_roles where rolname=current_user), false)
       and pg_catalog.pg_has_role(current_user,'kandid_candidate_duplicate_checker','SET'))
     or pg_catalog.pg_has_role('anon','kandid_candidate_duplicate_checker','SET')
     or pg_catalog.pg_has_role('authenticated','kandid_candidate_duplicate_checker','SET')
     or pg_catalog.pg_has_role('service_role','kandid_candidate_duplicate_checker','SET') then
    raise exception 'Unexpected candidate-checker membership or effective schema CREATE remains.';
  end if;
end;
$transfer_candidate_checker_ownership$;

do $duplicate_checker_postflight$
declare checker_oid oid;
begin
  select oid into checker_oid from pg_catalog.pg_roles where rolname='kandid_candidate_duplicate_checker'
    and not rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole
    and not rolinherit and not rolreplication and not rolbypassrls;
  if checker_oid is null or exists (
    select 1 from pg_catalog.pg_auth_members m
    where (m.roleid=checker_oid or m.member=checker_oid)
      and not (
        m.roleid=checker_oid
        and exists (select 1 from pg_catalog.pg_roles creator
          where creator.oid=m.member and creator.rolname=current_user
            and creator.rolcreaterole and not creator.rolsuper)
        and m.admin_option and not m.inherit_option and not m.set_option
        and exists (select 1 from pg_catalog.pg_roles g where g.oid=m.grantor and g.rolsuper)
      )
  ) or has_schema_privilege('kandid_candidate_duplicate_checker','public','CREATE')
    or (not coalesce((select rolsuper from pg_catalog.pg_roles where rolname=current_user), false)
      and pg_has_role(current_user,'kandid_candidate_duplicate_checker','SET'))
    or pg_has_role('anon','kandid_candidate_duplicate_checker','SET')
    or pg_has_role('authenticated','kandid_candidate_duplicate_checker','SET')
    or pg_has_role('service_role','kandid_candidate_duplicate_checker','SET') then
    raise exception 'Candidate duplicate-checker role is not isolated.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid='public.prevent_duplicate_candidate_per_election()'::pg_catalog.regprocedure
      and p.proowner=checker_oid and p.prosecdef
      and 'search_path=pg_catalog'=any(coalesce(p.proconfig,array[]::text[]))
  ) then
    raise exception 'Candidate duplicate-checker function security contract differs.';
  end if;
  if has_table_privilege('kandid_candidate_duplicate_checker','public.candidates','SELECT')
     or has_table_privilege('kandid_candidate_duplicate_checker','public.positions','SELECT')
     or has_table_privilege('kandid_candidate_duplicate_checker','public.elections','SELECT')
     or not has_column_privilege('kandid_candidate_duplicate_checker','public.candidates','student_id','SELECT')
     or has_column_privilege('authenticated','public.candidates','student_id','SELECT')
     or has_function_privilege('authenticated','public.prevent_duplicate_candidate_per_election()','EXECUTE')
     or has_function_privilege('anon','public.prevent_duplicate_candidate_per_election()','EXECUTE')
     or has_function_privilege('service_role','public.prevent_duplicate_candidate_per_election()','EXECUTE') then
    raise exception 'Candidate duplicate-checker grants differ from the least-privilege contract.';
  end if;
  if exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid in ('public.elections'::regclass,'public.positions'::regclass,'public.candidates'::regclass)
      and a.attnum>0 and not a.attisdropped
      and pg_catalog.has_column_privilege('kandid_candidate_duplicate_checker',a.attrelid,a.attname,'SELECT')
      and not (
        (a.attrelid='public.elections'::regclass and a.attname in ('id','organization_id'))
        or (a.attrelid='public.positions'::regclass and a.attname in ('id','election_id','name'))
        or (a.attrelid='public.candidates'::regclass and a.attname in ('id','student_id','position_id'))
      )
  ) then
    raise exception 'Candidate duplicate-checker has an unreviewed column grant.';
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname='public' and tablename='positions' and policyname='positions_candidate_duplicate_checker_read')
     or not exists (select 1 from pg_catalog.pg_policies where schemaname='public' and tablename='candidates' and policyname='candidates_candidate_duplicate_checker_read') then
    raise exception 'Candidate duplicate-checker row policies are missing.';
  end if;
end;
$duplicate_checker_postflight$;

create or replace function public.kandid_admin_candidate_directory(
  p_election_ids integer[] default null,
  p_student_ids integer[] default null
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog
as $function$
declare
  caller_uid uuid := auth.uid();
  election_count integer := coalesce(cardinality(p_election_ids), 0);
  student_count integer := coalesce(cardinality(p_student_ids), 0);
begin
  if caller_uid is null or (election_count = 0 and student_count = 0)
     or election_count > 200 or student_count > 200 then
    raise exception using errcode='42501', message='Candidate records are unavailable.';
  end if;
  if not exists (select 1 from public.admin_users a
    where a.auth_user_id=caller_uid and a.status='active'
      and a.role in ('super_admin','electoral_board')) then
    raise exception using errcode='42501', message='Candidate records are unavailable.';
  end if;

  return query
  select jsonb_build_object(
    'id',c.id,
    'student_id',c.student_id,
    'position_id',c.position_id,
    'partylist_id',c.partylist_id,
    'photo',c.photo,
    'bio',c.bio,
    'platform',c.platform,
    'credentials',c.credentials,
    'campaign_status',c.campaign_status,
    'campaign_materials',c.campaign_materials,
    'campaign_media_urls',c.campaign_media_urls,
    'students',case when s.id is null then null else jsonb_build_object(
      'id',s.id,'first_name',s.first_name,'last_name',s.last_name,
      'photo_url',s.photo_url,'program',s.program,'year_level',s.year_level) end,
    'positions',case when p.id is null then null else jsonb_build_object(
      'id',p.id,'name',p.name,'election_id',e.id,
      'elections',case when e.id is null then null else jsonb_build_object(
        'id',e.id,'title',e.title,'organization_id',e.organization_id,
        'organizations',jsonb_build_object('id',o.id,'name',o.name)) end) end,
    'partylists',case when pl.id is null then null else jsonb_build_object('id',pl.id,'name',pl.name) end
  )
  from public.candidates c
  left join public.students s on s.id=c.student_id
  left join public.positions p on p.id=c.position_id
  left join public.elections e on e.id=p.election_id
  left join public.organizations o on o.id=e.organization_id
  left join public.partylists pl on pl.id=c.partylist_id
  where (election_count = 0 or e.id=any(p_election_ids))
    and (student_count = 0 or c.student_id=any(p_student_ids))
    and (
      (e.id is not null and private.kandid_active_admin_can_access_organization(e.organization_id))
      or (c.position_id is null and student_count > 0
        and private.kandid_active_admin_can_access_organization(null))
    )
  order by c.id;
end;
$function$;
revoke all on function public.kandid_admin_candidate_directory(integer[],integer[]) from public,anon,authenticated,service_role;
grant execute on function public.kandid_admin_candidate_directory(integer[],integer[]) to authenticated;

-- The student-safe directory must not disclose every candidate-linked Student.
drop policy if exists students_release_safe_select on public.students;
create policy students_release_safe_select on public.students for select to authenticated
using (
  private.kandid_active_admin_can_access_organization(null)
  or (students.auth_user_id=auth.uid() and students.status='active')
  or private.kandid_board_can_read_candidate_student(students.id)
);

-- Nullable candidate.position_id must not make an arbitrary existing row
-- updateable. Detached rows are assignable only by an active Super Admin;
-- assigned rows still require the trusted election mutation predicate.
drop policy if exists candidates_update_authorized_election on public.candidates;
create policy candidates_update_authorized_election on public.candidates for update to authenticated
using (
  (position_id is not null and exists (select 1 from public.positions p
    where p.id=candidates.position_id and public.kandid_can_mutate_election_positions(p.election_id)))
  or (position_id is null and private.kandid_active_admin_can_access_organization(null))
)
with check (
  (position_id is not null and exists (select 1 from public.positions p
    where p.id=candidates.position_id and public.kandid_can_mutate_election_positions(p.election_id)))
  or (position_id is null and private.kandid_active_admin_can_access_organization(null))
);

create or replace function public.kandid_get_admin_election_geofence(p_election_id integer)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog
as $function$
declare result jsonb; organization_id_value integer;
begin
  select e.organization_id into organization_id_value from public.elections e where e.id=p_election_id;
  if not found or not private.kandid_active_admin_can_access_organization(organization_id_value) then
    raise exception using errcode='42501', message='Election is unavailable.';
  end if;
  select jsonb_build_object('election_id', e.id, 'geo_lat', e.geo_lat,
    'geo_lng', e.geo_lng, 'geo_radius_meters', e.geo_radius_meters)
    into result from public.elections e where e.id=p_election_id;
  return result;
end;
$function$;
revoke all on function public.kandid_get_admin_election_geofence(integer) from public, anon, authenticated, service_role;
grant execute on function public.kandid_get_admin_election_geofence(integer) to authenticated;

-- Public result publication is tied to the explicit release timestamp. The
-- Student endpoint below remains the existing eligibility-checked turnout RPC
-- and keeps its realtime/after_close/manual rules unchanged.
create or replace function public.kandid_get_public_released_election_results(p_election_id integer)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog
as $function$
declare result jsonb;
begin
  if p_election_id is null or p_election_id <= 0 then
    raise exception using errcode='22023', message='Election is unavailable.';
  end if;
  if not exists (select 1 from public.elections e where e.id=p_election_id
    and e.status <> 'draft' and e.results_released_at is not null) then
    raise exception using errcode='42501', message='Election results are unavailable.';
  end if;
  select jsonb_build_object(
    'election', jsonb_build_object('id',e.id,'title',e.title,'organization_id',e.organization_id,
      'results_released_at',e.results_released_at),
    'positions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',p.id,'name',p.name,'display_order',p.display_order,'max_votes',p.max_votes,
        'candidates',coalesce((
          select jsonb_agg(jsonb_build_object(
            'id',c.id,
            'name',nullif(btrim(concat_ws(' ',s.first_name,s.last_name)),''),
            'photo',coalesce(c.photo,s.photo_url),
            'partylist',pl.name,
            'votes',coalesce(t.vote_total,0)
          ) order by coalesce(t.vote_total,0) desc,c.id)
          from public.candidates c
          left join public.students s on s.id=c.student_id
          left join public.partylists pl on pl.id=c.partylist_id
          left join lateral (
            select count(*)::bigint vote_total from public.votes v
            where v.election_id=e.id and v.position_id=p.id
              and v.candidate_id=c.id and v.is_abstain is false
          ) t on true
          where c.position_id=p.id and c.campaign_status='published'
        ),'[]'::jsonb),
        'abstentions',(select count(*)::bigint from public.votes v
          where v.election_id=e.id and v.position_id=p.id and v.is_abstain is true)
      ) order by p.display_order,p.id)
      from public.positions p where p.election_id=e.id
    ),'[]'::jsonb)
  ) into result from public.elections e where e.id=p_election_id;
  return result;
end;
$function$;
revoke all on function public.kandid_get_public_released_election_results(integer) from public, anon, authenticated, service_role;
grant execute on function public.kandid_get_public_released_election_results(integer) to anon, authenticated;

-- Replace the prior campaign RPC, which returned every candidate status, with
-- an explicit published-only contract. The response shape remains compatible
-- with the Student Campaign page; identity is still derived from auth.uid().
do $campaign_preflight$
begin
  if to_regprocedure('public.get_student_campaign(integer)') is null
     or to_regprocedure('private.normalize_student_campaign_materials(jsonb,jsonb)') is null then
    raise exception 'Trusted Student Campaign prerequisites are missing.';
  end if;
end;
$campaign_preflight$;

create or replace function public.kandid_get_student_published_campaign(p_election_id integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog
as $function$
declare
  caller_uid uuid := auth.uid();
  student_count integer;
  student_id_value integer;
  student_status text;
  term_id_value integer;
  election_row record;
  participation_row record;
  now_manila timestamp without time zone;
  position_data jsonb;
  candidate_data jsonb;
  response_data jsonb;
begin
  if caller_uid is null then
    return jsonb_build_object('status','UNAUTHORIZED','reason','AUTHENTICATION_REQUIRED','data',null);
  end if;
  select count(*)::integer,min(s.id) into student_count,student_id_value
    from public.students s where s.auth_user_id=caller_uid;
  if student_count <> 1 then
    return jsonb_build_object('status','UNAUTHORIZED','reason','STUDENT_ACCESS_DENIED','data',null);
  end if;
  select s.status::text into student_status from public.students s
    where s.id=student_id_value and s.auth_user_id=caller_uid;
  if student_status is distinct from 'active' then
    return jsonb_build_object('status','UNAUTHORIZED','reason','STUDENT_ACCESS_DENIED','data',null);
  end if;
  select e.id,e.title,e.cover_url,e.organization_id,e.academic_term_id,e.campaign_start,e.campaign_end,
      e.status::text as election_status,o.name as organization_name,o.logo_url as organization_logo_url
    into election_row from public.elections e
    join public.organizations o on o.id=e.organization_id
    where e.id=p_election_id and e.status='active';
  if not found then
    return jsonb_build_object('status','UNAVAILABLE','reason','ELECTION_NOT_AVAILABLE','data',null);
  end if;
  term_id_value := election_row.academic_term_id;
  if term_id_value is null then
    select t.id into term_id_value from public.academic_terms t
      where t.status='active' order by t.created_at desc,t.id desc limit 1;
  end if;
  if term_id_value is null then
    return jsonb_build_object('status','UNAVAILABLE','reason','ELECTION_NOT_AVAILABLE','data',null);
  end if;
  select participation.* into participation_row
    from public.resolve_student_organization_participation(
      student_id_value,election_row.organization_id,term_id_value
    ) participation;
  if participation_row.allowed is distinct from true then
    return jsonb_build_object('status','UNAVAILABLE','reason','ELECTION_NOT_AVAILABLE','data',null);
  end if;
  if election_row.campaign_start is null or election_row.campaign_end is null then
    return jsonb_build_object('status','UNAVAILABLE','reason','CAMPAIGN_SCHEDULE_MISSING','data',null);
  end if;
  now_manila := timezone('Asia/Manila',clock_timestamp());
  if now_manila < election_row.campaign_start then
    return jsonb_build_object('status','UNAVAILABLE','reason','CAMPAIGN_NOT_STARTED','data',null);
  end if;
  if now_manila >= election_row.campaign_end then
    return jsonb_build_object('status','UNAVAILABLE','reason','CAMPAIGN_ENDED','data',null);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id',p.id,'name',p.name,'display_order',p.display_order,'max_votes',p.max_votes
    ) order by p.display_order,p.id),'[]'::jsonb)
    into position_data from public.positions p
    where p.election_id=election_row.id and p.status='active';

  select coalesce(jsonb_agg(jsonb_build_object(
      'id',c.id,
      'display_name',coalesce(nullif(concat_ws(' ',nullif(btrim(s.first_name),''),nullif(btrim(s.last_name),'')),''),'Candidate'),
      'photo_url',coalesce(c.photo,s.photo_url),
      'position_id',c.position_id,
      'partylist',case when pl.id is null then jsonb_build_object('id',null,'name','Independent','logo_url',null)
        else jsonb_build_object('id',pl.id,'name',pl.name,'logo_url',pl.logo_url) end,
      'bio',c.bio,'platform',c.platform,'credentials',c.credentials,
      'campaign_materials',private.normalize_student_campaign_materials(c.campaign_materials,c.campaign_media_urls)
    ) order by p.display_order,p.id,lower(coalesce(pl.name,'Independent')) collate "C",
      lower(coalesce(concat_ws(' ',s.first_name,s.last_name),'Candidate')) collate "C",c.id),'[]'::jsonb)
    into candidate_data
    from public.candidates c
    join public.positions p on p.id=c.position_id and p.election_id=election_row.id and p.status='active'
    join public.students s on s.id=c.student_id
    left join public.partylists pl on pl.id=c.partylist_id
      and pl.organization_id=election_row.organization_id
      and (pl.election_id is null or pl.election_id=election_row.id)
    where c.campaign_status='published';

  response_data := jsonb_build_object(
    'election',jsonb_build_object('id',election_row.id,'title',election_row.title,
      'cover_url',election_row.cover_url,'campaign_start',election_row.campaign_start,
      'campaign_end',election_row.campaign_end),
    'organization',jsonb_build_object('id',election_row.organization_id,
      'name',election_row.organization_name,'logo_url',election_row.organization_logo_url),
    'positions',position_data,'candidates',candidate_data
  );
  if jsonb_array_length(candidate_data)=0 then
    return jsonb_build_object('status','EMPTY','reason','NO_CANDIDATES','data',response_data);
  end if;
  return jsonb_build_object('status','AVAILABLE','reason',null,'data',response_data);
end;
$function$;

revoke all on function public.get_student_campaign(integer) from public,anon,authenticated,service_role;
revoke all on function public.kandid_get_student_published_campaign(integer) from public,anon,authenticated,service_role;
grant execute on function public.kandid_get_student_published_campaign(integer) to authenticated;

-- Ballot choice names are returned through an eligible-Student contract so
-- kiosk/ballot clients do not need SELECT on candidates.student_id for an FK
-- embed. The response contains no candidate-to-Student identifier.
create or replace function public.kandid_get_student_ballot_candidates(p_election_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog
as $function$
declare
  caller_uid uuid := auth.uid();
  student_count integer;
  student_id_value integer;
  election_row record;
  allowed_value boolean := false;
  result jsonb;
begin
  if caller_uid is null or p_election_id is null or p_election_id <= 0 then
    raise exception using errcode='28000', message='Eligible Student authentication is required.';
  end if;
  select count(*)::integer, min(s.id) into student_count, student_id_value
    from public.students s where s.auth_user_id=caller_uid and s.status='active';
  if student_count <> 1 then
    raise exception using errcode='42501', message='Ballot choices are unavailable.';
  end if;
  select e.id,e.organization_id,coalesce(e.academic_term_id,t.id) as term_id,e.status::text
    into election_row
  from public.elections e
  left join lateral (select at.id from public.academic_terms at where at.status='active'
    order by at.created_at desc,at.id desc limit 1) t on true
  where e.id=p_election_id and e.status='active';
  if not found or election_row.term_id is null then
    raise exception using errcode='42501', message='Ballot choices are unavailable.';
  end if;
  select coalesce(participation.allowed,false) into allowed_value
    from public.resolve_student_organization_participation(
      student_id_value,election_row.organization_id,election_row.term_id
    ) participation;
  if not coalesce(allowed_value,false) then
    raise exception using errcode='42501', message='Ballot choices are unavailable.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'position_id',c.position_id,'photo',c.photo,
    'students',jsonb_build_object('first_name',s.first_name,'last_name',s.last_name,'photo_url',s.photo_url),
    'partylists',case when pl.id is null then null else jsonb_build_object('name',pl.name,'logo_url',pl.logo_url) end
  ) order by p.display_order,p.id,c.id),'[]'::jsonb)
  into result
  from public.positions p
  join public.candidates c on c.position_id=p.id and c.campaign_status='published'
  join public.students s on s.id=c.student_id
  left join public.partylists pl on pl.id=c.partylist_id
    and pl.organization_id=election_row.organization_id
    and (pl.election_id is null or pl.election_id=election_row.id)
  where p.election_id=election_row.id and p.status='active';
  return result;
end;
$function$;
revoke all on function public.kandid_get_student_ballot_candidates(integer) from public,anon,authenticated,service_role;
grant execute on function public.kandid_get_student_ballot_candidates(integer) to authenticated;

-- Result cards need candidate display fields but not the underlying Student
-- foreign key. The existing turnout RPC remains the source of Student result
-- timing, eligibility, and participation authorization.
create or replace function public.kandid_get_student_result_candidates(p_election_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog
as $function$
declare
  caller_uid uuid := auth.uid();
  student_count integer;
  result jsonb;
begin
  if caller_uid is null or p_election_id is null or p_election_id <= 0 then
    raise exception using errcode='28000', message='Eligible Student authentication is required.';
  end if;
  select count(*)::integer into student_count from public.students s
    where s.auth_user_id=caller_uid and s.status='active';
  if student_count <> 1 then
    raise exception using errcode='42501', message='Election results are unavailable.';
  end if;

  perform public.kandid_get_election_turnout(p_election_id);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'photo',c.photo,'position_id',c.position_id,
    'students',jsonb_build_object('first_name',s.first_name,'last_name',s.last_name,
      'photo_url',s.photo_url,'program',s.program,'year_level',s.year_level),
    'partylists',case when pl.id is null then null else jsonb_build_object('id',pl.id,'name',pl.name) end
  ) order by p.display_order,p.id,c.id),'[]'::jsonb)
  into result
  from public.candidates c
  join public.positions p on p.id=c.position_id and p.election_id=p_election_id
  join public.students s on s.id=c.student_id
  left join public.partylists pl on pl.id=c.partylist_id
  where c.campaign_status='published';
  return result;
end;
$function$;
revoke all on function public.kandid_get_student_result_candidates(integer) from public,anon,authenticated,service_role;
grant execute on function public.kandid_get_student_result_candidates(integer) to authenticated;

-- This replacement deliberately contains aggregate status only; voter identity,
-- timestamps, ballot IDs, and per-ballot rows are not returned to Board clients.
create or replace function public.kandid_get_board_voting_monitor(
  p_election_id integer default null, p_offset integer default 0, p_limit integer default 50
)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog
as $function$
declare
  caller_uid uuid := auth.uid(); organization_id_value bigint; assignment_count integer; result jsonb;
begin
  if caller_uid is null then raise exception using errcode='28000', message='Authentication required.'; end if;
  if p_offset is null or p_offset < 0 or p_offset > 1000000 or p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode='22023', message='Valid monitor pagination is required.';
  end if;
  select count(distinct a.organization_id)::integer, min(a.organization_id)
    into assignment_count, organization_id_value from public.admin_users a
    where a.auth_user_id=caller_uid and a.role='electoral_board' and a.status='active' and a.organization_id is not null;
  if assignment_count <> 1 or organization_id_value is null then
    raise exception using errcode='42501', message='Active Electoral Board organization authorization required.';
  end if;
  if p_election_id is not null and not exists (select 1 from public.elections e where e.id=p_election_id and e.organization_id=organization_id_value) then
    raise exception using errcode='42501', message='Election is unavailable.';
  end if;
  with scoped as (
    select b.student_id, b.election_id, b.blockchain_anchor_status
    from public.vote_ballots b join public.elections e on e.id=b.election_id
    where e.organization_id=organization_id_value and (p_election_id is null or b.election_id=p_election_id)
  ), summary as (
    select count(*)::integer ballots_submitted, count(distinct student_id)::integer students_voted,
      count(*) filter(where blockchain_anchor_status='anchored')::integer anchored,
      count(*) filter(where blockchain_anchor_status in ('pending','anchoring','submitted'))::integer processing,
      count(*) filter(where blockchain_anchor_status in ('anchor_failed','manual_review'))::integer needs_attention
    from scoped
  )
  select jsonb_build_object(
    'elections', coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'title',e.title) order by e.created_at desc,e.id desc)
      from public.elections e where e.organization_id=organization_id_value), '[]'::jsonb),
    'summary', jsonb_build_object('ballots_submitted',summary.ballots_submitted,'students_voted',summary.students_voted,
      'anchored',summary.anchored,'processing',summary.processing,'needs_attention',summary.needs_attention),
    'page', jsonb_build_object('offset',0,'limit',0,'has_more',false), 'ballots','[]'::jsonb
  ) into result from summary;
  return result;
end;
$function$;
revoke all on function public.kandid_get_board_voting_monitor(integer,integer,integer) from public, anon, authenticated, service_role;
grant execute on function public.kandid_get_board_voting_monitor(integer,integer,integer) to authenticated;

do $postflight$
begin
  if exists (
    select 1 from pg_attribute a
    where a.attrelid='public.elections'::regclass and a.attnum>0 and not a.attisdropped
      and pg_catalog.has_column_privilege('anon',a.attrelid,a.attname,'SELECT')
      and a.attname not in ('id','organization_id','academic_term_id','title','cover_url',
        'campaign_start','campaign_end','start_date','end_date','status',
        'student_result_visibility','results_released_at','voting_access_mode','location_label','created_at')
  ) or exists (
    select 1 from pg_attribute a
    where a.attrelid='public.elections'::regclass and a.attnum>0 and not a.attisdropped
      and pg_catalog.has_column_privilege('authenticated',a.attrelid,a.attname,'SELECT')
      and a.attname not in ('id','organization_id','academic_term_id','title','cover_url',
        'campaign_start','campaign_end','start_date','end_date','status',
        'student_result_visibility','results_released_at','voting_access_mode','location_label','created_at',
        'voting_results_visible','electorate_policy_version','electorate_frozen_at')
  ) then
    raise exception 'An unreviewed election column has browser SELECT access.';
  end if;
  if has_column_privilege('anon','public.elections','geo_lat','SELECT')
     or has_column_privilege('anon','public.elections','geo_lng','SELECT')
     or has_column_privilege('anon','public.elections','geo_radius_meters','SELECT')
     or has_column_privilege('authenticated','public.elections','geo_lat','SELECT')
     or has_column_privilege('authenticated','public.elections','geo_lng','SELECT')
     or has_column_privilege('authenticated','public.elections','geo_radius_meters','SELECT')
     or has_column_privilege('anon','public.elections','results_released_by','SELECT')
     or has_column_privilege('authenticated','public.elections','results_released_by','SELECT')
     or has_column_privilege('anon','public.elections','electorate_frozen_by','SELECT')
     or has_column_privilege('authenticated','public.elections','electorate_frozen_by','SELECT')
     or has_table_privilege('anon','public.candidates','SELECT')
     or has_table_privilege('anon','public.partylists','SELECT') then
    raise exception 'Sensitive election or campaign read grants remain.';
  end if;
  if has_column_privilege('authenticated','public.candidates','student_id','SELECT')
     or has_column_privilege('anon','public.candidates','student_id','SELECT')
     or pg_catalog.has_function_privilege('anon','public.kandid_admin_candidate_directory(integer[],integer[])','EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated','public.kandid_admin_candidate_directory(integer[],integer[])','EXECUTE')
     or pg_catalog.has_function_privilege('anon','public.kandid_get_student_ballot_candidates(integer)','EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated','public.kandid_get_student_ballot_candidates(integer)','EXECUTE') then
    raise exception 'Candidate identity column or RPC execution grants differ from the reviewed contract.';
  end if;
  if pg_catalog.has_function_privilege('anon','public.kandid_get_student_result_candidates(integer)','EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated','public.kandid_get_student_result_candidates(integer)','EXECUTE') then
    raise exception 'Student result candidate RPC grants differ from the reviewed contract.';
  end if;
  if has_table_privilege('anon','public.partylists','SELECT')
     or has_table_privilege('authenticated','public.partylists','SELECT')
     or exists (select 1 from pg_attribute a
       where a.attrelid='public.partylists'::regclass and a.attnum>0 and not a.attisdropped
         and has_column_privilege('authenticated',a.attrelid,a.attname,'SELECT')
         and a.attname not in ('id','organization_id','election_id','name','description','logo_url')) then
    raise exception 'Partylist browser SELECT grants differ from the reviewed column projection.';
  end if;
  if pg_catalog.has_function_privilege('anon','private.kandid_board_can_read_candidate_student(integer)','EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated','private.kandid_board_can_read_candidate_student(integer)','EXECUTE') then
    raise exception 'Board candidate-Student visibility helper grants differ from the reviewed contract.';
  end if;
  if exists (select 1 from pg_attribute a where a.attrelid='public.partylists'::regclass
      and a.attnum>0 and not a.attisdropped
      and pg_catalog.has_column_privilege('anon',a.attrelid,a.attname,'SELECT'))
     or exists (select 1 from pg_attribute a where a.attrelid='public.candidates'::regclass
      and a.attnum>0 and not a.attisdropped
      and pg_catalog.has_column_privilege('anon',a.attrelid,a.attname,'SELECT'))
     or exists (select 1 from pg_attribute a where a.attrelid='public.candidates'::regclass
      and a.attnum>0 and not a.attisdropped
      and pg_catalog.has_column_privilege('authenticated',a.attrelid,a.attname,'SELECT')
      and a.attname not in ('id','position_id','partylist_id','photo','bio','platform','credentials',
        'campaign_status','campaign_materials','campaign_media_urls')) then
    raise exception 'Campaign browser column grants differ from the reviewed projection.';
  end if;
  if pg_catalog.has_function_privilege('anon','public.kandid_get_admin_election_geofence(integer)','EXECUTE')
     or pg_catalog.has_function_privilege('anon','public.kandid_get_student_published_campaign(integer)','EXECUTE')
     or pg_catalog.has_function_privilege('anon','public.kandid_get_board_voting_monitor(integer,integer,integer)','EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated','public.kandid_get_admin_election_geofence(integer)','EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated','public.kandid_get_student_published_campaign(integer)','EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated','public.kandid_get_board_voting_monitor(integer,integer,integer)','EXECUTE')
     or not pg_catalog.has_function_privilege('anon','public.kandid_get_public_released_election_results(integer)','EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated','public.kandid_get_public_released_election_results(integer)','EXECUTE')
     or pg_catalog.has_function_privilege('service_role','public.kandid_admin_candidate_directory(integer[],integer[])','EXECUTE')
     or pg_catalog.has_function_privilege('service_role','public.kandid_get_admin_election_geofence(integer)','EXECUTE')
     or pg_catalog.has_function_privilege('service_role','public.kandid_get_student_published_campaign(integer)','EXECUTE')
     or pg_catalog.has_function_privilege('service_role','public.kandid_get_student_ballot_candidates(integer)','EXECUTE')
     or pg_catalog.has_function_privilege('service_role','public.kandid_get_student_result_candidates(integer)','EXECUTE')
     or pg_catalog.has_function_privilege('service_role','public.kandid_get_board_voting_monitor(integer,integer,integer)','EXECUTE') then
    raise exception 'Scoped KANDID RPC execution grants differ from the reviewed actor matrix.';
  end if;
  if exists (
    select 1 from (values
      (pg_catalog.to_regprocedure('public.kandid_admin_candidate_directory(integer[],integer[])')),
      (pg_catalog.to_regprocedure('public.kandid_get_admin_election_geofence(integer)')),
      (pg_catalog.to_regprocedure('public.kandid_get_public_released_election_results(integer)')),
      (pg_catalog.to_regprocedure('public.kandid_get_student_published_campaign(integer)')),
      (pg_catalog.to_regprocedure('public.kandid_get_student_ballot_candidates(integer)')),
      (pg_catalog.to_regprocedure('public.kandid_get_student_result_candidates(integer)')),
      (pg_catalog.to_regprocedure('public.kandid_get_board_voting_monitor(integer,integer,integer)'))
    ) functions(oid)
    where functions.oid is null
       or not (select p.prosecdef
          and p.proowner=(select r.oid from pg_catalog.pg_roles r where r.rolname='postgres')
          and 'search_path=pg_catalog'=any(coalesce(p.proconfig,array[]::text[]))
          from pg_catalog.pg_proc p where p.oid=functions.oid)
  ) then
    raise exception 'Candidate privacy RPC security-definer configuration differs from the reviewed contract.';
  end if;
  if exists (
    select 1 from (values
      (pg_catalog.to_regprocedure('private.kandid_active_admin_can_access_organization(bigint)')),
      (pg_catalog.to_regprocedure('private.kandid_student_can_read_election(integer)')),
      (pg_catalog.to_regprocedure('private.kandid_board_can_read_candidate_student(integer)'))
    ) functions(oid)
    where functions.oid is null
       or not (select p.prosecdef
          and p.proowner=(select r.oid from pg_catalog.pg_roles r where r.rolname='postgres')
          and 'search_path=pg_catalog'=any(coalesce(p.proconfig,array[]::text[]))
         from pg_catalog.pg_proc p where p.oid=functions.oid)
  ) then
    raise exception 'Authorization helper SECURITY DEFINER configuration differs from the reviewed contract.';
  end if;
end;
$postflight$;

notify pgrst, 'reload schema';
commit;
