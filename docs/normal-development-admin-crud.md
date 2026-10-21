# Normal development with the official Supabase backend

21 October 2026, Asia/Manila. This supersedes the previous requirement to use
port 5175 for ordinary authorized administration.

## Result and authorization

Use the existing `npm run dev` at **http://localhost:5174**. Its official Supabase
project remains `fszgdxqxonqqcrzsnkca`; no `.env`, Auth setting, grant, RLS policy,
secret, migration or deployed function changed.

Normal development now opts into `allowBackendAuthorizedAdminCrud` in the existing
Supabase transport. This removes temporary per-feature frontend activation flags
as a prerequisite for existing administrative workflows. It does **not** grant
permissions: the SDK sends its original JWT, and the deployed backend verifies
the user, active administrator assignment, role, organization and lifecycle.
No localhost-origin check or localStorage role is accepted as authorization.
Backend 401, 403, conflict, validation and network failures are returned unchanged.

The explicit `localhost-production-readonly` inspection mode stays read-only.
Production builds retain their existing UI feature flags. The historical default
restricted transport profile is retained for callers that do not select the
normal-development administrative profile. The isolated editor command remains
optional for regression testing; it is not required for ordinary development.

## Audited operations

| Workflow | Development transport | Backend authority retained |
| --- | --- | --- |
| Elections create/edit | Allowed without temporary flag | Active Auth-linked admin RLS, scope WITH CHECK, term/freeze/result/removal triggers, original-row comparisons |
| Positions and partylist CRUD, position reuse/reorder | Allowed, including existing Super Admin request shapes | Organization/election RLS helpers, lifecycle guards, constraints |
| Candidate CRUD and campaign files | Existing scoped payload checks enabled | Candidate context RPC, verified admin, position/election scope, RLS, Storage policies |
| Eligibility-rule CRUD | Existing scoped checks retained | Existing helper readiness/lock checks, election-scoped RLS and history guards |
| Election access tokens | Scoped create/update allowed | Election/organization-scoped authenticated RLS |
| Organization/program configuration and deletion | Named existing RPCs admitted | Active Super Admin JWT checks, validation, atomic save, dependency/audit-protected deletion |
| Administrator accounts, invites, relinking and self profile | `admin-user-management` actions admitted | Deployed v9 verifies Auth user and active admin; Super Admin required except permitted self profile |
| Officers and result finalization | Existing `officers-contract` actions admitted | Deployed v2 verifies active Auth-linked admin and invokes RPCs with that user's JWT; role/scope/lifecycle rules remain server-side |
| Organization member/count reads | Existing `organization-eligibility` actions admitted | Deployed v2 validates active admin and role/organization scope |
| Board registration and participation management | Frontend switch no longer blocks normal development | Deployed v14 validates JWT, active Board assignment, evidence, scope, prerequisites and its own write gates |
| Election soft removal / restore | Readiness check and password-protected endpoint admitted | Deployed v3 readiness/server gate, password verification, lifecycle/dependency checks; no physical election DELETE path |
| Archive deletion exposed by existing Super Admin UI | ID-scoped DELETE admitted | Existing authenticated active-Super-Admin RLS; no vote/ballot mutation |

Read-only inspection verified the corresponding production RLS/RPC definitions
and retrieved deployed administrator, Board registry, officer and organization
eligibility sources. Those endpoints derive the caller from `auth.getUser()` and
the Auth-linked administrator record, not caller-supplied roles. No mutation was
used to inspect their permissions. Existing candidate-context RPC is present.

## Still protected or requiring backend work

- Direct writes to votes, ballots, hashes, anchor statuses, private electorate
  data, student central records and administrator role tables remain blocked.
  Existing trusted enrollment/account endpoints must be used.
- Vote submission and blockchain worker invocations remain blocked. This change
  does not restore `submit-vote`, receipts, or either anchoring worker and does
  not claim or process any pending ballot.
- Manual freeze fields, policy downgrade, recorded-term replacement, direct
  result-release fields and physical election deletion remain blocked.
- The official electorate lock RPC remains outside ordinary CRUD. Its current
  inspected implementation still selects active linked participants without
  enforcing the stored election program/year declaration. The separately
  prepared eligibility/freezing recovery must be reviewed before enabling it;
  no bypass or manual snapshot population was added.
- `admin-academic-terms`, `super-admin-manual-enrollment`,
  `super-admin-masterlist-import` and `link-admin-identity` are absent from the
  current deployed inventory. Frontend transport changes cannot implement those
  services. Super Admin student listing/CRUD, enrollment/import, academic-term
  administration and any required admin identity bootstrap therefore need a
  separate backend restoration review/approval; no direct table/service-role
  fallback was introduced.
- Board registration/management and election removal still fail safely if their
  **server-side** gates or prerequisites are not activated. The audit inspected
  the gate code, not secret values; it does not assert their current values.
  The legacy `batch_enroll` action is not supported by the deployed Board
  registry contract and remains blocked; use its supported enrollment workflow.
- The admin geofence RPC is absent; the existing PGRST202-only legacy fallback
  remains protected by the verified administrator scope and current RLS grants.
  An installed RPC denial never falls back. The October 21 migration was not
  applied to enable this workflow.
- Unknown RPCs, service-actor RPCs, alternate schema writes, merge upserts and
  unscoped multi-row destructive requests remain rejected by the development
  transport. Backend errors are not converted to successful saves.

## Files

- `src/utils/developmentAdminRequests.js`: bounded administrative request shapes.
- `src/utils/developmentProductionWriteGuard.js`: normal-development profile,
  retaining restricted callers and protected operations.
- `src/lib/supabaseClient.js`: selects that profile only in development.
- `src/utils/electionEditingEnvironment.js`: normal development no longer shows
  the obsolete disabled-save explanation; explicit inspection mode still does.
- Board registration/management and election-removal feature gate helpers:
  development defers to backend readiness; production flags remain unchanged.
- `tests/developmentAdminCrud.test.mjs`, updated editor-environment regressions,
  and the existing isolated election acceptance runner validate this behavior.

No interface, layout, route, CSS or responsive styling changed in this task.
Existing unrelated work is preserved.

## Validation results

- **130 targeted regression tests passed**, covering the development transport,
  Board activation/actions, election edit contract, environment policy,
  receipts, electorate security and vote security. The final standalone
  transport suite also passed **46/46**, including a forged localStorage role
  receiving the original backend denial. These suites overlap.
- Targeted ESLint and JavaScript syntax checks passed. `npm run build` passed,
  including PWA generation (188 precache entries). `git diff --check` passed.
- The isolated acceptance runner passed **17 checks** with PostgreSQL 17 and
  PostgREST JWT verification/RLS. Foreign, disabled and student actors were
  rejected; protected organization/term/freeze/policy/schedule/result fields,
  invalid JWTs and concurrent stale saves were rejected. Permitted title edits
  preserved every other election field.
- Desktop **1280px** and mobile **375px** completed Edit → Review → Save →
  Refresh without horizontal overflow; the Save button remained accessible.
  The normal **localhost:5174** application also saved and refreshed with
  temporary activation flags off, using exactly one intercepted title PATCH.
- Browser requests to the official backend were intercepted, with a DNS
  backstop for Supabase domains. Actual production backend requests during the
  acceptance run: **0**; production mutations: **0**. Synthetic records
  92001–92003 lived only in a disposable local database, which was removed
  together with its temporary PostgREST container after the successful run.
- Separate production inspection used read-only metadata/source queries and
  aggregate election checks. Before/after: **4 elections**, identical aggregate
  digest `5367cd5d8740a2579ce85f7487e02070`. No Election 3 update or vote was made.
- All **47 unrelated pre-existing changed/untracked files** matched their
  starting SHA-256 hashes. The Git index, branch and HEAD are unchanged. No
  commit, push, deployment, migration, secret or production setting change.

Ignored local evidence is under `.tmp/voting-backend-runtime/`:
`admin-development-tests.tap`, `admin-development-policy-tests.tap`,
`admin-development-build.log`, `admin-development-acceptance.log` and
`election-edit-acceptance/results.json` plus desktop/mobile screenshots.
