# Conditional restoration preflight — stopped before deployment

**Local follow-up:** the receipt-status correction is now prepared in source;
see the local-correction section below. The failed production preflight remains
historical evidence. No corrected frontend or Edge Function has been deployed.

Project: `fszgdxqxonqqcrzsnkca`. Workspace: `kandid-clean` only.
Read-only database check: **20 October 2026, 21:28:55 Manila**.

The user conditionally approved restoration of receipt plus submission, with
the worker disabled and anchoring pending, and required stopping on any failed
preflight requirement. **The receipt-display requirement failed, so neither
endpoint was deployed.** No containment action was necessary.

## Results

| Requirement | Result |
| --- | --- |
| Local release matches reviewed manifest | PASS: all 14 source/config SHA256 hashes match `voting-backend-recovery-manifest.json`. No reviewed deployment source was changed. |
| Existing deployed functions unchanged | PASS: all 10 observed slugs, versions, JWT settings and bundle hashes match the manifest baseline. |
| Worker remains disabled | PASS: ballot worker absent from deployed inventory. No worker was deployed or invoked and no secrets were changed. |
| Submission commits atomically | Confirmed unchanged: live insertion RPC definition MD5 `6b99f18237fbe72cc96cf63c9f1cc8af`, postgres-owned SECURITY DEFINER, executable only by service role among the inspected API roles. Frozen-roster insert guard remains enabled. The same inspected implementation passed the previous eight actual local PostgreSQL integrity checks, including rollback after a partial attempt and concurrent duplicate submission. No real production submission was used to verify this. |
| Receipt distinguishes recorded/submitted from anchored | **FAIL** for a submitted blockchain transaction with a transaction ID; current pending/no-transaction display is correct. See evidence below. |
| Restored deployed source matches manifest | NOT REACHED: both endpoints are still absent; deployment/readback verification was not attempted after the failed preflight. No deployed-artifact match is claimed. |

## Receipt evidence

The official public website currently serves
`https://witkandid.vercel.app/assets/receiptData-BEXEsYCe.js`.
Downloaded public asset SHA256:
`5bc887ebd4c77bae580bc4419a63b27b2c3c5807c083819441bcc9ea0211ca16`.

Its status helper returns `anchored` whenever `blockchain_tx_id` is present,
before reading `blockchain_anchor_status`. This matches the existing local
`src/pages/student/receiptData.js` logic in `getNormalizedBlockchainStatus`
and `getBlockchainStatusMeta`.

A local execution of those unchanged helpers with synthetic data produced:

| Input | Normalized status | Display |
| --- | --- | --- |
| pending, no transaction ID | pending | Your vote is recorded. |
| submitted, transaction ID present | **anchored** | **Blockchain verification complete.** |
| anchored, transaction ID present | anchored | Blockchain verification complete. |

No real receipt, student identity, choice or transaction hash was read for this
reproduction. The production queue currently contains only a pending ballot
without a transaction ID; no existing false-positive receipt is asserted.
Nevertheless, the general requested distinction cannot be confirmed, and the
user's stop condition applies. The two reviewed Edge Functions cannot correct
the separately deployed frontend's status logic.

## Protected production state

- Election 2: one pending ballot, no transaction ID, currently unclaimed,
  maximum retry count zero. No claim RPC or processing occurred.
- Election 3: policy 1, null freeze, zero snapshot members, zero ballots and
  zero vote rows. Saved voting interval remains 20 October 10:00–20:00 Manila.
  No eligibility, academic record, schedule or electorate change was made.
- No function deployment/removal, migration, RLS/grant change, secret update,
  production ballot POST or blockchain transaction occurred. Public website
  reads, inventory reads and the SELECT-only preflight were the only production
  operations. Existing functions and the reviewed release manifest remain intact.

## Required next step at the stopped production preflight

Prepare a scoped frontend receipt-status correction with regressions for
pending, submitted, anchoring, failed, manual-review, anchored and legacy
receipts. A transaction ID alone must not establish confirmed anchoring. Keep
valid recorded-vote receipt access and the existing backend contracts intact.

That frontend change and its deployment are outside the approved two-function
restoration artifact and require a new reviewed artifact/scope before production
execution. Do not change the Edge receipt response merely to conceal the UI
defect, activate the worker, process the queue or proceed with Election 3 while
this restoration is stopped. Re-run preflight before resuming conditional
restoration after the receipt requirement is satisfied.

## Local receipt-status correction prepared for renewed review

Only the following frontend sources changed in this follow-up:

- `src/pages/student/receiptData.js`: confirmation labels/counts now require
  explicit `blockchain_anchor_status='anchored'` from the trusted owned receipt;
  transaction IDs, hashes, blocks and timestamps cannot promote other states.
  Empty receipt summaries cannot claim completion. Anchoring detail timestamps
  require the confirmed state.
- `src/utils/blockchainVerification.js`: the related admin status/count helper
  uses the same explicit-state requirement. Transaction links remain available;
  the existing manual-review/transaction/ballot guards preventing duplicate
  manual anchoring are unchanged.
- `src/pages/student/Receipt.jsx`: seals and progress retain their shared status
  source. The processing step no longer appears completed before confirmation.
  Delayed/review messages remain visible rather than being replaced by generic
  processing copy; receipt copy no longer promises automatic worker retries.
- `src/pages/student/ReceiptDetails.jsx`: Verified At uses a confirmed anchoring
  timestamp only; a historical vote submission time is never a verification time.
- `src/pages/student/BallotVerification.jsx`: confirmed visuals remain gated by
  status. Delayed, unavailable and manual-review outcomes are distinct; anchoring
  timestamps require confirmation. Recorded votes remain recorded in every
  nonconfirmed outcome, with no automatic-retry promise.
- `src/pages/student/VotePage.jsx`: the existing success dialog now says the
  vote is recorded and blockchain verification may still be processing. No
  submission, navigation, error handling or ballot behavior changed.

Review covered the student receipt list, expanded receipt panels, seals/progress,
details and verification pages, post-submission prompt, related admin status
helper, and Board ballot-monitor presentation. The Board monitor already uses
explicit backend states and required no change. Explorer links are evidence of
a transaction to inspect, not confirmation. CSS, routes, queries, Auth/JWT,
ownership projections, hashes, worker behavior and mutation permissions remain
unchanged. No database/production inspection or production action was needed
for this local correction.

`tests/receiptStatusDisplays.test.mjs` adds 18 regression checks, including
React static rendering of the status machine and progress component, trusted
confirmed data, submitted with/without transaction IDs, pending/processing,
failed/delayed, review/unavailable, legacy summaries, misleading metadata and
unchanged duplicate-anchoring guards.

Validation:

- Focused receipt/related tests: **29 passed, 0 failed**.
- Expanded voting/security/eligibility/receipt tests: **164 passed, 0 failed**.
- Targeted ESLint across all six changed frontend files: **passed**.
- `npm.cmd run build`: **passed**, including PWA generation (188 entries).
  Non-failing plugin-timing warnings remain. This validates the current workspace;
  it is not permission to publish its earlier unrelated Board eligibility edits.
- Receipt-only review build: **passed**, with both earlier Board modules loaded
  from the checkpoint, 195 output files and PWA generation (188 entries).
  All six corrected sources and both excluded working copies remained unchanged.
- React review: status derivation and rendering only; no new hooks, effects,
  subscriptions, sensitive data access, component libraries or styling changes.
- The 14 previously reviewed backend/config hashes remain unchanged. The revised
  manifest adds the six corrected frontend source hashes and regression evidence.
- Final integrity check: all 20 source/config hashes, three review-evidence hashes,
  all 195 scoped artifact hashes and both preserved Board working-copy hashes
  match. `git diff --check` and syntax checks for the new test/build script passed.
  The reviewed revision-2 manifest SHA-256 is
  `884108d64033911482919563f0f58a5e6f65c4df60b7d891143941bdb820b750`.

### Renewed approval and release ordering

The code correction is ready for renewed review. Production restoration remains
stopped until a separately approved scoped frontend release is published and
verified; the previous conditional two-function approval does not deploy this
new frontend artifact.

The workspace contains two earlier Board eligibility presentation edits that
depend on the separate Election 3 migration. They must not accompany this
receipt-only release. `scripts/kandid-receipt-scoped-build.mjs` prepares a local
review build using their checkpoint versions through a build-only loader, while
leaving both files and all Git state intact. It refuses unexpected frontend
edits and verifies that both excluded modules were handled. Its output is local
review material and is never deployed automatically.

Successful review output:
`.tmp/voting-backend-runtime/receipt-only-release-d6fd15d0892f`.
The complete 195-file hash list is in
`.tmp/voting-backend-runtime/receipt-only-release-manifest.json`, SHA-256
`2833e072013026134acb21558e951c4a5131eceec8d6bb84feb439cca3bc3537`.
Revision 2 of `docs/voting-backend-recovery-manifest.json` records the six frontend
source hashes, unchanged 14 backend/config hashes, regression/build script hashes
and this artifact reference. Only this scoped artifact, or an equivalently scoped
rebuilt and re-reviewed artifact, is a candidate for later frontend approval.
The ordinary workspace `dist` includes the earlier Board edits. No branch,
worktree, source overwrite or Git reversal was used to prepare the scoped build.

After renewed approval, the order is: publish only the reviewed frontend scope;
verify the new receipt bundle and the existing PWA update prompt/fresh-session
behavior; repeat the documented nonwriting production preflight; restore and
read back the approved receipt function; restore and read back submission; run
only approved nonwriting checks; require unchanged queue/Election 3 counts.
Both deployed Edge sources must match their unchanged reviewed hashes and keep
JWT verification enabled. No valid vote is a health check.

The PWA uses prompt-based updates: merely publishing assets does not prove an
already-open client loaded the correction. Confirm the updated client before
declaring the receipt requirement satisfied. Do not change the PWA update
mechanism as part of this scoped fix.

The blockchain worker and Election 2's queue stay disabled/unprocessed. Registry
event verification before worker activation remains a separate backend issue.
Election 3's rule/schedule/migration/lock remain outside this release. No renewed
production approval is assumed from this local preparation.
