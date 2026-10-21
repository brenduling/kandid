# Automatic voter eligibility — local proposal

Status: prepared locally; **no production SQL, deployment, flag activation or test vote authorized/executed**.
Official project: `fszgdxqxonqqcrzsnkca`.

## Confirmed Election 5 diagnosis

Read-only production check, October 22, 2026 at 04:58:42 Manila:

- Organization 2, academic term 1 (the only active term), status active, not removed.
- Voting 04:45–05:30 Manila; campaign ends at 04:45.
- Policy version 1, `electorate_frozen_at IS NULL`, zero snapshot members.
- Zero ballots and zero vote rows. No vote choices were queried.
- No optional eligibility rules. Three active, Auth-linked, email-confirmed term-enrolled organization members qualify under the base criteria.
- Two active positions: Chairman (two registered candidates), President (no candidates).
- Chairman candidates have draft **campaign content**. There is no candidate-active column. The current deployed ballot RPC includes registered candidates of active positions independently of campaign publication. Preserve this exact payload/selection behavior; do not apply the unrelated broad publication migration. President retains abstention.

The deployed candidate RPC raises `42501 / Ballot choices are unavailable` when policy 1 lacks the freeze/snapshot. This condition alone is sufficient to explain the reported 403 during the voting window; it is not a public-candidate SELECT grant problem. No authenticated student RPC or real submission was invoked during this investigation.

The schedule remains binding. After 05:30 Manila, Election 5 must reject voting even after this release. This proposal does not extend or reopen its schedule.

## All located lock dependencies

| Layer | Existing dependency | Proposed treatment |
| --- | --- | --- |
| Student `VotePage` | `loadStudentBallotCandidates` returns BALLOT_UNFINALIZED before RPC for unfrozen policy 1 | Always call the authenticated candidate RPC; metadata cannot authorize or block a student |
| Student/kiosk availability | `readStudentBallotAccess`, direct kiosk candidate RPC | Continue using the same server candidate RPC; no bypass/fallback |
| Candidate RPC | Frozen timestamp, term enrollment and private snapshot member required | Replace admission decision with caller-bound live eligibility + live voting phase |
| `submit-vote` v2 | Policy 1 frozen timestamp and service-only `kandid_is_locked_electorate_member`; policy 0 separate membership path | Replace both eligibility branches with the student's JWT `kandid_check_student_ballot_eligibility`; keep Auth.getUser, QR/geofence, active positions and selection checks |
| Atomic DB insertion | `vote_ballots_require_locked_electorate` BEFORE INSERT invokes private frozen guard | Keep trigger attachment and private ownership; replace decision with canonical live eligibility and voting phase |
| Atomic RPC | Service-only `insert_v2_vote_rows` assumes choices validated by Edge | Preserve signature, grants, advisory lock, duplicates, entire hash/nonce/receipt body; add authoritative live recheck/row locks and active ballot validation before writing |
| Board create/edit | Scheduled-finalization readiness assertion and electorate panel from earlier local work | After new release gate is enabled, neither runs or appears; no new Board workflow |
| Development submission | Only Election 4 transport/submit switch | New default-off coordinated release gate admits JWT-only submission/owned receipts for other elections; does not admit worker, direct table writes or lock RPCs |
| Existing snapshot/election guards | Frozen membership, organization, term and schedule immutability | Unchanged; snapshots are retained as history and no longer admission prerequisites |
| Existing freeze RPCs | Lock, preview and Election-4-only recovery | Lock/recovery routines left untouched and unused by new flow. Preview becomes organization-scoped live aggregate with `lock_required=false` |
| Turnout reports/history protection | Frozen denominator helper, candidate history guards, deletion dependencies | Left intact. Unfrozen turnout percentage remains unavailable; historical frozen denominators must not be interpreted as the current live eligible population |

`kandid_is_locked_electorate_member` remains service-only for historical compatibility; it is no longer used by the new submission path. There are no freeze gates in the receipt endpoint or blockchain worker requiring removal.

## Canonical definition and security

`private.kandid_student_is_live_eligible(election,student)` checks:

1. Exactly one persistent student maps to the Auth identity; student status active.
2. Auth user exists, email confirmed, not deleted, banned or anonymous.
3. Election exists and is not removed, has the single active academic term.
4. Enrolled term record and active term organization participation through the existing membership resolver.
5. No rules: membership/enrollment suffices. Rules present: OR across applicable rules, AND within each program/year/SHS restriction. Term enrollment supplies academic attributes. Null program/bounds remain wildcards; SHS requires `allow_shs=true` when rules exist.

Separate private `kandid_voting_is_open` enforces active status, valid Manila voting interval `[start,end)`, and campaign completion. The public boolean check accepts **only election ID**, resolves `auth.uid()` internally, and exposes no student information.

New helpers are owner postgres, pinned `search_path=pg_catalog`, and not executable by anon/authenticated/service_role. Only existing authorized wrappers invoke them. The new public check grants EXECUTE only to authenticated; insertion remains service-only. Existing RLS, table grants, trusted identity links and Auth settings are unchanged. This follows the explicit search-path and function-permission requirements in [Supabase's function documentation](https://supabase.com/docs/guides/database/functions).

Atomic insertion retains the student/election advisory lock, locks current eligibility inputs and the election until commit, then rechecks eligibility/time. Rule edits lock the same parent election, preventing a rule insertion racing a submission. Rules cannot be moved across elections or changed after a snapshot freeze or recorded vote. No snapshot is created on first access or first vote. Hash generation, nonces, grouped-row anchoring statuses, receipt reference and background nudge are unchanged.

The new model intentionally admits eligible late enrollments and ignores historical snapshot membership for admission, including previously frozen elections. Live revocations take effect for subsequent submissions. Existing votes remain counted and unchanged. This is the owner's requested behavioral change, not an authorization fallback.

## Files and validation

See `automatic-voter-eligibility-manifest.json` for exact artifact hashes and file scope.

- Guarded forward SQL: `supabase/proposals/automatic-voter-eligibility.sql`.
- Canonical source: `.core.sql`; deterministic package generator: `scripts/prepare-automatic-voter-eligibility.mjs` (local filesystem only).
- Captured deployed function/Edge source: `tests/fixtures/automaticVoterEligibilityProductionContract.json`, containing code only, no student records or credentials.
- Rollback SQL: `.rollback.sql`, checks installed function bodies before restoring captured definitions.
- Local PostgreSQL runner: `scripts/kandid-automatic-eligibility-pg17.mjs`. Verifies the existing isolated container identity/port and creates a uniquely named synthetic database. Never accepts a production URL. Removes only its own database in `finally`.
- JS tests include mocked frontend, transport gates, actual Edge handler execution with synthetic clients, receipts, lifecycle, identity and source-integrity checks.

Runtime tests use minimal synthetic schema plus captured production ballot tables/constraints and inspected RPC definitions. They are not a full production schema clone or genuine signed-in browser verification. No real ballots, live Edge calls or blockchain transactions are used.

Final local validation, October 22, 2026:

- **148/148 targeted JavaScript tests passed** across automatic eligibility, submission, membership reconciliation, historical electorate contracts, student journey, lifecycle, receipt statuses and authorization.
- **39/39 isolated PostgreSQL 17 checks passed**, including reproduction of the original unfrozen denial, no-rule/optional-rule eligibility, Year 1, SHS, late enrollment, authorized preview, denied roles/organizations, inactive positions, candidate/abstain validation, hash reconstruction, duplicate/concurrent submissions, immutable historical snapshots and exact-source guarded rollback.
- `deno check --cached-only --no-config --no-lock supabase/functions/submit-vote/index.ts`: **PASS** (local Deno 2.9.6).
- Targeted ESLint and `git diff --check`: **PASS**. Production Vite/PWA build: **PASS**; plugin timing warning only.
- All three used shared Edge dependencies match captured production source after LF normalization.
- Local release flag is absent/disabled. No environment configuration was changed.
- Production read-only recheck at **05:12:15 Manila**: Election 5 still active, unfrozen, zero ballots and zero vote rows; unchanged 05:30 voting end.

## Separately approved execution order

1. Recompute manifest hashes. Re-read deployed submit-vote v2 source/config and relevant SQL definitions, privileges, trigger attachment and schema. Stop on drift. Recheck Election 5 schedule/state and counts without choices; do not reopen an expired election.
2. Keep `VITE_ENABLE_AUTOMATIC_VOTER_ELIGIBILITY` unset/false. Existing Election-4-only flag is unchanged. No local environment file changes are part of this preparation.
3. With explicit SQL approval, apply **only** the forward proposal in one transaction. Its four function baselines plus existing participation resolver must match exactly and be postgres-owned; insertion must remain service-only and trigger enabled. Never use `db push --include-all`.
4. Verify helpers, privileges, enabled trigger, unchanged RLS/table grants, snapshots, election rows and existing ballot aggregates. Authenticated/nonmember checks require separate approval/signed-in sessions; do not cast synthetic production votes.
5. With explicit Edge deployment approval, deploy **only submit-vote**, using reviewed source/dependencies and `verify_jwt=true`. Preserve all secrets. Do not deploy worker or receipt endpoints. Old Edge remains fail-closed for unfrozen elections during the SQL-to-Edge transition.
6. Verify deployed source/config and unchanged unrelated Edge Functions, then separately enable the **local** release flag and restart Vite. Frontend publication/production environment activation requires its own approval. No Board lock/finalization action is needed.
7. During a still-open authorized election, a genuine eligible session should load the two registered Chairman candidates and abstain options. Ineligible sessions must receive a denial. Submission readiness can be checked from source and isolated tests; a real vote requires the student's deliberate action. Verify its receipt remains recorded/pending until trusted anchored evidence exists; duplicate submission must be rejected.

## Rollback and limits

- Disable the new frontend release flag and stop new submissions under an approved containment plan before rollback. A frontend flag is not a production authorization control.
- Compare installed bodies with the rollback guard; stop on drift. Apply only `.rollback.sql` with explicit approval, restore captured submit-vote v2 source (all five captured files) and verify JWT configuration. Do not alter receipt/worker deployments.
- Rollback restores the mandatory frozen-roster behavior and can block new access for unfrozen elections. **It cannot undo legitimately committed ballots and must not delete them or fabricate snapshots.** Existing hashes/receipts/blockchain jobs remain intact.
- Separate review is needed before changing turnout denominator semantics. Existing reports correctly return unavailable for an unfrozen denominator; this proposal does not invent a fixed historical denominator for a changing live population.
- Existing database uniqueness for one student/position remains unchanged; no multi-seat voting redesign is included.
- No production approval is requested until local validation and artifact review finish. No changes to Cron, queues, receipts, blockchain, election dates, electorate fields, student records or production settings are included.
