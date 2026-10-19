begin;

-- Position uniqueness is roster-scoped: one prepared roster per organization
-- and one published current roster per organization. Past history is exempt.
-- Fail safely before creating indexes if legacy data already violates this
-- rule; do not guess which officer should be changed.
do $officer_roster_position_preflight$
begin
  if exists (
    select 1
    from public.officer_new_roster n
    group by n.organization_id,
      pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(n.position_title), '[[:space:]]+', ' ', 'g'))
    having count(*) > 1
  ) then
    raise exception using errcode = '23505',
      message = 'Resolve duplicate normalized positions in officer_new_roster before applying this migration.';
  end if;

  if exists (
    select 1
    from public.officers o
    where o.is_current
    group by o.organization_id,
      pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(o.position_title), '[[:space:]]+', ' ', 'g'))
    having count(*) > 1
  ) then
    raise exception using errcode = '23505',
      message = 'Resolve duplicate normalized positions in the current officer roster before applying this migration.';
  end if;

  if exists (
    select 1
    from public.officers o
    where o.is_current and o.student_id is not null
    group by o.organization_id, o.student_id
    having count(*) > 1
  ) then
    raise exception using errcode = '23505',
      message = 'Resolve duplicate students in the current officer roster before applying this migration.';
  end if;
end;
$officer_roster_position_preflight$;

create unique index officer_new_roster_one_position_uidx
  on public.officer_new_roster (
    organization_id,
    (pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(position_title), '[[:space:]]+', ' ', 'g')))
  );

create unique index officers_current_one_position_uidx
  on public.officers (
    organization_id,
    (pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(position_title), '[[:space:]]+', ' ', 'g')))
  )
  where is_current;

create unique index officers_current_one_student_uidx
  on public.officers (organization_id, student_id)
  where is_current and student_id is not null;

-- All incoming add/update RPCs already use this sanitizer. Keep its existing
-- allow-list and limits, and reject impossible service date ranges centrally.
create or replace function private.kandid_sanitize_officer_service(p_service jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog
as $function$
declare
  term_label_value text;
  term_start_value date;
  term_end_value date;
  photo_value text;
  remarks_value text;
begin
  if p_service is null or pg_catalog.jsonb_typeof(p_service) <> 'object'
     or exists (
       select 1 from pg_catalog.jsonb_object_keys(coalesce(p_service, '{}'::jsonb)) as keys(key)
       where key not in ('term_label', 'term_start', 'term_end', 'photo_url', 'remarks')
     ) then
    raise exception using errcode = '22023', message = 'Invalid officer service fields.';
  end if;

  term_label_value := nullif(pg_catalog.btrim(p_service->>'term_label'), '');
  photo_value := nullif(pg_catalog.btrim(p_service->>'photo_url'), '');
  remarks_value := nullif(pg_catalog.btrim(p_service->>'remarks'), '');
  if (term_label_value is not null and pg_catalog.length(term_label_value) > 120)
     or (photo_value is not null and pg_catalog.length(photo_value) > 2048)
     or (remarks_value is not null and pg_catalog.length(remarks_value) > 2000) then
    raise exception using errcode = '22023', message = 'Officer service details are too long.';
  end if;
  if nullif(p_service->>'term_start', '') is not null then
    term_start_value := (p_service->>'term_start')::date;
  end if;
  if nullif(p_service->>'term_end', '') is not null then
    term_end_value := (p_service->>'term_end')::date;
  end if;
  if term_start_value is not null and term_end_value is not null and term_end_value < term_start_value then
    raise exception using errcode = '22023', message = 'End of service must be on or after the start date.';
  end if;
  return pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'term_label', term_label_value,
    'term_start', term_start_value,
    'term_end', term_end_value,
    'photo_url', photo_value,
    'remarks', remarks_value
  ));
end;
$function$;

revoke all on function private.kandid_sanitize_officer_service(jsonb)
  from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
