# Student Account Setup — Stage 1 production release

**Stage 1: PASS, installed with setup disabled. Public activation: NO-GO pending
hosted verification and the separately approved account smoke test.**

Official Supabase: `fszgdxqxonqqcrzsnkca`, project name `kandid`, region
`ap-northeast-1`, final status `ACTIVE_HEALTHY`. Final inspection completed
**2026-10-22 16:12:51 UTC / 2026-10-23 00:12:51 Asia/Manila**.

This records the explicitly approved database/two-function release. It supersedes
the previous reports' **not installed / legacy functions deployed** findings.
The historical release manifest and package remain unchanged; their local-candidate
labels describe the frozen review artifact, not today's deployment status.

## Exact package and completed operations

```text
.tmp/student-setup-security/release-f8d2e2176bf1/
review-manifest.json SHA-256:
2123b0d65a8cc8f62b74fb02d1bb4941e91882ff37216ae5db2d23f56f41c11e
```

All four mapped Edge files, all three packaged SQL files and all 20 reviewed
source/test/documentation files matched the manifest before release. The package
was not regenerated or edited.

| Production operation | Completion UTC, 2026-10-22 | Result |
| --- | --- | --- |
| Apply only `student-setup-security.sql` | 15:53:49 | CLI succeeded; installed objects independently verified |
| Deploy `link-student-identity` | 15:57:21 | v6 → **v7**, ACTIVE, `verify_jwt=true` |
| Deploy `resolve-student-login` | 16:09:31 | v9 → **v10**, ACTIVE, `verify_jwt=false` |

Only the reviewed SQL was submitted, using the explicit official project ref.
Its SHA-256 is:

```text
d2c2cf8f29cd531dfcf0c1890bea67e7f97dcfcbbe1d1d6cb13cc9a274f7885a
```

It ran with its existing transaction, timeout, absence guards, revocations/grants
and schema-cache notification. No broad db push, migration-history repair or
migration-history write was performed. Its function bodies were stored, not
invoked. Existing Student/Auth/enrollment/election/receipt/audit rows were not
written by this release. No application RPC was used for verification.

## Installed database verification

Fresh pre-install checks passed **47/47** assertions. All 12 sections of the
detailed catalog result matched the previous approved inspection, including
effective privileges, policies, function source, indexes, constraints and roles.
One initial read-only CLI query timed out; the identical query succeeded on retry
before any migration was attempted.

Post-install catalog checks passed **73/73**, including a refresh before the
resolver deployment. All seven expected security objects are installed:

| Object | Verified production state |
| --- | --- |
| `private.student_setup_proofs` | Exact 11 columns/types/nullability; five validated constraints; owner postgres; RLS enabled; no application-role grants or policies |
| `private.student_setup_one_unresolved_claim` | Valid, ready partial unique index on Student ID for claimed/incomplete/unrecovered attempts |
| `private.kandid_setup_record_v1(text,uuid,text)` | Exact reviewed body; no direct application-role EXECUTE |
| `public.kandid_student_setup_admission_v1(text,uuid,text)` | Exact body, named arguments and defaults; service-role-only EXECUTE |
| `public.kandid_student_setup_issue_v1(text,uuid,text,text)` | Exact body/arguments; service-role-only EXECUTE; five-second lock timeout |
| `public.kandid_student_setup_claim_v1(text,uuid,text,text)` | Exact body/arguments; service-role-only EXECUTE; five-second lock timeout |
| `public.kandid_student_setup_finish_v1(text,uuid,text,text)` | Exact body/arguments; service-role-only EXECUTE; five-second lock timeout |

All five functions return JSONB, use SECURITY DEFINER with owner postgres and
`search_path=pg_catalog`. Their stored source bodies match the approved SQL
exactly. Effective anon/authenticated EXECUTE is denied on every new function;
direct service-role access to the helper/proof table is also denied.

Existing inspected schema privileges, roles, default grants, policies, table/
column grants, constraints, indexes, limiter and other checked function contracts
remain unchanged. The existing Student audit trigger remains enabled and unchanged.
No broader policy or account-data repair was needed or performed.

## Deployed function evidence

| Function | Function ID | Final version | JWT |
| --- | --- | --- | --- |
| `link-student-identity` | `c17c4498-dbaa-450f-ae9a-2f9117e7dd97` | **7** | true |
| `resolve-student-login` | `ae65d9eb-b53d-4b7c-8fd0-ba3053587faa` | **10** | false |

Both entrypoints and their shared dependencies were downloaded after deployment.
Every **raw** SHA-256 matched the reviewed package exactly:

| File | SHA-256 |
| --- | --- |
| `link-student-identity/index.ts` | `f2e10a288349fe43316e1a146531f2890e26f096c70f8d4fdbab002818cf7995` |
| `resolve-student-login/index.ts` | `b8f2c3ea16e7967636b263da7d12df54faad8f1b768bbcc674be8200dd0f8c3a` |
| `_shared/studentSetupAdmission.ts` | `973a09158bec9ccd1d5682d282c265ceaafa741e37b5ed76eb96a53569ba4fdd` |
| `_shared/kandidProductionSecurity.mjs` | `87a7100ca782092528dc9cd49e7941216fe664ac4a0099f5d44fc9cf476733e2` |

Both deployments passed **14/14** metadata/source/HTTP assertions. Versions were
checked again after source retrieval and in the final combined project inspection.

Non-mutating live checks:

- Both functions: production-origin OPTIONS **204**, exact allowed origin and
  required request headers.
- Linker: unauthenticated GET **401**, preserving the JWT gateway boundary.
- Resolver: GET **403**, matching the reviewed handler's explicit non-POST denial.

The first resolver verification incorrectly expected 405. Production actions were
paused; the frozen source and a local no-network execution established that 403
is the correct contract. Only the ignored verification-script assertion changed.
The rerun passed without modifying production code/configuration. The original
failed-verification record is retained alongside the correction evidence.

No valid Student ID, setup action, login attempt, OTP request, password update or
rate-limit RPC was submitted. These checks establish deployment/configuration
compatibility; they do not establish real SMTP delivery or account completion.
The four existing manifest/production-origin tests also passed locally, plus the
isolated GET-contract check with zero client/network calls. Earlier PostgreSQL,
Auth/Mailpit, Deno and browser results remain documented in the reviewed release;
they were not rerun or represented as production account tests here.

## Final disabled state

The live `https://witkandid.vercel.app/student-setup` compiled environment is
ordinary `production`, targets the official Supabase URL, and explicitly contains:

```text
VITE_ENABLE_STUDENT_ACCOUNT_SETUP=false
VITE_ENABLE_VERIFIED_STUDENT_SETUP=false
```

Both were already false before any Stage 1 write and remained false after both
deployments. The three inspected frontend asset hashes remained unchanged between
the initial and final checks. No Vercel configuration or frontend deployment was
performed; private future-build variable scopes were not independently inspected.

`STUDENT_SETUP_SECURITY_ENABLED` remains **absent**, exactly as before release.
The now-installed secure handlers require the literal string `true`; absence
therefore disables setup. No secret was set or changed. The former legacy
handlers that ignored this switch have now been replaced. Ordinary login is not
gated by this setup switch, but no real login was attempted during Stage 1.

Required Edge secret names are present. Their values were not printed, copied
into VITE variables or changed. No conclusion about real HMAC/SMTP credential
validity is inferred solely from secret-name presence.

## Remaining blockers and rollback readiness

Stage 1 has no unresolved schema/source/permission mismatch. **Public activation
remains NO-GO** until the next separately approved steps:

1. Inspect hosted confirmation/magic-link template bodies and provider readiness.
   Numeric OTP content, actual delivery and sender authorization still require
   hosted evidence; no real email was sent here.
2. Complete an explicitly approved, consenting-account OTP/account smoke test,
   including real Auth/Postgres completion and recovery behavior where needed.
   Enabling the server switch, sending email or modifying that account requires
   separate approval; none is implied by Stage 1.
3. Verify the intended Vercel project/source, publish/deploy the reviewed version-3
   frontend under its own approval, and consider frontend/server enablement only
   after the required checks. Current frontend flags must remain disabled meanwhile.

The reviewed rollback and exact-claim recovery files remain hash-verified in the
package. Keep the secure v7/v10 handlers gated off if stopping the release; do not
restore enabled legacy v6/v9. Optional schema rollback refuses unresolved claims,
drops only the five new functions and retains the proof journal and all identity/
history records. Inspect unresolved claims and drain/review Auth outcomes before
any separately approved rollback or recovery. Neither script was executed, and
no destructive rollback or password reversal was attempted.

Evidence is local under `.tmp/student-setup-stage1-preflight/`: package hashes,
pre/post catalog captures/comparisons, migration/deployment attempt/result records,
downloaded sources, both verification reports, method-contract correction, final
frontend/project metadata and `summary.json`. No commits or pushes were made.
