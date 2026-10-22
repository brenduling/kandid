-- REVIEW ONLY. This is not an automatic retry/unlock endpoint.
-- Requires separate approval for ONE proof hash/UID after server-side setup is
-- disabled, requests are drained, and Auth outcome has been manually confirmed.
-- Run in one outer transaction with these transaction-local settings:
-- kandid.setup_recovery_approved = 'true'
-- kandid.setup_recovery_hash = the exact reviewed 64-character stored hash
-- kandid.setup_recovery_uid = the exact reviewed Auth UUID
-- This script neither resets a password nor changes a student/enrollment row.
set local lock_timeout='5s';
lock table public.students, public.admin_users in share row exclusive mode;
do $$
declare h text := current_setting('kandid.setup_recovery_hash',true);
  uid uuid := nullif(current_setting('kandid.setup_recovery_uid',true),'')::uuid;
  proof private.student_setup_proofs%rowtype; affected integer;
begin
  if current_setting('kandid.setup_recovery_approved',true) is distinct from 'true'
     or h is null or h !~ '^[0-9a-f]{64}$' or uid is null then
    raise exception 'Exact reviewed proof hash, Auth UID and explicit recovery approval required.';
  end if;
  select * into proof from private.student_setup_proofs where proof_hash=h for update;
  if not found or proof.auth_user_id <> uid or proof.claimed_at is null
     or proof.completed_at is not null or proof.recovered_at is not null
     or proof.expires_at >= clock_timestamp() then
    raise exception 'Reviewed unresolved expired claim does not match; no recovery performed.';
  end if;
  update private.student_setup_proofs set recovered_at=clock_timestamp()
    where proof_hash=h and auth_user_id=uid and recovered_at is null and completed_at is null;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Expected exactly one recovered claim.'; end if;
end$$;
