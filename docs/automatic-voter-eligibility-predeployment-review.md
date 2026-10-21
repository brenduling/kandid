# Automatic voter eligibility — production approval review

Reviewed October 22, 2026. Scope: read-only production metadata/source checks, local source inspection, manifest verification and local JavaScript tests. No production SQL changes, Edge deployments, release-flag changes, live ballot requests or transactions were performed. No reviewed artifact or manifest was changed.

## Recommendation

**GO for requesting narrowly scoped backend deployment approval**, followed by verified local frontend activation. **NO-GO for voting in Election 5 under its existing schedule**: its voting window has expired. Deployment must not reopen or extend it.

## Artifact integrity

All **25 revision-1 manifest artifacts match both their raw and LF-normalized SHA-256 hashes**.

| Deployment artifact | Raw SHA-256 |
| --- | --- |
| `supabase/proposals/automatic-voter-eligibility.sql` | `2d70f573ac97f43260e73f1b6cd0d789c21ed40bfa3c09b80d84062709b3b855` |
| `supabase/proposals/automatic-voter-eligibility.rollback.sql` | `67630d5fdb996fab37627426004cfa20b48cdbd2edda3b00372231323df23013` |
| `supabase/functions/submit-vote/index.ts` | `4f7e75a219ec85ccc329c2bc5d3a500cb61706b74bbad9b4b8985bab490bc867` |

The Edge entrypoint LF-normalized hash is `3d07693dd9437f387f812f2f975dc712d011deeae81e2f50fc434a7747990d9a`. Frontend and three used shared-module hashes are recorded individually in `automatic-voter-eligibility-manifest.json`. Deploy only that entrypoint and its three reviewed local shared modules, with the existing pinned Supabase SDK import; do not include unrelated functions or implicitly deploy the repository. The captured previous package contains the original five files for rollback.

Production `submit-vote` remains **ACTIVE v2, verify_jwt=true**. All five deployed files match the captured production source exactly. All six captured SQL definitions match production exactly, including the four forward replacements and both retained frozen-snapshot guards. The existing organization-participation resolver also matches exactly. Owners remain postgres. New automatic-eligibility functions are not installed.

The inspected SQL baseline guards would pass: exact definitions/owners match, the ballot BEFORE INSERT trigger is enabled and invokes the expected private function, and atomic insertion grants EXECUTE only to postgres/service_role. The actual migration guards were not executed in production.

## Existing-record and authorization safety

- Forward SQL is one transaction containing narrowly scoped routine/trigger changes. There are **no election, enrollment, snapshot, ballot, vote or receipt record updates performed by installation**. INSERT/UPDATE statements inside the preserved insertion function execute only on later legitimate submissions.
- Existing RLS, table grants, unique constraints and snapshot-immutability routines remain in place. Production confirms RLS on candidates/votes/ballots; anon/authenticated cannot directly insert ballots or vote rows and have no general table SELECT grant on those tables. Candidate administrator mutation grants remain subject to existing RLS.
- Live eligibility requires the JWT-linked active student, unique identity mapping, verified non-anonymous/non-banned Auth identity, election academic-term enrollment and active organization membership. Optional program/year/SHS rules further restrict eligibility; no rules means the normal organization/enrollment requirements.
- No frozen timestamp or roster membership is required by the new candidate/submission admission path. Existing snapshots and frozen schedules remain immutable history; they are not deleted or rebuilt.
- The database rechecks live eligibility and the active Manila voting interval during atomic submission. Closed/expired/removed elections, inactive positions, foreign candidates, incomplete ballots and invalid abstentions remain denied.
- The student/election advisory lock and existing vote duplicate guard serialize duplicate submissions. Existing uniqueness constraints remain unchanged. Rule edits serialize with submission and cannot alter an election after a snapshot freeze or recorded vote.
- The canonical Ballot V1/Vote V2 hash and nonce implementation is preserved exactly. Existing receipts and blockchain exclusion/lease/retry/anchoring code are untouched. The submitter still returns the committed receipt reference before independent blockchain confirmation, and preserves its existing background nudge. Genuine submissions may therefore trigger anchoring under existing production behavior; this review did not invoke it.

## Rollout compatibility and exact approval scope

1. Immediately before any approved mutation, repeat manifest and production baseline checks. Stop on drift. Reconfirm the official project, function inventory, row aggregates and election schedules. There are currently zero elections inside an active voting window.
2. Keep the new release flag disabled. With explicit SQL approval, apply **only** `automatic-voter-eligibility.sql`, atomically. Do not use a broad migration push. Verify routine grants/owners, trigger attachment, unchanged row fingerprints and RLS.
3. With explicit Edge approval, deploy **only submit-vote**, using the manifest-reviewed entrypoint/shared modules and **verify_jwt=true**. Preserve secrets, worker, receipt endpoint and unrelated functions. Verify deployed source, status/configuration and unchanged unrelated inventory before proceeding.
4. With explicit local activation approval, set only `VITE_ENABLE_AUTOMATIC_VOTER_ELIGIBILITY=true` in ignored local development configuration and restart Vite. It is currently false/unset, and localhost still targets the official project. Verify the Board no longer requires finalization and the student path uses the JWT-authorized candidate RPC. Frontend publication/Vercel activation is a separate action and is not included.
5. Live acceptance of candidate access requires a genuine authorized session during a valid voting window and separate authorization for those checks. Do not change Election 5's schedule to obtain such a window. No synthetic production vote is needed or permitted. A future legitimate ballot must be the student's deliberate action.

Temporary compatibility boundaries:

- **New SQL + old Edge:** eligible candidate access can succeed without a snapshot, but old submit-vote still rejects unfrozen policy-1 elections. The new database predicate enforces optional rules even when the old Edge does not; this is an availability mismatch, not an authorization bypass.
- **New Edge + old SQL:** the new JWT eligibility RPC is absent, so submission fails closed with HTTP 503. Do not use this order.
- **Old frontend + new backend:** old/local gates and Board finalization controls can still block the intended workflow; complete the separately approved frontend activation after backend verification.
- The frontend release flag is **not a backend feature switch or security control**. Installing SQL changes server-side authorization semantics immediately; a disabled frontend flag does not disable direct authenticated RPC access or reverse that change.

## Rollback

The exact-source SQL rollback passed the prior isolated PostgreSQL tests against these identical artifacts. Its installed-body guards stop on source drift. The rollback restores four captured SQL routines, removes only the newly added rule trigger/helpers, and performs no record deletion or rewriting. No CASCADE is used; an unexpected dependency causes transaction failure rather than removal of unrelated objects.

Rollback requires explicit approval and a controlled submission pause. Restore the captured Edge package and guarded SQL with source/configuration verification. If the SQL is reverted while new Edge code is still deployed, its missing eligibility RPC causes a fail-closed 503 until Edge restoration. Previously unfrozen elections will again be blocked by the old frozen-roster policy. Never create snapshots or delete legitimate votes to make rollback appear seamless. Committed ballots, hashes, receipts and any independently started blockchain processing cannot be undone by this source rollback.

## Election 5 — current read-only evidence

At **2026-10-22 09:08:05 Asia/Manila**:

- Stored status: active; not removed. Effective voting state: **closed by schedule**.
- Campaign: October 22, 04:31–04:45 Manila.
- Voting: October 22, **04:45–05:30 Manila**; `in_voting_window=false`.
- Organization 2; academic term 1; policy 1; freeze timestamp null.
- Zero rules, zero snapshot members, **zero ballots and zero vote rows**.

The code change does not make this expired election votable. No date/state changes are part of the requested approval. Read-only global aggregates were 2 ballots, 2 vote rows and 4 snapshot memberships; no choices or identities were read.

## Historical turnout limitation

This affects **reporting only**, not eligibility, candidate authorization, ballot validation, recorded vote counting, receipts or anchoring:

- Unfrozen elections retain an unavailable eligible-voter denominator and turnout percentage in the existing turnout RPC. Actual distinct ballot participants and ballot counts are still computed from recorded ballots independently of anchoring status.
- Existing frozen elections retain the original snapshot denominator. Under live eligibility, later eligible students may vote without belonging to that historical snapshot. Its percentage/“authoritative” label can therefore cease to describe the current eligible population and may exceed 100%. Treat it as a historical-snapshot metric, not live turnout.
- Historical ballots/snapshots must not be modified to repair this reporting semantic. A separately reviewed reporting change is needed to define an honest dynamic denominator or clearly label unavailable/historical percentages. This is not a voting-security deployment blocker, but stakeholders must not use those percentages as live turnout under the new model.

## Validation evidence and limits

- **148/148 targeted JavaScript tests rerun and passed during this review**, including artifact hashes, eligible/unfrozen access, denied identity/organization states, release gates, optional rules, lifecycle, submission, receipt ownership/status and blockchain independence.
- **39/39 prior isolated PostgreSQL 17 checks passed against the identical hash-verified SQL**: original denial reproduction, eligibility/rules/Year 1/SHS, late enrollment, role/organization denial, atomic rejection, candidate/abstain success, independent hash reconstruction, concurrent duplicates, immutable history and exact rollback.
- Prior Deno type check, lint and production build remain applicable because the reviewed artifacts are unchanged. No new build or dependency change was introduced in this preflight.
- No genuine signed-in production ballot flow was exercised. Production success must not be claimed before approved deployment and scoped post-deployment verification.

Approval requested: this hash-verified SQL proposal, only the reviewed submit-vote deployment with JWT verification, then local release-flag activation after backend checks. No election changes, test votes, worker/receipt deployment, Vercel publication, production secret changes or Git push are included.
