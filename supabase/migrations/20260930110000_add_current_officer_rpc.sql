begin;

-- Add one verified officer to the active roster without invoking the atomic
-- New Officers release workflow. This migration follows the normalized
-- current-roster uniqueness indexes from 20260930100000.
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
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  organization_id_value bigint;
  student_id_value integer;
  position_title_value text;
  candidate_row record;
  winner_result jsonb;
  service_value jsonb;
  inherited_term_label text;
  inherited_term_start date;
  inherited_term_end date;
  term_label_value text;
  term_start_value date;
  term_end_value date;
  current_count integer;
  term_label_distinct integer;
  term_label_missing integer;
  term_end_distinct integer;
  term_end_missing integer;
  term_start_distinct integer;
  term_start_missing integer;
  term_label_ambiguous boolean;
  term_label_unrecorded boolean;
  term_end_ambiguous boolean;
  term_start_ambiguous boolean;
  term_context_requires_confirmation boolean;
  created_officer jsonb;
begin
  organization_id_value := private.kandid_assert_officer_org_scope(p_organization_id);
  perform pg_catalog.pg_advisory_xact_lock(913027, organization_id_value::integer);

  if p_selection_type is null or p_selection_type not in ('appointed', 'elected') then
    raise exception using errcode = '22023', message = 'Officer selection type must be appointed or elected.';
  end if;
  service_value := private.kandid_sanitize_officer_service(p_service);

  select count(*)::integer,
         (count(distinct pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(o.term_label), '[[:space:]]+', ' ', 'g')))
           filter (where nullif(pg_catalog.btrim(o.term_label), '') is not null))::integer,
         count(*) filter (where nullif(pg_catalog.btrim(o.term_label), '') is null)::integer,
         min(nullif(pg_catalog.btrim(o.term_label), '')),
         count(distinct o.term_end)::integer,
         count(*) filter (where o.term_end is null)::integer,
         min(o.term_end),
         count(distinct o.term_start)::integer,
         count(*) filter (where o.term_start is null)::integer,
         min(o.term_start)
    into current_count,
         term_label_distinct, term_label_missing, inherited_term_label,
         term_end_distinct, term_end_missing, inherited_term_end,
         term_start_distinct, term_start_missing, inherited_term_start
  from public.officers o
  where o.organization_id = organization_id_value
    and o.is_current;

  term_label_ambiguous := term_label_distinct > 1
    or (term_label_missing > 0 and term_label_distinct > 0);
  term_label_unrecorded := current_count = 0 or term_label_distinct = 0;
  term_end_ambiguous := term_end_distinct > 1
    or (term_end_missing > 0 and term_end_distinct > 0);
  term_start_ambiguous := term_start_distinct > 1
    or (term_start_missing > 0 and term_start_distinct > 0);
  term_context_requires_confirmation := term_label_ambiguous
    or term_label_unrecorded or term_end_ambiguous;

  if term_context_requires_confirmation and p_confirm_term_context is distinct from true then
    raise exception using errcode = '22023', message = 'Review and confirm the current leadership term details before adding an officer.';
  end if;

  if term_label_ambiguous or term_label_unrecorded then
    term_label_value := nullif(pg_catalog.btrim(service_value->>'term_label'), '');
    if term_label_value is null then
      raise exception using errcode = '22023', message = 'A term label is required when current leadership term details are missing or inconsistent.';
    end if;
  else
    term_label_value := inherited_term_label;
    if nullif(pg_catalog.btrim(service_value->>'term_label'), '') is not null
       and pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(service_value->>'term_label'), '[[:space:]]+', ' ', 'g'))
         is distinct from pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(inherited_term_label), '[[:space:]]+', ' ', 'g')) then
      raise exception using errcode = '22023', message = 'The new officer must inherit the current leadership term label.';
    end if;
  end if;

  if current_count = 0 or term_end_ambiguous then
    term_end_value := nullif(service_value->>'term_end', '')::date;
  else
    term_end_value := inherited_term_end;
    if nullif(service_value->>'term_end', '') is not null
       and (service_value->>'term_end')::date is distinct from inherited_term_end then
      raise exception using errcode = '22023', message = 'The new officer must inherit the current leadership term end date.';
    end if;
  end if;

  -- term_start is stored per officer and can represent an individual's actual
  -- service start. Inherit it only when existing current rows agree; otherwise
  -- keep the entered value (or NULL) rather than choosing a record arbitrarily.
  if term_start_ambiguous then
    term_start_value := nullif(service_value->>'term_start', '')::date;
  else
    term_start_value := coalesce(
      nullif(service_value->>'term_start', '')::date,
      inherited_term_start
    );
  end if;

  service_value := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'term_label', term_label_value,
    'term_start', term_start_value,
    'term_end', term_end_value,
    'photo_url', service_value->>'photo_url',
    'remarks', service_value->>'remarks'
  ));
  -- Validate the inherited/selected values together after term resolution.
  service_value := private.kandid_sanitize_officer_service(service_value);
  if nullif(service_value->>'term_start', '') is not null
     and nullif(service_value->>'term_end', '') is not null
     and (service_value->>'term_end')::date < (service_value->>'term_start')::date then
    raise exception using errcode = '22023', message = 'End of service must be on or after the start date.';
  end if;

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

    -- Reuse the same authoritative latest released/closed election selected by
    -- incoming leadership. Do not accept a genuine winner from an older election.
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
    where o.organization_id = organization_id_value
      and o.is_current
      and pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(o.position_title), '[[:space:]]+', ' ', 'g'))
        = pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(position_title_value), '[[:space:]]+', ' ', 'g'))
  ) then
    raise exception using errcode = '23505', message = 'Current position is already occupied.';
  end if;
  if exists (
    select 1 from public.officers o
    where o.organization_id = organization_id_value
      and o.is_current
      and o.student_id = student_id_value
  ) then
    raise exception using errcode = '23505', message = 'Student already serves in Current Leadership.';
  end if;

  -- The trigger bypass is transaction-local and reachable only through this
  -- active-admin, organization-scoped SECURITY DEFINER function.
  perform pg_catalog.set_config('kandid.allow_leadership_turnover', 'on', true);
  if p_selection_type = 'appointed' then
    created_officer := public.kandid_create_appointed_officer(
      organization_id_value,
      student_id_value,
      position_title_value,
      service_value || pg_catalog.jsonb_build_object('is_current', true)
    );
  else
    created_officer := public.kandid_create_elected_officer(
      p_candidate_id,
      service_value || pg_catalog.jsonb_build_object('is_current', true)
    );
  end if;

  return created_officer || pg_catalog.jsonb_build_object('target', 'current');
end;
$function$;

revoke all on function public.kandid_add_current_officer(bigint, text, integer, integer, text, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.kandid_add_current_officer(bigint, text, integer, integer, text, jsonb, boolean)
  to authenticated;

comment on function public.kandid_add_current_officer(bigint, text, integer, integer, text, jsonb, boolean)
  is 'Adds one trusted appointed officer or verified election winner to Current Leadership without modifying other current or New roster records.';

notify pgrst, 'reload schema';
commit;
