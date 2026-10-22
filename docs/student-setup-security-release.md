# Student Account Setup security release — local candidate

Production activation: **NO-GO until the remaining hosted checks and explicit
deployment approval below.** This candidate addresses the reproduced source
blockers; production remains on the previously inspected v9 resolver/v6 linker.
Neither frontend setup flag nor any production secret/record/deployment was changed.

## What changes

The flow is now **Student ID → OTP → confirm details → password → activation**.
Find Student ID returns the same version-3 acknowledgement for known, unknown,
disabled and conflicting identities, then requests verification with a neutral
delivery notice. No name/program/year, email address or existence result is
returned before OTP. Recognition v2 responses are intentionally incompatible;
both frontend gates remain default-off. Existing UI components/styles/routes
are reused. No changes were made to App.jsx or the authenticated shells.

New deployment candidates (not deployed under their source-directory names):

- `resolve-student-login-secure-deploy/index.ts` maps to `resolve-student-login`.
- `link-student-identity-secure-deploy/index.ts` maps to `link-student-identity`.
- `_shared/studentSetupAdmission.ts` is included with the existing CORS helper.
- Both use pinned Supabase SDK 2.118.0. Resolver gateway JWT remains false;
  linker gateway JWT remains true and independently calls Auth.getUser.

The older canonical/v2 preparation sources remain frozen baselines for comparison.
**Do not deploy their directories.** The isolated release packager maps only the
reviewed secure candidates to the existing production slugs. No profile function
deployment is required; deployed read-only student-profile remains unchanged.

`STUDENT_SETUP_SECURITY_ENABLED` is a new **server-only**, default-off switch.
It gates every setup action in both secure endpoints, including recognition and
OTP dispatch. Ordinary Student login remains compatible and works with this
switch off. It is not a VITE variable and must not be moved into browser code.

## Database enforcement

`supabase/proposals/student-setup-security.sql` is review-only, not a migration
applied to production. It adds four service-only RPCs, one private helper and
one private authorization journal. It changes no existing account, enrollment,
membership, vote, receipt, officer or election rows and no existing RLS policies.

| RPC | Purpose |
| --- | --- |
| `kandid_student_setup_admission_v1(text,uuid,text)` | Complete database admission before OTP dispatch and verification |
| `kandid_student_setup_issue_v1(text,uuid,text,text)` | Recheck admission after verified OTP and issue a five-minute authorization |
| `kandid_student_setup_claim_v1(text,uuid,text,text)` | Claim one authorization before a password request |
| `kandid_student_setup_finish_v1(text,uuid,text,text)` | Recheck current state/collisions and atomically link/activate after successful password response |

All stages use `private.kandid_setup_record_v1`: unique Student ID; central
pending/active status; pending identities unlinked; normalized active/pending
email uniqueness; no privileged email/Auth-UID collision or foreign Student link;
and a matching confirmed Auth email/UID when verification is required. Checks
use complete SQL EXISTS/relations, not capped API lists. Existing Auth identities
are read, never written, by this SQL. Auth passwords continue through the
verified caller's self-service Auth endpoint, not an administrator password reset.

`private.student_setup_proofs` stores only a hash of a random 256-bit token,
Student/Auth IDs, email hash, expected state and lifecycle timestamps. It stores
no password, raw token, name, email address, enrollment or organization registry.
No browser/service-role direct table access is granted. Its purpose is a single-use
OTP authorization journal, not another identity source. Tokens live only in
component memory and are bound to the freshly checked Auth UID.

Short, consistently ordered table locks serialize mutation RPCs against normal
student/admin writes; lock waits fail after five seconds. The locks are released
before the external password call. A partial unique index permits one unresolved
password claim per Student. Replays/concurrent claims are rejected **before**
another password write. Finalization rechecks status, email, existing link and all
collisions under the same transaction as activation. A disabled or changed record
cannot be overwritten with the earlier snapshot.

Current-term enrollment is deliberately not a login/setup requirement. Every
setup stage uses the same persistent-identity admission rules; account setup does
not enroll a Student or grant voting/candidacy eligibility. Existing current-term
verification, RLS, schedule, duplicate-vote, receipt and blockchain controls remain
unchanged. New service-only EXECUTE grants apply only to the new functions.

## OTP and email verification

Read-only management configuration preview, **2026-10-22 14:43 UTC**, official
project, `dry_run=true`, `wrote=false`, no production SQL:

| Hosted setting | Observed |
| --- | --- |
| Email confirmations | Enabled |
| Numeric email OTP length | 6 |
| OTP expiry | 3,600 seconds |
| SMTP minimum resend interval | 60 seconds (`1m0s`) |
| Minimum password length | 6; existing setup also requires letter/digit/symbol |
| Custom SMTP | Enabled, port 465; host/user/sender presence verified previously |
| Auth email-sent limit | 30/hour |

Existing service-only HMAC RPC quotas remain unchanged: IP 40/15 minutes; per-ID
dispatch 3/15 minutes; per-ID verification 8/15 minutes. Recognition shares that
verification bucket, so lookups consume part of the allowance. Known and unknown
IDs are limited before lookup; no missing limiter/HMAC configuration is bypassed.
The UI honors Retry-After, uses a 60-second resend countdown and prevents duplicate
submissions. New proof lifetime is five minutes after successful OTP verification;
refreshing the Auth session does not extend it.

Production confirmation/magic-link **template bodies and actual delivery remain
unverified**: the CLI preview exposes subjects, not bodies/SMTP credentials or
provider deliverability. Do not mistake absence of those fields for missing
configuration. Before activation, inspect both hosted bodies for `{{ .Token }}`,
confirm there is a usable numeric code and no dependence on a magic-link redirect,
and verify the sender/provider's authorization and quota. No configuration change
is proposed just because that read-only evidence is incomplete. The local
Mailpit/GoTrue fixtures test both template types without real recipients.

## Verification commands and evidence

All fixture commands are local and load no production credentials:

```powershell
node scripts/kandid-student-setup-security-pg17.mjs
node --test tests/studentSetupSecurity.test.mjs
node scripts/kandid-student-setup-security-integration.mjs
node scripts/kandid-student-setup-security-browser.mjs
node scripts/prepare-student-setup-security-release.mjs
```

The PostgreSQL/integration scripts verify the exact known disposable container,
project label and loopback port before creating new scratch databases. Integration
uses new synthetic GoTrue users and delivers only to the verified local Mailpit
container with `.invalid` recipients. It does not contact official Supabase.
The browser suite intercepts all Supabase traffic before navigation and also
blocks Supabase DNS; its feature-gate override exists only inside that test browser.
No environment file or real frontend flag is enabled for testing.

Evidence is ignored under `.tmp/student-setup-security/`: PostgreSQL results,
integration log, regression TAP, hosted policy metadata, browser results/screenshots
and build/release output. Frozen v8/v9 manifest tests remain historical tests;
the version-3 manifest explicitly binds the changed frontend/shared transport
sources without rewriting earlier backend baseline evidence.

The original `assess-student-setup-production-release.mjs` intentionally still
diagnoses the frozen deployed v9/v6 baseline as NO-GO; it does not evaluate the new
candidate. The new PostgreSQL, handler and integration suites are its replacement
for candidate acceptance. See the final validation record below for actual counts.

## Exact production approval scope — nothing executed

1. Review the version-3 manifest, SQL and locks/recovery behavior. Confirm official
   Supabase project and the exact reviewed frontend commit. No Git push is included
   in this approval scope; a reviewed source must be available before Vercel rebuild.
2. Verify hosted template bodies/provider readiness read-only. A controlled genuine
   delivery/account test needs a separate named-recipient/account approval; none
   is implied by this task. Do not create synthetic production student records.
3. Approve application of **only** `student-setup-security.sql` after confirming
   its objects do not already exist and source/schema match review. It is additive,
   transactional and fails on object drift. No migration-history repair, broad db
   push, existing RLS/grant change or enrollment backfill is included.
4. With server setup switch explicitly false, deploy **only** the two secure
   functions from the isolated package to their mapped existing slugs. Preserve
   resolver `verify_jwt=false` and linker `verify_jwt=true`. Download and compare
   entrypoint/shared hashes, status and RPC grants after deployment. Do not deploy
   `student-profile`, other local function directories, or broad config.
5. After backend review and separately authorized verification, approve setting
   `STUDENT_SETUP_SECURITY_ENABLED=true`. Both frontend flags remain off until
   the coordinated frontend release is approved. Any setup POST consumes state,
   counters or may send email and therefore requires its own exact consent.
6. Separately approve enabling BOTH existing VITE setup flags only for
   `kandidato` Production and rebuilding the reviewed frontend. Preserve every
   unrelated release variable. Check new assets, PWA update, mobile navigation,
   ordinary login, existing-account handling and actionable errors. Do not
   force-enable DOM controls or accept old recognition contracts as fallback.

Local packaging copies only four function files plus review-only SQL and a
minimal config. It invokes no deployment/SQL/network command. The reviewed
Supabase deployment commands, **for use only after approval**, are:

```text
supabase functions deploy resolve-student-login --project-ref fszgdxqxonqqcrzsnkca --no-verify-jwt --workdir <isolated-release-directory>
supabase functions deploy link-student-identity --project-ref fszgdxqxonqqcrzsnkca --workdir <isolated-release-directory>
```

The exact local release directory is emitted by the packager; it is not a
production destination or a substitute for source review.

## Rollback and uncertain password requests

Disable the server setup switch first through an approved configuration change;
ordinary login stays available. Disable both frontend flags and rebuild/promote
the recorded disabled deployment; already-open/PWA pages may retain old code,
which is why the server switch is necessary. Preserve JWT settings and the secure
handlers in disabled mode. **Never reopen the vulnerable v6/v9 baseline.**

Auth password update and Postgres activation cannot share a transaction. If Auth
times out, fails, or finalization sees drift, the endpoint returns a fixed recovery
error and leaves the claim unresolved. UI success is withheld, repeated submission
is blocked, and no background retry/reset/delete is attempted. The Student can
remain pending or disabled; eligibility is not restored by an uncertain result.

An unresolved claim intentionally stays blocked after expiry because an expired
network timeout does not prove Auth made no write. Disable setup, drain workers,
and have an authorized operator confirm the actual Auth outcome/current identity.
Only after separate approval of one exact stored proof hash and Auth UID may
`student-setup-security.recover.sql` run in an explicit outer transaction with
the three transaction-local settings documented in that file. It requires exactly
one expired unresolved claim, rejects wrong/replayed/completed scopes, records
recovery time and permits a **new OTP proof**. The original proof remains unusable.
It never changes passwords, student records or enrollment. Do not automatically
release leases or infer outcome from the browser error.

`student-setup-security.rollback.sql` removes only the five new functions and
refuses to run with unresolved claims. It preserves the private journal and all
existing data. It uses no CASCADE. Schema rollback is optional: keeping the secure
functions disabled is safer than removing required dependencies while requests
may still be running. Source rollback cannot undo email delivery, disclosure,
Auth creation/password changes or a completed legitimate account activation.

Remaining operational risks are brief global student/admin write contention,
unresolved claims requiring reviewed recovery, residual dispatch timing/delivery
side channels despite neutral responses/minimum failure timing, and shared-IP
quotas affecting a large campus NAT. None is addressed by weakening verification
or silently raising limits. No claim is made that this prevents every possible
timing-based enumeration signal or that local email capture proves hosted delivery.

## Final local validation record — 2026-10-22

- **189/189 targeted Node tests passed**, including the 11 new handler/security
  tests, login differential checks against deployed v9 behavior with setup disabled,
  transport restrictions, current-term voter/candidacy regressions, environment
  validation and both historical/current release manifests.
- **28/28 PostgreSQL checks passed**, using scratch DB
  `kandid_setup_security_ee35e07081b4`. Coverage includes normalized duplicate
  pending/active emails, privileged collisions beyond 1,000 rows, disabled/foreign
  identities, expiry/replay, real concurrent sessions, stale identity/status,
  new collisions during password setup, exact-scope recovery and guarded rollback.
- **13/13 actual local GoTrue/PostgreSQL/Mailpit integration checks passed**:
  confirmation and confirmed-user magic-link-template numeric OTPs, resend throttle,
  wrong/expired/consumed OTPs, successful password login after activation, consumed
  proof rejection, real SQL quotas and unchanged enrollment. All users/recipients
  are synthetic; no real SMTP delivery or production request occurred.
- **26/26 isolated browser scenarios passed** at 1280px, 768px and 390px, including
  unknown-ID privacy, old/overbroad contracts, lookup/OTP/network failures, confirmed
  existing account, expired/foreign proof, session changes, single final submission,
  and proof expiry despite Auth refresh. No overflow/runtime errors; 390px
  screenshots reviewed. No real accounts or emails were created by browser tests.
- **5/5 pinned-SDK Deno tests passed** with no network permission. Both secure
  endpoints passed Deno type checks and bundle generation. Deno's bundler reports
  its experimental status; this is a tooling notice, not a type/bundle failure.
- **Scoped ESLint, git diff whitespace checks, and production Vite/PWA build passed**.
  Both frontend flags were explicitly false only in the build process; no
  environment files were edited. The build has a nonblocking plugin-timing warning.
- The release packager validates hashes and prepares only the mapped local files;
  it does not deploy or execute SQL. Candidate changes remain uncommitted.

**GO for review of the local remediation candidate; NO-GO for Production
activation today.** Remaining release conditions are review/application of the
scoped SQL and functions, hosted template-body/provider verification, and explicitly
approved deployment and genuine delivery/account verification. The confirmed
source blockers are covered by passing local tests; local Mailpit success cannot
replace those hosted checks. No production SQL was executed during this task.
