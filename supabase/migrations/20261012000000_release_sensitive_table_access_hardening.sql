begin;

-- Release hardening for the application tables whose browser-facing access
-- was found broader than the current trusted-operation contracts.
-- This migration does not change application rows.
do $preflight$
begin
  if to_regclass('public.students') is null
     or to_regclass('public.admin_users') is null
     or to_regclass('public.elections') is null
     or to_regclass('public.election_access_tokens') is null
     or to_regclass('public.votes') is null
     or to_regclass('public.vote_ballots') is null then
    raise exception 'Required KANDID security tables are missing; inspect the deployed baseline before applying.';
  end if;

  if not exists (select 1 from pg_attribute where attrelid = 'public.students'::regclass and attname = 'auth_user_id' and attnum > 0 and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = 'public.admin_users'::regclass and attname = 'auth_user_id' and attnum > 0 and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = 'public.elections'::regclass and attname = 'organization_id' and attnum > 0 and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = 'public.elections'::regclass and attname = 'academic_term_id' and attnum > 0 and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = 'public.election_access_tokens'::regclass and attname = 'token' and attnum > 0 and not attisdropped) then
    raise exception 'KANDID security table columns differ from the reviewed contract; inspect before applying.';
  end if;

  if to_regprocedure('public.insert_v2_vote_rows(integer,integer,jsonb)') is null
     or to_regprocedure('public.claim_next_vote_anchor()') is null
     or to_regprocedure('public.claim_next_ballot_anchor()') is null then
    raise exception 'Trusted vote submission and anchoring RPCs are missing; refuse partial hardening.';
  end if;
end
$preflight$;

-- Column ACLs survive a table-level revoke. Clear them as well so grants on
-- stale or unknown columns cannot bypass the reviewed column allow-lists.
do $revoke_column_acls$
declare
  target_table text;
  column_row record;
begin
  foreach target_table in array array['students', 'admin_users', 'elections', 'election_access_tokens', 'votes', 'vote_ballots'] loop
    for column_row in
      select a.attname
      from pg_attribute a
      where a.attrelid = format('public.%I', target_table)::regclass
        and a.attnum > 0 and not a.attisdropped
    loop
      execute format(
        'revoke all privileges (%I) on table public.%I from public, anon, authenticated',
        column_row.attname, target_table
      );
    end loop;
  end loop;
end
$revoke_column_acls$;

-- Student records retain the already-reviewed safe-column directory contract.
do $drop_student_policies$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'students' loop
    execute format('drop policy %I on public.students', p.policyname);
  end loop;
end
$drop_student_policies$;
revoke all privileges on table public.students from public, anon, authenticated;
revoke all (id, student_number, first_name, last_name, email, password,
  program, year_level, is_shs, status, created_at, photo_url, precinct_code,
  batch_code, auth_user_id) on table public.students from public, anon, authenticated;
grant select (id, first_name, last_name, program, year_level, is_shs,
  status, created_at, photo_url) on table public.students to authenticated;
do $student_sequence$
declare seq_name text := pg_get_serial_sequence('public.students', 'id');
begin
  if seq_name is not null then
    execute format('revoke all privileges on sequence %s from public, anon, authenticated', seq_name);
  end if;
end
$student_sequence$;
alter table public.students enable row level security;
create policy students_release_safe_select
on public.students for select to authenticated
using (
  (auth.uid() is not null and exists (
    select 1 from public.admin_users a
    where a.auth_user_id = auth.uid() and a.status = 'active' and a.role = 'super_admin'
  ))
  or (auth.uid() is not null and students.auth_user_id = auth.uid() and students.status = 'active')
  or (auth.uid() is not null and exists (
    select 1 from public.candidates c where c.student_id = students.id
  ))
);

-- Admin profiles are visible only to their linked Auth identity. Administrative
-- listing and mutation continue through admin-user-management (service role).
do $drop_admin_policies$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'admin_users' loop
    execute format('drop policy %I on public.admin_users', p.policyname);
  end loop;
end
$drop_admin_policies$;
revoke all privileges on table public.admin_users from public, anon, authenticated;
revoke all (id, auth_user_id, email, password, full_name, role, status,
  organization_id, photo_url, created_at) on table public.admin_users from public, anon, authenticated;
grant select (id, auth_user_id, email, full_name, role, status,
  organization_id, photo_url, created_at) on table public.admin_users to authenticated;
do $admin_sequence$
declare seq_name text := pg_get_serial_sequence('public.admin_users', 'id');
begin
  if seq_name is not null then
    execute format('revoke all privileges on sequence %s from public, anon, authenticated', seq_name);
  end if;
end
$admin_sequence$;
alter table public.admin_users enable row level security;
create policy admin_users_own_auth_profile
on public.admin_users for select to authenticated
using (auth.uid() is not null and admin_users.auth_user_id = auth.uid());

-- Election listing/schedule columns remain public-readable. Private geofence
-- coordinates require an authenticated session. Every write requires an active
-- linked Super Admin or assigned Board; both update scopes are checked.
do $drop_election_policies$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'elections' loop
    execute format('drop policy %I on public.elections', p.policyname);
  end loop;
end
$drop_election_policies$;
revoke all privileges on table public.elections from public, anon, authenticated;
grant select on table public.elections to authenticated;
grant select (id, organization_id, academic_term_id, title, cover_url,
  campaign_start, campaign_end, start_date, end_date, status,
  student_result_visibility, results_released_at, voting_access_mode,
  location_label, created_at)
  on table public.elections to anon;
grant insert, update, delete on table public.elections to authenticated;
alter table public.elections enable row level security;
create policy elections_public_read
on public.elections for select to anon, authenticated using (true);
create policy elections_insert_active_admin_scope
on public.elections for insert to authenticated
with check (exists (
  select 1 from public.admin_users a
  where a.auth_user_id = auth.uid() and a.status = 'active'
    and (a.role = 'super_admin' or (a.role = 'electoral_board' and a.organization_id = elections.organization_id))
));
create policy elections_update_active_admin_scope
on public.elections for update to authenticated
using (exists (
  select 1 from public.admin_users a
  where a.auth_user_id = auth.uid() and a.status = 'active'
    and (a.role = 'super_admin' or (a.role = 'electoral_board' and a.organization_id = elections.organization_id))
))
with check (exists (
  select 1 from public.admin_users a
  where a.auth_user_id = auth.uid() and a.status = 'active'
    and (a.role = 'super_admin' or (a.role = 'electoral_board' and a.organization_id = elections.organization_id))
));
create policy elections_delete_active_admin_scope
on public.elections for delete to authenticated
using (exists (
  select 1 from public.admin_users a
  where a.auth_user_id = auth.uid() and a.status = 'active'
    and (a.role = 'super_admin' or (a.role = 'electoral_board' and a.organization_id = elections.organization_id))
));
do $election_sequence$
declare seq_name text := pg_get_serial_sequence('public.elections', 'id');
begin
  if seq_name is not null then
    execute format('revoke all privileges on sequence %s from public, anon, authenticated', seq_name);
    execute format('grant usage on sequence %s to authenticated', seq_name);
  end if;
end
$election_sequence$;

-- Raw QR/access tokens are not public Student data. Authorized Super Admins and
-- the assigned Board may manage them; Students validate submitted codes through
-- the authenticated vote-access Edge Function and receive only a decision.
do $drop_token_policies$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'election_access_tokens' loop
    execute format('drop policy %I on public.election_access_tokens', p.policyname);
  end loop;
end
$drop_token_policies$;
revoke all privileges on table public.election_access_tokens from public, anon, authenticated;
grant select on table public.election_access_tokens to authenticated;
grant insert (election_id, token, scope_type, scope_value, is_active, expires_at)
  on table public.election_access_tokens to authenticated;
grant update (is_active) on table public.election_access_tokens to authenticated;
alter table public.election_access_tokens enable row level security;
create policy election_access_tokens_read_admin_scope
on public.election_access_tokens for select to authenticated
using (exists (
  select 1 from public.elections e
  join public.admin_users a on a.auth_user_id = auth.uid() and a.status = 'active'
  where e.id = election_access_tokens.election_id
    and (a.role = 'super_admin' or (a.role = 'electoral_board' and a.organization_id = e.organization_id))
));
create policy election_access_tokens_insert_admin_scope
on public.election_access_tokens for insert to authenticated
with check (exists (
  select 1 from public.elections e
  join public.admin_users a on a.auth_user_id = auth.uid() and a.status = 'active'
  where e.id = election_access_tokens.election_id
    and (a.role = 'super_admin' or (a.role = 'electoral_board' and a.organization_id = e.organization_id))
));
create policy election_access_tokens_update_admin_scope
on public.election_access_tokens for update to authenticated
using (exists (
  select 1 from public.elections e
  join public.admin_users a on a.auth_user_id = auth.uid() and a.status = 'active'
  where e.id = election_access_tokens.election_id
    and (a.role = 'super_admin' or (a.role = 'electoral_board' and a.organization_id = e.organization_id))
))
with check (exists (
  select 1 from public.elections e
  join public.admin_users a on a.auth_user_id = auth.uid() and a.status = 'active'
  where e.id = election_access_tokens.election_id
    and (a.role = 'super_admin' or (a.role = 'electoral_board' and a.organization_id = e.organization_id))
));
do $token_sequence$
declare seq_name text := pg_get_serial_sequence('public.election_access_tokens', 'id');
begin
  if seq_name is not null then
    execute format('revoke all privileges on sequence %s from public, anon, authenticated', seq_name);
    execute format('grant usage on sequence %s to authenticated', seq_name);
  end if;
end
$token_sequence$;

-- Reassert the existing vote/ballot deny-by-default contract, removing every
-- prior policy rather than assuming production policy names match local names.
do $drop_vote_policies$
declare p record;
begin
  for p in select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename in ('votes', 'vote_ballots') loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end
$drop_vote_policies$;
alter table public.votes enable row level security;
alter table public.vote_ballots enable row level security;
revoke all privileges on table public.votes, public.vote_ballots from public, anon, authenticated;
revoke all privileges on sequence public.votes_id_seq from public, anon, authenticated;
revoke all privileges on table public.votes, public.vote_ballots from service_role;
grant select on table public.votes, public.vote_ballots to service_role;
revoke all privileges on sequence public.votes_id_seq from service_role;
do $vote_rpc_acl$
declare
  signature text;
  procedure_oid regprocedure;
begin
  foreach signature in array array[
    'public.insert_v2_vote_rows(integer,integer,jsonb)',
    'public.claim_next_vote_anchor()',
    'public.claim_next_ballot_anchor()',
    'public.mark_vote_anchor_success(integer,text,text,text,text,bigint)',
    'public.mark_vote_anchor_failure(integer,text,text)',
    'public.mark_vote_anchor_manual_review(integer,text,text)',
    'public.acquire_ballot_anchor_signer_lease(text,integer)',
    'public.release_ballot_anchor_signer_lease(text)',
    'public.claim_next_submitted_ballot_anchor()',
    'public.mark_ballot_anchor_submitted(uuid,text,text,text,text)',
    'public.mark_ballot_anchor_success(uuid,text,text,bigint,timestamptz)',
    'public.mark_ballot_anchor_failure(uuid,text,text,boolean)',
    'public.mark_ballot_manual_review(uuid,text,text)'
  ] loop
    procedure_oid := to_regprocedure(signature);
    if procedure_oid is null then
      raise exception 'Required trusted vote or anchoring RPC % is missing.', signature;
    end if;
    execute format('revoke all on function %s from public, anon, authenticated', procedure_oid);
    execute format('grant execute on function %s to service_role', procedure_oid);
  end loop;
end
$vote_rpc_acl$;

do $postflight$
begin
  if has_table_privilege('anon', 'public.students', 'SELECT')
     or has_table_privilege('anon', 'public.students', 'INSERT')
     or has_table_privilege('authenticated', 'public.students', 'INSERT')
     or has_table_privilege('authenticated', 'public.students', 'UPDATE')
     or has_table_privilege('authenticated', 'public.students', 'DELETE')
     or has_column_privilege('authenticated', 'public.students', 'student_number', 'SELECT')
     or has_column_privilege('authenticated', 'public.students', 'email', 'SELECT')
     or has_column_privilege('authenticated', 'public.students', 'auth_user_id', 'SELECT')
     or has_column_privilege('authenticated', 'public.students', 'password', 'SELECT') then
    raise exception 'Student browser privilege contract failed.';
  end if;
  if has_table_privilege('anon', 'public.admin_users', 'SELECT')
     or has_table_privilege('anon', 'public.admin_users', 'INSERT')
     or has_table_privilege('anon', 'public.admin_users', 'UPDATE')
     or has_table_privilege('anon', 'public.admin_users', 'DELETE')
     or has_table_privilege('anon', 'public.admin_users', 'TRUNCATE')
     or has_table_privilege('anon', 'public.admin_users', 'TRIGGER')
     or has_table_privilege('anon', 'public.admin_users', 'REFERENCES')
     or has_table_privilege('authenticated', 'public.admin_users', 'INSERT')
     or has_table_privilege('authenticated', 'public.admin_users', 'UPDATE')
     or has_table_privilege('authenticated', 'public.admin_users', 'DELETE')
     or has_table_privilege('authenticated', 'public.admin_users', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.admin_users', 'TRIGGER')
     or has_table_privilege('authenticated', 'public.admin_users', 'REFERENCES')
     or has_column_privilege('authenticated', 'public.admin_users', 'password', 'SELECT') then
    raise exception 'Admin profile browser privilege contract failed.';
  end if;
  if has_table_privilege('anon', 'public.elections', 'SELECT')
     or not has_column_privilege('anon', 'public.elections', 'id', 'SELECT')
     or not has_column_privilege('anon', 'public.elections', 'title', 'SELECT')
     or has_column_privilege('anon', 'public.elections', 'geo_lat', 'SELECT')
     or has_column_privilege('anon', 'public.elections', 'geo_lng', 'SELECT')
     or has_column_privilege('anon', 'public.elections', 'geo_radius_meters', 'SELECT')
     or has_table_privilege('anon', 'public.elections', 'INSERT')
     or has_table_privilege('anon', 'public.elections', 'UPDATE')
     or has_table_privilege('anon', 'public.elections', 'DELETE')
     or not has_table_privilege('authenticated', 'public.elections', 'INSERT')
     or not has_table_privilege('authenticated', 'public.elections', 'UPDATE') then
    raise exception 'Election public-read/authorized-write grants are incorrect.';
  end if;
  if has_table_privilege('anon', 'public.election_access_tokens', 'SELECT')
     or has_table_privilege('anon', 'public.election_access_tokens', 'INSERT')
     or has_table_privilege('anon', 'public.election_access_tokens', 'UPDATE')
     or has_table_privilege('anon', 'public.election_access_tokens', 'DELETE')
     or has_table_privilege('anon', 'public.election_access_tokens', 'TRUNCATE')
     or has_table_privilege('anon', 'public.election_access_tokens', 'TRIGGER')
     or has_table_privilege('anon', 'public.election_access_tokens', 'REFERENCES')
     or has_table_privilege('authenticated', 'public.election_access_tokens', 'TRIGGER')
     or has_table_privilege('authenticated', 'public.election_access_tokens', 'REFERENCES')
     or has_table_privilege('authenticated', 'public.election_access_tokens', 'DELETE')
     or has_table_privilege('authenticated', 'public.election_access_tokens', 'TRUNCATE') then
    raise exception 'Election access-token browser privilege contract failed.';
  end if;
  if has_table_privilege('anon', 'public.votes', 'SELECT')
     or has_table_privilege('anon', 'public.votes', 'INSERT')
     or has_table_privilege('anon', 'public.votes', 'UPDATE')
     or has_table_privilege('anon', 'public.votes', 'DELETE')
     or has_table_privilege('anon', 'public.votes', 'TRUNCATE')
     or has_table_privilege('anon', 'public.votes', 'TRIGGER')
     or has_table_privilege('anon', 'public.votes', 'REFERENCES')
     or has_table_privilege('authenticated', 'public.votes', 'SELECT')
     or has_table_privilege('authenticated', 'public.votes', 'INSERT')
     or has_table_privilege('authenticated', 'public.votes', 'UPDATE')
     or has_table_privilege('authenticated', 'public.votes', 'DELETE')
     or has_table_privilege('authenticated', 'public.votes', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.votes', 'TRIGGER')
     or has_table_privilege('authenticated', 'public.votes', 'REFERENCES')
     or has_table_privilege('anon', 'public.vote_ballots', 'SELECT')
     or has_table_privilege('anon', 'public.vote_ballots', 'INSERT')
     or has_table_privilege('anon', 'public.vote_ballots', 'UPDATE')
     or has_table_privilege('anon', 'public.vote_ballots', 'DELETE')
     or has_table_privilege('anon', 'public.vote_ballots', 'TRUNCATE')
     or has_table_privilege('anon', 'public.vote_ballots', 'TRIGGER')
     or has_table_privilege('anon', 'public.vote_ballots', 'REFERENCES')
     or has_table_privilege('authenticated', 'public.vote_ballots', 'SELECT')
     or has_table_privilege('authenticated', 'public.vote_ballots', 'INSERT')
     or has_table_privilege('authenticated', 'public.vote_ballots', 'UPDATE')
     or has_table_privilege('authenticated', 'public.vote_ballots', 'DELETE')
     or has_table_privilege('authenticated', 'public.vote_ballots', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.vote_ballots', 'TRIGGER')
     or has_table_privilege('authenticated', 'public.vote_ballots', 'REFERENCES') then
    raise exception 'Direct browser vote/ballot access remains.';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('votes', 'vote_ballots')) then
    raise exception 'A direct vote/ballot policy remains.';
  end if;
  if not has_table_privilege('service_role', 'public.votes', 'SELECT')
     or not has_table_privilege('service_role', 'public.vote_ballots', 'SELECT') then
    raise exception 'Trusted vote-report and anchoring reads were removed.';
  end if;
  if exists (
    select 1
    from (values
      ('public.insert_v2_vote_rows(integer,integer,jsonb)'),
      ('public.claim_next_vote_anchor()'),
      ('public.claim_next_ballot_anchor()'),
      ('public.mark_vote_anchor_success(integer,text,text,text,text,bigint)'),
      ('public.mark_vote_anchor_failure(integer,text,text)'),
      ('public.mark_vote_anchor_manual_review(integer,text,text)'),
      ('public.acquire_ballot_anchor_signer_lease(text,integer)'),
      ('public.release_ballot_anchor_signer_lease(text)'),
      ('public.claim_next_submitted_ballot_anchor()'),
      ('public.mark_ballot_anchor_submitted(uuid,text,text,text,text)'),
      ('public.mark_ballot_anchor_success(uuid,text,text,bigint,timestamptz)'),
      ('public.mark_ballot_anchor_failure(uuid,text,text,boolean)'),
      ('public.mark_ballot_manual_review(uuid,text,text)')
    ) required(signature)
    cross join lateral (select to_regprocedure(required.signature) as procedure_oid) resolved
    where resolved.procedure_oid is null
       or has_function_privilege('anon', resolved.procedure_oid, 'EXECUTE')
       or has_function_privilege('authenticated', resolved.procedure_oid, 'EXECUTE')
       or not has_function_privilege('service_role', resolved.procedure_oid, 'EXECUTE')
  ) then
    raise exception 'Trusted vote and anchoring RPC execution contract failed.';
  end if;
  if not (
    select c.relrowsecurity
    from pg_class c where c.oid = 'public.students'::regclass
  ) or not (
    select c.relrowsecurity
    from pg_class c where c.oid = 'public.admin_users'::regclass
  ) or not (
    select c.relrowsecurity
    from pg_class c where c.oid = 'public.elections'::regclass
  ) or not (
    select c.relrowsecurity
    from pg_class c where c.oid = 'public.election_access_tokens'::regclass
  ) or not (
    select c.relrowsecurity
    from pg_class c where c.oid = 'public.votes'::regclass
  ) or not (
    select c.relrowsecurity
    from pg_class c where c.oid = 'public.vote_ballots'::regclass
  ) then
    raise exception 'RLS is disabled on one or more protected application tables.';
  end if;
  if has_table_privilege('anon', 'public.admin_users', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.admin_users', 'TRUNCATE')
     or has_table_privilege('anon', 'public.elections', 'TRUNCATE')
     or has_table_privilege('anon', 'public.election_access_tokens', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.election_access_tokens', 'TRUNCATE') then
    raise exception 'Unnecessary truncate access remains on a protected table.';
  end if;
  if exists (
    select 1
    from pg_attribute a
    where a.attrelid in (
      'public.students'::regclass,
      'public.admin_users'::regclass,
      'public.election_access_tokens'::regclass,
      'public.votes'::regclass,
      'public.vote_ballots'::regclass
    )
      and a.attnum > 0 and not a.attisdropped
      and pg_catalog.has_column_privilege('anon', a.attrelid, a.attname, 'SELECT')
  ) then
    raise exception 'Anonymous column-level reads remain on a protected table.';
  end if;
  if exists (
    select 1 from pg_attribute a
    where a.attrelid = 'public.students'::regclass and a.attnum > 0 and not a.attisdropped
      and pg_catalog.has_column_privilege('authenticated', a.attrelid, a.attname, 'SELECT')
      and a.attname not in ('id', 'first_name', 'last_name', 'program', 'year_level', 'is_shs', 'status', 'created_at', 'photo_url')
  ) or exists (
    select 1 from pg_attribute a
    where a.attrelid = 'public.admin_users'::regclass and a.attnum > 0 and not a.attisdropped
      and pg_catalog.has_column_privilege('authenticated', a.attrelid, a.attname, 'SELECT')
      and a.attname not in ('id', 'auth_user_id', 'email', 'full_name', 'role', 'status', 'organization_id', 'photo_url', 'created_at')
  ) or exists (
    select 1 from pg_attribute a
    where a.attrelid = 'public.elections'::regclass and a.attnum > 0 and not a.attisdropped
      and pg_catalog.has_column_privilege('anon', a.attrelid, a.attname, 'SELECT')
      and a.attname not in ('id', 'organization_id', 'academic_term_id', 'title', 'cover_url', 'campaign_start', 'campaign_end', 'start_date', 'end_date', 'status', 'student_result_visibility', 'results_released_at', 'voting_access_mode', 'location_label', 'created_at')
  ) then
    raise exception 'A safe-column allow-list contains an unexpected column.';
  end if;
  if exists (
    select 1 from pg_attribute a
    where a.attrelid in ('public.votes'::regclass, 'public.vote_ballots'::regclass)
      and a.attnum > 0 and not a.attisdropped
      and (pg_catalog.has_column_privilege('authenticated', a.attrelid, a.attname, 'SELECT')
        or pg_catalog.has_column_privilege('authenticated', a.attrelid, a.attname, 'INSERT')
        or pg_catalog.has_column_privilege('authenticated', a.attrelid, a.attname, 'UPDATE')
        or pg_catalog.has_column_privilege('authenticated', a.attrelid, a.attname, 'REFERENCES'))
  ) then
    raise exception 'Authenticated column-level vote or ballot access remains.';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'elections' and policyname = 'elections_public_read' and cmd = 'SELECT')
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'elections' and policyname = 'elections_update_active_admin_scope' and cmd = 'UPDATE')
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'election_access_tokens' and policyname = 'election_access_tokens_read_admin_scope' and cmd = 'SELECT') then
    raise exception 'Required election authorization policies are missing.';
  end if;
end
$postflight$;

notify pgrst, 'reload schema';
commit;
