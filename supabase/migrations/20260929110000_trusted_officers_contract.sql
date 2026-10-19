begin;

-- Align the tracked base table with the verified live officer contract while
-- keeping this forward migration safe when the live columns already exist.
alter table public.officers
  add column if not exists status varchar not null default 'current',
  add column if not exists remarks text,
  add column if not exists candidate_id integer,
  add column if not exists position_id integer;

alter table public.officers
  alter column status set not null;

-- Existing deployments have an election FK with SET NULL. Elected provenance
-- must survive parent deletion; appointments carry no election_id.
alter table public.officers
  drop constraint if exists officers_election_id_fkey,
  add constraint officers_election_id_fkey
    foreign key (election_id)
    references public.elections(id)
    on update restrict
    on delete restrict,
  add constraint officers_candidate_id_fkey
    foreign key (candidate_id)
    references public.candidates(id)
    on update restrict
    on delete restrict,
  add constraint officers_position_id_fkey
    foreign key (position_id)
    references public.positions(id)
    on update restrict
    on delete restrict;

-- is_current is the existing UI control; status is its legacy label. Normalize
-- the latter from the former, then keep the pair consistent on all writes.
update public.officers
set status = case when is_current then 'current' else 'past' end
where status is distinct from case when is_current then 'current' else 'past' end;

do $migration$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.officers'::pg_catalog.regclass
      and conname = 'officers_status_current_past_check'
  ) then
    alter table public.officers
      add constraint officers_status_current_past_check
      check (status in ('current', 'past'));
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.officers'::pg_catalog.regclass
      and conname = 'officers_status_matches_is_current_check'
  ) then
    alter table public.officers
      add constraint officers_status_matches_is_current_check
      check (
        (is_current and status = 'current')
        or (not is_current and status = 'past')
      );
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.officers'::pg_catalog.regclass
      and conname = 'officers_elected_provenance_check'
  ) then
    alter table public.officers
      add constraint officers_elected_provenance_check
      check (
        selection_type <> 'elected'
        or (
          organization_id is not null
          and student_id is not null
          and election_id is not null
          and position_id is not null
          and candidate_id is not null
          and nullif(pg_catalog.btrim(position_title), '') is not null
        )
      );
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.officers'::pg_catalog.regclass
      and conname = 'officers_appointed_provenance_check'
  ) then
    alter table public.officers
      add constraint officers_appointed_provenance_check
      check (
        selection_type <> 'appointed'
        or (
          organization_id is not null
          and student_id is not null
          and election_id is null
          and position_id is null
          and candidate_id is null
          and nullif(pg_catalog.btrim(position_title), '') is not null
        )
      );
  end if;
end;
$migration$;

create unique index officers_elected_election_position_uidx
  on public.officers (election_id, position_id)
  where selection_type = 'elected';

create unique index officers_elected_candidate_uidx
  on public.officers (candidate_id)
  where selection_type = 'elected';

create or replace function public.kandid_sync_officer_status()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'INSERT' then
    new.status := case when new.is_current then 'current' else 'past' end;
  elsif new.is_current is distinct from old.is_current then
    new.status := case when new.is_current then 'current' else 'past' end;
  elsif new.status is distinct from old.status then
    new.is_current := new.status = 'current';
  end if;
  return new;
end;
$function$;

revoke all on function public.kandid_sync_officer_status()
  from public, anon, authenticated;

drop trigger if exists officers_sync_status on public.officers;
create trigger officers_sync_status
before insert or update of is_current, status on public.officers
for each row execute function public.kandid_sync_officer_status();

create or replace function public.kandid_guard_officer_provenance()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'INSERT' then
    if new.selection_type in ('elected', 'appointed')
       and pg_catalog.current_setting('kandid.allow_officer_contract_write', true)
           is distinct from 'on' then
      raise exception using errcode = '42501',
        message = 'Officer records must be created through the trusted contract.';
    end if;
    return new;
  end if;

  if new.selection_type is distinct from old.selection_type then
    raise exception using errcode = '42501',
      message = 'Officer selection type cannot be changed.';
  end if;

  if old.selection_type = 'elected'
     and (
       new.organization_id is distinct from old.organization_id
       or new.student_id is distinct from old.student_id
       or new.election_id is distinct from old.election_id
       or new.position_id is distinct from old.position_id
       or new.candidate_id is distinct from old.candidate_id
       or new.officer_name is distinct from old.officer_name
       or new.position_title is distinct from old.position_title
     ) then
    raise exception using errcode = '42501',
      message = 'Elected officer provenance is immutable.';
  end if;

  if new.selection_type = 'appointed'
     and (
       new.election_id is not null
       or new.position_id is not null
       or new.candidate_id is not null
       or new.student_id is null
       or new.organization_id is null
     ) then
    raise exception using errcode = '42501',
      message = 'Appointed officers require an eligible student and no election provenance.';
  end if;

  return new;
end;
$function$;

revoke all on function public.kandid_guard_officer_provenance()
  from public, anon, authenticated;

drop trigger if exists officers_guard_provenance on public.officers;
create trigger officers_guard_provenance
before insert or update on public.officers
for each row execute function public.kandid_guard_officer_provenance();

create or replace function public.kandid_election_is_closed(p_election_id integer)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  election_row record;
  manila_now timestamp without time zone;
begin
  select e.status, e.end_date
    into election_row
  from public.elections e
  where e.id = p_election_id;

  if not found then
    return false;
  end if;

  -- Match getElectionPhase(): explicit closed wins; draft/archived do not
  -- become closed by elapsed time; otherwise the Manila wall-clock end
  -- boundary is half-open and resolves to closed at end_date.
  if election_row.status = 'closed' then
    return true;
  end if;

  if coalesce(election_row.status, 'draft') in ('draft', 'archived') then
    return false;
  end if;

  if election_row.end_date is null then
    return false;
  end if;

  manila_now := pg_catalog.timezone('Asia/Manila', pg_catalog.clock_timestamp());
  return manila_now >= election_row.end_date;
end;
$function$;

revoke all on function public.kandid_election_is_closed(integer)
  from public, anon, authenticated;

create or replace function public.kandid_guard_result_release_fields()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if pg_catalog.current_setting('kandid.allow_result_release_write', true)
       is distinct from 'on' then
    if tg_op = 'INSERT'
       and (new.results_released_at is not null or new.results_released_by is not null) then
      raise exception using errcode = '42501',
        message = 'Result finalization must use the trusted contract.';
    elsif tg_op = 'UPDATE'
       and (new.results_released_at is distinct from old.results_released_at
         or new.results_released_by is distinct from old.results_released_by) then
      raise exception using errcode = '42501',
        message = 'Result finalization must use the trusted contract.';
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function public.kandid_guard_result_release_fields()
  from public, anon, authenticated;

drop trigger if exists elections_guard_result_release_fields on public.elections;
create trigger elections_guard_result_release_fields
before insert or update of results_released_at, results_released_by
on public.elections
for each row execute function public.kandid_guard_result_release_fields();

create or replace function public.kandid_finalize_officer_results(p_election_id integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  caller_uid uuid := auth.uid();
  admin_row record;
  election_row public.elections%rowtype;
  already_finalized_value boolean;
begin
  if caller_uid is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;

  select a.role, a.organization_id
    into admin_row
  from public.admin_users a
  where a.auth_user_id = caller_uid
    and a.status = 'active'
    and a.role in ('electoral_board', 'super_admin')
  limit 1;

  if not found then
    raise exception using errcode = '42501', message = 'Active administrator authorization required.';
  end if;

  select e.* into election_row
  from public.elections e
  where e.id = p_election_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Election not found.';
  end if;

  if admin_row.role = 'electoral_board'
     and admin_row.organization_id is distinct from election_row.organization_id then
    raise exception using errcode = '42501', message = 'Election is outside your organization.';
  end if;

  if not public.kandid_election_is_closed(election_row.id) then
    raise exception using errcode = '22023', message = 'Results can only be finalized for a closed election.';
  end if;

  already_finalized_value := election_row.results_released_at is not null;
  if not already_finalized_value then
    perform pg_catalog.set_config('kandid.allow_result_release_write', 'on', true);
    update public.elections
    set results_released_at = pg_catalog.clock_timestamp(),
        results_released_by = caller_uid
    where id = election_row.id
    returning * into election_row;
  end if;

  -- Existing legacy releases with a null actor remain unattributed; retries do
  -- not replace their timestamp or claim a new releasing actor.
  return pg_catalog.jsonb_build_object(
    'election_id', election_row.id,
    'results_released_at', election_row.results_released_at,
    'results_released_by', election_row.results_released_by,
    'already_finalized', already_finalized_value
  );
end;
$function$;

create or replace function public.kandid_get_officer_winners(
  p_election_id integer default null,
  p_organization_id bigint default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  caller_uid uuid := auth.uid();
  admin_row record;
  selected_election record;
  visible_elections jsonb;
  position_results jsonb;
begin
  if caller_uid is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;

  select a.role, a.organization_id
    into admin_row
  from public.admin_users a
  where a.auth_user_id = caller_uid
    and a.status = 'active'
    and a.role in ('electoral_board', 'super_admin')
  limit 1;

  if not found then
    raise exception using errcode = '42501', message = 'Active administrator authorization required.';
  end if;

  if admin_row.role = 'electoral_board' then
    if p_organization_id is not null
       and p_organization_id is distinct from admin_row.organization_id then
      raise exception using errcode = '42501', message = 'Organization is outside your assignment.';
    end if;
    p_organization_id := admin_row.organization_id;
  end if;

  if p_election_id is not null then
    select e.id, e.title, e.organization_id, e.results_released_at
      into selected_election
    from public.elections e
    where e.id = p_election_id
      and e.results_released_at is not null
      and (p_organization_id is null or e.organization_id = p_organization_id)
      and public.kandid_election_is_closed(e.id);
  else
    select e.id, e.title, e.organization_id, e.results_released_at
      into selected_election
    from public.elections e
    where e.results_released_at is not null
      and (p_organization_id is null or e.organization_id = p_organization_id)
      and public.kandid_election_is_closed(e.id)
    order by e.results_released_at desc, e.id desc
    limit 1;
  end if;

  if not found then
    return pg_catalog.jsonb_build_object(
      'available_elections', '[]'::jsonb,
      'selected_election', null
    );
  end if;

  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'election_id', e.id,
      'election_title', e.title,
      'organization_id', e.organization_id,
      'results_released_at', e.results_released_at
    ) order by e.results_released_at desc, e.id desc
  ), '[]'::jsonb)
  into visible_elections
  from public.elections e
  where e.results_released_at is not null
    and (p_organization_id is null or e.organization_id = p_organization_id)
    and public.kandid_election_is_closed(e.id);

  with candidate_totals as (
    select
      p.id as position_id,
      p.name as position_name,
      p.display_order,
      c.id as candidate_id,
      c.student_id,
      count(v.id)::integer as vote_total
    from public.positions p
    left join public.candidates c
      on c.position_id = p.id
     and c.student_id is not null
    left join public.votes v
      on v.election_id = selected_election.id
     and v.position_id = p.id
     and v.candidate_id = c.id
     and v.is_abstain is false
    where p.election_id = selected_election.id
    group by p.id, p.name, p.display_order, c.id, c.student_id
  ), position_highs as (
    select ct.position_id, max(ct.vote_total) as highest_total
    from candidate_totals ct
    group by ct.position_id
  ), scored as (
    select
      ct.*,
      ph.highest_total,
      count(*) filter (where ct.vote_total = ph.highest_total)
        over (partition by ct.position_id) as highest_candidate_count
    from candidate_totals ct
    join position_highs ph on ph.position_id = ct.position_id
  ), decisions as (
    select distinct on (s.position_id)
      s.position_id,
      s.position_name,
      s.display_order,
      s.highest_total,
      s.highest_candidate_count,
      case
        when s.candidate_id is null or s.highest_total = 0 then 'no_winner'
        when s.highest_candidate_count > 1 then 'tie'
        else 'winner'
      end as outcome,
      case when s.highest_total > 0 and s.highest_candidate_count = 1
        then s.candidate_id else null end as winner_candidate_id,
      case when s.highest_total > 0 and s.highest_candidate_count = 1
        then s.student_id else null end as winner_student_id
    from scored s
    order by s.position_id, s.vote_total desc, s.candidate_id nulls last
  )
  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'position_id', d.position_id,
      'position_name', d.position_name,
      'outcome', d.outcome,
      'candidate_id', d.winner_candidate_id,
      'student_name', case when d.winner_student_id is null then null
        else nullif(pg_catalog.btrim(pg_catalog.concat_ws(' ', s.first_name, s.last_name)), '') end,
      'photo_url', case when d.winner_student_id is null then null
        else coalesce(c.photo, s.photo_url) end
    ) order by d.display_order nulls last, d.position_id
  ), '[]'::jsonb)
  into position_results
  from decisions d
  left join public.candidates c on c.id = d.winner_candidate_id
  left join public.students s on s.id = d.winner_student_id;

  return pg_catalog.jsonb_build_object(
    'available_elections', visible_elections,
    'selected_election', pg_catalog.jsonb_build_object(
      'election_id', selected_election.id,
      'election_title', selected_election.title,
      'organization_id', selected_election.organization_id,
      'results_released_at', selected_election.results_released_at,
      'positions', position_results
    )
  );
end;
$function$;

create or replace function public.kandid_create_elected_officer(
  p_candidate_id integer,
  p_service jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  caller_uid uuid := auth.uid();
  admin_row record;
  candidate_row record;
  winners jsonb;
  is_unique_winner boolean := false;
  is_current_value boolean := true;
  term_label_value varchar;
  term_start_value date;
  term_end_value date;
  photo_value text;
  remarks_value text;
  inserted_row public.officers%rowtype;
begin
  if caller_uid is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;
  if p_service is null or pg_catalog.jsonb_typeof(p_service) <> 'object'
     or exists (
       select 1 from pg_catalog.jsonb_object_keys(coalesce(p_service, '{}'::jsonb)) as keys(key)
       where key not in ('term_label', 'term_start', 'term_end', 'is_current', 'photo_url', 'remarks')
     ) then
    raise exception using errcode = '22023', message = 'Invalid elected officer service fields.';
  end if;

  select a.role, a.organization_id
    into admin_row
  from public.admin_users a
  where a.auth_user_id = caller_uid and a.status = 'active'
    and a.role in ('electoral_board', 'super_admin')
  limit 1;
  if not found then
    raise exception using errcode = '42501', message = 'Active administrator authorization required.';
  end if;

  select c.id as candidate_id, c.student_id, c.position_id,
         c.photo as candidate_photo,
         p.name as position_name, p.election_id,
         e.organization_id, e.results_released_at,
         s.first_name, s.last_name, s.photo_url as student_photo
    into candidate_row
  from public.candidates c
  join public.positions p on p.id = c.position_id
  join public.elections e on e.id = p.election_id
  join public.students s on s.id = c.student_id
  where c.id = p_candidate_id
  for share of c, p, e, s;

  if not found then
    raise exception using errcode = '22023', message = 'Candidate is not assigned to a valid student position.';
  end if;
  if candidate_row.student_id is null then
    raise exception using errcode = '22023', message = 'Candidate is not assigned to a valid student position.';
  end if;
  if admin_row.role = 'electoral_board'
     and admin_row.organization_id is distinct from candidate_row.organization_id then
    raise exception using errcode = '42501', message = 'Candidate is outside your organization.';
  end if;
  if candidate_row.results_released_at is null
     or not public.kandid_election_is_closed(candidate_row.election_id) then
    raise exception using errcode = '22023', message = 'Candidate election is not finalized and closed.';
  end if;

  winners := public.kandid_get_officer_winners(
    candidate_row.election_id,
    candidate_row.organization_id
  );
  select exists (
    select 1
    from pg_catalog.jsonb_array_elements(
      winners #> '{selected_election,positions}'
    ) position_result
    where position_result->>'outcome' = 'winner'
      and (position_result->>'candidate_id')::integer = p_candidate_id
  ) into is_unique_winner;
  if not is_unique_winner then
    raise exception using errcode = '42501', message = 'Candidate is not the unique positive winner for this position.';
  end if;

  term_label_value := nullif(pg_catalog.btrim(p_service->>'term_label'), '');
  if term_label_value is not null and pg_catalog.length(term_label_value) > 120 then
    raise exception using errcode = '22023', message = 'Term label is too long.';
  end if;
  if p_service ? 'term_start' and nullif(p_service->>'term_start', '') is not null then
    term_start_value := (p_service->>'term_start')::date;
  end if;
  if p_service ? 'term_end' and nullif(p_service->>'term_end', '') is not null then
    term_end_value := (p_service->>'term_end')::date;
  end if;
  if p_service ? 'is_current' then
    if pg_catalog.jsonb_typeof(p_service->'is_current') <> 'boolean' then
      raise exception using errcode = '22023', message = 'Current leadership must be boolean.';
    end if;
    is_current_value := (p_service->>'is_current')::boolean;
  end if;
  photo_value := nullif(pg_catalog.btrim(p_service->>'photo_url'), '');
  remarks_value := nullif(pg_catalog.btrim(p_service->>'remarks'), '');
  if photo_value is not null and pg_catalog.length(photo_value) > 2048 then
    raise exception using errcode = '22023', message = 'Photo URL is too long.';
  end if;
  if remarks_value is not null and pg_catalog.length(remarks_value) > 2000 then
    raise exception using errcode = '22023', message = 'Remarks are too long.';
  end if;

  perform pg_catalog.set_config('kandid.allow_officer_contract_write', 'on', true);
  insert into public.officers (
    organization_id, student_id, officer_name, position_title,
    term_label, term_start, term_end, photo_url, is_current, status,
    selection_type, election_id, candidate_id, position_id, remarks
  ) values (
    candidate_row.organization_id,
    candidate_row.student_id,
    nullif(pg_catalog.btrim(pg_catalog.concat_ws(' ', candidate_row.first_name, candidate_row.last_name)), ''),
    candidate_row.position_name,
    term_label_value, term_start_value, term_end_value,
    coalesce(photo_value, candidate_row.candidate_photo, candidate_row.student_photo),
    is_current_value,
    case when is_current_value then 'current' else 'past' end,
    'elected', candidate_row.election_id, candidate_row.candidate_id,
    candidate_row.position_id, remarks_value
  ) returning * into inserted_row;

  return pg_catalog.to_jsonb(inserted_row);
end;
$function$;

create or replace function public.kandid_create_appointed_officer(
  p_organization_id bigint,
  p_student_id integer,
  p_position_title text,
  p_service jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  caller_uid uuid := auth.uid();
  admin_row record;
  organization_id_value bigint;
  active_term_id integer;
  eligible boolean;
  student_row record;
  is_current_value boolean := true;
  inserted_row public.officers%rowtype;
begin
  if caller_uid is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;
  if p_service is null or pg_catalog.jsonb_typeof(p_service) <> 'object'
     or exists (
       select 1 from pg_catalog.jsonb_object_keys(coalesce(p_service, '{}'::jsonb)) as keys(key)
       where key not in ('term_label', 'term_start', 'term_end', 'is_current', 'photo_url', 'remarks')
     ) then
    raise exception using errcode = '22023', message = 'Invalid appointed officer service fields.';
  end if;
  if nullif(pg_catalog.btrim(p_position_title), '') is null
     or pg_catalog.length(pg_catalog.btrim(p_position_title)) > 160 then
    raise exception using errcode = '22023', message = 'A valid appointed position title is required.';
  end if;

  select a.role, a.organization_id
    into admin_row
  from public.admin_users a
  where a.auth_user_id = caller_uid and a.status = 'active'
    and a.role in ('electoral_board', 'super_admin')
  limit 1;
  if not found then
    raise exception using errcode = '42501', message = 'Active administrator authorization required.';
  end if;

  if admin_row.role = 'electoral_board' then
    organization_id_value := admin_row.organization_id;
    if p_organization_id is not null
       and p_organization_id is distinct from organization_id_value then
      raise exception using errcode = '42501', message = 'Organization is outside your assignment.';
    end if;
  else
    organization_id_value := p_organization_id;
  end if;
  if organization_id_value is null then
    raise exception using errcode = '22023', message = 'Organization is required.';
  end if;

  select s.id, s.first_name, s.last_name, s.photo_url, s.status
    into student_row
  from public.students s
  where s.id = p_student_id
  for share;
  if not found then
    raise exception using errcode = '42501', message = 'Select an active eligible organization student.';
  end if;
  if student_row.status <> 'active' then
    raise exception using errcode = '42501', message = 'Select an active eligible organization student.';
  end if;

  select t.id into active_term_id
  from public.academic_terms t
  where t.status = 'active'
  order by t.created_at desc, t.id desc
  limit 1;
  if active_term_id is null then
    raise exception using errcode = '42501', message = 'Active academic-term eligibility could not be verified.';
  end if;

  select participation.allowed into eligible
  from public.resolve_student_organization_participation(
    p_student_id,
    organization_id_value::integer,
    active_term_id
  ) participation
  limit 1;
  if eligible is distinct from true then
    raise exception using errcode = '42501', message = 'Student is not eligible for this organization.';
  end if;

  if p_service ? 'is_current' then
    if pg_catalog.jsonb_typeof(p_service->'is_current') <> 'boolean' then
      raise exception using errcode = '22023', message = 'Current leadership must be boolean.';
    end if;
    is_current_value := (p_service->>'is_current')::boolean;
  end if;

  if pg_catalog.length(coalesce(p_service->>'term_label', '')) > 120
     or pg_catalog.length(coalesce(p_service->>'photo_url', '')) > 2048
     or pg_catalog.length(coalesce(p_service->>'remarks', '')) > 2000 then
    raise exception using errcode = '22023', message = 'Appointed officer service details are too long.';
  end if;

  perform pg_catalog.set_config('kandid.allow_officer_contract_write', 'on', true);
  insert into public.officers (
    organization_id, student_id, officer_name, position_title,
    term_label, term_start, term_end, photo_url, is_current, status,
    selection_type, election_id, candidate_id, position_id, remarks
  ) values (
    organization_id_value,
    student_row.id,
    nullif(pg_catalog.btrim(pg_catalog.concat_ws(' ', student_row.first_name, student_row.last_name)), ''),
    pg_catalog.btrim(p_position_title),
    nullif(pg_catalog.btrim(p_service->>'term_label'), ''),
    nullif(p_service->>'term_start', '')::date,
    nullif(p_service->>'term_end', '')::date,
    coalesce(nullif(pg_catalog.btrim(p_service->>'photo_url'), ''), student_row.photo_url),
    is_current_value,
    case when is_current_value then 'current' else 'past' end,
    'appointed', null, null, null,
    nullif(pg_catalog.btrim(p_service->>'remarks'), '')
  ) returning * into inserted_row;

  return pg_catalog.to_jsonb(inserted_row);
end;
$function$;

create or replace function public.kandid_update_officer_service(
  p_officer_id bigint,
  p_changes jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  caller_uid uuid := auth.uid();
  admin_row record;
  officer_row public.officers%rowtype;
  target_organization_id bigint;
  target_student_id integer;
  active_term_id integer;
  eligible boolean;
  student_row record;
  position_title_value text;
  is_current_value boolean;
  updated_row public.officers%rowtype;
begin
  if caller_uid is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;
  if p_changes is null or pg_catalog.jsonb_typeof(p_changes) <> 'object'
     or exists (
       select 1 from pg_catalog.jsonb_object_keys(coalesce(p_changes, '{}'::jsonb)) as keys(key)
       where key not in (
         'organization_id', 'student_id', 'position_title', 'officer_name',
         'term_label', 'term_start', 'term_end', 'is_current', 'photo_url', 'remarks'
       )
     ) then
    raise exception using errcode = '22023', message = 'Officer changes contain unsupported fields.';
  end if;

  select a.role, a.organization_id
    into admin_row
  from public.admin_users a
  where a.auth_user_id = caller_uid and a.status = 'active'
    and a.role in ('electoral_board', 'super_admin')
  limit 1;
  if not found then
    raise exception using errcode = '42501', message = 'Active administrator authorization required.';
  end if;

  select o.* into officer_row
  from public.officers o
  where o.id = p_officer_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Officer record not found.';
  end if;
  if admin_row.role = 'electoral_board'
     and admin_row.organization_id is distinct from officer_row.organization_id then
    raise exception using errcode = '42501', message = 'Officer record is outside your organization.';
  end if;
  if officer_row.selection_type = 'elected'
     and (p_changes ? 'organization_id' or p_changes ? 'student_id'
       or p_changes ? 'officer_name' or p_changes ? 'position_title') then
    raise exception using errcode = '42501', message = 'Elected officer provenance is read-only.';
  end if;
  if admin_row.role <> 'super_admin' and p_changes ? 'organization_id' then
    raise exception using errcode = '42501', message = 'Only Super Admin may change organization scope.';
  end if;
  if officer_row.selection_type in ('elected', 'appointed')
     and p_changes ? 'officer_name' then
    raise exception using errcode = '42501', message = 'Officer name is derived from the linked student.';
  end if;

  target_organization_id := case
    when p_changes ? 'organization_id' then (p_changes->>'organization_id')::bigint
    else officer_row.organization_id
  end;
  target_student_id := case
    when p_changes ? 'student_id' then (p_changes->>'student_id')::integer
    else officer_row.student_id
  end;
  if officer_row.selection_type = 'appointed'
     or (p_changes ? 'student_id' or target_organization_id is distinct from officer_row.organization_id) then
    if target_student_id is null then
      raise exception using errcode = '42501', message = 'Appointed officers require a linked student.';
    end if;
    select s.id, s.first_name, s.last_name, s.photo_url, s.status
      into student_row
    from public.students s
    where s.id = target_student_id
    for share;
    if not found then
      raise exception using errcode = '42501', message = 'Select an active eligible organization student.';
    end if;
    if student_row.status <> 'active' then
      raise exception using errcode = '42501', message = 'Select an active eligible organization student.';
    end if;
    select t.id into active_term_id
    from public.academic_terms t
    where t.status = 'active'
    order by t.created_at desc, t.id desc
    limit 1;
    if active_term_id is null then
      raise exception using errcode = '42501', message = 'Active academic-term eligibility could not be verified.';
    end if;
    select participation.allowed into eligible
    from public.resolve_student_organization_participation(
      target_student_id, target_organization_id::integer, active_term_id
    ) participation
    limit 1;
    if eligible is distinct from true then
      raise exception using errcode = '42501', message = 'Student is not eligible for this organization.';
    end if;
  end if;

  if p_changes ? 'position_title' then
    position_title_value := nullif(pg_catalog.btrim(p_changes->>'position_title'), '');
    if position_title_value is null or pg_catalog.length(position_title_value) > 160 then
      raise exception using errcode = '22023', message = 'A valid position title is required.';
    end if;
  else
    position_title_value := officer_row.position_title;
  end if;
  if p_changes ? 'is_current' and pg_catalog.jsonb_typeof(p_changes->'is_current') <> 'boolean' then
    raise exception using errcode = '22023', message = 'Current leadership must be boolean.';
  end if;
  is_current_value := case when p_changes ? 'is_current'
    then (p_changes->>'is_current')::boolean else officer_row.is_current end;
  if (p_changes ? 'term_label' and pg_catalog.length(coalesce(p_changes->>'term_label', '')) > 120)
     or (p_changes ? 'photo_url' and pg_catalog.length(coalesce(p_changes->>'photo_url', '')) > 2048)
     or (p_changes ? 'remarks' and pg_catalog.length(coalesce(p_changes->>'remarks', '')) > 2000) then
    raise exception using errcode = '22023', message = 'Officer service details are too long.';
  end if;

  update public.officers o
  set organization_id = target_organization_id,
      student_id = target_student_id,
      officer_name = case
        when officer_row.selection_type = 'elected' then officer_row.officer_name
        when officer_row.selection_type = 'appointed'
          then nullif(pg_catalog.btrim(pg_catalog.concat_ws(' ', student_row.first_name, student_row.last_name)), '')
        when p_changes ? 'officer_name' then nullif(pg_catalog.btrim(p_changes->>'officer_name'), '')
        else officer_row.officer_name end,
      position_title = position_title_value,
      term_label = case when p_changes ? 'term_label' then nullif(pg_catalog.btrim(p_changes->>'term_label'), '') else officer_row.term_label end,
      term_start = case when p_changes ? 'term_start' then nullif(p_changes->>'term_start', '')::date else officer_row.term_start end,
      term_end = case when p_changes ? 'term_end' then nullif(p_changes->>'term_end', '')::date else officer_row.term_end end,
      photo_url = case when p_changes ? 'photo_url' then nullif(pg_catalog.btrim(p_changes->>'photo_url'), '') else officer_row.photo_url end,
      remarks = case when p_changes ? 'remarks' then nullif(pg_catalog.btrim(p_changes->>'remarks'), '') else officer_row.remarks end,
      is_current = is_current_value
  where o.id = officer_row.id
  returning o.* into updated_row;

  return pg_catalog.to_jsonb(updated_row);
end;
$function$;

create or replace function public.kandid_retire_officer(p_officer_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  caller_uid uuid := auth.uid();
  admin_row record;
  officer_row public.officers%rowtype;
begin
  if caller_uid is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;
  select a.role, a.organization_id into admin_row
  from public.admin_users a
  where a.auth_user_id = caller_uid and a.status = 'active'
    and a.role in ('electoral_board', 'super_admin')
  limit 1;
  if not found then
    raise exception using errcode = '42501', message = 'Active administrator authorization required.';
  end if;
  select o.* into officer_row from public.officers o
  where o.id = p_officer_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Officer record not found.';
  end if;
  if admin_row.role = 'electoral_board'
     and admin_row.organization_id is distinct from officer_row.organization_id then
    raise exception using errcode = '42501', message = 'Officer record is outside your organization.';
  end if;
  update public.officers
  set is_current = false,
      term_end = coalesce(term_end, pg_catalog.timezone('Asia/Manila', pg_catalog.clock_timestamp())::date)
  where id = officer_row.id
  returning * into officer_row;
  return pg_catalog.to_jsonb(officer_row);
end;
$function$;

create or replace function public.kandid_delete_officer(p_officer_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  caller_uid uuid := auth.uid();
  admin_row record;
  officer_row public.officers%rowtype;
begin
  if caller_uid is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;
  select a.role, a.organization_id into admin_row
  from public.admin_users a
  where a.auth_user_id = caller_uid and a.status = 'active'
    and a.role in ('electoral_board', 'super_admin')
  limit 1;
  if not found then
    raise exception using errcode = '42501', message = 'Active administrator authorization required.';
  end if;
  select o.* into officer_row from public.officers o
  where o.id = p_officer_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Officer record not found.';
  end if;
  if admin_row.role = 'electoral_board'
     and admin_row.organization_id is distinct from officer_row.organization_id then
    raise exception using errcode = '42501', message = 'Officer record is outside your organization.';
  end if;
  if officer_row.selection_type = 'elected' then
    raise exception using errcode = '42501', message = 'Elected history must be retained; retire the record instead.';
  end if;
  if officer_row.is_current then
    raise exception using errcode = '42501', message = 'Retire the current officer before deletion.';
  end if;
  if exists (
    select 1 from public.election_officer_publication_entries p
    where p.source_officer_id = officer_row.id
  ) then
    raise exception using errcode = '42501', message = 'Published officer history must be retained.';
  end if;
  delete from public.officers where id = officer_row.id;
  return pg_catalog.jsonb_build_object('deleted', true, 'officer_id', officer_row.id);
end;
$function$;

-- A constrained display view preserves existing public/student roster reads
-- without exposing internal student or elected-provenance IDs.
create or replace view public.officer_directory
with (security_barrier = true)
as
select
  o.id,
  o.organization_id,
  org.name as organization_name,
  coalesce(
    nullif(pg_catalog.btrim(pg_catalog.concat_ws(' ', s.first_name, s.last_name)), ''),
    o.officer_name
  ) as officer_name,
  o.position_title,
  o.term_label,
  o.term_start,
  o.term_end,
  o.status,
  o.is_current,
  o.display_order,
  coalesce(o.photo_url, s.photo_url) as photo_url,
  s.first_name,
  s.last_name
from public.officers o
left join public.students s on s.id = o.student_id
left join public.organizations org on org.id = o.organization_id;

alter table public.officers enable row level security;

-- Temporary rollout compatibility: leave the legacy Officers policies,
-- table privileges, and sequence access intact until the frontend has moved
-- to officers-contract and officer_directory. The following lockdown
-- migration removes that access after the new frontend is live.
grant all on table public.officers to service_role;

-- The live preflight shows service_role does not yet have sequence USAGE.
-- Add its trusted server-side sequence path now, while preserving the
-- anon/authenticated sequence privileges needed by the old browser frontend.
do $service_role_sequence_grants$
declare
  sequence_name text := pg_catalog.pg_get_serial_sequence('public.officers', 'id');
begin
  if sequence_name is not null then
    execute pg_catalog.format(
      'grant usage, select, update on sequence %s to service_role',
      sequence_name
    );
  end if;
end;
$service_role_sequence_grants$;

revoke all on table public.officer_directory from public, anon, authenticated;
grant select on table public.officer_directory to anon, authenticated;

-- The release trigger requires this transaction-local flag; only the trusted
-- finalization function sets it. Preserve unrelated election write behavior.
revoke all on function public.kandid_finalize_officer_results(integer)
  from public, anon;
grant execute on function public.kandid_finalize_officer_results(integer)
  to authenticated;

revoke all on function public.kandid_get_officer_winners(integer, bigint)
  from public, anon;
grant execute on function public.kandid_get_officer_winners(integer, bigint)
  to authenticated;

revoke all on function public.kandid_create_elected_officer(integer, jsonb)
  from public, anon;
grant execute on function public.kandid_create_elected_officer(integer, jsonb)
  to authenticated;

revoke all on function public.kandid_create_appointed_officer(bigint, integer, text, jsonb)
  from public, anon;
grant execute on function public.kandid_create_appointed_officer(bigint, integer, text, jsonb)
  to authenticated;

revoke all on function public.kandid_update_officer_service(bigint, jsonb)
  from public, anon;
grant execute on function public.kandid_update_officer_service(bigint, jsonb)
  to authenticated;

revoke all on function public.kandid_retire_officer(bigint)
  from public, anon;
grant execute on function public.kandid_retire_officer(bigint)
  to authenticated;

revoke all on function public.kandid_delete_officer(bigint)
  from public, anon;
grant execute on function public.kandid_delete_officer(bigint)
  to authenticated;

notify pgrst, 'reload schema';
commit;
