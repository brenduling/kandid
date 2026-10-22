# Kandid

Kandid is a student-organization election management system. The application
uses React and Vite, with Supabase providing authentication, PostgreSQL, and
Edge Functions. It also includes an optional Ethereum vote-registry contract
for ballot anchoring.

## Requirements

- Node.js 20.19 or newer in the 20.x line, or 22.12 or newer in the 22.x line
- npm
- Docker-compatible runtime and Supabase CLI for local Supabase development

## Install and run

```sh
npm ci
npm run dev
```

Vite prints the local address after startup. To configure the browser client,
create an ignored `.env.local` file in the repository root and set:

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_KEY=
```

`VITE_SUPABASE_KEY` must be the Supabase publishable/anon client key. Never put
a service-role key, database password, or other server secret in a `VITE_`
variable; Vite includes those values in browser assets.

Optional browser configuration used by the codebase:

| Variable | Purpose |
| --- | --- |
| `VITE_TURNSTILE_SITE_KEY` | Public Cloudflare Turnstile site key for the student setup flow. |
| `VITE_KANDID_SERVER_TIME_RPC` | Enables the configured server-time RPC when set to `enabled`. |
| `VITE_ENABLE_ELECTION_MANAGEMENT` | Local development feature gate for election management requests. |
| `VITE_ENABLE_POSITION_MANAGEMENT` | Local development feature gate for position management requests. |
| `VITE_ENABLE_CANDIDATE_MANAGEMENT` | Candidate-management feature gate. |
| `VITE_SEPOLIA_CHAIN_ID` | Optional blockchain network ID displayed by the client. |
| `VITE_VOTE_REGISTRY_ADDRESS` | Vote-registry contract address used by the client and some Edge Functions. |
| `VITE_ETHERSCAN_TX_BASE_URL` | Optional transaction explorer URL. |

Feature gates do not replace server authorization. Keep production write
safeguards enabled and use the approved production release process for any
server-side changes.

## Common commands

```sh
npm run dev
npm run lint
npm run build
npm run preview
node --test
```

`npm run build` writes the Vite site to `dist/`. The Node test runner discovers
the tracked `tests/*.test.mjs` suite; the suite includes authorization,
election lifecycle, privacy, and migration-contract checks.

## Supabase development and migrations

The Supabase CLI project configuration and Edge Functions are under
`supabase/`. Start a local stack with Docker and the Supabase CLI:

```sh
npx supabase start
npx supabase migration list --local
npx supabase db reset
```

`db reset` destroys and rebuilds the **local** database from the migrations;
use it only when the local database can be recreated. Create new migrations
with `npx supabase migration new <name>`, edit the generated file, and validate
it locally before review.

Remote migration commands act on the linked project. Check the link and compare
migration history before any remote operation:

```sh
npx supabase link --project-ref <approved-project-ref>
npx supabase migration list --linked
```

`npx supabase db push --linked` applies pending migrations to the linked remote
database. Use it only for a specifically approved release after reviewing the
target project, migration order, SQL effects, and rollback plan. Do not use
`db reset --linked` on production; it drops and rebuilds the remote schema.
Keep applied migrations in history and add forward migrations for later
changes.

For local Edge Function work, use `npx supabase functions serve <function>`.
Deploy an individual function with
`npx supabase functions deploy <function>` only through the approved release
process. JWT verification is configured per function in
`supabase/config.toml`; preserve those settings and never disable verification
as a deployment workaround.

Supabase supplies the standard Edge Function environment names
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. Depending
on the function, the code also reads server-side names including
`STUDENT_AUTH_ALLOWED_ORIGINS`, `STUDENT_AUTH_RATE_LIMIT_HMAC_SECRET`,
`KANDID_ADMIN_IDENTITY_LINKING_ENABLED`, `KANDID_ADMIN_INVITE_REDIRECT_URL`,
`ANCHOR_WORKER_TOKEN`, `SEPOLIA_RPC_URL`, `DEPLOYER_PRIVATE_KEY`,
`VOTE_REGISTRY_ADDRESS`, and `ELECTION_SOFT_REMOVAL_ENABLED`. Configure only the
values needed by the function, in the Supabase secret store. Never expose
server-side values to the browser or commit their values.

See the [Supabase local development workflow](https://supabase.com/docs/guides/local-development/cli-workflows),
[database migrations guide](https://supabase.com/docs/guides/local-development/database-migrations),
and [Edge Function deployment guide](https://supabase.com/docs/guides/functions/deploy).

## Vercel deployment

Connect the GitHub repository to Vercel and configure the browser environment
variables there. Use the Vite framework preset, `npm run build` as the build
command, and `dist` as the output directory. The checked-in `vercel.json`
rewrites application routes to the SPA entry point. Supabase database
migrations and Edge Functions are released separately; a Vercel frontend
deployment does not apply them.

Ignored local `.env` files are not included in a Git deployment. Configure the
following in the Vercel project and environment that builds the Git branch:

| Variable | Required configuration |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://fszgdxqxonqqcrzsnkca.supabase.co` |
| `VITE_SUPABASE_KEY` | The official project's public publishable or legacy anon key. `VITE_SUPABASE_ANON_KEY` is not read by Kandid. |
| `KANDID_SUPABASE_KEY_PROJECT_REF` | `fszgdxqxonqqcrzsnkca`, required when using a publishable key. |

`npm run build` uses Vite's `production` mode for both Vercel Preview and
Production deployments. Keep that mode and the existing validation unchanged.
Vercel Preview and Production variable scopes are separate; a branch-specific
Preview value overrides the general Preview value. Check the failed deployment's
project, environment and branch before correcting its configuration. Changes
apply only to subsequent deployments; see
[Vercel environment variables](https://vercel.com/docs/environment-variables).

## Vote-registry contract

The Solidity source is in `contracts/KandidVoteRegistry.sol`. Compile it with:

```sh
npm run chain:compile
```

The deployment script reads
`artifacts/contracts/KandidVoteRegistry.sol/KandidVoteRegistry.json`. Hardhat
recreates this artifact from the Solidity source. To deploy the registry to
Sepolia, configure `SEPOLIA_RPC_URL` and `DEPLOYER_PRIVATE_KEY` in a local,
ignored `.env` file, then run:

```sh
npm run chain:deploy:sepolia
```

The deployer private key must remain server-side and must never use a `VITE_`
prefix.
