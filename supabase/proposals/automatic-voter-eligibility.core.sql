-- LOCAL REVIEW PROPOSAL. Applied only by the guarded forward file after approval.
-- Existing snapshots and their mutation guards remain untouched.
create function private.kandid_student_is_live_eligible(p_election_id integer, p_student_id integer)
returns boolean language sql stable security definer set search_path=pg_catalog
as $function$
  select exists (
    select 1 from public.elections e
    join public.academic_terms t on t.id=e.academic_term_id and t.status='active'
    join public.students s on s.id=p_student_id and s.status='active' and s.auth_user_id is not null
    join auth.users u on u.id=s.auth_user_id and u.email_confirmed_at is not null
      and u.deleted_at is null and not coalesce(u.is_anonymous,false)
      and (u.banned_until is null or u.banned_until<=pg_catalog.statement_timestamp())
    join public.student_term_enrollments ste on ste.student_id=s.id
      and ste.academic_term_id=e.academic_term_id and ste.enrollment_status='enrolled'
    cross join lateral public.resolve_student_organization_participation(s.id,e.organization_id,e.academic_term_id) membership
    where e.id=p_election_id and e.removed_at is null
      and (select count(*) from public.students other where other.auth_user_id=s.auth_user_id)=1
      and (select count(*) from public.academic_terms where status='active')=1
      and membership.allowed is true and membership.status='active'
      and (not exists (select 1 from public.eligibility_rules r where r.election_id=e.id)
        or exists (
          select 1 from public.eligibility_rules r where r.election_id=e.id
            and (r.program is null or upper(btrim(ste.program))=upper(btrim(r.program)))
            and ((ste.is_shs is true and r.allow_shs is true)
              or (ste.is_shs is false and ste.year_level between 1 and 6
                and (r.min_year_level is null or ste.year_level>=r.min_year_level)
                and (r.max_year_level is null or ste.year_level<=r.max_year_level)))
        ))
  );
$function$;
alter function private.kandid_student_is_live_eligible(integer,integer) owner to postgres;
revoke all on function private.kandid_student_is_live_eligible(integer,integer) from public,anon,authenticated,service_role;

-- Clock-time check is separate from membership so previews can count future voters.
create function private.kandid_voting_is_open(p_election_id integer)
returns boolean language sql volatile security definer set search_path=pg_catalog
as $function$
  select exists (select 1 from public.elections e where e.id=p_election_id
    and e.status='active' and e.removed_at is null
    and e.start_date is not null and e.end_date>e.start_date
    and pg_catalog.timezone('Asia/Manila',pg_catalog.clock_timestamp())>=e.start_date
    and pg_catalog.timezone('Asia/Manila',pg_catalog.clock_timestamp())<e.end_date
    and ((e.campaign_start is null and e.campaign_end is null)
      or (e.campaign_start is not null and e.campaign_end is not null
        and e.campaign_start<e.campaign_end and e.campaign_end<=e.start_date
        and pg_catalog.timezone('Asia/Manila',pg_catalog.clock_timestamp())>=e.campaign_end)));
$function$;
alter function private.kandid_voting_is_open(integer) owner to postgres;
revoke all on function private.kandid_voting_is_open(integer) from public,anon,authenticated,service_role;

-- Only the caller's identity is admitted; no client student/organization argument.
create function public.kandid_check_student_ballot_eligibility(p_election_id integer)
returns boolean language plpgsql volatile security definer set search_path=pg_catalog
as $function$
declare student_value integer; student_count integer;
begin
  if auth.uid() is null then raise exception using errcode='28000',message='Student authentication is required.'; end if;
  select count(*)::integer,min(id) into student_count,student_value
    from public.students where auth_user_id=auth.uid();
  return student_count=1 and private.kandid_voting_is_open(p_election_id)
    and private.kandid_student_is_live_eligible(p_election_id,student_value);
end;
$function$;
alter function public.kandid_check_student_ballot_eligibility(integer) owner to postgres;
revoke all on function public.kandid_check_student_ballot_eligibility(integer) from public,anon,authenticated,service_role;
grant execute on function public.kandid_check_student_ballot_eligibility(integer) to authenticated;

-- Keep the installed trigger attachment/name; replace its frozen-roster decision
-- with the same live predicate. Direct browser inserts remain forbidden by grants.
create or replace function private.kandid_require_locked_electorate_for_ballot()
returns trigger language plpgsql security definer set search_path=pg_catalog
as $function$
begin
  if not private.kandid_voting_is_open(new.election_id)
    or not private.kandid_student_is_live_eligible(new.election_id,new.student_id) then
    raise exception using errcode='42501',message='Student is not eligible to vote in this election now.';
  end if;
  return new;
end;
$function$;
alter function private.kandid_require_locked_electorate_for_ballot() owner to postgres;
revoke all on function private.kandid_require_locked_electorate_for_ballot() from public,anon,authenticated,service_role;

-- Serialize optional-rule inserts/edits with atomic submission's election lock.
-- Existing frozen snapshots and elections with recorded votes retain their rules.
create function private.kandid_guard_live_eligibility_rules()
returns trigger language plpgsql security definer set search_path=pg_catalog
as $function$
declare election_value integer;
begin
  if tg_op='UPDATE' and new.election_id is distinct from old.election_id then
    raise exception using errcode='42501',message='Eligibility rules cannot be moved between elections.';
  end if;
  if tg_op='DELETE' then election_value:=old.election_id; else election_value:=new.election_id; end if;
  perform 1 from public.elections where id=election_value for update;
  if exists(select 1 from public.elections where id=election_value and electorate_frozen_at is not null)
    or exists(select 1 from public.vote_ballots where election_id=election_value)
    or exists(select 1 from public.votes where election_id=election_value) then
    raise exception using errcode='42501',message='Eligibility rules are immutable after freezing or a recorded vote.';
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$function$;
alter function private.kandid_guard_live_eligibility_rules() owner to postgres;
revoke all on function private.kandid_guard_live_eligibility_rules() from public,anon,authenticated,service_role;
create trigger eligibility_rules_serialize_live_voting before insert or update or delete on public.eligibility_rules
for each row execute function private.kandid_guard_live_eligibility_rules();
