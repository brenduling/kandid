# Student account recognition before password creation

Status: **historical proposal, superseded by the owner-approved local sequence**.
See [the current implementation and privacy decision](student-setup-recognition-implementation.md).
The email-first order and broader post-OTP recognition below are historical only.
Production project: `fszgdxqxonqqcrzsnkca`. No live inspection, email, OTP,
account-creation, password or identity-linking requests were made for this review.

## Confirmed deployed contracts

| Function | Version | JWT gateway | Current capability |
| --- | --- | --- | --- |
| resolve-student-login | 8 | false, existing pre-login contract | Protected inspection; stored-email OTP dispatch; verified OTP returns a session only |
| student-profile | 7 | true | Profile/current-term membership reads for a uniquely linked, active, matching student only |
| link-student-identity | 6 | true | Revalidates verified email and ownership; sets password, then links/activates the student |

Local sources were compared with deployed source, normalizing CRLF/LF, and match:

- Resolver: `supabase/functions/resolve-student-login-inspect-deploy/index.ts`,
  SHA-256 `e79d6efef161760868445c1e54012c08f548ca59f09d2309293a1b9209d13c9a`.
- Profile: `supabase/functions/student-profile-readonly-deploy/index.ts`,
  SHA-256 `42976c3282c5102624a322e7c5b8e03d236eff0e2089089805069f775eca7e6a`.
- Linker: `supabase/functions/link-student-identity/index.ts`,
  SHA-256 `d1939e0fe322df33768a863932c749af9c5bba0fd2d04eb6d705cd2f7060f606`.

The existing OTP operation does not require a password, so verifying email first
is supported. However, a verified pending student cannot read their identity,
enrollment or organizations before linking: the profile endpoint correctly rejects
that state, and the linker is a mutation requiring a valid password. Calling it
early or weakening the active-profile gate would violate the requested boundary.

The canonical local resolver already contains unreleased post-OTP name/enrollment
fields. They are absent from production v8 and do not supply organization data or
the complete admission checks described below. Do not deploy that broader local
file or treat it as an existing production contract.

## Minimum proposed backend change

Extend the existing `verify_access` success response in the isolated resolver
release. Do not add a new verification mechanism or broaden `inspect_setup`.

After successful server-side OTP verification, and before any personal data:

1. Require a valid Auth result with confirmed email, a session and a user ID.
   Match the verified email to the server-selected Student record; reject foreign
   existing Auth links. Never accept a caller-selected email, organization, role,
   enrollment or Auth user ID as authority.
2. Re-read the target and recheck unique Student ID, allowed central status and
   link state. Apply the linker's existing privileged-identity/email collision,
   foreign Student-link and active-email uniqueness admission rules to disclosure.
   Do not assume `begin_access` checks are sufficient after time has elapsed.
3. Read an allowlist of the authorized student's full name, Student ID, registered
   email, program/year and account state. Scope enrollment and organization reads
   to that server-derived student ID. Include the current academic term and its
   enrollment/participation data, with organization IDs/names and term context.
   Do not return all student columns, credentials, Auth identifiers or unrelated
   students' memberships.
4. Return an explicit `student_details.details_verified: true` payload only after
   all authorization checks succeed, alongside the existing verified session.
   Return read failures as unavailable, not fabricated empty enrollment or
   organization results. Preserve generic failures for ineligible/ambiguous
   identities and retain `Cache-Control: no-store` on personal responses.
5. Do not set passwords, activate/link students, create Auth users, synchronize
   enrollment/membership, or write academic records in the recognition step.
   The existing OTP operation still consumes its existing rate-limit counters.

Keep `login`, `inspect_setup`, generic `begin_access` responses, rate limits,
stored-email targeting, Auth-user reuse and duplicate/collision protections intact.
Keep `student-profile` active-account authorization and the linker's independent
checks unchanged. Preserve the pinned resolver SDK. No database migration, RLS,
grant, secret or Auth-settings changes are proposed.

Absence of current enrollment must not become a new central login/setup ban.
Represent no active term/enrollment/participation accurately after authorization.
Ambiguous or failed reads must be distinguished from verified absence. Show
current-term academic values with their term; keep persistent registry values
clearly labelled if they differ. Do not modify records to make them agree.

## Proposed Student interface and state order

`Enter Student ID -> Verify email -> Recognize account and create password -> Complete`

Before email verification:

- Show **Student ID entered** and the submitted value. Do not say "account found"
  or imply the protected inspection proves that an account exists.
- Replace the repeated protected-field grid with one explanation:
  "Your name, email and academic details stay private until you verify the email
  registered with the Electoral Board. If this ID is eligible, request a code and
  check that inbox. Contact the Board if you cannot access it."
- Primary action: **Send Verification Code**. No password controls at this stage.
  Acknowledgements remain conditional; do not expose even a masked email or claim
  successful delivery. Requesting a code may create an unconfirmed Auth account
  under the existing backend rules; it remains a separately approved live action.

Email verification:

- Keep the submitted ID visible, six-digit code controls, cooldown and resend
  behavior. Primary action: **Verify Email**. Expired, reused, invalid or
  rate-limited codes cannot advance the flow or reveal identity information.
- Establish the returned session and revalidate Auth identity using the existing
  SDK helper. Require authorized details for the exact submitted ID. A confirmed
  Auth email alone or a client-set `details_verified` flag is insufficient.
- Remove the current immediate `completeSetup()` fallback after OTP when details
  are missing. Stay at a safe verification/readiness error; never link to obtain
  the missing recognition data and never automatically resend a code.
- A details-read failure may occur after a code was consumed successfully. Do not
  retry that consumed code as though verification never happened. Keep password
  creation blocked and offer an explicit manual restart of email verification,
  honoring the existing cooldown and Auth-user reuse rules. Never auto-send email
  or call the linker to recover recognition data.

After trusted verification:

- Show **Confirm your account** with actual full name, ID, registered email,
  program, year, current-term enrollment and organization participation. Support
  multiple organizations with labelled rows; do not assume a single organization.
- For an eligible pending/unlinked student, display password and confirmation
  fields only now. Primary action: **Finish Account Setup**. The existing linker
  must independently recheck identity/status and password policy before changing
  the password or linking/activating the record. A stale recognition response
  cannot authorize a mutation.
- For an already active linked account, show the existing-account state and
  **Proceed to Login**. Do not turn recognition into an automatic password reset
  or create a duplicate account.
- Clear verified details and password state when the ID changes, the session
  changes/expires, or the flow is abandoned. Preserve current local sign-out and
  explicit login navigation after successful completion.

At 375px, use one-column identity rows with labels above wrapping values, a single
privacy note, full-width sharp buttons, and a compact three-step progress strip:
**Student ID / Verify email / Secure access**. Use existing orange/black/cream
tokens, zero-radius geometry and restrained rules. Keep the page title strongest;
retain the existing auth shell, focus management, OTP paste/keyboard behavior and
password accessibility controls. No new mobile layout is implemented in this phase.

## Regression and acceptance plan

Current-contract regression tests exercise the deployed-matching sources with
synthetic Auth/database services and blocked external fetch: protected inspection,
session-only OTP success, invalid/foreign/unconfirmed verification, pending profile
denial, safe active profile recognition, and prevention of linker use as a read.
They document why frontend-only reordering cannot satisfy the requested outcome.

Review validation: **78 tests passed**, including eight new deployed-contract
readiness/privacy checks and the existing authentication/OTP/linking suites.
Targeted lint and test syntax checks passed. These are contract and safety checks,
not a claim that the proposed new UI state transitions or mobile design already
exist. Frontend/runtime sources and the deployed revision-2 manifest are unchanged.

Before releasing the proposed backend and frontend, add/run:

| Case | Required result |
| --- | --- |
| Known, unknown, disabled or ambiguous ID inspection | Identical protected acknowledgement; no personal fields or existence claim |
| No code, bad/expired/reused code, rate limit | No recognition or password stage; no implicit resend |
| Valid OTP for unique eligible pending record | Only that verified student's allowlisted identity, current-term enrollment and organizations; no password/link mutation |
| Foreign session/email/Auth link, privileged collision, duplicate active email | Generic rejection with no profile, enrollment or organization disclosure |
| Missing recognition payload or backend read failure | Safe readiness error; no linking fallback and no fabricated empty academic data |
| Pending Student with existing unconfirmed Auth user | Reuse existing Auth identity under existing dispatch rules; no duplicate account |
| Existing active linked account | Verified recognition then existing-account/login path; no reset/relink |
| Missing term/enrollment/membership versus read error | Accurate verified absence versus unavailable; no new setup eligibility restriction |
| Changed ID, session expiry, late/out-of-order response, back/refresh | Clear private/password state; cannot reuse another ID's verified result |
| Valid final password with stale/foreign admission state | Linker rechecks server-side and rejects; frontend state cannot authorize changes |
| Success and finalization failures | No premature success; preserve trusted linking checks and explicit login navigation |
| Desktop and 375px | No overflow; correct focus, readable full name/email/organization, OTP and password keyboard controls |

## Approval and rollout boundary

Approve the post-OTP disclosure contract and local implementation first. Prepare
a new resolver release manifest; do not rewrite the already deployed revision-2
manifest or silently deploy the canonical local resolver. Keep v8's protected
inspection response unchanged. Validate the new backend locally with mocks and
existing auth/privacy/linker regression suites, then implement and test the UI
state order and 375px layout against that approved contract.

Deploy the narrow backend only after separate approval, verify its source/settings,
then approve frontend rollout separately. No live OTP, email, password, Auth-user
creation or identity-linking test is authorized by this proposal. Existing local
feature-flag activation is preserved; no flags or production settings are changed
for this review. A live end-to-end setup remains separately approval-gated.

Rollback of a future disclosure release restores the captured v8 package and
requires reverting/containing the new frontend flow as appropriate. Source rollback
does not undo legitimate account writes or restore unrecorded historical dependency
bytes. Do not delete accounts or reset student records as automatic rollback.
