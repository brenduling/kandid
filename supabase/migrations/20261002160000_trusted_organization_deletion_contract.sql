begin;

-- Trusted organization deletion. Dependency discovery is deliberately
-- conservative: every FK to organizations is discovered from catalogs, while
-- known scalar references without an FK are handled by an explicit registry.

create or replace function public.kandid_organization_deletion_registry()
returns table (
  schema_name text,
  table_name text,
  column_name text,
  expected_type text,
  dependency_key text,
  dependency_label text,
  classification text,
  resolution text,
  reference_method text
)
language sql
immutable
security definer
set search_path = pg_catalog
as $function$
  select * from (values
    ('public','elections','organization_id','integer','election_history','Election history','historical_preserved','Elections and their records are preserved.','scalar_id'),
    ('public','archived_elections','organization_id','integer','archived_election_history','Archived election history','historical_preserved','Archived elections and their snapshots are preserved.','scalar_id'),
    ('public','admin_users','organization_id','integer','board_assignments','Board assignments','administratively_resolvable','Review administrator assignments before deletion.','scalar_id'),
    ('public','officers','organization_id','integer','officer_history','Officer history','historical_preserved','Officer service history is preserved.','scalar_id'),
    ('public','organization_programs','organization_id','bigint','program_coverage','Program coverage','administratively_resolvable','Remove organization program coverage through its trusted management flow.','scalar_id'),
    ('public','student_organizations','organization_id','integer','student_memberships','Organization links','administratively_resolvable','Student organization links are distinct from current-term participation.','scalar_id'),
    ('public','student_organization_terms','organization_id','integer','current_term_participation','Current-term active participation','administratively_resolvable','Active participation in an active academic term.','term_participation'),
    ('public','student_organization_terms','organization_id','integer','historical_term_participation','Historical / removed term participation','historical_preserved','Historical or removed term participation is preserved.','term_participation'),
    ('public','partylists','organization_id','bigint','partylists','Partylists','administratively_resolvable','Partylists must be reviewed before deletion.','scalar_id'),
    ('public','officer_new_roster','organization_id','bigint','prepared_officers','Prepared officer rosters','administratively_resolvable','Prepared officer entries must be reviewed before deletion.','scalar_id'),
    ('public','officer_leadership_releases','organization_id','bigint','leadership_releases','Leadership releases','historical_preserved','Leadership release records are preserved.','scalar_id'),
    ('public','election_campaign_snapshots','organization_id','integer','campaign_snapshots','Campaign snapshots','historical_preserved','Campaign snapshots are preserved.','scalar_id'),
    ('public','election_officer_publications','organization_id','integer','officer_publications','Officer publications','historical_preserved','Officer publications are preserved.','scalar_id')
  ) as registry(schema_name,table_name,column_name,expected_type,dependency_key,dependency_label,classification,resolution,reference_method)
$function$;

revoke all on function public.kandid_organization_deletion_registry() from public, anon, authenticated, service_role;

create or replace function public.kandid_guard_organization_reference()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $function$
declare
  raw_id text;
  organization_key bigint;
  parent_exists boolean;
begin
  raw_id := pg_catalog.to_jsonb(new) ->> tg_argv[0];
  if raw_id is null then return new; end if;
  begin
    organization_key := raw_id::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '23503', message = 'Organization reference is invalid.';
  end;
  if organization_key <= 0 then
    raise exception using errcode = '23503', message = 'Organization reference is invalid.';
  end if;
  select true into parent_exists
  from public.organizations o
  where o.id = organization_key
  for key share;
  if not coalesce(parent_exists, false) then
    raise exception using errcode = '23503', message = 'Referenced organization does not exist.';
  end if;
  return new;
end;
$function$;

revoke all on function public.kandid_guard_organization_reference() from public, anon, authenticated, service_role;

-- Keep the registry honest against the schema at migration time. The registry
-- describes only scalar integer organization IDs; it never guesses JSON/arrays.
do $assert_registry$
declare
  r record;
  actual_type text;
begin
  for r in select * from public.kandid_organization_deletion_registry() loop
    select pg_catalog.format_type(a.atttypid, a.atttypmod) into actual_type
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_attribute a on a.attrelid = c.oid
    where n.nspname = r.schema_name and c.relname = r.table_name
      and c.relkind in ('r','p')
      and a.attname = r.column_name and a.attnum > 0 and not a.attisdropped;
    if actual_type is null or actual_type <> r.expected_type then
      raise exception 'Deletion registry schema mismatch at %.%.% (type: %)', r.schema_name, r.table_name, r.column_name, actual_type;
    end if;
  end loop;
end;
$assert_registry$;

-- Install row-level parent protection only on registered references that do
-- not already have an FK covering the organization column. FOR KEY SHARE
-- conflicts with deletion of that specific parent, without table-wide locks.
do $install_reference_guards$
declare
  r record;
  relid oid;
  attnum smallint;
  has_fk boolean;
  trigger_name text;
begin
  for r in select distinct schema_name, table_name, column_name
           from public.kandid_organization_deletion_registry()
           where not (schema_name = 'public' and table_name = 'audit_logs') loop
    select c.oid, a.attnum into relid, attnum
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_attribute a on a.attrelid = c.oid
    where n.nspname = r.schema_name and c.relname = r.table_name
      and a.attname = r.column_name and a.attnum > 0 and not a.attisdropped;
    select exists (
      select 1 from pg_catalog.pg_constraint con
      where con.contype = 'f' and con.confrelid = 'public.organizations'::pg_catalog.regclass
        and con.conrelid = relid and attnum = any(con.conkey)
    ) into has_fk;
    if not coalesce(has_fk, false) then
      trigger_name := pg_catalog.left('organization_parent_guard_' || r.table_name || '_' || r.column_name, 63);
      execute pg_catalog.format('drop trigger if exists %I on %I.%I', trigger_name, r.schema_name, r.table_name);
      execute pg_catalog.format(
        'create trigger %I after insert or update on %I.%I for each row execute function public.kandid_guard_organization_reference(%L)',
        trigger_name, r.schema_name, r.table_name, r.column_name
      );
    end if;
  end loop;
end;
$install_reference_guards$;

create or replace function public.kandid_organization_deletion_audit_ready()
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  audit_function oid;
  audit_function_ready boolean;
  audit_trigger_ready boolean;
  audit_columns_ready boolean;
  audit_fk_absent boolean;
begin
  audit_function := pg_catalog.to_regprocedure('public.kandid_audit_admin_row_change()');
  select p.prosecdef and p.proconfig @> array['search_path=pg_catalog']
    and pg_catalog.strpos(p.prosrc, 'organization_deleted') > 0
    and pg_catalog.strpos(p.prosrc, 'audit_logs') > 0
    into audit_function_ready
  from pg_catalog.pg_proc p where p.oid = audit_function;

  select exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.organizations'::pg_catalog.regclass
      and t.tgname = 'audit_organization_mutations'
      and t.tgfoid = audit_function
      and not t.tgisinternal and t.tgenabled in ('O','A')
      and (t.tgtype & 1) = 1 and (t.tgtype & 8) = 8
      and (t.tgtype & 2) = 0
  ) into audit_trigger_ready;

  select pg_catalog.to_regclass('public.audit_logs') is not null
    and (select pg_catalog.count(*) = 18
         from (values ('id'),('user_id'),('action'),('timestamp'),('actor_name'),('actor_role'),('created_at'),('entity_id'),('entity_label'),('entity_type'),('metadata'),('organization_id'),('organization_name'),('status'),('event_type'),('event_category'),('event_origin'),('election_id')) required(column_name)
         where exists (
           select 1 from pg_catalog.pg_attribute a
           where a.attrelid = 'public.audit_logs'::pg_catalog.regclass
             and a.attname = required.column_name and a.attnum > 0 and not a.attisdropped
         )) into audit_columns_ready;

  select not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.contype = 'f' and c.conrelid = 'public.audit_logs'::pg_catalog.regclass
      and c.confrelid = 'public.organizations'::pg_catalog.regclass
  ) into audit_fk_absent;

  return coalesce(audit_function_ready, false)
    and coalesce(audit_trigger_ready, false)
    and coalesce(audit_columns_ready, false)
    and coalesce(audit_fk_absent, false);
exception when undefined_table or invalid_name then
  return false;
end;
$function$;

revoke all on function public.kandid_organization_deletion_audit_ready() from public, anon, authenticated, service_role;

do $assert_audit_foundation$
begin
  if not public.kandid_organization_deletion_audit_ready() then
    raise exception 'Trusted organization deletion audit foundation is missing or incompatible.';
  end if;
end;
$assert_audit_foundation$;

create or replace function public.kandid_get_organization_deletion_readiness(p_organization_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $function$
declare
  caller_uid uuid := auth.uid();
  active_admin_count integer;
  organization_row record;
  dependencies jsonb := '[]'::jsonb;
  dependency_count bigint;
  verification_required boolean := false;
  fk record;
  ref record;
  unknown_ref record;
  join_sql text;
  source_columns text;
  referenced_columns text;
  category_key text;
  category_label text;
  category_classification text;
  category_resolution text;
begin
  if caller_uid is null then raise exception using errcode = '42501', message = 'Active Super Admin access is required.'; end if;
  select pg_catalog.count(*)::integer into active_admin_count
  from public.admin_users a
  where a.auth_user_id = caller_uid and a.role = 'super_admin' and a.status = 'active';
  if active_admin_count <> 1 then raise exception using errcode = '42501', message = 'One active Super Admin identity is required.'; end if;
  if p_organization_id is null or p_organization_id <= 0 then raise exception using errcode = '22023', message = 'A valid organization is required.'; end if;
  select o.id, o.name into organization_row from public.organizations o where o.id = p_organization_id;
  if not found then raise exception using errcode = 'P0002', message = 'Organization not found.'; end if;

  if not public.kandid_organization_deletion_audit_ready() then
    verification_required := true;
    dependencies := dependencies || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'key','verification_required','table','audit_logs','count',null,
      'classification','system_dependency','resolution','Trusted deletion audit could not be verified.'
    ));
  end if;

  -- Discover every FK whose referenced relation is organizations. Pair every
  -- source/referenced key column in ordinal order, including composite keys.
  for fk in
    select con.oid, con.conname, con.conrelid, con.conkey, con.confkey,
           con.confdeltype, ns.nspname as source_schema, rel.relname as source_table
    from pg_catalog.pg_constraint con
    join pg_catalog.pg_class rel on rel.oid = con.conrelid
    join pg_catalog.pg_namespace ns on ns.oid = rel.relnamespace
    where con.contype = 'f'
      and con.confrelid = 'public.organizations'::pg_catalog.regclass
      and con.conparentid = 0
      and rel.relkind in ('r','p')
    order by ns.nspname, rel.relname, con.conname
  loop
    begin
      -- conkey/confkey are catalog int2 arrays. Validate that both arrays
      -- share the same one-dimensional subscripts before pairing them.
      if pg_catalog.array_ndims(fk.conkey) is distinct from 1
         or pg_catalog.array_ndims(fk.confkey) is distinct from 1
         or pg_catalog.array_lower(fk.conkey, 1) is distinct from pg_catalog.array_lower(fk.confkey, 1)
         or pg_catalog.array_upper(fk.conkey, 1) is distinct from pg_catalog.array_upper(fk.confkey, 1) then
        raise exception 'Foreign-key column arrays could not be safely paired';
      end if;

      select pg_catalog.string_agg(pg_catalog.format('s.%I = o.%I', sa.attname, ta.attname), ' and ' order by pair.ordinality),
             pg_catalog.string_agg(pg_catalog.format('%I', sa.attname), ', ' order by pair.ordinality),
             pg_catalog.string_agg(pg_catalog.format('%I', ta.attname), ', ' order by pair.ordinality)
        into join_sql, source_columns, referenced_columns
      from pg_catalog.generate_subscripts(fk.conkey, 1) pair(ordinality)
      join pg_catalog.pg_attribute sa on sa.attrelid = fk.conrelid and sa.attnum = fk.conkey[pair.ordinality] and not sa.attisdropped
      join pg_catalog.pg_attribute ta on ta.attrelid = 'public.organizations'::pg_catalog.regclass and ta.attnum = fk.confkey[pair.ordinality] and not ta.attisdropped;
      if join_sql is null then raise exception 'Foreign-key columns could not be resolved'; end if;
      execute pg_catalog.format('select pg_catalog.count(*) from %I.%I s join public.organizations o on %s where o.id = $1', fk.source_schema, fk.source_table, join_sql)
        into dependency_count using organization_row.id;

      select r.dependency_key, r.dependency_label, r.classification, r.resolution
        into category_key, category_label, category_classification, category_resolution
      from public.kandid_organization_deletion_registry() r
      where r.schema_name = fk.source_schema and r.table_name = fk.source_table
      limit 1;
      category_key := coalesce(category_key, 'foreign_key_dependency');
      category_label := coalesce(category_label, fk.source_table || ' references');
      category_classification := coalesce(category_classification, 'historical_preserved');
      category_resolution := coalesce(category_resolution, 'Rows reference the organization through a database foreign key.');

      if fk.source_schema = 'public' and fk.source_table = 'student_organization_terms' then
        execute pg_catalog.format(
          'select pg_catalog.count(*) from %I.%I s join public.organizations o on %s join public.academic_terms t on t.id = s.academic_term_id where o.id = $1 and s.status = ''active'' and t.status = ''active''',
          fk.source_schema, fk.source_table, join_sql
        ) into dependency_count using organization_row.id;
        if dependency_count > 0 then dependencies := dependencies || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('key','current_term_participation','table',fk.source_table,'columns',source_columns,'referenced_columns',referenced_columns,'count',dependency_count,'classification','administratively_resolvable','resolution','Active participation in an active academic term.')); end if;
        execute pg_catalog.format(
          'select pg_catalog.count(*) from %I.%I s join public.organizations o on %s left join public.academic_terms t on t.id = s.academic_term_id where o.id = $1 and not coalesce(s.status = ''active'' and t.status = ''active'', false)',
          fk.source_schema, fk.source_table, join_sql
        ) into dependency_count using organization_row.id;
        if dependency_count > 0 then dependencies := dependencies || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('key','historical_term_participation','table',fk.source_table,'columns',source_columns,'referenced_columns',referenced_columns,'count',dependency_count,'classification','historical_preserved','resolution','Historical, removed, or non-current-term participation is preserved.')); end if;
      elsif dependency_count > 0 then
        dependencies := dependencies || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('key',category_key,'table',fk.source_schema || '.' || fk.source_table,'constraint',fk.conname,'columns',source_columns,'referenced_columns',referenced_columns,'count',dependency_count,'classification',category_classification,'resolution',category_resolution,'on_delete',case fk.confdeltype when 'c' then 'cascade' when 'n' then 'set_null' when 'd' then 'set_default' when 'r' then 'restrict' when 'a' then 'no_action' else 'unknown' end));
      end if;
    exception when others then
      verification_required := true;
      dependencies := dependencies || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('key','verification_required','table',fk.source_schema || '.' || fk.source_table,'constraint',fk.conname,'count',null,'classification','system_dependency','resolution','A discovered foreign-key relationship could not be safely counted.'));
    end;
  end loop;

  -- Count registered scalar references only when no direct organization FK
  -- protects that source column. Registry types are checked again at runtime.
  for ref in select * from public.kandid_organization_deletion_registry() loop
    begin
      if not exists (
        select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        join pg_catalog.pg_attribute a on a.attrelid = c.oid
        where n.nspname = ref.schema_name and c.relname = ref.table_name
          and a.attname = ref.column_name and a.attnum > 0 and not a.attisdropped
          and c.relkind in ('r','p')
          and pg_catalog.format_type(a.atttypid, a.atttypmod) = ref.expected_type
      ) then raise exception 'Registered scalar reference is missing or has unsupported type'; end if;
      if exists (
        select 1 from pg_catalog.pg_constraint con
        join pg_catalog.pg_class c on c.oid = con.conrelid
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum = any(con.conkey)
        where con.contype = 'f' and con.confrelid = 'public.organizations'::pg_catalog.regclass
          and n.nspname = ref.schema_name and c.relname = ref.table_name and a.attname = ref.column_name
      ) then continue; end if;

      if ref.reference_method = 'term_participation' then
        execute pg_catalog.format('select pg_catalog.count(*) from %I.%I s join public.academic_terms t on t.id = s.academic_term_id where s.%I = $1 and s.status = ''active'' and t.status = ''active''', ref.schema_name, ref.table_name, ref.column_name)
        into dependency_count using organization_row.id;
        if dependency_count > 0 then dependencies := dependencies || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('key','current_term_participation','table',ref.schema_name || '.' || ref.table_name,'column',ref.column_name,'count',dependency_count,'classification',ref.classification,'resolution',ref.resolution)); end if;
        execute pg_catalog.format('select pg_catalog.count(*) from %I.%I s left join public.academic_terms t on t.id = s.academic_term_id where s.%I = $1 and not coalesce(s.status = ''active'' and t.status = ''active'', false)', ref.schema_name, ref.table_name, ref.column_name)
        into dependency_count using organization_row.id;
        if dependency_count > 0 then dependencies := dependencies || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('key','historical_term_participation','table',ref.schema_name || '.' || ref.table_name,'column',ref.column_name,'count',dependency_count,'classification','historical_preserved','resolution','Historical, removed, or non-current-term participation is preserved.')); end if;
      else
        execute pg_catalog.format('select pg_catalog.count(*) from %I.%I where %I = $1', ref.schema_name, ref.table_name, ref.column_name)
          into dependency_count using organization_row.id;
        if dependency_count > 0 then
          dependencies := dependencies || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('key',ref.dependency_key,'table',ref.schema_name || '.' || ref.table_name,'column',ref.column_name,'count',dependency_count,'classification',ref.classification,'resolution',ref.resolution));
        end if;
      end if;
    exception when others then
      verification_required := true;
      dependencies := dependencies || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('key','verification_required','table',ref.schema_name || '.' || ref.table_name,'column',ref.column_name,'count',null,'classification','system_dependency','resolution','A registered organization reference could not be safely evaluated.'));
    end;
  end loop;

  -- New scalar organization_id columns that are neither registered nor FK
  -- protected are unknown. Never assume they contain zero dependencies.
  for unknown_ref in
    select n.nspname as schema_name, c.relname as table_name, a.attname as column_name
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_attribute a on a.attrelid = c.oid
    where c.relkind in ('r','p') and a.attnum > 0 and not a.attisdropped
      and a.attname ~* '(organization|org)'
      and not (n.nspname = 'public' and c.relname = 'organizations')
      and n.nspname not in ('pg_catalog','information_schema','pg_toast')
      and not (n.nspname = 'public' and c.relname = 'audit_logs')
      and not exists (select 1 from public.kandid_organization_deletion_registry() r where r.schema_name = n.nspname and r.table_name = c.relname and r.column_name = a.attname)
      and not exists (
        select 1 from pg_catalog.pg_constraint con
        where con.contype = 'f' and con.conrelid = c.oid
          and con.confrelid = 'public.organizations'::pg_catalog.regclass
          and a.attnum = any(con.conkey)
      )
  loop
    verification_required := true;
    dependencies := dependencies || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('key','verification_required','table',unknown_ref.schema_name || '.' || unknown_ref.table_name,'column',unknown_ref.column_name,'count',null,'classification','system_dependency','resolution','Unregistered organization reference requires review.'));
  end loop;

  return pg_catalog.jsonb_build_object(
    'organization_id', organization_row.id,
    'organization_name', organization_row.name,
    'can_delete', pg_catalog.jsonb_array_length(dependencies) = 0 and not verification_required,
    'verification_required', verification_required,
    'dependencies', dependencies
  );
end;
$function$;

create or replace function public.kandid_delete_organization(p_organization_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $function$
declare
  caller_uid uuid := auth.uid();
  active_admin_count integer;
  organization_name text;
  readiness jsonb;
begin
  if caller_uid is null then raise exception using errcode = '42501', message = 'Active Super Admin access is required.'; end if;
  select pg_catalog.count(*)::integer into active_admin_count
  from public.admin_users a
  where a.auth_user_id = caller_uid and a.role = 'super_admin' and a.status = 'active';
  if active_admin_count <> 1 then raise exception using errcode = '42501', message = 'One active Super Admin identity is required.'; end if;
  if p_organization_id is null or p_organization_id <= 0 then raise exception using errcode = '22023', message = 'A valid organization is required.'; end if;
  if not public.kandid_organization_deletion_audit_ready() then
    return pg_catalog.jsonb_build_object('deleted',false,'verification_required',true,'readiness',pg_catalog.jsonb_build_object('can_delete',false,'verification_required',true,'dependencies',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('key','verification_required','table','audit_logs','count',null,'classification','system_dependency','resolution','Trusted deletion audit could not be verified.'))));
  end if;

  -- Serialize against deletes and row-level KEY SHARE guards for registered
  -- non-FK references. No unrelated child table is globally locked.
  select o.name into organization_name
  from public.organizations o where o.id = p_organization_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'Organization not found.'; end if;

  readiness := public.kandid_get_organization_deletion_readiness(p_organization_id);
  if not coalesce((readiness ->> 'can_delete')::boolean, false) then
    return pg_catalog.jsonb_build_object('deleted',false,'readiness',readiness);
  end if;

  delete from public.organizations where id = p_organization_id;
  if not found then raise exception using errcode = '40001', message = 'Organization changed during deletion; retry.'; end if;
  -- The existing AFTER DELETE trusted audit trigger records exactly one
  -- organization_deleted event in the same transaction and preserves its log.
  return pg_catalog.jsonb_build_object('deleted',true,'organization_id',p_organization_id,'organization_name',organization_name);
end;
$function$;

revoke all on function public.kandid_get_organization_deletion_readiness(bigint) from public, anon, authenticated, service_role;
revoke all on function public.kandid_delete_organization(bigint) from public, anon, authenticated, service_role;
grant execute on function public.kandid_get_organization_deletion_readiness(bigint) to authenticated;
grant execute on function public.kandid_delete_organization(bigint) to authenticated;

-- The target row can be removed only through the trusted, audited RPC. PUBLIC,
-- anon, authenticated clients, and service_role have no direct DELETE path.
revoke delete on table public.organizations from public, anon, authenticated, service_role;

comment on function public.kandid_get_organization_deletion_readiness(bigint) is
  'Returns trusted, fail-closed organization deletion readiness for an active Super Admin.';
comment on function public.kandid_delete_organization(bigint) is
  'Atomically deletes an empty organization after trusted readiness revalidation and surviving audit verification.';

commit;
