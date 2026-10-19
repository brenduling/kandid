begin;

-- Candidate rows belong to an election through their ballot position. Reuse
-- the deployed election authority for identity, organization scope, and the
-- Manila-time lifecycle decision; this trigger validates the candidate's
-- related records at the same write boundary.
create or replace function public.kandid_guard_candidate_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  old_election_id integer;
  new_election_id integer;
  new_organization_id integer;
  active_academic_term_id integer;
  participation_allowed boolean := false;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'Authenticated administrator access is required.';
  end if;

  if tg_op = 'INSERT' then
    if new.position_id is null then
      raise exception using
        errcode = '42501',
        message = 'A candidate must be assigned to an election position.';
    end if;

    select p.election_id, e.organization_id
      into new_election_id, new_organization_id
    from public.positions p
    join public.elections e on e.id = p.election_id
    where p.id = new.position_id;

    if not found then
      raise exception using
        errcode = '42501',
        message = 'The selected candidate position is unavailable.';
    end if;

    if not public.kandid_can_mutate_election_positions(new_election_id) then
      raise exception using
        errcode = '42501',
        message = 'Candidate changes are not authorized for this election.';
    end if;
  elsif tg_op = 'UPDATE' then
    if old.position_id is null and new.position_id is null then
      raise exception using
        errcode = '42501',
        message = 'An unassigned candidate has no election context for changes.';
    end if;

    if old.position_id is not null then
      select p.election_id
        into old_election_id
      from public.positions p
      where p.id = old.position_id;

      if not found
         or not public.kandid_can_mutate_election_positions(old_election_id) then
        raise exception using
          errcode = '42501',
          message = 'Candidate changes are not authorized for the current election.';
      end if;
    end if;

    if old.position_id is not null
       and new.position_id is null
       and (
         new.id is distinct from old.id
         or new.student_id is distinct from old.student_id
         or new.partylist_id is distinct from old.partylist_id
         or new.photo is distinct from old.photo
         or new.bio is distinct from old.bio
         or new.created_at is distinct from old.created_at
         or new.platform is distinct from old.platform
         or new.credentials is distinct from old.credentials
         or new.campaign_status is distinct from old.campaign_status
         or new.campaign_media_urls is distinct from old.campaign_media_urls
         or new.campaign_materials is distinct from old.campaign_materials
       ) then
      raise exception using
        errcode = '42501',
        message = 'Detaching a candidate may only clear its ballot position.';
    end if;

    if new.position_id is not null then
      select p.election_id, e.organization_id
        into new_election_id, new_organization_id
      from public.positions p
      join public.elections e on e.id = p.election_id
      where p.id = new.position_id;

      if not found then
        raise exception using
          errcode = '42501',
          message = 'The selected candidate position is unavailable.';
      end if;

      if not public.kandid_can_mutate_election_positions(new_election_id) then
        raise exception using
          errcode = '42501',
          message = 'Candidate changes are not authorized for the selected election.';
      end if;
    end if;
  else
    raise exception using
      errcode = '42501',
      message = 'Unsupported candidate mutation.';
  end if;

  -- A detached candidate has no current organization context. The existing
  -- Super Admin disconnect flow changes only position_id; the old election
  -- was authorized above. No current UI supports editing an already-detached
  -- row, so NULL -> NULL is intentionally denied for every role.
  if new.position_id is not null then
    if new.student_id is null then
      raise exception using
        errcode = '42501',
        message = 'An assigned candidate must reference an eligible student.';
    end if;

    select at.id
      into active_academic_term_id
    from public.academic_terms at
    where at.status = 'active'
    order by at.created_at desc, at.id desc
    limit 1;

    if active_academic_term_id is null then
      raise exception using
        errcode = '42501',
        message = 'Active academic-term eligibility could not be verified.';
    end if;

    select participation.allowed
      into participation_allowed
    from public.resolve_student_organization_participation(
      new.student_id,
      new_organization_id,
      active_academic_term_id
    ) participation
    limit 1;

    if participation_allowed is distinct from true then
      raise exception using
        errcode = '42501',
        message = 'The candidate student is not eligible for this election organization.';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.kandid_guard_candidate_mutation()
  from public, anon, authenticated;

drop trigger if exists candidates_trusted_mutation_guard
  on public.candidates;

create trigger candidates_trusted_mutation_guard
before insert or update on public.candidates
for each row
execute function public.kandid_guard_candidate_mutation();

-- Partylist affiliation is reusable across elections. The existing nullable
-- candidates.partylist_id foreign key remains the only partylist constraint.

-- Keep candidate records publicly readable while removing unconditional
-- mutation policies and requiring the trusted election authority to pass.
drop policy if exists candidates_all_access on public.candidates;
drop policy if exists "open candidates" on public.candidates;
drop policy if exists candidates_public_read on public.candidates;
drop policy if exists candidates_insert_authorized_election on public.candidates;
drop policy if exists candidates_update_authorized_election on public.candidates;
drop policy if exists candidates_delete_authorized_election on public.candidates;

alter table public.candidates enable row level security;

create policy candidates_public_read
on public.candidates
for select
to anon, authenticated
using (true);

create policy candidates_insert_authorized_election
on public.candidates
for insert
to authenticated
with check (
  position_id is not null
  and exists (
    select 1
    from public.positions p
    where p.id = candidates.position_id
      and public.kandid_can_mutate_election_positions(p.election_id)
  )
);

-- NULL-parent rows may be targeted only so the trigger can authorize a
-- NULL -> assigned transition against its NEW election. The trigger rejects
-- NULL -> NULL and checks the OLD parent before any assigned -> NULL change.
create policy candidates_update_authorized_election
on public.candidates
for update
to authenticated
using (
  position_id is null
  or exists (
    select 1
    from public.positions p
    where p.id = candidates.position_id
      and public.kandid_can_mutate_election_positions(p.election_id)
  )
)
with check (
  position_id is null
  or exists (
    select 1
    from public.positions p
    where p.id = candidates.position_id
      and public.kandid_can_mutate_election_positions(p.election_id)
  )
);

create policy candidates_delete_authorized_election
on public.candidates
for delete
to authenticated
using (
  position_id is not null
  and exists (
    select 1
    from public.positions p
    where p.id = candidates.position_id
      and public.kandid_can_mutate_election_positions(p.election_id)
  )
);

-- Grants are independent from RLS. Keep public reads, remove anonymous
-- writes, and grant only the columns written by existing Candidate UIs.
revoke all privileges on table public.candidates
  from public, anon, authenticated;

grant select on table public.candidates to anon, authenticated;
grant insert (
  position_id,
  student_id,
  partylist_id,
  photo,
  bio,
  platform,
  credentials,
  campaign_materials,
  campaign_media_urls
) on public.candidates to authenticated;
grant update (
  position_id,
  student_id,
  partylist_id,
  photo,
  bio,
  platform,
  credentials,
  campaign_materials,
  campaign_media_urls
) on public.candidates to authenticated;
grant delete on table public.candidates to authenticated;

revoke all privileges on sequence public.candidates_id_seq
  from public, anon, authenticated;
grant usage on sequence public.candidates_id_seq to authenticated;

-- candidate_media has no current frontend writer. Preserve public reads and
-- its existing FK/check/three-row trigger, while applying least privilege to
-- client roles until a trusted media write path exists.
drop policy if exists candidate_media_all_access on public.candidate_media;
drop policy if exists "open candidate_media" on public.candidate_media;
drop policy if exists candidate_media_public_read on public.candidate_media;

alter table public.candidate_media enable row level security;

create policy candidate_media_public_read
on public.candidate_media
for select
to anon, authenticated
using (true);

revoke all privileges on table public.candidate_media
  from public, anon, authenticated;
grant select on table public.candidate_media to anon, authenticated;

revoke all privileges on sequence public.candidate_media_id_seq
  from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
