-- REVIEW ONLY. First disable STUDENT_SETUP_SECURITY_ENABLED and both frontend
-- setup flags in an approved release. Do not restore the unsafe v6/v9 handlers.
begin;
set local lock_timeout='5s';
set local statement_timeout='15s';
lock table private.student_setup_proofs in exclusive mode;
do $$begin
  if exists(select 1 from private.student_setup_proofs where claimed_at is not null
      and completed_at is null and recovered_at is null) then
    raise exception 'Unresolved password attempt exists: review Auth outcome before rollback.';
  end if;
end$$;
drop function public.kandid_student_setup_finish_v1(text,uuid,text,text);
drop function public.kandid_student_setup_claim_v1(text,uuid,text,text);
drop function public.kandid_student_setup_issue_v1(text,uuid,text,text);
drop function public.kandid_student_setup_admission_v1(text,uuid,text);
drop function private.kandid_setup_record_v1(text,uuid,text);
-- Preserve the private proof journal and all existing students/Auth/enrollment
-- records. No CASCADE, account deletion or password reset is part of rollback.
notify pgrst,'reload schema';
commit;
