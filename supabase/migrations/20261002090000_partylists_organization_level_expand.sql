begin;

-- Partylists become organization-level entities.
--
-- Target relationship:
--     organization -> partylist
-- rather than
--     organization -> election -> partylist
--
-- A partylist is an organization-managed group identity. Elections and
-- candidates may reference one where appropriate, but creating or editing a
-- partylist must never require selecting an election.
--
-- This is an EXPAND migration. It is deliberately reversible and additive:
--
--   phase A  (this file)  add + backfill + constrain organization_id, relax
--                          partylists.election_id to nullable, install
--                          organization-scoped RLS and grants
--   phase B  (separate,    drop partylists.election_id once no reader, writer
--           later file)    or guard references it
--
-- Running phase A leaves the table readable by the previous application build
-- and leaves every existing partylist row and every existing
-- candidates.partylist_id association untouched.
--
-- The one authoritative prior statement about this table, from
-- 20260928140000_harden_candidate_mutations.sql, is preserved here:
--   "Partylist affiliation is reusable across elections. The existing nullable
--    candidates.partylist_id foreign key remains the only partylist constraint."
-- Nothing in this migration touches candidates.partylist_id, so those
-- associations keep pointing at exactly the same rows they do today.

-- ---------------------------------------------------------------------------
-- 1. Add the organization anchor as nullable.
--
-- Nullable first, on purpose. Adding it as NOT NULL would fail outright while
-- existing rows still carry no value, which is the failure mode that makes a
-- migration look safe but abort unpredictably. The value is derived, then
-- verified, then constrained.
-- ---------------------------------------------------------------------------

alter table public.partylists
  add column if not exists organization_id bigint;

comment on column public.partylists.organization_id is
  'Owning organization. A partylist is an organization-level group identity; elections and candidates reference it, it is not owned by an election.';

-- ---------------------------------------------------------------------------
-- 2. Safest available backfill: each partylist's current election -> that
--    election's organization.
--
--    This is the only derivable organization for an existing row. The column is
--    copied verbatim rather than cast through elections.id, so the statement is
--    correct regardless of whether elections.organization_id is integer or
--    bigint. Widening to bigint is lossless in both directions.
--
--    p.election_id is null (no election), or points at an election row that no
--    longer exists, or belongs to an organization that is being wound down.
--    Those rows are deliberately left NULL here and reported by the check in
--    step 3 rather than being guessed at, deleted, or reassigned.
-- ---------------------------------------------------------------------------

update public.partylists p
   set organization_id = e.organization_id
  from public.elections e
 where e.id = p.election_id
   and p.organization_id is null;

-- ---------------------------------------------------------------------------
-- 3. Refuse to continue while any row is still unresolved.
--
--    Fails loudly and rolls the whole transaction back, rather than silently
--    locking NOT NULL onto NULLs or inventing an organization. Nothing is
--    deleted or reassigned. Resolve the reported rows deliberately, then re-run.
-- ---------------------------------------------------------------------------

do $$
declare
  unresolved_partylists bigint;
  unresolved_sample text;
begin
  select count(*)
    into unresolved_partylists
    from public.partylists
   where organization_id is null;

  if unresolved_partylists > 0 then
    select string_agg(format('%s#%s (election_id=%s)', p.name, p.id, coalesce(p.election_id::text, 'null')), ', ' order by p.id)
      into unresolved_sample
      from (
        select id, name, election_id
          from public.partylists
         where organization_id is null
         order by id
         limit 20
      ) p;

    raise exception using
      errcode = 'check_violation',
      message = format(
        'partylists.organization_id: %s row(s) have no derivable organization because election_id is null or points at a missing election. Assign an organization to these partylists deliberately, then re-run. First rows: %s',
        unresolved_partylists,
        coalesce(unresolved_sample, 'n/a')
      );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Now the invariant is safe to state.
-- ---------------------------------------------------------------------------

alter table public.partylists
  alter column organization_id set not null;

-- ---------------------------------------------------------------------------
-- 5. Foreign key and lookup index.
--
--    on delete restrict, matching officers/officer_directory. A partylist is
--    referenced by candidates, so an organization cannot be hard-deleted out
--    from under one; the existing Super Admin organization guard already
--    refuses that while related records exist.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.partylists'::regclass
       and conname = 'partylists_organization_id_fkey'
  ) then
    alter table public.partylists
      add constraint partylists_organization_id_fkey
      foreign key (organization_id)
      references public.organizations (id)
      on delete restrict;
  end if;
end;
$$;

create index if not exists partylists_organization_id_idx
  on public.partylists (organization_id);

-- ---------------------------------------------------------------------------
-- 6. election_id becomes vestigial.
--
--    Relaxed to nullable now, because a partylist must be creatable with no
--    election at all. It is NOT made optional-but-meaningful: organization_id is
--    the single owner from here on, and election_id is dead weight that phase B
--    removes. Existing rows keep their value untouched so the current
--    application build and any external consumer keep working in the meantime.
-- ---------------------------------------------------------------------------

alter table public.partylists
  alter column election_id drop not null;

-- ---------------------------------------------------------------------------
-- 7. Organization-scoped write authority.
--
--    Deliberately a new function rather than a reused election one: an
--    organization-level entity has no election to consult for lifecycle, so the
--    existing kandid_can_mutate_election_positions(election_id) cannot express
--    "this caller may manage partylists".
--
--    Scope is taken from the authenticated UUID and the active admin_users
--    assignment, exactly as kandid_can_mutate_election_positions does. Super
--    Admin keeps global scope; an Electoral Board member is limited to its own
--    organization and cannot widen it by supplying a different organization_id.
--
--    There is deliberately no election-phase gate. Partylists are not election
--    state, and a closed or archived election must not make an organization's
--    roster of groups uneditable.
-- ---------------------------------------------------------------------------

create or replace function public.kandid_can_mutate_organization_partylists(
  p_organization_id bigint
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  caller_uid uuid := auth.uid();
begin
  if caller_uid is null or p_organization_id is null then
    return false;
  end if;

  return exists (
    select 1
      from public.admin_users a
     where a.auth_user_id = caller_uid
       and a.status = 'active'
       and (
         a.role = 'super_admin'
         or (a.role = 'electoral_board' and a.organization_id = p_organization_id)
       )
  );
end;
$function$;

revoke all on function public.kandid_can_mutate_organization_partylists(bigint)
  from public, anon, authenticated;
grant execute on function public.kandid_can_mutate_organization_partylists(bigint)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 8. RLS.
--
--    NOTE FOR REVIEW: no migration in this repository has ever created a policy
--    on public.partylists, so its live RLS/grants state is not reproducible from
--    the tree. The drops below cover the legacy names used on the other Board
--    tables. Before applying, confirm on the live database which policies and
--    grants partylists actually has, and drop anything left over by hand.
--
--    Reads stay open to anon/authenticated, matching candidates_public_read.
--    Every write is gated on the row's own organization_id.
-- ---------------------------------------------------------------------------

alter table public.partylists enable row level security;

drop policy if exists partylists_all_access on public.partylists;
drop policy if exists "open partylists" on public.partylists;
drop policy if exists partylists_public_read on public.partylists;
drop policy if exists partylists_insert_authorized_election on public.partylists;
drop policy if exists partylists_update_authorized_election on public.partylists;
drop policy if exists partylists_delete_authorized_election on public.partylists;

create policy partylists_public_read
on public.partylists
for select
to anon, authenticated
using (true);

create policy partylists_insert_authorized_organization
on public.partylists
for insert
to authenticated
with check (
  organization_id is not null
  and public.kandid_can_mutate_organization_partylists(organization_id)
);

-- using() gates which existing rows may be touched; with check() gates the row
-- as it would end up, so a partylist cannot be moved into another organization.
create policy partylists_update_authorized_organization
on public.partylists
for update
to authenticated
using (
  public.kandid_can_mutate_organization_partylists(organization_id)
)
with check (
  public.kandid_can_mutate_organization_partylists(organization_id)
);

create policy partylists_delete_authorized_organization
on public.partylists
for delete
to authenticated
using (
  public.kandid_can_mutate_organization_partylists(organization_id)
);

-- ---------------------------------------------------------------------------
-- 9. Grants.
--
--    Grants are independent from RLS. Anonymous keeps read only. Writes are
--    granted at column level so a client cannot set an id, a created_at, or any
--    other column it does not need, and so organization_id is the one ownership
--    column a client supplies - checked against the caller's own scope by the
--    policies above.
-- ---------------------------------------------------------------------------

revoke all privileges on table public.partylists
  from public, anon, authenticated;

grant select on table public.partylists to anon, authenticated;
grant insert (organization_id, name, description, logo_url)
  on table public.partylists to authenticated;
grant update (organization_id, name, description, logo_url)
  on table public.partylists to authenticated;
grant delete on table public.partylists to authenticated;

do $$
begin
  if to_regclass('public.partylists_id_seq') is not null then
    execute 'revoke all privileges on sequence public.partylists_id_seq from public, anon, authenticated';
    execute 'grant usage on sequence public.partylists_id_seq to authenticated';
  end if;
end;
$$;

commit;

-- ===========================================================================
-- PHASE B - NOT INCLUDED HERE. Do not add this to this file.
--
-- Apply only after phase A is live, every reader and writer has stopped
-- referencing election_id, and the application build in production has been
-- verified. Keeping it in a later migration keeps the contract step separately
-- revertible.
--
--   begin;
--
--   alter table public.partylists drop column election_id;
--
--   commit;
--
-- Before running it, confirm all of the following are gone:
--   * src/pages/board/Partylists.jsx          (no election_id, no elections join)
--   * src/pages/superadmin/Partylists.jsx      (no election_id, no elections join)
--   * src/components/CandidateManagement.jsx  (no election_id filter)
--   * src/utils/globalSearch.js                (no election_id filter or join)
--   * src/utils/deleteGuards.js                (election delete guard no longer
--                                             counts partylists by election_id)
--
-- candidates.partylist_id is deliberately left untouched by both phases.
-- ===========================================================================