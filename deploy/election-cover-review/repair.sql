-- REVIEW ONLY. Apply as ONE NEW migration after explicit production approval.
-- Do not replay migration_archive/20260901_election_cover_url.sql.
begin;
-- Fail closed on unexpected state instead of silently converting a bucket.
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='elections' and column_name='cover_url' and data_type='text') then
    raise exception 'Expected existing elections.cover_url text';
  end if;
  if exists (select 1 from storage.buckets where id='election-covers') then
    raise exception 'election-covers already exists: review configuration before applying';
  end if;
  if exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and
      (coalesce(qual,'') || coalesce(with_check,'')) like '%election-covers%') then
    raise exception 'Existing election cover policies require independent review';
  end if;
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('election-covers','election-covers',true,5242880,array['image/jpeg','image/png','image/webp','image/gif']);

create function public.kandid_election_cover_upload_allowed_v1(p_name text)
returns boolean language plpgsql stable security definer set search_path=pg_catalog as $$
declare parts text[]; org_id integer; election_id integer;
begin
  if auth.uid() is null or p_name is null or p_name !~
    '^[1-9][0-9]*/(drafts|elections/[1-9][0-9]*)/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp|gif)$' then return false; end if;
  parts := string_to_array(p_name,'/');
  begin
    org_id := parts[1]::integer;
    if parts[2]='elections' then election_id := parts[3]::integer; end if;
  exception when numeric_value_out_of_range or invalid_text_representation then return false; end;
  if not exists(select 1 from public.organizations o where o.id=org_id) then return false; end if;
  if not exists(select 1 from public.admin_users a where a.auth_user_id=auth.uid() and a.status='active'
      and (a.role='super_admin' or (a.role='electoral_board' and a.organization_id=org_id))) then return false; end if;
  if election_id is not null and not exists(select 1 from public.elections e
      where e.id=election_id and e.organization_id=org_id and e.removed_at is null) then return false; end if;
  return true;
end $$;
revoke all on function public.kandid_election_cover_upload_allowed_v1(text) from public,anon;
grant execute on function public.kandid_election_cover_upload_allowed_v1(text) to authenticated;

create policy election_covers_scoped_insert on storage.objects for insert to authenticated
with check(bucket_id='election-covers' and owner_id=auth.uid()::text and public.kandid_election_cover_upload_allowed_v1(name));
-- Public delivery works through /object/public without an objects SELECT policy.
-- No list, UPDATE, upsert or DELETE permission is introduced. All cover objects
-- are immutable; replacement saves a new URL. No campaign-materials changes.
commit;
