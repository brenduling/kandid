begin;

create or replace function public.kandid_super_admin_list_students(
  p_actor_admin_id bigint,
  p_search text default null,
  p_status text default 'all',
  p_student_ids integer[] default null,
  p_sort text default 'name_asc',
  p_page integer default 1,
  p_page_size integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  search_text text := pg_catalog.btrim(coalesce(p_search, ''));
  escaped_search text;
  normalized_status text := coalesce(p_status, 'all');
  normalized_sort text := coalesce(p_sort, 'name_asc');
  page_number integer := greatest(coalesce(p_page, 1), 1);
  page_limit integer := least(greatest(coalesce(p_page_size, 10), 1), 250);
  row_offset bigint;
  total_rows bigint;
  rows_json jsonb;
begin
  if not exists (
    select 1 from public.admin_users a
    where a.id = p_actor_admin_id and a.role = 'super_admin' and a.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Active Super Admin authorization is required.';
  end if;
  if normalized_status not in ('all', 'pending', 'active', 'disabled') then
    raise exception using errcode = '22023', message = 'Student status filter is invalid.';
  end if;
  if normalized_sort not in ('name_asc', 'name_desc', 'newest', 'oldest', 'id_asc', 'id_desc') then
    raise exception using errcode = '22023', message = 'Student sort option is invalid.';
  end if;
  if pg_catalog.cardinality(p_student_ids) > 50000 then
    raise exception using errcode = '22023', message = 'Student filter contains too many records.';
  end if;
  escaped_search := pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(search_text, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_');
  row_offset := (page_number::bigint - 1) * page_limit;

  with filtered as (
    select s.id, s.student_number, s.first_name, s.last_name, s.email,
           s.photo_url, s.program, s.year_level, s.precinct_code,
           s.batch_code, s.status, s.created_at
    from public.students s
    where (normalized_status = 'all' or s.status = normalized_status)
      and (p_student_ids is null or s.id = any(p_student_ids))
      and (search_text = '' or
        s.student_number ilike '%' || escaped_search || '%' escape E'\\' or
        s.first_name ilike '%' || escaped_search || '%' escape E'\\' or
        s.last_name ilike '%' || escaped_search || '%' escape E'\\' or
        coalesce(s.email, '') ilike '%' || escaped_search || '%' escape E'\\')
  ),
  counted as (select pg_catalog.count(*)::bigint as total from filtered),
  ordered as (
    select filtered.*,
      pg_catalog.row_number() over (
        order by
          case when normalized_sort = 'name_asc' then pg_catalog.lower(filtered.last_name) end asc nulls last,
          case when normalized_sort = 'name_desc' then pg_catalog.lower(filtered.last_name) end desc nulls last,
          case when normalized_sort = 'name_asc' then pg_catalog.lower(filtered.first_name) end asc nulls last,
          case when normalized_sort = 'name_desc' then pg_catalog.lower(filtered.first_name) end desc nulls last,
          case when normalized_sort = 'newest' then filtered.created_at end desc nulls last,
          case when normalized_sort = 'oldest' then filtered.created_at end asc nulls last,
          case when normalized_sort = 'id_asc' then filtered.student_number end asc nulls last,
          case when normalized_sort = 'id_desc' then filtered.student_number end desc nulls last,
          filtered.id asc
      ) as row_order
    from filtered
  ),
  page_rows as (
    select * from ordered where row_order > row_offset and row_order <= row_offset + page_limit
  )
  select counted.total,
         coalesce((select pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'id', p.id, 'student_number', p.student_number,
             'first_name', p.first_name, 'last_name', p.last_name,
             'email', p.email, 'photo_url', p.photo_url, 'program', p.program,
             'year_level', p.year_level, 'precinct_code', p.precinct_code,
             'batch_code', p.batch_code, 'status', p.status, 'created_at', p.created_at
           ) order by p.row_order
         ) from page_rows p), '[]'::jsonb)
    into total_rows, rows_json
  from counted;

  return pg_catalog.jsonb_build_object('total_count', total_rows, 'data', rows_json);
end;
$function$;

create or replace function public.kandid_super_admin_student_labels(
  p_actor_admin_id bigint,
  p_student_ids integer[]
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
    raise exception using errcode = '42501', message = 'Active Super Admin authorization is required.';
  end if;
  if pg_catalog.cardinality(p_student_ids) > 500 then
    raise exception using errcode = '22023', message = 'Student identity request is too large.';
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', s.id, 'student_number', s.student_number,
      'first_name', s.first_name, 'last_name', s.last_name
    ) order by s.id)
    from public.students s
    where s.id = any(coalesce(p_student_ids, array[]::integer[]))
  ), '[]'::jsonb);
end;
$function$;

-- Trusted Super Admin edit boundary. The Edge Function verifies the bearer
-- session; this service-role-only RPC independently resolves the supplied
-- actor against the active Super Admin registry and audits in this transaction.
create or replace function public.kandid_super_admin_update_student(
  p_actor_admin_id bigint,
  p_student_id integer,
  p_student jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  actor_row public.admin_users%rowtype;
  original_row public.students%rowtype;
  saved_row public.students%rowtype;
  allowed_keys text[] := array[
    'student_number', 'first_name', 'last_name', 'email', 'photo_url',
    'program', 'year_level', 'precinct_code', 'batch_code', 'status'
  ];
  changed_fields text[] := array[]::text[];
begin
  select a.* into actor_row
  from public.admin_users a
  where a.id = p_actor_admin_id
    and a.role = 'super_admin'
    and a.status = 'active';
  if not found then
    raise exception using errcode = '42501', message = 'Active Super Admin authorization is required.';
  end if;
  if p_student_id is null or jsonb_typeof(p_student) <> 'object' then
    raise exception using errcode = '22023', message = 'A student record and update object are required.';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_object_keys(p_student) as keys(key_name)
    where not (keys.key_name = any (allowed_keys))
  ) then
    raise exception using errcode = '22023', message = 'The update contains unsupported student fields.';
  end if;
  if nullif(pg_catalog.btrim(p_student->>'student_number'), '') is null
     or nullif(pg_catalog.btrim(p_student->>'first_name'), '') is null
     or nullif(pg_catalog.btrim(p_student->>'last_name'), '') is null
     or nullif(pg_catalog.btrim(p_student->>'program'), '') is null
     or nullif(p_student->>'year_level', '') is null
     or coalesce(p_student->>'status', '') not in ('pending', 'active', 'disabled') then
    raise exception using errcode = '22023', message = 'Student identity, academic fields, and status are required.';
  end if;
  if p_student->>'student_number' !~ '^[0-9]{5}$' then
    raise exception using errcode = '22023', message = 'Student Number must contain five digits.';
  end if;
  if coalesce(p_student->>'email', '') <> '' and p_student->>'email' !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'Enter a valid email address.';
  end if;
  if p_student->>'year_level' !~ '^[0-9]+$' then
    raise exception using errcode = '22023', message = 'Year level must be a whole number.';
  end if;
  if coalesce(p_student->>'email', '') <> '' and exists (
    select 1 from public.admin_users a
    where pg_catalog.lower(pg_catalog.btrim(a.email)) = pg_catalog.lower(pg_catalog.btrim(p_student->>'email'))
  ) then
    raise exception using errcode = '22023', message = 'This email address is already assigned to an administrator account.';
  end if;
  if p_student->>'status' = 'active' and coalesce(p_student->>'email', '') <> '' and exists (
    select 1 from public.students other_student
    where other_student.id <> p_student_id
      and other_student.status = 'active'
      and pg_catalog.lower(pg_catalog.btrim(other_student.email)) = pg_catalog.lower(pg_catalog.btrim(p_student->>'email'))
  ) then
    raise exception using errcode = '22023', message = 'This email address is already assigned to another active student.';
  end if;

  select s.* into original_row
  from public.students s
  where s.id = p_student_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Student record was not found.';
  end if;

  update public.students s
  set student_number = pg_catalog.btrim(p_student->>'student_number'),
      first_name = pg_catalog.btrim(p_student->>'first_name'),
      last_name = pg_catalog.btrim(p_student->>'last_name'),
      email = nullif(pg_catalog.lower(pg_catalog.btrim(p_student->>'email')), ''),
      photo_url = nullif(p_student->>'photo_url', ''),
      program = pg_catalog.btrim(p_student->>'program'),
      year_level = (p_student->>'year_level')::integer,
      precinct_code = nullif(pg_catalog.btrim(p_student->>'precinct_code'), ''),
      batch_code = nullif(pg_catalog.btrim(p_student->>'batch_code'), ''),
      status = p_student->>'status'
  where s.id = p_student_id
  returning s.* into saved_row;

  if original_row.student_number is distinct from saved_row.student_number then changed_fields := pg_catalog.array_append(changed_fields, 'student_number'); end if;
  if original_row.first_name is distinct from saved_row.first_name then changed_fields := pg_catalog.array_append(changed_fields, 'first_name'); end if;
  if original_row.last_name is distinct from saved_row.last_name then changed_fields := pg_catalog.array_append(changed_fields, 'last_name'); end if;
  if original_row.email is distinct from saved_row.email then changed_fields := pg_catalog.array_append(changed_fields, 'email'); end if;
  if original_row.photo_url is distinct from saved_row.photo_url then changed_fields := pg_catalog.array_append(changed_fields, 'photo_url'); end if;
  if original_row.program is distinct from saved_row.program then changed_fields := pg_catalog.array_append(changed_fields, 'program'); end if;
  if original_row.year_level is distinct from saved_row.year_level then changed_fields := pg_catalog.array_append(changed_fields, 'year_level'); end if;
  if original_row.precinct_code is distinct from saved_row.precinct_code then changed_fields := pg_catalog.array_append(changed_fields, 'precinct_code'); end if;
  if original_row.batch_code is distinct from saved_row.batch_code then changed_fields := pg_catalog.array_append(changed_fields, 'batch_code'); end if;
  if original_row.status is distinct from saved_row.status then changed_fields := pg_catalog.array_append(changed_fields, 'status'); end if;

  insert into public.audit_logs (
    user_id, actor_name, actor_role, action, event_type, event_category,
    entity_type, entity_id, entity_label, status, event_origin, metadata
  ) values (
    actor_row.id, actor_row.full_name, actor_row.role,
    'student_updated', 'student_updated', public.kandid_audit_category_for_event('student_updated'),
    'student', p_student_id::text, 'Student #' || p_student_id::text,
    'completed', 'trusted_server',
    pg_catalog.jsonb_build_object('changed_fields', to_jsonb(changed_fields))
  );

  return pg_catalog.to_jsonb(saved_row) - 'password' - 'auth_user_id';
end;
$function$;

-- Readiness and deletion share the same locked, fail-closed dependency scan.
-- On confirmation the scan, removable structural-membership cleanup, delete,
-- and audit insert run in this single transaction.
create or replace function public.kandid_super_admin_delete_student(
  p_actor_admin_id bigint,
  p_student_id integer,
  p_confirmed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  actor_row public.admin_users%rowtype;
  student_row public.students%rowtype;
  fk_row record;
  child_column text;
  dependency_count bigint;
  dependencies jsonb := '[]'::jsonb;
  membership_count bigint := 0;
begin
  select a.* into actor_row
  from public.admin_users a
  where a.id = p_actor_admin_id
    and a.role = 'super_admin'
    and a.status = 'active';
  if not found then
    raise exception using errcode = '42501', message = 'Active Super Admin authorization is required.';
  end if;
  if p_student_id is null then
    raise exception using errcode = '22023', message = 'A student record is required.';
  end if;

  select s.* into student_row
  from public.students s
  where s.id = p_student_id
  for update;
  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'NOT_FOUND', 'dependencies', '[]'::jsonb);
  end if;

  for fk_row in
    select r.oid as relation_oid,
           n.nspname as schema_name,
           r.relname as relation_name,
           con.conkey,
           con.confkey,
           con.conname
    from pg_catalog.pg_constraint con
    join pg_catalog.pg_class r on r.oid = con.conrelid
    join pg_catalog.pg_namespace n on n.oid = r.relnamespace
    join pg_catalog.pg_class target on target.oid = con.confrelid
    where con.contype = 'f'
      and target.oid = 'public.students'::regclass
      and r.relkind in ('r', 'p')
      and con.conrelid <> 'public.student_organizations'::regclass
    order by n.nspname, r.relname, con.conname
  loop
    if pg_catalog.cardinality(fk_row.conkey) <> 1
       or pg_catalog.cardinality(fk_row.confkey) <> 1
       or not exists (
         select 1
         from pg_catalog.pg_attribute parent_attribute
         where parent_attribute.attrelid = 'public.students'::regclass
           and parent_attribute.attnum = fk_row.confkey[1]
           and parent_attribute.attname = 'id'
       ) then
      raise exception using errcode = '55000', message = 'Student deletion dependency requires manual review.';
    end if;

    select child_attribute.attname into child_column
    from pg_catalog.pg_attribute child_attribute
    where child_attribute.attrelid = fk_row.relation_oid
      and child_attribute.attnum = fk_row.conkey[1];
    if child_column is null then
      raise exception using errcode = '55000', message = 'Student deletion dependency could not be verified.';
    end if;

    execute pg_catalog.format('select pg_catalog.count(*) from %I.%I where %I = $1', fk_row.schema_name, fk_row.relation_name, child_column)
      into dependency_count using p_student_id;
    if dependency_count > 0 then
      dependencies := dependencies || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('relation', fk_row.schema_name || '.' || fk_row.relation_name, 'count', dependency_count)
      );
    end if;
  end loop;

  if pg_catalog.jsonb_array_length(dependencies) > 0 then
    insert into public.audit_logs (
      user_id, actor_name, actor_role, action, event_type, event_category,
      entity_type, entity_id, entity_label, status, event_origin, metadata
    ) values (
      actor_row.id, actor_row.full_name, actor_row.role,
      'student_delete_blocked', 'student_delete_blocked', public.kandid_audit_category_for_event('student_delete_blocked'),
      'student', p_student_id::text, 'Student #' || p_student_id::text,
      'requires_action', 'trusted_server',
      pg_catalog.jsonb_build_object('dependencies', dependencies)
    );
    return pg_catalog.jsonb_build_object('outcome', 'BLOCKED', 'dependencies', dependencies);
  end if;

  select pg_catalog.count(*) into membership_count
  from public.student_organizations so
  where so.student_id = p_student_id;

  if not p_confirmed then
    return pg_catalog.jsonb_build_object(
      'outcome', 'READY',
      'dependencies', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('relation', 'public.student_organizations', 'count', membership_count, 'removable', true)
      )
    );
  end if;

  delete from public.student_organizations so where so.student_id = p_student_id;
  delete from public.students s where s.id = p_student_id;

  insert into public.audit_logs (
    user_id, actor_name, actor_role, action, event_type, event_category,
    entity_type, entity_id, entity_label, status, event_origin, metadata
  ) values (
    actor_row.id, actor_row.full_name, actor_row.role,
    'student_deleted', 'student_deleted', public.kandid_audit_category_for_event('student_deleted'),
    'student', p_student_id::text, 'Student #' || p_student_id::text,
    'completed', 'trusted_server',
    pg_catalog.jsonb_build_object('removed_structural_memberships', membership_count)
  );

  return pg_catalog.jsonb_build_object('outcome', 'DELETED', 'removed_structural_memberships', membership_count);
end;
$function$;

alter function public.kandid_super_admin_update_student(bigint, integer, jsonb) owner to postgres;
alter function public.kandid_super_admin_delete_student(bigint, integer, boolean) owner to postgres;
alter function public.kandid_super_admin_list_students(bigint, text, text, integer[], text, integer, integer) owner to postgres;
alter function public.kandid_super_admin_student_labels(bigint, integer[]) owner to postgres;
revoke all on function public.kandid_super_admin_update_student(bigint, integer, jsonb) from public, anon, authenticated;
revoke all on function public.kandid_super_admin_delete_student(bigint, integer, boolean) from public, anon, authenticated;
revoke all on function public.kandid_super_admin_list_students(bigint, text, text, integer[], text, integer, integer) from public, anon, authenticated;
revoke all on function public.kandid_super_admin_student_labels(bigint, integer[]) from public, anon, authenticated;
grant execute on function public.kandid_super_admin_update_student(bigint, integer, jsonb) to service_role;
grant execute on function public.kandid_super_admin_delete_student(bigint, integer, boolean) to service_role;
grant execute on function public.kandid_super_admin_list_students(bigint, text, text, integer[], text, integer, integer) to service_role;
grant execute on function public.kandid_super_admin_student_labels(bigint, integer[]) to service_role;
comment on function public.kandid_super_admin_update_student(bigint, integer, jsonb) is
  'Trusted Super Admin student update with server-verified actor and transactional audit.';
comment on function public.kandid_super_admin_delete_student(bigint, integer, boolean) is
  'Trusted Super Admin student deletion; readiness and confirmed deletion revalidate dependencies atomically.';
comment on function public.kandid_super_admin_list_students(bigint, text, text, integer[], text, integer, integer) is
  'Trusted paginated Super Admin Student directory read; actor, filters, and fields are validated server-side.';
comment on function public.kandid_super_admin_student_labels(bigint, integer[]) is
  'Trusted Super Admin-only Student identity labels for authorized administrative displays.';

-- The masterlist Edge Function already authenticates the active Super Admin
-- and calls this SECURITY DEFINER finalizer using its service-role client.
alter function public.finalize_masterlist_import(integer) owner to postgres;
alter function public.finalize_masterlist_import(integer) set search_path to pg_catalog;
revoke all on function public.finalize_masterlist_import(integer) from public, anon, authenticated, service_role;
grant execute on function public.finalize_masterlist_import(integer) to service_role;

notify pgrst, 'reload schema';

commit;
