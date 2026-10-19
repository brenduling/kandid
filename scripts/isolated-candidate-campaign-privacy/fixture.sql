\set ON_ERROR_STOP on
-- Minimal local-only Supabase Auth identity stub for the disposable PostgreSQL
-- image. Tests set request.jwt.claim.sub to simulate a verified JWT subject.
create schema if not exists auth;
create or replace function auth.uid() returns uuid
language sql stable
set search_path = pg_catalog
as $$ select nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
create schema private;
create schema if not exists storage;
grant usage on schema auth,public,storage to anon,authenticated,service_role;
create table public.organizations(id integer primary key,name text,logo_url text);
create table public.academic_terms(id integer primary key,status text,created_at timestamptz default now());
create table public.admin_users(id integer primary key,auth_user_id uuid,role text,status text,organization_id bigint);
create table public.students(id integer primary key,auth_user_id uuid,status text,student_number text,first_name text,last_name text,email text,photo_url text,program text,year_level integer);
create table public.student_term_enrollments(id integer primary key,student_id integer,academic_term_id integer,enrollment_status text,program text,year_level integer);
create table public.student_organization_terms(id integer primary key,student_id integer,organization_id integer,academic_term_id integer,status text,source text);
create table public.elections(id integer primary key,organization_id integer,academic_term_id integer,title text,cover_url text,status text,removed_at timestamptz,campaign_start timestamp,campaign_end timestamp,start_date timestamp,end_date timestamp,electorate_policy_version smallint default 1,electorate_frozen_at timestamptz,results_released_at timestamptz,student_result_visibility text default 'hidden');
create table public.positions(id integer primary key,election_id integer,name text,display_order integer,max_votes integer default 1,status text default 'active');
create table public.partylists(id integer primary key,organization_id bigint,election_id integer,name text,logo_url text);
create table public.candidates(id integer primary key,position_id integer,student_id integer,partylist_id integer,photo text,bio text,platform text,credentials text,campaign_status text default 'draft',campaign_materials jsonb default '[]',campaign_media_urls jsonb default '[]');
create table private.election_eligible_voters(election_id integer,student_id integer,created_at timestamptz default now(),primary key(election_id,student_id));
alter table private.election_eligible_voters enable row level security;
create table public.vote_ballots(id uuid primary key,election_id integer,student_id integer);
create table public.votes(id integer primary key,election_id integer,position_id integer,candidate_id integer);
create table public.candidate_media(id integer primary key,candidate_id integer,media_url text);
create table public.eligibility_rules(id integer primary key,election_id integer,rule jsonb);
create table public.election_access_tokens(id integer primary key,election_id integer,token_hash text);
create table public.election_campaign_snapshots(id uuid primary key,election_id integer,snapshot jsonb);
create table public.archived_elections(id integer primary key,election_id integer,snapshot jsonb);
create table public.officers(id integer primary key,election_id integer,position_id integer,candidate_id integer);
create table public.officer_new_roster(id integer primary key,election_id integer,student_id integer);
create table public.officer_leadership_releases(id bigint primary key,election_id integer);
create table public.election_officer_publications(id uuid primary key,election_id integer);
create table public.election_officer_publication_entries(id uuid primary key,publication_id uuid,source_officer_id integer);
create table public.audit_logs(id integer primary key,event_type text,record jsonb);
alter table public.candidates enable row level security;
create policy candidates_public_read on public.candidates for select to anon,authenticated using(true);
create policy candidates_insert_authorized_election on public.candidates for insert to authenticated with check(position_id is not null);
create policy candidates_update_authorized_election on public.candidates for update to authenticated using(position_id is not null) with check(position_id is not null);
create policy candidates_delete_authorized_election on public.candidates for delete to authenticated using(position_id is not null);
grant select,insert,update,delete on public.candidates to authenticated;
grant select on public.candidates to anon;
grant select on public.organizations,public.academic_terms,public.admin_users,public.students,public.student_term_enrollments,public.student_organization_terms,public.elections,public.positions,public.partylists to anon,authenticated,service_role;
create function private.normalize_student_campaign_materials(p_materials jsonb,p_legacy_urls jsonb) returns jsonb language sql immutable set search_path=pg_catalog as $$ select case when jsonb_typeof(p_materials)='array' then p_materials else '[]'::jsonb end $$;
revoke all on function private.normalize_student_campaign_materials(jsonb,jsonb) from public,anon,authenticated,service_role;
create function private.kandid_active_admin_can_access_organization(p_org bigint) returns boolean language sql stable security definer set search_path=pg_catalog as $$ select count(*)=1 and coalesce(bool_or(a.role='super_admin' or (a.role='electoral_board' and a.organization_id=p_org)),false) from public.admin_users a where a.auth_user_id=auth.uid() and a.status='active' $$;
create function public.kandid_can_mutate_election_positions(p_election integer) returns boolean language sql stable security definer set search_path=pg_catalog as $$ select exists(select 1 from public.admin_users a join public.elections e on e.id=p_election where a.auth_user_id=auth.uid() and a.status='active' and (a.role='super_admin' or (a.role='electoral_board' and a.organization_id=e.organization_id)) and e.removed_at is null and e.status='active') $$;
alter function public.kandid_can_mutate_election_positions(integer) owner to postgres;
revoke all on function public.kandid_can_mutate_election_positions(integer) from public,anon,authenticated,service_role;
grant execute on function public.kandid_can_mutate_election_positions(integer) to authenticated;
create function public.resolve_student_organization_participation(target_student_id integer,target_organization_id integer,target_academic_term_id integer) returns table(allowed boolean,status text,source text,reason text) language sql stable set search_path=pg_catalog as $$
 select exists(select 1 from public.student_term_enrollments ste join public.student_organization_terms sot on sot.student_id=ste.student_id and sot.academic_term_id=ste.academic_term_id and sot.organization_id=target_organization_id where ste.student_id=target_student_id and ste.academic_term_id=target_academic_term_id and ste.enrollment_status='enrolled' and sot.status='active'),'active'::text,'synthetic'::text,'synthetic_test'::text
$$;
alter function public.resolve_student_organization_participation(integer,integer,integer) owner to postgres;
revoke all on function public.resolve_student_organization_participation(integer,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.resolve_student_organization_participation(integer,integer,integer) to service_role;
create function public.kandid_admin_candidate_directory(p_election_ids integer[] default null,p_student_ids integer[] default null) returns setof jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare caller uuid:=auth.uid(); actor_role text; actor_org bigint;
begin
 select a.role,a.organization_id into actor_role,actor_org from public.admin_users a where a.auth_user_id=caller and a.status='active';
 if caller is null or actor_role not in ('electoral_board','super_admin') then raise exception using errcode='42501',message='Candidate records are unavailable.'; end if;
 return query select to_jsonb(c) from public.candidates c join public.positions p on p.id=c.position_id join public.elections e on e.id=p.election_id
 where (coalesce(cardinality(p_election_ids),0)=0 or e.id=any(p_election_ids)) and (coalesce(cardinality(p_student_ids),0)=0 or c.student_id=any(p_student_ids)) and (actor_role='super_admin' or e.organization_id=actor_org) order by c.id;
end $$;
alter function public.kandid_admin_candidate_directory(integer[],integer[]) owner to postgres;
revoke all on function public.kandid_admin_candidate_directory(integer[],integer[]) from public,anon,authenticated,service_role;
grant execute on function public.kandid_admin_candidate_directory(integer[],integer[]) to authenticated;
create function public.kandid_get_election_turnout(p_election_id integer) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare uid uuid:=auth.uid(); sid integer; e record; ok boolean;
begin
 select * into e from public.elections where id=p_election_id;
 if not found then raise exception using errcode='42501',message='Election is unavailable.'; end if;
 select id into sid from public.students where auth_user_id=uid and status='active';
 if sid is null or not (e.results_released_at is not null or (e.student_result_visibility='realtime' and e.status='active') or (e.student_result_visibility='after_close' and e.status='closed')) then raise exception using errcode='42501',message='Election is unavailable.'; end if;
 select r.allowed into ok from public.resolve_student_organization_participation(sid,e.organization_id,e.academic_term_id) r;
 if not coalesce(ok,false) then raise exception using errcode='42501',message='Election is unavailable.'; end if;
 return jsonb_build_object('election_id',p_election_id,'visible',true);
end $$;
alter function public.kandid_get_election_turnout(integer) owner to postgres;
revoke all on function public.kandid_get_election_turnout(integer) from public,anon,authenticated,service_role;
grant execute on function public.kandid_get_election_turnout(integer) to authenticated;
create function public.get_student_campaign(p_election_id integer) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin return jsonb_build_object('status','AVAILABLE','data',jsonb_build_object('candidates',(select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) from public.candidates c join public.positions p on p.id=c.position_id where p.election_id=p_election_id))); end $$;
alter function public.get_student_campaign(integer) owner to postgres;
revoke all on function public.get_student_campaign(integer) from public,anon,authenticated,service_role;
grant execute on function public.get_student_campaign(integer) to authenticated;
create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id bigint generated always as identity primary key,bucket_id text,name text,owner_id text,metadata jsonb default '{}'::jsonb,unique(bucket_id,name));
alter table storage.objects enable row level security;
grant select,insert,delete on storage.objects to authenticated;
insert into public.organizations values (1,'Synthetic One',null),(2,'Synthetic Two',null);
insert into public.academic_terms values (1,'active',now()),(2,'closed',now()-interval '1 year');
insert into public.admin_users values (10,'00000000-0000-4000-8000-000000000010','electoral_board','active',1),(20,'00000000-0000-4000-8000-000000000020','electoral_board','active',2),(30,'00000000-0000-4000-8000-000000000030','super_admin','active',null);
insert into public.students values (1,'00000000-0000-4000-8000-000000000001','active','SYN-1','Synthetic','One','one@example.invalid',null,'BSIT',4),(2,'00000000-0000-4000-8000-000000000002','active','SYN-2','Synthetic','Two','two@example.invalid',null,'BSHM',3),(3,'00000000-0000-4000-8000-000000000003','active','SYN-3','Synthetic','Three','three@example.invalid',null,'BSIT',2),(4,'00000000-0000-4000-8000-000000000004','disabled','SYN-4','Synthetic','Four','four@example.invalid',null,'BSIT',1);
insert into public.student_term_enrollments values (101,1,1,'enrolled','BSIT',4),(102,2,1,'enrolled','BSHM',3),(103,1,2,'enrolled','BSIT',4);
insert into public.student_organization_terms values (201,1,1,1,'active','program'),(202,2,2,1,'active','program'),(203,1,1,2,'active','program');
insert into public.elections values
 (10,1,1,'Synthetic Ongoing',null,'active',null,timezone('Asia/Manila',now())-interval '1 day',timezone('Asia/Manila',now())+interval '1 day',timezone('Asia/Manila',now())-interval '1 hour',timezone('Asia/Manila',now())+interval '1 hour',1,now(),null,'hidden'),
 (11,1,1,'Synthetic Upcoming',null,'active',null,timezone('Asia/Manila',now())+interval '1 day',timezone('Asia/Manila',now())+interval '2 days',timezone('Asia/Manila',now())+interval '3 days',timezone('Asia/Manila',now())+interval '4 days',1,now(),null,'hidden'),
 (12,1,1,'Synthetic Ended',null,'active',null,timezone('Asia/Manila',now())-interval '4 days',timezone('Asia/Manila',now())-interval '3 days',timezone('Asia/Manila',now())-interval '2 days',timezone('Asia/Manila',now())-interval '1 day',1,now(),null,'hidden'),
 (13,1,1,'Synthetic Removed',null,'active',now(),timezone('Asia/Manila',now())-interval '1 day',timezone('Asia/Manila',now())+interval '1 day',timezone('Asia/Manila',now())-interval '1 hour',timezone('Asia/Manila',now())+interval '1 hour',1,now(),null,'hidden'),
 (14,1,2,'Synthetic Released History',null,'closed',null,timezone('Asia/Manila',now())-interval '4 days',timezone('Asia/Manila',now())-interval '3 days',timezone('Asia/Manila',now())-interval '2 days',timezone('Asia/Manila',now())-interval '1 day',1,now(),now(),'hidden'),
 (15,1,2,'Synthetic Hidden Results',null,'closed',null,timezone('Asia/Manila',now())-interval '4 days',timezone('Asia/Manila',now())-interval '3 days',timezone('Asia/Manila',now())-interval '2 days',timezone('Asia/Manila',now())-interval '1 day',1,now(),null,'hidden'),
 (16,2,1,'Synthetic Foreign',null,'active',null,timezone('Asia/Manila',now())-interval '1 day',timezone('Asia/Manila',now())+interval '1 day',timezone('Asia/Manila',now())-interval '1 hour',timezone('Asia/Manila',now())+interval '1 hour',1,now(),null,'hidden'),
 (17,1,1,'Synthetic Legacy Policy Zero',null,'active',null,timezone('Asia/Manila',now())-interval '1 day',timezone('Asia/Manila',now())+interval '1 day',timezone('Asia/Manila',now())-interval '1 hour',timezone('Asia/Manila',now())+interval '1 hour',0,null,null,'hidden');
insert into public.positions values (100,10,'President',1,1,'active'),(110,11,'President',1,1,'active'),(120,12,'President',1,1,'active'),(130,13,'President',1,1,'active'),(140,14,'President',1,1,'active'),(150,15,'President',1,1,'active'),(160,16,'President',1,1,'active'),(170,17,'President',1,1,'active');
insert into public.partylists values (1,1,null,'Reusable One',null),(2,1,10,'Election Ten',null),(3,2,null,'Foreign Two',null);
insert into public.candidates(id,position_id,student_id,partylist_id,photo,bio,platform,credentials,campaign_status,campaign_materials,campaign_media_urls) values
 (1001,100,1,1,'https://example.invalid/photo.png','Published biography','Published platform','Published credentials','published','[{"label":"Published Image","type":"media","url":"storage://campaign-materials/1/10/123e4567-e89b-42d3-a456-426614174000.webp","downloadable":false}]','[]'),
 (1002,100,2,2,'https://example.invalid/draft.png','SECRET DRAFT BIO','SECRET DRAFT PLATFORM','SECRET DRAFT CREDENTIALS','draft','[{"label":"Draft Secret","type":"media","url":"storage://campaign-materials/1/10/223e4567-e89b-42d3-a456-426614174000.webp","downloadable":false}]','[]'),
 (1003,100,3,null,null,'SECRET HIDDEN BIO','SECRET HIDDEN PLATFORM','SECRET HIDDEN CREDENTIALS','hidden','[]','[]'),
 (1101,110,1,1,null,'Upcoming secret','Upcoming platform','Upcoming credential','published','[]','[]'),
 (1201,120,1,null,null,'Ended secret','Ended platform','Ended credential','published','[]','[]'),
 (1301,130,1,null,null,'Removed secret','Removed platform','Removed credential','published','[]','[]'),
 (1401,140,1,null,null,'Historical result profile','Historical platform','Historical credential','draft','[{"label":"History Draft Secret","type":"media","url":"storage://campaign-materials/1/14/423e4567-e89b-42d3-a456-426614174000.webp","downloadable":false}]','[]'),
 (1501,150,1,null,null,'Hidden result profile','Hidden platform','Hidden credential','published','[]','[]'),
 (1601,160,2,3,null,'Foreign secret','Foreign platform','Foreign credential','published','[]','[]'),
 (1701,170,1,null,null,'Legacy ballot identity','Legacy campaign draft','Legacy secret','draft','[]','[]');
insert into private.election_eligible_voters(election_id,student_id) values (10,1),(11,1),(12,1),(13,1),(14,1),(15,1),(16,2);
insert into public.vote_ballots values ('00000000-0000-4000-8000-000000000101',10,1);
insert into public.votes values (1,10,100,1001);
insert into public.candidate_media values (1,1001,'synthetic-media');
insert into public.eligibility_rules values (1,10,'{}'::jsonb);
insert into public.election_access_tokens values (1,10,'synthetic-hash');
insert into public.election_campaign_snapshots values ('00000000-0000-4000-8000-000000000201',10,'{}'::jsonb);
insert into public.archived_elections values (1,14,'{}'::jsonb);
insert into public.officers values (1,14,140,1401);
insert into public.officer_new_roster values (1,14,1);
insert into public.officer_leadership_releases values (1,14);
insert into public.election_officer_publications values ('00000000-0000-4000-8000-000000000202',14);
insert into public.election_officer_publication_entries values ('00000000-0000-4000-8000-000000000203','00000000-0000-4000-8000-000000000202',1);
insert into public.audit_logs values (1,'candidate_created','{}'::jsonb);
create table test_fixture_preservation_before as
with f(table_name,row_count,row_digest) as (
 select 'organizations',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) from public.organizations t union all
 select 'academic_terms',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) from public.academic_terms t union all
 select 'students',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) from public.students t union all
 select 'student_term_enrollments',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) from public.student_term_enrollments t union all
 select 'student_organization_terms',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) from public.student_organization_terms t union all
 select 'elections',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) from public.elections t union all
 select 'positions',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) from public.positions t union all
 select 'candidates',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) from public.candidates t union all
 select 'candidate_media',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) from public.candidate_media t union all
 select 'partylists',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) from public.partylists t union all
 select 'eligibility_rules',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) from public.eligibility_rules t union all
 select 'election_access_tokens',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) from public.election_access_tokens t union all
 select 'election_campaign_snapshots',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) from public.election_campaign_snapshots t union all
 select 'archived_elections',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) from public.archived_elections t union all
 select 'votes',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) from public.votes t union all
 select 'vote_ballots',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) from public.vote_ballots t union all
 select 'election_eligible_voters',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) from private.election_eligible_voters t union all
 select 'officers',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) from public.officers t union all
 select 'officer_new_roster',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) from public.officer_new_roster t union all
 select 'officer_leadership_releases',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) from public.officer_leadership_releases t union all
 select 'election_officer_publications',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) from public.election_officer_publications t union all
 select 'election_officer_publication_entries',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) from public.election_officer_publication_entries t union all
 select 'audit_logs',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) from public.audit_logs t
)
select jsonb_object_agg(table_name,jsonb_build_object('rows',row_count,'md5',row_digest) order by table_name) as snapshot from f;
create table test_fixture_before_counts as select
 (select count(*) from public.elections) elections,(select count(*) from public.positions) positions,
 (select count(*) from public.candidates) candidates,(select count(*) from public.vote_ballots) ballots,
 (select count(*) from public.votes) votes,(select count(*) from private.election_eligible_voters) frozen_electorate,
 (select count(*) from public.partylists) partylists;
