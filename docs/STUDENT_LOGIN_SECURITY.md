# Student login security flow

This document describes the staged Student authentication correction. The migration and function/frontend changes are local only; they have not been applied or deployed.

## Information available before identity proof

The previous `resolve-student-login` returned `login_email`, linkage/recovery flags, and account eligibility from a Student ID alone. Its `student_setup_lookup` path also returned names, email, program, year level, and pending/disabled status. The browser then performed password sign-in using the returned email. `StudentSetup` displayed those fields and sent OTP directly to the returned email. The identity-linking function additionally compared a submitted legacy password to `public.students.password`.

The new resolver returns no Student fields or status. Password failures and unknown/ineligible IDs use the same 401 body; setup initiation uses the same 202 body. The resolver performs Student ID to email lookup and Supabase Auth calls server-side. The browser receives only an Auth session after Supabase Auth accepts a password or email OTP, then resolves the profile through `student-profile`.

After verified email OTP, the authenticated flow may link an unlinked active/pending Student record whose stored email matches the confirmed Auth email. The existing `student-profile` function then returns only the caller's own active profile. The linking function never trusts the submitted Student ID by itself and preserves an existing non-null Auth UUID link.

## Student ID + password

The login and kiosk interfaces retain Student ID + password. The resolver looks up the stored email using the service role, passes the password to Supabase Auth `signInWithPassword` using the public Auth key, and checks that the returned Auth UUID equals `students.auth_user_id`. It returns the session fields only after that exact match. The browser does not receive the mapped email. The password is not logged or written to the database by this flow.

Unlinked legacy records cannot use a plaintext password column as a password verifier. Their account recovery/setup requires OTP to the trusted email already in the Student record, followed by Supabase Auth password setup. No custom password hashing or token signing is used.

## Enrollment and recovery

The unauthenticated flow accepts only a Student ID and CAPTCHA. It never accepts a destination email for sending. OTP is requested for the normalized email already in `public.students`; the response reveals neither whether a record exists nor which address was used. To verify, the person enters the email they control and the OTP. The server checks that email against the trusted record before asking Auth to verify the OTP. A missing, disabled, or mismatched record follows a dummy-email path and receives the same public response.

This relies on `students.email` being supplied through trusted institutional enrollment/import or checked by an authorized Electoral Board administrator. A record with no trusted email, or a person unable to access that email, must be referred to authorized enrollment verification. The requester cannot substitute an arbitrary email. Bren Alzaga or any other absent record must be enrolled by an authorized administrator before this flow can apply.

## Abuse controls and gateway settings

- Strict JSON body limit: 8 KiB; Student IDs must be 1–20 ASCII digits; passwords are bounded to 256 characters; OTPs are six digits.
- Per-IP plus per-Student ID distributed limits use HMAC fingerprints and a service-only Postgres RPC/table: 40 requests per IP per 15 minutes, 8 password attempts per Student ID per 15 minutes, 3 setup sends per Student ID per 15 minutes, and 8 OTP verifications per Student ID per 15 minutes. Raw IDs, IP addresses, passwords, OTPs, and tokens are not stored in the limiter or diagnostics.
- IP extraction accepts only the Supabase/Cloudflare injected `cf-connecting-ip` header and fails closed if absent. This header behavior still needs confirmation in the isolated hosted-compatible runtime.
- Cloudflare Turnstile is used in the login, kiosk, setup, resend, and OTP verification screens. Supabase Auth CAPTCHA protection must be enabled for password sign-in and OTP sends; the OTP verification action also validates the Turnstile token in the Edge Function. Edge `TURNSTILE_SECRET_KEY` and `STUDENT_AUTH_RATE_LIMIT_HMAC_SECRET` must be set through the secret manager; only the public `VITE_TURNSTILE_SITE_KEY` belongs in frontend configuration. `STUDENT_AUTH_ALLOWED_ORIGINS` must contain exact approved app origins.
- `resolve-student-login` requires `verify_jwt = false` because it is pre-authentication; the handler enforces origin, CAPTCHA, database-backed limits, and supported Auth checks. `student-profile` and `link-student-identity` require JWT verification and retain their internal identity/authorization checks.
- Do not enable production traffic until Auth CAPTCHA, verified-origin, trusted-email, rate-limit RPC, and Edge secrets are configured and tested. The database migration is staged for that gate.

## Validation status

Static source checks and repository tests are staged. A disposable Supabase stack is required to validate the Auth provider, SMTP OTP flow, edge proxy IP header, distributed/concurrent rate-limit behavior, correct and incorrect credentials, setup/linking, isolation, refresh, and logout. Docker Engine access was denied in this workspace, so those end-to-end tests have not passed. No production changes or deployments were made.
