-- Narrow candidate-directory prerequisite. No publication, voting or table-policy changes.
-- Function definitions extracted verbatim from supabase/migrations/20261021110000_publication_and_board_privacy_contract.sql.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local search_path=pg_catalog;
do $preflight$
begin
 if current_user<>'postgres' then raise exception 'Reviewed postgres executor required.'; end if;
 if current_database()<>'postgres' and current_database() not like 'kandid_soft_removal_release_%' then raise exception 'Unexpected database; verify official project identity independently.'; end if;
 if to_regprocedure('auth.uid()') is null or to_regnamespace('private') is null
    or (select count(*) from pg_roles where rolname in ('postgres','anon','authenticated','service_role'))<>4 then raise exception 'Required schemas, JWT identity function or roles differ.'; end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='public' and p.proname='kandid_admin_candidate_directory') or (n.nspname='private' and p.proname='kandid_active_admin_can_access_organization')) then raise exception 'Prerequisite function or overload already exists; inspect, do not replace or replay.'; end if;
 if exists(select 1 from (values ('admin_users','auth_user_id','uuid'),
  ('admin_users','status','varchar'),
  ('admin_users','role','varchar'),
  ('admin_users','organization_id','int4'),
  ('candidates','id','int4'),
  ('candidates','student_id','int4'),
  ('candidates','position_id','int4'),
  ('candidates','partylist_id','int4'),
  ('candidates','photo','text'),
  ('candidates','bio','text'),
  ('candidates','platform','text'),
  ('candidates','credentials','text'),
  ('candidates','campaign_status','varchar'),
  ('candidates','campaign_materials','jsonb'),
  ('candidates','campaign_media_urls','jsonb'),
  ('students','id','int4'),
  ('students','first_name','varchar'),
  ('students','last_name','varchar'),
  ('students','photo_url','text'),
  ('students','program','varchar'),
  ('students','year_level','int4'),
  ('positions','id','int4'),
  ('positions','name','varchar'),
  ('positions','election_id','int4'),
  ('elections','id','int4'),
  ('elections','title','varchar'),
  ('elections','organization_id','int4'),
  ('organizations','id','int4'),
  ('organizations','name','varchar'),
  ('partylists','id','int4'),
  ('partylists','name','varchar')) expected(table_name,column_name,udt_name)
   left join information_schema.columns c on c.table_schema='public' and c.table_name=expected.table_name and c.column_name=expected.column_name
   where c.column_name is null or c.udt_name is distinct from expected.udt_name) then raise exception 'Candidate-directory required column/type differs.'; end if;
 if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('admin_users','candidates','students','positions','elections','organizations','partylists') and pg_get_userbyid(c.relowner)='postgres' and c.relrowsecurity and not c.relforcerowsecurity)<>7 then raise exception 'Reviewed table ownership or RLS baseline differs.'; end if;
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
alter function private.kandid_active_admin_can_access_organization(bigint) owner to postgres;
revoke all on function private.kandid_active_admin_can_access_organization(bigint) from public,anon,authenticated,service_role;
-- No direct authenticated helper grant: only the postgres-owned RPC needs it.

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
alter function public.kandid_admin_candidate_directory(integer[],integer[]) owner to postgres;
revoke all on function public.kandid_admin_candidate_directory(integer[],integer[]) from public,anon,authenticated,service_role;
grant execute on function public.kandid_admin_candidate_directory(integer[],integer[]) to authenticated;
notify pgrst,'reload schema';
commit;
