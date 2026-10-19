create schema auth;
create schema private;
create function auth.uid() returns uuid language sql stable as $f$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$f$;
grant usage on schema auth to anon, authenticated, service_role;
create table public.admin_users(id bigint primary key, auth_user_id uuid, role text, status text, organization_id bigint);
create table public.elections(id integer primary key, organization_id bigint, title text);
create table private.election_eligible_voters(election_id integer references public.elections(id) on delete restrict, student_id bigint, primary key(election_id, student_id));
alter table private.election_eligible_voters enable row level security;
alter table public.admin_users enable row level security;
alter table public.elections enable row level security;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;
revoke all on private.election_eligible_voters from public, anon, authenticated, service_role;
insert into public.admin_users values
 (1,'00000000-0000-4000-8000-000000000001','electoral_board','active',10),
 (2,'00000000-0000-4000-8000-000000000002','electoral_board','active',20),
 (4,'00000000-0000-4000-8000-000000000004','electoral_board','active',null),
 (5,'00000000-0000-4000-8000-000000000005','electoral_board','inactive',10),
 (6,'00000000-0000-4000-8000-000000000006','super_admin','active',10),
 (7,'00000000-0000-4000-8000-000000000007','electoral_board','active',10),
 (8,'00000000-0000-4000-8000-000000000007','electoral_board','active',null);
insert into public.elections values (1,10,'Synthetic protected election'),(2,10,'Synthetic ballot history'),(3,20,'Synthetic foreign election'),(4,10,'Synthetic empty election');
insert into private.election_eligible_voters values (1,101),(2,101),(3,201),(3,202);
create table public.votes(id integer primary key, election_id integer, evidence text);
create table public.vote_ballots(id integer primary key, election_id integer, evidence text);
create table public.audit_logs(id integer primary key, election_id integer, evidence text);
create table public.student_term_enrollments(id integer primary key, evidence text);
create table public.student_organization_terms(id integer primary key, evidence text);
create table public.masterlist_imports(id integer primary key, evidence text);
insert into public.votes values (1,2,'synthetic-vote-hash');
insert into public.vote_ballots values (1,2,'synthetic-ballot-receipt-anchor');
insert into public.audit_logs values (1,1,'synthetic-history'),(2,2,'synthetic-history');
insert into public.student_term_enrollments values (1,'synthetic-historical-enrollment');
insert into public.student_organization_terms values (1,'synthetic-historical-membership');
insert into public.masterlist_imports values (1,'synthetic-historical-import');
