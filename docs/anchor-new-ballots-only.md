# Automatic anchoring for new ballots only

## Scope and verified production facts

Read-only inspection on October 21, 2026, 12:46 Manila found exactly these two pending
Ballot V1 groups, each containing one grouped vote row:

| Election | Ballot UUID | Immutable ballot hash |
| --- | --- | --- |
| 2 | `3c5a6c0f-5c69-49d1-bd66-ee4f97383cc1` | `0x6f3aed472bda8be4e04c203070f1941f8cdaea750738aebc8cfc735d646249fc` |
| 4 | `a9bb5581-acb0-4c1b-9d7a-b08cf358368c` | `0xf5074400475d07897d657d54903c2edeed6b3d618d472b71393624d50a4f9804` |

Both have status `pending`, retry count zero, no transaction, claim, retry date, or
anchored metadata. Both child rows remain `ballot_grouped`. There were no signer
lease rows. No student identities or choices were retrieved.

Production worker: `anchor-ballot-hashes`, ACTIVE, version 2, `verify_jwt=true`.
Retrieved worker and evidence-helper sources match reviewed revision 5 exactly:

- Worker SHA-256: `32c76ed0e0262ccca129c0117f37193725afee6adeef03171dcdeee26b8d245c`.
- Evidence helper SHA-256: `78deac5e5ac0c94f81101bf3f7f5157d62cdd63922e94d5e482e3a91fa94e885`.
- Published workflow matches the local reviewed workflow, SHA-256
  `7cbd059928fc99a9a961dea8dc1d2af2ec28511815436378183d2cfa2bb6a2f1`.
- Repository enable variable was verified exactly `false`.

The six secret values being successfully configured is the operator's confirmation.
Read-only source/metadata verification does not independently prove cross-platform
secret equality, gateway acceptance of the stored JWT, or production signer/RPC
bindings. No production worker invocation was used to test those bindings.

## Exact mechanism

The reviewed SQL proposal is `supabase/proposals/anchor-exclude-two-existing-ballots.sql`.
It is intentionally outside automatic migrations. Do not copy it into a migration
push or combine it with any previously rejected Cron proposal.

One transaction:

1. Takes bounded table locks, checks zero signer leases and no in-flight `anchoring`
   or `submitted` ballots, and verifies both current claim-function definitions.
2. Creates `private.ballot_anchor_exclusions`. Exactly two UUID/election/hash tuples
   are allowed by its constraint. It has RLS, no browser/service table grants, and
   immutable control rows with reason, recording time, and database actor.
3. Validates both original ballots against their exact UUID, election, hash,
   timestamps, pristine pending state, and one grouped child row. Any mismatch
   aborts the entire transaction. Only private control rows are inserted.
4. Adds UUID-based `NOT EXISTS` filters to **both** existing claim RPCs before
   ordering and `LIMIT`. Locks, stale-claim behavior, backoff, ordering, signatures,
   and service-only execution remain unchanged. New ballots in Elections 2 or 4
   are not excluded; there is no date cutoff or election-wide filter.
5. Adds database guards rejecting updates/deletes of excluded ballot records and
   insert/update/delete of their grouped vote rows. Stale/direct mark-submitted,
   success, failure, and manual-review RPCs therefore cannot change them either.

No old ballot/vote row is updated. Hashes, timestamps, receipts, and pending statuses
are preserved. Excluded receipts will remain pending indefinitely; the exclusion
does not claim anchoring failure or success. No frontend/status wording is changed.
The control record and guards are persistent across worker restarts and future runs.
Privileged DDL/contract-owner signing outside the reviewed application remains an
administrative trust boundary; this is not a modification to the Sepolia contract.

The worker, signer lease, grouped hashing, receipt implementation, retry policy,
submission authentication, eligibility, frozen electorate, and duplicate-vote
protections are unchanged. No worker or frontend deployment is required for this
proposal when the verified sources remain deployed.

## Local validation

```powershell
node --test tests/anchorExclusions.test.mjs tests/ballotAnchorReadiness.test.mjs tests/anchorBallotGithubScheduler.test.mjs tests/legacyVoteAnchorEvidence.test.mjs tests/receiptWorkerIndependence.test.mjs tests/receiptStatusDisplays.test.mjs
node scripts/kandid-anchor-exclusions-pg17.mjs
```

The PostgreSQL runner uses a new disposable database in the verified local PG17
container, the inspected table constraints, the existing real SQL RPCs, and the
unchanged worker with an entirely synthetic provider/signer/contract. No `.env` or
production credentials are loaded. Verified UUID/hash metadata is reused solely to
exercise the exact proposal; all fixture people and vote choices are synthetic.
Full synthetic ballot/vote row fingerprints are compared after every test group.

Checks include installation rollback, contract drift, access controls, no mutation
of excluded groups, all claim paths, stale mark RPCs, repeated worker runs, a newer
ballot in the same election, 1/5/15-minute retry delays and fourth-failure manual
review, evidence-based reconciliation without rebroadcast, overlapping claims, and
signer contention. Hypothetical old submitted/failed states are tested only inside
rolled-back local transactions, never on production.

## Approval gates and production sequence

**Gate A: approve only the reviewed database proposal.**

1. Confirm project `fszgdxqxonqqcrzsnkca`, repository `brenduling/kandid`, reviewed
   hashes, and enable variable exactly `false`. Stop on unknown state or mismatch.
2. Confirm no running/queued invocation can reach the worker, no operator invocation,
   no signer leases, and no in-flight blockchain transaction. Do not clear leases.
3. Save the first three read-only query results from
   `supabase/runtime-validation/anchor-exclusions-readonly.sql` securely. Compare
   the two UUID/hash bindings, timestamps, counts, states, and metadata fingerprints.
4. Apply only the reviewed proposal through the authorized database operator path.
   Its bounded locks may briefly contend with vote submission; abort on timeout and
   plan a quieter moment. Do not change submission or election configuration.
5. Run its read-only validation queries, including the post-install section. Require
   exactly two exclusion rows and identical before/after preservation fingerprints;
   check RLS, triggers, function definitions/ACLs, and nonexcluded queue counts.
   **Do not call a claim RPC as a nonwriting test.** Keep scheduling disabled.

**Gate B: separately approve scheduling and Sepolia transactions for nonexcluded
legitimate ballots only.** Earlier backlog approval does not authorize processing
these two now-excluded groups.

1. Recheck source hashes, exact exclusions, immutable guards, production configuration
   evidence, and signer readiness. Stop for unresolved critical bindings.
2. Retain the existing GitHub workflow and secret names. It invokes only the official
   worker endpoint using a project-bound legacy anon JWT in `Authorization` and
   `apikey`, plus `x-anchor-worker-token`. Gateway JWT validation remains enabled.
3. With explicit activation approval, set `KANDID_ANCHOR_SCHEDULER_ENABLED=true`.
   The published schedule is `2-59/5 * * * *` (UTC); GitHub may delay or drop runs.
   It has repository/main restrictions, guarded manual dispatch, minimum permissions,
   serialized workflow concurrency, and no immediate HTTP retries.

### Controlled first real ballot

Do not manufacture a production ballot. An actual eligible student may voluntarily
submit their real, final ballot through the normal interface in a legitimately open,
finalized election. It must be a new ballot UUID; this procedure does not change any
election's schedule or eligibility and does not authorize a second vote.

1. Before activation/first processing, verify the new nonexcluded pending UUID and
   saved old-group fingerprints using metadata-only reads. If other new ballots
   arrive, reconcile the entire nonexcluded queue before assuming which runs first.
2. Let the approved scheduled run process normally. Do not manually rerun after an
   ambiguous response. Monitor Actions failure notifications and restricted worker
   logs without copying credentials or student selections.
3. Verify the new ballot's transaction was persisted as `submitted` before confirmation.
   Verify Sepolia chain 11155111, the reviewed registry
   `0x91fB285801A80017Db3A5a75F0b797a2B4c4198A`, successful receipt, matching registry
   event/hash and recorded state, and canonical block evidence before accepting
   `anchored`. Reconciliation must use the persisted transaction, not rebroadcast it.
4. The owning student's receipt must distinguish submitted/pending from anchored.
   Verify duplicate-vote protection through existing state/contract checks; do not
   cast a second production vote as a test. Pending anchoring does not undo submission.
5. Recheck both old fingerprints, pending states, counts, null transaction IDs, and
   zero retries. Observe another scheduled run to confirm no duplicate transaction.

## Disable and rollback

On mismatch, unexpected processing, or verification failure, set the enable variable
back to `false` through the authorized operator. This stops future enabled jobs; it
does not undo a transaction already broadcast or stop a currently running invocation.
Do not reset transactions, ballots, retry counters, or signer leases. Preserve data
for the existing reconciliation/manual-review path.

An installation error rolls the complete SQL transaction back. After successful
installation, the safest containment is to disable scheduling and **retain** the
exclusion register, guards, and claim filters. Restoring original claims alone could
select protected rows and stall newer work; removing exclusions would expose old
ballots to anchoring. Neither rollback is authorized. Any later removal requires
separate review and approval with the worker quiescent. Blockchain transactions are
irreversible; never promise a secret/scheduler rollback can undo them.
