-- Restrict each audit read surface to events authored by its trusted administrator role.
-- Preserve legacy/unattributed rows in storage; they do not meet the role + provenance filters.

create or replace function public.kandid_list_board_audit_events(
  p_before_created_at timestamptz default null,
  p_before_id bigint default null,
  p_page_size integer default 50,
  p_category text default null,
  p_event_type text default null,
  p_election_id bigint default null,
  p_search text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_uid uuid := auth.uid();
  assignment_count integer;
  board_org_id bigint;
  board_org_name text;
  page_limit integer := least(greatest(coalesce(p_page_size, 50), 1), 100);
  result_json jsonb;
begin
  if caller_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  select count(*)::integer, min(a.organization_id)
    into assignment_count, board_org_id
  from public.admin_users a
  where a.auth_user_id = caller_uid and a.role = 'electoral_board' and a.status = 'active';
  if assignment_count <> 1 or board_org_id is null then
    raise exception using errcode = '42501', message = 'One active Electoral Board assignment is required.';
  end if;
  select o.name into board_org_name from public.organizations o where o.id = board_org_id;
  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception using errcode = '22023', message = 'A complete pagination cursor is required.';
  end if;

  with filtered as (
    select l.id, coalesce(l.event_type, l.action) as event_type,
      coalesce(l.event_category, public.kandid_audit_category_for_event(coalesce(l.event_type, l.action))) as event_category,
      coalesce(l.actor_name, 'Legacy administrator') as actor_name,
      coalesce(l.actor_role, 'unknown') as actor_role,
      coalesce(l.entity_type, '') as entity_type, coalesce(l.entity_id, '') as entity_id,
      coalesce(l.entity_label, '') as entity_label,
      coalesce(l.organization_name, board_org_name, 'Organization') as organization_name,
      coalesce(l.organization_id, board_org_id) as organization_id,
      coalesce(l.status, 'completed') as status, l.election_id,
      l.event_origin,
      coalesce(l.created_at, l.timestamp) as created_at,
      case when pg_catalog.jsonb_typeof(l.metadata -> 'changed_fields') = 'array'
        then l.metadata -> 'changed_fields' else '[]'::jsonb end as changed_fields,
      case when coalesce(l.event_type, l.action) in ('organization_program_coverage_replaced','organization_program_coverage_changed')
        then pg_catalog.jsonb_build_object(
          'before_programs', l.metadata -> 'before_programs',
          'after_programs', l.metadata -> 'after_programs'
        ) else '{}'::jsonb end as safe_details
    from public.audit_logs l
    where l.organization_id = board_org_id
      and l.actor_role = 'electoral_board'
      and l.event_origin in ('trusted_database', 'trusted_edge', 'trusted_server')
      and (p_before_created_at is null or (coalesce(l.created_at, l.timestamp), l.id) < (p_before_created_at, p_before_id))
      and (p_category is null or coalesce(l.event_category, public.kandid_audit_category_for_event(coalesce(l.event_type, l.action))) = p_category)
      and (p_event_type is null or coalesce(l.event_type, l.action) = p_event_type)
      and (p_election_id is null or l.election_id = p_election_id)
      and (nullif(pg_catalog.btrim(p_search), '') is null or
        pg_catalog.concat_ws(' ', l.actor_name, l.event_type, l.action, l.entity_type, l.entity_label)
          ilike '%' || pg_catalog.btrim(p_search) || '%')
    order by coalesce(l.created_at, l.timestamp) desc, l.id desc
    limit page_limit + 1
  ), page_rows as (
    select * from filtered order by created_at desc, id desc limit page_limit
  )
  select pg_catalog.jsonb_build_object(
    'events', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', p.id, 'event_type', p.event_type, 'category', p.event_category,
      'actor_name', p.actor_name, 'actor_role', p.actor_role,
      'entity_type', p.entity_type, 'entity_id', p.entity_id, 'entity_label', p.entity_label,
      'organization_id', p.organization_id, 'organization_name', p.organization_name,
      'status', p.status, 'election_id', p.election_id, 'created_at', p.created_at,
      'changed_fields', p.changed_fields, 'safe_details', p.safe_details,
      'is_legacy', p.event_origin is null
    ) order by p.created_at desc, p.id desc) from page_rows p), '[]'::jsonb),
    'has_more', (select count(*) > page_limit from filtered),
    'next_cursor', (select pg_catalog.jsonb_build_object('created_at', p.created_at, 'id', p.id)
      from page_rows p order by p.created_at asc, p.id asc limit 1)
  ) into result_json;
  return result_json;
end;
$function$;

create or replace function public.kandid_list_super_admin_audit_events(
  p_before_created_at timestamptz default null,
  p_before_id bigint default null,
  p_page_size integer default 50,
  p_category text default null,
  p_event_type text default null,
  p_organization_id bigint default null,
  p_election_id bigint default null,
  p_search text default null,
  p_entity_type text default null,
  p_status text default null,
  p_created_on date default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_uid uuid := auth.uid();
  assignment_count integer;
  page_limit integer := least(greatest(coalesce(p_page_size, 50), 1), 100);
  result_json jsonb;
begin
  if caller_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  select count(*)::integer into assignment_count
  from public.admin_users a
  where a.auth_user_id = caller_uid and a.role = 'super_admin' and a.status = 'active';
  if assignment_count <> 1 then
    raise exception using errcode = '42501', message = 'Active Super Admin authorization required.';
  end if;
  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception using errcode = '22023', message = 'A complete pagination cursor is required.';
  end if;

  with filtered as (
    select l.id, coalesce(l.event_type, l.action) as event_type,
      coalesce(l.event_category, public.kandid_audit_category_for_event(coalesce(l.event_type, l.action))) as event_category,
      coalesce(l.actor_name, 'Legacy administrator') as actor_name,
      coalesce(l.actor_role, 'unknown') as actor_role,
      coalesce(l.entity_type, '') as entity_type, coalesce(l.entity_id, '') as entity_id,
      coalesce(l.entity_label, '') as entity_label, l.organization_id,
      coalesce(l.organization_name, 'Organization') as organization_name,
      coalesce(l.status, 'completed') as status, l.election_id,
      l.event_origin,
      coalesce(l.created_at, l.timestamp) as created_at,
      case when pg_catalog.jsonb_typeof(l.metadata -> 'changed_fields') = 'array'
        then l.metadata -> 'changed_fields' else '[]'::jsonb end as changed_fields,
      case when coalesce(l.event_type, l.action) in ('organization_program_coverage_replaced','organization_program_coverage_changed')
        then pg_catalog.jsonb_build_object(
          'before_programs', l.metadata -> 'before_programs',
          'after_programs', l.metadata -> 'after_programs'
        )
        when coalesce(l.event_type, l.action) = 'program_catalog_entry_created'
        then pg_catalog.jsonb_build_object('code', l.metadata -> 'code', 'name', l.metadata -> 'name')
        else '{}'::jsonb end as safe_details
    from public.audit_logs l
    where (p_organization_id is null or l.organization_id = p_organization_id)
      and l.actor_role = 'super_admin'
      and l.event_origin in ('trusted_database', 'trusted_edge', 'trusted_server')
      and (p_before_created_at is null or (coalesce(l.created_at, l.timestamp), l.id) < (p_before_created_at, p_before_id))
      and (p_category is null or coalesce(l.event_category, public.kandid_audit_category_for_event(coalesce(l.event_type, l.action))) = p_category)
      and (p_event_type is null or coalesce(l.event_type, l.action) = p_event_type)
      and (p_entity_type is null or l.entity_type = p_entity_type)
      and (p_status is null or pg_catalog.lower(coalesce(l.status, 'completed')) = pg_catalog.lower(p_status))
      and (p_election_id is null or l.election_id = p_election_id)
      and (p_created_on is null or (coalesce(l.created_at, l.timestamp) at time zone 'UTC')::date = p_created_on)
      and (nullif(pg_catalog.btrim(p_search), '') is null or
        pg_catalog.concat_ws(' ', l.actor_name, l.event_type, l.action, l.entity_type, l.entity_label, l.organization_name)
          ilike '%' || pg_catalog.btrim(p_search) || '%')
    order by coalesce(l.created_at, l.timestamp) desc, l.id desc
    limit page_limit + 1
  ), page_rows as (
    select * from filtered order by created_at desc, id desc limit page_limit
  )
  select pg_catalog.jsonb_build_object(
    'events', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', p.id, 'event_type', p.event_type, 'category', p.event_category,
      'actor_name', p.actor_name, 'actor_role', p.actor_role,
      'entity_type', p.entity_type, 'entity_id', p.entity_id, 'entity_label', p.entity_label,
      'organization_id', p.organization_id, 'organization_name', p.organization_name,
      'status', p.status, 'election_id', p.election_id, 'created_at', p.created_at,
      'changed_fields', p.changed_fields, 'safe_details', p.safe_details,
      'is_legacy', p.event_origin is null
    ) order by p.created_at desc, p.id desc) from page_rows p), '[]'::jsonb),
    'has_more', (select count(*) > page_limit from filtered),
    'next_cursor', (select pg_catalog.jsonb_build_object('created_at', p.created_at, 'id', p.id)
      from page_rows p order by p.created_at asc, p.id asc limit 1)
  ) into result_json;
  return result_json;
end;
$function$;
