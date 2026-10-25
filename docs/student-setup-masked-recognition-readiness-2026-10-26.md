# Student Account Setup — masked recognition (contract v4) readiness

Prepared 2026-10-26 as an isolated local revision of the version-3 security
candidate in [student-setup-security-release.md](student-setup-security-release.md).
Production activation remains **NO-GO** under the same conditions as that
release: production is unchanged (resolver v9 / linker v6), both frontend
setup flags and the server setup switch remain off, no SQL was applied, no
function was deployed, and no live lookup or OTP was sent.

## What changed relative to contract v3

Owner-directed behavior change (2026-10-26): Find Student ID now returns a
**server-masked** recognition record before OTP instead of v3's uniform
acknowledgement, and the student must explicitly confirm the masked record
before an OTP is dispatched.

Flow: **Student ID → masked record + explicit confirmation → OTP (registered
email only) → verify → full details + confirmation → password → activation.**
Everything from OTP verification onward (five-minute proof, claim/finish
RPCs, existing-account path) is unchanged.

### Recognition contract (version 4)

`inspect_setup` on the secure resolver candidate, after the unchanged HMAC
rate-limit check (verify bucket), runs the same authoritative admission RPC
used by OTP dispatch, verification and linking
(`kandid_student_setup_admission_v1`). Responses are `Cache-Control: no-store`
with the existing 800 ms minimum-response-time floor on both outcomes.

- Admitted **pending** record → `200`:
  `{recognition_version: 4, student_number, verification_required: true,
  masked_first_name, masked_last_name, program, year_level}`.
  Example: `Br••••`, `M••••••`, `BSIT`, `4`.
- Unknown, disabled, already-active, ambiguous or colliding identities →
  one identical generic `404 {error: "Student details unavailable."}`.
  The UI copy directs already-activated students to login; the post-OTP
  `account_state: "active"` path remains as the raced-case backstop.
- Admission/RPC failure → `503`, uniform for every Student ID.

Masking is server-side (`maskedSetupRecognition` in
`_shared/studentSetupAdmission.ts`): at most the first two characters of the
first name and the first character of the last name are visible; every shown
name part keeps at least three `•` bullets; a one-character name part is
never shown; multi-word parts are masked as one string. Unmasked names,
email addresses, Auth UIDs and internal IDs are never present in the
response. The admission record now also carries the exact stored
`first_name`/`last_name` to the **server** (two extra keys in the proposal
SQL's record function) so masking uses the true name parts (e.g. "Dela Cruz"
masks from `D`, not `C`); those keys are never forwarded to the browser.

The frontend parser accepts **only** the exact v4 shape and rejects v2
(deployed unmasked), v3, extra fields, and any masked value that contains no
bullet or looks email-shaped. OTP is requested only from the new
"Is this your record?" step, after an explicit checkbox confirmation; the
request still carries only the Student ID — the browser can never supply or
replace the OTP recipient. Existing resend cooldown (60 s UI / `Retry-After`),
duplicate-submission guards, proof expiry handling and session-change
invalidation are unchanged.

## Documented defects — verification status in this candidate

Verified by source inspection plus the synthetic handler/PostgreSQL suites
inherited from the v3 candidate (the v4 diff touches none of these paths):

1. **Resolver/linker admission mismatch** — closed: one private SQL
   admission function behind all four service-only RPCs; resolver and linker
   call only those RPCs. Recognition now uses the same admission, so a
   record the linker would reject cannot be displayed at the masked step.
2. **Truncated collision scans** — closed: complete SQL `EXISTS`/aggregate
   checks (students active/pending normalized email, `admin_users`,
   `auth.users`, foreign links); no API page length is treated as evidence.
3. **Stale final write** — closed: claim and finish re-run admission under
   ordered table locks and bind status, Auth-link state and the stored-email
   hash captured at proof issuance; the activation `UPDATE` re-binds the same
   values. A disabled/changed record cannot be activated from a stale proof.
4. **Unauthorized password reset for active accounts** — closed: proofs are
   issued only for the pending path (`account_state: "active"` returns no
   token), the linker claims before any password request and requires an
   unlinked claimed record, and concurrent/replayed claims are rejected
   before a second password write. Passwords go only through the verified
   caller's self-service `PUT /auth/v1/user`, never an admin reset.

## Privacy trade-off (explicit)

Unlike v3, masked recognition confirms — for an admissible pending Student
ID — existence, two name fragments, name lengths, program and year level to
anyone who knows the ID. Rate limits (IP 40/15 min, per-ID verify 8/15 min,
shared with verification attempts), generic rejection for every other case,
the response-time floor and minimal mask visibility mitigate bulk harvesting
but **do not make this enumeration-proof**. This is the owner-approved
middle ground between deployed v2's full-name disclosure (rejected) and
v3's zero pre-OTP disclosure; it must still receive the same explicit
privacy acceptance required by the production-readiness assessment before
activation. Residual timing/delivery side channels are unchanged from v3.

## Changed files (LF SHA-256)

Backend candidates and SQL proposal:

```text
fa69d0b4ad76d5f98cf7f66e9b1d6d9b00e3f100298797ad8c5ef2d81a213862  supabase/functions/resolve-student-login-secure-deploy/index.ts
54b6d559600d55b2a0cd6ddc966fa2dd9e44b55747d19de695eed5469ed4a1c6  supabase/functions/_shared/studentSetupAdmission.ts
a783cec552d95117c4849437056e4c264ec849c8cf78c9861cad700da49f7785  supabase/proposals/student-setup-security.sql
```

Unchanged deployment files (hashes identical to the v3 manifest):
`link-student-identity-secure-deploy/index.ts` (`f2e10a28…`),
`_shared/kandidProductionSecurity.mjs` (`340ebeb8…`), rollback/recover SQL.

Frontend:

```text
dacd72c8bc3deb159e9d4c88e545b7afca9d77eb6d03877ebe2d8bcba903c72d  src/pages/auth/StudentSetup.jsx
1bf49519b4b12fd750c9b4d4737db094a41d12b87cd2ac2d23da592176cb3268  src/utils/studentSetupRecognition.js
a8d568f130a8b09093e96b27f1af055d6f302eec4b403d5e6412589e4709307f  src/utils/studentSetupValidation.js
8a3f587e08df3e806a910b0c4d7afe8878a372fce2b4c37e493da096664e482c  src/utils/studentSetupLookupFailure.js
```

`src/utils/auth.js`, the feature gate, routes, shells and CSS are unchanged;
the masked step reuses the existing identity-panel/confirm/submit styles and
the four-phase progress (masked confirmation belongs to the Student ID
phase). Tests/fixtures updated: `studentSetupSecurity`,
`studentSetupLookupFailure`, `studentSetupCompletion`, `studentLoginSession`,
`studentSetupValidation`, `studentSetupProductionPreflight`,
`studentSecurityBoundary`, the PostgreSQL/browser scripts and the release
packager; `docs/student-setup-security-manifest.json` revised to
`contract_version: 4`, `manifest_revision: 2` with refreshed hashes for the
changed files only (changed-file `sha256` equals `lf_sha256` in this LF
checkout; re-derive raw hashes if the reviewed checkout uses CRLF).

## Validation

Executed locally in the sandbox (synthetic only; no production requests):
targeted Node suites for the secure handlers, recognition parser, lookup
failures, completion/session flows, validation helpers, production-origin
preflight, security boundary and both manifest generations; full test loop,
ESLint and Vite build (see session report for exact counts). New coverage:
masked-recognition success shape with PII-absence assertions, identical 404
for ineligible vs already-active, masking edge cases (short/multi-word/
accented/missing names), parser rejection of v2/v3/unmasked/overbroad
payloads. Inherited coverage re-run: OTP wrong/expired/foreign, duplicate
emails, foreign Auth links, privileged collisions, resend/rate limits,
concurrent and replayed activation, stale finalization, already-active
handling, ordinary-login differential vs deployed v9.

**Not run here (owner environment required):**
`node scripts/kandid-student-setup-security-pg17.mjs` (verified disposable
Postgres container; now 29 checks incl. admission name parts),
`node scripts/kandid-student-setup-security-integration.mjs` (local
GoTrue/Mailpit), and `node scripts/kandid-student-setup-security-browser.mjs`
(Windows Chrome; updated for the masked step at 1280/768/390 px incl.
masked-record screenshots). Desktop/mobile visual verification is therefore
**not yet evidenced** for v4 and must not be claimed until the browser suite
runs green on the owner's machine.

## Approval scope delta vs v3

The six-step approval sequence in the v3 release document is unchanged. Two
additions: (a) the privacy acceptance must name **masked** pre-OTP disclosure
as specified above; (b) frontend activation requires the v4 resolver (the
new UI rejects deployed v9's v2 responses and v3's uniform response), so the
two-function deployment in step 4 must precede any flag enablement, as
already sequenced. Rollback posture is unchanged: server switch off first,
flags off, never reopen the v9/v6 baseline.

**GO for review of the v4 local candidate; NO-GO for production today.**
