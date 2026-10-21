# Academic term transitions: local backend implementation

2026-10-22. **Frontend/backend integration completed locally; not installed or deployed.**

Latest integration, endpoint diagnosis, validation and exact rollout/rollback scope: [Academic Term Management release](academic-term-management-release.md). This continuation supersedes the former disabled-UI and unavailable-Deno limitations.

`AGENTS.md` and the existing [Danger Zone plan](system-settings-academic-term-danger-zone-plan.md) were read before this work. No production SQL, activation, import, membership mutation, function deployment, commit or push was performed. The completion turn made only unauthenticated OPTIONS/empty-POST endpoint probes: both returned 404 NOT_FOUND. All mutation tests used synthetic records in a newly created PostgreSQL 17 database inside the verified local test container.

## Changes and reused contracts

| File | Change |
| --- | --- |
| `supabase/proposals/academic-term-transitions.sql` | Explicitly reviewed forward proposal: guarded preview/commit/receipt RPCs, one private operation-review table, notification type/index, durable audit insertion, current-term candidate/ballot admission triggers and deferred program-membership consistency checks. Revoke service execution of the old unreviewed activation RPC; reuse its implementation internally. |
| `supabase/proposals/academic-term-transitions.rollback.sql` | Pre-activation rollback only. Serialize with activation; refuse teardown after a committed transition or semester notification. Never reverse terms, memberships, enrollment or ballots. |
| `supabase/functions/admin-academic-terms/index.ts` | Derive immediate-next draft creation through a serialized, audited service-only RPC. Verify bearer session and exactly one linked active Super Admin; strictly validate action fields; derive actor UUID from Auth; call guarded RPCs; return safe conflicts/errors and receipt-recovery instructions. Pin the existing Supabase SDK version and disable response caching. |
| `supabase/runtime-validation/academic-term-transitions-fixture.sql` | Supplemental synthetic schema/data. Reuse the existing Board fixture, captured ballot schema, and actual existing RPC bodies. |
| `scripts/kandid-academic-term-transitions-pg17.mjs` | Isolated runtime and concurrency regression runner. Reject connection arguments; inspect the fixed local container's project label, host port and PG17 image; use a random database with a validated prefix and remove only that database in `finally`. Never load `.env`. |
| `tests/academicTermTransitionsEdge.test.mjs` | Execute the real TypeScript handler after local transpilation, with mocked Auth/database/CORS transport and no network. |
| `tests/candidateElectionTermEligibility.test.mjs` | Correct the obsolete inline-voting-query expectation to assert the canonical JWT predicate and actual insertion guard contract. Keep existing election-term candidate assertions. |

The existing `academic_terms`, `students`, `student_term_enrollments`, `student_organization_terms`, `student_organizations`, `programs`, `organization_programs`, `student_notifications` and `audit_logs` remain authoritative. `private.academic_term_transition_reviews` holds only review/operation receipts and aggregate snapshots; it is not a second current-term, student or enrollment registry. It has RLS enabled, no browser policies, and no direct `service_role` table grant. Only the new service-only RPCs access it through trusted definer functions.

The implementation does not replace the existing activation, Board verification, reviewed-masterlist finalizer, canonical voting, candidate authorization or ballot-hashing function bodies. Their before/after definition hashes matched in the PostgreSQL tests. Existing student-table RLS, authentication configuration, election schedules and blockchain infrastructure were not changed. The frontend Danger Zone now calls the guarded create/preview/commit/status contracts, validates response completeness, persists pending operation identity before activation, and recovers receipts across reload.

## Request protocol

All requests remain POSTs to the existing `admin-academic-terms` Edge Function. Existing `verify_jwt=true` configuration is retained. The handler independently verifies the bearer token and linked active Super Admin. Unknown fields, supplied actors/counts and old unreviewed activation payloads are rejected.

| Action | Accepted body fields | Server operation |
| --- | --- | --- |
| `create` | `action`, `semester`, `startYear` | `kandid_create_next_academic_term(uuid,text,integer)` derives the immediate next term under the transition lock; retries return the existing draft. Does not activate, modify enrollment/memberships or notify. |
| `preview` | `action`, positive integer `termId` | `kandid_preview_academic_term_transition(uuid,integer)`; the actor UUID comes from verified Auth. Persists an operation review, not student data. |
| `activate` | `action`, UUID `operationId`, `acknowledged: true`, exact `confirmationText` | `kandid_commit_academic_term_transition(uuid,uuid,boolean,text)`; target/source are taken from the stored review. No client actor or target override. |
| `transition_status` | `action`, UUID `operationId` | `kandid_get_academic_term_transition(uuid,uuid)`; only the review's still-authorized originating administrator can recover it. |

A preview returns `operation_id`, server `created_at`/`expires_at` (ten minutes), source/target term rows, aggregate counts, blockers, `can_activate`, a server fingerprint and the exact confirmation phrase. Example phrase: `ACTIVATE 2nd Semester AY 2026-2027` (illustrative, not a live term).

The preview may return HTTP 200 with `can_activate=false`; confirmation cannot override its blockers. Commit rechecks authorization, exact confirmation, expiry, source and the complete server fingerprint. A changed review returns 409 and requires a new preview/confirmation. Authorization failures return 403; absent/unowned operations return 404; invalid requests return 400; busy/conflicting operations return 409; unavailable or unconfirmed outcomes return 503 without exposing database error details.

On success, the receipt contains `status=committed`, operation ID, resulting term at commit time, prior term ID, durable audit ID, notification count and commit time. A retry of the same committed operation returns the stored result without another transition, audit or notification. Receipt term data is a **commit-time snapshot**; the existing term reader remains the source for today's actual current term.

A lost response is not proof of failure. Query `transition_status` using the same operation ID; never automatically create a new review/target. Preserve that operation ID until recovery. Status lookup now takes the same transition lock; stale/expired reviews are permanently expired under that lock and return `can_refresh=true`. This prevents a delayed old request from committing after the browser abandons its review. Otherwise the browser retains the same operation and requires explicit confirmation for a retry.

## Authoritative impact and concurrency

Preview and commit use the existing activation advisory lock `(20261003,12000)`. They take `EXCLUSIVE ... NOWAIT` table locks on terms, admin linkage, elections, masterlist imports/rows, organization/program configuration, students, enrollments and memberships. Plain SELECT/navigation remains possible. DML and row-locking reads conflict; a busy input fails promptly. A transaction-local two-second lock timeout also bounds later row/advisory waits inside the reused synchronizer. This is a lock-wait limit, not a claim that all transition work completes in two seconds.

This conservative approach protects against existing writers without changing every import/configuration writer or inventing another version registry. It deliberately trades write concurrency during the brief operation for a consistent review. Lock duration and synchronous notification fanout must be measured against the real institution's population before rollout; the synthetic benchmark is not a production capacity guarantee.

The SHA-256 fingerprint covers identities and relevant values, not just counts: all term state; student identity/status linkage; source/target enrollment and participation rows; program/catalog identities; organization scopes/coverage; relevant election dates/status; and the derived counts/blockers. Equal-count identity substitutions invalidate review. These inputs cannot change between commit revalidation and activation while the locks are held.

Counts distinguish all persistent accounts (split by existing status), source-enrolled students, verified target enrollment, all active accounts lacking target evidence, source-active students newly requiring verification, non-enrolled target rows, verified program shifts, unresolved programs, conflicting program memberships, intended institution/program memberships, manual carry, explicit target removals and notification recipients. Counts use unique enrollment identity/term contracts rather than multiplying accounts across organization joins.

Normal activation requires exactly one active term and the immediate next draft. Initial bootstrap/recovery and reopening a closed term remain separate operations. Missing or invalid organization scope, unresolved programs, conflicting target program memberships and an unverified WITSG institution scope block activation. Current-term and legacy elections with ongoing/future/unresolved schedules also block it; the code does not change or reopen schedules to clear a blocker.

## Enrollment, program shifts and WITSG

Activation creates no enrollment evidence and advances no year levels or account statuses. It closes/activates terms and invokes the existing membership synchronizer, which reads already-enrolled target-term students. Accounts absent from the target term retain their established status/Auth linkage and normal permitted navigation. Restricted writes independently require current-term enrollment and canonical organization participation. Existing pending/disabled account restrictions are retained.

Authorized reverification remains through the existing Board evidence-review RPC and reviewed masterlist flow. A trusted `enrolled` row written through those established boundaries is enrollment evidence; the new code does not invalidate older masterlist evidence merely because later optional verification metadata is absent.

Verified shifts compare term enrollment attached to the same persistent identity. Existing finalizers reconcile only current program-specific participation and preserve past participation, structural links, officer/candidate/vote/receipt history, manual organization membership and institution-wide WITSG. Multiple organizations legitimately mapped to the same program remain allowed. There is no hardcoded program-to-organization mapping or self-profile-derived reassignment. Unapproved BHM/BSHM aliases must be resolved in the trusted catalog/review process, not inferred by this feature.

Deferred constraints validate the final state after existing trusted enrollment/membership writers finish. They reject a successful shift that would leave an incompatible current program organization active. In particular, an existing Board path skips legacy non-system program memberships; the new check rolls that entire conflicting verification back rather than deleting legacy rows or silently retaining two programs. Authorized reviewed masterlist reconciliation remains available under its existing rules.

Explicit removal/restoration semantics are preserved: activation does not overwrite an existing removed target participation. The existing import wrapper can restore some institution rows that the individual/Board paths preserve as removed. This asymmetry was not silently redesigned; its actual deployed policy must be reviewed before rollout, especially for explicitly removed WITSG participation.

## Durable notifications and audit

Successful commit writes one `academic_term_activated` in-app notification per persistent student identity, including pending/disabled identities (delivery does not enable their accounts). Existing authenticated notification readers continue to scope access to the student. Notification metadata contains operation/term references and the existing `/student/profile` destination. A partial unique index on recipient + transition ID prevents duplicates. No SMTP, push provider, extra outbox or new worker is introduced.

Term activation, membership synchronization, notification fanout, the verified-actor `audit_logs` event and the committed receipt share one transaction. Failure at any stage rolls all of them back. The audit stores source/target, verified actor/name, authoritative time, operation ID, impact counts/fingerprint and recipient count, without student rosters or credentials. The existing trusted audit trigger stamps the event's time; installation fails if that prerequisite is absent.

The existing global audit list exposes its standard event/actor/time/target projection. Its current `safe_details` projection deliberately omits these new transition metadata fields. Full transition details are durable in protected audit storage and the originating administrator's receipt. A broader details display needs a narrowly reviewed audit projection/frontend follow-up; no raw metadata reader was opened here.

## Candidacy-test investigation

The prior failure was a **stale voting source assertion**, not evidence that voting had lost its enrollment check. `submit-vote` now calls the JWT-derived `kandid_check_student_ballot_eligibility`; the installed-intent canonical predicate checks active term, enrolled identity and participation, and the actual atomic ballot insert rechecks eligibility. The isolated fixture exercised those real bodies and denied students with only past-term evidence. The test now follows that contract.

A separate policy/integrity gap was reproduced using the local 20261021 candidate guard: an authorized administrator can nominate a student into an editable historical-term draft using historical enrollment, even when that student lacks current-term evidence. This is not a claim that an unauthorized student can nominate themselves, or proof of deployed production state. The new trigger rejects new historical-term nominations and identity/position reassignment, and requires current evidence for current-term candidate writes. It preserves existing candidate authorization and permits authorized metadata maintenance on existing closed-term candidates without deleting history.

## Test evidence and limits

- **57 isolated PostgreSQL 17 checks passed** on the final proposal. This includes installation without record changes, pre-activation rollback/reinstall, ACL/actor checks, next-term sequencing and year rollover, expiry/confirmation, same-count stale substitutions, configuration/election changes, busy writers, bounded advisory waits, competing Super Admin sessions, rollback races, injected membership/notification/audit failures, idempotent recovery, history/credentials/schedules preservation, verified Board and masterlist shifts, candidacy denials and real canonical ballot insertion/duplicate denial.
- **120 focused Node regression checks passed**, including Edge/client protocol/error handling, candidacy, settings initialization, current-term voting, Board/masterlist/program reconciliation, Ballot V1, receipts and legacy anchoring.
- **Deno 2.9.6 type and bundle checks passed**, using the function-local `deno.json` and lockfile. Scoped frontend/scripts/tests lint passed with zero errors/warnings. Vite/PWA build passed with native exit code 0.
- Responsive Chrome tests route the actual Edge handler into real isolated SQL RPCs. They cover the complete draft/preview/confirmation/activation workflow at 1280/768/390px, interrupted response recovery across reload, stale review invalidation, blocking elections, missing backend and settings retry. No production API request leaves the browser harness.
- The actual existing activation, membership reconciliation, candidate authorization and canonical ballot RPC definition hashes were unchanged by the new proposal. The measured 5,008-recipient fanout/rollback duration is recorded in the final manifest, including Docker/client checks; this is not a measurement of production lock duration.

Source hashes for the exact local review artifacts are in `docs/academic-term-transition-backend-manifest.json`. Evidence: `.tmp/academic-term-transitions-pg17.json`, `.tmp/academic-term-transition-dependencies.json`, `.tmp/academic-term-ballot-regressions.tap`. Before-images of the two edited implementation/test files and the earlier plan are in `.tmp/academic-term-backend-before/`. No working-tree cleanup, staging or unrelated source changes occurred.

## Remaining blockers and exact production approval scope

Production SQL remains unverified and untouched. The endpoint was confirmed missing through unauthenticated HTTP probes. The integrated UI now displays validated server counts and performs the full guarded workflow in local tests. No deployment or real transition is authorized by the present request.

1. **Read-only contract verification approval:** inspect deployed functions, columns, unique constraints, trigger attachments/owners/ACLs, notification type constraint, WITSG institution configuration, current term and population/election state. Compare with the local dependency hashes and existing reviewed migrations. Confirm Board/masterlist Edge versions and feature gates support the tested workflows. Stop on differences; do not repair migration history or replay old migrations blindly.
2. **Backend installation/deployment approval:** approve the exact forward proposal and deploy **only `admin-academic-terms`**, preserving `verify_jwt=true` and secrets. This adds the private review table, service-only RPCs/internal helpers, notification type/index, candidate/ballot/deferred consistency triggers and revokes external service execution of the legacy activation RPC. It does not activate a term, import data or reassign existing memberships. Deno 2.9.6 type and bundle checks now pass with the function-local lockfile. Complete the real-population lock/fanout assessment before this stage. Use a quiet window: deploy the guarded Edge version first, let old activation requests drain, and verify no old activation transaction remains before installing the SQL. Preview/status calls fail closed until their RPCs are available.
3. **Scoped frontend release and production preview approval:** the integration is complete locally. Separately approve release of these frontend changes and production preview metadata writes (operation receipts). Do not publish unrelated working-tree edits. Audit detail projection work, if desired, stays narrowly scoped and separate from raw metadata access.
4. **Separate approval for a real transition:** identify the actual source/target term IDs, obtain a fresh approved impact preview and exact confirmation, review election/program/WITSG blockers and the operating window, and explicitly approve the resulting target-term membership synchronization, structural links, student notification fanout and audit write. Approval to deploy the backend does not authorize this operation. Actual masterlist imports, student reverification/reassignment outside activation, and any additional function deployments require their own explicit authorization.

Before any committed transition, the rollback proposal can restore the prior RPC ACL and remove the added schema/guards after acquiring the same transition/input locks. Coordinate the Edge rollback to avoid mixed protocols. After commit, rollback refuses to remove evidence or reactivate the previous term. Disable further activation, preserve all new evidence/history and prepare a separately approved recovery decision. Never delete notifications/audits, reverse votes, reopen elections or overwrite new enrollment as generic rollback.
