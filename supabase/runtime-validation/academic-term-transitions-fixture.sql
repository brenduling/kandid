-- Supplemental SYNTHETIC schema. The runner first loads the existing Board
-- fixture's core tables, then captured ballot schemas and actual RPC bodies.
create schema private;
create schema extensions;
create extension pgcrypto with schema extensions;
create sequence public.academic_terms_id_seq start with 100;
alter table public.academic_terms alter column id set default nextval('public.academic_terms_id_seq');
create table public.system_settings (
  id serial primary key,system_name varchar(150) default 'KANDID Voting System',
  allow_multiple_votes boolean default false,allow_abstain boolean default true,
  default_election_duration integer default 2,maintenance_mode boolean default false,
  created_at timestamp default current_timestamp
);
alter table public.system_settings enable row level security;
grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email_confirmed_at timestamptz,deleted_at timestamptz,
  is_anonymous boolean default false,banned_until timestamptz);
alter table public.admin_users add column auth_user_id uuid;
alter table public.students add column auth_user_id uuid,add column password text default 'synthetic-unchanged';
alter table public.academic_terms add column created_at timestamptz not null default now(),
  add constraint academic_terms_unique_term unique(academic_year,semester);
create table public.elections(id integer primary key,organization_id integer,academic_term_id integer,title text,
  status text,campaign_start timestamp,campaign_end timestamp,start_date timestamp,end_date timestamp,
  removed_at timestamptz,results_released_at timestamptz,electorate_policy_version integer default 1,
  electorate_frozen_at timestamptz,electorate_frozen_by integer);
create table public.positions(id integer primary key,election_id integer,name text,status text default 'active',
  max_votes integer default 1,display_order integer default 1);
create table public.partylists(id integer primary key,organization_id integer,election_id integer,name text,logo_url text);
create table public.candidates(id integer primary key,position_id integer,student_id integer,partylist_id integer,
  photo text,bio text,created_at timestamptz default now(),platform text,credentials text,campaign_status text default 'draft',
  campaign_media_urls jsonb,campaign_materials jsonb);
create table private.election_eligible_voters(election_id integer,student_id integer,primary key(election_id,student_id));
create table public.eligibility_rules(id serial primary key,election_id integer,program text,min_year_level integer,max_year_level integer,allow_shs boolean);
create table public.masterlist_imports(id integer primary key,academic_term_id integer,import_scope text default 'incremental',
  import_status text default 'review',full_roster_confirmed_by bigint,full_roster_confirmed_at timestamptz,
  full_roster_confirmation_fingerprint text,total_rows integer,invalid_rows integer,conflict_rows integer,finalized_at timestamptz);
create table public.masterlist_import_rows(id integer primary key,import_id integer,row_number integer,
  student_number text,first_name text,last_name text,email text,program text,year_level integer,is_shs boolean default false,
  matched_student_id integer,reconciliation_status text,review_status text default 'none',reviewed_by integer,
  reviewed_at timestamptz,review_decision text,review_note text,review_fingerprint text,issue_message text);
create table public.officers(id integer primary key,student_id integer,academic_term_id integer,payload text);
create table public.receipt_sentinels(id integer primary key,student_id integer,payload text);
create sequence public.votes_id_seq;
alter table public.audit_logs add column created_at timestamptz;

insert into public.academic_terms(id,academic_year,semester,status,activated_at,closed_at) values
 (1,'2026-2027','1st Semester','active',now()-interval '3 months',null),
 (2,'2026-2027','2nd Semester','draft',null,null),
 (3,'2025-2026','2nd Semester','closed',now()-interval '9 months',now()-interval '3 months'),
 (4,'2027-2028','1st Semester','draft',null,null);
insert into public.programs(id,code,name) values(10,'BSIT','Information Technology'),(20,'BSHM','Hospitality Management');
insert into public.organizations(id,name,organization_type,membership_scope) values
 (100,'WITSG','departmental','institution'),(101,'PSITS','departmental','program'),
 (103,'JEHMS','departmental','program'),(104,'LAS','departmental','program'),(105,'Synthetic Club','non_departmental','manual');
insert into public.organization_programs values(101,10),(103,20),(104,20);
insert into public.admin_users(id,full_name,role,status,organization_id,auth_user_id) values
 (1,'Synthetic Super Admin','super_admin','active',null,'00000000-0000-4000-8000-000000000501'),
 (2,'Other Super Admin','super_admin','active',null,'00000000-0000-4000-8000-000000000502'),
 (3,'WITSG Board','electoral_board','active',100,'00000000-0000-4000-8000-000000000503'),
 (4,'PSITS Board','electoral_board','active',101,'00000000-0000-4000-8000-000000000504'),
 (5,'Disabled Super Admin','super_admin','disabled',null,'00000000-0000-4000-8000-000000000505');
insert into public.students(id,student_number,first_name,last_name,email,program,year_level,status,auth_user_id)
 select n,'90'||lpad(n::text,3,'0'),'Student','Synthetic', 'synthetic-'||n||'@example.invalid','BSIT',2,
   case when n=7 then 'pending' when n=8 then 'disabled' else 'active' end,
   ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,8) n;
insert into auth.users(id,email_confirmed_at) select auth_user_id,now() from public.students;
insert into public.student_term_enrollments(student_id,academic_term_id,program,year_level,is_shs,enrollment_status,source)
 select n,t,'BSIT',2,false,'enrolled','masterlist' from generate_series(1,8) n cross join (values(1),(3)) terms(t);
-- Student 1 has verified evidence of a shift in the next semester. Students
-- without a target row must retain login while becoming ineligible for voting.
insert into public.student_term_enrollments(student_id,academic_term_id,program,year_level,is_shs,enrollment_status,source)
 values(1,2,'BSHM',2,false,'enrolled','masterlist'),(2,2,'BSIT',2,false,'enrolled','masterlist');
insert into public.student_organization_terms(student_id,organization_id,academic_term_id,status,source)
 select n,o,t,'active','system' from generate_series(1,8) n cross join (values(100),(101)) org(o) cross join (values(1),(3)) terms(t);
insert into public.student_organization_terms(student_id,organization_id,academic_term_id,status,source) values(1,105,1,'active','manual');
insert into public.student_organizations(student_id,organization_id) select n,o from generate_series(1,8) n cross join (values(100),(101)) org(o);
insert into public.elections(id,organization_id,academic_term_id,title,status,start_date,end_date) values
 (10,100,3,'Historical election','archived',timezone('Asia/Manila',now())-interval '8 months',timezone('Asia/Manila',now())-interval '7 months'),
 (11,100,3,'Historical editable draft','draft',null,timezone('Asia/Manila',now())-interval '6 months'),
 (20,100,2,'Next term scheduled election','active',timezone('Asia/Manila',now())+interval '2 days',timezone('Asia/Manila',now())+interval '3 days');
insert into public.positions(id,election_id,name) values(100,10,'Historical Chair'),(110,11,'Historical Draft Chair'),(200,20,'Next Term Chair');
-- Seed records before installing candidate guards, as historic evidence.
insert into public.candidates(id,student_id,position_id) values(1000,1,100),(1001,1,110),(2000,2,200);
insert into public.officers values(1,1,3,'historical-officer');
insert into public.receipt_sentinels values(1,1,'historical-receipt');
insert into private.election_eligible_voters values(10,1);
revoke all on public.students,public.student_term_enrollments,public.student_organization_terms from public,anon,authenticated;
grant select,insert,update on public.candidates to authenticated;
