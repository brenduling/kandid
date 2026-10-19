begin;

-- Link an election to an academic semester and retain exact officer service
-- start/end instants. Historical term labels are matched only when they exactly
-- identify one existing academic term; dates/result timestamps are not guessed.
alter table public.elections
  add column if not exists academic_term_id integer
  references public.academic_terms(id) on delete restrict;
alter table public.officers
  add column if not exists academic_term_id integer
  references public.academic_terms(id) on delete restrict,
  add column if not exists service_started_at timestamptz,
  add column if not exists service_ended_at timestamptz;
alter table public.officer_leadership_releases
  add column if not exists academic_term_id integer
  references public.academic_terms(id) on delete restrict,
  add column if not exists term_label text;

create index if not exists elections_academic_term_id_idx on public.elections(academic_term_id);
create index if not exists officers_academic_term_id_idx on public.officers(academic_term_id);

do $constraint$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.officers'::regclass
      and conname = 'officers_service_timestamp_order_check'
  ) then
    alter table public.officers add constraint officers_service_timestamp_order_check
      check (service_ended_at is null or service_started_at is null or service_ended_at >= service_started_at);
  end if;
end;
$constraint$;

with canonical_terms as (
  select t.id,
    pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(t.semester || ' AY ' || t.academic_year), '[[:space:]]+', ' ', 'g')) as label_key,
    count(*) over (
      partition by pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(t.semester || ' AY ' || t.academic_year), '[[:space:]]+', ' ', 'g'))
    ) as matching_terms
  from public.academic_terms t
), unique_terms as (
  select id, label_key from canonical_terms where matching_terms = 1
)
update public.officers o
set academic_term_id = t.id
from unique_terms t
where o.academic_term_id is null
  and nullif(pg_catalog.btrim(o.term_label), '') is not null
  and pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(o.term_label), '[[:space:]]+', ' ', 'g')) = t.label_key;

with election_context as (
  select o.election_id, min(o.academic_term_id) as academic_term_id
  from public.officers o
  where o.election_id is not null
  group by o.election_id
  having count(distinct o.academic_term_id) = 1
     and count(*) filter (where o.academic_term_id is null) = 0
)
update public.elections e
set academic_term_id = context.academic_term_id
from election_context context
where e.id = context.election_id and e.academic_term_id is null;

create or replace function private.kandid_assign_election_academic_term()
returns trigger language plpgsql volatile security definer set search_path = pg_catalog
as $function$
begin
  if tg_op = 'UPDATE' then
    if old.academic_term_id is not null and new.academic_term_id is distinct from old.academic_term_id then
      raise exception using errcode = '42501',
        message = 'An election academic term cannot be changed after it is recorded.';
    end if;
    return new;
  end if;

  if new.academic_term_id is null then
    raise exception using errcode = '22023',
      message = 'Choose the academic term this election belongs to.';
  end if;
  return new;
end;
$function$;
revoke all on function private.kandid_assign_election_academic_term() from public, anon, authenticated, service_role;
drop trigger if exists elections_assign_academic_term on public.elections;
create trigger elections_assign_academic_term
before insert or update of academic_term_id on public.elections
for each row execute function private.kandid_assign_election_academic_term();

create or replace function private.kandid_assign_officer_release_context()
returns trigger language plpgsql volatile security definer set search_path = pg_catalog
as $function$
declare
  term_count integer := 0;
  current_term_id integer;
  active_term_id integer;
begin
  new.academic_term_id := null;
  new.term_label := null;

  if new.election_id is not null then
    select e.academic_term_id into new.academic_term_id
    from public.elections e
    where e.id = new.election_id and e.organization_id = new.organization_id;
    if new.academic_term_id is null then
      raise exception using errcode = '22023',
        message = 'Choose an academic term for the election before releasing leadership.';
    end if;
  end if;

  if new.academic_term_id is null and new.election_id is null then
    select count(distinct o.academic_term_id)::integer,
           min(o.academic_term_id)
      into term_count, current_term_id
    from public.officers o
    where o.organization_id = new.organization_id and o.is_current;

    if term_count = 1 then
      new.academic_term_id := current_term_id;
    elsif term_count > 1 then
      raise exception using errcode = '22023',
        message = 'Current Leadership has conflicting academic-term context. Establish one leadership semester before release.';
    else
      select t.id into active_term_id
      from public.academic_terms t
      where t.status = 'active'
      order by t.activated_at desc nulls last, t.created_at desc, t.id desc
      limit 1;
      new.academic_term_id := active_term_id;
      if new.academic_term_id is null then
        raise exception using errcode = '22023',
          message = 'Establish or select an academic term before releasing leadership.';
      end if;
    end if;
  end if;

  if new.academic_term_id is not null then
    select t.semester || ' AY ' || t.academic_year into new.term_label
    from public.academic_terms t where t.id = new.academic_term_id;
  end if;
  return new;
end;
$function$;
revoke all on function private.kandid_assign_officer_release_context() from public, anon, authenticated, service_role;
drop trigger if exists officer_releases_assign_term_context on public.officer_leadership_releases;
create trigger officer_releases_assign_term_context
before insert on public.officer_leadership_releases
for each row execute function private.kandid_assign_officer_release_context();

create or replace function private.kandid_assign_officer_term_and_service()
returns trigger language plpgsql volatile security definer set search_path = pg_catalog
as $function$
declare
  release_at timestamptz;
  release_term_id integer;
  active_term_id integer;
  election_term_id integer;
  term_count integer := 0;
  current_term_id integer;
  start_timestamp timestamptz;
  end_timestamp timestamptz;
begin
  select r.released_at, r.academic_term_id
    into release_at, release_term_id
  from public.officer_leadership_releases r
  where r.organization_id = new.organization_id
    and r.released_at >= transaction_timestamp()
    and r.released_at <= clock_timestamp()
  order by r.released_at desc, r.id desc
  limit 1;

  if tg_op = 'INSERT' then
    if new.is_current then
      -- Resolve all Current term metadata from trusted election/release/current
      -- context; never preserve a browser-supplied label or academic term.
      new.academic_term_id := null;
      new.term_label := null;
    end if;
    if new.election_id is not null then
      select e.academic_term_id into new.academic_term_id
      from public.elections e where e.id = new.election_id;
      if new.academic_term_id is null then
        raise exception using errcode = '22023',
          message = 'Choose an academic term for the election before making its officers Current.';
      end if;
    end if;
    if new.academic_term_id is null then
      new.academic_term_id := release_term_id;
    end if;

    if new.academic_term_id is null and new.election_id is null and release_at is null and new.is_current then
      select count(distinct o.academic_term_id)::integer,
             min(o.academic_term_id)
        into term_count, current_term_id
      from public.officers o
      where o.organization_id = new.organization_id and o.is_current;

      if term_count = 1 then
        new.academic_term_id := current_term_id;
      elsif term_count > 1 then
        raise exception using errcode = '22023',
          message = 'Current Leadership has conflicting academic-term context. Establish one leadership semester before adding an officer.';
      else
        select t.id into active_term_id
        from public.academic_terms t
        where t.status = 'active'
        order by t.activated_at desc nulls last, t.created_at desc, t.id desc
        limit 1;
        new.academic_term_id := active_term_id;
        if new.academic_term_id is null and new.is_current then
          raise exception using errcode = '22023',
            message = 'Establish or select an academic term for Current Leadership before adding an officer.';
        end if;
      end if;
    end if;

    if new.academic_term_id is not null then
      select t.semester || ' AY ' || t.academic_year into new.term_label
      from public.academic_terms t where t.id = new.academic_term_id;
    end if;

    if new.is_current then
      start_timestamp := coalesce(release_at, transaction_timestamp());
      new.service_started_at := start_timestamp;
      new.service_ended_at := null;
      new.term_start := pg_catalog.timezone('Asia/Manila', start_timestamp)::date;
    else
      new.service_started_at := null;
      new.service_ended_at := null;
    end if;
  else
    new.academic_term_id := old.academic_term_id;
    if not old.is_current and new.is_current then
      if new.election_id is not null then
        select e.academic_term_id into election_term_id
        from public.elections e where e.id = new.election_id;
        if election_term_id is null then
          raise exception using errcode = '22023',
            message = 'Choose an academic term for the election before making its officers Current.';
        end if;
        if old.academic_term_id is not null and old.academic_term_id is distinct from election_term_id then
          raise exception using errcode = '22023',
            message = 'The officer term does not match the linked election academic term.';
        end if;
        new.academic_term_id := coalesce(old.academic_term_id, election_term_id);
      elsif new.academic_term_id is null then
        new.academic_term_id := release_term_id;
      end if;
      if new.academic_term_id is null then
        raise exception using errcode = '22023',
          message = 'Establish or select an academic term before making an officer Current.';
      end if;
      start_timestamp := coalesce(release_at, transaction_timestamp());
      new.service_started_at := start_timestamp;
      new.service_ended_at := null;
      new.term_start := pg_catalog.timezone('Asia/Manila', start_timestamp)::date;
    elsif old.is_current and not new.is_current then
      end_timestamp := coalesce(release_at, transaction_timestamp());
      new.service_started_at := old.service_started_at;
      new.service_ended_at := end_timestamp;
      new.term_end := coalesce(new.term_end, pg_catalog.timezone('Asia/Manila', end_timestamp)::date);
    else
      new.service_started_at := old.service_started_at;
      new.service_ended_at := old.service_ended_at;
      if new.is_current and old.service_started_at is not null then
        new.term_start := pg_catalog.timezone('Asia/Manila', old.service_started_at)::date;
      end if;
    end if;
  end if;

  if new.academic_term_id is not null then
    select t.semester || ' AY ' || t.academic_year into new.term_label
    from public.academic_terms t where t.id = new.academic_term_id;
  end if;

  if new.service_started_at is not null and new.term_end is not null
     and new.term_end < pg_catalog.timezone('Asia/Manila', new.service_started_at)::date then
    raise exception using errcode = '22023', message = 'End of service must be on or after the service start.';
  end if;
  return new;
end;
$function$;
revoke all on function private.kandid_assign_officer_term_and_service() from public, anon, authenticated, service_role;
drop trigger if exists officers_assign_term_and_service on public.officers;
create trigger officers_assign_term_and_service
before insert or update of is_current, academic_term_id, service_started_at, service_ended_at, term_start, term_end, term_label
on public.officers for each row execute function private.kandid_assign_officer_term_and_service();

create or replace view public.officer_directory
with (security_barrier = true)
as
select
  o.id,
  o.organization_id,
  org.name as organization_name,
  coalesce(nullif(pg_catalog.btrim(pg_catalog.concat_ws(' ', s.first_name, s.last_name)), ''), o.officer_name) as officer_name,
  o.position_title,
  o.term_label,
  o.term_start,
  o.term_end,
  o.status,
  o.is_current,
  o.display_order,
  coalesce(o.photo_url, s.photo_url) as photo_url,
  s.first_name,
  s.last_name,
  o.academic_term_id,
  o.service_started_at,
  o.service_ended_at
from public.officers o
left join public.students s on s.id = o.student_id
left join public.organizations org on org.id = o.organization_id;
grant select on table public.officer_directory to anon, authenticated;

create or replace function public.kandid_add_current_officer(
  p_organization_id bigint,
  p_selection_type text,
  p_student_id integer,
  p_candidate_id integer,
  p_position_title text,
  p_service jsonb,
  p_confirm_term_context boolean
)
returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog
as $function$
declare
  organization_id_value bigint;
  student_id_value integer;
  position_title_value text;
  candidate_row record;
  winner_result jsonb;
  service_value jsonb;
  created_officer jsonb;
begin
  organization_id_value := private.kandid_assert_officer_org_scope(p_organization_id);
  perform pg_catalog.pg_advisory_xact_lock(913027, organization_id_value::integer);

  if p_selection_type is null or p_selection_type not in ('appointed', 'elected') then
    raise exception using errcode = '22023', message = 'Officer selection type must be appointed or elected.';
  end if;
  if p_service is null or pg_catalog.jsonb_typeof(p_service) <> 'object'
     or exists (
       select 1 from pg_catalog.jsonb_object_keys(coalesce(p_service, '{}'::jsonb)) as keys(key)
       where key not in ('term_label', 'term_start', 'term_end', 'photo_url', 'remarks')
     ) then
    raise exception using errcode = '22023', message = 'Invalid officer service fields.';
  end if;

  -- Ignore legacy client labels and starts. Only an optional end date and
  -- ordinary officer metadata remain user-entered.
  service_value := private.kandid_sanitize_officer_service(pg_catalog.jsonb_build_object(
    'term_end', p_service->>'term_end',
    'photo_url', p_service->>'photo_url',
    'remarks', p_service->>'remarks'
  ));

  if p_selection_type = 'appointed' then
    if p_student_id is null or p_candidate_id is not null
       or nullif(pg_catalog.btrim(p_position_title), '') is null
       or pg_catalog.length(pg_catalog.btrim(p_position_title)) > 160 then
      raise exception using errcode = '22023', message = 'A valid appointed student and position are required.';
    end if;
    student_id_value := p_student_id;
    position_title_value := pg_catalog.btrim(p_position_title);
    perform private.kandid_assert_eligible_officer_student(organization_id_value, student_id_value);
  else
    if p_candidate_id is null or p_student_id is not null
       or nullif(pg_catalog.btrim(p_position_title), '') is not null then
      raise exception using errcode = '22023', message = 'An elected officer must be selected by verified candidate ID only.';
    end if;

    select c.id as candidate_id, c.student_id, p.id as position_id,
           p.name as position_name, p.election_id,
           e.organization_id, e.results_released_at
      into candidate_row
    from public.candidates c
    join public.positions p on p.id = c.position_id
    join public.elections e on e.id = p.election_id
    where c.id = p_candidate_id
    for share of c, p, e;
    if not found or candidate_row.student_id is null then
      raise exception using errcode = '22023', message = 'Candidate is not assigned to a valid student position.';
    end if;
    if candidate_row.organization_id is distinct from organization_id_value then
      raise exception using errcode = '42501', message = 'Candidate is outside your organization.';
    end if;
    if candidate_row.results_released_at is null
       or not public.kandid_election_is_closed(candidate_row.election_id) then
      raise exception using errcode = '22023', message = 'Candidate election is not finalized and closed.';
    end if;

    winner_result := public.kandid_get_officer_winners(null, organization_id_value);
    if (winner_result #>> '{selected_election,election_id}')::integer is distinct from candidate_row.election_id then
      raise exception using errcode = '42501', message = 'The selected candidate is not a winner from the latest eligible election.';
    end if;
    if not exists (
      select 1
      from pg_catalog.jsonb_array_elements(winner_result #> '{selected_election,positions}') as position_result(value)
      where value->>'outcome' = 'winner'
        and (value->>'candidate_id')::integer = p_candidate_id
        and (value->>'position_id')::integer = candidate_row.position_id
    ) then
      raise exception using errcode = '42501', message = 'Candidate is not the unique positive winner for this position.';
    end if;
    student_id_value := candidate_row.student_id;
    position_title_value := candidate_row.position_name;
  end if;

  if exists (
    select 1 from public.officers o
    where o.organization_id = organization_id_value and o.is_current
      and pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(o.position_title), '[[:space:]]+', ' ', 'g'))
        = pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(position_title_value), '[[:space:]]+', ' ', 'g'))
  ) then
    raise exception using errcode = '23505', message = 'Current position is already occupied.';
  end if;
  if exists (
    select 1 from public.officers o
    where o.organization_id = organization_id_value and o.is_current and o.student_id = student_id_value
  ) then
    raise exception using errcode = '23505', message = 'Student already serves in Current Leadership.';
  end if;

  perform pg_catalog.set_config('kandid.allow_leadership_turnover', 'on', true);
  if p_selection_type = 'appointed' then
    created_officer := public.kandid_create_appointed_officer(
      organization_id_value, student_id_value, position_title_value,
      service_value || pg_catalog.jsonb_build_object('is_current', true)
    );
  else
    created_officer := public.kandid_create_elected_officer(
      p_candidate_id, service_value || pg_catalog.jsonb_build_object('is_current', true)
    );
  end if;
  return created_officer || pg_catalog.jsonb_build_object('target', 'current');
end;
$function$;

revoke all on function public.kandid_add_current_officer(bigint, text, integer, integer, text, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.kandid_add_current_officer(bigint, text, integer, integer, text, jsonb, boolean)
  to authenticated;

notify pgrst, 'reload schema';
commit;
