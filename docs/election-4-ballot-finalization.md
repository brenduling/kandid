# Election 4 ballot visibility and electorate finalization

Local preparation, 21 October 2026. Official backend: `fszgdxqxonqqcrzsnkca`.
No production record, migration, deployment, secret, Auth setting or grant changed.
The local source hashes and exact changed-file list are in
`election-4-ballot-finalization-manifest.json`; execution of its scope is not
approved. Read-only preflight queries are in
`supabase/runtime-validation/election-4-ballot-finalization-readonly.sql`.

## Confirmed cause and evidence

The installed `kandid_get_student_ballot_candidates(integer)` deliberately raises
`42501 / Ballot choices are unavailable.` for an otherwise active policy-v1
election without `electorate_frozen_at` or the student's private snapshot row.
This explains the 403; the Chairman and its two published candidates are present.
Changing candidate queries, publishing again or weakening RLS cannot fix it.

Read-only inspection at 02:13 Manila on 21 October found Election 4 active with
term 1 active, voting 01:00–22:00, no freeze, **0 snapshot members, 0 ballot
records, 0 vote rows and 0 eligibility rules**. Its audit history contains creation
and updates but no committed `election_electorate_locked` event. Counts only were
read from vote tables; no production choices or student identities were read.

The workflow defects are:

1. Election create/edit saves `status=active` independently of finalization.
   Neither saving nor reaching the start time automatically invokes the lock RPC.
   The database permits an unfrozen active schedule to be saved in the past.
2. The Board lock is inside Edit → Review. It requires Active **with a future
   voting start**, then atomically snapshots the eligible students, freezes the
   election and writes its dedicated audit. It refuses a start already passed.
3. Installed preview/lock use active linked students and the participation
   resolver but **ignore saved program/year/SHS rules**. Missing rules can still
   produce a positive preview. The earlier local rule correction was explicitly
   scoped to Election 3 and does not repair Election 4.
4. The development transport previously refused all lock requests. The page
   cannot distinguish a safe rule-enforcing backend from that installed legacy
   preview. A failed/blocked attempt does not leave a committed lock audit;
   current records do not prove whether anyone attempted it.
5. The student page fetched all positions, displayed an opaque candidate-loading
   error, and provided no explanation of an unfinished electorate.

No evidence supports attributing the missing snapshot to a particular operator
or failed database transaction. Its state proves no successful freeze committed.

## Intended eligibility

User confirmed: **BSIT, college Years 1–4, SHS excluded**. An independent read-only
aggregate over active Auth-linked students, enrolled term-1 records and current
organization-2 participation returns **2** matching students. This is a proposed
audience count, not a frozen electorate. No academic record or rule was changed.

## Local corrections

- `supabase/proposals/election-4-ballot-finalization.sql` is a standalone
  **unapplied proposal outside migration discovery**. It installs no electorate
  and changes no election/rule/schedule/vote row. Its enforcement is explicitly
  scoped to Election 4. Other elections retain installed authorization behavior.
- One private rule predicate uses the election's single active term, active
  linked central student, enrolled term program/year/SHS and existing
  organization participation resolver. Rules are ORed; null program/bounds keep
  existing declaration semantics. Missing rules or zero matching voters fail
  closed. The proposal never creates a default eligibility rule.
- Preview, atomic lock, student candidate authorization, server-only membership
  check and ballot insertion guard use this same predicate for Election 4.
  Existing JWT derivation, RPC signatures/owners/ACLs, private snapshot RLS,
  schedule cutoff, immutable freeze and audit behavior are preserved.
- Partial snapshots and pre-existing vote history require review. Rule edits
  serialize on the election row and are forbidden after snapshot/history exists.
  A second clock check rolls a lock back if eligibility computation crosses the
  voting-start cutoff. Past unfinalized active schedule writes and reopening
  closed/done/archived elections are rejected for Election 4.
- `src/utils/electorateFinalization.js` and
  `src/pages/board/ElectionElectoratePanel.jsx` require the authenticated preview's
  `declared-rules-v1` capability, valid election ID, saved rules and nonempty
  count. They refresh after confirmation, send only the election ID to the
  official lock RPC, disable automatic mutation retries and explain the sequence.
  The installed backend has no capability marker, so the UI remains blocked
  until the reviewed backend correction is approved and installed.
- `src/utils/developmentAdminRequests.js` admits the exact trusted lock RPC in
  normal development. This is transport permission only, with the original JWT;
  private snapshot/manual timestamp writes, actor overrides, policy downgrade,
  vote submission and worker activation remain blocked. Restricted/inspection
  profiles remain protected.
- `src/utils/studentBallotReadiness.js` and `src/pages/student/VotePage.jsx`
  explain unfrozen metadata without retrieving choices. A timestamp never grants
  access: finalized elections still require the JWT candidate RPC. Denials
  expose no choices or abstention, session/transport failures remain retryable,
  selections reset on reload, and already-voted students skip candidate retrieval.
- `src/utils/positionOrder.js` adds an opt-in active-position filter used only by
  Student Voting; management callers keep existing defaults. Candidate display
  fields, selection limits and abstention behavior remain intact.
- `src/utils/eligibilityRuleManagement.js` includes Election 4 in the locally
  prepared rule-enforcement scope, preserving the earlier Election 3 declaration.
- Tests: new `tests/ballotFinalization.test.mjs`, two isolated runners, updated
  admin/rule regressions and privacy caller assertion. The frozen Storage
  migration test now hashes canonical LF content on Windows; its original hash
  is unchanged and the migration file was not edited.

Campaign publication and ballot registration remain separate existing contracts.
Both Election 4 candidates are published; no new publication prerequisite or
broader student candidate-table access was introduced.

## Validation

- **213 targeted Node regressions passed**.
- **22 PostgreSQL 17 finalization checks passed** using replayed inspected
  functions and synthetic data under database roles in a disposable local DB.
  They reproduce the unfrozen 42501, reject missing rules and wrong/disabled
  actors, freeze exactly Year 1 and Year 4 students, return two candidate display
  records, reject revoked enrollment/membership/year, protect frozen records,
  roll back audit failures and a lock crossing the voting-start cutoff, and
  preserve other-election behavior and student records.
- **8 existing PostgreSQL integrity checks passed**, including atomic Ballot V1
  and V2 storage, candidate/abstain rows, independent hashes, duplicate rejection
  and simultaneous submissions committing exactly one complete ballot.
  There is no invented unique constraint on `vote_ballots(election_id,student_id)`:
  trusted duplicate enforcement is tested through the actual insertion contract.
- Targeted ESLint, production build including PWA and diff checks passed.
- **10 actual-route browser checks passed** at 1280px and 375px: two candidate
  cards, physical pointer selection, single-choice replacement, abstention,
  review, and no overflow; unfrozen/ineligible/expired/already-voted states
  expose no selection controls. Candidate fixture data came from the actual
  isolated PostgreSQL RPC. No vote confirmation or submission occurred. See
  `browser-results.json` and the screenshots in the evidence directory.
- Final read-only check at **02:36 Manila, 21 October**: all four production
  election records retain aggregate digest
  `5367cd5d8740a2579ce85f7487e02070`. Election 4 still has zero rules, snapshot
  members, ballots and vote rows. All **54 unrelated pre-existing modified or
  untracked files** match their starting SHA-256 hashes; Git index/HEAD unchanged.

Reproducible local commands:

```text
node --test tests/ballotFinalization.test.mjs
node scripts/kandid-ballot-finalization-pg17.mjs
node scripts/kandid-submit-vote-integrity-pg17.mjs
node scripts/kandid-ballot-visibility-browser.mjs
```

The PostgreSQL runners verify the local container's project label/port before
creating disposable randomly named databases. Browser verification uses the real
localhost:5174 route with an isolated Chrome profile, intercepted official API
traffic and a Supabase DNS backstop. It never confirms a vote. Evidence is under
`.tmp/voting-backend-runtime/ballot-finalization*` (ignored).

## Production steps requiring separate explicit approval

**The current Election 4 will remain unavailable until production is corrected.**
Candidate visibility does not establish submission readiness: `submit-vote` and
receipt restoration, and the development submission safeguard, are unchanged.
No blockchain worker or pending ballot is processed by this recovery.

1. Review the scoped SQL and source manifest. Recheck function hashes, owners,
   ACLs, triggers, current time, election baseline, active term, zero snapshot,
   zero ballots/votes and the count-only audience query. Stop on drift/history.
   The proposal refuses an incompatible baseline atomically. The earlier
   Election 3 SQL proposal remains untouched; **do not apply these proposals in
   sequence**. They replace shared RPC bodies, so a combined rollout needs
   explicit consolidation/review against whichever contract is installed first.
2. Approve installation of the Election 4 contracts only. No bulk `db push`,
   October 21 shortcut migration or direct electorate inserts. Validate the
   preview capability and backend ACLs with authenticated read-only checks.
3. Approve the Board to save Election 4's BSIT Years 1–4 / SHS-excluded rule.
4. Approve a **future voting start with enough time to review and lock**. Retain
   October 21 22:00 as the end if still feasible. The original 01:00 start has
   passed: preserving that start and performing a valid pre-start freeze are
   incompatible. No late-lock exception or silent schedule adjustment is safe.
   Recheck Manila time at execution; choose a start at least 30 minutes ahead.
   At the final 02:36 check, **03:30–22:00 Manila on October 21** is a concrete
   proposed window, conditional on approval and completing the lock before 03:30.
   If that lead time is lost, stop and agree a later future start.
5. Save the approved schedule through the authorized Board editor, keep the
   required Active status, refresh preview, verify count **2**, and explicitly
   approve the immutable electorate lock **before** the new start.
6. Read back the freeze and snapshot count. During voting, use an eligible
   student's authenticated read-only candidate RPC to confirm two Chairman
   candidates and active positions. Verify ineligible access remains denied
   using approved test accounts, not impersonation or service-role bypass.
   Do not submit a production test vote as part of this plan.
7. Evaluate submission/receipt backend readiness through its separate reviewed
   restoration plan. Do not advertise an operational voting backend based on
   candidate visibility alone.

### Rollback boundaries

DDL/procedure installation is one transaction; failed preflight/postflight leaves
the installed contracts unchanged. Before locking and with zero voting history,
authorized Board rule/schedule corrections remain possible. After locking, the
snapshot, rules and voting dates are immutable: there is no approved unlock,
manual timestamp reset, policy downgrade or snapshot rebuild. Contain access and
request a separately reviewed election recovery/replacement plan instead.
Reverting shared functions can weaken eligibility and requires its own review;
never blindly restore a superseded function body after ballots exist.

The current root checkout's `VotePage.jsx` differs from the older receipt-only
reviewed manifest. That manifest and its dedicated local branch are preserved;
neither authorizes deploying these additional voting changes.

Reference: [Supabase RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security)
describes the separate grants and row-policy checks retained by this proposal.
