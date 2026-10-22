# Board Student Registration: production activation assessment

Investigation: 2026-10-22, Asia/Manila. Official frontend:
`https://witkandid.vercel.app`; Vercel project `kandidato`; Supabase project
`fszgdxqxonqqcrzsnkca`. Production access consisted only of public asset/metadata
GETs, OPTIONS preflights, function-source downloads, secret-name/digest inspection,
and a READ ONLY catalog transaction ending in ROLLBACK. No student lookup,
registration, OTP, account creation, enrollment write, import, deployment or
production configuration change was performed.

## Confirmed blocker and minimum correction

The reported two-line message is the `REGISTRATION_NOT_ENABLED` presentation in
`src/utils/boardStudentRegistrationMessages.js`. It belongs to Electoral Board
Student Registration, not Student email/OTP account setup.

`src/utils/boardStudentRegistrationFeatureGate.js` enables the workflow when:

```js
environment.MODE === "development" ||
environment.VITE_ENABLE_BOARD_STUDENT_REGISTRATION === "true"
```

Local development therefore permits it without setting this flag. The downloaded
production client bundle contains the same gate but omits
`VITE_ENABLE_BOARD_STUDENT_REGISTRATION` from its build environment. Its Board
request utility returns `REGISTRATION_NOT_ENABLED` before invoking the Edge
Function for either registration action. This explains successful registry,
academic-term and administrator reads followed by failure on the review screen.

**The minimum proposed correction is one Vercel Production variable:**
`VITE_ENABLE_BOARD_STUDENT_REGISTRATION=true`, followed by a new Production build
of the reviewed frontend. No application-code change, SQL write, Edge deployment,
origin expansion or verification bypass is required by the inspected contracts.
This assessment does not authorize activation.

The flag also gates `confirm_board_csv_import` in the existing Board transport.
Its backend independently requires the same server registration gate and reviewed
evidence. Include that existing capability in activation approval; this task
performs no import. Keep student-management and Student account-setup flags
unchanged.

## Deployed backend prerequisites

| Check | Observed result |
| --- | --- |
| `board-manual-enrollment` | ACTIVE v15; gateway JWT verification enabled |
| Function source | Entrypoint, handler and CORS module match `board-manual-enrollment-complete-deploy` after LF normalization |
| `BOARD_STUDENT_REGISTRATION_ENABLED` | Present; returned secret digest matches the exact value `true`; no secret value/digest was printed |
| Production-origin OPTIONS | HTTP 204 with `Access-Control-Allow-Origin: https://witkandid.vercel.app` |
| Registration RPC | `kandid_board_register_verified_student_for_term_v1(bigint,integer,text,text,text,text,text,integer,text,boolean,boolean,text,text,text)` exists; body matches the reviewed `20261021120000_board_verified_student_registration.sql` migration |
| RPC authority | `postgres` owner, SECURITY DEFINER; executable by service role; denied to anon/authenticated |
| Current term | Exactly one active term: ID 1, 1st Semester AY 2026–2027 |

The retained server checks validate JWT-derived active Electoral Board identity
and organization scope, supported enrollment evidence with explicit confirmation,
current academic term, student identity/state, program coverage, duplicate
enrollment and membership reconciliation. Existing verified program shifts,
institution-wide WITSG participation and historical records remain governed by
the existing RPC and triggers. Enabling a frontend flag does not grant browser
table/RPC access or remove voting/candidacy enrollment requirements.

## Frontend provenance and configuration limits

GitHub deployment record `7252408390` reports successful `kandidato` Production
deployment of commit `3b153e57b4e45b618c0cca1c01011f2927276ebd` at
`https://kandidato-75v4gqzus-mabrenquiro-2764s-projects.vercel.app`.
The immutable deployment URL redirects this unauthenticated inspector to Vercel
Login. Its assignment to the custom domain and the dashboard's current variable
scopes therefore require authenticated Vercel confirmation before release; they
were not inferred from the local Git branch.

The public custom domain itself serves these inspected assets:

| Asset | SHA-256 |
| --- | --- |
| `Students-Dqdl6StA.js` | `82f2b9dda487490f29e505d9eb81387741a121d476d90db550fd9cc21c5ccbed` |
| `boardManualEnrollment-lHDPULGi.js` | `49e4287b8643ffa69ca5fee9e44860bb9f30df6a91a9e1281e1b6adfba9cc0fe` |
| `supabaseClient-B1uBGVg6.js` | `d0d1cbe93fecfe9306b467140746e9557f2b48ba2813198ca078e28bf2d732e9` |

These confirm the expected registration screen, exact disabled message,
client-side mutation gate and absence of the Board registration flag in the
deployed build. They cannot establish whether somebody has subsequently added a
dashboard variable without rebuilding. Do not change the Production Git branch
as part of this correction.

## Separate console observations

`link-admin-identity` is absent from the deployed-function inventory and its
OPTIONS endpoint returns HTTP 404 for both production and localhost. This explains
the reported preflight failure without establishing an origin-allowlist defect.
It is called by administrator setup/login linking, not the Board registration
submit helper. Its recovery requires a separate reviewed administrator-linking
release; do not enable administrator linking or add wildcard CORS for this task.

The user's latest capture contains no `/auth/v1/token` HTTP 400. No credential
failure, refresh-token failure or current authentication blocker is asserted.
Student self-service setup has separate flags and a separate resolver/linker;
changing those flags would not fix this Board review-screen message.

## Validation

- 118 targeted registration/transport/gate regressions passed, followed by 19
  checks of the complete deployed handler package (137 total).
- 12 responsive isolated component checks passed using the actual Board registration
  component and request utility in production mode with synthetic transport:
  disabled frontend, new identity registration, existing identity reverification,
  and server-disabled rejection at 1280px, 768px and 390px. They check evidence
  confirmation, action/payload selection, disabled-front-end zero-write behavior,
  success/rejection feedback and horizontal overflow. Auth is a fixture adapter;
  these checks do not claim a genuine production registration or full portal
  authentication test.
- A local Vite production build passed with only the Board registration flag enabled in
  its child process, verifying the proposed build configuration without editing
  environment files or Vercel settings.
- Local evidence and screenshots are under the ignored
  `.tmp/student-registration-investigation/` directory. No real accounts or
  enrollment records are created by the component/transport fixtures.

## Exact approval and release order

1. In `kandidato`, confirm that the current `witkandid.vercel.app` Production
   deployment is the reviewed commit above and identify its existing source
   branch. Inspect only the intended Production variable scope and any applicable
   overrides; preserve the official Supabase URL/public-key configuration and all
   unrelated feature settings.
2. With explicit approval, set only
   `VITE_ENABLE_BOARD_STUDENT_REGISTRATION=true` for Production. Confirm the
   approval includes the existing Board CSV confirmation behavior noted above.
   No Supabase setting change is proposed: the inspected server flag is already
   enabled and the reviewed backend is installed.
3. With explicit redeployment approval, rebuild the reviewed commit for
   Production using `npm run build` (Vite `production` mode) and `dist`. Do not
   merely promote an older Preview bundle: the flag must be present when Vite
   compiles the new build. No push is needed to activate this configuration-only
   correction if that reviewed commit is already available in Vercel.
4. Inspect the new live bundle and verify, in a fresh browser/service-worker
   context, that the flag is enabled and the existing preflight remains valid.
   Read-only navigation can verify term/registry access. A genuine registration,
   reenrollment or import is a production write and needs separate explicit
   approval; do not fabricate records to complete acceptance.
5. If containment is needed, obtain approval to set the frontend flag false and
   rebuild the reviewed commit. Preserve the backend gate and every legitimate
   account, enrollment, membership, audit and election record. No data deletion,
   migration rollback or RLS change is part of this configuration rollback.
