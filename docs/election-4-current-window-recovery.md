# Election 4 current-window recovery — prepared locally

Production project: `fszgdxqxonqqcrzsnkca`. Target client: existing localhost:5174.
No production changes, deployments, locks, or votes were executed during preparation.

## Confirmed blockers

- Production inventory and individual source lookups both confirm that
  `submit-vote` and `get-student-ballot-receipt` are absent. There is no alternate
  submission/receipt function in the inventory. `vote-access` v10 is deployed;
  its Student receipts and duplicate-check branches derive identity from Auth.
- `insert_v2_vote_rows(integer,integer,jsonb)` is deployed, service-role-only,
  definition MD5 `6b99f18237fbe72cc96cf63c9f1cc8af`. It commits the ballot,
  vote rows and hashes in one transaction and serializes duplicate submissions.
- At 21 October 2026, 06:02:30 Manila: Election 4 was active, organization 2,
  term 1 (the single active term), policy 1, unfrozen, zero snapshot/ballot/vote
  rows, zero additional eligibility rules, two qualifying active linked members,
  one active position and two candidates. A subsequent aggregate check confirmed
  both candidates are published and both qualifying memberships are active.
- Local submission and receipt transport is disabled until
  `VITE_ENABLE_ELECTION_4_RECOVERY=true`. This flag is **not set by this change**.
  It is a rollout switch, not authentication or authorization.
- Production native packaging, gateway JWT behavior and a fresh real session
  still require approved post-restoration nonwriting checks.

## Minimal prepared scope

`supabase/proposals/election-4-current-window-recovery.sql` installs only
`public.kandid_recover_election4_electorate()`; installation performs no record
mutation. It requires a real authenticated organization-2 Board session at use.
It hard-codes election 4, term 1, policy 1 and the unchanged voting schedule:
**21 October 2026, 01:00–22:00 Asia/Manila**. It expires at that existing cutoff.

The operation locks the election row, requires an empty snapshot and zero
ballot/vote rows inside the transaction, checks the existing ballot trigger,
derives exactly two active Auth-linked enrolled organization members, inserts
the private snapshot, sets the freeze through the existing trusted trigger,
and appends the existing `election_electorate_locked` audit event with explicit
one-time recovery metadata and pre-recovery counts. Any error, wrong count,
changed baseline, audit failure or crossed cutoff rolls everything back.
Replays and competing recovery operations cannot create another snapshot/audit.

The snapshot and freeze become visible together. While recovery is uncommitted,
the existing policy-v1 ballot trigger rejects submissions. Normal finalization,
candidate/student authorization, RLS, immutable snapshots, duplicate guards,
hashes, blockchain worker and receipt contracts are unchanged.

The local source edits allow an explicitly enabled Election 4 submission,
Election 4 owned receipt enrichment and the argument-free recovery RPC through
the development transport. The existing owned receipt-list read accepts no
client identity. Other election submissions, direct vote/snapshot writes and
worker requests remain denied. The Board panel no longer advises rescheduling
Election 4 and retains the normal lock's deadline restriction.

Restore only the two existing reviewed Edge Function artifacts, with
`verify_jwt=true`, their pinned SDK, deno config/lock and reviewed shared files.
All 14 backend/config hashes still match
`docs/voting-backend-recovery-manifest.json`. No insertion RPC replacement,
new server secret, worker activation, schedule change or eligibility edit is
required. The worker is absent; Election 2's single pending ballot stays pending.
New ballots likewise remain `pending`; a transaction ID alone never establishes
successful anchoring in the reviewed local receipt interface.

## Validation and limits

Run `node scripts/kandid-election4-current-window-validation.mjs` with access
to the verified local Docker test container. It creates/removes a disposable
PostgreSQL 17 database using synthetic records, actual inspected database
contracts, actual frontend submission/receipt helpers, both reviewed Edge
handlers and the inspected deployed `vote-access` receipt/duplicate branches.
Auth and Supabase HTTP transport are mocked; no real JWT or production request
is used. The deployed `vote-access` source captured during this investigation
is in `.tmp/election4-current-window/deployed-functions-vote-access-index.ts`.

The checks cover authorization, exactly-two enforcement, active membership,
zero ballot/vote/snapshot preconditions, immutable schedule/roster, audit
rollback, concurrent recovery, submission during uncommitted recovery,
candidate selection, abstention, SQL commit, duplicate rejection, ownership,
receipt retrieval and pending blockchain status. Separate canonical-hash and
concurrent-submission checks use `scripts/kandid-submit-vote-integrity-pg17.mjs`.

`node scripts/kandid-ballot-visibility-browser.mjs .tmp/election4-current-window`
uses actual localhost pages at 1280px and 375px with intercepted synthetic API
responses and Supabase DNS blocked. It tests candidate/abstention selection,
review and security states without submitting. The complete submission-to-SQL-
receipt flow is exercised by the integration harness, not by a real browser JWT.
The offline Edge checks boot only submission and receipt with external network
disabled. These checks cannot certify hosted deployment or a production vote.

## Production execution order — explicit approval required

1. Repeat read-only preflight immediately before acting: exact source/function
   hashes and JWT settings, required triggers enabled, existing schedule still
   open, active term 1, exactly two active linked enrolled members, zero Election
   4 snapshot/ballot/vote rows and zero rules. Stop on drift or expiry. Confirm
   the worker remains absent and Election 2's pending count is unchanged.
2. Restore `get-student-ballot-receipt` first, read back its source/dependencies
   and compare all reviewed hashes, then verify auth/CORS/ownership rejection
   without a write. Restore `submit-vote`, read back/compare its artifacts and
   `verify_jwt=true`; use malformed/unauthenticated requests only. A failing
   endpoint is not voting readiness. Do not change secrets or start a worker.
3. Install only the dedicated recovery SQL proposal after its hash preflight.
   Verify the new RPC is authenticated-only; existing RPCs/triggers/RLS remain
   unchanged. No normal lock RPC or October 21 architecture migration is used.
4. After backend verification, enable the local rollout flag and restart the
   existing localhost:5174 Vite process with its existing Supabase connection.
   From the actual signed-in organization-2 Board session invoke
   `supabase.rpc('kandid_recover_election4_electorate', {}).retry(false)` once.
   Never simulate a Board JWT in SQL or use a service key for this operation.
5. Verify read-only: snapshot=2; freeze/Board actor present; one recovery audit;
   original dates, policy, term and organization unchanged; zero ballots/votes.
   An eligible student's candidate RPC should return the two Chairman candidates;
   ineligible access must remain denied. Owned receipt lookup correctly returns
   no ballot before a genuine submission. Do not cast a production test vote.
6. Remove only the newly added recovery RPC after confirmed success if approved.
   Leave the local Election 4 voting switch enabled for ordinary authorized use
   during the existing period. Verify receipt/PWA client freshness if publishing
   the separately reviewed frontend scope is also requested and approved.

## Containment and rollback

Before successful recovery, a failed transaction leaves the snapshot/freeze/
audit unchanged. After an uncertain response, reconcile read-only before retry.
After successful recovery, never unfreeze/delete the snapshot, undo votes or
reschedule: the immutable admission decision is committed. Cleanup can drop
only the new recovery RPC and turn off the local rollout switch. Any removal
of newly restored endpoints needs the user's explicit containment approval;
it can interrupt availability but must preserve existing votes and receipts.
No automatic production action or approval is implied by passing local tests.
