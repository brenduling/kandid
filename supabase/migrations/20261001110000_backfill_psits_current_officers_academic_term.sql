begin;

-- One-time normalization of the four approved legacy PSITS Current records.
-- All assertions and the temporary trigger state change are transactional.
lock table public.officers in share row exclusive mode;

do $backfill$
declare
  affected_rows integer := 0;
  term_service_trigger_enabled boolean;
  legacy_before jsonb;
  legacy_after jsonb;
  non_target_current_before jsonb;
  non_target_current_after jsonb;
begin
  -- Prevent the referenced organization and term context from changing while
  -- the exact approved officer set is checked and updated.
  perform 1
  from public.organizations
  where id = 1 and name = 'PSITS'
  for share;
  if not found then
    raise exception 'PSITS organization ID 1 is missing or has changed.';
  end if;

  perform 1
  from public.academic_terms
  where id = 1
    and semester = '1st Semester'
    and academic_year = '2026-2027'
    and status = 'active'
  for share;
  if not found then
    raise exception 'Academic Term ID 1 is not the active 1st Semester AY 2026-2027.';
  end if;

  -- Protect the approved historical targets without assuming a fixed Current
  -- roster size or requiring any particular non-target officer to exist.
  if exists (
    select 1
    from (values
      (1, 'president'),
      (2, 'vice president'),
      (3, 'secretary'),
      (4, 'treasurer')
    ) as expected(id, position_key)
    left join public.officers o on o.id = expected.id
    where o.id is null
      or o.organization_id <> 1
      or not o.is_current
      or o.academic_term_id is not null
      or o.service_started_at is not null
      or pg_catalog.lower(pg_catalog.btrim(o.position_title)) <> expected.position_key
  ) then
    raise exception 'One or more approved legacy Current PSITS officers no longer match the expected NULL-term state.';
  end if;

  if exists (
    select 1
    from public.officers o
    where o.organization_id = 1
      and o.is_current
      and o.academic_term_id is not null
      and o.academic_term_id <> 1
  ) then
    raise exception 'Current PSITS leadership contains a conflicting non-NULL academic term.';
  end if;

  select (t.tgenabled <> 'D')
    into term_service_trigger_enabled
  from pg_catalog.pg_trigger t
  where t.tgrelid = 'public.officers'::regclass
    and t.tgname = 'officers_assign_term_and_service'
    and not t.tgisinternal;
  if term_service_trigger_enabled is distinct from true then
    raise exception 'The normal officers_assign_term_and_service trigger is missing or disabled.';
  end if;

  select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(o) - 'academic_term_id' order by o.id)
    into legacy_before
  from public.officers o
  where o.id in (1, 2, 3, 4);

  -- Snapshot every Current PSITS row outside the explicit target set. This
  -- preserves Auditor, PIO, and any other legitimate Current records exactly.
  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.to_jsonb(o) order by o.id),
    '[]'::jsonb
  )
    into non_target_current_before
  from public.officers o
  where o.organization_id = 1
    and o.is_current
    and o.id not in (1, 2, 3, 4);

  -- The existing BEFORE UPDATE trigger enforces term immutability by restoring
  -- OLD.academic_term_id. Disable only that trigger for this transaction's
  -- exact one-time backfill; migration failure rolls this DDL back as well.
  alter table public.officers disable trigger officers_assign_term_and_service;

  update public.officers o
  set academic_term_id = 1
  where o.id in (1, 2, 3, 4)
    and o.organization_id = 1
    and o.is_current
    and o.academic_term_id is null;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 4 then
    raise exception 'Expected to update exactly four approved legacy officers; updated %.', affected_rows;
  end if;

  -- Restore normal immutability immediately, before postcondition checks.
  alter table public.officers enable trigger officers_assign_term_and_service;

  select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(o) - 'academic_term_id' order by o.id)
    into legacy_after
  from public.officers o
  where o.id in (1, 2, 3, 4);
  if legacy_after is distinct from legacy_before then
    raise exception 'The backfill changed a legacy officer field other than academic_term_id.';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.to_jsonb(o) order by o.id),
    '[]'::jsonb
  )
    into non_target_current_after
  from public.officers o
  where o.organization_id = 1
    and o.is_current
    and o.id not in (1, 2, 3, 4);
  if non_target_current_after is distinct from non_target_current_before then
    raise exception 'A non-target Current PSITS officer changed during the legacy term backfill.';
  end if;

  if exists (
    select 1
    from (values
      (1, 'president'),
      (2, 'vice president'),
      (3, 'secretary'),
      (4, 'treasurer')
    ) as expected(id, position_key)
    left join public.officers o on o.id = expected.id
    where o.id is null
      or o.organization_id <> 1
      or not o.is_current
      or o.academic_term_id <> 1
      or o.service_started_at is not null
      or pg_catalog.lower(pg_catalog.btrim(o.position_title)) <> expected.position_key
  ) then
    raise exception 'Postcondition failed for one or more backfilled legacy officers.';
  end if;

  if exists (
    select 1
    from public.officers o
    where o.organization_id = 1
      and o.is_current
      and o.academic_term_id is not null
      and o.academic_term_id <> 1
  ) then
    raise exception 'A Current PSITS officer has a conflicting non-NULL academic term after the backfill.';
  end if;

  select (t.tgenabled <> 'D')
    into term_service_trigger_enabled
  from pg_catalog.pg_trigger t
  where t.tgrelid = 'public.officers'::regclass
    and t.tgname = 'officers_assign_term_and_service'
    and not t.tgisinternal;
  if term_service_trigger_enabled is distinct from true then
    raise exception 'Normal officers_assign_term_and_service protection was not restored.';
  end if;
end;
$backfill$;

commit;
