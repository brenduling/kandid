# Student Account Setup — Stage 2 preparation

Prepared **2026-10-23, Asia/Manila**. Auth/template inspection completed at
00:27:37; authenticated Vercel inspection completed at **00:44:24**.

**NO-GO for a live smoke test or public activation yet.** Hosted template content,
OTP settings, Vercel identity/environment and the reviewed frontend's static/local
compatibility checks pass. Remaining actions are consenting-account designation,
provider/delivery verification, approved publication/deployment of the version-3
frontend and an explicitly approved enablement/test window.

No production SQL, application RPC, OTP, account write, setting change, deployment,
commit or push occurred. Only fixed read-only GET/metadata operations were used.
Existing local work and the frozen release package were preserved. New repository
deliverables are this report and the one-account smoke-test runbook; helpers,
filtered metadata and the local build are ignored under
`.tmp/student-setup-stage2-preparation/`.

## Hosted OTP templates and provider

The authenticated Management API GET for the official project
`fszgdxqxonqqcrzsnkca` exposed both hosted bodies. This resolves the earlier
**template bodies unavailable** blocker. Existing CLI credentials were used only
in memory; credentials and raw configuration were not printed or persisted.

| Check | Result |
| --- | --- |
| Confirmation template | PASS: nonempty body; `{{ .Token }}` in text content; subject present |
| Magic-link template | PASS: nonempty body; `{{ .Token }}` in text content; subject present |
| OTP versus link | Both provide the numeric-token variable without relying on ConfirmationURL/TokenHash links |
| Static template review | Only known template directives; no script/hidden-style indicators; no conflicting numeric duration claim detected |
| Email provider | Gmail custom SMTP, port 465; host/user/password/sender/name fields present |
| Sender consistency | Sender address matches the SMTP username; gmail.com sender domain |
| Actual credential validity / delivery | **NOT TESTED**; configuration presence is not successful SMTP authentication or delivery |

Template UTF-8 SHA-256:

```text
confirmation (287 bytes)
02cf0852b7956720cee90dec86e753159ba4a2524b0f7172bce064b76e671b22
magic_link (188 bytes)
10ad667a472980c9920951d214b6efd0fbebcc51ed02aedb2bfea27066e9e975
```

These are static configuration checks, not a claim that the hosted renderer or
mailbox delivery was exercised. Supabase documents the numeric
[Token variable and hosted-template GET](https://supabase.com/docs/guides/auth/auth-email-templates),
and the [read-only Auth-config endpoint](https://supabase.com/docs/reference/api/v1-get-auth-service-config).
No PATCH, SMTP authentication attempt, test email or Auth-user call was made.

| Hosted setting | Confirmed value |
| --- | --- |
| Email enabled / signup allowed | Yes / yes |
| Automatic email confirmation | Off: OTP ownership verification remains required |
| Code length | **6 digits**, matching frontend and resolver validation |
| Auth OTP expiry | **3,600 seconds / 60 minutes** |
| SMTP minimum resend interval | **60 seconds** |
| Auth email-sent quota | **30/hour**, shared project allowance |
| Minimum password length | 6; existing setup additionally requires letter/digit/symbol |
| Send-email hook / CAPTCHA | Disabled; no new hook dependency was found |
| Password-change notification email | Disabled in inspected configuration |
| Site URL / redirect allowlist | Official frontend URL present and correct |

The separate setup proof lasts **five minutes after successful OTP verification**.
The existing reviewed rate limiter remains IP 40/15 minutes, dispatch 3/Student
ID/15 minutes, verification 8/ID/15 minutes; inspection shares the verification
bucket. Stage 1 verified its stored definition/permissions. No bucket was consumed
or queried during this preparation.

The Gmail owner still needs to verify the intended account/app credential is
usable and not revoked/restricted, and that the approved recipient can receive
mail. No provider quota increase, credential replacement or SMTP change is
currently justified by a confirmed failure. Actual acceptance/delivery requires
the separately approved email test; a neutral HTTP 202 is not proof of delivery.

## Authenticated Vercel identity and Production environment

Vercel CLI authentication is now available; the earlier private-configuration
access blocker is resolved. Read-only project/deployment API checks confirmed:

| Property | Confirmed value |
| --- | --- |
| Scope | `mabrenquiro-2764s-projects` |
| Project | `kandidato` |
| Project ID | `prj_5T95TJu8hU8cLPL83JzVMFCELHIt` |
| Account ID | `team_xDikERrDI5aIlFlbWNpEqzy7` |
| Domain inspected | `https://witkandid.vercel.app` |
| Current Production deployment | `dpl_DAee8J6RCaeHQitrHu31yBEDzKmz`, READY, target production |
| Deployment URL | `kandidato-ne9jo5z6q-mabrenquiro-2764s-projects.vercel.app` |
| Current source SHA | `3b153e57b4e45b618c0cca1c01011f2927276ebd` |
| Current source ref / action | `github-checkpoint` / redeploy |
| Linked repository | `brenduling/kandid` |
| Configured Production branch | **`main`** |
| Framework / Node | Vite / **24.x** |
| Root/build/output/install overrides | None configured; framework/project defaults apply |

The domain deployment's project ID matches the inspected project. Source and
configured branch are distinct: do not assume a future push to `github-checkpoint`
will automatically publish the reviewed frontend to this project's configured
Production branch. Verify the exact chosen publication/deployment source; no
branch configuration change was made or proposed as an automatic fix.

Only the five relevant build values were individually read. No env pull/export,
server-secret retrieval or environment mutation was performed:

| Variable | Production value check | Existing scopes |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Exact official project URL | Production + Preview |
| `VITE_SUPABASE_KEY` | Publishable key; matches live bundle and is accepted by official Auth-settings GET; value withheld | Production + Preview |
| `KANDID_SUPABASE_KEY_PROJECT_REF` | Exact official project ref; required publishable-key build attestation present | Production + Preview |
| `VITE_ENABLE_STUDENT_ACCOUNT_SETUP` | Literal **false** | Production only |
| `VITE_ENABLE_VERIFIED_STUDENT_SETUP` | Literal **false** | Production only |

Each has exactly one applicable Production entry, with no branch-specific
override. All five checks pass. Live compiled flags also remain false. Supabase
metadata still reports resolver **v10**, linker **v7**, correct JWT settings and
absent `STUDENT_SETUP_SECURITY_ENABLED`; absence defaults setup off in both secure
handlers. No server flag belongs in VITE configuration.

Environment changes affect a new build, not an already-built frontend; see
[Vercel's environment lifecycle](https://vercel.com/docs/environment-variables/managing-environment-variables).
No environment or deployment change was performed here.

## Reviewed frontend versus current deployment

**The current frontend is still contract 2 and must not be enabled.** Its confirmed
source commit's recognition helper explicitly requires recognition/proof version
2. Current public assets lack the reviewed OTP-first copy and `setup_token`
transport. Those are consistent findings from source provenance and live assets,
not an inference from the disabled button alone.

The reviewed working-tree frontend requires contract **3** and remains uncommitted
on local `main`; HEAD is the old Production SHA above. Redeploying that SHA alone
will not publish the secure UI. No frontend fallback to contract 2 is appropriate.

All reviewed source hashes still match manifest
`2123b0d65a8cc8f62b74fb02d1bb4941e91882ff37216ae5db2d23f56f41c11e`.
The local production compilation passed with the verified public configuration,
both frontend flags explicitly false and output isolated under `.tmp/`:

- Ordinary `MODE=production`; exact official HTTPS URL/public key/attestation.
- Compiled OTP-first copy and `setup_token` transport present.
- No dependency on the localhost read-only mode or development request guard:
  production uses the normal transport; production-origin fixtures pass.
- Frontend SDK 2.104.1 and pinned Edge SDK 2.118.0 are different versions, with
  compatible reviewed request/session contracts covered by current tests.
- Local build used Node 22.13.1. Vite's engine range accepts configured Node 24.x;
  the new frontend has **not** been built/deployed by hosted Vercel yet.

The Vite/PWA build passed with only the existing nonblocking plugin-timing notice.
**87/87 targeted Node tests passed**, covering transport/proof compatibility,
ownership/session checks, disclosure boundaries, disabled gates, rate limiting,
concurrent linking, uncertain finalization and ordinary-login compatibility.
Earlier Auth/Mailpit, PostgreSQL, Deno and responsive-browser results remain in
the reviewed release report; they were not represented as new hosted tests here.

## Complete contract trace

| Stage | Reviewed frontend and deployed backend agree on |
| --- | --- |
| ID inspection | `inspect_setup`; uniform version-3 ID/verification acknowledgement, no identity details or password |
| OTP dispatch | `begin_access`; stored email only; authoritative SQL admission; neutral 202 and cooldown; may create an unconfirmed Auth identity if absent |
| OTP verification | `verify_access` with ID/code only; confirmed SDK session + fresh getUser; UID/ID-bound contract-3 proof; only name/program/year shown after OTP |
| Confirmation/password | Explicit owner confirmation, existing password policy, proof held in component memory; proof/session minimum expiry; refresh does not extend proof |
| Account linking | Same ID, verified session, setup flag, password and opaque token; claim before self-service Auth password write; finish rechecks identity/status and completes linkage |
| Success / existing account | Success requires explicit active Student response; local setup logout before normal login. Already-active branch goes to login without another password write |

No setup stage enrolls a student or grants current-term voting/candidacy
eligibility. Missing enrollment must not block login/navigation or disable the
persistent account. Existing schedule/RLS/duplicate-vote/receipt/blockchain paths
are unchanged. No valid account request was submitted to Production to test this.

## One-account test and exact approval scope

The owner answered **not yet designated**. No Student/Auth records were searched
or selected. The complete proposed procedure is in
[the consenting-account runbook](student-setup-consenting-account-smoke-test.md).
It covers one existing pending/unlinked identity, two maximum OTP dispatches to
the same consenting owner, one activation/password write, the active-account
follow-up, expected durable changes and safe recovery.

Smallest remaining separately approved actions:

1. Designate the exact existing record and consenting mailbox owner privately;
   authorize its scoped read-only baseline and the listed Auth/Student changes.
   Verify provider-account readiness; do not request credentials in chat.
2. Approve publication of only the reviewed frontend source and its deployment
   to the verified project **gated off first**. Record the actual new source SHA
   or reviewed artifact, branch and deployment ID. Publication/push and deployment
   are not authorized by this preparation.
3. Approve the bounded smoke-test window and its shutdown: server gate true,
   both Production frontend flags true with the same reviewed source rebuild,
   two OTP dispatches and one account completion plus login/follow-up.
   **The server gate is global**, not a per-account allowlist. The one-account
   procedure limits operator actions, not all other callers during enablement.
4. Execute only after those approvals and passing refreshed prerequisites; stop
   on nondelivery, admission errors, throttling or uncertain password completion.
   Close gates afterwards unless a separate public-launch approval says otherwise.
5. Any recovery SQL needs separate exact-proof/Auth-UID approval after shutdown,
   drain and Auth-outcome review. It records recovery and permits a fresh OTP;
   it does not undo an uncertain password change. Never delete accounts or restore
   vulnerable legacy handlers as cleanup/rollback.

No additional backend migration, Edge deployment, RLS/grant change or SMTP
correction was identified as necessary by these checks. **Preparation is complete;
public readiness and the live smoke test remain unproven and unauthorized.**

Evidence: `hosted-auth.json`, `vercel-production.json`, `frontend.json`,
`production-build.json`, `metadata.json` and the preserved Stage 1 records.
Filtered evidence excludes key/password values and raw Auth configuration.
