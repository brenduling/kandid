# Board Elections editor — local recovery

**Superseded for normal development:** the user subsequently approved ordinary
authorized administration on localhost:5174 with the official backend. See
`normal-development-admin-crud.md`. The port-5175 requirement and default-OFF
normal-development save restriction below describe the earlier safety scope.
The isolated acceptance runner now also checks normal development saves with
all official-project backend traffic intercepted.

21 October 2026, Asia/Manila. Work stays in `kandid-clean`; no production writes,
configuration changes, migrations, deployments, Git commits or pushes.

## Cause and flow

`Elections.jsx:openEdit` calls `loadElectionForEdit`: Supabase `auth.getUser`, an
active administrator lookup using that verified Auth ID, an organization-scoped
election read, then the administrator geofence RPC. The guided setup keeps the
loaded record and its locks, displays Review, and calls `handleSubmit` on Save.
`saveElectionEdit` builds only changed permitted fields and issues an UPDATE with
the original record, scope, dates and freeze/release state as comparison filters.
A confirmed returned ID is required before success and refresh.

In normal `development` mode, `supabaseClient.js:guardedSupabaseFetch` routes the
request through `fetchDevelopmentProductionRequest`. The election PATCH branch
of `isAllowedDevelopmentProductionRequest` requires the separate default-OFF
`VITE_ENABLE_ELECTION_MANAGEMENT` flag. Without it, the transport throws the
reported temporary safeguard error **before fetch**. This is intentional for
the official-production-connected server on port 5174. It is not an RLS denial.
The editor previously offered Save without explaining this restriction.

## Production inspection (SELECT only)

- `public.elections` and `admin_users` have RLS enabled.
- Authenticated election UPDATE uses both USING and WITH CHECK: the JWT Auth ID
  must identify an active Super Admin or active Electoral Board administrator
  for the election's organization. The administrator SELECT policy permits only
  the user's own Auth-linked profile. Client storage is not this authority.
- Existing triggers protect permanent academic terms, electorate policy and
  trusted locking, frozen organization/term/voting schedules, result-release
  fields, soft removal and audit behavior. No trigger, grant or policy changed.
- `kandid_get_admin_election_geofence(integer)` is genuinely absent. Its proposed
  definition is in the unapplied `20261021110000_publication_and_board_privacy_contract.sql`.
  It checks active administrator organization access before returning coordinates.
- The legacy schema still grants authenticated SELECT on all three geofence
  columns. The existing editor fallback handles **only** missing-RPC PGRST202,
  uses the verified election ID/organization, and retains RLS. An installed RPC's
  denial or any other error never falls back. Missing/unreadable coordinates
  block editing; they are never replaced with empty values and saved.
- The missing RPC is not required for updates against this legacy contract. It
  becomes the required read path when the separate privacy contract is installed.
  Applying that migration is outside this task and was not attempted.

## Local changes

- `src/utils/electionEditingEnvironment.js`: explains the existing development
  save gate and explicit read-only mode; it grants no write permission.
- `Elections.jsx`: supplies that message, blocks edit submit before a write,
  and prevents cover uploads for an edit whose save is blocked.
- `BoardElectionSetup.jsx` / `Elections.css`: show the restriction when the sheet
  opens, disable Save, and connect the button to the accessible explanation.
  Review/navigation and existing schedule/term/freeze locks remain intact.
- `package.json`: adds `npm run dev:elections:local`, bound to localhost:5175 in
  `local-election-editor` mode. The unchanged build-environment validator accepts
  only loopback HTTP Supabase endpoints in this mode and rejects cloud targets
  and server-only client keys. Normal port 5174 and production modes are unchanged.

For interactive local editing, configure the ignored
`.env.local-election-editor.local` with `VITE_SUPABASE_URL` for an isolated local
Supabase API and that local project's public/anon `VITE_SUPABASE_KEY`. Use an
Auth-linked active Board account assigned to a synthetic organization's records.
Run `npm run dev:elections:local`. Never copy a service-role key, point this mode
at production, or turn on the official-production management flag for this task.
The command requires a separately running local backend with the existing
election schema, RLS and triggers. The automated test starts its own disposable
backend and stops it on completion; it does not provision a persistent account.

## Validation

The regression set covers the environment restriction, the actual fetch denial,
local-mode endpoint validation, missing/denied geofence RPC behavior, verified
administrator scope, changed-fields-only saves, minute-picker precision,
permanent term and frozen settings, no-op saves and snapshot conflicts.

`scripts/kandid-election-edit-local-acceptance.mjs` creates a new uniquely named
database in the verified local PostgreSQL 17 container and an ephemeral local
PostgREST instance. The fixture contains schema/policy/trigger definitions read
from production; **no production records or Auth accounts are copied**. All
election test IDs are synthetic 92001–92003. Auth uses a synthetic local user
fixture and signed local JWTs; PostgREST JWT validation and PostgreSQL RLS are
real. This is a scoped replay, not a clone of the complete production backend.

Browser testing uses a fresh profile, blocks external backend DNS/requests, and
exercises desktop and 375px Edit → Review → Save → Refresh. It also intercepts
all backend traffic when checking the production-connected sheet's disabled
Save state on localhost:5174. No live election is edited or used as a test vote.

Completed source validation:

- 38 targeted unit tests passed, zero failures.
- Targeted ESLint passed for both changed React components and the new helper.
- `npm run build` passed, including PWA generation (188 entries).
- React review retained the existing hooks, queries, authorization and form
  contract; the new status message has an accessible association with Save.
- `git diff --check` and acceptance-script syntax checks passed.
- All 42 previously modified/untracked files were verified byte-for-byte against
  their existing snapshot; receipt recovery work and the separate receipt branch
  were not changed.
- Read-only production fingerprints before/after the tests match for all four
  election records. No production rows were used in mutation tests.
- Final acceptance: **17 checks passed**, including real local JWT/RLS denials,
  snapshot conflicts, permitted frozen-title editing, desktop/375px
  Edit → Review → Save → Refresh, complete saved-record preservation apart from
  the intended title, and the production-development restriction's disabled Save
  and blocked programmatic submit. Production backend requests/mutations: **0**.
- Review screenshots at 1280px and 375px were inspected. The dialog remains
  inside the viewport and the Save action is visible/reachable at 375px.
- The final acceptance command exited successfully. Read-only Docker/Postgres
  checks confirmed the ephemeral PostgREST container was stopped and the named
  synthetic database removed. The existing local stacks and user dev server
  remain in place.

New validation files are `tests/electionEditingEnvironment.test.mjs`,
`tests/fixtures/electionEditProductionContract.json` and
`scripts/kandid-election-edit-local-acceptance.mjs`. Existing edit-contract,
development-guard, environment-policy and Vite-port regressions were rerun.

The local acceptance run writes its final check list and result to
`.tmp/voting-backend-runtime/election-edit-acceptance/results.json` and screenshots
to `review-1280.png` / `review-375.png` in the same ignored evidence directory.
