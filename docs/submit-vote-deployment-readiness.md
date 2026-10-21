# Missing submit-vote: investigation and restoration readiness

**Follow-up:** [Prepared voting backend corrections and staged recovery](voting-backend-recovery-prepared.md)
contains the subsequent local fixes, runtime results and approval gates. This
document preserves the initial investigation; its unresolved lifecycle/position
findings and original deployment ordering are superseded by that follow-up.

Project: `fszgdxqxonqqcrzsnkca`. Workspace: `kandid-clean` only.
Investigated 20 October 2026. Last database preflight: **20:19:29 Manila**.
Status: investigation complete; **production restoration is not approved or ready to execute**.

## Cause and evidence

`submit-vote` is genuinely absent from the official project's deployed Edge
Functions. This is not just an incomplete inventory listing:

1. Both the Supabase connector and Supabase CLI list the same 10 functions.
2. Retrieval of deployed source for `submit-vote` returns NotFound.
3. An unauthenticated, nonmutating OPTIONS request to
   `https://fszgdxqxonqqcrzsnkca.supabase.co/functions/v1/submit-vote`
   returns HTTP 404, `NOT_FOUND`, "Requested function was not found".
   The same check against deployed `vote-access` returns 204.
4. All 10 deployed bundles were retrieved and inspected for alternate writer
   and ballot-worker entry points. None implements the `selected_votes` /
   `insert_v2_vote_rows` submission contract or a `claim_next_ballot_anchor`
   worker. `vote-access` offers read-only student receipt access; it is not a
   differently named submission function.
5. `src/utils/voting.js` explicitly calls `/functions/v1/submit-vote` with the
   authenticated student's bearer token and API key. No alternate production
   submission URL is configured in that workflow.

The deployed inventory is:

| Slug | Version | JWT verification |
| --- | ---: | --- |
| admin-user-management | 9 | enabled |
| vote-access | 10 | enabled |
| board-manual-enrollment | 14 | enabled |
| resolve-student-login | 6 | disabled, by its existing login contract |
| link-student-identity | 5 | enabled |
| student-profile | 6 | enabled |
| student-notifications | 4 | enabled |
| manage-election-removal | 3 | enabled |
| officers-contract | 2 | enabled |
| organization-eligibility | 2 | enabled |

**Additional absent dependencies:** `get-student-ballot-receipt` and
`anchor-ballot-hashes` also return the gateway's function-not-found 404 and
are absent from both inventories. No deployed alias was identified.

The exact present failure is missing server deployment while the client and
repository expect these functions. The historical reason (never deployed,
deleted, or omitted during a selective release) is **not established** by
current inventory, source, or gateway evidence. A deployment/audit history
from the project owner would be needed to attribute that event. The local
source's checkpoint history does not prove a production deployment. The
inspected package/scripts contain no automatic Edge deployment hook; a Vite
build or a `config.toml` entry does not establish a deployed function.

Restoring the endpoint alone will not restore Election 3 voting: its electorate
is still unfrozen and its voting window has elapsed. Those safeguards must
continue rejecting submissions until the separately reviewed recovery is
approved and completed.

## Source, dependencies and authentication

Relevant existing files, unchanged during this investigation:

- `supabase/functions/submit-vote/index.ts`.
- `supabase/functions/get-student-ballot-receipt/index.ts`.
- `supabase/functions/anchor-ballot-hashes/index.ts`.
- `_shared/kandidProductionSecurity.mjs`, `ballotSelection.js`,
  `currentTermEnrollment.js` and `geofence.js` under `supabase/functions`.
- `supabase/config.toml`, `src/utils/voting.js`,
  `src/pages/student/receiptData.js`, `contracts/KandidVoteRegistry.sol`.

The three function entries explicitly retain `verify_jwt = true`. They use
the standard `functions/<slug>/index.ts` entry points. The inspected function
directories have no separate Deno import map or dependency lock. They import
`https://esm.sh/@supabase/supabase-js@2`; the worker additionally imports
`https://esm.sh/ethers@6`. These remote major-version imports are not frozen by
the frontend's npm lockfile. Before release, resolve, pin and review the Edge
dependencies and run Deno/runtime checks on the exact deployable bundle.
The local mock tests transpile TypeScript and replace imports; they do not
prove remote dependency resolution or production runtime startup.

The submission and receipt handlers are POST-only, enforce the existing
origin policy and call `auth.getUser()` with the supplied Authorization header.
The allowed origins include the official website and existing local development
origins. A JWT-derived active student mapping is required; body `student_id`
cannot select another voter. The service key remains on the server. No new
browser access to student or vote tables is needed. CORS is not authorization.

The worker is POST-only and requires the server-only `x-anchor-worker-token`
in addition to gateway JWT verification. The submitter's background request
uses the existing anonymous JWT key plus that worker token. Preserve this
contract; do not disable JWT verification, expose the worker token, rotate
keys, or switch authentication models as a deployment workaround. Verify
existing runtime key compatibility during the approved preflight.

## Secret-name inspection

Only names were inspected, never values or digests.

| Required name | Submission | Receipt | Worker | Project metadata |
| --- | --- | --- | --- | --- |
| SUPABASE_URL | required | required | required | present |
| SUPABASE_ANON_KEY | required | required | background gateway credential | present |
| SUPABASE_SERVICE_ROLE_KEY | required | required | required | present |
| ANCHOR_WORKER_TOKEN | background nudge | no | required | absent |
| SEPOLIA_RPC_URL | no | no | required | absent |
| DEPLOYER_PRIVATE_KEY | no | no | required | absent |
| VOTE_REGISTRY_ADDRESS | no | no | required | absent |

The worker's legacy fallback `VITE_VOTE_REGISTRY_ADDRESS` is also absent from
the project secret-name inventory. Prefer its server-side name for recovery.
Never place a signing key, service key or worker token in a `VITE_` variable.
Presence of the base names does not verify their values, signing algorithm,
currency, or runtime compatibility. No credential validity is claimed.

## Integrity contract verified

| Requirement | Evidence and limits |
| --- | --- |
| One ballot per student/election | Live service-only `insert_v2_vote_rows(integer,integer,jsonb)` obtains a transaction advisory lock for that pair, rejects existing vote rows, and atomically writes one ballot with its rows. A repeated call and simultaneous calls were tested locally against the inspected SQL: one complete ballot commits. The ballot pair index is not unique; this guarantee depends on retaining the trusted RPC. |
| Student eligibility | Submission verifies the active JWT-linked student; policy 1 requires exactly one active academic term matching the election, current enrolled status and canonical organization participation, then the service-only electorate membership RPC. The pending Election-3-only program/year correction remains a separate unapplied dependency; current membership does not consistently enforce stored program/year rules. |
| Frozen electorate | Handler rejects a null freeze; live enabled ballot-insert trigger independently requires a policy-1 freeze and snapshot membership. Policy 0 retains its established compatibility branch. No downgrade is proposed. |
| Time and access restrictions | Handler uses Manila wall-clock voting boundaries and existing QR scope/expiration or geofence validation. Closed, future and ended cases deny insertion in local tests. The legacy `done` exception below must be fixed before activation. |
| Ballot validation | Existing complete-position, max-selection, duplicate-candidate, candidate/position/election and abstain checks run before insertion. Inactive-position and multi-selection limitations are listed below. |
| Atomic receipt material | SQL generates server-side timestamp, UUID and independent random 32-byte ballot/row nonces. Local independent SHA256 reconstruction matches `KANDID_VOTE_V2` rows and ordered `KANDID_BALLOT_V1`. A failure after the first choice rolls back the entire ballot and rows. No hash-format change is needed. |
| Receipt privacy | Submission returns canonical timestamp, count and ballot reference. The receipt function derives ownership from Auth and returns verification metadata without identity, choices or nonces. Foreign ballot access returns no ballot. Existing `vote-access` receipt rows cannot replace the absent Ballot V1 enrichment endpoint. |
| Database boundary | Browser roles have no direct SELECT/INSERT/UPDATE/DELETE on votes or ballots and cannot execute insertion or worker RPCs. The service role has table SELECT, with mutation through trusted functions. Relevant definer owners and configured search paths were inspected; frozen and removed-election guards are enabled. |
| Anchoring | Successful SQL commit creates a pending ballot job and `ballot_grouped` vote rows, avoiding duplicate row anchoring. Only afterward does the submitter schedule the worker nudge. Missing configuration or failed nudge does not undo a recorded ballot and must not trigger a new vote submission. |

The live insertion function's inspected definition MD5 is
`6b99f18237fbe72cc96cf63c9f1cc8af`. Recheck definition, ACLs and triggers before
any release. All eight required worker RPCs already exist with service-only
execute access. `pgcrypto` 1.3 is installed in `extensions`. Merely deploying
these functions requires no new vote schema, grant/RLS change or migration.
The separate eligibility repair still requires its own explicit approval.

### Anchoring behavior and limits

The existing worker checks Sepolia chain ID `11155111`, verifies signer equals
contract owner, checks funds, acquires a 120-second signer lease, claims at most
one new ballot per run, sends its Ballot V1 hash, persists the transaction hash
before waiting for confirmation, and reconciles submitted transactions. An
already-recorded hash or failed transaction-hash persistence takes the manual
review path. The contract restricts recording to its owner and rejects empty
or duplicate hashes. No contract deployment/change is proposed.

Local mocks verified worker authorization, configuration/network/owner denial,
lease ordering/contention, submitted-before-success ordering, delayed
confirmation, reconciliation, duplicate-hash handling and manual review after
persistence failure. These tests never sign or broadcast a transaction.

Remaining chain preflight: securely verify the intended RPC, chain, deployed
contract code/address, owner, signer and balance using read-only calls. The
existing submitted-transaction reconciliation trusts a successful receipt for
the stored transaction ID; it does not independently verify the registry event
and hash there. Review that evidence limitation and test the exact contract
flow locally before claiming full chain verification. No live chain or
production end-to-end anchoring success is claimed here.

There is **one existing pending ballot outside Election 3**. The worker's
claim functions use the global queue. Restoring/invoking it can process that
existing record; request explicit approval for this effect before activation.
Neither its choices nor private hash material were read. Database cron is not
installed (`cron.job` absent); an external scheduler has not been established.
One best-effort submission nudge cannot guarantee later confirmation/retry,
so an approved authenticated retry/reconciliation operation is also required.

## Source findings to resolve before writer activation

1. **Election lifecycle guard:** `getElectionPhase` handles draft/archived/closed,
   but an election marked `done` falls through to dates. With a legacy policy-0
   election inside its stored interval, a local handler execution reaches the
   insertion RPC and returns success. Require the established voting-enabled
   state as well as a valid interval; add negative tests for `done` and all
   unsupported states. Preserve campaign, future/end and removed-election
   protections. This defect is independent of Election 3's missing endpoint.
2. **Position consistency:** submission loads every election position, whereas
   ballot display uses active positions. A retired position can make a valid
   visible ballot appear incomplete. Align the writer with the existing active
   ballot-position contract, including candidate checks and empty-position
   behavior. Add regressions. Production currently has zero nonactive positions.
3. **Selection cardinality limitation:** handler supports `max_votes > 1`, but
   the live `UNIQUE(student_id,position_id)` constraint permits only one row per
   position. The local SQL replay confirms atomic rejection of two candidates
   for a position. All current production positions have `max_votes=1`, including
   Election 3. Preserve this schema and hashes; require a preflight that no
   unsupported position exists. Broader multi-selection support requires a
   separate approved integrity/schema change.
4. **Reproducible/runtime release check:** pin/review the remote Edge imports,
   validate the actual Deno bundle, and review the worker reconciliation evidence
   described above. Node mock success is not a Deno deployment check.

No handler, frontend submission contract, authentication setting, grant, RLS,
hash implementation or worker source was changed during this investigation.
The first two findings are captured as characterization tests, not represented
as corrected regressions. Prepare and review their scoped fixes before any
deployment authorization.

## Production state and Election 3 sequencing

At the last read-only check, Election 3 remained active, organization 2, term 1,
policy 1, null freeze, zero snapshot members, zero ballots and zero vote rows.
Its saved voting interval remains 20 October 10:00-20:00 Manila. Active policy-1
elections with null freeze: **2, IDs [3, 4]** (one other election: ID 4).

The previously proposed 20 October 20:00 start is past. The prior recovery
proposal of **21 October 08:00 to 22 October 10:00 Manila** is still only a
proposal and must be rechecked against current time before approval.
Nothing about the endpoint investigation approves that schedule.

After separate approvals, retain the documented sequence: apply only the
reviewed scoped eligibility correction, change Election 3's BSIT rule from
Years 2-4 to Years 1-4 through Board management, save the approved future window,
refresh the official preview and require exactly the two active authenticated
enrolled organization members, lock through the official RPC strictly before
start, then validate authorized candidate loading during the voting window.
Do not change student records, manually populate the snapshot, set freeze
metadata, downgrade policy or apply the October 21 migration.

## Approval-gated deployment and validation plan

1. Prepare the scoped lifecycle/position fixes and regression tests above,
   reviewed dependency versions, Deno bundle check and a source hash manifest.
   Recheck live SQL fingerprints, privileges, triggers, queue counts and
   deployment inventory. Scope approval to that exact artifact and project.
2. Obtain explicit approval for each function deployment, missing secret
   provisioning, processing the existing global pending ballot, the chosen
   retry/reconciliation mechanism, and separately every Election 3 rule,
   schedule, migration and electorate-lock action. Obtain secret values through
   the approved secure manager, never chat or browser variables. No key rotation
   or Auth configuration change is part of this plan.
3. Perform read-only chain preflight and local contract integration checks.
   If settings/owner/code/network/funds or backlog authorization are unresolved,
   stop before worker/writer activation. Do not call the production worker as a
   health probe: it claims jobs and can send transactions.
4. Following approval, deploy the receipt reader first; validate its Auth,
   ownership and response privacy with an authorized real session and no vote
   submission. Next restore the worker only with its configuration and queue
   approval in place. Deploy `submit-vote` last, after all activation blockers
   and eligibility prerequisites are satisfied. Each deploy activates a
   project-wide endpoint immediately; there is no existing Election-3-only
   switch or staged writer activation to rely on.

   Exact intended commands, **documentation only, not executed**:

   ```powershell
   .\node_modules\.bin\supabase.cmd functions deploy get-student-ballot-receipt --project-ref fszgdxqxonqqcrzsnkca --use-api
   .\node_modules\.bin\supabase.cmd functions deploy anchor-ballot-hashes --project-ref fszgdxqxonqqcrzsnkca --use-api
   .\node_modules\.bin\supabase.cmd functions deploy submit-vote --project-ref fszgdxqxonqqcrzsnkca --use-api
   ```

   Recheck CLI/config behavior against the approved artifact. Always name the
   one function; do not deploy every directory, prune functions or use
   `--no-verify-jwt`. Do not deploy the legacy row worker as a substitute.
5. After each deployment verify exact slug/version, approved bundle/config
   and `verify_jwt=true`. Check gateway routing and allowed/disallowed CORS;
   invalid/missing JWT must be denied on protected POST routes. OPTIONS alone
   proves routing, not authorization or vote success. Recheck database counts
   and unchanged Election 3 state. Use receipt/candidate/membership reads with
   legitimate authorized sessions for live checks; never forge identities.
6. A valid production ballot POST and any worker invocation require separate
   explicit approval. Without these, report the writer as deployed/checked to
   the stated limits, never as a proven successful production vote/anchor.
   If a later approved vote produces an ambiguous timeout, first use the trusted
   voted-status and owned receipt reads; never resubmit or fabricate a ballot.

### Rollback and stopping criteria

Any drift in function owners/ACLs, unexpected data, electorate counts, unsupported
positions, chain settings or scope stops activation. Partial restoration can
leave only the read-only receipt reader available while writer activation is
held. Deployment failures must not prompt migrations or security relaxation.

There is no prior deployed writer/receipt/worker version in the current
inventory to roll back to. Agree on and authorize an endpoint containment or
removal operation before activation; do not assume an old version exists.
For an incident after activation, stop further writer/worker requests using the
approved management control and preserve all recorded ballots and queue state.
Do not delete votes, reset voted status, clear nonces/hashes or reopen a frozen
electorate. A chain transaction cannot be rolled back; reconcile its receipt
before retrying. A committed vote remains valid if anchoring is delayed. Any
function/config rollback and any containment production action need approval.

## Validation and local changes

- `node --test tests/submitVoteReadiness.test.mjs tests/ballotAnchorReadiness.test.mjs tests/submitVoteCurrentTermEnrollment.test.mjs tests/voteSecurityContract.test.mjs tests/electionElectorate.test.mjs`
  — **55 passed, 0 failed**, including characterization of the two unresolved
  handler findings. Mock tests do not establish deployed runtime or live chain
  success.
- `node scripts/kandid-submit-vote-integrity-pg17.mjs` — **8 checks passed**
  against PostgreSQL 17.6 in the verified existing local test container. A unique
  synthetic database was created and dropped; no production connection used.
- `supabase/runtime-validation/submit-vote-readiness-readonly.sql` — executed
  read-only against the official project; results summarized above. Queries
  return only counts and configuration/function metadata, never vote choices.
- `node --check scripts/kandid-submit-vote-integrity-pg17.mjs` and
  `git diff --check` — passed. Inspected submission, receipt, worker, config,
  client and contract source files have no changes from this investigation.
- New local artifacts: this report, those two mock suites, the local PostgreSQL
  runner, `tests/fixtures/submitVoteIntegrityProductionContract.json` (schema and
  function definitions only), and the SELECT-only validation file. The earlier
  Election 3 recovery document is cross-linked to this report.

No production write, migration, deployment, secret/config change, election
edit, lock, real vote, worker invocation or blockchain transaction was performed.
Earlier prepared recovery source/migration changes remain unapplied. No build
was rerun for this docs/tests-only investigation; the earlier recovery build
result remains historical.
