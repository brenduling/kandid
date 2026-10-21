# Student setup: owner-approved recognition sequence

Status: LOCAL ONLY; deployment, activation and genuine setup testing need separate
approval. Supersedes the earlier local email-first recognition proposal/revision 1.
Production resolver v8 and its frozen inspection manifest remain unchanged.

## Final sequence

Find Student ID ? Confirm Student Details ? Configure Password ? Verify OTP ?
Complete ? Student Login.

The confirmation screen displays exactly three read-only registry values: full
name (first + last name), program, and year level. The student must tick an explicit
ownership confirmation before proceeding. This checkbox is a local acknowledgement,
not identity verification or permission to change an account. No email, masked email,
enrollment, organization, account status or extra identity fields are displayed.

Password configuration remains in component memory. No password is included in
inspection, OTP request or OTP verification payloads; it is not written to local or
session storage. The existing password policy/confirmation controls are retained.
After configuration, the explicit send-code action calls begin_access with only
the Student ID. The server chooses the database email; no email input/substitution
is introduced. Generic delivery acknowledgements, HMAC limits and resend cooldowns
remain in place. Returning to details clears the password and requires confirmation
again. ID changes/refresh discard the draft. There is no automatic email or retry.

After successful OTP verification and admission, the page establishes the returned
SDK session, checks the fresh Auth identity, the exact Student/Auth binding and
expiry, then calls the existing trusted linker with the configured password. The
linker independently rechecks confirmed registered email, status, links, collisions
and password policy. Only its explicit matching active-record confirmation displays
Complete. An already-active linked account goes to login without a setup password
reset. Session mismatch/expiry clears the draft and requires a new lookup. Success
retains explicit local-session sign-out and navigation to /student-login.

## Deliberate privacy change ? approval applies to local preparation only

Deployed v8 inspect_setup returns the same protected shape for known and unknown
Student IDs, with personal fields null. Proposed contract version 2 changes this:
knowing/guessing an eligible Student ID can reveal that record's full name, program
and year before email ownership is verified. A successful lookup therefore confirms
an eligible record exists. This is a real reduction of enumeration/privacy protection,
requested by the owner; it cannot be eliminated while offering this recognition
step. Existing HMAC/IP/Student-ID rate limits and allowed origins reduce abuse but
do not prove who is calling. CORS is not authentication.

Only the approved three fields are disclosed. Unknown, disabled, ambiguous,
invalid-email, foreign-linked or collision records share one generic 404 response.
Read/configuration failures return unavailable, not invented data. Responses retain
no-store. No email or masked email, internal record ID, status, enrollment,
participation, documents or Auth identity is returned by inspection. The submitted
Student ID is echoed only as response-binding metadata and is not an extra field
on the confirmation screen. No direct browser table access or RLS/grant change is
introduced. Source rollback cannot retract information already disclosed.

This release must receive explicit deployment/privacy approval before publication.
An email-first flow remains the privacy-preserving alternative if that disclosure
is not acceptable; it is not the selected implementation in this revision.

## Minimum backend changes

Only the isolated resolve-student-login-recognition-deploy/index.ts is prepared.
The frozen v8 resolver, broader canonical local resolver, student-profile and
link-student-identity remain untouched. SDK stays pinned to Supabase 2.118.0 and
verify_jwt=false preserves the existing pre-login endpoint boundary.

1. inspect_setup still rejects extra request fields and uses the existing verify
   rate-limit bucket before any lookup. Admission checks require a unique eligible
   central Student record and stored email, compatible Auth linkage, no privileged
   Auth/email collision, no foreign Student link, and no duplicate active/pending
   email. Internal Auth-directory reads never provision users or send email.
2. Shared setup admission logic is reused after OTP. Email collision scans use
   bounded pagination/count checks and fail closed on incomplete data. The Student
   record is re-read before returning. No term/enrollment/organization queries are
   needed for these three persistent registry fields; missing term enrollment is
   not a new central account setup/login ban.
3. Successful inspection returns data.recognition_version=2, submitted student_number,
   and student_details containing exactly full_name, program, year_level.
4. verify_access keeps stored-email OTP verification, confirmed-email checks and
   foreign-link rejection, then rechecks admission. Its new setup_verification
   contains contract_version=2, student_number, auth_user_id and pending/active
   account_state alongside the existing Auth session. No broader recognition data
   is returned. The proof binds presentation to the newly verified Auth identity;
   it is not a new client-controlled mutation credential. The linker remains the
   server-side authority for the write.
5. Login and begin_access code remain identical to frozen v8, including existing
   unconfirmed Auth-user reuse/provisioning and generic delivery responses. No
   database schema, RPC, RLS, grants, secrets or Auth settings change is required.

The default-off VITE_ENABLE_VERIFIED_STUDENT_SETUP release flag now gates the new
lookup and dispatch flow, together with VITE_ENABLE_STUDENT_ACCOUNT_SETUP. Existing
environment files and the official production connection are unchanged. The new
flag has not been enabled. Production v8 responses cannot advance this new flow.

## Changed files

- src/pages/auth/StudentSetup.jsx and StudentSetup.css ? state order, explicit
  confirmation, three read-only fields, draft password handling, OTP completion and
  sharp mobile controls.
- src/utils/auth.js, studentSetupRecognition.js, studentSetupValidation.js and
  studentAccountSetupFeatureGate.js ? limited lookup parser, matching OTP admission
  parser, safe errors, readiness gate and unchanged login helpers.
- supabase/functions/resolve-student-login-recognition-deploy/index.ts ? isolated
  version-2 lookup/admission contract.
- tests/studentAuthCaptchaFree.test.mjs ? retain backend baseline coverage, update
  the current frontend compatibility test to reject protected v8 lookup responses.
- tests/studentSetupRecognition.test.mjs, studentSetupCompletion.test.mjs,
  studentSetupValidation.test.mjs and studentSetupRecognitionManifest.test.mjs ?
  version-2 privacy, identity, state/order, collision and package regressions.
- scripts/kandid-student-setup-recognition-browser.mjs ? synthetic responsive
  journeys with production DNS/HTTP blocked, transient test flag override only.
- docs/student-setup-verified-recognition-proposal.md ? mark old proposal superseded.
- This runbook and student-setup-recognition-manifest.json (revision 2).

The frozen v8 inspection manifest, baseline contract-readiness tests, shared security
module, profile, linker, SDK fixture, environment files and production systems are
not modified. The release manifest also hashes the unchanged shared dependency and
rollback sources; those are dependencies, not newly changed files.

## Validation results

- 79 Node regressions and 5 pinned-SDK Deno tests passed (84 total).
- 20 isolated Chrome journeys passed: 1280px, 768px, and 375px, with production
  requests blocked and no real emails/accounts/inspection counters consumed.
- Resolver Deno type check, targeted ESLint/Deno lint, syntax and diff checks passed.
- Production build passed; only a nonfatal plugin timing warning was reported.
- The 375px screenshots were inspected, including the required confirmation
  checkbox, wrapping fields, sharp buttons and password-before-OTP layout.

## Validation commands

    node --test tests/studentSetupRecognition.test.mjs tests/studentSetupRecognitionReadiness.test.mjs tests/studentSetupCompletion.test.mjs tests/studentSetupValidation.test.mjs tests/studentSetupInspectionManifest.test.mjs tests/studentSetupRecognitionManifest.test.mjs
    $env:DENO_DIR=(Resolve-Path .tmp/anchor-scheduler-tools/deno-cache).Path
    .\.tmp\anchor-scheduler-tools\deno\package\deno.exe check --no-config --no-lock --cached-only supabase/functions/resolve-student-login-recognition-deploy/index.ts
    .\.tmp\anchor-scheduler-tools\deno\package\deno.exe test --no-config --no-lock --cached-only tests/studentSetupPinnedSdk.test.ts
    .\.tmp\anchor-scheduler-tools\deno\package\deno.exe lint --rules-exclude=no-import-prefix supabase/functions/resolve-student-login-recognition-deploy/index.ts
    .\node_modules\.bin\eslint.cmd src/pages/auth/StudentSetup.jsx src/utils/auth.js src/utils/studentSetupRecognition.js src/utils/studentSetupValidation.js src/utils/studentAccountSetupFeatureGate.js
    node scripts/kandid-student-setup-recognition-browser.mjs
    npm.cmd run build

Tests cover exact pre-OTP allowlisting; generic rejected records; rate limiting;
collisions including later pages/truncation; read failures; foreign identities;
wrong/expired OTP; stored-email targeting; no pre-OTP password payload/write;
no term-dependent setup ban; unchanged login/dispatch; already-active accounts;
strict contract parsing and frozen rollback integrity. Historical v8 privacy tests
remain labelled against that baseline, not the newly approved disclosure contract.

The browser uses synthetic credentials/responses and blocks production requests;
its test-only release override, HMR suppression and PWA prompt dismissal do not
change actual environment/app settings. It checks desktop, tablet and 375px, exact
three read-only fields, compulsory confirmation, password-before-OTP order,
absence of email at every stage, no draft storage, duplicate-click protection,
expired/mismatched sessions, failed admission/linking, refresh and explicit login.
No genuine inspection counter, email, account or Student record is touched.

## Deployment and activation ? separate approval required; do not execute now

1. Review revision-2 manifest hashes and privacy trade-off. Reconfirm production
   target fszgdxqxonqqcrzsnkca, ACTIVE resolver baseline/source and verify_jwt=false
   against the frozen v8 rollback package. Stop on drift. Keep the new flag off.
   Also confirm the existing production setup feature is disabled: the new lookup
   response is intentionally incompatible with the old protected-inspection UI.
   Ordinary login remains compatible; do not enable an old setup UI against it.
2. In a fresh isolated staging root, copy only the manifest's two deployment_files
   to deployed_name mappings. Create minimal supabase/config.toml with project_id
   fszgdxqxonqqcrzsnkca and functions.resolve-student-login verify_jwt=false. Do not
   deploy the broader canonical resolver or other local function packages.
3. After explicit resolver deployment approval, use from that staging root:

       supabase functions deploy resolve-student-login --project-ref fszgdxqxonqqcrzsnkca --no-verify-jwt

4. Verify ACTIVE status, verify_jwt=false, downloaded entrypoint/shared hashes,
   pinned SDK and unchanged other functions. Any live inspect_setup consumes
   existing counters and intentionally discloses limited data; obtain separate
   permission for those verification requests. Stop on mismatch or excess fields.
5. After backend verification and separate activation approval, set the existing
   new release flag true in the intended local environment and restart Vite.
   Frontend production environment/deployment changes require separate approval.
6. Obtain separate consent for one genuine setup test. The lookup must show only
   the three fields; confirmation must precede password configuration; code must
   go only to the stored email; no password write before verified OTP; completion
   must require the linker acknowledgement; logout/login must work. Do not use
   synthetic production records or auto-resend/retry any uncertain result.

## Rollback and remaining limitations

Keep/return the new flag to false first (only after approval), then restore only
resolve-student-login from the manifest's frozen v8 entrypoint/shared files through
the same isolated mapping, with verify_jwt=false. Verify source/status afterward.
The new frontend deliberately refuses the old protected lookup response. Do not
weaken profile access or fetch the three fields directly from browser tables as
fallback. No migration/data rollback is required.

Delivered email, consumed OTP/counters, disclosed recognition fields, legitimate
Auth creation/password changes and Student links cannot be undone by source
rollback. Never delete/reset accounts as automatic recovery. A read failure after
OTP may consume the code: block completion and require an explicit new request
subject to cooldown. An uncertain linker result never causes automatic retry.

The unchanged linker validates admission, updates the password through Auth, then
links/activates in Postgres. These are two services, not one atomic transaction:
a final database failure can occur after a password update. Do not display Complete
without matching active-record acknowledgement. This inherited limitation is not
expanded or represented as atomic by this release. Concurrent record changes are
handled by fresh admission checks, not a transaction spanning lookup/OTP/linking.
Live email delivery and genuine end-to-end setup remain untested and approval-gated.
