begin;

-- Preserve the deployed RPC's signature and row return contract while making
-- normal activation advance only one legitimate semester at a time.
create or replace function public.activate_academic_term(target_term_id integer)
returns public.academic_terms
language plpgsql
security definer
volatile
set search_path = pg_catalog
as $function$
declare
  active_term_count integer;
  active_term_row public.academic_terms%rowtype;
  target_term_row public.academic_terms%rowtype;
  bootstrap_term_id integer;
  active_start_year integer;
  target_start_year integer;
  expected_start_year integer;
  expected_semester text;
begin
  if target_term_id is null then
    raise exception using errcode = '22023', message = 'Academic term is required.';
  end if;

  -- Serialize all calls to this contract. The partial unique index remains a
  -- second line of defense against any concurrent or out-of-band activation.
  perform pg_catalog.pg_advisory_xact_lock(20261003, 12000);

  select pg_catalog.count(*)::integer
  into active_term_count
  from public.academic_terms t
  where t.status = 'active';

  if active_term_count > 1 then
    raise exception using errcode = '55000', message = 'Multiple active academic terms require administrator review.';
  end if;

  select t.* into target_term_row
  from public.academic_terms t
  where t.id = target_term_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'Academic term was not found.';
  end if;

  if active_term_count = 1 then
    select t.* into active_term_row
    from public.academic_terms t
    where t.status = 'active'
    for update;

    -- A retry after a successful activation is safe and returns the existing
    -- active row without touching any data.
    if target_term_row.id = active_term_row.id then
      return active_term_row;
    end if;

    if target_term_row.status <> 'draft' then
      raise exception using errcode = '22023', message = 'Only draft academic terms can be activated.';
    end if;

    active_start_year := pg_catalog.split_part(active_term_row.academic_year, '-', 1)::integer;
    target_start_year := pg_catalog.split_part(target_term_row.academic_year, '-', 1)::integer;

    if active_term_row.semester = '1st Semester' then
      expected_start_year := active_start_year;
      expected_semester := '2nd Semester';
    elsif active_term_row.semester = '2nd Semester' then
      expected_start_year := active_start_year + 1;
      expected_semester := '1st Semester';
    else
      raise exception using errcode = '22023', message = 'The active term has an unsupported semester value.';
    end if;

    if target_start_year <> expected_start_year
       or target_term_row.semester <> expected_semester then
      raise exception using
        errcode = '22023',
        message = 'Only the immediate following academic term can be activated.';
    end if;
  else
    -- Bootstrap is allowed only before any term has ever been activated or
    -- closed, and only for the earliest configured draft term. A historical
    -- gap requires a separate recovery decision.
    if exists (
      select 1
      from public.academic_terms t
      where t.status = 'closed'
         or t.activated_at is not null
         or t.closed_at is not null
    ) then
      raise exception using
        errcode = '55000',
        message = 'No active term exists after prior term history; use an administrator recovery workflow.';
    end if;

    if target_term_row.status <> 'draft' then
      raise exception using errcode = '22023', message = 'Only draft academic terms can be activated.';
    end if;

    select t.id into bootstrap_term_id
    from public.academic_terms t
    where t.status = 'draft'
    order by
      pg_catalog.split_part(t.academic_year, '-', 1)::integer,
      case t.semester when '1st Semester' then 1 when '2nd Semester' then 2 else 3 end,
      t.id
    limit 1
    for update;

    if bootstrap_term_id is null or bootstrap_term_id <> target_term_row.id then
      raise exception using
        errcode = '22023',
        message = 'Initial activation must use the earliest configured academic term.';
    end if;
  end if;

  -- Both updates run in this RPC transaction. If activation fails, closing the
  -- previous term is rolled back with it.
  if active_term_count = 1 then
    update public.academic_terms t
    set status = 'closed',
        closed_at = coalesce(t.closed_at, pg_catalog.now())
    where t.id = active_term_row.id;
  end if;

  update public.academic_terms t
  set status = 'active',
      activated_at = coalesce(t.activated_at, pg_catalog.now()),
      closed_at = null
  where t.id = target_term_row.id
    and t.status = 'draft'
  returning t.* into target_term_row;

  if not found then
    raise exception using errcode = '40001', message = 'Academic term activation conflicted with another update.';
  end if;

  return target_term_row;
end;
$function$;

alter function public.activate_academic_term(integer) owner to postgres;
revoke all on function public.activate_academic_term(integer) from public, anon, authenticated;
grant execute on function public.activate_academic_term(integer) to service_role;

comment on function public.activate_academic_term(integer) is
  'Activates only the immediate following 1st/2nd semester; permits initial bootstrap at the earliest draft term and refuses recovery from a historical no-active-term state.';

commit;
