-- Candidate campaign privacy boundary.
--
-- Candidate drafts remain visible to authenticated, organization-scoped
-- administrators through the existing candidate directory contract. Browser
-- table reads are limited to the id/position columns needed by existing
-- admin mutation/count flows; students receive candidate data only through
-- the authenticated, phase-specific RPCs below. Anonymous candidate reads are
-- removed entirely because no current public route consumes that contract.
begin;

do $privacy_preflight$
declare
  candidate_rls boolean;
  admin_directory record;
  campaign_normalizer record;
  result_turnout record;
begin
  if to_regclass('public.candidates') is null
     or to_regclass('public.positions') is null
     or to_regclass('public.elections') is null
     or to_regclass('public.students') is null
     or to_regclass('public.partylists') is null
     or to_regclass('public.admin_users') is null
     or to_regclass('public.academic_terms') is null
     or to_regclass('public.student_term_enrollments') is null
     or to_regclass('public.student_organization_terms') is null
     or to_regclass('private.election_eligible_voters') is null
     or to_regprocedure('private.normalize_student_campaign_materials(jsonb,jsonb)') is null
     or to_regprocedure('public.resolve_student_organization_participation(integer,integer,integer)') is null
     or to_regprocedure('public.kandid_get_election_turnout(integer)') is null
     or to_regprocedure('public.kandid_admin_candidate_directory(integer[],integer[])') is null
     or to_regprocedure('public.get_student_campaign(integer)') is null then
    raise exception 'Candidate privacy dependencies are missing; no changes were applied';
  end if;

  select c.relrowsecurity into candidate_rls
  from pg_catalog.pg_class c
  where c.oid = 'public.candidates'::regclass;
  if candidate_rls is distinct from true then
    raise exception 'Candidate RLS must already be enabled';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policy p
    where p.polrelid = 'public.candidates'::regclass
      and p.polname = 'candidates_public_read'
      and p.polcmd = 'r'
      and pg_catalog.pg_get_expr(p.polqual, p.polrelid) = 'true'
      and p.polroles @> array['anon'::regrole::oid, 'authenticated'::regrole::oid]
  ) or exists (
    select 1 from pg_catalog.pg_policy p
    where p.polrelid = 'public.candidates'::regclass
      and p.polcmd = 'r'
      and p.polname <> 'candidates_public_read'
  ) then
    raise exception 'Candidate SELECT policy state differs from the reviewed production baseline';
  end if;

  if (select count(*) from pg_catalog.pg_policy p
      where p.polrelid = 'public.candidates'::regclass
        and p.polcmd in ('a','w','d')
        and p.polname in (
          'candidates_insert_authorized_election',
          'candidates_update_authorized_election',
          'candidates_delete_authorized_election'
        )) <> 3 then
    raise exception 'Existing candidate write policies differ from the reviewed baseline';
  end if;

  select p.proowner, p.prosecdef, p.proconfig
  into admin_directory
  from pg_catalog.pg_proc p
  where p.oid = 'public.kandid_admin_candidate_directory(integer[],integer[])'::regprocedure;
  if pg_catalog.pg_get_userbyid(admin_directory.proowner) <> 'postgres'
     or admin_directory.prosecdef is distinct from true
     or admin_directory.proconfig is distinct from array['search_path=pg_catalog']::text[]
     or not pg_catalog.has_function_privilege(
       'authenticated',
       'public.kandid_admin_candidate_directory(integer[],integer[])',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.kandid_admin_candidate_directory(integer[],integer[])',
       'EXECUTE'
     ) then
    raise exception 'The scoped administrator candidate directory security contract has drifted';
  end if;

  select p.proowner, p.prosecdef, p.proconfig, p.provolatile
  into campaign_normalizer
  from pg_catalog.pg_proc p
  where p.oid = 'private.normalize_student_campaign_materials(jsonb,jsonb)'::regprocedure;
  if pg_catalog.pg_get_userbyid(campaign_normalizer.proowner) <> 'postgres'
     or campaign_normalizer.prosecdef is distinct from false
     or campaign_normalizer.provolatile <> 'i'
     or campaign_normalizer.proconfig is distinct from array['search_path=pg_catalog']::text[] then
    raise exception 'The trusted campaign material normalizer security contract has drifted';
  end if;

  select p.proowner, p.prosecdef, p.proconfig
  into result_turnout
  from pg_catalog.pg_proc p
  where p.oid = 'public.kandid_get_election_turnout(integer)'::regprocedure;
  if pg_catalog.pg_get_userbyid(result_turnout.proowner) <> 'postgres'
     or result_turnout.prosecdef is distinct from true
     or result_turnout.proconfig is distinct from array['search_path=pg_catalog']::text[]
     or not pg_catalog.has_function_privilege(
       'authenticated', 'public.kandid_get_election_turnout(integer)', 'EXECUTE'
     ) then
    raise exception 'The existing result-visibility gate is not in its reviewed state';
  end if;

  if to_regprocedure('public.kandid_can_admin_read_candidate_v1(integer)') is not null
     or to_regprocedure('public.kandid_get_student_published_campaign(integer)') is not null
     or to_regprocedure('public.kandid_get_student_ballot_candidates(integer)') is not null
     or to_regprocedure('public.kandid_get_student_result_candidates(integer)') is not null then
    raise exception 'A candidate privacy function already exists; inspect before applying this migration';
  end if;

  if not exists (select 1 from pg_catalog.pg_attribute where attrelid='public.elections'::regclass and attname='removed_at' and atttypid='timestamptz'::regtype and attnum>0 and not attisdropped)
     or not exists (select 1 from pg_catalog.pg_attribute where attrelid='public.elections'::regclass and attname='academic_term_id' and atttypid='integer'::regtype and attnum>0 and not attisdropped)
     or not exists (select 1 from pg_catalog.pg_attribute where attrelid='public.candidates'::regclass and attname='campaign_status' and attnum>0 and not attisdropped)
     or not exists (select 1 from pg_catalog.pg_attribute where attrelid='public.candidates'::regclass and attname='campaign_materials' and atttypid='jsonb'::regtype and attnum>0 and not attisdropped)
     or not exists (select 1 from pg_catalog.pg_attribute where attrelid='public.candidates'::regclass and attname='campaign_media_urls' and atttypid='jsonb'::regtype and attnum>0 and not attisdropped)
     or not exists (select 1 from pg_catalog.pg_attribute where attrelid='private.election_eligible_voters'::regclass and attname='student_id' and atttypid='integer'::regtype and attnum>0 and not attisdropped)
     or not exists (select 1 from pg_catalog.pg_attribute where attrelid='private.election_eligible_voters'::regclass and attname='election_id' and atttypid='integer'::regtype and attnum>0 and not attisdropped) then
    raise exception 'Candidate campaign or frozen-electorate schema differs from the reviewed PostgreSQL 17 baseline';
  end if;

  if to_regprocedure('public.kandid_can_mutate_election_positions(integer)') is null
     or not pg_catalog.has_function_privilege(
       'authenticated', 'public.kandid_can_mutate_election_positions(integer)', 'EXECUTE'
     ) then
    raise exception 'Existing candidate mutation authorization is unavailable';
  end if;
end;
$privacy_preflight$;

-- Boolean row authorization is the only exposed helper. It derives Board
-- scope from the authenticated admin_users row and reveals no candidate data.
create function public.kandid_can_admin_read_candidate_v1(p_candidate_id integer)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  caller_uid uuid := auth.uid();
  admin_count integer;
  admin_role text;
  admin_organization_id integer;
begin
  if caller_uid is null or p_candidate_id is null or p_candidate_id <= 0 then
    return false;
  end if;

  select pg_catalog.count(*)::integer,
         pg_catalog.min(a.role),
         pg_catalog.min(a.organization_id)
  into admin_count, admin_role, admin_organization_id
  from public.admin_users a
  where a.auth_user_id = caller_uid
    and a.status = 'active';

  if admin_count <> 1 or admin_role not in ('electoral_board', 'super_admin') then
    return false;
  end if;

  if admin_role = 'super_admin' then
    return exists (
      select 1 from public.candidates c where c.id = p_candidate_id
    );
  end if;

  if admin_organization_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.candidates c
    join public.positions p on p.id = c.position_id
    join public.elections e on e.id = p.election_id
    where c.id = p_candidate_id
      and e.organization_id = admin_organization_id
  );
end;
$function$;

alter function public.kandid_can_admin_read_candidate_v1(integer) owner to postgres;
revoke all on function public.kandid_can_admin_read_candidate_v1(integer) from public, anon, authenticated, service_role;
grant execute on function public.kandid_can_admin_read_candidate_v1(integer) to authenticated;

drop policy candidates_public_read on public.candidates;
create policy candidates_authenticated_admin_read
on public.candidates for select to authenticated
using (public.kandid_can_admin_read_candidate_v1(id));

-- Remove both table-level and per-column anonymous/student read grants. Keep
-- only the two columns existing admin mutation/count requests require. Full
-- admin records remain available via the already-scoped directory RPC.
revoke select on table public.candidates from public, anon, authenticated;
do $candidate_column_privilege_revoke$
declare
  candidate_column text;
begin
  for candidate_column in
    select a.attname
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.candidates'::regclass
      and a.attnum > 0
      and not a.attisdropped
  loop
    execute pg_catalog.format(
      'revoke select (%I) on table public.candidates from public, anon, authenticated',
      candidate_column
    );
  end loop;
end;
$candidate_column_privilege_revoke$;
grant select (id, position_id) on public.candidates to authenticated;

-- The Student Campaign API returns data only during the half-open campaign
-- interval [campaign_start,campaign_end). Upcoming, ended, closed, removed,
-- historical and ineligible elections return no candidate/material payload.
create function public.kandid_get_student_published_campaign(p_election_id integer)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_uid uuid := auth.uid();
  student_count integer;
  student_id_value integer;
  student_status text;
  term_id_value integer;
  active_term_count integer;
  election_row record;
  participation_row record;
  manila_now timestamp without time zone;
  position_data jsonb;
  candidate_data jsonb;
  response_data jsonb;
begin
  if caller_uid is null then
    return pg_catalog.jsonb_build_object('status','UNAUTHORIZED','reason','AUTHENTICATION_REQUIRED','data',null);
  end if;

  select pg_catalog.count(*)::integer, pg_catalog.min(s.id)
    into student_count, student_id_value
    from public.students s where s.auth_user_id = caller_uid;
  if student_count <> 1 then
    return pg_catalog.jsonb_build_object('status','UNAUTHORIZED','reason','STUDENT_ACCESS_DENIED','data',null);
  end if;

  select s.status::text into student_status
  from public.students s where s.id = student_id_value and s.auth_user_id = caller_uid;
  if student_status is distinct from 'active' then
    return pg_catalog.jsonb_build_object('status','UNAUTHORIZED','reason','STUDENT_ACCESS_DENIED','data',null);
  end if;

  if p_election_id is null or p_election_id <= 0 then
    return pg_catalog.jsonb_build_object('status','UNAVAILABLE','reason','ELECTION_NOT_AVAILABLE','data',null);
  end if;

  select e.id, e.title, e.cover_url, e.organization_id, e.academic_term_id,
         e.campaign_start, e.campaign_end, e.status::text as election_status,
         e.removed_at, o.name as organization_name, o.logo_url as organization_logo_url
    into election_row
  from public.elections e
  join public.organizations o on o.id = e.organization_id
  where e.id = p_election_id
    and e.status = 'active'
    and e.removed_at is null;
  if not found then
    return pg_catalog.jsonb_build_object('status','UNAVAILABLE','reason','ELECTION_NOT_AVAILABLE','data',null);
  end if;

  select pg_catalog.count(*)::integer, pg_catalog.min(t.id)
    into active_term_count, term_id_value
  from public.academic_terms t where t.status = 'active';
  if active_term_count <> 1
     or (election_row.academic_term_id is not null
         and election_row.academic_term_id is distinct from term_id_value) then
    return pg_catalog.jsonb_build_object('status','UNAVAILABLE','reason','ELECTION_NOT_AVAILABLE','data',null);
  end if;

  select participation.* into participation_row
  from public.resolve_student_organization_participation(
    student_id_value, election_row.organization_id, term_id_value
  ) participation;
  if participation_row.allowed is distinct from true then
    return pg_catalog.jsonb_build_object('status','UNAVAILABLE','reason','ELECTION_NOT_AVAILABLE','data',null);
  end if;

  if election_row.campaign_start is null or election_row.campaign_end is null then
    return pg_catalog.jsonb_build_object('status','UNAVAILABLE','reason','CAMPAIGN_SCHEDULE_MISSING','data',null);
  end if;
  manila_now := pg_catalog.timezone('Asia/Manila', pg_catalog.statement_timestamp());
  if manila_now < election_row.campaign_start then
    return pg_catalog.jsonb_build_object('status','UNAVAILABLE','reason','CAMPAIGN_NOT_STARTED','data',null);
  end if;
  if manila_now >= election_row.campaign_end then
    return pg_catalog.jsonb_build_object('status','UNAVAILABLE','reason','CAMPAIGN_ENDED','data',null);
  end if;

  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object('id',p.id,'name',p.name,'display_order',p.display_order,'max_votes',p.max_votes)
    order by p.display_order,p.id
  ), '[]'::jsonb)
  into position_data
  from public.positions p
  where p.election_id = election_row.id and p.status = 'active';

  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id',c.id,
      'display_name',coalesce(nullif(pg_catalog.concat_ws(' ',nullif(pg_catalog.btrim(s.first_name),''),nullif(pg_catalog.btrim(s.last_name),'')),''),'Candidate'),
      'photo_url',coalesce(c.photo,s.photo_url),
      'position_id',c.position_id,
      'partylist',case when pl.id is null
        then pg_catalog.jsonb_build_object('id',null,'name','Independent','logo_url',null)
        else pg_catalog.jsonb_build_object('id',pl.id,'name',pl.name,'logo_url',pl.logo_url) end,
      'bio',c.bio,
      'platform',c.platform,
      'credentials',c.credentials,
      'campaign_materials',private.normalize_student_campaign_materials(c.campaign_materials,c.campaign_media_urls)
    )
    order by p.display_order,p.id,pg_catalog.lower(coalesce(pl.name,'Independent')) collate "C",
      pg_catalog.lower(pg_catalog.concat_ws(' ',s.first_name,s.last_name)) collate "C",c.id
  ), '[]'::jsonb)
  into candidate_data
  from public.candidates c
  join public.positions p on p.id = c.position_id
    and p.election_id = election_row.id and p.status = 'active'
  join public.students s on s.id = c.student_id
  left join public.partylists pl on pl.id = c.partylist_id
    and pl.organization_id = election_row.organization_id
    and (pl.election_id is null or pl.election_id = election_row.id)
  where c.campaign_status = 'published';

  response_data := pg_catalog.jsonb_build_object(
    'election',pg_catalog.jsonb_build_object('id',election_row.id,'title',election_row.title,
      'cover_url',election_row.cover_url,'campaign_start',election_row.campaign_start,'campaign_end',election_row.campaign_end),
    'organization',pg_catalog.jsonb_build_object('id',election_row.organization_id,
      'name',election_row.organization_name,'logo_url',election_row.organization_logo_url),
    'positions',position_data,
    'candidates',candidate_data
  );
  if pg_catalog.jsonb_array_length(candidate_data) = 0 then
    return pg_catalog.jsonb_build_object('status','EMPTY','reason','NO_CANDIDATES','data',response_data);
  end if;
  return pg_catalog.jsonb_build_object('status','AVAILABLE','reason',null,'data',response_data);
end;
$function$;
alter function public.kandid_get_student_published_campaign(integer) owner to postgres;
revoke all on function public.kandid_get_student_published_campaign(integer) from public, anon, authenticated, service_role;
grant execute on function public.kandid_get_student_published_campaign(integer) to authenticated;

-- Keep the old RPC name for compatibility, but route it through exactly the
-- same authenticated, published-only implementation. This also secures the
-- student branch of the already-reviewed Storage policy without editing its
-- frozen migration.
create or replace function public.get_student_campaign(p_election_id integer)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $function$
  select public.kandid_get_student_published_campaign(p_election_id)
$function$;
alter function public.get_student_campaign(integer) owner to postgres;
revoke all on function public.get_student_campaign(integer) from public, anon, authenticated, service_role;
grant execute on function public.get_student_campaign(integer) to authenticated;

-- Ballot identities are available only to the authenticated active Student
-- during the voting half-open interval. Campaign publication status does not
-- determine whether a registered candidate is ballot-eligible; candidate
-- identity remains visible to eligible voters as before, while bio/platform/
-- credentials/material references stay in the published campaign RPC only.
-- Frozen elections must pass the same
-- active-term enrollment, canonical participation and frozen-electorate tests
-- used by submit-vote. Legacy policy-0 elections retain live participation.
create function public.kandid_get_student_ballot_candidates(p_election_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  caller_uid uuid := auth.uid();
  student_count integer;
  student_id_value integer;
  active_term_count integer;
  term_id_value integer;
  election_row record;
  participation_allowed boolean := false;
  manila_now timestamp without time zone;
  candidate_data jsonb;
begin
  if caller_uid is null or p_election_id is null or p_election_id <= 0 then
    raise exception using errcode='28000', message='Eligible Student authentication is required.';
  end if;
  select pg_catalog.count(*)::integer,pg_catalog.min(s.id)
    into student_count,student_id_value
    from public.students s where s.auth_user_id=caller_uid;
  if student_count<>1 or not exists (
    select 1 from public.students s where s.id=student_id_value
      and s.auth_user_id=caller_uid and s.status='active'
  ) then
    raise exception using errcode='42501', message='Ballot choices are unavailable.';
  end if;

  select e.id,e.organization_id,e.academic_term_id,e.electorate_policy_version,
         e.electorate_frozen_at,e.start_date,e.end_date,e.status::text as election_status
    into election_row
  from public.elections e
  where e.id=p_election_id and e.status='active' and e.removed_at is null;
  if not found then
    raise exception using errcode='42501', message='Ballot choices are unavailable.';
  end if;

  if election_row.start_date is null or election_row.end_date is null then
    return '[]'::jsonb;
  end if;
  manila_now := pg_catalog.timezone('Asia/Manila',pg_catalog.statement_timestamp());
  if manila_now < election_row.start_date or manila_now >= election_row.end_date then
    return '[]'::jsonb;
  end if;

  select pg_catalog.count(*)::integer,pg_catalog.min(t.id)
    into active_term_count,term_id_value
  from public.academic_terms t where t.status='active';
  if active_term_count<>1 then
    raise exception using errcode='42501', message='Ballot choices are unavailable.';
  end if;
  if election_row.academic_term_id is not null
     and election_row.academic_term_id is distinct from term_id_value then
    raise exception using errcode='42501', message='Ballot choices are unavailable.';
  end if;

  if election_row.electorate_policy_version=1 then
    if election_row.electorate_frozen_at is null
       or election_row.academic_term_id is null
       or term_id_value is distinct from election_row.academic_term_id
       or not exists (
         select 1 from public.student_term_enrollments ste
         where ste.student_id=student_id_value
           and ste.academic_term_id=term_id_value
           and ste.enrollment_status='enrolled'
       )
       or not exists (
         select 1 from private.election_eligible_voters ev
         where ev.election_id=p_election_id and ev.student_id=student_id_value
       ) then
      raise exception using errcode='42501', message='Ballot choices are unavailable.';
    end if;
  elsif election_row.electorate_policy_version<>0 then
    raise exception using errcode='42501', message='Ballot choices are unavailable.';
  end if;

  select coalesce(participation.allowed,false) into participation_allowed
  from public.resolve_student_organization_participation(
    student_id_value,election_row.organization_id,term_id_value
  ) participation;
  if not coalesce(participation_allowed,false) then
    raise exception using errcode='42501', message='Ballot choices are unavailable.';
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',c.id,
    'position_id',c.position_id,
    'photo',c.photo,
    'students',pg_catalog.jsonb_build_object('first_name',s.first_name,'last_name',s.last_name,'photo_url',s.photo_url),
    'partylists',case when pl.id is null then null
      else pg_catalog.jsonb_build_object('name',pl.name,'logo_url',pl.logo_url) end
  ) order by p.display_order,p.id,c.id),'[]'::jsonb)
  into candidate_data
  from public.positions p
  join public.candidates c on c.position_id=p.id
  join public.students s on s.id=c.student_id
  left join public.partylists pl on pl.id=c.partylist_id
    and pl.organization_id=election_row.organization_id
    and (pl.election_id is null or pl.election_id=p_election_id)
  where p.election_id=p_election_id and p.status='active';
  return candidate_data;
end;
$function$;
alter function public.kandid_get_student_ballot_candidates(integer) owner to postgres;
revoke all on function public.kandid_get_student_ballot_candidates(integer) from public, anon, authenticated, service_role;
grant execute on function public.kandid_get_student_ballot_candidates(integer) to authenticated;

-- Candidate identities in Student results remain behind the existing turnout
-- authorization, which enforces realtime/released/after-close visibility and
-- the student's canonical term participation. No campaign materials or
-- student foreign keys are returned by this projection.
create function public.kandid_get_student_result_candidates(p_election_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  caller_uid uuid := auth.uid();
  student_count integer;
  student_id_value integer;
  result_data jsonb;
begin
  if caller_uid is null or p_election_id is null or p_election_id<=0 then
    raise exception using errcode='28000', message='Eligible Student authentication is required.';
  end if;
  select pg_catalog.count(*)::integer,pg_catalog.min(s.id)
    into student_count,student_id_value
  from public.students s where s.auth_user_id=caller_uid and s.status='active';
  if student_count<>1 then
    raise exception using errcode='42501', message='Election results are unavailable.';
  end if;

  perform public.kandid_get_election_turnout(p_election_id);

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',c.id,'photo',c.photo,'position_id',c.position_id,
    'students',pg_catalog.jsonb_build_object('first_name',s.first_name,'last_name',s.last_name,
      'photo_url',s.photo_url,'program',s.program,'year_level',s.year_level),
    'partylists',case when pl.id is null then null
      else pg_catalog.jsonb_build_object('id',pl.id,'name',pl.name) end
  ) order by p.display_order,p.id,c.id),'[]'::jsonb)
  into result_data
  from public.candidates c
  join public.positions p on p.id=c.position_id and p.election_id=p_election_id
  join public.students s on s.id=c.student_id
  left join public.partylists pl on pl.id=c.partylist_id
    and pl.organization_id=(select e.organization_id from public.elections e where e.id=p_election_id)
    and (pl.election_id is null or pl.election_id=p_election_id);
  return result_data;
end;
$function$;
alter function public.kandid_get_student_result_candidates(integer) owner to postgres;
revoke all on function public.kandid_get_student_result_candidates(integer) from public, anon, authenticated, service_role;
grant execute on function public.kandid_get_student_result_candidates(integer) to authenticated;

do $privacy_postflight$
declare
  candidate_column text;
begin
  if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid='public.candidates'::regclass)
     or pg_catalog.has_table_privilege('anon','public.candidates','SELECT')
     or pg_catalog.has_table_privilege('authenticated','public.candidates','SELECT') then
    raise exception 'Candidate table-level SELECT was not reduced as reviewed';
  end if;

  for candidate_column in
    select a.attname from pg_catalog.pg_attribute a
    where a.attrelid='public.candidates'::regclass and a.attnum>0 and not a.attisdropped
  loop
    if pg_catalog.has_column_privilege('anon','public.candidates',candidate_column,'SELECT')
       or pg_catalog.has_column_privilege('authenticated','public.candidates',candidate_column,'SELECT')
         and candidate_column not in ('id','position_id') then
      raise exception 'Unexpected direct candidate column SELECT grant: %',candidate_column;
    end if;
  end loop;

  if not pg_catalog.has_column_privilege('authenticated','public.candidates','id','SELECT')
     or not pg_catalog.has_column_privilege('authenticated','public.candidates','position_id','SELECT')
     or pg_catalog.has_function_privilege('anon','public.kandid_can_admin_read_candidate_v1(integer)','EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated','public.kandid_can_admin_read_candidate_v1(integer)','EXECUTE') then
    raise exception 'Candidate admin read authorization/grant postflight failed';
  end if;

  if (select count(*) from pg_catalog.pg_policy p
      where p.polrelid='public.candidates'::regclass and p.polcmd='r')<>1
     or not exists (select 1 from pg_catalog.pg_policy p
       where p.polrelid='public.candidates'::regclass
         and p.polname='candidates_authenticated_admin_read'
         and p.polroles @> array['authenticated'::regrole::oid]
         and pg_catalog.pg_get_expr(p.polqual,p.polrelid)='kandid_can_admin_read_candidate_v1(id)') then
    raise exception 'Candidate SELECT RLS policy postflight failed';
  end if;

  if pg_catalog.pg_get_userbyid((select p.proowner from pg_catalog.pg_proc p where p.oid='public.kandid_can_admin_read_candidate_v1(integer)'::regprocedure))<>'postgres'
     or not (select p.prosecdef and p.proconfig=array['search_path=pg_catalog']::text[] from pg_catalog.pg_proc p where p.oid='public.kandid_can_admin_read_candidate_v1(integer)'::regprocedure) then
    raise exception 'Candidate row authorization helper security postflight failed';
  end if;

  if pg_catalog.has_function_privilege('anon','public.kandid_get_student_published_campaign(integer)','EXECUTE')
     or pg_catalog.has_function_privilege('anon','public.get_student_campaign(integer)','EXECUTE')
     or pg_catalog.has_function_privilege('anon','public.kandid_get_student_ballot_candidates(integer)','EXECUTE')
     or pg_catalog.has_function_privilege('anon','public.kandid_get_student_result_candidates(integer)','EXECUTE')
     or pg_catalog.has_function_privilege('service_role','public.kandid_get_student_published_campaign(integer)','EXECUTE')
     or pg_catalog.has_function_privilege('service_role','public.kandid_get_student_ballot_candidates(integer)','EXECUTE')
     or pg_catalog.has_function_privilege('service_role','public.kandid_get_student_result_candidates(integer)','EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated','public.kandid_get_student_published_campaign(integer)','EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated','public.get_student_campaign(integer)','EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated','public.kandid_get_student_ballot_candidates(integer)','EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated','public.kandid_get_student_result_candidates(integer)','EXECUTE') then
    raise exception 'Student campaign/ballot/results RPC grant postflight failed';
  end if;

  if (select count(*) from pg_catalog.pg_policy p where p.polrelid='public.candidates'::regclass
      and p.polcmd in ('a','w','d')
      and p.polname in ('candidates_insert_authorized_election','candidates_update_authorized_election','candidates_delete_authorized_election'))<>3 then
    raise exception 'Existing candidate write policies were not preserved';
  end if;
end;
$privacy_postflight$;

commit;
