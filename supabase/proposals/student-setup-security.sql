-- LOCAL REVIEW PROPOSAL ONLY. Never apply without explicit production approval.
-- Existing students/Auth/enrollment tables remain the sources of identity/eligibility.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $$begin
  if to_regclass('private.student_setup_proofs') is not null
     or to_regprocedure('public.kandid_student_setup_admission_v1(text,uuid,text)') is not null then
    raise exception 'Setup security objects already exist; stop and review drift.';
  end if;
end$$;
create schema if not exists private;
-- Ephemeral OTP authorization journal, not another student/enrollment registry.
-- Tokens/passwords/email addresses are never stored here. Claimed, unresolved
-- attempts deliberately do not expire into an automatic password-write retry.
create table private.student_setup_proofs (
  proof_hash text primary key check (proof_hash ~ '^[0-9a-f]{64}$'),
  student_id bigint not null,
  auth_user_id uuid not null,
  email_hash text not null,
  expected_status text not null check (expected_status in ('pending','active')),
  expected_auth_user_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  completed_at timestamptz,
  recovered_at timestamptz,
  check (expires_at > created_at),
  check (completed_at is null or claimed_at is not null)
);
create unique index student_setup_one_unresolved_claim
  on private.student_setup_proofs(student_id)
  where claimed_at is not null and completed_at is null and recovered_at is null;
alter table private.student_setup_proofs enable row level security;
revoke all on private.student_setup_proofs from public, anon, authenticated, service_role;

create function private.kandid_setup_record_v1(p_number text, p_uid uuid, p_email text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare s public.students%rowtype; normalized text; auth_ids uuid[]; resolved_uid uuid;
begin
  if p_number is null or p_number !~ '^[0-9]{1,20}$' then return null; end if;
  select * into s from public.students where student_number = p_number;
  if not found then return null; end if;
  normalized := lower(btrim(s.email));
  if normalized is null or normalized !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
     or s.status is null or s.status not in ('pending','active')
     or (s.status = 'pending' and s.auth_user_id is not null)
     or (p_email is not null and lower(btrim(p_email)) is distinct from normalized) then return null; end if;
  -- EXISTS is evaluated in Postgres over the entire relation: no API row cap.
  if exists(select 1 from public.students x where x.id <> s.id
      and x.status in ('pending','active') and lower(btrim(x.email)) = normalized)
     or exists(select 1 from public.admin_users a where lower(btrim(a.email)) = normalized) then return null; end if;
  select array_agg(u.id) into auth_ids from auth.users u where lower(btrim(u.email)) = normalized;
  if coalesce(cardinality(auth_ids),0) > 1 then return null; end if;
  resolved_uid := coalesce(p_uid,s.auth_user_id,auth_ids[1]);
  if p_uid is not null and not exists(select 1 from auth.users u where u.id = p_uid
      and lower(btrim(u.email)) = normalized and u.email_confirmed_at is not null) then return null; end if;
  if s.auth_user_id is not null and s.auth_user_id is distinct from resolved_uid then return null; end if;
  if resolved_uid is not null and (
      exists(select 1 from public.admin_users a where a.auth_user_id = resolved_uid)
      or exists(select 1 from public.students x where x.auth_user_id = resolved_uid and x.id <> s.id)) then return null; end if;
  return jsonb_build_object('id',s.id,'student_number',s.student_number,'email',normalized,
    'status',s.status,'auth_user_id',s.auth_user_id,
    'first_name',nullif(btrim(s.first_name),''),'last_name',nullif(btrim(s.last_name),''),
    'full_name',nullif(concat_ws(' ',nullif(btrim(s.first_name),''),nullif(btrim(s.last_name),'')),''),
    'program',s.program,'year_level',s.year_level);
end$$;
revoke all on function private.kandid_setup_record_v1(text,uuid,text) from public,anon,authenticated,service_role;

create function public.kandid_student_setup_admission_v1(
  p_student_number text, p_auth_user_id uuid default null, p_expected_email text default null
) returns jsonb language sql security definer set search_path = pg_catalog as $$
  select private.kandid_setup_record_v1(p_student_number,p_auth_user_id,p_expected_email)
$$;

create function public.kandid_student_setup_issue_v1(
  p_student_number text, p_auth_user_id uuid, p_expected_email text, p_proof_hash text
) returns jsonb language plpgsql security definer set search_path = pg_catalog set lock_timeout = '5s' as $$
declare s jsonb; expiry timestamptz := clock_timestamp() + interval '5 minutes';
begin
  if p_auth_user_id is null or p_expected_email is null or p_proof_hash is null
     or p_proof_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  -- Same order in all mutations; includes normal Board/masterlist/admin writes.
  -- These short locks are never held across the external Auth request.
  lock table public.students, public.admin_users in share row exclusive mode;
  s := private.kandid_setup_record_v1(p_student_number,p_auth_user_id,p_expected_email);
  if s is null then return null; end if;
  if s->>'status' = 'active' and s->>'auth_user_id' = p_auth_user_id::text then
    return jsonb_build_object('account_state','active','student',s);
  end if;
  if exists(select 1 from private.student_setup_proofs where student_id = (s->>'id')::bigint
      and claimed_at is not null and completed_at is null and recovered_at is null) then return null; end if;
  insert into private.student_setup_proofs(proof_hash,student_id,auth_user_id,email_hash,
    expected_status,expected_auth_user_id,expires_at)
  values(p_proof_hash,(s->>'id')::bigint,p_auth_user_id,
    encode(sha256(convert_to(s->>'email','UTF8')),'hex'),s->>'status',(s->>'auth_user_id')::uuid,expiry);
  return jsonb_build_object('account_state','pending','student',s,'expires_at',extract(epoch from expiry)::bigint);
end$$;

create function public.kandid_student_setup_claim_v1(
  p_student_number text, p_auth_user_id uuid, p_expected_email text, p_proof_hash text
) returns jsonb language plpgsql security definer set search_path = pg_catalog set lock_timeout = '5s' as $$
declare s jsonb; proof private.student_setup_proofs%rowtype;
begin
  if p_auth_user_id is null or p_expected_email is null then return null; end if;
  lock table public.students, public.admin_users in share row exclusive mode;
  select * into proof from private.student_setup_proofs where proof_hash = p_proof_hash for update;
  if not found or proof.auth_user_id <> p_auth_user_id or proof.expires_at <= clock_timestamp()
     or proof.claimed_at is not null or proof.completed_at is not null or proof.recovered_at is not null then return null; end if;
  s := private.kandid_setup_record_v1(p_student_number,p_auth_user_id,p_expected_email);
  if s is null or (s->>'id')::bigint <> proof.student_id
     or s->>'status' is distinct from proof.expected_status
     or (s->>'auth_user_id')::uuid is distinct from proof.expected_auth_user_id
     or encode(sha256(convert_to(s->>'email','UTF8')),'hex') <> proof.email_hash
     or exists(select 1 from private.student_setup_proofs where student_id = proof.student_id
       and claimed_at is not null and completed_at is null and recovered_at is null) then return null; end if;
  update private.student_setup_proofs set claimed_at = clock_timestamp() where proof_hash = p_proof_hash;
  return s;
end$$;

create function public.kandid_student_setup_finish_v1(
  p_student_number text, p_auth_user_id uuid, p_expected_email text, p_proof_hash text
) returns jsonb language plpgsql security definer set search_path = pg_catalog set lock_timeout = '5s' as $$
declare s jsonb; proof private.student_setup_proofs%rowtype; result jsonb;
begin
  if p_auth_user_id is null or p_expected_email is null then return null; end if;
  lock table public.students, public.admin_users in share row exclusive mode;
  select * into proof from private.student_setup_proofs where proof_hash = p_proof_hash for update;
  if not found or proof.auth_user_id <> p_auth_user_id or proof.claimed_at is null
     or proof.expires_at <= clock_timestamp() or proof.completed_at is not null or proof.recovered_at is not null then return null; end if;
  s := private.kandid_setup_record_v1(p_student_number,p_auth_user_id,p_expected_email);
  if s is null or (s->>'id')::bigint <> proof.student_id
     or s->>'status' is distinct from proof.expected_status
     or (s->>'auth_user_id')::uuid is distinct from proof.expected_auth_user_id
     or encode(sha256(convert_to(s->>'email','UTF8')),'hex') <> proof.email_hash then return null; end if;
  -- Admission, collision checks, state comparison and activation share one
  -- transaction. Neither a disabled state nor changed identity can be overwritten.
  update public.students set auth_user_id = p_auth_user_id, status = 'active'
    where id = proof.student_id and status = proof.expected_status
      and auth_user_id is not distinct from proof.expected_auth_user_id
      and encode(sha256(convert_to(lower(btrim(email)),'UTF8')),'hex') = proof.email_hash
    returning jsonb_build_object('id',id,'student_number',student_number,'email',email,'status',status) into result;
  if result is null then return null; end if;
  update private.student_setup_proofs set completed_at = clock_timestamp() where proof_hash = p_proof_hash;
  return result;
end$$;

revoke all on function public.kandid_student_setup_admission_v1(text,uuid,text),
  public.kandid_student_setup_issue_v1(text,uuid,text,text),
  public.kandid_student_setup_claim_v1(text,uuid,text,text),
  public.kandid_student_setup_finish_v1(text,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.kandid_student_setup_admission_v1(text,uuid,text),
  public.kandid_student_setup_issue_v1(text,uuid,text,text),
  public.kandid_student_setup_claim_v1(text,uuid,text,text),
  public.kandid_student_setup_finish_v1(text,uuid,text,text) to service_role;
comment on table private.student_setup_proofs is
 'Single-use, five-minute OTP setup authorizations; unresolved password attempts require reviewed recovery, never automatic retry.';
alter table private.student_setup_proofs owner to postgres;
alter function private.kandid_setup_record_v1(text,uuid,text) owner to postgres;
alter function public.kandid_student_setup_admission_v1(text,uuid,text) owner to postgres;
alter function public.kandid_student_setup_issue_v1(text,uuid,text,text) owner to postgres;
alter function public.kandid_student_setup_claim_v1(text,uuid,text,text) owner to postgres;
alter function public.kandid_student_setup_finish_v1(text,uuid,text,text) owner to postgres;
notify pgrst, 'reload schema';
commit;
