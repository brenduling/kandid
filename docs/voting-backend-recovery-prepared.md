# Production voting backend recovery — prepared, not executed

Project `fszgdxqxonqqcrzsnkca`; workspace `kandid-clean` only.
Prepared 20 October 2026. This supersedes the activation blockers/sequence in
`submit-vote-deployment-readiness.md`; that report remains historical evidence.
Exact source/config hashes and observed deployed versions are recorded in
[`voting-backend-recovery-manifest.json`](voting-backend-recovery-manifest.json).
The inspected CLI is 2.117.0; no CLI upgrade is part of this release.

**Receipt frontend follow-up:** the scoped local correction and expanded review
manifest are described in `voting-backend-restoration-preflight.md`. The production
preflight stopped before either Edge deployment. The local receipt defect is now
corrected; a separately approved receipt-only frontend release must be verified
before resuming the conditional receipt-plus-submission restoration.

## Local corrections

`supabase/functions/submit-vote/index.ts` now:

- Requires `status='active'` before the date-derived voting phase. `done`,
  closed, archived, draft, unsupported and missing states cannot reopen through
  in-window dates. The Manila voting interval and campaign/access checks remain.
- Loads only the election's `status='active'` positions, matching the existing
  candidate RPC/ballot. Active positions still require a selection or abstention.
  Extra or substituted inactive positions, inactive candidates presented as
  active-position selections, omitted positions and empty active ballots fail.
- Retains JWT-derived identity, active student mapping, organization participation,
  current enrollment, frozen membership, service-only insertion, duplicate-vote
  protection, atomic hashes/receipts and the existing post-commit worker nudge.

The submission and receipt handlers also have explicit Request/normalized-row
types needed for strict Deno checks. The null candidate in an abstention remains
unchanged. No SQL/hash/nonce/receipt-payload contract changed.

The three function sources pin Supabase JS **2.104.1**; the worker pins ethers
**6.16.0**, matching inspected locally installed versions. Each has its own
`deno.json` and checked `deno.lock`, including public transitive integrity hashes.
The worker lock fixes Deno's implicit Node types at 22.5.4. No install scripts
were enabled. Other function sources/imports and project JWT settings are unchanged.
The worker's functional behavior is unchanged and it is not in the initial
deployment approval scope.

## Live read-only findings

### Deployment, Auth and secrets

The official inventory still contains the same 10 deployed functions/versions.
`submit-vote`, `get-student-ballot-receipt` and `anchor-ballot-hashes` are absent.
The prior independent CLI, bundle scans and function-not-found gateway responses
remain evidence of genuine absence, with no observed alternate writer/worker.
The historical omission/deletion event remains unproven.

Public Auth JWKS metadata: **one EC key, algorithm ES256**. Both user-facing
handlers keep `verify_jwt=true` and `auth.getUser()` validation. The worker keeps
JWT verification plus its custom server-only token. No signing-key change,
JWT bypass or API-key migration is required. Current Supabase documentation
describes ES256-compatible gateway verification; a fresh real session must
still be checked after deployment. No real user's token or password was read.

Only secret names were read. Base `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` names are present. `ANCHOR_WORKER_TOKEN`,
`SEPOLIA_RPC_URL`, `DEPLOYER_PRIVATE_KEY` and `VOTE_REGISTRY_ADDRESS` remain
absent, as does the worker's public-address fallback name. Secret values and
their validity were not inspected. No secret is needed from the user in chat.

The insertion and eight worker RPCs, grants, ballot tables, pgcrypto and guards
already exist. Endpoint restoration itself requires **no database migration,
RLS/grant change or blockchain contract deployment**. Keep the existing
service-only mutation boundary. Database cron remains absent; an external
retry scheduler has not been established.

### Pending ballot: Election 2

| Field | Read-only finding |
| --- | --- |
| Election | **2**, `SYNTHETIC - WITSG Same-Day Voting Test - 2026-10-10 6:30 PM` |
| Election status | `active` in storage; voting dates have ended; not removed |
| Saved Manila voting interval | 10 October 2026, 18:30–20:00 |
| Policy / freeze | Policy 1; frozen 10 October, 18:13:36 Manila |
| Ballot count / grouped vote rows | **1 / 1** |
| Created | 10 October, 18:42:49 Manila, inside the saved voting interval |
| Queue state | `pending`, currently unclaimed, retry count **0**, retry due |
| Transaction | Absent |
| Integrity metadata | Ballot V1, hash format valid; actual hashes/nonces not read |

No student identity, choice, ballot ID or private hash material was selected.
Retry count zero/currently unclaimed does not prove no historical attempt ever
occurred; no stronger claim is made.

The inspected `claim_next_ballot_anchor()` selects valid Ballot V1 pending jobs
globally, with due retry time and oldest/lowest-retry priority; it does not join
election status or voting dates. Once authorized/configured, the worker would
normally select this record for `anchoring`, record its existing ballot hash on
the registry, persist transaction metadata, then confirm or reconcile it.
Anchoring an already accepted ballot after voting ends is distinct from
accepting a new late ballot. The lifecycle fix blocks the latter and does not
discard this recorded ballot. Only one new ballot can be claimed per worker run.
No claim RPC, worker request, signing or transaction was executed.

### Election 3 and other active elections

At 20:53:30 Manila, Election 3 remained active, policy 1, unfrozen, with **0**
snapshot members, **0** ballots and **0** vote rows. The read-only proposed
BSIT Years 1–4 population remained **exactly 2**, requiring active authenticated
identity, enrolled status and canonical organization-2 participation. The
pending/unlinked students remain excluded by that predicate. No academic record
or saved rule was changed.

At 21:01 Manila, active election IDs were **[1,2,3,4]**, all policy 1; none was
inside its saved voting window. IDs 1/2 were frozen, IDs 3/4 unfrozen. Recheck
this immediately before writer activation: deployment is project-wide and must
not silently enable another election's voting window.

Election 3's saved interval is still 20 October 10:00–20:00. The proposed plan
remains **BSIT Years 1–4, exactly 2 active enrolled authenticated members**, with
future voting **21 October 08:00 to 22 October 10:00 Manila** only if separately
approved and still feasible. Recheck current time before any schedule approval.
The reviewed Election-3-only eligibility migration and Board rule edit remain
unapplied. No lock is authorized by this document.

## Can submission and receipts be restored without the worker?

**Yes, for recording and owned receipt access, with explicit approval that
blockchain settlement remains pending.** The original architecture already
commits ballot rows, private nonces and canonical hashes atomically before a
best-effort nudge. Neither the insertion RPC nor the receipt reader depends on
worker secrets or a successful chain transaction.

With the worker absent and its token still absent, submission skips the nudge;
restoring just the two user-facing functions cannot process Election 2. Failed
or 404 nudges likewise cannot undo a committed ballot. The receipt exposes its
canonical ballot hash and `pending` status, without a fabricated transaction or
claim of anchoring. Local API and existing receipt-helper tests confirm that
this no-transaction pending case is displayed as processing, not verified.
Neither one-vote safeguards nor eligibility/freezing checks are relaxed.

This is **not completed blockchain recovery**: new valid votes would accumulate
pending jobs until a separately approved worker/reconciliation operation exists.
Approve that operational condition explicitly before enabling the writer.
The receipt reader can be approved alone if recording with delayed settlement
is not yet acceptable.

Before later worker activation, resolve/review the existing reconciliation issue:
it checks transaction success without independently verifying the expected
registry event/hash. The separate receipt-display issue (transaction ID treated
as confirmation) is corrected locally in the follow-up, but the corrected
frontend is not deployed. No complete verified settlement is claimed and the
existing queue must not be processed to investigate these issues.

## Exact approval-gated production sequence

### Gate FR — reviewed receipt frontend correction, not yet approved

Publish and validate only the six frontend corrections in the revised manifest
using the receipt-only release scope. Exclude the earlier Board eligibility
presentation edits, which require a separately approved Election 3 migration.
Verify the new public receipt asset and the existing PWA update prompt/fresh
client, then repeat the nonwriting preflight. The historical production display
failure remains unresolved in production until this approved release succeeds.
No frontend, Edge or election deployment is authorized by the local fix itself.

### Gate A — receipt reader only

1. Obtain explicit approval for the reviewed receipt source/shared helper,
   lock/config and its source-manifest hashes, project and containment action.
   Approval does not include a worker, secret change, migration or election edit.
2. Recheck official inventory, correct project, unchanged database RPC/ACL/guard
   baseline and queue counts using
   `supabase/runtime-validation/submit-vote-readiness-readonly.sql`.
   Stop on source/config drift or unexpected data. Preserve `verify_jwt=true`.
3. Deploy only the named function, using the installed reviewed CLI:

   ```powershell
   .\node_modules\.bin\supabase.cmd functions deploy get-student-ballot-receipt --project-ref fszgdxqxonqqcrzsnkca --use-api
   ```

4. Verify inventory/version/config, hosted startup/import resolution, CORS and
   missing/invalid-JWT denial. With a legitimate authenticated session, verify
   owned receipt access and foreign-ballot denial without exposing identity or
   choices. A missing owned ballot legitimately returns null. Retain pending
   metadata for an unanchored ballot. These are reads; no ballot is submitted.
   Preserve the original queue and Election 3 counts exactly.

### Gate B — submission, worker still absent

5. Obtain separate explicit approval for writer activation with delayed
   settlement and the reviewed submission/shared/config/lock manifest. Recheck
   all active voting windows, base runtime settings, deployed receipt readiness,
   frozen/eligibility guard baseline, and no unsupported multi-select positions.
   The live UNIQUE(student_id,position_id) still limits each position to one
   persisted row; all current positions have max_votes=1. Do not change that
   schema as a restoration shortcut.
6. Require the worker still absent and `ANCHOR_WORKER_TOKEN` still absent. Do
   not provision a token, configure a scheduler or deploy/invoke either anchor
   worker in this stage. If any prerequisite has changed, stop for review.
7. Deploy only the corrected writer:

   ```powershell
   .\node_modules\.bin\supabase.cmd functions deploy submit-vote --project-ref fszgdxqxonqqcrzsnkca --use-api
   ```

8. Verify exact slug/version/config and hosted module loading. Missing/invalid
   bearer JWT must yield 401. After approval and with a real fresh session, a
   deliberately empty ballot may be used to verify authenticated rejection
   (400, no insertion); never use a valid ballot as a health check. CORS and
   method behavior must match the tested handlers. Gateway denial may precede
   handler method validation. Recheck queue, snapshot, ballot and vote counts:
   **no change from the immediately captured preflight baseline**.

Do not bulk deploy directories, prune functions, disable JWT checks, relax
RLS/grants, install the October 21 migration or alter existing vote records.
The commands above are documentation only and have not been executed.

### Gate C — Election 3, separately approved operations

9. Follow `election-3-test-recovery-prepared.md`: revalidate exact SQL baseline
   and expected count 2; apply only its reviewed scoped eligibility migration if
   approved; edit only Election 3's Board rule to BSIT Years 1–4; save a separately
   approved future schedule; refresh the official preview and require exactly
   the intended 2; obtain approval for the official irreversible lock; lock
   strictly before voting starts; validate metadata/audit/snapshot counts and
   candidate loading through real authorized sessions during the voting window.
   Keep no-vote validation until a production test vote is explicitly approved.

### Gate D — blockchain recovery, deferred

10. Securely establish authoritative server configuration through the approved
    secret manager, then verify RPC, chain 11155111, deployed registry code and
    address, owner/signer match and sufficient balance with read-only calls.
    Missing authoritative configuration currently blocks these live checks.
11. Correct/test the evidence issues above; approve processing the Election 2
    backlog and all subsequently accumulated pending jobs; approve authenticated
    retries/reconciliation scheduling, missing secrets and the exact worker
    release separately. Only then consider worker deployment/invocation.
    A worker call is never a read-only health check. No chain transaction is
    included in Gates A/B/C, and no registry deployment is proposed.

## Rollback limits and stop conditions

Each Edge deployment activates immediately. No previous deployed version of
these missing functions exists in the current inventory. Approval must include
an agreed named-endpoint containment/removal operation if activation fails;
do not improvise an Auth/JWT bypass. If A fails, hold B. If B fails, contain only
the named writer and preserve the receipt reader and all recorded data.

The installed CLI's delete help was verified. If explicitly approved as part of
the relevant gate, the containment commands are, **not executed**:

```powershell
.\node_modules\.bin\supabase.cmd functions delete submit-vote --project-ref fszgdxqxonqqcrzsnkca
.\node_modules\.bin\supabase.cmd functions delete get-student-ballot-receipt --project-ref fszgdxqxonqqcrzsnkca
```

Delete only the failing endpoint: a writer incident calls for writer containment
first; remove the reader only for its own failure. These remove deployed function
code/routes and retain local source and database records. Recheck inventory and
data counts immediately. No automatic containment action is authorized yet.

Unexpected row-count changes, configuration/source drift, another open election,
unsupported positions, or changed worker/token inventory stops the release for
review. If a submission times out after a later approved valid vote, check
trusted voted-status and owned receipts before any retry. Never clear voted
state, delete ballots or rewrite hash material. Function rollback cannot undo a
recorded vote; chain transactions cannot be undone. A successful electorate
lock has no supported rollback; do not unlock/rebuild it to recover an endpoint.

## Validation performed and limits

- **137 targeted Node tests**, including strict lifecycle cases for both policy
  branches, active/inactive/empty position sets, abstention, identity and Auth,
  eligibility/freezing, one-vote errors, worker absence/failure, receipt privacy,
  pending receipt display, CORS and worker ordering/manual-review behavior.
- **8 actual PostgreSQL 17.6 integrity checks**: trusted ACLs, freeze/membership,
  atomic failure, duplicate/concurrent submission, independently reconstructed
  V2 row and V1 ballot hashes, and preserved single-position uniqueness.
- **26 actual PostgreSQL Election 3 regressions**: rules/identity/enrollment/
  membership, count exactly 2 including Year 1, preview/lock/candidate/insertion
  consistency, concurrency, audit atomicity, immutability and other elections.
- All three original function sources checked with **Deno 2.1.4**, cached public
  dependencies and frozen per-function locks, with networking disabled.
- **3 offline Supabase Edge Runtime 1.77.6 bundles/startups, 10 HTTP checks**.
  Runtime image digest:
  `sha256:18f2af582e34fde1143eb7dbd5129245e19b46be18f24886d957b1877cf659c0`.
  The test copy substitutes only the two pinned public URLs with locally
  bundled versions of those same cached public dependencies. No handler logic
  is changed in that copy. Source-bearing containers have network mode `none`;
  HTTP probes share only their private loopback namespace. This validates local
  boot, CORS and denial behavior, not the hosted packager or a real user JWT.
- Networked bundling with internal source mounted was automatically rejected
  because of possible source export to esm.sh. It did not run. The completed
  alternative downloaded only public modules without internal source, then
  validated source offline. No approval to export internal source is requested.
- `node --check` for the new offline tooling and `git diff --check` passed.
- `npm.cmd run build` passed, including PWA generation (188 precached entries).
  Vite emitted a non-failing plugin timing warning. No frontend deployment was
  performed and the receipt UI source was not changed in this task.
- TypeScript annotations exposed one overly literal existing CORS-source test;
  its assertion now accepts optional `: Request` while retaining all origin,
  preflight and ordering checks. The final 137-test run passes.
- No real chain configuration/owner/funds validation, valid production ballot,
  successful production anchoring, or hosted runtime success is claimed.

Scripts: `kandid-submit-vote-integrity-pg17.mjs`,
`kandid-election-3-eligibility-pg17.mjs`,
`kandid-prepare-public-edge-dependencies.mjs` and
`kandid-voting-edge-runtime-offline.mjs` under `scripts/`.
Temporary public caches, test copies, bundles and logs remain local under the
ignored `.tmp/voting-backend-runtime/`; no binary or cache is a deployment input.
All isolated voting runtime containers and synthetic test databases were removed.

## Approval requested

Approve **Gate A only**, or **Gates A and B with the worker remaining absent and
blockchain status pending**, using the final source manifest and preflight
conditions above. Specify whether approval includes the named-endpoint
containment action and authenticated nonwriting verification requests.

Keep Election 3's migration/rule/schedule/lock and blockchain configuration,
worker deployment/backlog processing under separate explicit approval. Until
approval arrives, no production changes will be executed.
