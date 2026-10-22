# Student Account Setup — approved production catalog inspection

**Database prerequisites: PASS. Installed secure backend readiness: FAIL / not
installed.** No unexpected schema or permission mismatch was found that requires
changing the reviewed SQL. The database is compatible with installing the scoped
version-3 release after separate production approval; public activation remains
**NO-GO** until installation and the remaining hosted checks are complete.

Official project: `fszgdxqxonqqcrzsnkca`. Successful read-only catalog captures:
**2026-10-22 15:31:50–15:34:06 UTC** (23:31:50–23:34:06 Asia/Manila).
Database `postgres`, PostgreSQL **17.11**, inspection role `postgres`.

This report replaces the **fresh catalog inspection blocked** finding in
`student-setup-production-preflight.md`. It does not supersede that report's
remaining template/provider, Vercel identity, deployment or genuine email/account
verification conditions. The frozen release package was not changed.

## Inspection boundary and evidence

Only PostgreSQL catalogs, privilege-check built-ins and stored function/policy
definitions were read, through the Management API with an explicit project ref.
Each successful query used:

```sql
begin transaction isolation level repeatable read read only;
set local statement_timeout='15s';
-- One SELECT containing catalog subqueries; no application RPC invocation.
rollback;
```

Both results independently report `transaction_read_only=on`. No student,
administrator, Auth-user, enrollment, proof or rate-bucket **rows** were read.
No migration, application RPC, rate-counter update, deployment, flag change, OTP
request or account modification was performed. Catalog function definitions were
inspected as text, never executed. An initial CLI positional-argument issue was
resolved by using `--file`; no production configuration correction was needed.

Local evidence under `.tmp/student-setup-catalog-inspection/`:

| File | Evidence |
| --- | --- |
| `baseline.json` | Columns, constraints, indexes, RLS, function ACLs/hashes, trigger and object absence |
| `access.json` | Effective table/column/schema privileges, complete scoped policy expressions, function definitions, index/constraint validity and default grants |
| `baseline-executed.sql` | Exact baseline query; SHA-256 `75d47df7dc00068793ce63f51b262dbb87b828d73b8542d9257d9e524d316140` |
| `access-executed.sql` | Exact final follow-up; SHA-256 `3bb2122625f7b07da6bc3b295c278850e11cf5c23182d0a0efd43d2d223892af` |
| `assessment.json` | **47/47 catalog/package assertions passed** |

The baseline derives from
`supabase/proposals/student-setup-security.preflight-readonly.sql`, adding the
transaction's read-only indicator. Evidence files are local and ignored by Git.
Definitions and ACLs for the same objects matched across the captures.

## PASS — existing schema and constraints

All 16 checked columns exist with compatible types:

| Relation | Required columns and observed types |
| --- | --- |
| `public.students` | `id integer`; `student_number varchar(50)`; `first_name`, `last_name varchar(100)`; `email varchar(150)`; `program varchar(100)`; `year_level integer`; `status varchar(20)`; `auth_user_id uuid` |
| `public.admin_users` | `id integer`; `email varchar(150)`; `status varchar(20)`; `auth_user_id uuid` |
| `auth.users` | `id uuid`; `email varchar(255)`; `email_confirmed_at timestamptz` |
| `private.student_auth_rate_buckets` | All four required non-null columns: `bucket_key text`, `window_started_at timestamptz`, `attempts integer`, `updated_at timestamptz` |

Student ID and names are non-null. Nullable Student email/status/Auth link are
compatible: the new shared admission helper rejects invalid email/status and
handles unlinked identities explicitly. Its bigint proof reference accepts the
existing integer Student ID; no existing ID conversion is required.

All four Student constraints are validated:

- `students_pkey`: primary key on `id`.
- `students_student_number_key`: unique `student_number`.
- `students_status_check`: exactly `pending`, `active`, `disabled`.
- `students_auth_user_id_fkey`: references `auth.users(id) ON DELETE SET NULL`.

`students_auth_user_id_unique_idx` is unique for non-null Auth links. All seven
Student indexes and the inspected administrator/Auth/rate-bucket indexes are
valid and ready. Administrator email/Auth-link uniqueness and rate-bucket key/
attempt checks are present and validated.

There is no normalized-email unique constraint on Students. This is compatible
with the reviewed design: complete SQL collision checks and serialized Student/
administrator mutations supply its setup enforcement. The release neither
assumes such a constraint nor adds one. Catalog inspection cannot establish
whether existing accounts contain conflicting data; admission must reject any
such identity without automatic repair. No account data was inspected.

## PASS — existing RPC, owner and trigger prerequisites

Exactly one required limiter overload exists:

```text
public.kandid_consume_student_auth_rate_limit(
  p_requester_fingerprint text,
  p_student_fingerprint text,
  p_operation text
) RETURNS boolean
```

It is owned by `postgres`, `SECURITY DEFINER`, with
`search_path=pg_catalog`. Effective EXECUTE: `service_role=true`, `anon=false`,
`authenticated=false`. Its definition matches the reviewed SHA-256
`65dda69b5a7834c7a57f21ee973d9c770f75ca5712d8f4ffc06fcab5d736c3b0`.
The definition retains IP 40/15 minutes, setup 3/15 minutes and verification
8/15 minutes. Reading that definition did not consume any allowance.

The proposed owner `postgres` has required public/private schema access and
CREATE privileges, SELECT on Students/administrators/Auth users and UPDATE on
Students. It has BYPASSRLS, including for `auth.users`; the new helper therefore
does not require Auth schema grants or RLS changes. It is not a superuser.

The enabled `audit_students_mutations` trigger and its pinned-search-path
`kandid_audit_admin_row_change()` definition match the reviewed hash
`9e0edf1242894b1471775875f7f16abf271d1d665687efd4ff78f6c9295b35e3`.
Its existing null-`auth.uid()` service-call branch is compatible with the secure
linker's separate service-role client. Ordinary signed-in administrator auditing
is unchanged. This is source/privilege verification, not a production write test.

## PASS — current RLS and access boundaries

RLS is enabled on Students, administrators, Auth users and rate buckets.

| Surface | Effective production access |
| --- | --- |
| Anonymous Student/administrator reads or writes | None, including column grants |
| Authenticated Student reads | Nine columns only: `id`, `first_name`, `last_name`, `program`, `year_level`, `is_shs`, `status`, `created_at`, `photo_url` |
| Authenticated Student/administrator INSERT, UPDATE, DELETE | None; no mutation column grants or policies |
| Direct `auth.users` access by anon/authenticated/service role | None; BYPASSRLS alone does not confer table privileges |
| Direct private rate-bucket access by application roles | None, including service role |
| Service-role Student access | SELECT/UPDATE; no INSERT/DELETE |
| Service-role administrator access | Existing SELECT/INSERT/UPDATE/DELETE, unchanged |

The only two scoped policies are authenticated SELECT policies:

- `students_release_safe_select`: active Super Admin; the student's own Auth UID
  with active central status; or the existing organization-scoped candidate-read
  helper for an authorized Board identity.
- `admin_users_own_auth_profile`: the authenticated administrator's own Auth UID.

There are no anonymous, mutation or private-bucket policies among these inspected
relations. The Board helper is SECURITY DEFINER with a pinned search path and
retains active Board and organization checks. These existing policies do not
depend on new-term enrollment for normal account access. Pending setup details
must continue through the verified server contract, rather than a new browser
Student lookup grant.

Existing public-schema default function privileges grant application roles
EXECUTE. The reviewed migration explicitly revokes PUBLIC/anon/authenticated/
service-role access on each new function and grants only the four public RPCs
back to service role. Preserve those statements and the transaction; do not
execute a partial script or weaken existing defaults/policies to enable setup.

## FAIL — secure release is not installed yet

These are the **exact missing objects relative to the post-release contract**:

| Object | Current state | Required after installation |
| --- | --- | --- |
| `private.student_setup_proofs` | Absent | Reviewed proof fields/checks; owner postgres; RLS on; no direct application-role grants |
| `private.student_setup_one_unresolved_claim` | Absent | Valid partial unique index on `student_id` for claimed, incomplete, unrecovered attempts |
| `private.kandid_setup_record_v1(text,uuid,text)` | Absent | JSONB; postgres SECURITY DEFINER; pinned search path; no direct application-role EXECUTE |
| `public.kandid_student_setup_admission_v1(text,uuid,text)` | Absent | JSONB; service-only EXECUTE; postgres SECURITY DEFINER; pinned search path |
| `public.kandid_student_setup_issue_v1(text,uuid,text,text)` | Absent | Same security contract; `lock_timeout=5s` |
| `public.kandid_student_setup_claim_v1(text,uuid,text,text)` | Absent | Same security contract; `lock_timeout=5s` |
| `public.kandid_student_setup_finish_v1(text,uuid,text,text)` | Absent | Same security contract; `lock_timeout=5s` |

No overload using any of the five new function names exists. There is no table/
index name collision. Absence is the expected pre-install state and passes the
proposal's prerequisites; it means the secure handlers cannot yet be enabled.
Production signatures, EXECUTE ACLs, definer settings and RLS for these **new**
objects cannot be certified until the separately approved installation occurs.

## Deployment assessment and ordering

**GO for approval of the scoped database installation on catalog compatibility.
NO-GO for enabling the secure setup workflow now.** No additional prerequisite
migration, existing RLS/grant correction, identity backfill or SQL rewrite was
identified by this inspection.

The package manifest and all four mapped function files/three SQL files still
match their reviewed hashes. An additional **4/4 tests passed**: release manifest
integrity plus the three isolated production-origin compatibility scenarios.
Existing broader fixture results remain in `student-setup-security-release.md`;
they were not represented as newly executed production tests.

After separate approval, the minimum ordered backend release remains:

1. Verify target/source and establish setup containment described in the previous
   preflight. The legacy v9/v6 functions last inspected there ignore the new
   server flag; setting that flag false alone does not contain those versions.
2. With setup off and a recovery checkpoint approved, apply only
   `supabase/proposals/student-setup-security.sql` as the reviewed owner. SHA-256:
   `d2c2cf8f29cd531dfcf0c1890bea67e7f97dcfcbbe1d1d6cb13cc9a274f7885a`.
   Refresh the absence/drift checks immediately before installation if time or
   another release intervenes. No migration-history repair or broad db push.
3. Before enabling setup, repeat catalog checks against all seven installed
   objects. Require exact named parameter signatures, JSONB results, defaults,
   owner/SECURITY DEFINER/search path, service-only RPC execution, private denial,
   proof RLS/index validity, and unchanged existing policy/grant/trigger hashes.
4. Deploy only the hash-verified mapped secure linker, then resolver, with server
   setup disabled; preserve linker JWT true and resolver JWT false. An explicitly
   approved urgent containment deployment of gated-off handlers can precede SQL.
5. Complete the unchanged hosted template/provider and authenticated Vercel/source
   checks; deploy the reviewed version-3 frontend gated off. Genuine OTP delivery
   and account completion still require their own named-account approval. Only
   then consider separately approved server/frontend enablement.

No current production Edge source, Vercel settings or email configuration was
refreshed by this catalog-only task. Earlier observations of an enabled legacy
frontend remain a release risk requiring their separately scoped verification
and containment; this report is not evidence that they have changed.

Rollback remains the reviewed gated-off secure handlers plus optional
`student-setup-security.rollback.sql`: reject unresolved claims, remove only the
five new functions, retain the journal and existing identity/history. Interrupted
password requests require drain/Auth-outcome review and separate approval of the
exact proof/UID before `student-setup-security.recover.sql`. No recovery or rollback
SQL was executed. This inspection authorizes no subsequent production action.
