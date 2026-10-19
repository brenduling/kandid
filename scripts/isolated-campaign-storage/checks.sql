\set ON_ERROR_STOP on
begin;
do $$
begin
 if not (select public is false and file_size_limit=52428800
     and allowed_mime_types=array['image/jpeg','image/png','image/webp','video/mp4','video/webm','application/pdf']::text[]
     from storage.buckets where id='campaign-materials') then
   raise exception 'private bucket restrictions mismatch';
 end if;
 if (select count(*) from pg_policies where schemaname='storage' and tablename='objects'
     and policyname in ('campaign_materials_scoped_upload','campaign_materials_scoped_read','campaign_materials_owner_cleanup'))<>3 then
   raise exception 'storage RLS policy inventory mismatch';
 end if;
 if (select prosecdef is true and proconfig=array['search_path=pg_catalog']::text[]
     from pg_proc where oid='public.kandid_campaign_storage_access_v1(text,text)'::regprocedure) is not true then
   raise exception 'storage authorization function security settings mismatch';
 end if;
 if not exists (
      select 1 from pg_catalog.aclexplode(
        (select proacl from pg_catalog.pg_proc
         where oid='public.kandid_campaign_storage_access_v1(text,text)'::regprocedure)
      ) acl
      where acl.grantee='authenticated'::regrole and acl.privilege_type='EXECUTE'
    )
    or exists (
      select 1 from pg_catalog.aclexplode(
        (select proacl from pg_catalog.pg_proc
         where oid='public.kandid_campaign_storage_access_v1(text,text)'::regprocedure)
      ) acl
      where acl.grantee in (0, 'anon'::regrole, 'service_role'::regrole)
        and acl.privilege_type='EXECUTE'
    ) then
   raise exception 'function execution grants mismatch';
 end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
insert into storage.objects(bucket_id,name,owner_id,metadata)
values ('campaign-materials','2/3/123e4567-e89b-42d3-a456-426614174000.png',auth.uid()::text,'{"mimetype":"image/png"}');
do $$
begin
 if (select count(*) from storage.objects where bucket_id='campaign-materials')<>0 then raise exception 'unlinked upload was exposed before candidate save'; end if;
 if public.kandid_campaign_storage_access_v1('9/3/123e4567-e89b-42d3-a456-426614174000.png','upload') then raise exception 'cross-organization upload authorized'; end if;
 if public.kandid_campaign_storage_access_v1('2/5/123e4567-e89b-42d3-a456-426614174000.png','upload') then raise exception 'removed-election upload authorized'; end if;
 if public.kandid_campaign_storage_access_v1('2/6/123e4567-e89b-42d3-a456-426614174000.png','upload') then raise exception 'closed-election upload authorized'; end if;
 begin
  insert into storage.objects(bucket_id,name,owner_id) values ('campaign-materials','9/3/223e4567-e89b-42d3-a456-426614174000.png',auth.uid()::text);
  raise exception 'cross-organization insert bypassed RLS';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;

update public.candidates
set campaign_materials=jsonb_build_array(jsonb_build_object(
 'label','Synthetic private image','type','media',
 'url','storage://campaign-materials/2/3/123e4567-e89b-42d3-a456-426614174000.png',
 'downloadable',false))
where id=300;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$
declare deleted_count integer;
begin
 delete from storage.objects where bucket_id='campaign-materials'
  and name='2/3/123e4567-e89b-42d3-a456-426614174000.png';
 get diagnostics deleted_count=row_count;
 if deleted_count<>0 then raise exception 'referenced campaign file was deleted'; end if;
 if (select count(*) from storage.objects where bucket_id='campaign-materials')<>1 then raise exception 'referenced campaign file disappeared'; end if;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
do $$
begin
 if (select count(*) from storage.objects where bucket_id='campaign-materials')<>1 then raise exception 'eligible student cannot read campaign-referenced file'; end if;
 if public.kandid_campaign_storage_access_v1('9/3/223e4567-e89b-42d3-a456-426614174000.png','read') then raise exception 'student can inspect another organization storage path'; end if;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000005',true);
do $$
begin
 if (select count(*) from storage.objects where bucket_id='campaign-materials')<>0 then raise exception 'ineligible student read private campaign file'; end if;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
do $$
begin
 if (select count(*) from storage.objects where bucket_id='campaign-materials')<>0 then raise exception 'foreign Board read another organization file'; end if;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
do $$
begin
 if (select count(*) from storage.objects where bucket_id='campaign-materials')<>1 then raise exception 'Super Admin cannot read authorized campaign file'; end if;
end $$;
reset role;

set local role anon;
do $$
begin
 begin
  perform public.kandid_campaign_storage_access_v1('2/3/123e4567-e89b-42d3-a456-426614174000.png','read');
  raise exception 'anon function call bypassed EXECUTE restriction';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
rollback;

select 'PASS' as result, 'private bucket, RLS insert/read/delete scope, Board/Super Admin/student authorization, lifecycle denial, history preservation, function grants' as checks;
