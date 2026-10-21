# Super Admin Dashboard recovery runbook

Status: **revision 2 prepared locally; not applied or deployed**. Target: Supabase project `fszgdxqxonqqcrzsnkca`. The current approval request is SQL only.

## Scope and diagnosis

The production `students_release_safe_select` policy evaluates a direct query of `public.candidates`, while `authenticated` has no `SELECT` on that table. This produces SQLSTATE `42501` on the dashboard's existing `students` reads. The isolated SQL proposal adds one private boolean authorization helper and replaces only that policy branch. It does not grant candidate table access.

Revision 2 corrects the forward and rollback relation guards: `pg_get_expr` may emit `FROM public.candidates c` when `search_path` is pinned to `pg_catalog`. Both this qualified rendering and `FROM candidates c` are accepted for the exact candidate relation and alias. Other schemas and tables remain rejected. The helper, policy predicates, grants, ownership, and pinned search paths are unchanged.

Local scope verification reproduced the revision-1 SQL hashes after reversing only these guard edits. A read-only PostgreSQL SELECT on the official project verified all eight guard cases and both renderings of the existing policy. This checks the actual PostgreSQL regex engine without executing the installation transaction or changing settings.

The deployed `admin-user-management` function is ACTIVE v10 with `verify_jwt=true`; its deployed CORS allowlist omits `http://localhost:5174`, so the browser preflight is rejected. The prepared edge package contains the captured v10 entrypoint unchanged and adds only that localhost origin to the shared allowlist. Existing gateway JWT validation, `requireActiveAdmin`, and Super Admin action authorization remain in force. CORS permits a browser origin; it is not authorization.

The core dashboard data loader does not call `admin-user-management`: student count, pending count, and program summaries query `public.students` directly. The CORS package is retained as a separate proposal and is not part of this SQL recovery approval request.

## Required preconditions

1. Separately approve production execution. This document does not authorize a write or deployment.
2. Verify the project reference is exactly `fszgdxqxonqqcrzsnkca` and the current policy/helper baselines still match manifest revision 2.
3. The schema-exposure precondition is satisfied by the user's official Data API Settings screenshot confirmation: only `public` and `graphql_public` are exposed; `private` is not. Record this as user-provided evidence, not independent API verification. Stop if later evidence contradicts it.
4. Confirm the exact SQL artifact hashes in `docs/super-admin-dashboard-recovery-manifest.json` immediately before execution.
5. No Edge Function deployment is included in the SQL approval request. If the separate CORS proposal is later needed and approved, independently recheck its ACTIVE v10 source and `verify_jwt=true` baseline first.
6. Execute the SQL proposal with a PostgreSQL role that satisfies its explicit `current_user = 'postgres'` guard. The script uses a transaction and aborts if observed objects, ownership, RLS, grants, or policy fragments differ.

## Deployment order

### 1. Install the database correction

After all preconditions pass, execute only:

`supabase/proposals/super-admin-dashboard-students-policy-fix.sql`

The transaction creates `private.kandid_board_can_read_candidate_student(integer)` as `SECURITY DEFINER`, owned by `postgres`, with `search_path = pg_catalog` and explicitly schema-qualified relation references. It grants `authenticated` private schema usage and execute on only this new helper. It does not grant `SELECT` on `public.candidates`. The RLS policy continues to allow active Super Admins and active students reading their own row; active Electoral Board access is limited to students linked to a candidate in that Board user's election organization.

If any preflight or postflight assertion raises, the transaction should roll back. Do not repair drift inline; stop and review the new baseline.

### 2. Verify actual dashboard reads and RLS

From a genuine active Super Admin session, refresh `/super-admin/dashboard` and inspect the existing requests:

- `students` HEAD selecting `id` with exact count: succeeds and supplies the actual total student count.
- `students` HEAD selecting `id` filtered by `status=eq.pending`: succeeds and supplies the actual pending count.
- `students` GET selecting `program`, ordered by `id`, in the existing bounded pages: succeeds and supplies the actual program summary.

Require successful responses without SQLSTATE `42501` or HTTP 403. Compare displayed counts and program totals against read-only aggregate queries on the official database; do not create test records. If any core request still fails, inspect that request before proposing another change.

Using genuine accounts and read-only requests, verify:

| Caller | Student row | Expected |
| --- | --- | --- |
| Active Super Admin | Any row allowed by the existing Super Admin policy | Allow |
| Disabled/non-Super Admin | Arbitrary row | Deny |
| Active student | Own active row | Allow |
| Active student | Another student's row | Deny |
| Active Electoral Board | Candidate in an election in the Board's organization | Allow |
| Active Electoral Board | Candidate in another organization | Deny |
| Active Electoral Board | Another student's row not linked as an election candidate | Deny |
| Anonymous | Any student row | Deny |

Also verify `authenticated` still cannot `SELECT` from `public.candidates`; helper ownership/search path and the policy definition match the proposal's postflight assertions; `anon` cannot execute the helper; and `private` remains absent from exposed PostgREST schemas.

The role matrix in the local test suite is a contract model with source assertions. It is not a substitute for these real RLS checks.

### 3. Optional CORS correction: separate approval only

Do not perform this step as part of the SQL recovery. Consider it only if subsequent evidence shows this endpoint is needed for the dashboard behavior being tested, and obtain separate deployment approval first. A remaining auxiliary notification preflight error does not establish that the core student queries still fail.

Do not deploy from the repository's regular `supabase/functions` tree: its shared security module contains unrelated local edits. Build a temporary Supabase project containing only these reviewed files:

- `edge/config.toml` copied as `<temp>\supabase\config.toml`
- `edge/functions/admin-user-management/index.ts` copied as `<temp>\supabase\functions\admin-user-management\index.ts`
- `edge/functions/_shared/kandidProductionSecurity.mjs` copied as `<temp>\supabase\functions\_shared\kandidProductionSecurity.mjs`

Then, only after separate deployment approval and hash verification, run from the temporary project root:

`supabase functions deploy admin-user-management --project-ref fszgdxqxonqqcrzsnkca --workdir <temp>`

Do not pass `--no-verify-jwt`. The isolated config sets `verify_jwt = true`. The temporary project must contain no other functions. No secret changes are needed.

## Post-deployment checks

For the current SQL-only recovery, complete step 2 and confirm helper ownership, pinned search path, EXECUTE grants, RLS, and unchanged candidate table privileges. The Edge Function checks below apply only to a separately approved CORS deployment.

1. Confirm `admin-user-management` is ACTIVE and `verify_jwt=true`; compare the deployed source against the manifest artifacts and confirm unrelated functions did not change.
2. Send an OPTIONS preflight from `http://localhost:5174` requesting POST and only the allowlisted headers (`authorization`, `apikey`, `content-type`, `x-client-info`); expect 204 with `Access-Control-Allow-Origin: http://localhost:5174`.
3. Confirm an unlisted origin and non-POST preflight remain rejected (403).
4. From a genuine active Super Admin browser session, load `/super-admin/dashboard` and verify the existing student count, pending count, and program query return successfully. Check the existing organization, election, vote-count RPC, audit RPC, and `admin-user-management` list calls independently if the page still reports failure.
5. Confirm `admin-user-management` still rejects missing/invalid JWTs and returns 403 to authenticated non-admin or non-Super Admin callers for the `list` action. Do not log or copy access tokens.
6. Verify the dashboard is showing live database values, not fallback or mock values. Preserve sanitized HTTP status/error evidence only.

No signed-in Super Admin dashboard query was run during local preparation.

## Rollback

### Database rollback

Only on an authorization leak or critical regression, execute:

`supabase/proposals/super-admin-dashboard-students-policy-fix.rollback.sql`

It restores the captured original policy and drops the helper/grants. **This restores the original `42501` dashboard failure.** The rollback aborts if the installed helper/policy/grants or other private grants differ from the expected state. If it aborts, stop and prepare a reviewed fix-forward; do not broaden the rollback.

### Edge Function rollback

If the CORS deployment changes any POST authorization behavior or affects the official production origin, redeploy the same captured v10 `index.ts` with `baseline/kandidProductionSecurity.mjs` substituted for the corrected shared module, using an isolated temporary project and `verify_jwt=true`. This removes localhost:5174 from the allowlist while restoring the captured v10 source. Verify ACTIVE status, JWT configuration, and the official origin after rollback.

Do not roll back one layer merely because the other layer failed; assess each independently. If checks fail without a security regression, stop and fix forward rather than reverting blindly.

## Approval gates and risks

- Executing the SQL transaction requires explicit approval. The optional Edge Function deployment is excluded and requires separate approval if demonstrated necessary.
- The exposed-schema condition is cleared by the user's official screenshot confirmation, not independently by API.
- The role tests are local contract tests, not PostgreSQL integration tests. Real authenticated-role verification remains required after installation.
- The database correction fixes the confirmed students-policy failure. It does not itself fix independent dashboard failures from organizations/elections policies, vote-count or audit RPC authorization, or function auth; verify those calls separately if they remain.
- The localhost CORS allowance does not authorize a caller; production authorization remains JWT plus active server-side administrator checks.
