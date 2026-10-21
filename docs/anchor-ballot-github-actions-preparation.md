# GitHub Actions ballot-anchor scheduler: local preparation

Status: workflow prepared locally at `.github/workflows/anchor-ballot-hashes.yml`.
Production activation remains NO-GO until the separate approvals and preflight
below are complete. The job requires `KANDID_ANCHOR_SCHEDULER_ENABLED == 'true'`;
this task did not set or verify that GitHub variable, configure secrets, push,
invoke the worker, or send a blockchain transaction.

## Prepared scope

- Prepared publication file: `.github/workflows/anchor-ballot-hashes.yml`.
  The review copy remains at `.github/workflow-proposals/anchor-ballot-hashes.yml`.
  The local file is not published to GitHub, so it cannot run until pushed.
- Target: the existing `anchor-ballot-hashes` Edge Function in
  `fszgdxqxonqqcrzsnkca`; no worker, contract, voting, or receipt changes.
- Schedule: `2-59/5 * * * *` UTC: minute 02, 07, ..., 57 of every hour.
  This offsets runs from the busiest start-of-hour minute.
- A missing/false repository variable `KANDID_ANCHOR_SCHEDULER_ENABLED`
  blocks the job. Only the exact string `true` enables it. Runs are restricted
  to `brenduling/kandid` and `refs/heads/main`; main must remain the default branch.
- Manual runs additionally require the explicit boolean
  `confirm_anchor_pending_ballots=true`, which defaults to false.
- `permissions: {}`; no checkout, external action, deployment permission,
  GitHub API token use, artifacts, or third-party scheduler dependency.
- One concurrency group covers scheduled/manual runs, with
  `cancel-in-progress: false`; a job takes at most three minutes, with one HTTP
  request and a 90-second request timeout. No immediate HTTP retries/redirects.
  Cancellation or HTTP timeout cannot undo server work or a broadcast.

## Exact authentication contract

Provision only these GitHub Actions **repository secrets** after approval,
using Settings > Secrets and variables > Actions > New repository secret.
Copy directly from the approved password manager/Supabase dashboard; never paste
credentials into chat, commands, repository files, or workflow inputs/logs.

| GitHub secret | Value source and purpose |
| --- | --- |
| `KANDID_ANCHOR_GATEWAY_JWT` | This project's existing, unrevoked **legacy anon HS256 JWT**, sent as `Authorization: Bearer ...` and `apikey`. It is an anon gateway credential, not a user/Board session or service-role credential. |
| `KANDID_ANCHOR_WORKER_TOKEN` | Exact existing `ANCHOR_WORKER_TOKEN` of the worker; sent only as `x-anchor-worker-token`. |

The proposal refuses non-JWT publishable keys, service-role/user JWTs, wrong
project claims, wrong algorithms, and expired gateway credentials before HTTP.
These local claim checks do not verify the signature; the Supabase gateway does.
With `verify_jwt=true`, gateway acceptance is followed by the unchanged worker's
private-token check **before any database/queue access**. An anon credential alone
does not authorize anchoring. The existing handler does not require or impersonate
a signed-in Board JWT. The gateway JWT must remain valid/unrevoked on deployment.

The Node step receives secrets through environment variables. GitHub masks stored
secrets; this workflow never prints headers, credential values, raw responses,
exceptions, ballot IDs/hashes, or transaction IDs. Failure text is fixed; success
logs contain only known status names and aggregate counts. No credentials enter
Postgres/pg_net. Repository administrators and anyone allowed to modify a trusted
workflow remain part of the GitHub-secret trust boundary; restrict write access,
review workflow changes, and keep runner debug/env dumps disabled.

Private signer/service-role/RPC credentials remain only in the existing Supabase
worker environment. Do not give GitHub `DEPLOYER_PRIVATE_KEY`, the Supabase service
role, signing JWT secret, or database credentials. Existing Supabase configuration
must be verified separately before deployment; secrets must not be newly
provisioned under this preparation approval.

Supabase documentation: [gateway headers](https://supabase.com/docs/guides/functions/auth-headers),
[legacy anon keys](https://supabase.com/docs/guides/api/api-keys).

## Required approval and activation sequence (not executed)

1. Review the locally approved type-only worker correction and revision-5 source
   hash in the updated recovery manifest. Obtain separate approval before deploying
   this worker source to production.
2. Read-only preflight: confirm worker RPCs/grants, Sepolia chain 11155111,
   configured contract/owner, signer balance, pending counts and existing
   transaction references. Reconcile any already-submitted transaction before
   allowing another broadcast. This worker is global: activation can process
   eligible pending ballots across elections, including Elections 2 and 4.
   Obtain explicit approval for that backlog; do not filter/change recorded ballots.
3. Verify repository visibility, Actions enabled/policy, `main` default branch,
   owner billing allowance/budget, and native failure notification ownership.
   GitHub CLI/account metadata was unavailable locally, so those settings and the
   actual remaining allowance were not verified. Ensure scheduler publication
   will not cause an unapproved Vercel deployment through existing Git integration.
4. After separate deployment approval, deploy the newly reviewed worker with
   `verify_jwt=true`, verify deployed source/config/dependencies, existing secrets,
   and trusted database contracts. No changes to blockchain or ballot data are
   part of deploying the scheduler.
5. With separate GitHub publication/secret approval, confirm the enable variable
   is unset or `false` **before** publishing this exact workflow on `main`.
   Provision the two repository secrets securely. Keep the workflow disabled in the Actions UI
   until all preflight checks pass. Enable it while the variable remains false;
   a manual run with the default false confirmation must skip the invocation job.
6. A later nonwriting authentication probe can use the real gateway credential
   plus a deliberately incorrect worker token: expect handler 401 before queue
   access. Never use the real worker token for a supposed dry run: any accepted
   invocation can immediately broadcast. Do not log either credential or response
   headers. This probe also requires the explicit approval withheld in this task.
7. Once backlog processing and transactions are explicitly approved, choose an
   observation period, set `KANDID_ANCHOR_SCHEDULER_ENABLED=true`, and optionally
   dispatch one manually confirmed run. **Setting this variable immediately
   authorizes automatic scheduled invocations**; a manual run is not an
   additional production approval gate for scheduled runs.
8. Observe subsequent native workflow runs and read-only Supabase/chain evidence.
   Require verified registry events/hash/state and successful receipts for anchors;
   submitted/pending must remain distinct. Check grouped vote-row status propagation
   without reading choices. No synthetic votes or raw ballot content are needed.

## Monitoring and disable/rollback

- Enable GitHub Settings > Notifications > System > Actions email/web failure
  notifications for the maintained owner. Scheduled notifications follow the
  schedule editor; explicitly verify the recipient. Do not rely on repo watching
  alone. [Notification settings](https://docs.github.com/en/subscriptions-and-notifications/how-tos/managing-github-actions-notifications).
- This workflow fails on non-200 responses, invalid shapes/JSON, `ok:false`, and
  per-ballot queue/persistence/anchor/manual-review failures even with HTTP 200.
  `submitted`/`confirmation_pending` remain normal, visibly distinct statuses.
  `signer_busy` emits a warning; investigate repetition and competing schedulers.
- Inspect restricted Supabase logs for error details. For a timeout/lost response,
  first read transaction and database evidence; do not blindly click re-run.
  Existing submitted-transaction reconciliation and signer leases remain intact.
- Failures generate notifications only when a run exists. Check latest non-skipped
  run freshness during live election operations; an absent run for 15 minutes is
  an operational alert requiring investigation. This proposal does not build a
  separate heartbeat/alert service. Also watch pending age/count and gas balance.
- Disable: set the enable variable to `false`, then Actions > Kandid ballot
  anchoring > Disable workflow. Alternatively, after authorization:
  `gh workflow disable anchor-ballot-hashes.yml --repo brenduling/kandid`.
  Disabling prevents new triggers but does **not** stop current/queued runs.
  Cancel queued runs; allow a known in-flight invocation to settle and inspect
  its result. Changing the variable is not a guarantee against an already-started
  run. An emergency credential revocation is a separate production-secret action.
- Rollback removes/disables only this scheduler; do not delete ballots, reset
  anchor states, rotate the signer, or undo broadcasts. Blockchain transactions
  cannot be rolled back; reconcile persisted transaction references on restart.

GitHub [disable semantics](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows).

## Scheduling and usage limitations

Five minutes is GitHub's minimum interval, **not a delivery guarantee**. Runs use
the default branch and may be delayed or dropped under load. Concurrency allows
one running and at most one pending invocation; newer pending runs may replace
older ones. The worker's durable backlog/retry/reconciliation mechanisms handle
the next invocation; no catch-up loop is added. Public-repo schedules automatically
disable after 60 days of repository inactivity. Account/Actions outages, quota
exhaustion, spending caps, or disabled actor accounts can also stop processing.
Student vote submission stays independent, so delays leave recorded votes pending.

At five-minute cadence: 288 targeted jobs/day, 8,640 in a 30-day month. On private
repositories each job's time is rounded up to whole minutes: even sub-minute jobs
can consume roughly 8,640 minutes/month if every slot runs (more for slow jobs).
Free plans include 2,000 minutes; Pro/Team include 3,000 shared with other workflows.
Standard public-repo runners are free. Do not change repository visibility to
avoid costs; approve an adequate budget or a reduced cadence separately.

Sources: [scheduled events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule),
[concurrency](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#concurrency),
[billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions),
[minute rounding](https://docs.github.com/en/actions/how-tos/monitor-workflows/view-job-execution-time).

## Supabase Cron exclusion

The unapplied local `20261021150000_anchor_ballot_hashes_cron.sql` was moved from
`supabase/migrations` to
`supabase/proposals/anchor_ballot_hashes_cron_extensions.sql.disabled` with a
WITHDRAWN warning. Its content is preserved; no production migration history was
edited. The historical activation proposal is also marked WITHDRAWN. These files
must remain excluded from all production migration pushes. No Supabase
Cron/pg_net/Vault scheduler installation is needed for GitHub Actions.

This exclusion is specific to this rejected Cron proposal: it does not authorize
any other pending migration. Do not run a blanket production migration push.

## Local evidence

- Integrity-verified workspace-local Deno 2.9.6 (TypeScript 6.0.3) passed static
  checking with the existing frozen lockfile after the type-only timer annotation
  correction. No worker runtime was executed.
- Worker source SHA-256 after this correction:
  `32c76ed0e0262ccca129c0117f37193725afee6adeef03171dcdeee26b8d245c`.
- Focused Node tests: 48 passed, 0 failed (scheduler gates/auth/logging/response
  handling, withdrawn Cron checks, existing worker reconciliation/lease cases,
  registry evidence, and receipt status safeguards). All HTTP/provider/database
  interactions in those tests were mocked; none touched production.
- `actionlint` 1.7.12: passed on the proposal (YAML, workflow schema and
  expressions). The workspace-local binary was verified against the published
  release checksum. Node syntax and scoped whitespace checks passed.
  GitHub-hosted execution remains approval-gated.
