# Optional eligibility and scheduled electorate finalization

Prepared 21 October 2026 (Asia/Manila). This is local implementation evidence
and a production rollout proposal. No production migration, Cron extension/job,
election change, deployment, or Git push was performed.

The SHA-256 file manifest is
[`optional-eligibility-scheduled-finalization-manifest.json`](optional-eligibility-scheduled-finalization-manifest.json).

## What changed

- One private PostgreSQL predicate defines population eligibility: active
  Auth-linked student, enrolled for the election term, verified organization
  participation, one active term, and either no saved rules or a match to at
  least one saved rule. Term enrollment supplies program/year/SHS values.
- Board activation atomically records a private request due ten minutes before
  voting starts. Activation requires the reviewed one-minute dispatcher to be
  enabled and its heartbeat to be fresh. The Board does not need to create a
  rule to activate.
- A private PostgreSQL worker runs under the `postgres` database role. The
  advisory dispatcher lock, election row lock, request generation/revision,
  per-request retry deadline, final cutoff check, and transaction rollback make
  concurrent attempts idempotent. It never impersonates a Board JWT. A
  persisted Board assignment authorizes the election request; current status
  and organization are rechecked before the freeze.
- The snapshot, `electorate_frozen_at`, Board provenance, and audit event commit
  together. Empty populations do not freeze; transient failures retry at the
  next minute; the cutoff is voting start. Missed starts remain blocked and
  require a Board-approved future schedule edit. Frozen voter rows, policy,
  term, organization, rules, and voting dates remain immutable.
- Preview uses the same predicate. Candidate access and the existing ballot
  insert guard add that predicate to frozen-snapshot membership, lifecycle,
  and Manila voting-time checks. Existing JWT identity, server-only membership
  RPC access, duplicate submission, ballot hashes, receipt processing, and
  blockchain integration were not redesigned.
- Board displays membership-only versus additional rules, scheduled time,
  retry time/count, finalization outcome, and blocking reason. A due-only Board
  retry remains possible through the existing authenticated RPC. Activation
  and schedule changes first verify server scheduler readiness.

## Local changed-file manifest

- `supabase/migrations/20261021140000_scheduled_electorate_finalization.sql`
  — private request/health tables, canonical eligibility predicate, scheduling
  triggers, restricted worker, shared preview/candidate/ballot checks, and
  readiness/retry RPCs. It creates no extension or Cron job and backfills no
  request or voter row.
- `supabase/proposals/20261020114248_election_3_program_year_eligibility_historical-proposal.sql`
  — preserved prior Election 3 only proposal, moved out of migration discovery
  so a normal migration run cannot apply it ahead of the permanent workflow.
- `src/utils/electorateFinalization.js`,
  `src/pages/board/ElectionElectoratePanel.jsx`,
  `src/pages/board/BoardElectionSetup.jsx`,
  `src/pages/board/Elections.jsx`, and
  `src/pages/board/EligibilityRules.jsx` — readiness, scheduling, status, and
  optional-rule presentation.
- `src/utils/eligibilityRuleManagement.js` — policy display reads backend
  policy metadata instead of hard-coded election IDs.
- `src/utils/developmentProductionWriteGuard.js` — narrowly permits the new
  authenticated, read-only Board readiness RPC.
- `tests/electorateFinalization.test.mjs`,
  `tests/boardScheduledFinalizationPresentation.test.mjs`,
  `tests/eligibilityRuleManagement.test.mjs`, `tests/electionElectorate.test.mjs`,
  `scripts/kandid-scheduled-electorate-pg17.mjs`,
  `scripts/kandid-election-3-eligibility-pg17.mjs`,
  `docs/optional-eligibility-scheduled-finalization.md`, and this report.

Unrelated modified and untracked files in the shared workspace were retained.

## Test evidence

- Local PostgreSQL 17 isolated database: 21 scheduled-finalization contract
  checks cover migration drift refusal/atomicity, no data backfill, readiness
  gates, optional and restrictive rules, late enrollment, RLS/scope, forged
  authorization rejection, failure rollback/retry, concurrent workers,
  immutable snapshots/rules/schedule, empty audience recovery, missed cutoff,
  revoked authorizer recovery, candidate access, and ballot insertion guards.
- Local PostgreSQL 17 existing vote-integrity suite: 8 checks pass for browser
  write denial, unfrozen/nonmember rejection, transaction atomicity, Ballot V1
  and V2 integrity, duplicate submissions, position constraints, and concurrent
  submission. It uses the existing ballot submission function/contract; no
  submission, receipt, or blockchain source was changed for this workflow.
- Node targeted suites: 96 passed, 0 failed across Board scheduled-state and
  small-screen presentation, electorate UI/readiness, prior electorate
  contracts, eligibility-rule management, election create/edit authorization,
  lifecycle, RPC ACL, and production-write guard contracts.
- The scheduled worker was executed directly as the local PostgreSQL `postgres`
  role against a test Cron catalog. A native `pg_cron` extension/job was not
  installed in the local Supabase project or production. The exact extension
  scheduling behavior therefore remains a rollout preflight, not a claimed
  test result.
- The live official database and Election 4 were not modified. The migration
  runner uses a disposable local database and reports
  `productionConnected: false`.

## Required rollout sequence and gates

1. **Read-only preflight:** confirm production migration history through
   `20261021130000_candidate_management_scope_and_history_guard.sql`; compare
   the eight function owners/MD5 values in the migration preflight; confirm no
   `policy_version=1` frozen election has saved rules; inspect pending migrations
   and confirm no old Election 3 only proposal is queued for application. Stop
   on any drift or frozen-with-rules history. The migration refuses these
   conditions instead of rewriting records.
2. **Approve and apply only**
   `20261021140000_scheduled_electorate_finalization.sql` using the reviewed
   migration process. Do not run blanket `db push --include-all`; unrelated
   pending migrations require separate review. This step creates private tables
   and replaces the listed backend contracts, but installs no scheduler.
3. **Approve scheduler provisioning separately:** verify `pg_cron` is supported
   and already enabled in the target Supabase project, or approve its
   installation through the project's supported extension controls. Register
   one active job owned by `postgres`, database equal to the Kandid database,
   schedule `* * * * *`, and exact command
   `select private.kandid_process_due_electorates();`. Do not overwrite an
   unrelated job with the same name. Confirm a fresh successful heartbeat and
   that the readiness RPC reports ready before allowing new active elections
   or active schedule changes. Cron was deliberately not provisioned here.
4. Deploy the matching frontend after the backend and scheduler are verified.
   Check Board readiness, draft preview with zero rules, activation queue timing,
   due/retry status, finalized snapshot count, student candidate denial before
   freeze/outside schedule, eligible candidate access during voting, and
   rejection for a nonmember or revoked membership. Use a separately approved
   synthetic election; do not use Election 4 as a test record.
5. Observe one scheduled finalization and its audit metadata before broader
   activation. Verify there is one snapshot/audit, no client student IDs in the
   audit, and no second freeze after a repeated worker call.

Existing active policy-v1 elections are intentionally not backfilled. After
the worker is healthy, an authorized Board must save a valid future schedule to
create a provenance-backed request; elections already at/past their start stay
blocked until the Board approves and saves a future schedule. Election 4 was
not touched.

### Rollback and containment

Before any active elections have queued requests or any electorate has been
frozen, a backend rollback still needs a separately reviewed migration restoring
the exact preflighted function definitions, dropping only the newly created
triggers/functions/tables, and confirming no dependent requests. This prepared
change does not include an automatic down migration.

After a request is queued, or especially after a snapshot is frozen, do not
drop the queue, snapshots, audit history, or restore older candidate/ballot
contracts as a rollback. Keep student ballot access fail-closed and correct the
worker or use a reviewed forward migration. A frozen electorate cannot be
reversed without violating the integrity contract. The Cron job can be disabled
as a containment action after explicit production approval; pending elections
then stay blocked and must not be opened until scheduling health is restored.
Frontend rollback is separate and does not undo backend state.

## Production readiness

**Local implementation is prepared; production is not ready for deployment.**
Approval is still required for the production migration, `pg_cron` availability
or extension installation, exact job registration, the matching frontend
deployment, and controlled end-to-end verification. The key hard dependency is
a fresh heartbeat from the exact restricted one-minute job; without it, Board
activation and active schedule changes are rejected and student voting remains
blocked until a valid electorate is finalized.
