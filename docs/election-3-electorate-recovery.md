# Election 3 electorate recovery plan

Current preparation: [Prac Elec test-election recovery](election-3-test-recovery-prepared.md).
The user's latest decision permits BSIT Years 1–4 for this test election. The
binding-Years-2–4 decision and earlier schedules below are historical context;
they do not authorize execution. The new report records the scoped local fix,
tests, proposed replacement window and missing submission-endpoint blocker.

Investigation date: 20 October 2026, Asia/Manila.
Official project: `fszgdxqxonqqcrzsnkca`.
Scope: read-only production investigation; local documentation and validation SQL only.
Repository: `github-checkpoint`, commit `2c20a0277f22a09d2df89a3b82b11d0324eaf82b`.
The working tree was clean before these two investigation artifacts were added.

## Confirmed outcome

### Binding-rule decision and student-record investigation — 20 October 2026

The user explicitly retained the BSIT Years 2–4 rule and authorized read-only
investigation only. Student-record changes, rule changes and the electorate
lock remain unauthorized. The earlier two-person recovery sequence is blocked.

The affected active, Auth-linked student is recorded as BSIT Year 1, not SHS,
in the central profile and both stored term enrollments. The election's active
term-1 enrollment is enrolled, source=manual, with created_at and updated_at
both 2026-10-09 00:47:57.619972+08:00. It has no recorded verification method,
verifying administrator or verification timestamp. A term-2 enrollment also
records BSIT Year 1, source=masterlist, with its last recorded update on
11 October. Term 2 is historical context, not Election 3's eligibility term.

Scoped trusted audit events show Super Admin term enrollment on 9 October
(term 1) and 11 October (term 2), followed by a Board name correction on
17 October with changed_fields limited to first_name and last_name. The
available scoped audit history contains no recorded year-level correction.
The enrollment table has no mutation-audit or automatic updated_at trigger;
unchanged timestamps and absent events cannot prove that no unlogged change
ever occurred. No old/new year values are preserved in these enrollment events.

No retained masterlist_import_rows entry matched this student by mapped ID or
exact stored student number. The term-2 source label alone therefore cannot
be treated as a verified original roster. No roster spreadsheet was found
within the active workspace. The archive was not accessed.

The deployed create_manual_student_for_term_v1 function accepts an explicit
p_year_level and writes that same value into both students and
student_term_enrollments. It validates years 1–6; it does not itself silently
replace a missing year with 1. The current Super Admin registration form in
src/pages/superadmin/Students.jsx initializes year_level to 1. Consequently,
agreement between these records can arise from one shared manual/default
input. The retained evidence does not show whether that default was left
unchanged or Year 1 was deliberately selected when this student was registered.

Conclusion: the system consistently classifies this student as Year 1, and
there is no retrieved evidence of an erroneous downgrade from Year 2–4.
That consistency does not certify the student's true academic standing.
Registrar/department enrollment evidence for term 1 is required to distinguish
a legitimate Year 1 student from a registration error. Do not promote the
record to Year 2 merely to satisfy the election rule.

The deployed preview, lock RPC and canonical participation resolver were
rechecked directly. None references eligibility_rules or its minimum/maximum
year fields. Both preview and lock use active/Auth-linked identity plus the
term-scoped participation resolver. That resolver checks enrollment and
organization participation, not program/year coverage. The two attached
snapshot triggers protect immutability and removed-election state, and the
snapshot constraints are its primary key and foreign keys; none adds the
missing program/year filter. Thus the trusted lock really would admit both
canonical voters, including the recorded Year 1 voter, despite the binding rule.

With the rule retained, only 1 of the 2 current canonical voters meets all
declared restrictions. Do not execute the existing two-person lock. If verified
term-1 evidence proves a record error, propose the smallest authorized data
correction and rerun preflight before any write. If the student truly is Year 1,
they must remain outside this election's binding electorate; a scoped trusted
authorization correction would need separate design, validation and approval.
Do not remove legitimate organization membership, disable the account, change
the rule or manually edit a snapshot to simulate enforcement.

Latest safety check at 2026-10-20 19:34:11 Asia/Manila: Election 3 remained
active, policy 1, unfrozen, with 0 snapshot rows, 0 ballots and 0 vote rows.
No student identities, names, email addresses, Auth identifiers, vote choices,
tokens or secrets are included in this report. No production mutation occurred.

### Final preflight update — 20 October 2026, 19:29 Asia/Manila

**Recovery is blocked pending an eligibility-policy clarification.** The Board
specified exactly 2 active voters and proposed voting from 20 October 2026
20:00 to 21 October 2026 22:00 (26 hours). No production change is authorized
yet; the latest instructions expressly require stopping after preflight.

Both current canonical voters have active term participation and enrolled
term-1 records. Both Auth identities exist, have confirmed email, and match
the linked Student email. The 3 pending/unlinked members remain excluded.
However, only **1 of the 2** satisfies the stored BSIT, years 2–4, no-SHS rule.
Both pass program, upper-year and no-SHS checks; 1 is below the minimum year 2.
Central and term-enrollment program/year/SHS fields agree for both voters, and
none of these term fields is missing. This is a real recorded eligibility
conflict, not a disagreement between profile and enrollment values.

The deployed lock and preview still compute the membership-based electorate
without consulting eligibility_rules. That table is described by repository
management code as declared coverage, not voting authorization. The workflow
would mechanically lock both voters; it cannot establish that both meet the
Board's requested additional program/year precondition. Do not modify the rule,
enrollment, identity, membership or snapshot to force a passing result. Resolve
whether the declared year restriction is intended to be binding first.

At 19:28:27, 31.5 minutes remained before the proposed start; the timestamp was
still feasible, subject to this blocker, explicit approval and the real Board
workflow completing before 20:00. Recheck current Manila time before any action;
if the deadline passes or too little time remains, obtain a new future start.
Do not substitute dates, backdate or bypass the cutoff. The live schedule
remained 20 October 10:00–20:00, status active, policy 1, with no lock,
no snapshot rows and zero ballots/vote rows/legacy vote rows.

The organization-2 Board account's database prerequisites were verified: one
active mapping and Board assignment, an existing confirmed Auth identity, and
authenticated-only execution grants for preview and lock. Actual access through
a signed-in Board browser session was not exercised and remains an operational
gate. No user was impersonated and no authentication claims were injected. The
current official preview is time-blocked by the existing 10:00 start; the count
of 2 was verified using its exact inspected canonical membership predicate.

Once the policy conflict is legitimately resolved and the user explicitly
approves execution, the exact Board sequence is: Elections → Election 3 → Edit;
save start=2026-10-20 20:00 and end=2026-10-21 22:00 in Manila time, retaining
active status; reopen/refresh the saved record; Review → Electorate → Refresh
preview; verify exactly 2 approved eligible voters and locking_allowed=true;
confirm Lock electorate before 20:00. Expect exactly those 2 snapshot members,
no pending/unlinked members, a server-created lock timestamp and actor, one
completed trusted lock audit, and unchanged zero vote counts. Rule-match checks
must also satisfy the resolved policy. Only then, during the scheduled window,
verify the authorized candidate RPC and ballot rendering without submitting.

The deployed workflow needs no migration or deployment for mechanical recovery.
It cannot currently certify the full requested eligibility conditions; any
change to recorded data, declared rules or authorization needs separate review
and approval. The validation SQL now reports declared-rule matches and
mismatches alongside the canonical count, so a count of 2 cannot conceal this
conflict. Earlier observations below remain an investigation baseline and do
not authorize execution.

The official lock workflow is deployed and available. Election 3 has a missing
snapshot, not a partially populated one. The voting start has passed, so the
existing lock RPC cannot recover this election while preserving its exact
current voting timestamps. Rescheduling requires the election owner's explicit
approval. No production action was performed.

## Live observations

The bundled read-only validation SQL was executed successfully at
**2026-10-20 19:20:04 Asia/Manila**.

| Item | Observed |
| --- | --- |
| Election | 3, Prac Elec |
| Organization / academic term | 2 / 1 |
| Status / policy | active / 1 |
| Voting window | 20 October 2026, 10:00–20:00, Asia/Manila |
| Campaign window | 18 October 2026 16:46 – 20 October 2026 08:00 |
| Freeze timestamp / actor marker | null / absent |
| Removed / results released | no / no |
| Eligible-voter snapshot rows | 0 |
| Currently eligible under the lock RPC | 2 |
| Currently eligible missing from snapshot / extra snapshot members | 2 / 0 |
| Canonical vote_ballots / votes rows / legacy votes rows | 0 / 0 / 0 |
| Completed trusted electorate-lock audit events | 0 |
| Active academic terms | exactly 1: term 1, 1st Semester, AY 2026–2027 |
| Other active policy-v1 elections with null freeze timestamp | count 1; election IDs: 4 |

Only vote counts were queried; no vote choices, receipts, hashes or voter
identities were retrieved.

Organization 2 uses institution membership scope and departmental organization
type, an accepted combination in the deployed canonical resolver. There are
5 enrolled term-1 students with active organization-2 term participation
(source: system). Of these, 2 are active and Auth-linked; 3 are pending and
not Auth-linked. The current canonical lock predicate includes the first 2
and excludes the other 3. No duplicate non-null student Auth mappings were
found.

One active Auth-linked Electoral Board account is assigned to organization 2,
with a single active Board assignment. The lock and preview RPCs are owned by
postgres, use SECURITY DEFINER with search_path=pg_catalog, and grant execution
to authenticated, not anon or service_role. They independently verify the
caller's active Board identity and organization.

## Intended workflow and protections

Source: `supabase/migrations/20261002150000_freeze_election_electorates.sql`.

1. Save an existing election with policy 1, its recorded academic term, valid
   voting timestamps and status active. Activation is allowed before locking.
2. In Board Elections, edit the saved election and open **Review → Electorate /
   Voting eligibility**. The panel calls
   `public.kandid_get_board_electorate_preview(integer)`.
3. Review the live aggregate count and confirm **Lock electorate**. The panel
   calls `public.kandid_lock_board_electorate(integer)` with the election ID.
4. The server derives the Board actor from auth.uid(), checks its organization,
   takes a row lock on the election, and rejects a nonempty unlocked snapshot.
   It requires a valid term and schedule, status active, policy 1, and server
   Manila time strictly before start_date.
5. The RPC recomputes membership from active, Auth-linked students for whom
   `resolve_student_organization_participation(student_id, organization_id,
   academic_term_id)` returns allowed=true. That resolver requires enrollment
   and permitted term-specific organization participation.
6. Snapshot insertion, freeze metadata and a dedicated
   `election_electorate_locked` audit event occur in the same transaction.
   A successful retry of an already locked election returns the existing lock.

The deployed definitions were inspected directly, rather than inferred from
local migration filenames. Enabled triggers enforce the trusted lock operation,
immutable frozen membership and voting schedule, and locked-snapshot membership
before inserting a vote_ballots row.

The UI exposes the lock panel for an existing election only. It does not call
the lock RPC as part of create/save/activate. Its implementation is in
`src/pages/board/ElectionElectoratePanel.jsx`; integration is in
`src/pages/board/BoardElectionSetup.jsx` at the Review step.

## Why this state was possible

The deployed election guard prevents pre-locking new elections and protects
completed locks. It does not require a lock when status is active; the lock
RPC itself requires active status. There is no automatic lock trigger at
activation or at the voting-start timestamp. The frontend saves active status
separately from the explicit Board lock action. Schedule validation checks
ordering and required fields, not freeze completion.

Election 3 has a trusted creation event and two update events, but no completed
lock event and no recorded election_status_changed event. The audit metadata
contains changed-field names, not historical field values. This establishes
that no successful freeze is recorded; it does not establish whether the Board
never attempted it or an attempt failed. No claim about a particular person's
actions or an unobserved request is justified.

## Recovery preconditions

All must be checked again immediately before any approved action:

- Election 3 remains unremoved, policy 1, unfrozen, with an empty snapshot and
  no results release. Both vote_ballots and votes counts must still be zero.
  If any vote count is nonzero or any unlocked snapshot row exists, stop and
  request a separate integrity review; do not delete or reconstruct history.
- Term 1 remains the single active term; retain election term 1 and organization
  2. The ballot RPC and submission path additionally enforce current-term
  enrollment and participation after freezing.
- The Board confirms the intended voter population. At present the lock would
  include 2 voters. If the 3 pending, unlinked members are intended voters,
  their established identity-verification/onboarding process must complete
  before locking, under separately authorized normal administration. Do not
  manually change statuses or manufacture identity links.
- Review eligibility while enrollment, participation and identity administration
  is stable. Preview is advisory; the RPC recomputes the final snapshot.
- Review the legacy stored eligibility rule (BSIT, years 2–4, SHS disallowed)
  against the intended policy. The deployed frozen-policy lock and canonical
  participation resolver do not consult eligibility_rules; repository tests
  explicitly assert that contract. Do not silently reinterpret or alter it.
  If that stored rule is intended to impose an additional binding restriction,
  resolve that contract question before approving a freeze.
- Obtain explicit approval for exact replacement voting timestamps, and then
  for locking the reviewed electorate using the legitimate organization-2
  Board session. Never inject auth claims or impersonate a Board user.

## Proposed recovery sequence — approval required

1. Preserve the original schedule in this incident record and normal audit
   history. No automatic freeze is possible at the original 10:00 start.
2. Have the election owner approve a future voting start with enough time to
   review and lock. Retain the original 20:00 end only if it is still in the
   future and the owner approves the remaining voting duration; otherwise a
   replacement end also needs explicit approval. Retain the campaign dates,
   organization, term and all election records.
3. Use the existing scoped Board edit/save workflow to update only the approved
   voting timestamp fields. Keep status active, as required by the lock RPC.
   There is no supported paused status in the inspected Board form; changing
   status alone does not cure the elapsed-start condition. No temporary pause
   is necessary to satisfy locking because the ballot and ballot-write guards
   already deny the unfrozen policy-1 election.
4. Refresh the saved record, rerun the bundled SQL, and use the Board preview.
   Require a future valid window, an empty snapshot, zero vote counts and the
   approved eligible count. Stop on any unexpected result.
5. Through Board Elections → Edit → Review → Lock electorate, confirm the
   trusted lock RPC. Complete it strictly before the newly approved start.
   The existing RPC performs all snapshot writes and records the verified actor.
6. Immediately rerun the bundled SQL. Expect policy 1, a non-null lock timestamp,
   a present lock actor marker, the approved snapshot count, zero missing/extra
   members against the reviewed current set, one completed trusted lock audit,
   and unchanged vote counts. Once locked, schedule_allows_lock=false is expected.
7. Before the new start, the candidate RPC must remain time-protected. During
   the new voting window, verify candidate RPC success in a real eligible
   student's authenticated session and verify the candidate names, photos,
   partylists and valid Review Ballot behavior. Using separately authorized test
   accounts, verify denial for an ineligible voter and a voter outside the
   election's canonical organization participation. Do not submit a real vote.

Changing the start temporarily and restoring the original value after locking
is not a supported recovery: the frozen-election guard makes the voting
schedule immutable. If the original timestamps must remain exact, the deployed
workflow has no permitted recovery path; this plan cannot be executed unchanged.

## Validation queries

Run `supabase/runtime-validation/election-3-electorate-recovery-readonly.sql`
before any approved action and immediately after locking. It is one SELECT with
CTEs, invokes only the inspected STABLE canonical resolver, and returns election
metadata, aggregate counts and other affected election IDs. It contains no
mutation, lock RPC call, voter identity output or vote-choice projection.

Expected state before rescheduling: snapshot=0, current eligible=2,
missing=2, extra=0, all vote counts=0, lock audit=0,
schedule_allows_lock=false. Expected state after approved rescheduling but
before locking: same counts, schedule_allows_lock=true, subject to reviewed
eligibility and timing.

Expected immediate post-lock state: snapshot equals the approved count,
missing=0, extra=0, completed lock audit=1, both lock markers present, all vote
counts unchanged. This current-set comparison is for immediate verification;
later legitimate enrollment, participation or identity changes need not match
the immutable admission snapshot. Current eligibility checks still apply.

The Board's authenticated preview is an additional read-only authorization
check. Calling the lock RPC is a production write even when phrased as SELECT;
it is not included in the validation file and was not executed.

## Rollback and stop conditions

A failed lock RPC rolls back its snapshot insertion, metadata update and audit
event together. Verify state before deciding whether to retry; if the response
is ambiguous, inspect state first. Do not blindly retry schedule edits.

Before a successful lock, an approved schedule edit can be reversed through
normal scoped administration only after confirming the election remains
unfrozen, with an empty snapshot and no votes. Returning to the original elapsed
window leaves voting unavailable. Preserve all audit records.

After a successful lock there is no supported unlock, snapshot rebuild or
schedule rollback. Do not clear metadata or delete snapshot members. An
unexpected final electorate requires a separate explicitly approved integrity
response; it must preserve this election and its history. No election closing,
removal or replacement is authorized by this plan.

Election 4 requires its own scoped review before any action; only its ID and
the affected-election count were reported.

## Validation and authorization record

- Read-only production inspection: live function definitions, grants, relevant
  triggers, election state, audit summaries, prerequisite aggregates, snapshot
  comparison and vote counts; all queries succeeded.
- Repository contract tests:
  `node --test tests/electionElectorate.test.mjs tests/electorateRpcExecuteSecurity.test.mjs`
  — 16 passed, 0 failed. These are local static contract tests, not live voter
  or successful-lock verification.
- No application source changed; no production build was needed for these
  documentation and SELECT-only SQL artifacts.
- No production writes, migrations, deployments, election-state changes,
  manual timestamps, policy downgrade, RPC bypass or October 21 migration.
- No archive operations. No live vote submitted. The ballot remains unverified
  for an authorized voter and is not claimed fixed.

Explicit approval is required for any replacement voting timestamps, any
needed normal student-administration writes, and the irreversible trusted
electorate lock. This boundary comes from the user's recovery instructions and
AGENTS.md production-safety rules.
