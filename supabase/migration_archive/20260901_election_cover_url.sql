alter table public.elections
  add column if not exists cover_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'election-covers',
  'election-covers',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Public election cover reads'
  ) then
    create policy "Public election cover reads"
      on storage.objects
      for select
      using (bucket_id = 'election-covers');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Kandid election cover uploads'
  ) then
    create policy "Kandid election cover uploads"
      on storage.objects
      for insert
      to anon, authenticated
      with check (bucket_id = 'election-covers');
  end if;
end $$;
