# Archived test-term classification assessment

2026-10-22, Asia/Manila. Official project: `fszgdxqxonqqcrzsnkca`.

**Conditional GO for the design; NO-GO for a production archive or schema-only
shortcut under the existing application contracts.** A retained, Closed test
term and a new official Draft can coexist safely by different IDs, but the
existing natural-key lookups must first become classification-aware. No
production SQL, deployment, archive, draft creation or activation was performed
in this assessment. Existing production feature-release approval from another
task is not approval for this academic-term change.

## Evidence and current behavior

`AGENTS.md`, the prior cleanup inventory, lifecycle migrations, transition
proposal, membership admission/activation code and term selectors were reviewed.
Database evidence is the previously captured 2026-10-22 catalog/dependency
inventory; it was not refreshed because this task forbids production SQL.

- Term 1 is the reviewed sole Active term, 1st Semester AY 2026–2027.
- Term 2 is the reviewed Closed 2nd Semester AY 2026–2027. Its original ID,
  academic label, activation/closure timestamps and historical associations must
  remain unchanged. The owner confirmed that the semester was created for tests;
  this does not classify every linked student/account/history row as disposable.
- `academic_terms_unique_term` currently makes `(academic_year, semester)`
  globally unique, including Closed rows. A status/disabled marker cannot free
  that key. Adding an archive marker without coordinated readers still fails.
- The six captured direct term FKs all reference `academic_terms(id)` with
  `ON DELETE RESTRICT`: elections, masterlist imports, officers, officer releases,
  enrollments and term memberships. The reverse-FK closure contains 23 relations
  including `academic_terms`. No year/semester composite FK was found.
- `kandid_create_next_academic_term` selects by year/semester without a
  classification. It encounters Closed term 2 and rejects creation.
- `kandid_previous_academic_term_id` and an inline lookup in the latest
  `guard_student_organization_term_admission` select a Closed predecessor by
  year/semester. With duplicate historical labels, those lookups can consume the
  archived test predecessor or choose an arbitrary matching row.
- `getAcademicTermTransitionView` treats any same-period row as an existing next
  term. `AcademicTermSelect` displays indistinguishable labels and offers Closed
  rows as election targets. These contracts need coordinated changes.
- Current restricted eligibility depends on the active **term ID** and its
  enrollment/participation. A new ID does not inherit term-2 enrollment. This
  property must be preserved rather than replaced by label-based matching.

## Smallest safe model

Keep the existing table and lifecycle statuses. Add only:

```sql
term_classification text not null default 'official'
  check (term_classification in ('official', 'archived_test'))
```

Archive reason, authorized actor, timestamp and before-state belong in existing
`audit_logs`, not in new publicly readable term columns or a second term registry.
Keep `status='closed'` on the archive so existing historical authorization logic
continues to recognize it as Closed.

1. Replace the global year/semester unique constraint with a unique partial index
   on `(academic_year, semester) WHERE term_classification='official'`. It still
   permits only one official row per period across **all** lifecycle statuses.
2. Preserve the existing single-active-term unique index, status/year/semester
   validation and every existing FK. Add a check requiring archived test terms
   to remain Closed with their original non-null activation/closure timestamps.
3. Permit only the explicitly reviewed classification of existing term **2**,
   using exact expected snapshots for term 1 and term 2, a verified active Super
   Admin attribution, an explicit provenance reason and a durable audit event in
   the same transaction. No browser archive endpoint or broad archive permission
   is needed for this one-time correction.
4. Freeze archived term identity/classification and archived owned history.
   The isolated prototype adds write-denial triggers to the 22 captured dependent
   relations, using existing ancestor IDs. Shared accounts, organizations and
   structural identity memberships are not classified or frozen by association.
5. Preserve all history in place. Do not move children to the replacement,
   relabel the old semester, copy enrollments, replay finalized imports, reset
   sequences, change election dates/statuses or release/reanchor old ballots.
   Some old election rows still store `status='active'`; retain that historical
   value, show their archived context, and reject new activity/rescheduling.

The archive guard takes term row locks; the classification operation reuses the
existing transition advisory/table locks. A dependency-closure drift check fails
before installation if an unreviewed child table appears. Existing ballot and
exclusion immutability guards are retained enabled and byte-identical.

## Exact integration changes required before production approval

| Contract | Required change |
| --- | --- |
| `kandid_create_next_academic_term` | Filter its existing natural-key lookup to official terms. Preserve actor checks, immediate-next derivation, serialization, idempotent retry and creation audit. No new creation source of truth. |
| `kandid_previous_academic_term_id` | Restrict operational target/predecessor resolution to official terms; require the existing Closed predecessor condition. Never fall back to an archived match or `LIMIT 1`. |
| `guard_student_organization_term_admission` | Apply the same official classification to its inline previous-semester query. Otherwise archived manual participation can influence later carry-forward. Preserve Board/Super Admin evidence and program reconciliation checks. |
| `sync_organization_term_participation_for_activation` | Exclude archived test rows from the earlier-term/bootstrap existence scan. Continue reading enrollment by target ID and calling the canonical predecessor helper. |
| Activation/preview/commit | Retain signatures, source/target ID binding, immediate-next rule, one-active constraint, locking, fingerprint and explicit confirmation. Archived status/immutability checks make archived activation impossible; verify all installed entry points enforce that invariant. |
| `academicTerms.js` | Include classification in term-list projections/cache; keep historical ID reads available. Do not globally hide archived terms from authorized history. |
| `academicTermTransitionPresentation.js` / Danger Zone | Consider only official rows for next-term existence/draft selection. Display archived test context separately under existing history, with the term ID. |
| `AcademicTermSelect.jsx` and operational election lists/counts | Exclude archived terms from new operations; retain explicitly labeled archive/ID context for historical records. Do not reinterpret old election status values as current business activity. |
| Officer/report labels and old clients | Preserve stored labels and ID references; disambiguate duplicate labels at presentation. Do not rerun historical label-based backfills. Old cached/PWA clients must fail closed at server guards and refresh to obtain correct selectors. |

The prototype tests selected lookup patches against actual existing function
bodies. It does **not** edit the application, existing migrations or existing
transition proposal. Full UI/RPC integration and current deployed-source parity
remain outstanding approval/implementation work. The earlier captured catalog
lacked the prepared transition RPCs; do not assume they are installed now.

## Isolated PostgreSQL evidence

**23 PostgreSQL 17 checks passed.** The runner's syntax check and scoped ESLint
also passed. No frontend build was needed because application/UI code was not
changed. The test database was removed after the run.

Artifacts:

- `supabase/proposals/academic-term-archived-test.prototype.sql` is deliberately
  refused outside a randomly named `kandid_term_archive_<12 hex>` local database.
  It defines the model and an operator-only fixed-ID archive helper; loading it
  alone neither archives a term nor creates a draft. It is **not** production SQL.
- `scripts/kandid-academic-term-archive-assessment-pg17.mjs` verifies the local
  container label, PG17 image and host port, creates its own random fixture DB,
  reads no `.env` or connection URL, and removes only its own validated DB.
- `.tmp/academic-term-archive-assessment.json` contains the final check results.

The fixture uses catalog-shaped tables, captured PK/unique/FK contracts,
representative synthetic relationships, actual ballot-preservation bodies, the
trusted audit normalization trigger, and selected actual creator, activation,
membership and participation functions. It demonstrates:

- Original uniqueness refusal; transaction rollback of installation; refusal of
  dependency drift; archive actor/snapshot/audit enforcement.
- Term 2 remains Closed; term 1 remains the sole Active term in persisted fixture
  state; all original history/shared/Auth records and original audit rows remain
  unchanged, with only new archive/creation audit events appended.
- Both original creator/UI blocking and the archived-predecessor bug are
  reproduced, then corrected by the tested official-term filters.
- Concurrent creators produce one new official Draft with a different ID;
  retry does not duplicate drafts/audits; single-active and official-period
  uniqueness remain enforced.
- The new Draft contains no inherited enrollment, membership, election or import
  rows and sends no notifications. Old enrollment/membership/import reparenting,
  archived election rescheduling, new candidacy/ballots and archived reactivation
  are refused.
- An actual activation rehearsal inside **BEGIN/ROLLBACK** makes only the new
  term current, finds zero new-term enrollment/membership, and denies current
  participation for the historical student. The rehearsal rolls back completely.
- Restoring original global uniqueness is refused once the replacement exists.
  Historical receipt reads and original protection triggers remain intact.

Limitations: this is not a full Supabase Auth/RLS deployment, complete voting or
masterlist regression, browser-history authorization test, or production load
benchmark. The additional history triggers affect write/lock paths and require
concurrency/performance validation against representative voting/import workloads
before production release. New dependency types/paths require fresh review.

## Migration, approval and recovery sequence

1. Approve the architecture exception and scoped integration above. Separately
   authorize a fresh **read-only** production catalog/source/inventory preflight;
   no production SQL was run for this task. Verify all incoming FK paths,
   preservation bodies, grants/RLS, indexes, audit support and current snapshots.
2. Prepare/review a production forward migration with exact baseline fingerprints,
   bounded locks/timeouts and rollback-on-mismatch. Add the backwards-compatible
   classification/guards and patch existing lookups while all rows remain
   official. Do not remove the prototype's local guard and run it as a shortcut.
3. Release coordinated metadata-aware RPC/Edge readers and UI selectors only with
   their explicit deployment approval. Test actual Auth/RLS and historical
   navigation in a separate environment; require voting/import concurrency and
   membership/year-rollover regression before classifying production term 2.
4. Obtain explicit approval for the exact one-row classification transaction:
   term **2**, from official/Closed to archived_test/**Closed**, plus its new audit
   event. Term 1, original term-2 fields and every dependent record remain unchanged.
   Do not combine this approval with creating or activating a semester.
5. Only after separately approved normal Create Draft execution, allow one new
   official 2nd Semester AY 2026–2027 row with a fresh generated ID. Verify empty
   target enrollment/membership/import/election cohorts and unchanged active term
   1. Enrollment must be authorized anew for that ID. Activation is a separate
   later Danger Zone operation and is outside this task's approval.

Before a migration/classification transaction commits, any mismatch rolls back
the entire transaction. Preserve a consistent backup and checksummed before-state
of all retained history before any approved production operation.

After archive classification commits, prefer **roll-forward recovery**: keep the
archive Closed/readable and repair the official lookup/client integration. Do not
toggle it back to official, reopen it, disable immutability, or erase its audit.
After a replacement exists, automatic restoration of the original global unique
constraint is **NO-GO**, even if that replacement is still Draft. Do not delete
the replacement or reparent historical records to make rollback possible. Retain
both IDs and require a separately reviewed recovery plan for any further schema
change. Database rollback cannot reverse on-chain evidence or genuine enrollment
operations performed later.
