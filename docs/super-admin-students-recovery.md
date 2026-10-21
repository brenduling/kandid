# Super Admin Students recovery — local preparation

## Confirmed production findings (2026-10-22)

Official project: `fszgdxqxonqqcrzsnkca`. No production mutations were performed.

| Request | Production evidence | Effect |
| --- | --- | --- |
| `super-admin-manual-enrollment` | Absent from the 13-function inventory; localhost OPTIONS returned 404 | Blocks directory, details, registration and management |
| `super-admin-masterlist-import` | Absent; localhost OPTIONS returned 404 | Blocks institution-wide masterlist staging/review/finalization |
| `admin-user-management` | ACTIVE v10, JWT verification enabled; localhost OPTIONS returned 403 without an allow-origin header | Shared Super Admin notification request fails independently of directory loading |

The directory calls `list_students`, which only invokes the existing service-only `kandid_super_admin_list_students` RPC. It does **not** create or update a student. Keeping explicit read actions and mutation actions separate within the existing authenticated service avoids introducing another API. Catalog and photo reads retain their existing RLS paths. Organization filters and membership enrichment retain `organization-eligibility`.

Production has the manual enrollment, institution/program membership synchronization, organization admission, masterlist reconciliation, program review and atomic membership finalization dependencies. Read-only aggregates at investigation time: 9 students, 3 active, 6 pending, 0 disabled. These are database aggregates, **not** evidence of a successful signed-in browser directory request. No usable matching logs were returned for the queried one-hour interval. A genuine user-session check remains a post-deployment requirement.

The installed list RPC already supports literal wildcard escaping and normal email/name search correctly. An isolated database reproduction confirmed that a combined full-name search did not match. The proposed SQL therefore changes full-name matching and linked-identity protection only; it does not attempt to repair valid escape literals or email regular expressions.

## Local implementation

- Preserve the Students page, directory layout, status filters, organization filter, six sorts and pagination. Prevent stale directory results from overwriting newer search/filter results; retain fail-closed membership enrichment.
- Add an authorized details dialog showing central profile and current-term enrollment separately, plus existing manual-organization admission/removal actions. Automatic institution/program memberships remain managed by existing enrollment/coverage rules. Board Students is unchanged.
- Keep the existing three-step manual registration and term enrollment contracts. Prevent duplicate in-flight registrations and membership actions. Unconfirmed write responses instruct the administrator to refresh; never automatically retry.
- Keep CSV → local preview → staged Masterlist Review → reconcile → explicit finalization. Validate required/duplicate headers, five-digit new/import IDs, years 1–6, email format, duplicate IDs, parser errors and maximum 5,000 rows. All duplicate occurrences are rejected locally. Existing database records are reconciled rather than overwritten. Incremental import remains the default; authoritative full-roster handling retains its separate affected-student preview/fingerprint confirmation and cannot omit locally invalid rows silently.
- Block pending/unknown reconciliation statuses in the review and service readiness count. Show completion counts for **staged** rows only. Locally rejected rows are explicitly not imported. Backend failure never produces a successful import result.
- Pin both service SDK imports to `@supabase/supabase-js@2.118.0`. Use the SDK's concrete client type rather than unresolved generic factory return types. Preserve JWT-derived actor verification, active Super Admin role checks and audit writes.
- Require explicit allowlisted manual-management actions. The unused legacy no-action registration entry is rejected before it can reach its older write path.
- SQL proposal changes only `kandid_super_admin_list_students` and `kandid_super_admin_update_student`. Listing adds full-name matching and an `identity_linked` boolean (not an Auth UUID). Editing cannot substitute the Student ID or email of an Auth-linked student. Names/status/profile edits retain existing rules and audits. No grants, RLS policies, schema exposure or records change at installation.

`docs/super-admin-students-recovery-manifest.json` is the exact file/hash scope. Unrelated dirty files and environment files are excluded. SQL remains under `supabase/proposals`, outside automatic migration pushes.

## Validation and limits

Run from `kandid-clean`:

```powershell
node --test tests/superAdminStudentsRecovery.test.mjs tests/superAdminStudentsPresentation.test.mjs tests/superAdminStudentsCsvImportAction.test.mjs tests/superAdminStudentMobileActions.test.mjs tests/superAdminMembershipRemoval.test.mjs tests/superAdminIndividualUnenrollment.test.mjs tests/superAdminAutomaticMembershipSync.test.mjs tests/masterlistImportScope.test.mjs tests/boardManualEnrollmentComplete.test.mjs tests/boardManualEnrollmentReadonly.test.mjs tests/boardManualEnrollmentRegistrationDeploy.test.mjs
node scripts/kandid-super-admin-students-pg17.mjs
node scripts/kandid-super-admin-students-browser.mjs
```

The PostgreSQL runner verifies the existing isolated Docker container identity/port, creates a uniquely named synthetic database, executes the exact proposal and rollback, then removes only its own database. It cannot accept a production connection string. Tests cover role denial, literal/full-name/email search, status/sort/pagination, linked-ID/email rejection, unchanged credentials, audit records, source guards and exact rollback.

Browser tests serve the production build on a temporary loopback-only server, use a new synthetic Chrome profile, intercepted backend responses and DNS blocking for Supabase. They do not use existing sessions or send production requests. The normal localhost:5174 configuration remains unchanged. Edge handler fixtures test CORS, invalid sessions, Student/Board/disabled-admin denial, server-derived actor IDs, manual creation, membership admission, CSV staging/finalization and failure outcomes. Mocked finalization proves handler orchestration; it does not substitute for the real database finalizer. Existing production finalizer source was inspected for transactional reconciliation, eligibility/collision guards, preserved existing identities and no Auth/password writes.

Type check both functions with Deno 2.9.6 using a task-specific dependency cache outside the frontend tree. Run targeted ESLint and `npm.cmd run build`. Results: 156 targeted Node tests passed; 33 isolated PostgreSQL checks passed; both Deno checks passed; targeted ESLint has zero errors and two existing effect-dependency warnings; production build and targeted diff checks passed. Browser checks passed at 1280px and 375px: directory, search, status/organization filters, sort, pagination, details, manual registration, empty/error/authorization states, and CSV preview (one valid and one invalid row). No page overflow, runtime exceptions, production requests or writes occurred. No full production import, real manual registration, account operation or load test is authorized.

## Separate production approval required

Do not execute the following sequence without explicit approval of the manifest and SQL:

1. Recompute raw and LF-normalized SHA-256. Confirm the official project, current inventory (both services still absent) and installed dependency contracts. If either service has appeared or database source/grants differ, stop for a fresh baseline review.
2. Capture current aggregate/fingerprint metadata without personal record output. Read the forward SQL guard: exact `pg_get_functiondef` baseline hashes, owner `postgres`, SECURITY DEFINER, pinned `search_path=pg_catalog`, no anon/authenticated EXECUTE, service-role EXECUTE. The same checks apply to both RPCs. Stop on mismatch.
3. Install **only** `supabase/proposals/super-admin-students-recovery.sql` as one transaction, with its lock timeout and guards. No unrelated migration batch. Installation replaces two functions only and does not mutate students, enrollments, votes or accounts.
4. Deploy only `super-admin-manual-enrollment` with `verify_jwt=true`, its reviewed `index.ts`, `_shared/kandidProductionSecurity.mjs` and `_shared/membershipAdmission.js`. Verify ACTIVE status, JWT configuration and downloaded source hashes before any genuine UI action.
5. Deploy only `super-admin-masterlist-import` with `verify_jwt=true`, its reviewed `index.ts` and `_shared/kandidProductionSecurity.mjs`. Verify ACTIVE/JWT/source hashes and unchanged unrelated function inventory.
6. Verify OPTIONS from `http://localhost:5174` permits the intended headers; untrusted origins remain rejected. Use existing genuine sessions for **nonwriting** directory/details checks: Super Admin succeeds, Board/Student cannot access the institution-wide service. Verify actual directory totals/search/filter/sort/pagination against read-only database aggregates. Do not create a production student or finalize a real import as a test without separate authorization.
7. The separate `admin-user-management` v10 CORS defect is already covered by `docs/super-admin-dashboard-recovery-runbook.md` and its isolated CORS package/manifest. It is **not required to unblock student listing**, and is not included in this deployment scope. Obtain separate approval and reverify its v10 baseline if shared notifications must also be repaired. No shared shell change is needed.

Deploying only frontend changes will not restore absent backend services. This task performs no deployment or flag/environment change. Frontend publishing/Vercel remains separately approval-gated.

## Rollback and failure handling

- Stop immediately on unexpected authorization, schema, source, deployment or response errors. Do not broaden permissions, repair records automatically or retry an uncertain mutation.
- Before rollback, stop new administrative write attempts. Remove **only** the two functions newly restored by this release if containment is required and approved; do not alter unrelated functions. Restore the previous frontend source using its reviewed publication process, preserving unrelated local work.
- Execute `supabase/proposals/super-admin-students-recovery.rollback.sql` only under separate approval. It guards the installed function bodies and restores the exact two captured baseline definitions in one transaction, preserving ownership/ACLs and all stored records.
- Rollback is code-only. It does not reverse legitimate later student/enrollment/membership/audit changes. Such records must not be deleted to simulate rollback. After reverting the linked-identity edit guard, keep the new write services unavailable until the identity contract is reviewed again.
- Existing manual enrollment commits its identity/enrollment RPC before membership/audit follow-up. A follow-up failure can therefore leave a valid enrollment; the UI reports uncertainty and requires refresh/review. CSV staging can similarly leave a draft after a later failure. The trusted CSV finalization RPC itself is atomic; its separate audit/response can fail after commit. These existing partial-response limits are preserved and documented, not hidden as success.

## Approval gate

Local preparation does not make the production-backed page functional while its services are absent. Approval must name the two new Edge Functions and, if accepting full-name/identity protections, the two-function SQL proposal. RLS, Board functions, elections, voting, receipts, blockchain, secrets and Auth configuration are outside this recovery.
