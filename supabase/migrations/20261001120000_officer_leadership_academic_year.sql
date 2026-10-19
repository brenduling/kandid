begin;

-- Officer tenure is academic-year based. Elections and student eligibility
-- remain semester based through elections.academic_term_id and academic_terms.
-- Keep officers.academic_term_id as legacy/provenance data during the API cutover.
alter table public.officers
  add column if not exists leadership_academic_year text;
alter table public.officer_new_roster
  add column if not exists leadership_academic_year text;
alter table public.officer_leadership_releases
  add column if not exists leadership_academic_year text;

do $constraints$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.officers'::regclass
      and conname = 'officers_leadership_academic_year_format_check'
  ) then
    alter table public.officers
      add constraint officers_leadership_academic_year_format_check
      check (leadership_academic_year is null or leadership_academic_year ~ '^[0-9]{4}-[0-9]{4}$');
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.officer_new_roster'::regclass
      and conname = 'officer_new_roster_leadership_academic_year_format_check'
  ) then
    alter table public.officer_new_roster
      add constraint officer_new_roster_leadership_academic_year_format_check
      check (leadership_academic_year is null or leadership_academic_year ~ '^[0-9]{4}-[0-9]{4}$');
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.officer_leadership_releases'::regclass
      and conname = 'officer_leadership_releases_academic_year_format_check'
  ) then
    alter table public.officer_leadership_releases
      add constraint officer_leadership_releases_academic_year_format_check
      check (leadership_academic_year is null or leadership_academic_year ~ '^[0-9]{4}-[0-9]{4}$');
  end if;
end;
$constraints$;

create index if not exists officers_org_leadership_academic_year_idx
  on public.officers (organization_id, leadership_academic_year)
  where is_current;

-- Only an existing academic-term relationship is evidence for an officer's
-- historical leadership year. Do not infer it from service/creation/result
-- timestamps or legacy term_label text.
update public.officers o
set leadership_academic_year = t.academic_year
from public.academic_terms t
where o.leadership_academic_year is null
  and o.academic_term_id = t.id;

update public.officers o
set leadership_academic_year = t.academic_year
from public.elections e
join public.academic_terms t on t.id = e.academic_term_id
where o.leadership_academic_year is null
  and o.selection_type = 'elected'
  and o.election_id = e.id
  and o.organization_id = e.organization_id;

update public.officer_leadership_releases r
set leadership_academic_year = t.academic_year
from public.academic_terms t
where r.leadership_academic_year is null
  and r.academic_term_id = t.id;

update public.officer_leadership_releases r
set leadership_academic_year = t.academic_year
from public.elections e
join public.academic_terms t on t.id = e.academic_term_id
where r.leadership_academic_year is null
  and r.elected_count > 0
  and r.election_id = e.id
  and r.organization_id = e.organization_id;

-- Staged elected officers inherit only the year linked to their election.
update public.officer_new_roster n
set leadership_academic_year = t.academic_year
from public.elections e
join public.academic_terms t on t.id = e.academic_term_id
where n.selection_type = 'elected'
  and n.election_id = e.id
  and n.organization_id = e.organization_id
  and n.leadership_academic_year is null;

-- Appointed staging can be backfilled only from one established Current year,
-- or (when no Current year is recorded) one active academic-year value. Any
-- ambiguous or unknown historical staging remains NULL for a later decision.
with current_years as (
  select o.organization_id,
    count(distinct o.leadership_academic_year) filter (where o.leadership_academic_year is not null) as year_count,
    min(o.leadership_academic_year) filter (where o.leadership_academic_year is not null) as leadership_academic_year
  from public.officers o
  where o.is_current
  group by o.organization_id
), active_years as (
  select count(distinct t.academic_year) as year_count,
    min(t.academic_year) as leadership_academic_year
  from public.academic_terms t
  where t.status = 'active'
), resolved as (
  select n.id,
    case
      when coalesce(c.year_count, 0) = 1 then c.leadership_academic_year
      when coalesce(c.year_count, 0) > 1 then null
      when a.year_count = 1 then a.leadership_academic_year
      else null
    end as leadership_academic_year
  from public.officer_new_roster n
  left join current_years c on c.organization_id = n.organization_id
  cross join active_years a
  where n.selection_type = 'appointed'
)
update public.officer_new_roster n
set leadership_academic_year = resolved.leadership_academic_year
from resolved
where n.id = resolved.id
  and n.leadership_academic_year is null
  and resolved.leadership_academic_year is not null;

create or replace function private.kandid_resolve_officer_leadership_academic_year(
  p_organization_id bigint,
  p_election_id integer default null
)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  leadership_year text;
  current_year_count integer := 0;
  active_year_count integer := 0;
begin
  if p_election_id is not null then
    select t.academic_year into leadership_year
    from public.elections e
    join public.academic_terms t on t.id = e.academic_term_id
    where e.id = p_election_id
      and e.organization_id = p_organization_id;
    if leadership_year is null then
      raise exception using errcode = '22023',
        message = 'The election must have an authoritative academic term before its leadership year can be resolved.';
    end if;
    return leadership_year;
  end if;

  select count(distinct o.leadership_academic_year)::integer,
         min(o.leadership_academic_year)
    into current_year_count, leadership_year
  from public.officers o
  where o.organization_id = p_organization_id
    and o.is_current
    and o.leadership_academic_year is not null;

  if current_year_count > 1 then
    raise exception using errcode = '22023',
      message = 'Current Leadership has conflicting academic years. Resolve its leadership year before adding or releasing officers.';
  elsif current_year_count = 1 then
    return leadership_year;
  end if;

  select count(distinct t.academic_year)::integer,
         min(t.academic_year)
    into active_year_count, leadership_year
  from public.academic_terms t
  where t.status = 'active';

  if active_year_count <> 1 or leadership_year is null then
    raise exception using errcode = '22023',
      message = 'Establish one authoritative academic year before adding or releasing officers.';
  end if;
  return leadership_year;
end;
$function$;
revoke all on function private.kandid_resolve_officer_leadership_academic_year(bigint, integer)
  from public, anon, authenticated, service_role;

create or replace function private.kandid_assign_new_roster_leadership_year()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if new.selection_type = 'elected' then
    if new.election_id is null or new.candidate_id is null then
      raise exception using errcode = '22023',
        message = 'Elected New Officers require their verified election context.';
    end if;
    new.leadership_academic_year := private.kandid_resolve_officer_leadership_academic_year(
      new.organization_id, new.election_id
    );
  else
    new.leadership_academic_year := private.kandid_resolve_officer_leadership_academic_year(
      new.organization_id, null
    );
  end if;
  return new;
end;
$function$;
revoke all on function private.kandid_assign_new_roster_leadership_year()
  from public, anon, authenticated, service_role;
drop trigger if exists officer_new_roster_assign_leadership_year on public.officer_new_roster;
create trigger officer_new_roster_assign_leadership_year
before insert or update of organization_id, election_id, selection_type, leadership_academic_year
on public.officer_new_roster
for each row execute function private.kandid_assign_new_roster_leadership_year();

create or replace function private.kandid_assign_officer_release_context()
returns trigger
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  staged_count integer := 0;
  staged_unresolved integer := 0;
  staged_year_count integer := 0;
  staged_year text;
  has_elected_staging boolean := false;
  active_term_id integer;
  current_term_count integer := 0;
  current_term_id integer;
begin
  new.academic_term_id := null;
  select exists (
    select 1 from public.officer_new_roster n
    where n.organization_id = new.organization_id
      and n.selection_type = 'elected'
      and n.election_id is not distinct from new.election_id
  ) into has_elected_staging;

  if has_elected_staging then
    new.leadership_academic_year := private.kandid_resolve_officer_leadership_academic_year(
      new.organization_id, new.election_id
    );
  else
    -- The release RPC can carry the latest election ID even for an
    -- appointed-only roster. Appointed tenure follows Current/active context,
    -- not that unrelated election's semester.
    new.leadership_academic_year := private.kandid_resolve_officer_leadership_academic_year(
      new.organization_id, null
    );
  end if;

  if has_elected_staging and new.election_id is not null then
    select e.academic_term_id into new.academic_term_id
    from public.elections e
    where e.id = new.election_id and e.organization_id = new.organization_id;
  else
    select count(distinct o.academic_term_id)::integer,
           min(o.academic_term_id)
      into current_term_count, current_term_id
    from public.officers o
    join public.academic_terms t on t.id = o.academic_term_id
    where o.organization_id = new.organization_id and o.is_current
      and t.academic_year = new.leadership_academic_year;
    if current_term_count = 1 then
      new.academic_term_id := current_term_id;
    else
      select t.id into active_term_id
      from public.academic_terms t
      where t.status = 'active'
        and t.academic_year = new.leadership_academic_year
      order by t.activated_at desc nulls last, t.created_at desc, t.id desc
      limit 1;
      new.academic_term_id := active_term_id;
    end if;
  end if;

  select count(*)::integer,
         count(*) filter (where n.leadership_academic_year is null)::integer,
         count(distinct n.leadership_academic_year)::integer,
         min(n.leadership_academic_year)
    into staged_count, staged_unresolved, staged_year_count, staged_year
  from public.officer_new_roster n
  where n.organization_id = new.organization_id
    and (n.election_id is not distinct from new.election_id
      or (n.selection_type = 'appointed' and n.election_id is null));

  if staged_count = 0 then
    raise exception using errcode = '22023',
      message = 'Add at least one New Officer before releasing leadership.';
  end if;
  if staged_unresolved > 0 or staged_year_count <> 1
     or staged_year is distinct from new.leadership_academic_year then
    raise exception using errcode = '22023',
      message = 'The prepared roster does not have one matching authoritative leadership academic year.';
  end if;
  if not exists (
    select 1 from public.academic_terms t
    where t.academic_year = new.leadership_academic_year
  ) then
    raise exception using errcode = '22023',
      message = 'The leadership academic year is not present in Kandid academic terms.';
  end if;

  new.term_label := 'AY ' || new.leadership_academic_year;
  return new;
end;
$function$;
revoke all on function private.kandid_assign_officer_release_context()
  from public, anon, authenticated, service_role;
drop trigger if exists officer_releases_assign_term_context on public.officer_leadership_releases;
create trigger officer_releases_assign_term_context
before insert on public.officer_leadership_releases
for each row execute function private.kandid_assign_officer_release_context();

create or replace function private.kandid_assign_officer_term_and_service()
returns trigger
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  release_at timestamptz;
  release_term_id integer;
  release_year text;
  election_term_id integer;
  election_year text;
  active_term_id integer;
  current_officer_count integer := 0;
  current_year_count integer := 0;
  current_year text;
  start_timestamp timestamptz;
  end_timestamp timestamptz;
begin
  select r.released_at, r.academic_term_id, r.leadership_academic_year
    into release_at, release_term_id, release_year
  from public.officer_leadership_releases r
  where r.organization_id = new.organization_id
    and r.released_at >= transaction_timestamp()
    and r.released_at <= clock_timestamp()
  order by r.released_at desc, r.id desc
  limit 1;

  if new.election_id is not null then
    select e.academic_term_id, t.academic_year
      into election_term_id, election_year
    from public.elections e
    join public.academic_terms t on t.id = e.academic_term_id
    where e.id = new.election_id and e.organization_id = new.organization_id;
    if election_year is null then
      raise exception using errcode = '22023',
        message = 'The election must have an academic term before its officer leadership year can be resolved.';
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.leadership_academic_year := null;
    if new.is_current then
      new.term_label := null;
    end if;

    if new.election_id is not null then
      new.academic_term_id := election_term_id;
      new.leadership_academic_year := election_year;
      if release_year is not null and release_year is distinct from election_year then
        raise exception using errcode = '22023',
          message = 'The elected officer year does not match the prepared leadership year.';
      end if;
      if new.is_current and release_at is null then
        select count(*)::integer into current_officer_count
        from public.officers o
        where o.organization_id = new.organization_id and o.is_current;
        select count(distinct o.leadership_academic_year)::integer,
               min(o.leadership_academic_year)
          into current_year_count, current_year
        from public.officers o
        where o.organization_id = new.organization_id and o.is_current
          and o.leadership_academic_year is not null;
        if current_year_count > 1
           or (current_officer_count > 0 and current_year_count = 1 and current_year is distinct from election_year) then
          raise exception using errcode = '22023',
            message = 'The elected officer year conflicts with Current Leadership. Use the prepared leadership release for a new year.';
        end if;
      end if;
    elsif new.is_current then
      new.leadership_academic_year := coalesce(
        release_year,
        private.kandid_resolve_officer_leadership_academic_year(new.organization_id, null)
      );
      if release_at is not null then
        new.academic_term_id := release_term_id;
      else
        select t.id into active_term_id
        from public.academic_terms t
        where t.status = 'active'
        order by t.activated_at desc nulls last, t.created_at desc, t.id desc
        limit 1;
        new.academic_term_id := active_term_id;
      end if;
    else
      new.leadership_academic_year := null;
    end if;

    if new.is_current then
      if new.leadership_academic_year is null or not exists (
        select 1 from public.academic_terms t
        where t.academic_year = new.leadership_academic_year
      ) then
        raise exception using errcode = '22023',
          message = 'A known leadership academic year is required before an officer becomes Current.';
      end if;
      new.term_label := 'AY ' || new.leadership_academic_year;
      start_timestamp := coalesce(release_at, transaction_timestamp());
      new.service_started_at := start_timestamp;
      new.service_ended_at := null;
      new.term_start := pg_catalog.timezone('Asia/Manila', start_timestamp)::date;
    else
      new.service_started_at := null;
      new.service_ended_at := null;
    end if;
  else
    -- Semester linkage remains immutable compatibility/provenance data. The
    -- leadership year and service tenure are protected independently.
    new.academic_term_id := old.academic_term_id;
    new.leadership_academic_year := old.leadership_academic_year;
    if not old.is_current and new.is_current then
      if release_at is null or release_year is null then
        raise exception using errcode = '42501',
          message = 'Only the trusted leadership release can make an existing officer Current.';
      end if;
      if old.leadership_academic_year is not null
         and old.leadership_academic_year is distinct from release_year then
        raise exception using errcode = '22023',
          message = 'The officer leadership year does not match the prepared release year.';
      end if;
      new.leadership_academic_year := release_year;
      new.term_label := 'AY ' || release_year;
      start_timestamp := release_at;
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
    end if;
  end if;

  if new.leadership_academic_year is not null and not exists (
    select 1 from public.academic_terms t
    where t.academic_year = new.leadership_academic_year
  ) then
    raise exception using errcode = '22023',
      message = 'The leadership academic year is not present in Kandid academic terms.';
  end if;
  if new.service_started_at is not null and new.term_end is not null
     and new.term_end < pg_catalog.timezone('Asia/Manila', new.service_started_at)::date then
    raise exception using errcode = '22023', message = 'End of service must be on or after the service start.';
  end if;
  return new;
end;
$function$;
revoke all on function private.kandid_assign_officer_term_and_service()
  from public, anon, authenticated, service_role;
drop trigger if exists officers_assign_term_and_service on public.officers;
create trigger officers_assign_term_and_service
before insert or update of is_current, academic_term_id, leadership_academic_year,
  service_started_at, service_ended_at, term_start, term_end, term_label
on public.officers
for each row execute function private.kandid_assign_officer_term_and_service();

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
  o.service_ended_at,
  o.leadership_academic_year
from public.officers o
left join public.students s on s.id = o.student_id
left join public.organizations org on org.id = o.organization_id;
grant select on table public.officer_directory to anon, authenticated;

-- Read-only context for the authenticated Officers contract. It exposes no
-- student identity and reports a target year only when it is authoritative.
create or replace function public.kandid_get_officer_leadership_context(
  p_organization_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  organization_id_value bigint;
  winners jsonb;
  election_id_value integer;
  leadership_year text;
  current_leadership_year text;
  current_year_count integer := 0;
  active_year_count integer := 0;
  staged_count integer := 0;
  staged_missing integer := 0;
  staged_year_count integer := 0;
  staged_year text;
  staged_years jsonb;
begin
  organization_id_value := private.kandid_assert_officer_org_scope(p_organization_id);

  -- Keep the year used by direct Current appointments separate from the
  -- incoming/New target, which may follow a future election's academic year.
  select count(distinct o.leadership_academic_year)::integer,
         min(o.leadership_academic_year)
    into current_year_count, current_leadership_year
  from public.officers o
  where o.organization_id = organization_id_value
    and o.is_current
    and o.leadership_academic_year is not null;
  if current_year_count > 1 then
    current_leadership_year := null;
  elsif current_year_count = 0 then
    select count(distinct t.academic_year)::integer,
           min(t.academic_year)
      into active_year_count, current_leadership_year
    from public.academic_terms t
    where t.status = 'active';
    if active_year_count <> 1 then
      current_leadership_year := null;
    end if;
  end if;

  select count(*)::integer,
         count(*) filter (where n.leadership_academic_year is null)::integer,
         count(distinct n.leadership_academic_year)::integer,
         min(n.leadership_academic_year)
    into staged_count, staged_missing, staged_year_count, staged_year
  from public.officer_new_roster n
  where n.organization_id = organization_id_value;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', n.id,
    'leadership_academic_year', n.leadership_academic_year
  ) order by n.created_at, n.id), '[]'::jsonb)
  into staged_years
  from public.officer_new_roster n
  where n.organization_id = organization_id_value;

  if staged_count > 0 then
    if staged_missing = 0 and staged_year_count = 1 then
      leadership_year := staged_year;
    end if;
  else
    winners := public.kandid_get_officer_winners(null, organization_id_value);
    election_id_value := nullif(winners #>> '{selected_election,election_id}', '')::integer;
    if election_id_value is not null then
      select t.academic_year into leadership_year
      from public.elections e
      join public.academic_terms t on t.id = e.academic_term_id
      where e.id = election_id_value and e.organization_id = organization_id_value;
    else
      select count(distinct o.leadership_academic_year)::integer,
             min(o.leadership_academic_year)
        into current_year_count, leadership_year
      from public.officers o
      where o.organization_id = organization_id_value
        and o.is_current and o.leadership_academic_year is not null;
      if current_year_count > 1 then
        leadership_year := null;
      elsif current_year_count = 0 then
        select count(distinct t.academic_year)::integer,
               min(t.academic_year)
          into active_year_count, leadership_year
        from public.academic_terms t where t.status = 'active';
        if active_year_count <> 1 then leadership_year := null; end if;
      end if;
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'leadership_academic_year', leadership_year,
    'current_leadership_academic_year', current_leadership_year,
    'new_officers', staged_years
  );
end;
$function$;
revoke all on function public.kandid_get_officer_leadership_context(bigint)
  from public, anon;
grant execute on function public.kandid_get_officer_leadership_context(bigint)
  to authenticated;

notify pgrst, 'reload schema';
commit;
