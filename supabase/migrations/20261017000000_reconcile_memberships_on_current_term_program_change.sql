begin;

do $preflight$
declare
  finalizer_security_definer boolean;
  finalizer_owner text;
begin
  if to_regprocedure('public.finalize_masterlist_import(integer)') is null
     or to_regprocedure('public.review_masterlist_import_row(integer,text,text,text)') is null
     or to_regprocedure('public.kandid_resolve_program_catalog_id(text)') is null
     or to_regprocedure('public.kandid_ensure_program_catalog_entry_for_server_actor(text,bigint)') is null
     or to_regprocedure('public.resolve_student_organization_participation(integer,integer,integer)') is null then
    raise exception 'Program-change reconciliation prerequisites are missing; migration stopped.';
  end if;
  if to_regclass('public.students') is null
     or to_regclass('public.student_term_enrollments') is null
     or to_regclass('public.student_organization_terms') is null
     or to_regclass('public.student_organizations') is null
     or to_regclass('public.organization_programs') is null
     or to_regclass('public.masterlist_imports') is null
     or to_regclass('public.masterlist_import_rows') is null
     or to_regclass('public.organizations') is null
     or to_regclass('public.admin_users') is null then
    raise exception 'Program-change reconciliation tables are missing; migration stopped.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = 'public.student_organization_terms'::regclass
      and attname in ('removed_by', 'removed_at', 'removal_reason')
      and not attisdropped
    group by attrelid having count(*) = 3
  ) then
    raise exception 'Term-membership removal contract differs; migration stopped.';
  end if;
  select p.prosecdef, pg_catalog.pg_get_userbyid(p.proowner)
    into finalizer_security_definer, finalizer_owner
  from pg_catalog.pg_proc p
  where p.oid = 'public.finalize_masterlist_import(integer)'::regprocedure;
  if not finalizer_security_definer or finalizer_owner <> 'postgres'
     or not has_function_privilege('service_role', 'public.finalize_masterlist_import(integer)', 'EXECUTE') then
    raise exception 'Masterlist finalizer authorization contract differs; migration stopped.';
  end if;
end;
$preflight$;

-- Permit scoped term-membership transitions only inside the trusted,
-- service-role-only reconciliation routine below. Ordinary callers and the
-- Board's manual-membership workflow remain unable to alter scoped rows.
create or replace function public.guard_student_organization_term_admission()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  organization_scope text;
  organization_type_value text;
  active_term_id integer;
  active_term_count integer;
  enrollment_program text;
  resolved_program_id bigint;
  previous_term_id integer;
  previous_academic_year text;
  previous_semester text;
  sync_term_setting text;
  reconciliation_actor_id bigint;
  reconciliation_student_id integer;
  reconciliation_term_id integer;
  admission_row record;
begin
  select o.membership_scope, o.organization_type
    into organization_scope, organization_type_value
  from public.organizations o where o.id = new.organization_id;

  if not found or organization_scope is null
     or organization_scope not in ('program', 'institution', 'manual') then
    raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:UNSUPPORTED_MEMBERSHIP_SCOPE';
  end if;
  if organization_type_value is null
     or organization_type_value not in ('departmental', 'non_departmental')
     or (organization_scope = 'program' and organization_type_value <> 'departmental')
     or (organization_scope = 'manual' and organization_type_value <> 'non_departmental') then
    raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:UNSUPPORTED_ORGANIZATION_TYPE';
  end if;

  if tg_op = 'UPDATE' and old.status is distinct from new.status
     and organization_scope <> 'manual' then
    reconciliation_actor_id := nullif(pg_catalog.current_setting('kandid.program_reconcile_actor_id', true), '')::bigint;
    reconciliation_student_id := nullif(pg_catalog.current_setting('kandid.program_reconcile_student_id', true), '')::integer;
    reconciliation_term_id := nullif(pg_catalog.current_setting('kandid.program_reconcile_term_id', true), '')::integer;

    if reconciliation_actor_id is null
       or reconciliation_student_id is distinct from new.student_id
       or reconciliation_term_id is distinct from new.academic_term_id
       or old.student_id is distinct from new.student_id
       or old.organization_id is distinct from new.organization_id
       or old.academic_term_id is distinct from new.academic_term_id
       or not exists (
         select 1 from public.admin_users a
         where a.id = reconciliation_actor_id
           and a.role = 'super_admin'
           and a.status = 'active'
       ) then
      raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:ACTIVATION_SYNC_REQUIRED';
    end if;

    if old.status = 'active' and new.status = 'removed' then
      select pg_catalog.count(*)::integer, pg_catalog.min(t.id)
        into active_term_count, active_term_id
      from public.academic_terms t where t.status = 'active';
      if active_term_count <> 1 or new.academic_term_id <> active_term_id
         or organization_scope <> 'program'
         or new.removed_by is distinct from reconciliation_actor_id
         or new.removed_at is null
         or new.removal_reason is distinct from 'program_change_reconciliation' then
        raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:ACTIVATION_SYNC_REQUIRED';
      end if;

      select ste.program into enrollment_program
      from public.student_term_enrollments ste
      where ste.student_id = new.student_id
        and ste.academic_term_id = new.academic_term_id
        and ste.enrollment_status = 'enrolled';
      if not found then
        raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:NOT_CURRENTLY_ENROLLED';
      end if;
      resolved_program_id := public.kandid_resolve_program_catalog_id(enrollment_program);
      if resolved_program_id is null or exists (
        select 1 from public.organization_programs op
        where op.organization_id = new.organization_id
          and op.program_id = resolved_program_id
      ) then
        raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:PROGRAM_STILL_ELIGIBLE';
      end if;
      return new;
    elsif old.status = 'removed' and new.status = 'active' then
      if new.source <> 'system'
         or new.removed_by is not null
         or new.removed_at is not null
         or new.removal_reason is not null then
        raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:ACTIVATION_SYNC_REQUIRED';
      end if;
    else
      raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:ACTIVATION_SYNC_REQUIRED';
    end if;
  end if;

  if new.status is distinct from 'active' then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and old.status = 'active'
    and old.student_id = new.student_id
    and old.organization_id = new.organization_id
    and old.academic_term_id = new.academic_term_id then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(new.student_id, new.academic_term_id);
  select pg_catalog.count(*)::integer, pg_catalog.min(t.id)
    into active_term_count, active_term_id
  from public.academic_terms t where t.status = 'active';
  if active_term_count <> 1 or new.academic_term_id <> active_term_id then
    raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:TERM_NOT_ACTIVE';
  end if;

  select ste.program into enrollment_program
  from public.student_term_enrollments ste
  where ste.student_id = new.student_id
    and ste.academic_term_id = new.academic_term_id
    and ste.enrollment_status = 'enrolled';
  if not found then
    raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:NOT_CURRENTLY_ENROLLED';
  end if;

  sync_term_setting := pg_catalog.current_setting('kandid.membership_activation_term_id', true);
  if new.source = 'system' and sync_term_setting = new.academic_term_id::text then
    if organization_scope = 'manual' then
      select t.academic_year, t.semester into previous_academic_year, previous_semester
      from public.academic_terms t where t.id = new.academic_term_id;
      if previous_semester = '2nd Semester' then
        previous_semester := '1st Semester';
      elsif previous_semester = '1st Semester' then
        previous_academic_year :=
          (pg_catalog.split_part(previous_academic_year, '-', 1)::integer - 1)::text
          || '-' || pg_catalog.split_part(previous_academic_year, '-', 1);
        previous_semester := '2nd Semester';
      else
        raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:UNSUPPORTED_ACADEMIC_TERM';
      end if;
      select t.id into previous_term_id from public.academic_terms t
      where t.academic_year = previous_academic_year and t.semester = previous_semester and t.status = 'closed';
      if previous_term_id is null or not exists (
        select 1 from public.student_organization_terms prior
        where prior.student_id = new.student_id and prior.organization_id = new.organization_id
          and prior.academic_term_id = previous_term_id and prior.status = 'active'
      ) then
        raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:ACTIVATION_SYNC_REQUIRED';
      end if;
      return new;
    end if;
    if organization_scope = 'program' then
      resolved_program_id := public.kandid_resolve_program_catalog_id(enrollment_program);
      if resolved_program_id is null or not exists (
        select 1 from public.organization_programs op
        where op.organization_id = new.organization_id and op.program_id = resolved_program_id
      ) then
        raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:PROGRAM_NOT_ELIGIBLE_FOR_ORGANIZATION';
      end if;
    end if;
    return new;
  end if;

  if organization_scope <> 'manual' then
    raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:ACTIVATION_SYNC_REQUIRED';
  end if;
  select * into admission_row from public.kandid_check_student_organization_admission(
    new.student_id, new.organization_id, new.academic_term_id
  );
  if not coalesce(admission_row.allowed, false) then
    raise exception using errcode = '23514',
      message = 'MEMBERSHIP_ADMISSION_DENIED:' || coalesce(admission_row.reason, 'ACTIVE_TERM_UNAVAILABLE');
  end if;
  return new;
end;
$function$;

alter function public.guard_student_organization_term_admission() owner to postgres;
revoke all on function public.guard_student_organization_term_admission() from public, anon, authenticated, service_role;

-- This RPC finalizes a reviewed import and reconciles all of its current-term
-- automatic memberships in the same transaction. Manual memberships and
-- previous-term records are never changed.
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
  active_term_count integer;
  active_term_id integer;
  r record;
  program_id bigint;
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
  select exists (
    select 1 from public.admin_users a
    where a.id = p_actor_admin_id and a.role = 'super_admin' and a.status = 'active'
  ) into actor_ok;
  if not actor_ok then
    raise exception using errcode = '42501', message = 'Active Super Admin authorization required.';
  end if;
  if p_import_id is null or p_import_id <= 0 then
    raise exception using errcode = '22023', message = 'A valid masterlist import is required.';
  end if;

  select mi.academic_term_id, mi.import_status into import_term_id, import_status
  from public.masterlist_imports mi where mi.id = p_import_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Masterlist import was not found.';
  end if;
  if import_status <> 'review' then
    raise exception using errcode = '55000', message = 'Masterlist import must be in review before finalization.';
  end if;

  perform public.finalize_masterlist_import(p_import_id);

  select pg_catalog.count(*)::integer, pg_catalog.min(t.id)
    into active_term_count, active_term_id
  from public.academic_terms t where t.status = 'active';
  if active_term_count <> 1 then
    raise exception using errcode = '55000', message = 'Exactly one active academic term is required for membership reconciliation.';
  end if;
  if import_term_id <> active_term_id then
    return pg_catalog.jsonb_build_object(
      'processed_student_count', 0, 'membership_synced_count', 0,
      'term_participation_synced_count', 0, 'removed_term_participation_count', 0,
      'admission_skipped_count', 0
    );
  end if;

  previous_activation_marker := pg_catalog.current_setting('kandid.membership_activation_term_id', true);
  previous_reconcile_actor := pg_catalog.current_setting('kandid.program_reconcile_actor_id', true);
  previous_reconcile_student := pg_catalog.current_setting('kandid.program_reconcile_student_id', true);
  previous_reconcile_term := pg_catalog.current_setting('kandid.program_reconcile_term_id', true);

  for r in
    select distinct ste.student_id, ste.program
    from public.masterlist_import_rows mir
    join public.student_term_enrollments ste
      on ste.student_id = mir.matched_student_id and ste.academic_term_id = import_term_id
    where mir.import_id = p_import_id
      and mir.reconciliation_status in ('new', 'continuing', 'shifted_program', 'returnee')
      and mir.matched_student_id is not null
      and ste.enrollment_status = 'enrolled'
    order by ste.student_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(r.student_id, import_term_id);
    select program_entry.id into program_id
    from public.kandid_ensure_program_catalog_entry_for_server_actor(r.program, p_actor_admin_id) program_entry;
    if program_id is null then
      raise exception using errcode = '23503', message = 'Current enrollment program could not be resolved.';
    end if;

    perform pg_catalog.set_config('kandid.membership_activation_term_id', import_term_id::text, true);
    perform pg_catalog.set_config('kandid.program_reconcile_actor_id', p_actor_admin_id::text, true);
    perform pg_catalog.set_config('kandid.program_reconcile_student_id', r.student_id::text, true);
    perform pg_catalog.set_config('kandid.program_reconcile_term_id', import_term_id::text, true);

    update public.student_organization_terms sot
    set status = 'removed', removed_by = p_actor_admin_id,
        removed_at = pg_catalog.clock_timestamp(),
        removal_reason = 'program_change_reconciliation', updated_at = pg_catalog.clock_timestamp()
    from public.organizations o
    where sot.student_id = r.student_id and sot.academic_term_id = import_term_id
      and sot.status = 'active' and o.id = sot.organization_id
      and o.membership_scope = 'program'
      and not exists (
        select 1 from public.organization_programs op
        where op.organization_id = o.id and op.program_id = program_id
      );
    get diagnostics removed_rows = row_count;
    removed_term_count := removed_term_count + removed_rows;

    for org in
      select o.id from public.organizations o
      where o.membership_scope = 'institution'
         or (o.membership_scope = 'program' and exists (
           select 1 from public.organization_programs op
           where op.organization_id = o.id and op.program_id = program_id
         ))
      order by o.id
    loop
      select sot.* into membership from public.student_organization_terms sot
      where sot.student_id = r.student_id and sot.organization_id = org.id
        and sot.academic_term_id = import_term_id for update;
      if found then
        if membership.status = 'removed' then
          update public.student_organization_terms sot
          set status = 'active', source = 'system', removed_by = null,
              removed_at = null, removal_reason = null, updated_at = pg_catalog.clock_timestamp()
          where sot.id = membership.id;
          synced_term_count := synced_term_count + 1;
        elsif membership.status <> 'active' then
          raise exception using errcode = '23514', message = 'Unsupported current-term membership status.';
        end if;
      else
        insert into public.student_organization_terms (
          student_id, organization_id, academic_term_id, status, source
        ) values (r.student_id, org.id, import_term_id, 'active', 'system');
        synced_term_count := synced_term_count + 1;
      end if;

      insert into public.student_organizations (student_id, organization_id, role)
      values (r.student_id, org.id, 'member')
      on conflict (student_id, organization_id) do nothing;
      synced_membership_count := synced_membership_count + 1;
    end loop;
    processed_student_count := processed_student_count + 1;
  end loop;

  perform pg_catalog.set_config('kandid.membership_activation_term_id', coalesce(previous_activation_marker, ''), true);
  perform pg_catalog.set_config('kandid.program_reconcile_actor_id', coalesce(previous_reconcile_actor, ''), true);
  perform pg_catalog.set_config('kandid.program_reconcile_student_id', coalesce(previous_reconcile_student, ''), true);
  perform pg_catalog.set_config('kandid.program_reconcile_term_id', coalesce(previous_reconcile_term, ''), true);

  return pg_catalog.jsonb_build_object(
    'processed_student_count', processed_student_count,
    'membership_synced_count', synced_membership_count,
    'term_participation_synced_count', synced_term_count,
    'removed_term_participation_count', removed_term_count,
    'admission_skipped_count', 0
  );
end;
$function$;

alter function public.kandid_finalize_masterlist_import_with_membership_sync(integer, bigint) owner to postgres;
revoke all on function public.kandid_finalize_masterlist_import_with_membership_sync(integer, bigint) from public, anon, authenticated, service_role;
grant execute on function public.kandid_finalize_masterlist_import_with_membership_sync(integer, bigint) to service_role;

-- Reconcile a same-term program change in a pending Masterlist Review. The
-- normal semester-to-semester reconciliation remains authoritative when it
-- already identifies a shifted row.
create or replace function public.kandid_review_current_term_program_changes(
  p_import_id integer,
  p_actor_admin_id bigint
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target_term_id integer;
  term_is_active boolean;
  changed_count integer := 0;
begin
  if not exists (
    select 1 from public.admin_users a
    where a.id = p_actor_admin_id and a.role = 'super_admin' and a.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Active Super Admin authorization required.';
  end if;
  select mi.academic_term_id, (t.status = 'active')
    into target_term_id, term_is_active
  from public.masterlist_imports mi
  join public.academic_terms t on t.id = mi.academic_term_id
  where mi.id = p_import_id and mi.import_status in ('draft', 'review')
  for update of mi;
  if target_term_id is null then
    raise exception using errcode = 'P0002', message = 'Editable Masterlist import was not found.';
  end if;
  if not term_is_active then
    return 0;
  end if;

  with program_changes as (
    select mir.id, s.id as student_id, current_enrollment.program as prior_program,
      upper(pg_catalog.btrim(rir.program)) as incoming_program,
      pg_catalog.concat_ws('|', 'current_term_shifted_program', s.id::text,
        lower(pg_catalog.btrim(rir.student_number)),
        lower(pg_catalog.btrim(current_enrollment.program)),
        lower(pg_catalog.btrim(rir.program)), target_term_id::text) as review_fingerprint
    from public.masterlist_import_rows mir
    join public.students s on s.id = mir.matched_student_id
    join public.student_term_enrollments current_enrollment
      on current_enrollment.student_id = s.id
     and current_enrollment.academic_term_id = target_term_id
     and current_enrollment.enrollment_status = 'enrolled'
    join public.masterlist_import_rows rir on rir.id = mir.id
    where mir.import_id = p_import_id
      and mir.reconciliation_status in ('conflict', 'continuing')
      and lower(pg_catalog.btrim(s.first_name)) = lower(pg_catalog.btrim(rir.first_name))
      and lower(pg_catalog.btrim(s.last_name)) = lower(pg_catalog.btrim(rir.last_name))
      and lower(pg_catalog.btrim(current_enrollment.program)) <> lower(pg_catalog.btrim(rir.program))
      and (select count(*) from public.masterlist_import_rows duplicate_row
        where duplicate_row.import_id = p_import_id
          and lower(pg_catalog.btrim(duplicate_row.student_number)) = lower(pg_catalog.btrim(rir.student_number))) = 1
  )
  update public.masterlist_import_rows mir
  set reconciliation_status = 'shifted_program',
      issue_message = 'Current-term program change detected: ' || program_changes.prior_program || ' -> ' || program_changes.incoming_program || '. Review required.',
      review_status = case when mir.review_status = 'approved' and mir.review_fingerprint = program_changes.review_fingerprint then 'approved' else 'pending_review' end,
      review_decision = case when mir.review_status = 'approved' and mir.review_fingerprint = program_changes.review_fingerprint then mir.review_decision else null end,
      reviewed_by = case when mir.review_status = 'approved' and mir.review_fingerprint = program_changes.review_fingerprint then mir.reviewed_by else null end,
      reviewed_at = case when mir.review_status = 'approved' and mir.review_fingerprint = program_changes.review_fingerprint then mir.reviewed_at else null end,
      review_note = case when mir.review_status = 'approved' and mir.review_fingerprint = program_changes.review_fingerprint then mir.review_note else null end,
      review_fingerprint = program_changes.review_fingerprint
  from program_changes where mir.id = program_changes.id;
  get diagnostics changed_count = row_count;
  return changed_count;
end;
$function$;

alter function public.kandid_review_current_term_program_changes(integer, bigint) owner to postgres;
revoke all on function public.kandid_review_current_term_program_changes(integer, bigint) from public, anon, authenticated, service_role;
grant execute on function public.kandid_review_current_term_program_changes(integer, bigint) to service_role;

do $postflight$
declare
  trigger_enabled "char";
begin
  if to_regprocedure('public.kandid_finalize_masterlist_import_with_membership_sync(integer,bigint)') is null
     or to_regprocedure('public.kandid_review_current_term_program_changes(integer,bigint)') is null then
    raise exception 'Program-change reconciliation functions are missing after migration.';
  end if;
  if not has_function_privilege('service_role', 'public.kandid_finalize_masterlist_import_with_membership_sync(integer,bigint)', 'EXECUTE')
     or has_function_privilege('anon', 'public.kandid_finalize_masterlist_import_with_membership_sync(integer,bigint)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.kandid_finalize_masterlist_import_with_membership_sync(integer,bigint)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.kandid_review_current_term_program_changes(integer,bigint)', 'EXECUTE')
     or has_function_privilege('anon', 'public.kandid_review_current_term_program_changes(integer,bigint)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.kandid_review_current_term_program_changes(integer,bigint)', 'EXECUTE') then
    raise exception 'Program-change reconciliation function grants do not match the trusted service-role contract.';
  end if;
  select t.tgenabled into trigger_enabled
  from pg_catalog.pg_trigger t
  where t.tgrelid = 'public.student_organization_terms'::regclass
    and t.tgname = 'student_organization_terms_admission_guard'
    and not t.tgisinternal;
  if trigger_enabled is distinct from 'O' then
    raise exception 'The term-membership admission guard is missing or disabled after migration.';
  end if;
end;
$postflight$;

notify pgrst, 'reload schema';
commit;
