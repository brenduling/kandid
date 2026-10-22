# Student Account Setup — one-account production smoke-test runbook

Prepared **2026-10-23, Asia/Manila**. **Not authorized for execution.**
The owner confirmed that no demonstration account has been designated yet.
This file creates no account and grants no approval to send email, change a
password, enable a gate, deploy or run recovery SQL.

## Account and consent scope

Use **one existing** `public.students` record and its consenting mailbox owner.
Record the exact internal Student reference and consent in an approved private
operator record, not in this repository or chat. Require:

- Central status `pending`, `auth_user_id IS NULL`, authoritative Student ID and
  registered email already correct. Do not edit/import a record to manufacture
  eligibility for this test.
- Mailbox owner present, able to receive the registered address's messages and
  willing to activate the account and choose its password privately.
- No normalized-email/privileged-account/foreign-UID collision; admission must
  remain authoritative. Never override a rejection.
- Prefer no pre-existing Auth identity for that email, so the initial dispatch
  exercises the confirmation template. A pre-existing confirmed Auth identity
  uses the magic-link template instead and cannot certify the confirmation path.
  Do not unconfirm/reset an account to force the other template.
- An approved read-only before/after snapshot for this record's central status,
  Auth linkage, enrollment and membership state. Retain history; do not change
  enrollment or memberships for testing. Missing current-term verification is
  not a setup/login disqualification.

Approval must explicitly cover the normal creation of **one unconfirmed Auth
identity if absent**, later email confirmation, one self-service password write,
one central Student link/activation, private proof lifecycle writes, rate counters,
and subsequent owner login/logout. Creating a new Student registry row is excluded.

Proposed email budget: **two OTP dispatches total to the same registered mailbox**:
one for pending-account completion, then one confirmed-account check. No resends,
wrong-code attempts, intentional expiry, duplicate submissions or quota exhaustion.
If the first identity is already confirmed, state explicitly that only the
magic-link delivery path will be exercised. A different email budget requires its
own approval before another dispatch.

## Release and enablement prerequisites

1. Refresh the official project, v10 resolver/v7 linker source/JWT checks, reviewed
   database-object checks, hosted templates and provider configuration. Stop on
   drift; do not patch the release during a live test.
2. Verify the exact `kandidato` project, Production domain/source and selected
   reviewed frontend publication. The current old frontend must not simply be
   enabled. Publish and deploy the reviewed version-3 source **gated off first**
   under separate approval; record its actual commit/artifact and deployment ID.
3. Obtain approval for a named operator and a proposed **15-minute test window**,
   its start/end time in Asia/Manila, the exact account scope above, both OTP
   dispatches, and shutdown of the gates at the end or first failure.
4. Obtain separate approval to enable `STUDENT_SETUP_SECURITY_ENABLED=true` and
   rebuild the reviewed frontend with both setup flags true for that window.
   No VITE variable may contain the server gate or a server credential.

**The server gate is global.** It does not restrict access to the designated
account, and frontend flags are not an API allowlist. Enabling it exposes the
reviewed admission-protected setup API to other eligible callers. Approval for
one operator's account test must explicitly accept that temporary global window.
If strict technical isolation to one account is required, this production test is
NO-GO under the existing release. Use the isolated fixtures for demonstration or
separately review a new control; do not improvise an allowlist or bypass the UI.

The complete hosted UI test needs the separately approved frontend release and
gate changes. An API-only check while UI gates remain off would not establish
that the production browser workflow works and is not a substitute for this test.

## Primary flow — pending account, one OTP, one activation

Use a fresh browser session at `https://witkandid.vercel.app/student-setup`.
Only the owner enters the approved ID, OTP and password. Never paste OTPs,
passwords, bearer tokens, refresh tokens or the setup proof into chat/logs/HARs.

| Action | Exact expected result |
| --- | --- |
| Open reviewed page | ID → OTP → confirmation → password progression; no pre-OTP student details; enabled controls only during the approved window |
| Find Student ID | Resolver `inspect_setup` returns HTTP 200 with only `recognition_version:3`, the requested `student_number`, and `verification_required:true`; no existence/name/email/program/year disclosure |
| Automatic dispatch after inspection | Resolver `begin_access` returns HTTP 202, `verification_requested:true`, `delivery_confirmed:false`, `retry_after_seconds:60`; no password submitted |
| Owner checks mailbox | One six-digit code, legible in the confirmation template when initial Auth identity was unconfirmed; timestamp/subject may be recorded with personal information redacted. A 202 alone is not delivery evidence |
| Verify correct OTP once | Resolver `verify_access` receives only action, Student ID and `verification_code`; HTTP 200 with confirmed Auth session and contract-3 proof bound to that ID/UID; account state pending; only name/program/year appear after OTP |
| Confirm identity details | Owner confirms the record. No editable program/email field controls admission or reassignment |
| Choose and confirm password | Existing minimum six-character letter/digit/symbol policy; complete within the five-minute proof lifetime. Auth refresh cannot extend the proof |
| Complete Account Setup once | Linker receives ID, `setup_mode:true`, password and opaque `setup_token` with the verified session; HTTP 200, `linked:true`, the same Student ID/internal ID and `status:active`. One claim precedes the Auth password write; one finish completes it |
| Success and Proceed to Login | Success only after explicit linker confirmation; local setup session closes; owner reaches `/student-login` |
| Owner signs in normally | Exact active Student/Auth mapping; Student dashboard/navigation available. No term enrollment or election participation is granted by setup |

The numeric OTP expires after 3,600 seconds under the inspected hosted policy.
The five-minute setup proof starts **after successful OTP verification**. Do not
wait for expiry or deliberately submit a stale code in Production; isolated tests
cover those cases. Stop rather than repeatedly dispatching when email is delayed.

## Confirmed-account follow-up — same owner, one further OTP

After successful activation, wait until at least **60 seconds after the first
dispatch** before requesting another code; a fresh browser does not reset the
hosted SMTP throttle. Use another fresh logged-out/private browser session
so an existing login does not redirect away from setup. Request one further OTP
for the **same** Student ID. Expected delivery now uses the magic-link template,
which contains a numeric code. Verify once:

- Contract 3 returns `account_state:active`, `setup_token:null`, `expires_at:null`.
- UI shows the existing-account/login path; no new password configuration or
  second linker request, Student identity, membership or enrollment is created.
- The Auth UID remains the same. No second setup proof is needed for this active
  branch. Close the local setup session and return to normal login.

This tests both hosted delivery templates with one account only when the initial
Auth identity was absent/unconfirmed. Do not claim both branches were tested if
that prerequisite was not satisfied.

## Expected durable changes and preservation

Happy-path changes are limited to the approved account: optional Auth identity
creation, email confirmation/session activity, one password update, central
`pending → active` and `NULL → verified Auth UID`, one claimed/completed setup
proof, plus ordinary rate/operational records. The Student number, registered
email and identity ID remain unchanged.

Enrollment, current/previous organization memberships, election/candidate/officer
records, votes, receipts, schedules and blockchain records remain unchanged. If
the approved account lacks verified current-term enrollment, navigation/login
must work while voting/candidacy remain restricted. If enrollment was verified
already, it remains so; do not alter it to create a negative test. Inspect only
authorized eligibility indicators/history; do not submit ballots/candidacies as
Production tests.

Record statuses/timestamps, deployment/source identifiers and redacted outcomes.
Do not export full network responses containing sessions/proofs or expose another
student's records. The owner must consent before any identifying screenshot is
retained; use approximately 390px for the mobile check without a second account.

## Stop and recovery rules

| Failure point | Safe response |
| --- | --- |
| No email despite 202, or HTTP 429 | Stop. 202 is a neutral acknowledgement; obey cooldown. Review provider/Auth diagnostics under approved access with identifiers redacted. No silent resend or quota increase |
| Wrong/expired OTP or post-OTP admission failure | No password/link request. Close the local setup session. A fresh code needs the remaining explicit email budget/approval; never bypass admission |
| Unclaimed proof expires before final submit | Do not reuse it. Return to normal OTP flow only under an approved additional attempt; do not extend session/proof expiry |
| Final submit times out, returns 409/503, or activation is uncertain | No second password submission, automatic reset, account deletion or success claim. Disable server setup, close frontend gates through the approved shutdown release, drain requests and review the actual Auth/Student/proof outcome |
| Record becomes disabled or email/UID changes | Preserve the newer state; finalization must reject stale admission. Do not reactivate or rewrite it manually |

Auth password changes and PostgreSQL activation are separate transactions. An
error does not prove that Auth made no change. Preserve an unconfirmed/unlinked
Auth identity and proof evidence rather than deleting it as test cleanup.

For an **expired, claimed, incomplete, unrecovered** proof, an authorized operator
must first establish the Auth outcome and current Student identity. Only after
separate exact-proof-hash/Auth-UID approval may the reviewed recovery SQL run in
an outer transaction with `kandid.setup_recovery_approved`,
`kandid.setup_recovery_hash` and `kandid.setup_recovery_uid`. It records recovery,
does not change a password/Student/enrollment, and makes a fresh OTP attempt
possible. It does not make the original proof reusable or undo an Auth write.

At completion or failure, close the server gate and restore both frontend flags
false with the separately approved rebuild/promotion, unless an explicit launch
approval says otherwise. Keep secure v10/v7 and installed schema. Optional guarded
schema rollback is separately approved, refuses unresolved claims and retains
the journal/history. Never restore enabled vulnerable v9/v6 handlers.
