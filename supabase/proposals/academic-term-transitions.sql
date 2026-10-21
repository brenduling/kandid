-- LOCAL PROPOSAL ONLY. Do not apply to a connected project without explicit approval.
-- Existing terms/enrollments/mappings remain the only operating sources of truth.
begin;
set local lock_timeout='2s';

do $preflight$
declare name text;
begin
  if current_user <> 'postgres' then raise exception 'Reviewed postgres execution required.'; end if;
  if to_regclass('private.academic_term_transition_reviews') is not null then
    raise exception 'Academic term transition proposal already installed; stop rather than overwrite.';
  end if;
  foreach name in array array[
    'public.activate_academic_term(integer)',
    'public.sync_organization_term_participation_for_activation(integer)',
    'public.kandid_resolve_program_catalog_id(text)',
    'public.resolve_student_organization_participation(integer,integer,integer)',
    'public.kandid_guard_candidate_mutation()',
    'public.kandid_check_student_ballot_eligibility(integer)',
    'private.kandid_require_locked_electorate_for_ballot()',
    'public.kandid_finalize_masterlist_import_with_membership_sync(integer,bigint)',
    'public.kandid_board_register_verified_student_for_term_v1(bigint,integer,text,text,text,text,text,integer,text,boolean,boolean,text,text,text)'
  ] loop
    if to_regprocedure(name) is null then raise exception 'Missing reviewed prerequisite: %', name; end if;
    if (select pg_catalog.pg_get_userbyid(proowner) from pg_catalog.pg_proc where oid=to_regprocedure(name)) is distinct from 'postgres' then
      raise exception 'Prerequisite owner differs: %',name;
    end if;
  end loop;
  if not has_function_privilege('service_role','public.activate_academic_term(integer)','EXECUTE')
     or has_function_privilege('authenticated','public.activate_academic_term(integer)','EXECUTE')
     or has_function_privilege('anon','public.activate_academic_term(integer)','EXECUTE') then
    raise exception 'Legacy activation ACL differs; review before installation.';
  end if;
  if not exists (select 1 from pg_catalog.pg_index i
      where i.indrelid='public.academic_terms'::regclass and i.indisunique and i.indisvalid
        and pg_catalog.pg_get_expr(i.indpred,i.indrelid) = '(status = ''active''::text)') then
    raise exception 'Verified single-active-term unique index required.';
  end if;
  if (select pg_catalog.pg_get_constraintdef(c.oid) from pg_catalog.pg_constraint c
      where c.conrelid='public.student_notifications'::regclass and c.conname='student_notifications_type_check')
      is distinct from 'CHECK ((type = ANY (ARRAY[''organization_removed''::text, ''organization_restored''::text])))' then
    raise exception 'Notification type baseline differs; preserve and review its actual types.';
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid='public.candidates'::regclass
      and t.tgname='candidates_trusted_mutation_guard' and t.tgenabled='O'
      and t.tgfoid='public.kandid_guard_candidate_mutation()'::regprocedure) then
    raise exception 'Existing candidate authorization trigger required.';
  end if;
  if not exists(select 1 from pg_catalog.pg_trigger t where t.tgrelid='public.audit_logs'::regclass
    and t.tgname='audit_logs_prepare_insert' and t.tgenabled='O'
    and t.tgfoid=to_regprocedure('public.kandid_prepare_audit_event()')) then
    raise exception 'Existing trusted audit timestamp/normalization trigger required.';
  end if;
  if not exists(select 1 from pg_catalog.pg_trigger t where t.tgrelid='public.vote_ballots'::regclass
    and t.tgname='vote_ballots_require_locked_electorate' and t.tgenabled='O'
    and t.tgfoid='private.kandid_require_locked_electorate_for_ballot()'::regprocedure)
    or to_regprocedure('private.kandid_student_is_live_eligible(integer,integer)') is null then
    raise exception 'Installed canonical voting predicate and atomic ballot trigger required.';
  end if;
end;
$preflight$;

-- A review/operation receipt, not another academic term or enrollment registry.
-- Snapshot data is aggregate-only. Sensitive input rows are hashed, never stored.
create table private.academic_term_transition_reviews (
  operation_id uuid primary key default pg_catalog.gen_random_uuid(),
  actor_auth_user_id uuid not null,
  actor_admin_id bigint not null references public.admin_users(id),
  source_term_id integer references public.academic_terms(id),
  target_term_id integer not null references public.academic_terms(id),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  expires_at timestamptz not null,
  fingerprint text not null,
  impact jsonb not null,
  committed_at timestamptz,
  result jsonb,
  check ((committed_at is null) = (result is null))
);
alter table private.academic_term_transition_reviews enable row level security;
revoke all on private.academic_term_transition_reviews from public,anon,authenticated,service_role;

alter table public.student_notifications drop constraint student_notifications_type_check;
alter table public.student_notifications add constraint student_notifications_type_check
  check (type in ('organization_removed','organization_restored','academic_term_activated'));
create unique index student_notifications_term_transition_recipient_idx
  on public.student_notifications (student_id, (metadata->>'transition_id'))
  where type='academic_term_activated';

create function private.kandid_term_transition_actor(p_auth_user_id uuid)
returns bigint language plpgsql security definer set search_path=pg_catalog as $function$
declare actor_id bigint;
begin
  if p_auth_user_id is null or (select count(*) from public.admin_users where auth_user_id=p_auth_user_id) <> 1 then
    raise exception using errcode='42501',message='A unique active Super Admin identity is required.';
  end if;
  select id into actor_id from public.admin_users
  where auth_user_id=p_auth_user_id and role='super_admin' and status='active';
  if actor_id is null then raise exception using errcode='42501',message='Active Super Admin authorization required.'; end if;
  return actor_id;
end;
$function$;

create function private.kandid_lock_term_transition_inputs()
returns void language plpgsql security definer set search_path=pg_catalog as $function$
begin
  -- Also bound any later advisory/row waits inside the reused synchronizer.
  -- This setting is transaction-local and resets when the RPC transaction ends.
  perform pg_catalog.set_config('lock_timeout','2s',true);
  if not pg_catalog.pg_try_advisory_xact_lock(20261003,12000) then
    raise exception using errcode='55P03',message='Academic term transition is busy. Refresh and retry.';
  end if;
  -- EXCLUSIVE permits normal SELECT/navigation, but conflicts with both DML
  -- and FOR SHARE/UPDATE. NOWAIT avoids lock inversion with existing writers.
  -- No application writer needs a new lock/version convention to participate.
  lock table public.academic_terms,public.admin_users,public.elections,
    public.masterlist_imports,public.masterlist_import_rows,public.organizations,
    public.organization_programs,public.programs,public.student_organizations,
    public.student_organization_terms,public.student_term_enrollments,public.students
    in exclusive mode nowait;
end;
$function$;

-- Draft creation shares the transition lock and derives sequencing from the
-- authoritative active row. It never calls activation or membership writers.
create function public.kandid_create_next_academic_term(p_actor_auth_user_id uuid,p_semester text,p_start_year integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $function$
declare current_term public.academic_terms%rowtype; draft public.academic_terms%rowtype;
  actor_id bigint; expected_year integer; expected_semester text;
begin
  perform private.kandid_lock_term_transition_inputs();
  actor_id := private.kandid_term_transition_actor(p_actor_auth_user_id);
  if (select count(*) from public.academic_terms where status='active') <> 1 then
    raise exception using errcode='55000',message='Exactly one active term is required; setup/recovery is separate.';
  end if;
  select * into current_term from public.academic_terms where status='active';
  expected_year := split_part(current_term.academic_year,'-',1)::integer;
  if current_term.semester='1st Semester' then expected_semester := '2nd Semester';
  elsif current_term.semester='2nd Semester' then expected_year := expected_year+1; expected_semester := '1st Semester';
  else raise exception using errcode='55000',message='Current semester configuration requires review.'; end if;
  if p_start_year is distinct from expected_year or p_start_year not between 2000 and 2200
    or p_semester is distinct from expected_semester then
    raise exception using errcode='22023',message='Only the immediate next academic term may be created.';
  end if;
  select * into draft from public.academic_terms where academic_year=expected_year::text||'-'||(expected_year+1)::text and semester=expected_semester;
  if found then
    if draft.status='draft' then return to_jsonb(draft); end if;
    raise exception using errcode='55000',message='The next academic term already exists and is not a draft.';
  end if;
  insert into public.academic_terms(academic_year,semester,status)
    values(expected_year::text||'-'||(expected_year+1)::text,expected_semester,'draft') returning * into draft;
  insert into public.audit_logs(user_id,actor_name,actor_role,action,event_type,event_category,entity_type,entity_id,entity_label,status,event_origin,metadata)
    select actor_id,a.full_name,'super_admin','Academic term created','academic_term_created','system','academic_term',draft.id::text,
      draft.semester||' AY '||draft.academic_year,'completed','trusted_database',jsonb_build_object('source_term_id',current_term.id,'target_term_id',draft.id)
    from public.admin_users a where a.id=actor_id;
  return to_jsonb(draft);
end;
$function$;

create function private.kandid_academic_term_transition_impact(p_target_term_id integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $function$
declare
  source_row public.academic_terms%rowtype;
  target_row public.academic_terms%rowtype;
  active_count integer;
  counts jsonb;
  blockers jsonb := '[]'::jsonb;
  state jsonb;
  expected_year integer;
  expected_semester text;
  unresolved_count integer;
  conflict_count integer;
  election_count integer;
  invalid_scope_count integer;
begin
  if p_target_term_id is null or p_target_term_id <= 0 then
    raise exception using errcode='22023',message='A valid target academic term is required.';
  end if;
  select * into target_row from public.academic_terms where id=p_target_term_id;
  if not found then raise exception using errcode='P0002',message='Target academic term not found.'; end if;
  select count(*) into active_count from public.academic_terms where status='active';
  if active_count=1 then select * into source_row from public.academic_terms where status='active';
  else blockers := blockers || jsonb_build_array('Exactly one active academic term is required; setup/recovery is separate.'); end if;
  if target_row.status <> 'draft' then blockers := blockers || jsonb_build_array('Target must be a draft academic term.'); end if;
  if source_row.id is not null then
    expected_year := split_part(source_row.academic_year,'-',1)::integer;
    if source_row.semester='1st Semester' then expected_semester := '2nd Semester';
    elsif source_row.semester='2nd Semester' then expected_year := expected_year+1; expected_semester := '1st Semester';
    else blockers := blockers || jsonb_build_array('Current semester configuration is invalid.'); end if;
    if target_row.academic_year is distinct from expected_year::text||'-'||(expected_year+1)::text
       or target_row.semester is distinct from expected_semester then
      blockers := blockers || jsonb_build_array('Only the immediate next academic term may be activated.');
    end if;
  end if;

  select count(*) into unresolved_count from public.student_term_enrollments e
    where e.academic_term_id=p_target_term_id and e.enrollment_status='enrolled'
      and public.kandid_resolve_program_catalog_id(e.program) is null;
  select count(*) into conflict_count
    from public.student_organization_terms m join public.organizations o on o.id=m.organization_id
    join public.student_term_enrollments e on e.student_id=m.student_id and e.academic_term_id=m.academic_term_id
    where m.academic_term_id=p_target_term_id and m.status='active' and e.enrollment_status='enrolled'
      and o.membership_scope='program' and not exists (select 1 from public.organization_programs op
        where op.organization_id=o.id and op.program_id=public.kandid_resolve_program_catalog_id(e.program));
  select count(*) into election_count from public.elections e
    where (e.academic_term_id=source_row.id or e.academic_term_id is null)
      and e.removed_at is null and lower(coalesce(e.status,'')) <> 'archived'
      and (e.end_date is null or e.end_date > timezone('Asia/Manila',clock_timestamp()));
  select count(*) into invalid_scope_count from public.organizations o
    where o.membership_scope is null or o.membership_scope not in ('program','institution','manual')
      or o.organization_type is null or o.organization_type not in ('departmental','non_departmental')
      or (o.membership_scope='program' and o.organization_type<>'departmental')
      or (o.membership_scope='manual' and o.organization_type<>'non_departmental');
  if unresolved_count > 0 then blockers := blockers || jsonb_build_array('Target enrollments contain unresolved or ambiguous programs.'); end if;
  if conflict_count > 0 then blockers := blockers || jsonb_build_array('Target term contains conflicting program-specific memberships.'); end if;
  if election_count > 0 then blockers := blockers || jsonb_build_array('Current-term or legacy elections are ongoing, scheduled, or have unresolved schedules.'); end if;
  if invalid_scope_count > 0 then blockers := blockers || jsonb_build_array('Organization membership configuration requires review.'); end if;
  -- Identity check only; actual membership is always derived from trusted scope.
  if (select count(*) from public.organizations where upper(trim(name)) in ('WITSG','WIT-SG','WIT SG')) <> 1
    or not exists(select 1 from public.organizations where upper(trim(name)) in ('WITSG','WIT-SG','WIT SG') and membership_scope='institution') then
    blockers := blockers || jsonb_build_array('WITSG institution-wide membership configuration requires review.');
  end if;

  select jsonb_build_object(
    'persistent_accounts',count(*),
    'active_accounts',count(*) filter(where s.status='active'),
    'pending_accounts',count(*) filter(where s.status='pending'),
    'disabled_accounts',count(*) filter(where s.status='disabled'),
    'source_enrolled_students',count(*) filter(where prior.enrollment_status='enrolled'),
    'target_enrolled_students',count(*) filter(where next.enrollment_status='enrolled'),
    'active_accounts_requiring_verification',count(*) filter(where s.status='active' and next.enrollment_status is distinct from 'enrolled'),
    'source_active_students_requiring_verification',count(*) filter(where s.status='active' and prior.enrollment_status='enrolled' and next.enrollment_status is distinct from 'enrolled'),
    'target_non_enrolled_students',count(*) filter(where next.student_id is not null and next.enrollment_status<>'enrolled'),
    'verified_program_shifts',count(*) filter(where prior.enrollment_status='enrolled' and next.enrollment_status='enrolled'
      and public.kandid_resolve_program_catalog_id(prior.program) <> public.kandid_resolve_program_catalog_id(next.program)),
    'unresolved_programs',unresolved_count,'conflicting_program_memberships',conflict_count,
    'blocking_elections',election_count,'notification_recipients',count(*)
  ) into counts from public.students s
  left join public.student_term_enrollments prior on prior.student_id=s.id and prior.academic_term_id=source_row.id
  left join public.student_term_enrollments next on next.student_id=s.id and next.academic_term_id=p_target_term_id;
  counts := counts || jsonb_build_object(
    'intended_program_memberships',(select count(*) from public.student_term_enrollments e
      join public.organization_programs op on op.program_id=public.kandid_resolve_program_catalog_id(e.program)
      join public.organizations o on o.id=op.organization_id and o.membership_scope='program'
      where e.academic_term_id=p_target_term_id and e.enrollment_status='enrolled'),
    'intended_institution_memberships',(select count(*) from public.student_term_enrollments e
      cross join public.organizations o where e.academic_term_id=p_target_term_id and e.enrollment_status='enrolled' and o.membership_scope='institution'),
    'manual_memberships_carried',(select count(*) from public.student_organization_terms m
      join public.organizations o on o.id=m.organization_id and o.membership_scope='manual'
      join public.student_term_enrollments e on e.student_id=m.student_id and e.academic_term_id=p_target_term_id and e.enrollment_status='enrolled'
      where m.academic_term_id=source_row.id and m.status='active'),
    'target_explicit_removals_preserved',(select count(*) from public.student_organization_terms where academic_term_id=p_target_term_id and status='removed')
  );
  -- Include identities/values, not only totals: equal-count substitutions must
  -- invalidate approval. Lock helper prevents all these inputs changing mid-read.
  state := jsonb_build_object(
    'terms',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.academic_terms t),
    'students',(select coalesce(jsonb_agg(jsonb_build_array(id,status,auth_user_id) order by id),'[]') from public.students),
    'enrollments',(select coalesce(jsonb_agg(to_jsonb(e) order by student_id,academic_term_id),'[]') from public.student_term_enrollments e where academic_term_id in(source_row.id,p_target_term_id)),
    'memberships',(select coalesce(jsonb_agg(to_jsonb(m) order by student_id,organization_id,academic_term_id),'[]') from public.student_organization_terms m where academic_term_id in(source_row.id,p_target_term_id)),
    'programs',(select coalesce(jsonb_agg(jsonb_build_array(id,code,name) order by id),'[]') from public.programs),
    'organizations',(select coalesce(jsonb_agg(jsonb_build_array(id,name,membership_scope,organization_type) order by id),'[]') from public.organizations),
    'coverage',(select coalesce(jsonb_agg(jsonb_build_array(organization_id,program_id) order by organization_id,program_id),'[]') from public.organization_programs),
    'elections',(select coalesce(jsonb_agg(jsonb_build_array(id,academic_term_id,status,campaign_start,campaign_end,start_date,end_date,removed_at) order by id),'[]') from public.elections where academic_term_id in(source_row.id,p_target_term_id) or academic_term_id is null),
    'counts',counts,'blockers',blockers
  );
  return jsonb_build_object('source_term',case when source_row.id is null then null else to_jsonb(source_row) end,
    'target_term',to_jsonb(target_row),'counts',counts,'blockers',blockers,'can_activate',jsonb_array_length(blockers)=0,
    'fingerprint',encode(sha256(convert_to(state::text,'UTF8')),'hex'));
end;
$function$;

create function public.kandid_preview_academic_term_transition(p_actor_auth_user_id uuid,p_target_term_id integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $function$
declare actor_id bigint; impact jsonb; review private.academic_term_transition_reviews%rowtype;
begin
  perform private.kandid_lock_term_transition_inputs();
  actor_id := private.kandid_term_transition_actor(p_actor_auth_user_id);
  impact := private.kandid_academic_term_transition_impact(p_target_term_id);
  insert into private.academic_term_transition_reviews(actor_auth_user_id,actor_admin_id,source_term_id,target_term_id,expires_at,fingerprint,impact)
  values(p_actor_auth_user_id,actor_id,(impact#>>'{source_term,id}')::integer,p_target_term_id,
    clock_timestamp()+interval '10 minutes',impact->>'fingerprint',impact) returning * into review;
  return jsonb_build_object('operation_id',review.operation_id,'created_at',review.created_at,'expires_at',review.expires_at,
    'status','review','impact',impact,'confirmation_text','ACTIVATE '||(impact#>>'{target_term,semester}')||' AY '||(impact#>>'{target_term,academic_year}'));
end;
$function$;

create function public.kandid_get_academic_term_transition(p_actor_auth_user_id uuid,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $function$
declare actor_id bigint; review private.academic_term_transition_reviews%rowtype; invalidated boolean;
begin
  perform private.kandid_lock_term_transition_inputs();
  actor_id := private.kandid_term_transition_actor(p_actor_auth_user_id);
  select * into review from private.academic_term_transition_reviews
    where operation_id=p_operation_id and actor_admin_id=actor_id and actor_auth_user_id=p_actor_auth_user_id;
  if not found then raise exception using errcode='P0002',message='Transition review not found for this administrator.'; end if;
  if review.committed_at is not null then return review.result; end if;
  invalidated := review.expires_at <= clock_timestamp() or
    (private.kandid_academic_term_transition_impact(review.target_term_id)->>'fingerprint') is distinct from review.fingerprint;
  if invalidated then
    -- Serialize with commit and permanently expire this stale review before
    -- allowing a browser to abandon an uncertain request and preview again.
    update private.academic_term_transition_reviews set expires_at=least(expires_at,clock_timestamp()) where operation_id=review.operation_id;
  end if;
  return jsonb_build_object('operation_id',review.operation_id,'status','review','created_at',review.created_at,
    'expires_at',review.expires_at,'impact',review.impact,'can_refresh',invalidated,
    'confirmation_text','ACTIVATE '||(review.impact#>>'{target_term,semester}')||' AY '||(review.impact#>>'{target_term,academic_year}'));
end;
$function$;

create function public.kandid_commit_academic_term_transition(
  p_actor_auth_user_id uuid,p_operation_id uuid,p_acknowledged boolean,p_confirmation_text text
)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $function$
declare
  actor_id bigint; review private.academic_term_transition_reviews%rowtype;
  impact jsonb; activated public.academic_terms%rowtype;
  audit_id bigint; notified integer; operation_result jsonb; expected_text text;
begin
  perform private.kandid_lock_term_transition_inputs();
  actor_id := private.kandid_term_transition_actor(p_actor_auth_user_id);
  select * into review from private.academic_term_transition_reviews
    where operation_id=p_operation_id and actor_admin_id=actor_id and actor_auth_user_id=p_actor_auth_user_id for update;
  if not found then raise exception using errcode='P0002',message='Transition review not found for this administrator.'; end if;
  expected_text := 'ACTIVATE '||(review.impact#>>'{target_term,semester}')||' AY '||(review.impact#>>'{target_term,academic_year}');
  if p_acknowledged is distinct from true or p_confirmation_text is distinct from expected_text then
    raise exception using errcode='22023',message='Explicit acknowledgement and exact term confirmation are required.';
  end if;
  if review.committed_at is not null then return review.result; end if;
  if clock_timestamp() >= review.expires_at then raise exception using errcode='40001',message='Transition review expired. Preview again.'; end if;
  impact := private.kandid_academic_term_transition_impact(review.target_term_id);
  if review.fingerprint is distinct from impact->>'fingerprint'
     or review.source_term_id is distinct from (impact#>>'{source_term,id}')::integer then
    raise exception using errcode='40001',message='Transition impact changed. Preview and confirm again.';
  end if;
  if impact->>'can_activate' is distinct from 'true' then
    raise exception using errcode='55000',message='Transition has blocking impacts. Resolve them and preview again.';
  end if;
  activated := public.activate_academic_term(review.target_term_id);
  -- Direct transactional delivery reuses the existing notification reader. No
  -- background producer, outbox or browser broadcast is needed for this version.
  insert into public.student_notifications(student_id,type,title,message,metadata)
  select s.id,'academic_term_activated','New semester: '||activated.semester||' AY '||activated.academic_year,
    'A new academic term is active. Your account and normal navigation remain available. Verify your current-term enrollment through an authorized masterlist or Electoral Board before voting or candidacy.',
    jsonb_build_object('transition_id',review.operation_id,'academic_term_id',activated.id,
      'previous_academic_term_id',review.source_term_id,'href','/student/profile') from public.students s;
  get diagnostics notified = row_count;
  insert into public.audit_logs(user_id,actor_name,actor_role,action,event_type,event_category,entity_type,
    entity_id,entity_label,status,event_origin,metadata)
  select actor_id,a.full_name,'super_admin','Academic term activated','academic_term_activated','system','academic_term',
    activated.id::text,activated.semester||' AY '||activated.academic_year,'completed','trusted_database',
    jsonb_build_object('operation_id',review.operation_id,'source_term',impact->'source_term','target_term',to_jsonb(activated),
      'impact_counts',impact->'counts','review_fingerprint',review.fingerprint,'notification_count',notified)
  from public.admin_users a where a.id=actor_id returning id into audit_id;
  if audit_id is null then raise exception 'Durable transition audit could not be recorded.'; end if;
  operation_result := jsonb_build_object('operation_id',review.operation_id,'status','committed','academic_term',to_jsonb(activated),
    'previous_academic_term_id',review.source_term_id,'audit_id',audit_id,'notification_count',notified,'committed_at',clock_timestamp());
  update private.academic_term_transition_reviews set committed_at=clock_timestamp(),result=operation_result
    where operation_id=review.operation_id;
  return operation_result;
end;
$function$;

-- Make unreviewed legacy activation internal; preserve its signature/body and
-- reuse it under the guarded SECURITY DEFINER wrapper above.
revoke all on function public.activate_academic_term(integer) from service_role;

-- Recheck term/enrollment at the actual restricted write, and hold the checked
-- rows until transaction completion. Existing canonical ballot integrity and
-- candidate authorization triggers continue to run unchanged.
create function private.kandid_require_current_term_participation(p_student_id integer,p_election_id integer)
returns void language plpgsql security definer set search_path=pg_catalog as $function$
declare active_id integer; active_count integer; election_term integer; org_id integer; enrollment_program text; allowed boolean;
begin
  perform id from public.academic_terms where status='active' order by id for share;
  select count(*),min(id) into active_count,active_id from public.academic_terms where status='active';
  select academic_term_id,organization_id into election_term,org_id from public.elections where id=p_election_id;
  if active_count<>1 or org_id is null or (election_term is not null and election_term<>active_id) then
    raise exception using errcode='42501',message='Restricted participation requires the current academic term.';
  end if;
  select program into enrollment_program from public.student_term_enrollments
    where student_id=p_student_id and academic_term_id=active_id and enrollment_status='enrolled' for share;
  if not found then raise exception using errcode='42501',message='Verified current-term enrollment is required.'; end if;
  perform organization_id from public.student_organization_terms
    where student_id=p_student_id and academic_term_id=active_id and status='active' for share;
  select p.allowed into allowed from public.resolve_student_organization_participation(p_student_id,org_id,active_id) p;
  if allowed is distinct from true then raise exception using errcode='42501',message='Current organization participation is required.'; end if;
  if exists(select 1 from public.student_organization_terms m join public.organizations o on o.id=m.organization_id
    where m.student_id=p_student_id and m.academic_term_id=active_id and m.status='active' and o.membership_scope='program'
      and not exists(select 1 from public.organization_programs op where op.organization_id=o.id
        and op.program_id=public.kandid_resolve_program_catalog_id(enrollment_program))) then
    raise exception using errcode='42501',message='Conflicting current program memberships require authorized reconciliation.';
  end if;
end;
$function$;

create function private.kandid_guard_current_term_candidate()
returns trigger language plpgsql security definer set search_path=pg_catalog as $function$
declare election_id integer; election_term integer; is_historical boolean;
begin
  if new.position_id is null then return new; end if; -- Existing guard authorizes detachment.
  select p.election_id,e.academic_term_id into election_id,election_term
    from public.positions p join public.elections e on e.id=p.election_id where p.id=new.position_id;
  if tg_op='UPDATE' and old.student_id is not distinct from new.student_id
    and old.position_id is not distinct from new.position_id then
    select status='closed' into is_historical from public.academic_terms where id=election_term;
    if is_historical is true then return new; end if; -- Preserve authorized historical metadata maintenance.
  end if;
  perform private.kandid_require_current_term_participation(new.student_id,election_id);
  return new;
end;
$function$;
create trigger candidates_require_current_term_enrollment before insert or update on public.candidates
  for each row execute function private.kandid_guard_current_term_candidate();

create function private.kandid_guard_current_term_ballot()
returns trigger language plpgsql security definer set search_path=pg_catalog as $function$
begin
  perform private.kandid_require_current_term_participation(new.student_id,new.election_id);
  return new;
end;
$function$;
create trigger aaa_ballots_require_current_term_enrollment before insert on public.vote_ballots
  for each row execute function private.kandid_guard_current_term_ballot();

-- Validate final state AFTER the existing trusted writers have reconciled a
-- verified shift. No new reassignment writer or profile-derived fallback.
create function private.kandid_guard_current_program_memberships()
returns trigger language plpgsql security definer set search_path=pg_catalog as $function$
declare current_program text;
begin
  if not exists(select 1 from public.academic_terms where id=new.academic_term_id and status='active') then return null; end if;
  select program into current_program from public.student_term_enrollments
    where student_id=new.student_id and academic_term_id=new.academic_term_id and enrollment_status='enrolled';
  if not found then return null; end if;
  if exists(select 1 from public.student_organization_terms m join public.organizations o on o.id=m.organization_id
    where m.student_id=new.student_id and m.academic_term_id=new.academic_term_id and m.status='active'
      and o.membership_scope='program' and not exists(select 1 from public.organization_programs op
        where op.organization_id=o.id and op.program_id=public.kandid_resolve_program_catalog_id(current_program))) then
    raise exception using errcode='23514',message='Conflicting current program memberships require authorized reconciliation.';
  end if;
  return null;
end;
$function$;
create constraint trigger enrollments_require_reconciled_program_memberships
  after insert or update on public.student_term_enrollments deferrable initially deferred
  for each row execute function private.kandid_guard_current_program_memberships();
create constraint trigger memberships_require_reconciled_program
  after insert or update on public.student_organization_terms deferrable initially deferred
  for each row execute function private.kandid_guard_current_program_memberships();

-- Close the default PUBLIC execution grant on every new helper and boundary.
do $acl$
declare signature text;
begin
  foreach signature in array array[
    'private.kandid_term_transition_actor(uuid)',
    'private.kandid_lock_term_transition_inputs()',
    'private.kandid_academic_term_transition_impact(integer)',
    'private.kandid_require_current_term_participation(integer,integer)',
    'private.kandid_guard_current_term_candidate()',
    'private.kandid_guard_current_term_ballot()',
    'private.kandid_guard_current_program_memberships()',
    'public.kandid_create_next_academic_term(uuid,text,integer)',
    'public.kandid_preview_academic_term_transition(uuid,integer)',
    'public.kandid_get_academic_term_transition(uuid,uuid)',
    'public.kandid_commit_academic_term_transition(uuid,uuid,boolean,text)'
  ]
  loop
    execute format('alter function %s owner to postgres',signature);
    execute format('revoke all on function %s from public,anon,authenticated,service_role',signature);
  end loop;
end;
$acl$;
grant execute on function public.kandid_create_next_academic_term(uuid,text,integer),
  public.kandid_preview_academic_term_transition(uuid,integer),
  public.kandid_get_academic_term_transition(uuid,uuid),
  public.kandid_commit_academic_term_transition(uuid,uuid,boolean,text) to service_role;
notify pgrst,'reload schema';
commit;
