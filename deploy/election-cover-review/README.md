# Election cover Storage repair — production deployment record

Target: `fszgdxqxonqqcrzsnkca`. The approved repair was applied as migration
`secure_election_cover_storage`, version `20261020035149`. No other migrations or
production records were changed.

## Confirmed cause and compatibility

- Board Create/Edit called `uploadPublicImage` with `covers/<random>.<extension>`.
  The development fetch guard rejected its POST to
  `/storage/v1/object/election-covers/covers/<random>.<extension>`.
- Production has no `election-covers` bucket or corresponding policies. Removing
  the local guard rejection alone cannot restore uploads.
- `supabase/migration_archive/20260901_election_cover_url.sql` is absent from the
  current production migration ledger. The existing `elections.cover_url text`
  column was nevertheless already present. Absence from this ledger does not
  prove the archived SQL was never executed in an earlier/imported database.
- **Do not replay the archive:** it permits INSERT to `anon, authenticated`
  using only the bucket ID, with no organization or path authorization.
- Current schema supports `elections.id`, `organization_id`, `removed_at`,
  `cover_url`, active JWT-linked `admin_users`, and `storage.objects.owner_id`.
  Board/Student already select and render `cover_url`; no elections schema change
  or new sensitive student read is required.
- A second read-only catalog check confirmed authenticated column privileges for
  SELECT/INSERT/UPDATE of `cover_url`, and existing election INSERT/UPDATE policies
  require an active JWT-linked Super Admin or matching-organization Board user.
- `production-preflight.json` contains the read-only catalog/ledger snapshot.

## Exact proposed change

`repair.sql` is a new, separately reviewed Storage migration, not an archived
  migration replay. It creates only:

1. Public `election-covers` bucket: 5,242,880 bytes; JPEG, PNG, WebP and GIF.
2. `public.kandid_election_cover_upload_allowed_v1(text)`, with a fixed
   `pg_catalog` search path; EXECUTE only for authenticated callers.
3. One `storage.objects` INSERT policy requiring the actual JWT uploader as
   owner and an active Board/Super Admin profile. Board must match the path's
   organization. An existing-election path must resolve to an election of that
   organization with `removed_at IS NULL`.

Paths:

- Create: `<organization_id>/drafts/<uuid-v4>.<jpg|png|webp|gif>`.
- Edit: `<organization_id>/elections/<election_id>/<uuid-v4>.<extension>`.

Draft uploads are authorized against the organization before an election exists;
they do not create election records. Draft images keep their immutable path when
the user later creates an election. Existing-election paths cannot claim a foreign
organization/election. Only raster extensions and positive integer path IDs are
allowed; invalid/overflow IDs, extra folders and traversal are rejected.

The Storage service enforces bucket MIME/size restrictions. The client also checks
MIME, size and file signature. File signature checks are client validation, not a
server content-scanning guarantee. SVG/HTML are excluded. No service keys are used
in the browser.

There is no SELECT/list, UPDATE/upsert, DELETE, table grant or campaign bucket
change. [Public Storage delivery](https://supabase.com/docs/guides/storage/buckets/fundamentals)
serves cover URLs without an object SELECT policy. All uploaded covers, including
unsaved drafts, are immediately public; do not upload confidential images.

Replacement uploads a new immutable object. The old image remains available until
an explicitly approved cleanup; this prevents deleting images referenced elsewhere.
Failed/canceled editing never updates an election row. Successfully uploaded but
unattached images may remain after cancel, failed Save, or replacement. A future
cleanup must inspect references and remove objects through the Storage API after
approval; do not delete Storage metadata directly with SQL.

## Narrow production deployment plan

The approved deployment completed. Before applying, the bucket and cover
policies were absent, the expected election schema was present, and the only
Storage policies were the three campaign scoped policies. The original file's
SHA-256 was rechecked as
`4717281C0855C000CF6CC9430E132DE36214F7D37E5C4DC85183357CDA9941F6`.

After applying, read-only verification confirmed the bucket limits and public
delivery setting, the single authenticated upload policy, function privileges
and organization/election checks, and the absence of anonymous upload or any
cover read/list/update/delete policy. The existing private campaign bucket was
unchanged. See `production-preflight.json` for the before/after evidence.

The production authenticated image upload was not exercised: that would create
a production Storage object. The local browser run uses synthetic sessions and
intercepted responses. A real Board user can now verify upload and saved image
display in the normal controlled browser flow.

The following remains useful if another environment needs the change: apply only
`repair.sql` as one new `secure_election_cover_storage` migration against the
intended project, after a fresh preflight. Do not bulk-push migrations, repair
the ledger, replay the archive or deploy functions.

The local guard allows only exact immutable cover POSTs, `x-upsert:false`, matching
extension/MIME, and at most 5 MB. All other buckets/operations retain their existing
guard contracts. Election row writes retain the existing independent activation
gate and database RLS/lifecycle/audit rules.

## Rollback

If upload authorization has a defect, apply the separately approved
`rollback-disable-uploads.sql` to remove the new INSERT policy. Existing cover
URLs keep displaying; election records and objects remain intact. Revert only this
task's local upload/guard integration if required, preserving unrelated changes.

Do not automatically make the bucket private, delete it, or remove objects: those
actions can break saved URLs. Full removal requires a reference inventory and a
separate approved Storage cleanup. No ledger repair is needed for an operational
rollback; record rollback SQL as a new migration.

## Reproducible validation

- `node --test tests/electionCovers.test.mjs tests/developmentProductionWriteGuard.test.mjs tests/electionCreateContract.test.mjs tests/electionEditContract.test.mjs`
- `node scripts/kandid-election-cover-authorization.mjs`: exact proposed SQL,
  disposable local PostgreSQL database, synthetic accounts, no production calls.
- `node scripts/kandid-election-cover-browser.mjs`: actual localhost Board and
  Student routes in fresh Chrome, synthetic session/data, all backend calls
  intercepted and Supabase DNS blocked. This is not production authentication
  or proof of production Storage service operation.
- Targeted ESLint and `npm run build`.

The PostgreSQL fixture exercises real policy execution and verifies bucket limits
as configuration; it does not run the production Storage HTTP service. A real
authenticated production image upload/save remains untested.

## Changed files

Frontend:

- `src/utils/electionCovers.js` — validated, verified-scope immutable uploads.
- `src/utils/developmentProductionWriteGuard.js` — exact cover INSERT allowance.
- `src/pages/board/Elections.jsx` — upload integration, cancellation isolation,
  accurate errors and replacement of a previously broken cover.
- `src/pages/board/BoardElectionSetup.jsx` — file accept/reset, progress/save
  controls and public-upload copy; existing wizard and styling retained.
- `src/pages/superadmin/Elections.jsx` — same compatible upload contract and
  in-flight/cancellation protections; existing Super Admin form retained.

Validation/preparation:

- `tests/electionCovers.test.mjs`.
- `scripts/kandid-election-cover-authorization.mjs`.
- `scripts/kandid-election-cover-browser.mjs`.
- This directory's `repair.sql`, `rollback-disable-uploads.sql`,
  `production-preflight.json`, and `README.md`.

## Observed local results

- 57 focused Node tests passed, including existing election Create/Edit and
  guard contracts for Officers/Results.
- Nine disposable PostgreSQL authorization/configuration checks passed.
- Targeted ESLint passed; final production/PWA build passed. The build emitted
  a plugin-timing performance warning, not a build error.
- Board wizard upload, preview, failed replacement, successful Edit Save,
  list image loading, cancellation isolation and Create draft upload passed at
  all five widths. A complete Create Election wizard Save with the draft URL
  also passed at 375px. All backend data was intercepted/synthetic.
- Student Elections displayed the same saved image and had no horizontal
  document overflow at 375, 390 and 1440px.

| Viewport | Document scroll width | Board dialog client/scroll width |
| --- | --- | --- |
| 375 | 375 | 354 / 354 |
| 390 | 390 | 369 / 369 |
| 768 | 768 | 739 / 739 |
| 1024 | 1024 | 673 / 673 |
| 1440 | 1440 | 698 / 698 |

No CSS changes or overflow-hiding rules were needed. No production browser
session was used; authenticated production upload/save remains untested.
