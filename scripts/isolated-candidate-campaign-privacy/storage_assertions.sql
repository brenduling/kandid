\set ON_ERROR_STOP on
insert into storage.objects(bucket_id,name,owner_id) values
 ('campaign-materials','1/10/123e4567-e89b-42d3-a456-426614174000.webp','00000000-0000-4000-8000-000000000010'),
 ('campaign-materials','1/10/223e4567-e89b-42d3-a456-426614174000.webp','00000000-0000-4000-8000-000000000010'),
 ('campaign-materials','2/16/323e4567-e89b-42d3-a456-426614174000.webp','00000000-0000-4000-8000-000000000020'),
 ('campaign-materials','1/14/423e4567-e89b-42d3-a456-426614174000.webp','00000000-0000-4000-8000-000000000010');

set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
do $student$
begin
  if (select count(*) from storage.objects where bucket_id='campaign-materials')<>1 then raise exception 'student storage RLS exposed unpublished, foreign, or historical files'; end if;
  if not public.kandid_campaign_storage_access_v1('1/10/123e4567-e89b-42d3-a456-426614174000.webp','read') then raise exception 'published exact file ref denied'; end if;
  if public.kandid_campaign_storage_access_v1('1/10/999e4567-e89b-42d3-a456-426614174000.webp','read') then raise exception 'guessed object path allowed'; end if;
end;
$student$;
reset role;

set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000010',false);
do $board$
begin
  if (select count(*) from storage.objects where bucket_id='campaign-materials')<>3 then raise exception 'Board organization access to own files failed'; end if;
  if public.kandid_campaign_storage_access_v1('2/16/323e4567-e89b-42d3-a456-426614174000.webp','read') then raise exception 'Board guessed foreign object path'; end if;
end;
$board$;
reset role;

set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000020',false);
do $foreign_board$
begin
  if (select count(*) from storage.objects where bucket_id='campaign-materials')<>0 then raise exception 'foreign Board Storage rows not scoped'; end if;
  if public.kandid_campaign_storage_access_v1('1/10/123e4567-e89b-42d3-a456-426614174000.webp','read') then raise exception 'foreign Board read allowed'; end if;
end;
$foreign_board$;
reset role;

set role anon;
do $anonymous$
begin
  begin perform o.name from storage.objects o; raise exception 'anonymous storage enumeration succeeded'; exception when insufficient_privilege then null; end;
end;
$anonymous$;
reset role;
select 'CAMPAIGN_STORAGE_ASSERTIONS=PASS' as result;
