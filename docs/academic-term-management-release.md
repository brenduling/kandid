# Academic Term Management release

Prepared 2026-10-22. Local implementation only. No production SQL, drafts,
transitions, imports, membership changes, notifications, deployments, Git commits
or pushes were performed. Two unauthenticated HTTP compatibility probes were made.

## Confirmed causes and compatibility

The configured project is `fszgdxqxonqqcrzsnkca`. Its
`/functions/v1/admin-academic-terms` endpoint returned **404** to both OPTIONS
and an unauthenticated empty POST. The POST body was
`{"code":"NOT_FOUND","message":"Requested function was not found"}`.
The preflight response omitted `content-type` from its allowed headers. This
explains the failing browser request: the academic-term function is missing at
that endpoint. The prepared local function supports localhost:5174 and the
existing allowed origins through the unchanged shared CORS implementation.
No authenticated production action was attempted.

There were also confirmed local contract defects: the UI was a disabled
rehearsal, activation still sent `{action:"activate",termId}`, and draft creation
did not enforce sequencing on the server. All three are replaced by the guarded
workflow. Error responses are surfaced; an incomplete response is never success.
Permission errors mentioning `academic_terms` no longer masquerade as missing
schema.

System Settings reads the persisted row **id 1** through existing RLS and
`maybeSingle()`. A null response explains its uninitialized state but cannot
distinguish a missing row from a hidden row. Its message now says that explicitly.
There is no fabricated fallback or automatic insert. Academic terms are
independent of that settings row. The existing guarded initialization/rollback
proposals have been executed successfully against the synthetic PostgreSQL
fixture, including refusal to overwrite existing settings and refusal to roll
back an edited row. **Current production settings contents, policies and SQL
prerequisites remain unverified because production SQL was not approved.**

`supabase/proposals/academic-term-transitions.preflight.sql` is a prepared,
read-only compatibility capture, not an executed production check. It exposes
schema/function hashes/ACLs, term/configuration rows and aggregate counts, with
no student roster or credentials. Compare each hash with the reviewed fixture;
stop and review any mismatch. The forward proposal independently fails closed
on missing prerequisites, unexpected notification constraints/owners/ACLs,
missing single-active-term uniqueness or required candidate/ballot/audit guards.

## Completed workflow

- Create only the immediate next semester, derived from the single active term.
  The service-only creation RPC serializes with transitions, verifies the Auth
  actor, returns an existing next draft on retry and audits a new draft. It never
  calls activation, enrollment/membership writers or notification fanout.
- Preview actual aggregate impacts through the server; select only the immediate
  next draft. Ten-minute reviews bind actor, source, target and all relevant
  enrollment/membership/catalog/election inputs through a fingerprint.
- Require the explicit acknowledgement and exact server confirmation phrase.
  Commit revalidates everything under transaction/advisory locks, reuses the
  existing activation synchronizer, and commits the term, memberships,
  notifications, audit and receipt together. Retries use the same operation ID.
- Preserve the operation ID in actor-scoped session storage **before** sending
  activation. Lost responses and reloads expose receipt recovery. A stale or
  expired review is invalidated by the server under the commit lock before a
  fresh preview is allowed. Busy/error states do not claim activation succeeded.
  Term-list reads have a 15-second limit and Edge requests a 60-second limit;
  an activation timeout retains the operation for recovery rather than assuming
  the server rolled back.
- Current enrollment remains separate from account access. Existing verified
  Board and reviewed-masterlist workflows restore eligibility. Program shifts
  retain institution-wide WITSG and historical participation; incompatible
  current program memberships fail the transaction. No profile field becomes
  enrollment evidence. Election schedules, account statuses/year levels,
  historical votes/receipts/officers/candidates and hashing/anchoring are retained.

See [backend details](academic-term-transition-backend.md) for the reproduced
historical candidacy gap, underlying contracts and transaction tests. The stale
voting test assertion is corrected; the separate historical nomination gap is
covered by a scoped additional current-term admission trigger, preserving the
existing candidate authorization guard.

## Validation and artifacts

The source/hash manifest is
`docs/academic-term-transition-backend-manifest.json`. The final local evidence
and exact source archive location are recorded there. It covers forward,
read-only preflight and rollback SQL; Edge source, shared CORS, Deno config/lock;
the scoped frontend; tests and this runbook. No secrets/environment files are
included. The archive is a reviewable source package, not an instruction to
publish the whole dirty working tree.

Final evidence: **57 PostgreSQL checks and 120 Node regression tests passed**;
Deno type/bundle, scoped lint and Vite/PWA build passed. Browser checks passed at
1280/768/390px plus all eight recovery/error/empty-state scenarios. The final
5,008-recipient synthetic fanout/rollback duration is recorded in the manifest,
including Docker/client checks. Source-wide lint (excluding generated temporary artifacts)
reports **15 errors and 14 warnings in unrelated files**; those files were not
changed by this feature. Raw `npm run lint` also traverses accumulated `.tmp`
browser/extension artifacts and exceeded the capture buffer; it is not a clean
repository lint result. The source-wide and scoped results are recorded separately.

Reproduce with Deno 2.9.6 and the verified local PG17 Docker fixture:

```powershell
deno check --config supabase/functions/admin-academic-terms/deno.json supabase/functions/admin-academic-terms/index.ts
deno bundle --config supabase/functions/admin-academic-terms/deno.json supabase/functions/admin-academic-terms/index.ts --output .tmp/admin-academic-terms.bundle.js
npm.cmd run build
$env:KANDID_TERM_BROWSER='1'
node scripts/kandid-academic-term-transitions-pg17.mjs
```

The runner refuses connection arguments, verifies the local container project,
PG17 image and port, creates random databases, and drops only its validated
fixture databases. Browser tests use a fresh Chrome profile, block production
DNS, intercept external traffic and route the actual Edge handler into real SQL
RPCs. Auth and PostgREST transport are fixture adapters; this does **not** certify
the deployed JWT gateway or production RLS. The suite tests desktop/tablet/390px,
draft side effects, real preview counts, exact confirmation, double clicks,
activation feedback, lost-response recovery across reload, stale reviews,
election blockers, missing backend, empty settings/retry and unavailable reads.

## Exact approval scope and order

1. **Production read-only preflight:** authorize only the prepared preflight SQL
   and deployed function/configuration inspection. Confirm SQL definitions,
   notification reader, current Board/import contracts, Super Admin linkage,
   settings row/read policy, institutional WITSG scope and intended next term.
   Assess lock duration/fanout against the actual population using a production-
   shaped isolated fixture. The 5,008-recipient benchmark is not a capacity SLA.
2. **Backend installation:** authorize deployment of **only**
   `admin-academic-terms` from the package, retaining `verify_jwt=true`, existing
   CORS origins and secrets. Example command for approval, not executed:
   `supabase functions deploy admin-academic-terms --project-ref fszgdxqxonqqcrzsnkca`.
   Drain any older activation requests, then execute the **entire** reviewed
   `academic-term-transitions.sql` transaction. This adds the private review
   table, four service-only RPCs and internal guards, notification constraint /
   index, audit writes, candidate/ballot and deferred membership checks, and
   revokes service execution of the legacy unreviewed activation entry point.
   Installation itself does not activate a term or modify existing memberships.
3. **Settings initialization, only if needed:** separately authorize
   `system-settings-initial-record.sql` if the approved inspection confirms the
   empty, pristine baseline and correct existing read policy. Capture the
   returned `rollback_xmin` and `created_at` privately for rollback. If a row
   exists or RLS hides it, stop: do not insert another row or weaken RLS.
4. **Scoped frontend release:** separately approve publishing only these
   feature changes through the existing release process. Other intentional
   working-tree changes are outside this package's approval. No Git push or
   Vercel deployment is implied by backend approval.
5. **Operational approval:** separately name the actual immediate-next draft
   to create, then obtain a fresh authoritative preview. Preview persists a
   protected review receipt and therefore is also a production write. Approve
   activation for that exact review/impact, including its membership
   synchronization, audit and student notification fanout. Imports and actual
   enrollment/membership mutations require their own explicit scope.

## Rollback

Before any committed transition, use the exact
`academic-term-transitions.rollback.sql` **only with separate approval**. It
serializes with commits, refuses a racing transition and refuses to remove
committed receipts/semester notifications. It removes only the new functions,
guards, review table and notification index/type extension and restores the
prior service ACL. It leaves any created drafts and their audit events intact;
it never reverses enrollments or deletes student history. The new UI/function
will fail closed if its SQL is removed. Take the feature offline or roll back
its scoped frontend/Edge release together; do not reintroduce unreviewed
activation as a shortcut.

The endpoint was absent at the compatibility probe. Capture its actual
predeployment metadata during the approved preflight; if absence is still the
baseline, Edge rollback means removing only the newly deployed function with
separate approval, rather than deploying the old unreviewed local handler.

After a committed transition, do **not** run teardown or activate an old term.
Preserve notifications, receipts and audit records; any recovery is a separately
reviewed forward change. For settings, use the existing fingerprint-guarded
rollback template only when the inserted row is still untouched. Never reset
its sequence or delete a later edited configuration.
