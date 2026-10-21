# Closed test semester cleanup: NO-GO

Official project: `fszgdxqxonqqcrzsnkca`. Investigation date: 2026-10-22.
Read `AGENTS.md` first. Production access was limited to explicitly authorized
READ ONLY, repeatable-read SQL transactions ending in ROLLBACK, plus view-only
Sepolia RPC calls. **No production data/configuration changes, deployments,
worker calls, imports, Git staging, commits or pushes occurred.**

## Decision and exact target

**NO-GO for complete deletion under the current instructions. Recommended
deletion scope: zero records.** Your instruction to stop when classification is
uncertain and to preserve required audit/blockchain evidence applies here.

- Target: `academic_terms.id = 2`, Closed **2nd Semester AY 2026–2027**.
- Created: `2026-10-09 00:49:01.967439+08`.
- Activated: `2026-10-09 00:49:02.228050+08`.
- Closed: `2026-10-15 20:57:48.323909+08`.
- Retain unchanged: `academic_terms.id = 1`, Active **1st Semester AY 2026–2027**.
  Its entire persisted row matched between the initial and final snapshots.

The target includes a Ballot V1 receipt and grouped vote protected by an existing
immutable exclusion. The exclusion's stored reason is:
> Preserve the two existing pending ballot groups; anchor new ballots only.

The deployed functions `private.kandid_guard_excluded_ballot()`,
`private.kandid_guard_excluded_ballot_votes()`, and
`private.kandid_guard_anchor_exclusion_register()` reject changes to these
records. The register also has a statement-level truncation guard. Removing
the parent election/term would require removing or re-parenting retained
history. No trigger bypass, exclusion removal, fabricated archive, term relabel,
foreign-key rewrite or history reassignment is proposed.

## Dependency inventory

These are **records discovered**, not an approved deletion list. All proposed
deletion counts are zero. Six tables directly reference the term; recursive
catalog checks across all schemas found 23 relations in the FK dependency
closure. Structured JSON references and shared identity links were inspected
separately. Fingerprints bind each captured record to its inspected values.

| Table | Associated rows | Exact IDs / composite keys | Classification |
| --- | ---: | --- | --- |
| `public.academic_terms` | 1 | 2 | User-confirmed test term; removal blocked by retained dependencies |
| `public.elections` | 2 | 1, 2 | Synthetic/test-associated dependency; defer all removal while complete cleanup is blocked |
| `public.positions` | 2 | 1, 2 | Synthetic/test-associated dependency; defer all removal while complete cleanup is blocked |
| `public.partylists` | 0 | — | No matching records found; no removal |
| `public.candidates` | 2 | 1, 2 | Synthetic/test-associated dependency; defer all removal while complete cleanup is blocked |
| `public.candidate_media` | 0 | — | No matching records found; no removal |
| `public.vote_ballots` | 1 | 3c5a6c0f-5c69-49d1-bd66-ee4f97383cc1 | Required preservation evidence; retain |
| `public.votes` | 1 | 1 | Required preservation evidence; retain |
| `public.election_access_tokens` | 0 | — | No matching records found; no removal |
| `private.election_eligible_voters` | 2 | (1, 1), (2, 1) | Synthetic/test-associated dependency; defer all removal while complete cleanup is blocked |
| `private.ballot_anchor_exclusions` | 1 | 3c5a6c0f-5c69-49d1-bd66-ee4f97383cc1 | Required preservation evidence; retain |
| `public.officers` | 0 | — | No matching records found; no removal |
| `public.officer_new_roster` | 0 | — | No matching records found; no removal |
| `public.officer_leadership_releases` | 0 | — | No matching records found; no removal |
| `public.election_campaign_snapshots` | 0 | — | No matching records found; no removal |
| `public.election_officer_publications` | 0 | — | No matching records found; no removal |
| `public.election_officer_publication_entries` | 0 | — | No matching records found; no removal |
| `public.archived_elections` | 0 | — | No matching records found; no removal |
| `public.eligibility_rules` | 0 | — | No matching records found; no removal |
| `public.masterlist_imports` | 3 | 1, 2, 3 | Synthetic/test-associated dependency; defer all removal while complete cleanup is blocked |
| `public.masterlist_import_rows` | 3 | 1, 2, 3 | Synthetic/test-associated dependency; defer all removal while complete cleanup is blocked |
| `public.student_term_enrollments` | 4 | 11, 15, 16, 2 | Test-associated; final test-only classification/retention decision unresolved |
| `public.student_organization_terms` | 8 | 1, 2, 3, 4, 5, 6, 7, 8 | Test-associated; final test-only classification/retention decision unresolved |
| `public.audit_logs` | 19 | 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30 | Durable audit history; retain |
| `public.student_notifications` | 0 | — | No matching records found; no removal |

The two elections are named `SYNTHETIC - WITSG Voting Integration Test
(2026-2027 2nd Semester)` (ID 1) and `SYNTHETIC - WITSG Same-Day Voting Test -
2026-10-10 6:30 PM` (ID 2). Positions 1 and 2 are `President - Synthetic Test`.
Import filenames 1/2 begin `LOCAL-SYNTHETIC-BSIT-ENROLLMENT`; import 3 is
`synthetic-incremental-isolation-20261011.csv`. These are strong test provenance
indicators for those operations, and your confirmation establishes the term's
test purpose. They do not authorize deleting shared identities or protected
evidence, or prove that every later linked enrollment operation is disposable.

Enrollment 2 belongs to shared student 1. Enrollments 11/15 belong to students
34/35 and correlate with the synthetic finalized imports. Enrollment 16 belongs
to student 36 and has a sequence of trusted manual enrollment/unenrollment
audit events. Test markers on that account are indicators, not an authoritative
classification of the manual enrollment history. Membership 4 also records a
program-change removal; the historical state must not be erased by assumption.
All enrollment/membership deletion is deferred with the complete cleanup.

## Records retained

All records remain retained in this NO-GO scope. In particular:

- All **10 student accounts**, IDs 1, 34, 35, 36, 37, 38, 39, 40, 41, 42, and all Auth identities/credentials.
- All **3 shared organizations**, IDs 2, 3, 4. WITSG is organization 2
  (institution scope); PSITS is organization 3 (program scope).
- All **27 structural memberships**, including those created during tests.
  They are persistent identity/organization relationships, not owned by this term.
- Active-term enrollment IDs 1, 17, 18, 19, 20, 21, 22 and
  active-term participation IDs 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29.
- Other elections 3, 4, 5, 6, positions 3, 4, 5, 6, 8, 9, 10,
  candidates 3, 6, 8, 9, 10, 11, 12, 13, votes 2, 3, 4, 5,
  both other ballot receipts and the election-4 exclusion.
- All **89 audit records**. The 19 term/election-linked audit rows above plus
  shared student-1 audit IDs 2 and 32 give 21 related/shared rows to retain.
  Audit identity 2 here is an audit row, not academic term 2. Other audit history
  also remains untouched. No audit scrubbing or metadata rewriting is proposed.
- All **8 storage objects**. Target candidates 1/2 have no photo, nonempty
  campaign URL list or nonempty campaign materials; candidate-media rows are
  absent. No exclusively target-owned object was identified for removal.
- Shared program/catalog mappings, admin accounts, configuration, global
  blockchain signer leases and anchoring infrastructure. `blocks` is empty;
  there are no student notification rows at the final snapshot.

Full retained IDs, including storage UUIDs, ballot UUIDs and every audit ID, are
in [the machine-readable inventory](academic-term-test-cleanup-inventory.json).

## Chain evidence and irreversible effects

Registry: `0x91fB285801A80017Db3A5a75F0b797a2B4c4198A`, Sepolia chain
`11155111`. The public frontend registry setting matched. Both PublicNode and
dRPC confirmed chain ID, deployed registry code and the following registry
lookups at block **11969166**, observed `2026-10-22T11:12:25.987Z`:

| Scope | Hash | Registry contains hash |
| --- | --- | --- |
| Target Ballot V1 | `0x6f3aed472bda8be4e04c203070f1941f8cdaea750738aebc8cfc735d646249fc` | No |
| Target grouped vote | `0xe6803c0f95f2bbf5eb1beb93798ce9186061605f9a5a2bef96b33c3203f4a615` | No |
| Retain: election 6 ballot | `0xe7cddee1a7bf6383530d207b70b59c2d407899dd34fe2b239ea9ac9b0d57fff2` | Yes |

The retained election-6 receipt is
`682d9d76-bd16-493b-951e-975806e3a381`; its recorded transaction is
`0x88f332b184248dd09fed8c8fdfbc2a42bb6c71adf10d775c7e7c8240b28519dc`
at block 11967859. This on-chain record remains regardless of SQL cleanup and
is outside the requested term. The other pending, excluded election-4 receipt
`a9bb5581-acb0-4c1b-9d7a-b08cf358368c` also remains protected.

There is no observed target on-chain record in this registry, but that does not
cancel the existing database preservation requirement. No absence claim is made
for unknown contracts. No transaction was signed, sent or reversed. A future
database deletion would not erase a chain record and would permanently remove
receipt/eligibility context unless independently preserved and recoverable.

## SQL artifact, testing and recovery

[academic-term-test-cleanup.blocked.sql](../supabase/proposals/academic-term-test-cleanup.blocked.sql)
is a **blocked assessment**, deliberately containing no deletion or schema
mutation statements. It is not a production-ready cleanup. Its transaction:

1. Uses bounded lock/statement timeouts, explicit table locks and a fixed
   timestamp/search-path context.
2. Checks the exact active-term row, closed target fingerprint, all captured FK
   dependency contracts, exact per-table ID sets and expected row counts.
3. Verifies the deployed preservation function definitions and all four enabled
   preservation triggers.
4. Raises `55000 / NO_GO` for the protected receipt. Even if the exclusion were
   absent, an unconditional final rejection prevents this artifact from arming
   deletion. Any mismatch raises and aborts the transaction.

**18 isolated PostgreSQL 17 checks passed.** Representative fixtures use
the captured FK definitions and actual deployed preservation function bodies.
Tests show complete rollback with every fixture table and Auth identity
unchanged, reject changed counts/IDs/term values/new dependencies/disabled guards,
and reproduce the denial of vote, receipt, exclusion, election and term removal.
Fixtures use captured non-secret IDs, term metadata, hashes and projected
relationships with synthetic student/admin profiles. They are not full
production-row clones and do not reproduce every production RLS/auth/business trigger.
Scoped script lint passed. No UI, Edge Function, Solidity or application behavior
was changed, so no frontend build or browser run was needed for this assessment.

The actual presentation helper and proposed creation RPC both reject the
existing closed next semester. In a **separate counterfactual fixture where
term-2 history never existed**, the actual proposed RPC created 2nd Semester
2026–2027 as a new draft with a new ID, retained active term 1 exactly, sent no
notifications, and returned the same draft on retry. This is **not** evidence
that the blocked production cleanup can safely reach that state.

The deployed catalog also lacks the proposed guarded create/preview/commit
RPCs. Removing the duplicate term alone would not install the backend required
by the completed local UI. Deployment remains separately approval-controlled.

Recovery for this assessment requires no data restoration: no production
mutation was performed and fixture refusals rolled back fully. Before any
future approved deletion, require a consistent, access-controlled backup of
every approved row and its dependency/audit context, checksummed restore SQL,
and a restore rehearsal that preserves original IDs, hashes, nonces and FK
relationships. Never reset sequences, reuse term ID 2, change active term 1,
overwrite later legitimate rows or claim that a database restore reverses the
chain. No restore script with fabricated or incomplete production rows is
provided here.

## Required decision before further preparation

Resolve the preservation/classification conflict first. Retaining the protected
receipt retains its parent election and term under the current FK contracts.
A different retention contract or an explicit exception would require its own
reviewed scope and authorization; this investigation does not infer either.
Confirm the precise test-only enrollment/history classification, especially
manual enrollment 16, before drafting executable removal SQL. Do not perform a
partial purge that leaves the same term conflict while destroying useful context.

After those decisions, repeat the read-only capture, review the exact proposed
deletion/retention IDs and recovery artifacts, and obtain explicit approval.
No production deletion is recommended or authorized now.

Evidence capture ended `2026-10-22T11:22:34.343Z`. All 26 original scoped result
groups matched the final snapshot; shared/live activity must still be rechecked
before any later operation. Machine inventory includes artifact SHA-256 hashes.
