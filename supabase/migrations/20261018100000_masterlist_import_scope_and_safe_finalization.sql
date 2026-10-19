begin;

do $preflight$
declare
  core_owner text;
  core_is_security_definer boolean;
  core_config text;
  wrapper_owner text;
  wrapper_is_security_definer boolean;
  wrapper_config text;
begin
  if to_regclass('public.masterlist_imports') is null
     or to_regclass('public.masterlist_import_rows') is null
     or to_regclass('public.student_term_enrollments') is null
     or to_regclass('public.admin_users') is null
     or to_regprocedure('public.finalize_masterlist_import(integer)') is null
     or to_regprocedure('public.kandid_finalize_masterlist_import_with_membership_sync(integer,bigint)') is null then
    raise exception 'Masterlist import-scope preflight failed: expected schema or trusted finalizer is missing.';
  end if;
  if not has_function_privilege('service_role', 'public.finalize_masterlist_import(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.finalize_masterlist_import(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.finalize_masterlist_import(integer)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.kandid_finalize_masterlist_import_with_membership_sync(integer,bigint)', 'EXECUTE')
     or has_function_privilege('anon', 'public.kandid_finalize_masterlist_import_with_membership_sync(integer,bigint)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.kandid_finalize_masterlist_import_with_membership_sync(integer,bigint)', 'EXECUTE') then
    raise exception 'Masterlist import-scope preflight failed: trusted finalizer execution grants differ.';
  end if;
  select owner_role.rolname, p.prosecdef, p.proconfig::text
    into core_owner, core_is_security_definer, core_config
  from pg_catalog.pg_proc p
  join pg_catalog.pg_roles owner_role on owner_role.oid = p.proowner
  where p.oid = pg_catalog.to_regprocedure('public.finalize_masterlist_import(integer)');
  select owner_role.rolname, p.prosecdef, p.proconfig::text
    into wrapper_owner, wrapper_is_security_definer, wrapper_config
  from pg_catalog.pg_proc p
  join pg_catalog.pg_roles owner_role on owner_role.oid = p.proowner
  where p.oid = pg_catalog.to_regprocedure('public.kandid_finalize_masterlist_import_with_membership_sync(integer,bigint)');
  if core_owner <> 'postgres' or core_is_security_definer is distinct from true
     or core_config not like '%search_path=pg_catalog%'
     or wrapper_owner <> 'postgres' or wrapper_is_security_definer is distinct from true
     or wrapper_config not like '%search_path=pg_catalog%' then
    raise exception 'Masterlist import-scope preflight failed: finalizer owner or SECURITY DEFINER contract differs.';
  end if;
end;
$preflight$;

alter table public.masterlist_imports
  add column if not exists import_scope text not null default 'incremental',
  add column if not exists full_roster_confirmed_by bigint,
  add column if not exists full_roster_confirmed_at timestamptz,
  add column if not exists full_roster_confirmation_fingerprint text;

alter table public.masterlist_imports
  drop constraint if exists masterlist_imports_import_scope_check;
alter table public.masterlist_imports
  add constraint masterlist_imports_import_scope_check
  check (import_scope in ('incremental', 'full_roster'));

comment on column public.masterlist_imports.import_scope is
  'incremental updates only included Students; full_roster is a complete authoritative term roster and requires a fresh trusted confirmation.';

-- Adding the non-null default classifies every pre-existing import as
-- incremental. No historical import is inferred to have been a full roster.

create or replace function public.kandid_masterlist_full_roster_manifest(p_import_id integer)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target_term_id integer;
  target_scope text;
  target_status text;
  previous_term_id integer;
  affected_students jsonb := '[]'::jsonb;
  affected_count integer := 0;
  rows_fingerprint jsonb := '[]'::jsonb;
  manifest_fingerprint text;
begin
  select mi.academic_term_id, mi.import_scope, mi.import_status
    into target_term_id, target_scope, target_status
  from public.masterlist_imports mi
  where mi.id = p_import_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Masterlist import was not found.';
  end if;
  if target_scope is distinct from 'full_roster' then
    raise exception using errcode = '22023', message = 'Import is not explicitly designated as a full roster.';
  end if;
  if target_status <> 'review' then
    raise exception using errcode = '55000', message = 'Full-roster preview requires an import in review.';
  end if;

  -- Serialize against review edits so the preview fingerprint describes the
  -- exact rows that finalization will consume.
  perform 1 from public.masterlist_import_rows mir
  where mir.import_id = p_import_id
  order by mir.id
  for update;

  select candidate.id into previous_term_id
  from public.academic_terms candidate
  join public.academic_terms target_term on target_term.id = target_term_id
  where candidate.status in ('active', 'closed')
    and (split_part(candidate.academic_year, '-', 1)::integer,
         case when candidate.semester = '1st Semester' then 1
              when candidate.semester = '2nd Semester' then 2 end)
      < (split_part(target_term.academic_year, '-', 1)::integer,
         case when target_term.semester = '1st Semester' then 1
              when target_term.semester = '2nd Semester' then 2 end)
  order by split_part(candidate.academic_year, '-', 1)::integer desc,
           case when candidate.semester = '1st Semester' then 1
                when candidate.semester = '2nd Semester' then 2 end desc
  limit 1;

  if previous_term_id is not null then
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'student_id', absent.student_id,
        'student_number', absent.student_number,
        'first_name', absent.first_name,
        'last_name', absent.last_name,
        'program', absent.program,
        'year_level', absent.year_level,
        'is_shs', absent.is_shs
      ) order by absent.student_id
    ), '[]'::jsonb), count(*)::integer
      into affected_students, affected_count
    from (
      select distinct pe.student_id, s.student_number, s.first_name, s.last_name,
        pe.program, pe.year_level, pe.is_shs
      from public.student_term_enrollments pe
      join public.students s on s.id = pe.student_id
      where pe.academic_term_id = previous_term_id
        and pe.enrollment_status = 'enrolled'
        and not exists (
          select 1 from public.masterlist_import_rows mir
          where mir.import_id = p_import_id
            and mir.matched_student_id = pe.student_id
            and mir.reconciliation_status in ('continuing', 'shifted_program', 'returnee')
        )
    ) absent;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', mir.id,
    'row_number', mir.row_number,
    'student_number', mir.student_number,
    'first_name', mir.first_name,
    'last_name', mir.last_name,
    'email', mir.email,
    'program', mir.program,
    'year_level', mir.year_level,
    'is_shs', mir.is_shs,
    'matched_student_id', mir.matched_student_id,
    'reconciliation_status', mir.reconciliation_status,
    'review_status', mir.review_status,
    'review_fingerprint', mir.review_fingerprint
  ) order by mir.row_number, mir.id), '[]'::jsonb)
  into rows_fingerprint
  from public.masterlist_import_rows mir
  where mir.import_id = p_import_id;

  manifest_fingerprint := md5(jsonb_build_object(
    'import_id', p_import_id,
    'term_id', target_term_id,
    'previous_term_id', previous_term_id,
    'rows', rows_fingerprint,
    'affected_students', affected_students
  )::text);

  return jsonb_build_object(
    'import_id', p_import_id,
    'academic_term_id', target_term_id,
    'previous_academic_term_id', previous_term_id,
    'affected_count', affected_count,
    'affected_students', affected_students,
    'fingerprint', manifest_fingerprint
  );
end;
$function$;

create or replace function public.kandid_preview_masterlist_full_roster(
  p_import_id integer,
  p_actor_admin_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if not exists (
    select 1 from public.admin_users a
    where a.id = p_actor_admin_id and a.role = 'super_admin' and a.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Active Super Admin authorization required.';
  end if;
  return public.kandid_masterlist_full_roster_manifest(p_import_id);
end;
$function$;

create or replace function public.kandid_confirm_masterlist_full_roster(
  p_import_id integer,
  p_actor_admin_id bigint,
  p_expected_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  current_manifest jsonb;
begin
  if not exists (
    select 1 from public.admin_users a
    where a.id = p_actor_admin_id and a.role = 'super_admin' and a.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Active Super Admin authorization required.';
  end if;
  current_manifest := public.kandid_masterlist_full_roster_manifest(p_import_id);
  if p_expected_fingerprint is null
     or p_expected_fingerprint is distinct from current_manifest->>'fingerprint' then
    raise exception using errcode = '40001', message = 'Full-roster preview changed. Refresh the affected-Student preview before confirming.';
  end if;
  update public.masterlist_imports
  set full_roster_confirmed_by = p_actor_admin_id,
      full_roster_confirmed_at = clock_timestamp(),
      full_roster_confirmation_fingerprint = p_expected_fingerprint
  where id = p_import_id and import_scope = 'full_roster' and import_status = 'review';
  if not found then
    raise exception using errcode = '55000', message = 'Full-roster confirmation could not be recorded.';
  end if;
  return current_manifest;
end;
$function$;

-- Core row application is now incremental-only. Absence reconciliation is
-- deliberately moved into the trusted wrapper below and cannot happen here.
create or replace function public.finalize_masterlist_import(target_import_id integer)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target_term_id integer;
  target_scope text;
  current_import_status text;
  current_term_status text;
  actual_total integer;
  actual_invalid integer;
  actual_conflicts integer;
  actual_pending integer;
  actual_unapproved_shifted integer;
  r record;
  resolved_student_id integer;
begin
  select mi.academic_term_id, mi.import_scope, mi.import_status, at.status
    into target_term_id, target_scope, current_import_status, current_term_status
  from public.masterlist_imports mi
  join public.academic_terms at on at.id = mi.academic_term_id
  where mi.id = target_import_id
  for update of mi;
  if target_term_id is null then
    raise exception 'Masterlist import % does not exist.', target_import_id;
  end if;
  if target_scope is null or target_scope not in ('incremental', 'full_roster') then
    raise exception using errcode = '22023', message = 'Masterlist import scope is missing or unknown.';
  end if;
  if current_import_status <> 'review' then
    raise exception 'Masterlist import % must be in review status before finalization. Current status: %.', target_import_id, current_import_status;
  end if;
  if current_term_status = 'closed' then
    raise exception 'Cannot finalize a masterlist for a closed academic term.';
  end if;

  select count(*), count(*) filter (where reconciliation_status = 'invalid'),
    count(*) filter (where reconciliation_status = 'conflict'),
    count(*) filter (where reconciliation_status = 'pending'),
    count(*) filter (where reconciliation_status = 'shifted_program' and review_status <> 'approved')
  into actual_total, actual_invalid, actual_conflicts, actual_pending, actual_unapproved_shifted
  from public.masterlist_import_rows where import_id = target_import_id;
  if actual_total = 0 then raise exception 'Cannot finalize an empty masterlist import.'; end if;
  if actual_pending > 0 then
    raise exception 'Cannot finalize masterlist import %. % row(s) are still pending reconciliation.', target_import_id, actual_pending;
  end if;
  if actual_invalid > 0 then raise exception 'Cannot finalize masterlist import %. % invalid row(s) must be resolved first.', target_import_id, actual_invalid; end if;
  if actual_conflicts > 0 then raise exception 'Cannot finalize masterlist import %. % conflict row(s) must be resolved first.', target_import_id, actual_conflicts; end if;
  if actual_unapproved_shifted > 0 then raise exception 'Cannot finalize masterlist import %. % shifted program row(s) require approval first.', target_import_id, actual_unapproved_shifted; end if;

  for r in
    select * from public.masterlist_import_rows
    where import_id = target_import_id
      and reconciliation_status in ('new', 'continuing', 'shifted_program', 'returnee')
    order by row_number
  loop
    resolved_student_id := null;
    if r.reconciliation_status = 'new' then
      insert into public.students (student_number, first_name, last_name, email, program, year_level, is_shs, status)
      values (trim(r.student_number), trim(r.first_name), trim(r.last_name), nullif(trim(r.email), ''), r.program, r.year_level, r.is_shs, 'pending')
      returning id into resolved_student_id;
      update public.masterlist_import_rows set matched_student_id = resolved_student_id where id = r.id;
    else
      resolved_student_id := r.matched_student_id;
      if resolved_student_id is null then
        raise exception 'Row % is classified as % but has no matched student.', r.row_number, r.reconciliation_status;
      end if;
    end if;

    insert into public.student_term_enrollments (student_id, academic_term_id, program, year_level, is_shs, enrollment_status, source)
    values (resolved_student_id, target_term_id, r.program, r.year_level, r.is_shs, 'enrolled', 'masterlist')
    on conflict (student_id, academic_term_id) do update set
      program = excluded.program, year_level = excluded.year_level, is_shs = excluded.is_shs,
      enrollment_status = 'enrolled', source = 'masterlist', updated_at = now();
  end loop;

  update public.masterlist_imports
  set import_status = 'finalized', finalized_at = now(), total_rows = actual_total,
      invalid_rows = actual_invalid, conflict_rows = actual_conflicts
  where id = target_import_id;
end;
$function$;

create or replace function public.kandid_finalize_masterlist_import_with_membership_sync(
  p_import_id integer,
  p_actor_admin_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  actor_ok boolean;
  import_term_id integer;
  import_status text;
  import_scope text;
  confirmation_actor bigint;
  confirmation_at timestamptz;
  confirmation_fingerprint text;
  current_manifest jsonb;
  active_term_count integer;
  active_term_id integer;
  r record;
  v_resolved_program_id bigint;
  org record;
  membership public.student_organization_terms%rowtype;
  previous_activation_marker text;
  previous_reconcile_actor text;
  previous_reconcile_student text;
  previous_reconcile_term text;
  synced_membership_count integer := 0;
  synced_term_count integer := 0;
  removed_term_count integer := 0;
  removed_rows integer := 0;
  processed_student_count integer := 0;
begin
  select exists (select 1 from public.admin_users a where a.id = p_actor_admin_id and a.role = 'super_admin' and a.status = 'active')
    into actor_ok;
  if not actor_ok then raise exception using errcode = '42501', message = 'Active Super Admin authorization required.'; end if;
  if p_import_id is null or p_import_id <= 0 then raise exception using errcode = '22023', message = 'A valid masterlist import is required.'; end if;

  select mi.academic_term_id, mi.import_status, mi.import_scope,
         mi.full_roster_confirmed_by, mi.full_roster_confirmed_at,
         mi.full_roster_confirmation_fingerprint
    into import_term_id, import_status, import_scope, confirmation_actor,
         confirmation_at, confirmation_fingerprint
  from public.masterlist_imports mi where mi.id = p_import_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Masterlist import was not found.'; end if;
  if import_status <> 'review' then raise exception using errcode = '55000', message = 'Masterlist import must be in review before finalization.'; end if;
  if import_scope is null or import_scope not in ('incremental', 'full_roster') then
    raise exception using errcode = '22023', message = 'Masterlist import scope is missing or unknown.';
  end if;
  if import_scope = 'full_roster' then
    if confirmation_actor is distinct from p_actor_admin_id or confirmation_at is null then
      raise exception using errcode = '42501', message = 'An active Super Admin must explicitly confirm the full-roster absence preview.';
    end if;
    -- Confirmation and finalization are separate requests. Take a write-blocking
    -- table lock before revalidating the manifest so no enrollment insert/update/
    -- delete can change the absence population between validation and the sweep.
    -- If a write committed before this lock was acquired, the refreshed manifest
    -- below differs and the finalization fails with a stale-preview error.
    lock table public.student_term_enrollments in share row exclusive mode;
    current_manifest := public.kandid_masterlist_full_roster_manifest(p_import_id);
    if confirmation_fingerprint is null or confirmation_fingerprint is distinct from current_manifest->>'fingerprint' then
      raise exception using errcode = '40001', message = 'Full-roster preview changed after confirmation. Refresh and confirm the affected-Student list again.';
    end if;
  end if;

  perform public.finalize_masterlist_import(p_import_id);

  if import_scope = 'full_roster' then
    -- Consume the precise list whose fingerprint was confirmed; do not rerun
    -- population selection after validation.
    insert into public.student_term_enrollments (student_id, academic_term_id, program, year_level, is_shs, enrollment_status, source)
    select (affected.student->>'student_id')::integer,
      import_term_id,
      affected.student->>'program',
      (affected.student->>'year_level')::integer,
      coalesce((affected.student->>'is_shs')::boolean, false),
      'not_in_masterlist', 'masterlist'
    from jsonb_array_elements(current_manifest->'affected_students') as affected(student)
    on conflict (student_id, academic_term_id) do update set
      enrollment_status = 'not_in_masterlist', source = 'masterlist', updated_at = now();
  end if;

  select count(*)::integer, min(t.id) into active_term_count, active_term_id
  from public.academic_terms t where t.status = 'active';
  if active_term_count <> 1 then
    raise exception using errcode = '55000', message = 'Exactly one active academic term is required for membership reconciliation.';
  end if;
  if import_term_id <> active_term_id then
    return jsonb_build_object('processed_student_count', 0, 'membership_synced_count', 0,
      'term_participation_synced_count', 0, 'removed_term_participation_count', 0, 'admission_skipped_count', 0);
  end if;

  previous_activation_marker := current_setting('kandid.membership_activation_term_id', true);
  previous_reconcile_actor := current_setting('kandid.program_reconcile_actor_id', true);
  previous_reconcile_student := current_setting('kandid.program_reconcile_student_id', true);
  previous_reconcile_term := current_setting('kandid.program_reconcile_term_id', true);

  for r in
    select distinct ste.student_id, ste.program
    from public.masterlist_import_rows mir
    join public.student_term_enrollments ste on ste.student_id = mir.matched_student_id and ste.academic_term_id = import_term_id
    where mir.import_id = p_import_id and mir.reconciliation_status in ('new', 'continuing', 'shifted_program', 'returnee')
      and mir.matched_student_id is not null and ste.enrollment_status = 'enrolled'
    order by ste.student_id
  loop
    perform pg_advisory_xact_lock(r.student_id, import_term_id);
    select program_entry.id into v_resolved_program_id
    from public.kandid_ensure_program_catalog_entry_for_server_actor(r.program, p_actor_admin_id) program_entry;
    if v_resolved_program_id is null then raise exception using errcode = '23503', message = 'Current enrollment program could not be resolved.'; end if;
    perform set_config('kandid.membership_activation_term_id', import_term_id::text, true);
    perform set_config('kandid.program_reconcile_actor_id', p_actor_admin_id::text, true);
    perform set_config('kandid.program_reconcile_student_id', r.student_id::text, true);
    perform set_config('kandid.program_reconcile_term_id', import_term_id::text, true);

    update public.student_organization_terms sot
    set status = 'removed', removed_by = p_actor_admin_id, removed_at = clock_timestamp(),
        removal_reason = 'program_change_reconciliation', updated_at = clock_timestamp()
    from public.organizations o
    where sot.student_id = r.student_id and sot.academic_term_id = import_term_id and sot.status = 'active'
      and o.id = sot.organization_id and o.membership_scope = 'program'
      and not exists (select 1 from public.organization_programs op where op.organization_id = o.id and op.program_id = v_resolved_program_id);
    get diagnostics removed_rows = row_count;
    removed_term_count := removed_term_count + removed_rows;

    for org in
      select o.id from public.organizations o
      where o.membership_scope = 'institution' or (o.membership_scope = 'program' and exists (
        select 1 from public.organization_programs op where op.organization_id = o.id and op.program_id = v_resolved_program_id))
      order by o.id
    loop
      select sot.* into membership from public.student_organization_terms sot
      where sot.student_id = r.student_id and sot.organization_id = org.id and sot.academic_term_id = import_term_id for update;
      if found then
        if membership.status = 'removed' then
          update public.student_organization_terms sot set status = 'active', source = 'system', removed_by = null,
            removed_at = null, removal_reason = null, updated_at = clock_timestamp() where sot.id = membership.id;
          synced_term_count := synced_term_count + 1;
        elsif membership.status <> 'active' then
          raise exception using errcode = '23514', message = 'Unsupported current-term membership status.';
        end if;
      else
        insert into public.student_organization_terms (student_id, organization_id, academic_term_id, status, source)
        values (r.student_id, org.id, import_term_id, 'active', 'system');
        synced_term_count := synced_term_count + 1;
      end if;
      insert into public.student_organizations (student_id, organization_id, role)
      values (r.student_id, org.id, 'member') on conflict (student_id, organization_id) do nothing;
      synced_membership_count := synced_membership_count + 1;
    end loop;
    processed_student_count := processed_student_count + 1;
  end loop;

  perform set_config('kandid.membership_activation_term_id', coalesce(previous_activation_marker, ''), true);
  perform set_config('kandid.program_reconcile_actor_id', coalesce(previous_reconcile_actor, ''), true);
  perform set_config('kandid.program_reconcile_student_id', coalesce(previous_reconcile_student, ''), true);
  perform set_config('kandid.program_reconcile_term_id', coalesce(previous_reconcile_term, ''), true);
  return jsonb_build_object('processed_student_count', processed_student_count,
    'membership_synced_count', synced_membership_count, 'term_participation_synced_count', synced_term_count,
    'removed_term_participation_count', removed_term_count, 'admission_skipped_count', 0);
end;
$function$;

alter function public.kandid_masterlist_full_roster_manifest(integer) owner to postgres;
alter function public.kandid_preview_masterlist_full_roster(integer, bigint) owner to postgres;
alter function public.kandid_confirm_masterlist_full_roster(integer, bigint, text) owner to postgres;
alter function public.finalize_masterlist_import(integer) owner to postgres;
alter function public.kandid_finalize_masterlist_import_with_membership_sync(integer, bigint) owner to postgres;

revoke all on function public.kandid_masterlist_full_roster_manifest(integer) from public, anon, authenticated, service_role;
grant execute on function public.kandid_masterlist_full_roster_manifest(integer) to service_role;
revoke all on function public.kandid_preview_masterlist_full_roster(integer, bigint) from public, anon, authenticated, service_role;
grant execute on function public.kandid_preview_masterlist_full_roster(integer, bigint) to service_role;
revoke all on function public.kandid_confirm_masterlist_full_roster(integer, bigint, text) from public, anon, authenticated, service_role;
grant execute on function public.kandid_confirm_masterlist_full_roster(integer, bigint, text) to service_role;
revoke all on function public.finalize_masterlist_import(integer) from public, anon, authenticated, service_role;
grant execute on function public.finalize_masterlist_import(integer) to service_role;
revoke all on function public.kandid_finalize_masterlist_import_with_membership_sync(integer, bigint) from public, anon, authenticated, service_role;
grant execute on function public.kandid_finalize_masterlist_import_with_membership_sync(integer, bigint) to service_role;

do $postflight$
declare
  bad_function_contract boolean;
begin
  if (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'masterlist_imports' and column_name = 'import_scope') not like '%incremental%'
     or (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'masterlist_imports' and column_name = 'import_scope') <> 'NO' then
    raise exception 'Masterlist import scope default/nullability contract failed.';
  end if;
  if not has_function_privilege('service_role', 'public.kandid_masterlist_full_roster_manifest(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.kandid_masterlist_full_roster_manifest(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.kandid_masterlist_full_roster_manifest(integer)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.kandid_preview_masterlist_full_roster(integer,bigint)', 'EXECUTE')
     or has_function_privilege('anon', 'public.kandid_preview_masterlist_full_roster(integer,bigint)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.kandid_preview_masterlist_full_roster(integer,bigint)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.kandid_confirm_masterlist_full_roster(integer,bigint,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.kandid_confirm_masterlist_full_roster(integer,bigint,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.kandid_confirm_masterlist_full_roster(integer,bigint,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.kandid_finalize_masterlist_import_with_membership_sync(integer,bigint)', 'EXECUTE')
     or has_function_privilege('anon', 'public.kandid_finalize_masterlist_import_with_membership_sync(integer,bigint)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.kandid_finalize_masterlist_import_with_membership_sync(integer,bigint)', 'EXECUTE') then
    raise exception 'Masterlist import-scope RPC execution contract failed.';
  end if;
  if not has_function_privilege('service_role', 'public.finalize_masterlist_import(integer)', 'EXECUTE') then
    raise exception 'Trusted core Masterlist finalizer is not executable by service_role.';
  end if;
  if has_function_privilege('anon', 'public.finalize_masterlist_import(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.finalize_masterlist_import(integer)', 'EXECUTE') then
    raise exception 'Core Masterlist finalizer is exposed to a browser role.';
  end if;
  select exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid in (
      pg_catalog.to_regprocedure('public.kandid_masterlist_full_roster_manifest(integer)'),
      pg_catalog.to_regprocedure('public.kandid_preview_masterlist_full_roster(integer,bigint)'),
      pg_catalog.to_regprocedure('public.kandid_confirm_masterlist_full_roster(integer,bigint,text)'),
      pg_catalog.to_regprocedure('public.finalize_masterlist_import(integer)'),
      pg_catalog.to_regprocedure('public.kandid_finalize_masterlist_import_with_membership_sync(integer,bigint)')
    )
      and (not p.prosecdef or p.proconfig::text not like '%search_path=pg_catalog%'
        or (select r.rolname from pg_catalog.pg_roles r where r.oid = p.proowner) <> 'postgres'
        or exists (
          select 1 from pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
          where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
        ))
  ) into bad_function_contract;
  if bad_function_contract then
    raise exception 'Masterlist scope function owner, SECURITY DEFINER, search path, or PUBLIC grant contract failed.';
  end if;
end;
$postflight$;

notify pgrst, 'reload schema';
commit;
