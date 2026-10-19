begin;

do $preflight$
begin
  if current_user <> 'postgres' then
    raise exception 'Candidate term-eligibility correction must run as the reviewed postgres migration role.';
  end if;
  if pg_catalog.to_regprocedure('public.kandid_guard_candidate_mutation()') is null
     or pg_catalog.to_regprocedure('public.kandid_can_mutate_election_positions(integer)') is null
     or pg_catalog.to_regprocedure('public.resolve_student_organization_participation(integer,integer,integer)') is null
     or pg_catalog.to_regprocedure('auth.uid()') is null
     or pg_catalog.to_regclass('public.candidates') is null
     or pg_catalog.to_regclass('public.elections') is null
     or pg_catalog.to_regclass('public.academic_terms') is null then
    raise exception 'Candidate term-eligibility correction preflight failed: trusted contracts are unavailable.';
  end if;

  -- CREATE OR REPLACE, ALTER OWNER, and the following ACL change must all be
  -- legal for the migration executor before any function definition is changed.
  if not pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE')
     or not pg_catalog.has_schema_privilege('postgres', 'public', 'CREATE')
     or not coalesce((select r.rolsuper from pg_catalog.pg_roles r where r.rolname=current_user), false)
        and not pg_catalog.pg_has_role(current_user,
          (select p.proowner from pg_catalog.pg_proc p
           where p.oid='public.kandid_guard_candidate_mutation()'::pg_catalog.regprocedure), 'USAGE')
     or not coalesce((select r.rolsuper from pg_catalog.pg_roles r where r.rolname=current_user), false)
        and not pg_catalog.pg_has_role(current_user,
          (select r.oid from pg_catalog.pg_roles r where r.rolname='postgres'), 'SET')
     or not coalesce((select r.rolsuper from pg_catalog.pg_roles r where r.rolname=current_user), false)
        and not pg_catalog.pg_has_role(current_user,
          (select r.oid from pg_catalog.pg_roles r where r.rolname='postgres'), 'USAGE') then
    raise exception 'Candidate term-eligibility correction preflight failed: migration executor lacks required function or schema ownership authority.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = 'public.elections'::pg_catalog.regclass
      and a.attname = 'academic_term_id' and not a.attisdropped
  ) then
    raise exception 'Candidate term-eligibility correction preflight failed: elections.academic_term_id is unavailable.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.candidates'::pg_catalog.regclass
      and t.tgname = 'candidates_trusted_mutation_guard'
      and t.tgfoid = 'public.kandid_guard_candidate_mutation()'::pg_catalog.regprocedure
      and t.tgenabled = 'O'
      and not t.tgisinternal
  ) then
    raise exception 'Candidate term-eligibility correction preflight failed: trusted candidate trigger identity or state differs.';
  end if;
end;
$preflight$;
create or replace function public.kandid_guard_candidate_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  old_election_id integer;
  new_election_id integer;
  new_organization_id integer;
  eligibility_term_id integer;
  new_election_term_id integer;
  participation_allowed boolean := false;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'Authenticated administrator access is required.';
  end if;

  if tg_op = 'INSERT' then
    if new.position_id is null then
      raise exception using
        errcode = '42501',
        message = 'A candidate must be assigned to an election position.';
    end if;

    select p.election_id, e.organization_id, e.academic_term_id
      into new_election_id, new_organization_id, new_election_term_id
    from public.positions p
    join public.elections e on e.id = p.election_id
    where p.id = new.position_id;

    if not found then
      raise exception using
        errcode = '42501',
        message = 'The selected candidate position is unavailable.';
    end if;

    if not public.kandid_can_mutate_election_positions(new_election_id) then
      raise exception using
        errcode = '42501',
        message = 'Candidate changes are not authorized for this election.';
    end if;
  elsif tg_op = 'UPDATE' then
    if old.position_id is null and new.position_id is null then
      raise exception using
        errcode = '42501',
        message = 'An unassigned candidate has no election context for changes.';
    end if;

    if old.position_id is not null then
      select p.election_id
        into old_election_id
      from public.positions p
      where p.id = old.position_id;

      if not found
         or not public.kandid_can_mutate_election_positions(old_election_id) then
        raise exception using
          errcode = '42501',
          message = 'Candidate changes are not authorized for the current election.';
      end if;
    end if;

    if old.position_id is not null
       and new.position_id is null
       and (
         new.id is distinct from old.id
         or new.student_id is distinct from old.student_id
         or new.partylist_id is distinct from old.partylist_id
         or new.photo is distinct from old.photo
         or new.bio is distinct from old.bio
         or new.created_at is distinct from old.created_at
         or new.platform is distinct from old.platform
         or new.credentials is distinct from old.credentials
         or new.campaign_status is distinct from old.campaign_status
         or new.campaign_media_urls is distinct from old.campaign_media_urls
         or new.campaign_materials is distinct from old.campaign_materials
       ) then
      raise exception using
        errcode = '42501',
        message = 'Detaching a candidate may only clear its ballot position.';
    end if;

    if new.position_id is not null then
      select p.election_id, e.organization_id, e.academic_term_id
      into new_election_id, new_organization_id, new_election_term_id
      from public.positions p
      join public.elections e on e.id = p.election_id
      where p.id = new.position_id;

      if not found then
        raise exception using
          errcode = '42501',
          message = 'The selected candidate position is unavailable.';
      end if;

      if not public.kandid_can_mutate_election_positions(new_election_id) then
        raise exception using
          errcode = '42501',
          message = 'Candidate changes are not authorized for the selected election.';
      end if;
    end if;
  else
    raise exception using
      errcode = '42501',
      message = 'Unsupported candidate mutation.';
  end if;

  -- A detached candidate has no current organization context. The existing
  -- Super Admin disconnect flow changes only position_id; the old election
  -- was authorized above. No current UI supports editing an already-detached
  -- row, so NULL -> NULL is intentionally denied for every role.
  if new.position_id is not null then
    if new.student_id is null then
      raise exception using
        errcode = '42501',
        message = 'An assigned candidate must reference an eligible student.';
    end if;

    eligibility_term_id := new_election_term_id;

    -- Term-bound elections resolve against their own enrollment. Legacy
    -- termless elections retain the active-term compatibility behavior.
    if eligibility_term_id is null then
      select at.id
        into eligibility_term_id
      from public.academic_terms at
      where at.status = 'active'
      order by at.created_at desc, at.id desc
      limit 1;

      if eligibility_term_id is null then
        raise exception using
          errcode = '42501',
          message = 'Active academic-term eligibility could not be verified.';
      end if;
    end if;

    select participation.allowed
      into participation_allowed
    from public.resolve_student_organization_participation(
      new.student_id,
      new_organization_id,
      eligibility_term_id
    ) participation
    limit 1;

    if participation_allowed is distinct from true then
      raise exception using
        errcode = '42501',
        message = 'The candidate student is not eligible for this election organization.';
    end if;
  end if;

  return new;
end;
$function$;

alter function public.kandid_guard_candidate_mutation() owner to postgres;
revoke all on function public.kandid_guard_candidate_mutation()
  from public, anon, authenticated;


do $postflight$
declare
  function_row record;
  function_source text;
begin
  select p.oid, p.proowner, p.prosecdef, p.proconfig
    into function_row
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('public.kandid_guard_candidate_mutation()');

  if function_row.oid is null
     or function_row.proowner <> (select r.oid from pg_catalog.pg_roles r where r.rolname = 'postgres')
     or function_row.prosecdef is distinct from true
     or not ('search_path=pg_catalog' = any(coalesce(function_row.proconfig, array[]::text[]))) then
    raise exception 'Candidate term-eligibility postflight failed: SECURITY DEFINER contract changed.';
  end if;

  function_source := pg_catalog.pg_get_functiondef(function_row.oid);
  if function_source not like '%new_election_term_id%'
     or function_source not like '%eligibility_term_id := new_election_term_id%'
     or function_source not like '%resolve_student_organization_participation%'
     or pg_catalog.has_function_privilege('anon', function_row.oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', function_row.oid, 'EXECUTE') then
    raise exception 'Candidate term-eligibility postflight failed: function body or grants differ from contract.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.candidates'::pg_catalog.regclass
      and t.tgname = 'candidates_trusted_mutation_guard'
      and t.tgfoid = 'public.kandid_guard_candidate_mutation()'::pg_catalog.regprocedure
      and t.tgenabled = 'O'
      and not t.tgisinternal
  ) then
    raise exception 'Candidate term-eligibility postflight failed: trusted trigger is missing.';
  end if;
end;
$postflight$;

commit;
