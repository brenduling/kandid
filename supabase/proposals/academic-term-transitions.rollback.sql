-- LOCAL PROPOSAL ONLY. Pre-activation rollback; never reverses a semester.
begin;
set local lock_timeout='2s';
do $guard$
begin
  if current_user <> 'postgres' then raise exception 'Reviewed postgres execution required.'; end if;
  -- The no-commit check and teardown must serialize with activation, including
  -- a commit already in flight. A SELECT-only guard would race and erase proof.
  perform private.kandid_lock_term_transition_inputs();
  lock table public.student_notifications in exclusive mode nowait;
  if exists(select 1 from private.academic_term_transition_reviews where committed_at is not null)
    or exists(select 1 from public.student_notifications where type='academic_term_activated') then
    raise exception 'A transition has committed: preserve receipts, notifications and safeguards; use a separately approved recovery plan.';
  end if;
end;
$guard$;
drop trigger enrollments_require_reconciled_program_memberships on public.student_term_enrollments;
drop trigger memberships_require_reconciled_program on public.student_organization_terms;
drop trigger candidates_require_current_term_enrollment on public.candidates;
drop trigger aaa_ballots_require_current_term_enrollment on public.vote_ballots;
drop function private.kandid_guard_current_program_memberships();
drop function private.kandid_guard_current_term_candidate();
drop function private.kandid_guard_current_term_ballot();
drop function private.kandid_require_current_term_participation(integer,integer);
drop function public.kandid_preview_academic_term_transition(uuid,integer);
drop function public.kandid_get_academic_term_transition(uuid,uuid);
drop function public.kandid_commit_academic_term_transition(uuid,uuid,boolean,text);
drop function public.kandid_create_next_academic_term(uuid,text,integer);
drop function private.kandid_academic_term_transition_impact(integer);
drop function private.kandid_lock_term_transition_inputs();
drop function private.kandid_term_transition_actor(uuid);
-- Contains preview receipts only: the guard above refuses to remove committed evidence.
drop table private.academic_term_transition_reviews;
drop index public.student_notifications_term_transition_recipient_idx;
alter table public.student_notifications drop constraint student_notifications_type_check;
alter table public.student_notifications add constraint student_notifications_type_check
  check (type in ('organization_removed','organization_restored'));
grant execute on function public.activate_academic_term(integer) to service_role;
notify pgrst,'reload schema';
commit;
