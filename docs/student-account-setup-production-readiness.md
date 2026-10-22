# Student Account Setup production readiness

Local remediation is now prepared in
[the version-3 security release](student-setup-security-release.md). The findings
below describe the unchanged deployed v9/v6 baseline, not that new candidate.
Production has not been changed or enabled.

Assessment: **NO-GO for a flag-only production release.** Prepared 2026-10-22
against the official Supabase project `fszgdxqxonqqcrzsnkca` and the public
`https://witkandid.vercel.app/student-setup` frontend. No production configuration,
application data, Auth users, deployments, or Git remotes were changed. No OTP
emails or live student lookup/verification requests were sent.

## Exact disabled condition

`src/utils/studentAccountSetupFeatureGate.js` requires BOTH values to equal the
literal string `true`:

```dotenv
VITE_ENABLE_STUDENT_ACCOUNT_SETUP=true
VITE_ENABLE_VERIFIED_STUDENT_SETUP=true
```

`StudentSetup.jsx` uses this combined gate for recognition, disables Find Student
ID when it is false, and displays the reported readiness message. OTP dispatch
also checks both gates. There is no development-mode bypass for these flags.

Fresh public asset inspection at 2026-10-22 13:52 UTC established:

| Environment | Account setup flag | Verified setup flag |
| --- | --- | --- |
| Local `.env` plus ignored `.env.development.local` | `true` | `true` |
| Live production bundle, `MODE=production` | Absent | Absent |

Thus both evaluate false in production. This proves the build's effective values;
private Vercel variable scopes and release-history intent were not accessible.
The local source comments and release documents deliberately keep setup opt-in
pending release/email/privacy approval. Board Student Registration approval and
its separate flag do not approve this self-service setup release.

Fresh production assets:

- Entry: `/assets/index-D54Ufblk.js`, SHA-256
  `ef0621fca6477f5eca449c4c782e1248eb9126d5244696c2de7f214b81694198`.
- Client: `/assets/supabaseClient-BwSaqD-e.js`, SHA-256
  `b58b717401f90cfbc728887af8fe09b1f000b4ef0c9ba527d4edeafe579c0624`.
- Setup: `/assets/StudentSetup-DIFNqfZf.js`, SHA-256
  `abf044d95c0b942ce8336b60c9669c7f3be4f3f1fd01177d022a41118bb00a91`.

The compiled client points to the official Supabase URL. No public key values
were printed. Neither CORS nor a missing recognition handler causes this disabled
button: the gate prevents lookup before those requests occur.

## Workflow and dependencies

| Stage | Existing operation | Trust and side effects |
| --- | --- | --- |
| Find Student ID | `resolve-student-login`, `inspect_setup` | Rate-limit RPC before lookup; version-2 limited recognition response; no Auth creation or email. Consumes rate counters, so not called live during this assessment. |
| Confirm information | UI checkbox, read-only name/program/year | Acknowledgement only; does not prove identity. |
| Configure password | UI validation and component memory | Not sent with lookup/OTP requests or persisted in browser storage. |
| Issue/resend OTP | Resolver `begin_access` | Stored student email selects recipient. May create an unconfirmed Auth identity, then `signInWithOtp` with `shouldCreateUser:false`. Neutral 202 does not prove delivery. |
| Verify OTP | Resolver `verify_access` | Six decimal digits; stored email; Auth `verifyOtp(type:'email')`; fresh admission check; version-2 proof binds Student ID and confirmed Auth UID. |
| Establish verified session | `auth.js`, `setSession`, fresh `getUser` | Rejects unsupported proof, mismatched UID/ID, unconfirmed email, failed or expired session. |
| Activate account | `link-student-identity`, `setup_mode:true` | Independently authenticates caller and checks stored email/link/status. Updates password through caller-authorized `PUT /auth/v1/user`, then conditionally links/activates `public.students`. |
| Complete/login | Matching active-record acknowledgement; local sign-out; explicit login | No success on an uncertain linker response. `student-profile` supplies the linked active profile for navigation/login. |

Only the rate-limit RPC is required by these setup handlers:
`public.kandid_consume_student_auth_rate_limit(text,text,text)`, using the private
rate-bucket table. Identity reads/linking use existing tables through service-role
Edge clients; browser access is not broadened. No setup RPC creates enrollment,
memberships, votes, or election eligibility. Central account activation is separate
from current-term enrollment verification. Existing election controls must remain
unchanged; this assessment does not claim a fresh audit of every voting path.

## Deployed backend evidence

Read-only function downloads and metadata at 13:52 UTC confirmed:

| Function | Deployed state | Gateway JWT | Reviewed source match |
| --- | --- | --- | --- |
| `resolve-student-login` | ACTIVE v9 | false, required before login | Recognition deployment package, exact entrypoint bytes |
| `link-student-identity` | ACTIVE v6 | true | Local linker, after LF normalization |
| `student-profile` | ACTIVE v7 | true | `student-profile-readonly-deploy`, exact entrypoint bytes |

Entrypoint SHA-256 values, respectively:

```text
4cbc45350f4e19ff149b5a15f32560ba606b57a4287f0d41d9cc8994b1e6bcd8
7debadda3deff074d6388d93d0b7c4408e05281d36005907433e8943cf31d405
42976c3282c5102624a322e7c5b8e03d236eff0e2089089805069f775eca7e6a
```

The old v8 wording in the recognition preparation documents/gate comment is a
historical baseline, not the current deployed resolver. A resolver deployment is
not needed just to obtain recognition v2. Do not deploy the broader canonical
resolver or replace the deployed read-only profile with a different local variant.

All three functions returned OPTIONS 204 with exact production-origin allowance.
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and
`STUDENT_AUTH_RATE_LIMIT_HMAC_SECRET` secret names are present. Only presence was
examined; HMAC length and runtime correctness were not established by secret
listing. Resolver rejects missing/short HMAC configuration or untrusted source IP.

Read-only catalog inspection confirmed:

- Rate RPC exists, SECURITY DEFINER with `search_path=pg_catalog`; executable by
  service_role, not anon/authenticated. No RPC was executed.
- Atomic 15-minute buckets: IP 40 requests; per-ID setup dispatch 3; per-ID
  login/verify 8. Inspection and OTP verification share the verify bucket, so
  repeated lookups reduce remaining verification attempts.
- RLS enabled on students and private rate buckets. Existing policies/grants were
  not changed. RLS alone does not replace admission checks in service-role code.
- Students have unique Student ID and a partial unique non-null Auth UID index,
  plus Auth-user foreign key and established status check. There is no email
  uniqueness constraint. The sole non-internal students trigger is the existing
  audit trigger; its null-caller service-role path returns without an admission
  check. These protections do not close the linker gaps below.

## Security blockers

1. **Recognition deliberately permits limited enumeration.** An eligible ID
   returns a full name, program and year; an unavailable ID returns 404. Rate
   limits mitigate bulk abuse but cannot conceal existence or those fields.
   CORS is not authentication. The existing preparation document explicitly
   describes this privacy reduction and requires production/privacy approval.
   If preventing enumeration means no pre-OTP identity disclosure, this contract
   cannot meet it: an approved email-first/OTP-first recognition change is needed.
   Do not describe the current contract as enumeration-proof or simply enable it.
2. **Resolver/linker admission mismatch.** Synthetic real-handler execution with
   two pending records sharing an email: resolver rejects 404; direct linker with
   that email owner's valid confirmed session returns 200 and activates a record.
   Linker checks active-email collisions, whereas resolver checks active/pending.
3. **Truncated collision checks.** With an API row cap of 1,000 and a privileged
   email collision at row 1,001, resolver's paginated scan rejects 404; the linker's
   unpaginated scan misses it and activates the synthetic record. Its student-email
   scan is likewise unpaginated. Browser flow controls are not a server boundary.
4. **Stale final write.** A synthetic record disabled and email-changed after the
   initial checks is still activated by the linker: final update binds ID and old
   Auth-link state, but not the verified email or original status. Catalog review
   found no compensating production constraint/trigger. This is a reproducible
   race in the source, not evidence that a real account was affected.

Confirmed controls remain valuable: unknown/disabled/ambiguous recognition fails;
caller email cannot select OTP recipient; invalid/unconfirmed/foreign sessions
cannot claim another email identity; JWT-derived UID is used; HMAC limits fail
closed; unsupported or mismatched proof cannot advance; passwords are not sent
pre-OTP. The UI sends already-active accounts to login without calling the linker.
However, a direct linker call by that account's confirmed email owner still updates
its password before returning the active acknowledgement. Do not generalize the UI
test into a claim that this endpoint forbids password changes for active accounts.

Password change and student linking span Auth and Postgres and are not atomic.
A later database failure may leave a changed password without completed linking.
There is no automatic account deletion/reset or uncertain-result retry.

## Auth and email readiness

Public Auth settings: email enabled, signups enabled, email autoconfirm false.
Read-only CLI `config pull --dry-run` in an isolated folder confirmed confirmation
enabled, custom SMTP enabled, configured host/user/sender, SMTP port 465 and an
email-sent rate limit of 30 per hour. No config pull was applied, no SMTP password
was printed or persisted, and no settings were changed. This rate is a capacity
constraint for rollout, not a reason to silently increase it.

Still unverified: production OTP length/expiry, confirmation and magic-link email
template bodies, SMTP credential validity, provider sender/domain authorization,
deliverability, and runtime rate-limit/source-IP behavior on actual setup POSTs.
The CLI configuration preview does not expose all Auth fields; missing evidence
must not be interpreted as missing configuration. Local config sets six-digit
OTP/3,600-second expiry and points both templates at
`supabase/templates/student_email_otp.html`; this does not prove hosted settings.
Review hosted templates for `{{ .Token }}` and six-digit OTP compatibility before
release. Supabase documents the distinction between a magic link and a numeric
OTP in its [email templates](https://supabase.com/docs/guides/auth/auth-email-templates)
and [passwordless email](https://supabase.com/docs/guides/auth/auth-email-passwordless)
guides. [Custom SMTP configuration](https://supabase.com/docs/guides/auth/auth-smtp)
alone does not establish successful delivery.

## Validation and reproducibility

- Existing targeted Node suite: **129 passed, 0 failed** (auth, recognition,
  completion, validation, lookup failures, source manifests, shared CORS/security).
  Historical v8 privacy tests exercise the rollback baseline, not deployed v9.
- Pinned Supabase SDK 2.118.0 Deno tests: **5 passed, 0 failed**, synthetic fetch
  responses, no network permission. Cached-only Deno resolver type check passed.
- Chrome synthetic workflow: **24 passed** at 1280, 768 and 390px. Confirmation,
  password-before-OTP, disabled/unknown/limited/unavailable/network states, old or
  overbroad contracts, invalid/expired OTP, foreign proof, session changes/expiry,
  existing account, refresh and linker failure covered. No overflow or runtime
  exceptions; reviewed 390px screenshot. All Supabase traffic was intercepted;
  DNS also blocked Supabase. No real accounts, emails, or enrollment writes.
- Production-mode local build with both flags enabled only in the child process:
  **passed**, including PWA output. Scoped frontend ESLint: **passed**. Build's
  plugin-timing warning is nonblocking. No environment file was edited.
- Additional release diagnostics reproduced the **three backend admission gaps**
  above. The new diagnostic command intentionally exits nonzero with `NO_GO`:

  ```powershell
  node scripts/assess-student-setup-production-release.mjs
  ```

  It executes real handlers against synthetic services, writes sanitized evidence
  to `.tmp/student-setup-readiness/release-assessment.json`, and also runs the
  imported harness's 31 existing passing tests. A passing regression suite is not
  a release approval; the diagnostic findings are separate blocking criteria.

Read-only evidence and browser/build artifacts remain ignored under
`.tmp/student-setup-readiness/`. These tests do not claim actual hosted SMTP or
complete live GoTrue/Postgres/SMTP integration. The existing local Mailpit/GoTrue
integration script was not run because it creates Auth users and dispatches email;
the present instruction prohibits those actions without approval.

## Minimum correction and approval scope

No application source or environment configuration was changed. Per AGENTS.md,
implementation stopped at the identified authentication-boundary blockers.

Before requesting frontend activation approval:

1. Resolve/approve the pre-OTP disclosure requirement. Strict enumeration prevention
   requires a separately reviewed workflow/recognition contract change; privacy
   acceptance must explicitly acknowledge the existing three-field disclosure.
2. Separately approve a narrowly scoped linker hardening change: enforce the same
   active/pending and privileged/foreign identity admission at the final endpoint,
   make scans complete or fail closed, and bind the final write to verified stored
   email, expected status and Auth-link state. Reproduce the above cases as
   rejection tests. Review concurrent identity changes and the Auth/Postgres
   partial-failure boundary explicitly; do not claim a cross-service transaction.
   No new enrollment model, eligibility exception, or broad RLS/grant change is
   proposed. Any required database-level serialization would need its own exact
   reviewed SQL scope; no migration is prepared or authorized by this assessment.
3. Read-only review of hosted OTP/template settings and email-provider readiness.
   Any identified Auth/email correction needs separate exact approval. Obtain
   explicit permission before a controlled staging integration/delivery test with
   synthetic accounts and a designated recipient. Do not probe real student IDs.
4. After all blockers pass, verify `kandidato`, official project URL/key and the
   exact reviewed production source commit/deployment. Set ONLY the two flags
   above to `true` in Vercel **Production**, preserving Board and other release
   flags. Rebuild/redeploy that reviewed commit; restart alone cannot change a
   compiled Vite flag. No source push or resolver/profile deployment is inherently
   needed to flip the gate; linker deployment would be required for approved fixes.
5. Verify effective compiled flags, setup availability, existing login/Board flows,
   CORS, responsive behavior, errors and PWA refresh behavior. A real OTP/account
   completion test needs its own exact consent; public page availability proves
   neither delivery nor activation. Do not mark full end-to-end readiness without it.

None of those production changes is approved or executed by this task. Existing
Board registration approval does not cover them.

## Rollback

Capture the exact prior frontend deployment ID/source and both flag values before
any approved release. Disable both flags in Production and rebuild the same
reviewed frontend, or promote the recorded prior disabled deployment. Confirm new
assets and PWA update behavior; already-open/cached pages may retain old code.

Frontend flags hide the workflow but are **not an API kill switch**: resolver v9
already accepts recognition/OTP actions independently of these frontend flags.
Withdrawing that backend contract requires separate approval and a source-verified
compatible function rollback, not just a Vercel flag change. The existing frozen
v8 resolver package can restore protected lookup after the frontend gate is off;
it does not disable inherited OTP actions. Do not roll back unrelated functions,
JWT settings, Auth configuration, RLS, or grants as a blanket recovery step.

Keep the currently downloaded linker v6 as forensic baseline. Since it contains
the identified gaps, returning to it after hardening is not a safe open-service
rollback; disable exposure/keep release blocked and obtain an explicit containment
plan. Any email-template/configuration change needs a captured exact prior value
and individually approved rollback. Never use broad `config push` for this task.

Source rollback does not reverse sent emails, rate counters, disclosed identity
fields, Auth creation/password changes, or student links. Do not delete/reset
accounts, edit enrollment, or undo legitimate account activation automatically.
