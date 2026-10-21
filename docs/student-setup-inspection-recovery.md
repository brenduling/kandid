# Student setup inspection: local recovery preparation

Status: prepared locally; no deployment or setup activation authorized by this task.
Target: Supabase `fszgdxqxonqqcrzsnkca`, function **resolve-student-login** only.

## Scope and trust boundary

The frontend sends `{ action: "inspect_setup", student_number: "<digits>" }`.
Production v7 rejects that action before lookup. The current local resolver also
contains other unreleased setup changes. It is deliberately preserved.

Deploy only `supabase/functions/resolve-student-login-inspect-deploy/index.ts`
under the existing **resolve-student-login** function name, with the shared file
listed in `student-setup-inspection-manifest.json`. Do not deploy a new function
named `resolve-student-login-inspect-deploy`, or use the broader local resolver.

The prepared artifact starts from the captured production v7 source and adds:

- The exact inspection action and two-field request validation.
- The existing HMAC `verify` rate bucket, failing closed on unavailable limits.
- A uniform protected acknowledgement after rate limiting, before Auth client
  construction, student lookup, email dispatch, or identity linking.
- Three type-only annotations using the inferred concrete client return type.
- Supabase SDK pinned to the reviewed **2.118.0** release instead of the major alias.

Inspection echoes only the submitted ID, `details_verified: false`, and null
personal fields. It does not establish account existence or eligibility. Unknown,
pending, active, disabled, and ambiguous IDs receive the same response. Origin
validation is an existing browser restriction, not proof of identity. Pre-auth
inspection remains public; email ownership and identity linking are still required
before private data or account activation can be authorized.

Existing `login`, `begin_access`, and `verify_access` behavior is unchanged from
v7, including trusted email selection, eligibility checks, unconfirmed Auth user
creation where appropriate, OTP verification and generic failures. The existing
`link-student-identity` endpoint is neither modified nor deployed. No student,
enrollment, membership, password, or Auth settings changes are part of deployment.

## Deployment preconditions and separate approvals

1. Approve the manifest and deployment of this artifact to **resolve-student-login**
   only. Preserve v7's **verify_jwt=false**: this is its existing pre-login contract,
   not the authenticated worker contract. Do not change other function settings.
2. Recheck the live function is still v7 with the captured source and matching
   shared file. Stop and review if it has changed. Compare normalized LF hashes
   for source recovered through the management API; compare raw hashes for local
   files. Bundle hashes and individual source hashes are different evidence.
3. Check existing required secret names without reading values:
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (platform),
   `STUDENT_AUTH_RATE_LIMIT_HMAC_SECRET`, and optional
   `STUDENT_AUTH_ALLOWED_ORIGINS`. Preserve their values and Auth/email settings.
4. Re-run targeted tests, Deno type check, lint, and manifest hash verification.
   The release artifact imports exactly
   `https://esm.sh/@supabase/supabase-js@2.118.0`. Actual SDK transport tests cover
   RPC/lookup, password login, Auth administration, OTP and the inspection HTTP
   contract with mocked responses and no network permission. Differential handler
   tests preserve v7's existing outcomes. The historical v7 SDK graph was not
   captured by the management API: this is a reviewed version pin, not a claim
   that the production bundle historically used 2.118.0. A different SDK version,
   unexpected source file, or altered function configuration is a stop condition.
5. Preserve a secure copy of the v7 rollback fixture and manifest. Deploy with a
   single-function tool supporting explicit files and entrypoint. Use logical
   entrypoint `functions/resolve-student-login/index.ts` for the prepared artifact
   and `functions/_shared/kandidProductionSecurity.mjs` for the unchanged shared
   source. Never run a project-wide deployment or migration push.

### Exact single-function deployment mapping (approval required)

Use `deploy_edge_function` with `project_id: "fszgdxqxonqqcrzsnkca"`,
`name: "resolve-student-login"`,
`entrypoint_path: "functions/resolve-student-login/index.ts"`, and
`verify_jwt: false`. Populate `files` from the manifest's two `deployment_files`:
each `name` is its `deployed_name`, and each `content` is the exact verified local
`path` contents. No import map, other function, test, rollback fixture, environment
file, or migration belongs in that payload. Do not use a default CLI deployment
that selects the broader canonical resolver directory.

The source pin and all package hashes must be rechecked immediately before upload.
After upload, retrieve the deployed files and compare normalized source hashes and
the pinned SDK import with manifest revision 2 before any POST verification.
Inspect the other function inventory read-only to ensure it was not changed.

## Post-deployment verification before enabling localhost setup

- Verify ACTIVE status, the expected new deployment version, verify_jwt=false,
  source integrity and the exact pinned import. Stop on any mismatch.
- Verify localhost:5174 CORS OPTIONS. Do not weaken the origin allowlist.
- **Separate approval is required for live inspection POST checks**: they consume
  rate-limit database counters even though they cannot create or change students.
  With that approval, make a bounded check for the intended ID and an approved
  absent numeric ID. Both must return HTTP 200 and identical protected shapes
  apart from the echoed ID, `Cache-Control: no-store`, and no identity/email/
  enrollment/account-state data. Do not print credentials or request headers.
- Confirm malformed requests fail closed and no Auth account, student, enrollment,
  membership, password or email-delivery changes occurred during inspection.
- Only after backend checks pass, obtain **separate approval** to set the local
  `VITE_ENABLE_STUDENT_ACCOUNT_SETUP=true` switch and restart Vite. It remains
  disabled throughout this preparation. Do not remove the write safeguard.
- An actual end-to-end setup requires separate approval and the student's inbox:
  `begin_access` may create an unconfirmed Auth user and send email;
  `verify_access` establishes an authenticated session; identity linking sets the
  chosen password and activates/links the trusted record. These are real writes,
  not read-only deployment checks. No such calls were made during preparation.

## Rollback / containment

Keep setup disabled if any deployment verification fails. If deployment succeeds
but is incompatible, restore only **resolve-student-login** using the exact
`files` captured in `tests/fixtures/studentSetupResolverV7.json`, its entrypoint
`functions/resolve-student-login/index.ts`, and verify_jwt=false. Confirm ACTIVE,
captured source hashes and retained settings. Do not deploy the local canonical
resolver as rollback or modify secrets, RLS, other functions, or database records.
Use the same single-function deployment arguments above, replacing only `files`
with the rollback fixture's verified `files` array. Re-fetch and verify its two
captured source hashes after restoration. The rollback fixture is unchanged from
the read-only production v7 check performed during final release preparation.

Redeployment produces a new version; it does not restore the old version number.
Rollback restores source, not the unrecorded historical SDK graph. Rate-limit
counters consumed by approved checks are not undone. If setup was separately
enabled later, disable its local switch first. Auth/student writes from a genuine
setup are not reverted by rolling back function code; never delete or reset those
records as an automatic cleanup.

## Local validation commands

```powershell
node --test tests/studentSetupValidation.test.mjs tests/studentSetupCompletion.test.mjs tests/studentAuthCaptchaFree.test.mjs tests/studentNotificationsAuth.test.mjs tests/studentNotificationRequests.test.mjs tests/studentSetupInspectionManifest.test.mjs
$env:DENO_DIR = (Resolve-Path .tmp/anchor-scheduler-tools/deno-cache).Path
.\.tmp\anchor-scheduler-tools\deno\package\deno.exe check --no-config --no-lock --cached-only supabase/functions/resolve-student-login-inspect-deploy/index.ts
.\.tmp\anchor-scheduler-tools\deno\package\deno.exe test --no-config --no-lock --cached-only tests/studentSetupPinnedSdk.test.ts
.\.tmp\anchor-scheduler-tools\deno\package\deno.exe lint --rules-exclude=no-import-prefix supabase/functions/resolve-student-login-inspect-deploy/index.ts tests/studentSetupPinnedSdk.test.ts
npm.cmd run build
```

The lint exception preserves v7's existing HTTPS import convention; type checking
is enabled. All behavioral tests use synthetic services with no production network,
SMTP, student mutations, or real credentials. The manifest separates deployable
files, rollback source, test evidence and frontend compatibility references.
