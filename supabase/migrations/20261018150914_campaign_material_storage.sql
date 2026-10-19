-- Private candidate campaign assets. A file can be read by an authorized
-- organization administrator, or by a student only while the trusted campaign
-- RPC returns that exact reference for the authenticated student.
begin;

do $campaign_material_storage_preflight$
begin
  if to_regprocedure('private.kandid_active_admin_can_access_organization(bigint)') is null
     or to_regprocedure('public.kandid_can_mutate_election_positions(integer)') is null
     or to_regprocedure('public.get_student_campaign(integer)') is null
     or to_regclass('public.admin_users') is null
     or to_regclass('public.elections') is null
     or to_regclass('public.candidates') is null
     or to_regclass('public.positions') is null
     or to_regclass('storage.buckets') is null
     or to_regclass('storage.objects') is null
     or not exists (
       select 1 from pg_catalog.pg_attribute a
       where a.attrelid = 'public.elections'::regclass
         and a.attname = 'removed_at' and not a.attisdropped
     )
     or not exists (
       select 1 from pg_catalog.pg_attribute a
       where a.attrelid = 'public.candidates'::regclass
         and a.attname = 'campaign_materials' and a.atttypid = 'jsonb'::regtype
         and not a.attisdropped
     )
     or not exists (
       select 1 from pg_catalog.pg_attribute a
       where a.attrelid = 'public.candidates'::regclass
         and a.attname = 'campaign_media_urls' and a.atttypid = 'jsonb'::regtype
         and not a.attisdropped
     )
     or not (
       select c.relrowsecurity from pg_catalog.pg_class c
       where c.oid = 'storage.objects'::regclass
     ) then
    raise exception 'Candidate campaign storage dependencies do not match the reviewed schema';
  end if;
end;
$campaign_material_storage_preflight$;

do $campaign_material_bucket_preflight$
begin
  if exists (
    select 1 from storage.buckets b where b.id = 'campaign-materials'
  ) then
    raise exception 'campaign-materials bucket already exists; inspect its configuration before installing this migration';
  end if;
end;
$campaign_material_bucket_preflight$;

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
) values (
  'campaign-materials',
  'campaign-materials',
  false,
  52428800,
  array[
    'image/jpeg', 'image/png', 'image/webp',
    'video/mp4', 'video/webm', 'application/pdf'
  ]::text[]
);

create function public.kandid_campaign_storage_access_v1(
  p_object_name text,
  p_action text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  object_parts text[];
  organization_id_value bigint;
  election_id_value integer;
  actor_count integer;
  actor_role text;
  object_reference text;
  campaign_response jsonb;
begin
  if auth.uid() is null
     or p_action not in ('upload', 'read', 'cleanup')
     or p_object_name is null
     or p_object_name !~ '^[1-9][0-9]*/[1-9][0-9]*/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|mp4|webm|pdf)$' then
    return false;
  end if;

  object_parts := pg_catalog.string_to_array(p_object_name, '/');
  organization_id_value := object_parts[1]::bigint;
  election_id_value := object_parts[2]::integer;
  object_reference := 'storage://campaign-materials/' || p_object_name;

  select count(*)::integer, min(a.role)
    into actor_count, actor_role
  from public.admin_users a
  where a.auth_user_id = auth.uid()
    and a.status = 'active';

  if actor_count = 1
     and actor_role in ('electoral_board', 'super_admin')
     and private.kandid_active_admin_can_access_organization(organization_id_value)
     and exists (
       select 1
       from public.elections e
       where e.id = election_id_value
         and e.organization_id = organization_id_value
         and e.removed_at is null
     ) then
    if p_action = 'read' then
      return exists (
        select 1
        from public.candidates c
        join public.positions p on p.id = c.position_id
        where p.election_id = election_id_value
          and exists (
            select 1
            from pg_catalog.jsonb_array_elements(
              case when pg_catalog.jsonb_typeof(c.campaign_materials) = 'array'
                then c.campaign_materials else '[]'::jsonb end
            ) material(value)
            where material.value ->> 'url' = object_reference
          )
      );
    end if;

    if not public.kandid_can_mutate_election_positions(election_id_value) then
      return false;
    end if;

    if p_action = 'upload' then
      return true;
    end if;

    -- Cleanup is limited to the caller's unreferenced upload. Once a campaign
    -- row references a file, neither the UI nor this policy can delete it.
    return not exists (
      select 1 from public.candidates c
      join public.positions p on p.id = c.position_id
      where p.election_id = election_id_value
        and (
          exists (
            select 1 from pg_catalog.jsonb_array_elements(
              case when pg_catalog.jsonb_typeof(c.campaign_materials) = 'array'
                then c.campaign_materials else '[]'::jsonb end
            ) material(value)
            where material.value ->> 'url' = object_reference
          )
          or c.campaign_media_urls @> pg_catalog.jsonb_build_array(object_reference)
        )
    );
  end if;

  if p_action <> 'read' then
    return false;
  end if;

  -- Student access is delegated to the existing authenticated campaign
  -- contract. It checks the caller's linked active student, current-term
  -- eligibility and campaign window, and returns only that student's campaign.
  campaign_response := public.get_student_campaign(election_id_value);
  return campaign_response ->> 'status' = 'AVAILABLE'
    and exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        case when pg_catalog.jsonb_typeof(
          campaign_response #> '{data,candidates}'
        ) = 'array'
          then campaign_response #> '{data,candidates}' else '[]'::jsonb end
      ) candidate(value)
      cross join lateral pg_catalog.jsonb_array_elements(
        case when pg_catalog.jsonb_typeof(candidate.value -> 'campaign_materials') = 'array'
          then candidate.value -> 'campaign_materials' else '[]'::jsonb end
      ) material(value)
      where material.value ->> 'url' = object_reference
    );
end;
$function$;

alter function public.kandid_campaign_storage_access_v1(text, text) owner to postgres;
revoke all on function public.kandid_campaign_storage_access_v1(text, text) from public;
revoke all on function public.kandid_campaign_storage_access_v1(text, text) from anon;
revoke all on function public.kandid_campaign_storage_access_v1(text, text) from service_role;
grant execute on function public.kandid_campaign_storage_access_v1(text, text) to authenticated;

create policy campaign_materials_scoped_upload
on storage.objects for insert to authenticated
with check (
  bucket_id = 'campaign-materials'
  and owner_id = auth.uid()::text
  and public.kandid_campaign_storage_access_v1(name, 'upload')
);

create policy campaign_materials_scoped_read
on storage.objects for select to authenticated
using (
  bucket_id = 'campaign-materials'
  and public.kandid_campaign_storage_access_v1(name, 'read')
);

create policy campaign_materials_owner_cleanup
on storage.objects for delete to authenticated
using (
  bucket_id = 'campaign-materials'
  and owner_id = auth.uid()::text
  and public.kandid_campaign_storage_access_v1(name, 'cleanup')
);

-- No UPDATE policy: uploads are always new, collision-resistant paths and never
-- use upsert. No anonymous access or public bucket URLs are enabled.

commit;
