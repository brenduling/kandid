# Permanent optional eligibility and scheduled electorate finalization

Prepared 21 October 2026, Asia/Manila. **Design proposal, not a deployed change.**
The user selected scheduled finalization shortly before voting, rather than
freezing the electorate at activation. localhost:5174 stays connected to official
project `fszgdxqxonqqcrzsnkca`; no environment or connection change is proposed.

This policy supersedes the **mandatory-rule behavior** of the earlier Election 3
and Election 4 recovery proposals. Preserve those files as review history; do not
apply them as the permanent workflow or stack their shared RPC replacements.

## 1. Eligibility definition

```text
base_eligible(student, election) =
  verified active Auth-linked student
  AND enrolled in election.academic_term_id
  AND verified current participation in election.organization_id for that term
  AND election's term meets the existing single-active-term contract

population_eligible = base_eligible
  AND (no saved eligibility rules OR matches at least one saved rule)

ballot_eligible = population_eligible
  AND included in this election's immutable frozen electorate
  AND election is active, not removed, and inside its Manila voting window

may_submit = ballot_eligible
  AND existing QR/geofence/access restrictions are satisfied
  AND no previous ballot/vote exists for this student and election
  AND existing active-position, candidate and ballot validation succeeds
```

- **Zero rules is valid.** It means verified term organization membership, not
  public access, all students in the database, or missing configuration.
- No catch-all rule should be inserted automatically. An empty rule set is an
  intentional, explicit policy mode: `membership_only`.
- If rules exist, use `membership_plus_rules`. Rules are ORed, with program/year
  and SHS restrictions retaining the existing declaration semantics. A matching
  rule never grants membership or compensates for missing enrollment/Auth.
- Use term-enrollment program/year/SHS, not stale central academic fields.
- With zero rules, there is no implicit BSIT, year range or SHS exclusion beyond
  the organization's verified term membership. If SHS or a program/year must be
  excluded, that restriction must be explicitly saved before finalization.
- Preserve the private snapshot after freezing. Current revoked account,
  enrollment or participation still denies access, but a newly eligible person
  cannot join a frozen electorate. Frozen rules cannot be edited or deleted to
  broaden the audience.
- Population preview may run for a draft election; it does not authorize voting.
  Lifecycle, schedule and frozen membership remain separate mandatory gates.

## 2. Board workflow

1. Create an election and choose its term and future voting window.
2. Optionally add program/year/SHS restrictions. Default display:
   **"All verified organization members enrolled for this election's term."**
3. Activate. The authenticated save validates Board scope and atomically stores
   a durable scheduled-finalization request. **No rules are required.** The
   electorate remains unfrozen until its scheduled finalization window.
4. Show `Active — electorate scheduled`, the current audience mode/count, due
   time, and any warning. Zero current eligible members may be shown while
   enrollment is still in progress; it is not a reason to manufacture a rule.
5. The trusted database job recomputes eligibility and freezes automatically.
   Board operators do not need a logged-in browser or manual backend repairs.
6. After the freeze, show the immutable count and disable frozen settings/rules.
   Candidate access opens only inside voting time after the student's authorized
   RPC confirms eligibility. Submission remains separately protected.

### Proposed timing

- One database job runs **each minute**; no per-election Cron expression.
- First attempt: **10 minutes before the voting start**.
- Store deadlines as UTC instants converted from the established Manila
  wall-clock schedule: `start_date AT TIME ZONE 'Asia/Manila'`.
- If activated inside the ten-minute window, enqueue for the next job tick,
  provided at least **two minutes of future lead time** remains. Reject a start
  in the past or an excessively close start with a clear schedule message.
- Retry eligible transient failures each minute while strictly before start.
  Zero eligible voters is an explicit readiness failure, with no empty freeze;
  retrying permits legitimate enrollment fixes before the cutoff.
- Recheck the cutoff immediately before committing the freeze. If computation
  crosses voting start, roll back the entire snapshot, freeze and audit.
- Never finalize retrospectively at/after voting start. Record a missed-cutoff
  state, keep voting denied and explain that an authorized future reschedule is
  required. Never move dates automatically.

The ten-minute window, minute cadence and minimum lead time are concrete proposed
server settings, not configuration changes already made.

## Local implementation status

The local implementation and test evidence are recorded in
[`optional-eligibility-scheduled-finalization-implementation.md`](optional-eligibility-scheduled-finalization-implementation.md).
The deployable migration is `20261021140000_scheduled_electorate_finalization.sql`.
The earlier Election 3 only migration remains preserved under
`supabase/proposals/`; it is not part of the deployment migration sequence.
No Cron extension/job or production change has been installed.

## 3. Backend changes required

### A. One canonical private population predicate

`private.kandid_student_matches_optional_eligibility(integer,integer)` evaluates
the formula above with no election-ID hardcoding. It is not an exposed identity
endpoint: revoke execute from PUBLIC/anon/authenticated/service_role; trusted
definer wrappers call it with JWT-derived identities or scheduler-owned scans.

The local component is in
`supabase/proposals/optional-eligibility-canonical-policy.sql`. It is explicitly
**not a complete production migration**: the scheduled infrastructure and live
RPC adapters below are not installed by that file.

All policy-v1 paths must use this predicate:

| Contract | Required use |
| --- | --- |
| `kandid_get_board_electorate_preview` | Count current population; report mode, rules count, scheduler readiness, request status and due time; zero rules is valid |
| Trusted internal finalizer | Recompute population once under the election/rule lock; insert only those members |
| `kandid_get_student_ballot_candidates` | Existing authenticated active student + active election/time + frozen row + canonical population check; no direct candidate-table fallback |
| `kandid_is_locked_electorate_member` | Retain server-only execution and enforce the same population/snapshot/time checks |
| `private.kandid_require_locked_electorate_for_ballot` | Recheck the same policy for trusted ballot insertion; never bypass snapshot requirements |
| `submit-vote` | Preserve JWT identity, current enrollment, organization/access checks, active positions, duplicate prevention and atomic insertion; use the canonical server authorization |

Keep legacy policy-0 behavior explicitly separate. Do not downgrade policy-v1
elections, rebuild existing snapshots or rewrite old ballots as part of rollout.
Existing frozen elections remain immutable. Read-only inventory currently shows
their saved rule sets empty, so membership-only semantics do not introduce a new
program/year restriction on those historical electorates.

### B. Durable private finalization requests

Add a private table such as `private.election_electorate_finalizations`:

- unique election ID and references that preserve election/admin history;
- authorizing Board administrator and Auth UUID derived by the database;
- request time, authorized term/org/schedule revision, due UTC instant;
- state: scheduled, retrying, finalized, missed cutoff or blocked;
- attempts, last attempt, next attempt, safe reason code and completed time;
- a private transaction marker used only during the trusted atomic freeze.

These are **queue states**, not new election or central-student status values.
Enable RLS and revoke all direct API role access. A scoped Board readiness RPC
returns only safe status/count metadata, never electorate identities.

An authorized active-election create/save queues or updates its request in the
**same database transaction**. Draft/deactivation/removal cancels an unprocessed
request. Term/org/schedule/rule changes serialize on the election row and update
the request revision before freezing. No caller-supplied actor ID is accepted.

Keep existing RLS and grants. A Super Admin must not supply or impersonate a
Board authorizer; the scheduled Board operation keeps its established scoped
authorization contract. Existing unrelated administrator edits need targeted
regressions when activation-trigger integration is implemented.

### C. Trusted scheduled executor

Production inspection found **no installed `pg_cron` extension**. Enable Supabase
Cron only after separate approval. Its native database functions avoid an Edge
Function, a network call, a stored user JWT or a new browser secret.
[Supabase Cron documentation](https://supabase.com/docs/guides/cron) supports
running SQL/database functions and inspecting job history.

Proposed entry point: `private.kandid_process_due_electorates()`; execute only as
the database job owner, with no PUBLIC, anon, authenticated or service-role
execute grant. Never expose it as a browser/Edge worker endpoint.

For each due election:

1. Lock election first, then request row; use a bounded batch and
   `FOR UPDATE ... SKIP LOCKED` to prevent overlapping workers and deadlocks.
2. Validate active/not-removed status, term, schedule/revision, time and the
   stored active organization-scoped Board authorization. Reject stale requests.
3. Refuse partial unlocked snapshots or pre-existing vote/ballot history. Do
   not overwrite, merge or silently repair them.
4. Recompute eligible members with the canonical predicate; require a nonempty
   result; insert the private snapshot.
5. Recheck cutoff, set freeze metadata, write one trusted audit with scheduler
   origin and authorizing-request attribution, and mark the request finalized.
   Commit **all or none** of snapshot, metadata, audit and completed request.
6. On failure, roll the per-election subtransaction back before recording a safe
   retry/blocking reason in the outer worker transaction. Continue other due
   elections. Repeated runs are idempotent and never rebuild a completed freeze.

### D. Resolve the live-session guard without impersonation

The installed lock/freeze guard requires a **live Board `auth.uid()`** and an
active Board record in `electorate_frozen_by`; the lock-pair constraint also
requires both timestamp and Board attribution. A background job cannot call
that path unchanged.

Extract a private atomic finalization core. The authenticated Board scheduling
operation stores verified authorization; the trusted job consumes that request.
Keep `electorate_frozen_by` as the authorizing Board, with explicit scheduled
origin/request attribution in its audit.

Update only the trusted freeze transition branch of the guard to recognize a
private processing request whose transaction marker equals the current database
transaction, election/revision/authorizer match, and execution originates in the
private job path. The browser cannot create this marker or write that table.
Preserve prohibitions on manual timestamp changes, unlocking, policy downgrade,
snapshot movement/deletion and frozen schedule changes. **A GUC, localhost
origin or caller-supplied JWT role alone must never authorize a freeze.**

Do not forge `request.jwt.claim.sub`, store/replay a Board JWT, create a fake
administrator, or grant API users access to private scheduler functions. This
new internal execution path requires a specific security review before release.

### E. Scheduler readiness and failure reporting

Expose safe readiness through the scoped Board preview: capability version,
membership mode, due time, state, last attempt and safe reason. Require the
expected enabled job owned by the trusted role, plus a recent successful
dispatcher heartbeat, before accepting activation for scheduled finalization.
Do not silently accept scheduling when the worker is unavailable.

Suggested messages:

- "Electorate scheduled for [Manila time]. Current preview: N eligible members."
- "No eligible organization members are enrolled for this term yet. Retrying
  before voting starts; voting remains unavailable."
- "Automatic electorate finalization is unavailable. Activation was not saved."
- "The electorate was not finalized before voting start. Voting is blocked.
  Choose an authorized future voting window to reschedule."

## 4. Frontend changes in the full implementation

No runtime frontend file was changed in this proposal turn. The earlier prepared
mandatory-rule frontend is **not** the final implementation of this new policy.

| File | Planned change |
| --- | --- |
| `src/utils/electorateFinalization.js` | New membership/optional-rule capability; accept zero rules; read scheduled state; refresh readiness; any authenticated retry must respect the due time and cutoff |
| `src/pages/board/ElectionElectoratePanel.jsx` | Optional restriction explanation, due time and automatic readiness/failure status; refresh/poll while pending; propagate background freeze to parent state; no mandatory manual lock step |
| `src/pages/board/BoardElectionSetup.jsx` | Review default membership scope and scheduled-finalization timing; do not require a rule |
| `src/pages/board/Elections.jsx` | Verify save/readback includes scheduled request state; display queued versus finalized accurately; preserve unchanged-value/concurrent-edit checks |
| `src/pages/board/EligibilityRules.jsx` | Label rules as additional optional restrictions; deleting the final rule before freeze returns to membership-only mode |
| `src/utils/eligibilityRuleManagement.js` | Remove election 3/4 hardcoding; derive readiness/freeze policy from trusted backend metadata; protect frozen rule CRUD |
| `src/pages/student/VotePage.jsx` and `src/utils/studentBallotReadiness.js` | Retain denied/unfrozen behavior and authorized candidate RPC; explain pending electorate readiness without granting access |

Preserve Kandid layout, routes, geofence, QR restrictions, candidate projection,
abstention, receipts, hashes, Ballot V1/V2 and one-vote safeguards. Keep localhost
5174 on the same official project. No localhost authorization exception or
separate backend requirement is introduced.

## 5. Validation performed versus remaining validation

**Completed locally:**

- 17 PostgreSQL 17 checks of the canonical optional-rule component and
  experimental adapters replaying inspected authorization bodies: no rules,
  additional rules, OR semantics, SHS, term enrollment versus central records,
  missing/removed membership, pending/unlinked/disabled students, draft population
  preview, immutable snapshots, unfrozen 42501, candidate access with and without
  rules, late-member exclusion from a frozen roster, revoked membership,
  closed/expired elections and helper execute privileges.
- **8 existing atomic insertion/duplicate checks passed** separately: they cover
  unfrozen/nonmember failures, all-or-none vote rows, Ballot V1 and V2 hashes,
  duplicate rejection and simultaneous submissions.
- All data is synthetic in verified disposable local Docker databases. No
  production identities, vote choices or mutations are used.
- JavaScript syntax and diff checks passed. All **71 pre-existing modified or
  untracked files** match the starting hashes; Git index and HEAD are unchanged.
  The final production read-only aggregate still contains four elections with
  digest `5367cd5d8740a2579ce85f7487e02070`. No frontend source, configuration,
  production schema, grant, extension or job was changed in this proposal turn.

**Not claimed as implemented or tested:** the durable queue, actual Cron job,
scheduled trusted-core/guard integration, heartbeat/activation transaction,
automatic retries, migration rollout, or updated frontend/browser workflow.
The SQL component is not a complete scheduled-finalization migration.

Before the full implementation can be released, verify:

1. No-rule activation queues correctly; no snapshot or candidate access before
   due/start. Additional rules narrow all authorization paths identically.
2. Queue and activation commit together; a scheduler outage rolls activation
   back with a readable error. Zero preview members can still be scheduled while
   enrollment is in progress; an empty final freeze never commits.
3. A native job with no user JWT finalizes only due, authorized requests. Browser
   roles, forged actor parameters and marker/GUC spoofing are denied.
4. Overlapping workers, rule/schedule edits and enrollment changes serialize
   correctly. Audit or processing failure rolls the entire freeze back; reruns
   do not duplicate snapshots/audits. No catch-up freeze after voting starts.
5. Frozen schedules/rules/snapshots remain immutable; late members cannot enter;
   revoked members remain denied. Existing receipts/votes and other elections
   remain unchanged.
6. Duplicate and simultaneous vote attempts still commit at most one ballot
   through the actual trusted submission contract.
7. Desktop and 375px Board readiness transitions and Student candidate/abstention
   behavior pass with mocks/local data; targeted lint/build and source hashes
   are reviewed. Earlier 213/22/10 results describe the earlier Election 4
   preparation, not this unimplemented scheduled workflow.

Evidence: `.tmp/voting-backend-runtime/optional-eligibility/results.json`,
`optional-eligibility-pg.log` and `optional-eligibility-integrity.log`.

## 6. Production approval gates and rollout

1. Review the permanent schema/function/trigger/grant changes, including the
   private trusted scheduled execution path and preservation of existing history.
2. Approve the reviewed migration installation and Cron extension/job setup as
   separate production actions. Start with the job disabled; validate owners,
   ACLs and command hashes, then enable only the electorate dispatcher after its
   own approval. It must never invoke blockchain workers or process ballots.
3. Verify dispatcher heartbeat and authenticated readiness without changing
   an election. Deploy the paired frontend only after explicit deployment
   approval and hash review. Do not publish older mandatory-rule code.
4. Existing frozen elections remain untouched. Existing unfrozen elections
   whose start passed remain blocked: normal authorized Board rescheduling and
   request creation require separate explicit approval. Do not retroactively
   freeze or manufacture an eligibility rule for Election 3 or 4.
5. Candidate loading does not prove submission readiness. The separate missing
   submission/receipt restoration and blockchain-disabled scope remain separate.
   No production test vote is authorized by this proposal.

**Rollback:** disable only the new electorate dispatcher to contain failures;
pending elections remain denied. Preserve requests/audits and completed snapshots.
Do not unfreeze, rebuild, downgrade policy, delete ballots, reverse a committed
vote or rewrite production dates automatically. Reverting canonical eligibility
can weaken access, so a function rollback needs reviewed compatibility with the
snapshots already created. Election 2's pending ballot is untouched.
