-- Synthetic records only. Loaded exclusively into a named LOCAL PostgreSQL test database.
create schema auth;
create schema private;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role',true),'')
$$;
grant usage on schema auth to authenticated,anon,service_role;
create table public.organizations(id integer primary key,name text,membership_scope text,organization_type text);
create table public.admin_users(id bigint primary key,auth_user_id uuid,role text,status text,organization_id integer,full_name text);
create table public.academic_terms(id integer primary key,status text,semester text,academic_year text,created_at timestamptz default now());
create table public.elections(
 id integer primary key,title text,organization_id integer,academic_term_id integer,
 status text,start_date timestamp,end_date timestamp,campaign_start timestamp,campaign_end timestamp,
 electorate_policy_version smallint default 1,electorate_frozen_at timestamptz,electorate_frozen_by bigint,
 removed_at timestamptz,results_released_at timestamptz);
create table public.students(id integer primary key,auth_user_id uuid,status text,program text,year_level integer,is_shs boolean,first_name text,last_name text,photo_url text);
create unique index on public.students(auth_user_id) where auth_user_id is not null;
create table public.student_term_enrollments(student_id integer,academic_term_id integer,enrollment_status text,program text,year_level integer,is_shs boolean,primary key(student_id,academic_term_id));
create table public.student_organization_terms(student_id integer,organization_id integer,academic_term_id integer,status text,source text,primary key(student_id,organization_id,academic_term_id));
create table public.eligibility_rules(id serial primary key,election_id integer references public.elections,program text,min_year_level integer,max_year_level integer,allow_shs boolean);
create table private.election_eligible_voters(election_id integer references public.elections,student_id integer references public.students,created_at timestamptz default clock_timestamp(),primary key(election_id,student_id));
create table public.positions(id integer primary key,election_id integer,status text,display_order integer);
create table public.partylists(id integer primary key,organization_id integer,election_id integer,name text,logo_url text);
create table public.candidates(id integer primary key,student_id integer,position_id integer,partylist_id integer,photo text);
create table public.vote_ballots(id serial primary key,election_id integer,student_id integer,receipt text);
create table public.votes(id serial primary key,election_id integer,student_id integer,ballot_id integer,receipt text);
create table public.audit_logs(
 id serial primary key,user_id bigint,actor_name text,actor_role text,action text,event_type text,event_category text,
 entity_type text,entity_id text,entity_label text,organization_id integer,organization_name text,election_id integer,
 status text,event_origin text,metadata jsonb);
insert into public.organizations values(2,'Synthetic Board','institution','departmental'),(9,'Other Board','institution','departmental');
insert into public.admin_users values
 (1,'10000000-0000-4000-8000-000000000001','electoral_board','active',2,'Synthetic Board'),
 (2,'10000000-0000-4000-8000-000000000002','electoral_board','active',9,'Other Board'),
 (3,'10000000-0000-4000-8000-000000000003','electoral_board','disabled',2,'Disabled Board');
insert into public.academic_terms(id,status,semester,academic_year) values(1,'active','1st Semester','2026-2027'),(2,'archived','2nd Semester','2025-2026');
insert into public.elections(id,title,organization_id,academic_term_id,status,start_date,end_date,electorate_policy_version,electorate_frozen_at,electorate_frozen_by) values
 (3,'Prac Elec',2,1,'active',timezone('Asia/Manila',now())+interval '2 hours',timezone('Asia/Manila',now())+interval '28 hours',1,null,null),
 (4,'Untouched election',2,1,'active',timezone('Asia/Manila',now())-interval '1 hour',timezone('Asia/Manila',now())+interval '1 hour',1,now(),1);
insert into public.students
select n,case when n in (5,6,16) then null else ('10000000-0000-4000-8000-'||lpad((100+n)::text,12,'0'))::uuid end,
 case when n in (5,14,16) then 'pending' when n=7 then 'disabled' else 'active' end,
 case when n=3 then 'BSCS' else 'BSIT' end,
 case when n=1 then 1 when n=2 then 4 when n=4 then 5 else 2 end,
 n=12,'Synthetic','Candidate '||n,'photo-'||n from generate_series(1,16) n;
insert into public.student_term_enrollments
select id,case when id=11 then 2 else 1 end,case when id=8 then 'not_enrolled' else 'enrolled' end,program,
 case when id=13 then null else year_level end,is_shs from public.students;
insert into public.student_organization_terms
select id,case when id=9 then 9 else 2 end,case when id=11 then 2 else 1 end,
 case when id=10 then 'removed' else 'active' end,'system' from public.students where id<>15;
insert into public.eligibility_rules(election_id,program,min_year_level,max_year_level,allow_shs) values(3,'BSIT',2,4,false),(4,'BSIT',2,4,false);
insert into private.election_eligible_voters(election_id,student_id) select 4,id from public.students;
insert into public.vote_ballots(election_id,student_id,receipt) values(4,2,'existing-synthetic-receipt');
insert into public.votes(election_id,student_id,ballot_id,receipt) values(4,2,1,'existing-synthetic-vote');
insert into public.positions values(1,3,'active',1),(2,4,'active',1);
insert into public.partylists values(1,2,3,'Synthetic Party','party-logo');
insert into public.candidates values(1,1,1,1,'candidate-photo-1'),(2,2,1,null,null),(3,1,2,null,null);
