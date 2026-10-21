# Prac Elec: prepared test-election recovery

Status: **prepared locally, not executed in production**.
Project: fszgdxqxonqqcrzsnkca. Election: 3. Organization: 2.
Branch: github-checkpoint. Base commit: 2c20a0277f22a09d2df89a3b82b11d0324eaf82b.
This report supersedes the earlier binding-Years-2–4 recovery decision.

## Approved policy intent and live comparison

The user's latest decision is BSIT Years 1–4, SHS excluded, with active
Auth-linked identity, current-term enrollment and organization participation.
No academic record needs to be changed to make the Year 1 test student eligible.

At **20 October 2026 19:53:55 Asia/Manila**, read-only production checks found:

- Proposed electorate: exactly 2.
- Both have existing confirmed Auth identities matching their Student email.
- 3 pending/unlinked organization members remain excluded.
- Frozen snapshot rows: 0; ballots: 0; vote rows: 0.
- Term 1 remains the single active term.
- Production rule ID 1 still reads BSIT, minimum 2, maximum 4, allow_shs=false.
- The live schedule is still 20 October 10:00–20:00, active, policy 1, unfrozen.

The count of 2 is a read-only projection of the proposed rule against actual
production prerequisites. A successful authorized-voter production candidate
RPC has not been observed. The patched official preview and lock were verified
with synthetic data on PostgreSQL 17, not executed against production.

## Local correction

Proposed migration:
`supabase/proposals/20261020114248_election_3_program_year_eligibility_historical-proposal.sql`.

It adds a private shared rule predicate and explicitly opts in Election 3 only.
The scope is deliberate: no other existing or future election is automatically
enrolled in a new authorization policy. A broader rollout needs a separate
reviewed change.

The predicate uses academic-term enrollment fields rather than the legacy
central academic summary. It requires active/Auth-linked identity, the single
active election term, enrolled status, canonical organization participation and
a matching saved rule. Rules are OR alternatives; null programs or college
bounds retain their existing wildcard semantics. SHS requires explicit
inclusion and is independent of college bounds. Missing rules or prerequisites
fail closed for Election 3.

The same predicate is used in:

1. Board electorate preview.
2. Board electorate lock.
3. Student ballot-candidate RPC.
4. Service-only frozen-electorate membership RPC used by the local submit-vote
   implementation.
5. The ballot insertion trigger.

The candidate RPC retains the deployed October 18 timing, JWT identity,
frozen-roster and display projection contracts. The server-only membership RPC
and ballot trigger additionally enforce Election 3's voting interval. Existing
service-role/authenticated execution boundaries remain intact. New helper
functions are private and have no execute grants for browser or service roles;
trusted existing definer functions invoke them internally.

A rule-mutation trigger serializes Election 3 edits on the same election row
used by locking. Once a frozen snapshot or voting history exists, Create,
Edit, Delete and moving enforced rules to/from another election are refused.
Snapshot membership, term, organization and voting timestamps retain their
existing immutability safeguards.

The migration verifies reviewed function digests and owners, takes an Election 3
row lock, and refuses an unexpected election, existing freeze, partial snapshot,
vote history or helper collision. It preserves existing public RPC ACLs and
asserts their expected effective grants. It performs no immediate student,
rule, election-schedule, snapshot or vote DML. The lock RPC's eventual DML
remains a separate Board operation.

No existing migration was rewritten. In particular, the October 21 migration
was neither applied nor used as a baseline. Apply only the reviewed proposed
file after explicit approval; never run a blanket db push/include-all against
this workspace's pending migrations. If the function-drift check rejects it,
stop and inspect the new baseline rather than bypassing the preflight.

## Board eligibility change, prepared but not submitted

The existing route is `/board/eligibility-rules`, also available from Election
3's Manage Setup → Eligibility rules. The current authenticated Board workflow
verifies organization scope, program catalog, duplicates/overlaps and rule ID,
then submits a scoped edit.

Edit existing rule **ID 1, election_id 3**:

| Field | Current | Proposed |
| --- | --- | --- |
| program | BSIT | BSIT |
| min_year_level | 2 | 1 |
| max_year_level | 4 | 4 |
| allow_shs | false | false |

Use Edit, not a duplicate Create. Refresh first and stop if the rule ID,
election, organization or saved values have changed. The SDK mutation remains
filtered to both the existing rule ID and election ID; it does not reassign
the parent. No production request was sent.

Local Board copy now explains the scoped enforcement and the frozen-rule
restriction, and a verified server-side frozen-rule denial has a clear message.
The related frontend copy must be released only after the reviewed database
enforcement is installed. The API, routes, validation and payload contracts
are unchanged. No layout or shared shell redesign was performed.

## New operational blocker: submission endpoint is absent

Read-only get_edge_function for `submit-vote` returned NotFound. The official
project's list_edge_functions inventory independently confirmed no submit-vote
deployment. The production client in src/utils/voting.js calls that exact
endpoint; development-mode submission is intentionally disabled.

The local supabase/functions/submit-vote/index.ts invokes the service-only
kandid_is_locked_electorate_member RPC after deriving Student identity from
Auth and validating phase, enrollment and organization participation. This
proposal preserves that interface and tightens the RPC for Election 3.
However, this is repository evidence, not verification of a deployed handler.

Consequently, this migration can prepare consistent electorate/candidate
authorization, but cannot by itself restore ballot submission. Existing
submit-vote activation requires a separate backend readiness/security review
and explicit deployment approval. This task did not modify, deploy or enable
that handler, alter secrets, or expand its trust boundary. Do not lock the
test electorate on the assumption that submission is already operational.

## Proposed replacement window

The October 20 20:00 start no longer leaves sufficient time for the remaining
approval and backend activation work. Proposed replacement, **not yet approved
or saved**:

- Start: **21 October 2026 08:00 Asia/Manila**.
- End: **22 October 2026 10:00 Asia/Manila**.
- Duration: **26 hours**.

Recheck server Manila time before approval and execution. If that new start
ceases to be feasible, request another future start; never substitute silently
or backdate a lock. Existing campaign timestamps remain unchanged.

## Approval-gated execution sequence

Submission restoration now has a separate completed investigation:
[submit-vote deployment readiness](submit-vote-deployment-readiness.md).
The subsequent [prepared backend recovery](voting-backend-recovery-prepared.md)
fixes the two handler defects locally and separates submission/receipt
restoration from the still-disabled global worker. No Election 3 operation is
authorized by either backend restoration gate.
It confirms genuine gateway absence, also missing receipt/ballot-worker
functions, missing worker configuration, a global pending ballot requiring
approval, and source issues to resolve before writer activation. Endpoint
restoration remains blocked pending that reviewed readiness process.

1. Explicitly approve the reviewed Election-3-only migration and the Board rule
   and replacement schedule changes. Resolve the absent submission endpoint
   through a separately approved backend readiness/deployment process.
2. Re-run the bundled read-only validation SQL and verify function baseline,
   scope, active term, no snapshot/history and projected electorate exactly 2.
3. Apply only the reviewed migration. It does not change rule values or schedule.
4. As the real organization-2 Board account, edit rule 1 to BSIT Years 1–4,
   retaining maximum 4 and SHS exclusion.
5. In Board Elections → Prac Elec → Edit → Schedule, save the approved future
   voting start/end, keeping active status, organization 2, term 1 and all other
   configuration. Reopen/refresh the saved election.
6. In Review → Electorate → Refresh preview, require eligible_voters=2,
   locking_allowed=true, and the exact saved term/schedule. Confirm identity,
   enrollment and membership administration is stable. Stop on any discrepancy.
7. Only after final preflight and explicit approval for the irreversible lock,
   confirm Lock electorate strictly before the approved start.
8. Re-run validation: policy remains 1; server-generated lock timestamp and
   actor are present; snapshot contains precisely the 2 approved voters;
   pending/unlinked membership count in the snapshot is 0; missing/extra
   membership counts are 0; one completed trusted lock audit exists; all vote
   counts remain 0. Check dedicated audit metadata eligible_count=2 and term=1.
9. Before start, candidate access remains time-protected. During the approved
   window, use an authorized test student's real session to verify successful
   candidate RPC access and names, photos, partylists and ballot validation.
   Check ineligible and other-organization denials with authorized test accounts.
   Do not submit a production vote.

The read-only SQL file is
`supabase/runtime-validation/election-3-electorate-recovery-readonly.sql`.
It separately reports membership-only, current declared-rule and hypothetical
BSIT Years 1–4 counts. Snapshot differences now compare the current declared
rule population, not the old broader membership count. The file never invokes
the mutating lock RPC.

## Validation performed

- Local PostgreSQL 17.6 runner:
  `node scripts/kandid-election-3-eligibility-pg17.mjs`.
  Uses a uniquely named synthetic database inside the verified existing local
  test container; verifies the container label/port and database name before
  operating. The isolated database is removed afterward. No new Supabase
  project or production connection is created.
- 26 database regression checks: function/owner drift, existing history,
  old-rule Year 1 exclusion, new-rule inclusion of exactly 2, Board scope/RLS,
  wrong program/year, pending/unlinked/disabled identities, enrollment,
  wrong/removed/missing organization participation, historical/ambiguous term,
  SHS, missing data/rules, explicit wildcard/OR semantics, private ACLs,
  elapsed-start cutoff, partial snapshot rejection, atomic audit failure,
  concurrent rule-edit serialization, idempotent lock/audit, frozen rule and
  schedule/roster protection, authorized candidate display payload,
  post-freeze eligibility revocation, closed/removed/expired election denial,
  and unchanged other-election access, data and receipts.
- Targeted Node suites:
  `node --test tests/eligibilityRuleManagement.test.mjs tests/electionElectorate.test.mjs tests/electorateRpcExecuteSecurity.test.mjs`
  — 38 passed, 0 failed.
- Targeted ESLint for the changed frontend files — passed.
- `npm.cmd run build` — passed, including PWA generation. Vite emitted a
  non-failing plugin timing warning.
- Read-only production projection and validation SQL — succeeded.
- No actual production vote, authorized-voter candidate success or end-to-end
  browser rendering is claimed. Those remain gated live checks.

The synthetic fixture captures the inspected production function definitions
without personal student data or secrets. Historical contract tests retain
their original migration baselines; the new PostgreSQL suite explicitly tests
the opted-in correction rather than rewriting migration history.

## Rollback limits

A failed migration rolls its DDL back atomically. A failed lock rolls snapshot,
metadata and audit writes back together. Check state after ambiguous responses
before retrying. Before freezing, approved rule/schedule edits can be reversed
through the same scoped Board workflow only after rechecking no freeze, no
snapshot and no vote history.

After a successful lock, no supported unlock, snapshot rebuild, rule edit or
voting-schedule rollback exists. Do not restore the old function definitions to
evade the locked policy, clear metadata or delete history. Any post-lock
incident requires a separate reviewed integrity response.

## Files

- Proposed migration listed above.
- src/utils/eligibilityRuleManagement.js.
- src/pages/board/EligibilityRules.jsx.
- tests/eligibilityRuleManagement.test.mjs.
- tests/fixtures/election3ElectorateProductionContract.json.
- tests/fixtures/election3ElectorateRules.sql.
- scripts/kandid-election-3-eligibility-pg17.mjs.
- Updated read-only validation SQL and recovery documentation.

All production data, configuration, rule values and voting timestamps remain
unchanged. No migration, deployment, lock, vote submission, staging, commit,
push, archive operation or student academic-record change was performed.
