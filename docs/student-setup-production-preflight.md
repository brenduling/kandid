# Student Account Setup — final production preflight

**NO-GO.** Read-only observations on **2026-10-22, 15:02–15:10 UTC** found an
enabled production frontend still connected to the legacy resolver v9/linker v6.
Those functions retain the previously reproduced admission and stale-write gaps.
The hardened candidate is prepared locally, not deployed. No production SQL,
deployment, flag change, OTP request or account mutation was performed here.

## Material change since the earlier readiness report

The live `/student-setup` assets now contain BOTH flags set to the literal string
`true`:

```text
VITE_ENABLE_STUDENT_ACCOUNT_SETUP=true
VITE_ENABLE_VERIFIED_STUDENT_SETUP=true
```

The effective compiled mode is `production`, using the official Supabase URL and
a public key accepted by the public Auth-settings GET. This observation does not
prove private Vercel environment scopes or identify who changed them.

The live UI still contains the password-before-OTP instructions and no
`setup_token` integration. It is not the reviewed version-3 frontend. The new
server switch `STUDENT_SETUP_SECURITY_ENABLED` is absent. **Setting that switch
false alone cannot contain v9/v6: those legacy handlers do not read it.**

No real Student ID was submitted and no student details were retrieved. The
finding concerns enabled legacy code, not evidence of an actual account compromise.

## Checks and evidence

| Area | Result |
| --- | --- |
| Official Supabase target | Explicit CLI project `fszgdxqxonqqcrzsnkca`; live client URL matches |
| Resolver | ACTIVE v9, gateway JWT false, exact downloaded entrypoint matches frozen v9 |
| Linker | ACTIVE v6, gateway JWT true, normalized source matches frozen v6 |
| Profile | ACTIVE v7, gateway JWT true, matches reviewed read-only profile |
| Shared CORS helper | Downloaded copies match the reviewed helper after LF normalization |
| Production CORS | All three functions return OPTIONS 204 with exact `https://witkandid.vercel.app` origin and required headers |
| Public Auth | Email enabled, signup enabled, autoconfirm false; GET succeeds |
| Core Edge secrets | URL, anon key, service-role key and rate-limit HMAC secret names present; values not printed or inspected |
| Optional origin override | Present; official production origin is also in the reviewed static allowlist |
| New server release switch | Absent; defaults off only in the new secure handlers |
| Candidate package | Reviewed manifest and all four function files/three SQL files match exactly |
| Local release manifest tests | 3 passed |
| Production-origin compatibility | 3 new synthetic handler tests passed using the official URL/origin and Cloudflare source-IP path, with no Kong/localhost fallback |
| Prepared production build | `MODE=production`, official URL, setup flags false, OTP-first copy and opaque-proof integration present |
| Existing validation | 189 Node, 28 PostgreSQL, 13 local Auth/Mailpit, 26 browser and 5 SDK checks passed in the preceding implementation; type/bundle/lint/build passed |

The prepared package is:

```text
.tmp/student-setup-security/release-f8d2e2176bf1/
```

Current source, packaged copies, and the package's `review-manifest.json` were
compared without regenerating or changing the reviewed package. The immutable
entrypoint/SQL hashes are in `docs/student-setup-security-manifest.json`.

Live assets observed:

```text
/assets/index-CQEXlaW5.js
  97961cab562d86731bdc09fec1e8200c5fa7aec76d866b42072179ed37c028af
/assets/supabaseClient-CmNJZlog.js
  963f09d41a79bf85c8975ed75c3d41f97428c4c4779f58cc803ab5d13a3e6787
/assets/StudentSetup-DjVj87BP.js
  5a995f0f7801cf10d8f01ebc4de38777f655326fdb4db2d2980bd0a24fd6d7a0
```

The latest public GitHub Production record is ID `7252408390`, SHA
`3b153e57b4e45b618c0cca1c01011f2927276ebd`; its latest reported successful alias
is `kandidato-eobome7tn-mabrenquiro-2764s-projects.vercel.app`. That record's ref is
the SHA, not a branch name. It is supporting provenance, not authenticated proof
of the custom domain's current Vercel project, deployment ID, source or branch.

Local HEAD is that same SHA; local `main` tracks `origin/github-checkpoint`.
The hardened candidate remains uncommitted. Do not redeploy that old SHA and
assume it contains these fixes.

## Hosted OTP and email policy

Refreshed through `config pull --dry-run` in an isolated local directory, with
`wrote=false`. This reads management configuration, not production SQL.

| Setting | Confirmed value |
| --- | --- |
| Email confirmations | Enabled |
| Email OTP length | 6 digits |
| OTP expiry | 3,600 seconds |
| Minimum resend interval | 60 seconds |
| Minimum Auth password length | 6; existing setup also requires letter/digit/symbol |
| Custom SMTP | Enabled, port 465 |
| SMTP host/user/sender | Present; no values printed |
| Auth email-sent quota | 30/hour |
| Site URL | Matches production frontend |
| Additional redirects | Include production |

Existing application quotas from the earlier catalog capture are IP 40/15
minutes, dispatch 3/ID/15 minutes, verify 8/ID/15 minutes. Recognition shares the
verify bucket. The new five-minute proof expiry is separate from Auth OTP expiry.

**Unverified:** hosted confirmation and magic-link template bodies, SMTP credential
validity, sender-domain authorization and actual delivery. The CLI exposes template
subjects, not bodies. `containsTokenVariable=false` for a *subject* is not evidence
that the body lacks the variable. Review both hosted bodies for `{{ .Token }}` and
a usable six-digit code. Neither an OPTIONS success nor SMTP configuration proves
delivery. Do not increase quotas or modify Auth settings just to pass preflight.

## Schema, permissions and RLS — blocked fresh checks

Your explicit **no production SQL** restriction includes catalog SELECTs. No
production schema dump, db lint, migration query or application RPC was used as a
workaround. Fresh schema drift, object-name collisions and database grants/RLS
cannot be certified with the available management capabilities under that rule.

Prior official-project catalog snapshots establish PostgreSQL 17.11 and compatible
Student fields: integer ID/year level, varchar Student ID/email/status/name/program,
UUID Auth link, unique Student ID and a partial unique non-null Auth UID index.
Students/admin-users RLS was enabled; the existing limiter was service-only with
SECURITY DEFINER and `search_path=pg_catalog`. These are **historical evidence**,
not a current drift check. Required Auth-user columns were not covered by that
column snapshot.

A narrowly scoped query is prepared, **not executed in production**:

```text
supabase/proposals/student-setup-security.preflight-readonly.sql
```

It runs in a read-only transaction, reads only catalogs, hashes policy/function
bodies, and reports prerequisites, constraints, indexes, RLS, grants, triggers and
new-object presence. It invokes no application RPC and reads no student rows.
It was validated in the verified synthetic PostgreSQL scratch database.
Separate approval for that exact read-only production check is needed before
claiming fresh database readiness.

Before installation, verify all required columns/types, the existing limiter's
signature/source/ACL, uniqueness, audit trigger behavior and `auth.users` fields.
All seven new objects (four public functions, private helper, private table and
unique index) must be absent, or installation must stop for drift review. After
installation, four RPCs must be service-only, the private helper/table inaccessible
directly to application roles, and proof-table RLS enabled. Existing students,
admin, enrollment and election policies/grants must remain unchanged.

## Vercel identity/environment — blocked private checks

Vercel and Supabase integrations were discovered but are not connected; their
existing suggestions were not repeated. No Vercel token, CLI Auth session or
workspace project link was available. Therefore the following remain unverified:

- Authenticated identity of `kandidato`, its account/project ID and domain mapping.
- Exact current deployment ID/source branch/commit and prior safe rollback target.
- Private Production variable scopes, build attestation and Node/build settings.
- Whether the reviewed candidate source is available on the configured branch.

Required configuration inventory:

| Place | Required configuration | Observation |
| --- | --- | --- |
| Vercel Production | `VITE_SUPABASE_URL` official project URL | Correct in live bundle |
| Vercel Production | `VITE_SUPABASE_KEY` public client key | Present; public Auth-settings GET accepted it; never printed |
| Vercel build | `KANDID_SUPABASE_KEY_PROJECT_REF=fszgdxqxonqqcrzsnkca` when using a publishable key | Private build-only attestation not independently verified |
| Vercel Production | Both setup VITE flags | Currently true in live bundle; must be held false during the reviewed release |
| Edge Functions | URL, anon key, service-role key | Names present; runtime key validity not proven by listing |
| Edge Functions | `STUDENT_AUTH_RATE_LIMIT_HMAC_SECRET`, at least 32 characters | Name present; secret length/runtime behavior unverified without use |
| Edge Functions | `STUDENT_SETUP_SECURITY_ENABLED` | Absent; set false before approved containment/release, true only at approved readiness step |

No server secret belongs in a VITE variable. The application uses
`VITE_SUPABASE_KEY`, not an assumed `VITE_SUPABASE_ANON_KEY` alias. Preserve all
unrelated Board/election/environment variables.

## Ordered release and containment — approval required

**Immediate containment recommendation:** because the currently enabled frontend
uses legacy vulnerable functions, obtain explicit approval to disable its setup
release and close the legacy backend entry points. Frontend flags alone cannot
close direct API access. The new secure handlers can run with setup off before
the new SQL is installed: setup returns 503 before RPC use, while ordinary login
uses the unchanged limiter. Do not infer containment from setting an unused flag
on v9/v6.

1. Verify authenticated Vercel project/domain/source and record the exact current
   configuration/deployment. Approve server setup switch false, both frontend flags
   false in Production and a disabled frontend rebuild. Separately approve replacing
   only the linker and resolver with the hash-verified secure candidates, **server
   switch false**, linker first. This optional urgent containment can precede schema
   installation; it performs no setup RPC/account write. Verify source/JWT/CORS and
   confirm that setup cannot advance. Do not enable anything at this step.
2. Complete the hosted template/provider review and authorize the exact catalog-only
   query above. Compare results with the proposal; stop on any drift, unexpected
   existing object, grant or schema mismatch. A provider/template discrepancy needs
   its own narrow reviewed correction, not a broad config push.
3. With setup off, approve a controlled backup/recovery checkpoint and application
   of **only** the reviewed `student-setup-security.sql`, SHA-256
   `d2c2cf8f29cd531dfcf0c1890bea67e7f97dcfcbbe1d1d6cb13cc9a274f7885a`.
   Its explicit transaction creates only the proof journal/helper/four RPCs/index
   and their grants. No student/Auth/enrollment backfill, migration-history repair,
   broad db push, RLS weakening or destructive SQL is included.
4. If containment did not already install the secure handlers, deploy only the two
   mapped functions from the prepared package, linker first, server switch false:

   ```powershell
   node node_modules/supabase/dist/supabase.js functions deploy link-student-identity --project-ref fszgdxqxonqqcrzsnkca --workdir .tmp/student-setup-security/release-f8d2e2176bf1
   node node_modules/supabase/dist/supabase.js functions deploy resolve-student-login --project-ref fszgdxqxonqqcrzsnkca --no-verify-jwt --workdir .tmp/student-setup-security/release-f8d2e2176bf1
   ```

   These are **prepared commands, not executed**. Minimal package config retains
   linker JWT true and resolver JWT false. Do not deploy the frozen canonical/v2
   sources, student-profile or unrelated functions. Download and compare candidate
   entrypoint/shared hashes and verify post-install database grants/RLS.
5. Review and publish the candidate frontend source through a separately approved
   commit/push or verified artifact workflow; capture its actual source SHA. Build
   and deploy version 3 to `kandidato` with BOTH frontend flags false. Build in
   ordinary `production` mode with the official URL/public key and correct key
   attestation. Do not use `.env.development.local` or a localhost mode. Local
   production compilation and production-origin fixtures passed; hosted Vercel
   execution/source verification still needs authenticated access.
6. Only after backend checks pass, approve `STUDENT_SETUP_SECURITY_ENABLED=true`
   and one explicitly scoped genuine verification described below. Keep the
   frontend gated while this controlled check is performed. Verify observed OTP
   delivery/expiry and account completion, not just HTTP 202 acknowledgements.
7. After successful approved verification, approve BOTH setup VITE flags true in
   **Production only** and rebuild/redeploy the same reviewed version-3 source.
   Record the resulting Vercel deployment ID/source and verify effective flags,
   OTP-first flow, CORS, login/navigation, mobile/PWA update and failure handling.
   Preserve all other configuration and eligibility controls.

If steps 1–2 cannot be verified, do not proceed with source publication, production
migration or deployment. These instructions grant no approval by themselves.

## Checks requiring email or account writes — separate approval

These were not performed and are distinct from catalog/configuration checks:

- `begin_access`: consumes rate counters, can create an unconfirmed Auth identity
  and dispatch email to the stored address. A 202 is not delivery evidence.
- `verify_access`: consumes an OTP, establishes Auth state and issues a private
  proof; replay/expiry tests consume additional codes/counters.
- Final linking: changes the approved account's password and persistent Student
  Auth link/status; it is not an enrollment update. It needs explicit account-owner
  consent and account-specific scope. Do not invent synthetic production students.
- Full login/profile verification needs an approved identity/session. No credentials
  should be supplied in chat or logged.

Approve a designated consenting eligible account/recipient, allowed operations and
expected changes before a genuine smoke test. Repeatable abuse/concurrency tests
remain isolated fixtures, not deliberate production OTP exhaustion. Template-body
and provider dashboard inspection can be read-only and requires no OTP email.

## Rollback and interrupted setup

- Disable the server switch on the **secure** handlers to block new setup, and
  disable both frontend flags with an approved rebuild/promotion of a verified
  disabled version-3 deployment. Cached pages may persist, so server gating matters.
  Preserve ordinary login, JWT settings and the read-only profile handler.
- Do not restore enabled v9/v6 as a rollback. They ignore the new switch and retain
  the confirmed gaps. The currently enabled legacy deployment is not a safe
  rollback target merely because it is the current deployment.
- Drain in-flight requests and inspect the private journal only under approved
  database access. Auth and Postgres are separate transactions. A timeout may hide
  a completed password write; do not retry, auto-reset, delete an account or assume
  no effect from an error.
- For one expired unresolved claim, verify the Auth outcome and exact current
  identity first. Separately approve the exact proof hash/Auth UID and run the
  reviewed recovery file in its explicit outer transaction with the required
  transaction-local settings. It requires exactly one matching unresolved claim,
  records recovery time, leaves the original token unusable and permits a fresh OTP.
  It changes no password, Student or enrollment row.
- Optional schema rollback uses only `student-setup-security.rollback.sql`. It
  refuses unresolved claims, removes the five new functions, and retains the private
  journal and all historical data. Keep secure handlers gated off if dependencies
  are removed. No CASCADE, account deletion or automatic credential rollback.

Files in the reviewed package provide the exact forward, rollback and recovery
SQL. None was executed against production. Evidence and fresh metadata are under
`.tmp/student-setup-preflight/`; the tested release package was left unchanged.

## Smallest remaining actions

1. Approve containment of the currently enabled legacy release.
2. Supply authenticated Vercel access and read-only hosted template/provider review;
   approve the exact catalog-only production check or provide a trusted current
   catalog result through an authorized operator.
3. Review the verified version-3 package, then separately approve the ordered
   migration, two-function release, reviewed frontend publication/deployment and
   configuration changes.
4. Approve one consenting account's real delivery/completion test before public
   activation. Nothing in this preflight substitutes for those approvals.
