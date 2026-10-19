-- Local reviewed candidate. Ordered after the existing October 21 dependency
-- chain and October 18 removal schema; no production installation authorized.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $preflight$
begin
  if current_user <> 'postgres' then raise exception 'Reviewed postgres executor required.'; end if;
  if to_regprocedure('public.kandid_can_mutate_election_positions(integer)') is null
     or to_regprocedure('public.resolve_student_organization_participation(integer,integer,integer)') is null
     or to_regprocedure('public.kandid_admin_candidate_directory(integer[],integer[])') is null
     or not exists(select 1 from pg_attribute where attrelid='public.elections'::regclass and attname='removed_at' and not attisdropped)
     or not exists(select 1 from pg_trigger where tgrelid='public.candidates'::regclass and tgname='candidates_trusted_mutation_guard' and tgenabled='O')
     or not exists(select 1 from pg_trigger where tgrelid='public.candidates'::regclass and tgname='guard_removed_election_mutation' and tgenabled='O') then
    raise exception 'Existing candidate authorization, term eligibility, privacy or removal prerequisites differ.';
  end if;
  if to_regprocedure('public.kandid_candidate_management_context_v1(integer)') is not null
     or to_regprocedure('private.kandid_guard_candidate_management_contract_v1()') is not null then
    raise exception 'Candidate management contract already exists; do not replay installation.';
  end if;
end;
$preflight$;

create function private.kandid_candidate_election_has_history_v1(p_election_id integer)
returns boolean language sql stable security definer set search_path=pg_catalog
as $function$
  select coalesce((select
    e.removed_at is not null or e.electorate_frozen_at is not null or e.results_released_at is not null
    or exists(select 1 from private.election_eligible_voters v where v.election_id=e.id)
    or exists(select 1 from public.votes v where v.election_id=e.id)
    or exists(select 1 from public.vote_ballots b where b.election_id=e.id)
    or exists(select 1 from public.election_campaign_snapshots s where s.election_id=e.id)
    or exists(select 1 from public.officers o where o.election_id=e.id or exists(
      select 1 from public.positions p left join public.candidates c on c.position_id=p.id
      where p.election_id=e.id and (p.id=o.position_id or c.id=o.candidate_id)))
    or exists(select 1 from public.officer_new_roster o where o.election_id=e.id or exists(
      select 1 from public.positions p left join public.candidates c on c.position_id=p.id
      where p.election_id=e.id and (p.id=o.position_id or c.id=o.candidate_id)))
    or exists(select 1 from public.officer_leadership_releases r where r.election_id=e.id)
    or exists(select 1 from public.election_officer_publications p where p.election_id=e.id)
    or exists(select 1 from public.archived_elections a where a.election_id=e.id)
    from public.elections e where e.id=p_election_id),true);
$function$;
alter function private.kandid_candidate_election_has_history_v1(integer) owner to postgres;
revoke all on function private.kandid_candidate_election_has_history_v1(integer) from public,anon,authenticated,service_role;

create function private.kandid_guard_candidate_management_contract_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog
as $function$
declare
  parent_id integer; old_parent_id integer; organization_id_value bigint; position_status text;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='Active administrator authentication required.'; end if;
  if tg_op in ('UPDATE','DELETE') then
    select p.election_id into old_parent_id from public.positions p where p.id=old.position_id;
    if old_parent_id is null or not public.kandid_can_mutate_election_positions(old_parent_id) then
      raise exception using errcode='42501',message='Candidate changes are not authorized for the original election.';
    end if;
    if private.kandid_candidate_election_has_history_v1(old_parent_id) then
      raise exception using errcode='42501',message='Candidate is protected by frozen, voting, released or historical election records.';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  if tg_op='UPDATE' then
    if new.id is distinct from old.id or new.student_id is distinct from old.student_id or new.created_at is distinct from old.created_at then
      raise exception using errcode='42501',message='Candidate identity and original creation attribution are immutable.';
    end if;
    -- Preserve the explicit existing unprotected disconnect contract. Detached
    -- rows cannot subsequently be adopted into a different election.
    if new.position_id is null then return new; end if;
    if old.position_id is null then raise exception using errcode='42501',message='An unassigned candidate cannot be reassigned without its original election context.'; end if;
  end if;
  select p.election_id,e.organization_id,p.status into parent_id,organization_id_value,position_status
  from public.positions p join public.elections e on e.id=p.election_id where p.id=new.position_id;
  if parent_id is null or not public.kandid_can_mutate_election_positions(parent_id) then
    raise exception using errcode='42501',message='Invalid or unauthorized candidate position.';
  end if;
  if tg_op='UPDATE' and parent_id is distinct from old_parent_id then
    raise exception using errcode='42501',message='A candidate cannot move to another election.';
  end if;
  if private.kandid_candidate_election_has_history_v1(parent_id) then
    raise exception using errcode='42501',message='Election is locked by protected history; candidate changes are unavailable.';
  end if;
  if (tg_op='INSERT' or new.position_id is distinct from old.position_id) and position_status is distinct from 'active' then
    raise exception using errcode='42501',message='The selected position is retired or unavailable.';
  end if;
  if new.partylist_id is not null then
    perform 1 from public.partylists pl where pl.id=new.partylist_id
      and pl.organization_id=organization_id_value and (pl.election_id is null or pl.election_id=parent_id) for share;
    if not found then raise exception using errcode='42501',message='Partylist must belong to this organization and, when election-bound, this election.'; end if;
  end if;
  -- Existing trusted mutation/duplicate triggers still run and remain the
  -- canonical term-eligibility and one-student-per-election authority.
  return new;
end;
$function$;
alter function private.kandid_guard_candidate_management_contract_v1() owner to postgres;
revoke all on function private.kandid_guard_candidate_management_contract_v1() from public,anon,authenticated,service_role;
create trigger candidates_management_contract_guard
  before insert or update or delete on public.candidates for each row
  execute function private.kandid_guard_candidate_management_contract_v1();

create function private.kandid_guard_candidate_partylist_parent_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog
as $function$
begin
  if (new.organization_id is distinct from old.organization_id or new.election_id is distinct from old.election_id)
     and exists(select 1 from public.candidates c join public.positions p on p.id=c.position_id
       join public.elections e on e.id=p.election_id where c.partylist_id=old.id
       and (new.organization_id is distinct from e.organization_id or new.election_id is not null and new.election_id is distinct from e.id)) then
    raise exception using errcode='42501',message='A referenced partylist must retain compatible election and organization scope.';
  end if;
  return new;
end;
$function$;
alter function private.kandid_guard_candidate_partylist_parent_v1() owner to postgres;
revoke all on function private.kandid_guard_candidate_partylist_parent_v1() from public,anon,authenticated,service_role;
create trigger partylists_candidate_parent_guard before update of organization_id,election_id
  on public.partylists for each row execute function private.kandid_guard_candidate_partylist_parent_v1();

create function public.kandid_candidate_management_context_v1(p_election_id integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog
as $function$
declare
  actor_count integer; actor_role text; actor_organization_id bigint;
  election_row public.elections%rowtype; term_id integer;
begin
  if auth.uid() is null or p_election_id is null or p_election_id<=0 then
    raise exception using errcode='42501',message='Active administrator authentication required.';
  end if;
  select count(*),min(a.role),min(a.organization_id) into actor_count,actor_role,actor_organization_id
  from public.admin_users a where a.auth_user_id=auth.uid() and a.status='active';
  if actor_count<>1 or actor_role not in ('electoral_board','super_admin') then
    raise exception using errcode='42501',message='Active Electoral Board or Super Admin access required.';
  end if;
  select e.* into election_row from public.elections e where e.id=p_election_id;
  if not found or actor_role='electoral_board' and (actor_organization_id is null or actor_organization_id is distinct from election_row.organization_id) then
    raise exception using errcode='42501',message='Election is unavailable in your authorized organization.';
  end if;
  if not public.kandid_can_mutate_election_positions(p_election_id) or private.kandid_candidate_election_has_history_v1(p_election_id) then
    raise exception using errcode='42501',message='Election is locked; candidate changes are unavailable.';
  end if;
  term_id:=election_row.academic_term_id;
  if term_id is null then
    if (select count(*) from public.academic_terms where status='active')<>1 then
      raise exception 'Exactly one active academic term is required for a legacy termless election.';
    end if;
    select id into term_id from public.academic_terms where status='active';
  end if;
  return jsonb_build_object('contract_version',1,'election',jsonb_build_object(
    'id',election_row.id,'organization_id',election_row.organization_id,'academic_term_id',term_id),
    'positions',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'election_id',p.election_id,'status',p.status) order by p.display_order,p.id)
      from public.positions p where p.election_id=p_election_id),'[]'::jsonb),
    'partylists',coalesce((select jsonb_agg(jsonb_build_object('id',pl.id,'name',pl.name,'organization_id',pl.organization_id,'election_id',pl.election_id) order by pl.name,pl.id)
      from public.partylists pl where pl.organization_id=election_row.organization_id and (pl.election_id is null or pl.election_id=p_election_id)),'[]'::jsonb),
    'eligible_students',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'student_number',s.student_number,'first_name',s.first_name,'last_name',s.last_name,'program',te.program,'year_level',te.year_level) order by s.last_name,s.first_name,s.id)
      from public.students s join public.student_term_enrollments te on te.student_id=s.id and te.academic_term_id=term_id and te.enrollment_status='enrolled'
      where exists(select 1 from public.resolve_student_organization_participation(s.id,election_row.organization_id::integer,term_id) r where r.allowed is true)),'[]'::jsonb));
end;
$function$;
alter function public.kandid_candidate_management_context_v1(integer) owner to postgres;
revoke all on function public.kandid_candidate_management_context_v1(integer) from public,anon,authenticated,service_role;
grant execute on function public.kandid_candidate_management_context_v1(integer) to authenticated;
notify pgrst,'reload schema';
commit;
