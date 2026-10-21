# Kandid isolated publication review

Status: NO-GO for publication until the 17 broad-suite failures are triaged. No push, merge, frontend/backend deployment, production lookup, email, account operation, or production configuration change was performed.

## Branch and preservation

- Branch: publication/kandid-reviewed-20261022.
- Parent: 9325838b0066800fa340545913e25b5c0ab5c642 (verified origin/main).
- Existing main remains e7f0c07be8f20b821f70c79e28de76065261100f; its commits and uncommitted source bytes are preserved.
- All 689 original tracked non-temporary files remain present. Application source matches the reviewed working copy; isolation-only changes are ignore rules, narrow artifact checkout endings, test-harness origin configuration, and review documentation.
- Exactly 143 changed/additional files are included; the adjacent JSON lists every path and source hash. No original production feature file is deleted.
- The published blockchain workflow is retained unchanged from the parent; scheduler variables and secrets were not changed.

## Exclusions and portability

- All 3108 temporary files from the unpublished main commit are excluded, including browser profiles, caches, executable tools, archives, screenshots and diagnostic logs.
- No .env file, local credential, generated build output, node_modules, database dump, or review-session browser state is included.
- .gitignore now excludes the entire .tmp directory, local publication directories, .vercel, coverage and logs.
- .gitattributes pins only the reviewed resolver/worker dependencies and workflow line endings needed for reproducible artifact hashes. Runtime implementation and lockfile contents are unchanged.
- The browser harness accepts an explicitly local test origin; validation used localhost:5180 and process-only setup gates. The original localhost:5174 configuration and ignored local environment file were preserved.

## Validation

- Focused auth/setup, anchoring, receipt and submission regressions: 258 passed, 0 failed.
- Isolated browser journeys: 24 passed at 1280, 768 and 375 pixels, with 0 real Supabase requests, emails or account operations.
- Resolver pinned-SDK Deno tests: 5 passed.
- Deno type checks passed for the v9 resolver, anchoring worker, submission endpoint and receipt endpoint. Frozen worker integrity initially exposed a stale copied cache; re-fetching exact public imports passed the unchanged frozen lockfile.
- ESLint: 30 changed source files passed. Actionlint passed.
- Production build passed using the existing browser public configuration in process environment only. No environment file was copied; only the existing nonfatal plugin timing warning remains.
- Full Node suite: 1383 tests, 1366 passed, 17 failed. A targeted origin/main comparison reproduced 10 of those failures; 7 additional failure titles concern the recovered feature contracts. No failure was hidden or skipped.
- Staged diff check reports only three inherited blank-line-at-EOF warnings in the two historical election-finalization SQL proposals and one election-edit contract fixture. Their reviewed source bytes are retained rather than reformatted.

## Remaining broad-suite failures

- finalization refreshes capability then sends only election ID to the official lock RPC (requires review against recovered workflow).
- backend denials and uncertain finalization results never retry a mutation (requires review against recovered workflow).
- mobile election actions form one compact row with separate accessible targets (also reproduced on origin/main).
- phone layout combines Schedule and election actions in one utility row (also reproduced on origin/main).
- deployment package preserves every production v6 source byte outside the two new blocks (also reproduced on origin/main).
- frozen archive hashes stay intact and superseded application files match the new reviewed package (also reproduced on origin/main).
- tests\\electionDependencyEdgeSecurity.test.mjs (also reproduced on origin/main).
- tests\\electionRemovalIdentifierTypes.test.mjs (also reproduced on origin/main).
- soft-removal frozen candidate, dependencies, SQL checks and reviewed source hashes match (also reproduced on origin/main).
- read-only mode disables Board write handlers and blocks the direct vote fetch path (requires review against recovered workflow).
- read-only production environment file resolves only to the official project (also reproduced on origin/main).
- StudentSetup still links identity and completes setup without profile-derived organization writes (requires review against recovered workflow).
- candidate management reads use the admin RPC while ballot clients use the eligible Student RPC (requires review against recovered workflow).
- pre-OTP setup helper strips all unverified personal data (requires review against recovered workflow).
- setup and recovery disclose no pre-auth profile data and verify only through the trusted email (requires review against recovered workflow).
- sync creates only automatic scopes with guarded system provenance and remains repeat-safe (also reproduced on origin/main).
- tests\\termParticipationBootstrapRecovery.test.mjs (also reproduced on origin/main).

Legacy failures include missing historical deployment/schema fixtures, a test requiring an ignored local environment file, and assertions that still assume earlier workflows/privacy contracts. This preparation does not alter production code or weaken tests to make them pass. The unresolved failures block an unconditional publication recommendation.

## Git history and secret review

The publication commit is created directly on 9325838, without cherry-picking the artifact-bearing main commit. Verify the parent and every introduced object before final approval. Pattern-based secret review found no unresolved credential candidates; its URL matches were validation expressions, Google Fonts syntax and synthetic test inputs. This is a bounded review, not a guarantee that every possible secret format can be recognized.

## Automatic deployment impact

Read-only Vercel API verification confirmed project kandidato is linked to brenduling/kandid, productionBranch=main, gitProviderOptions.createDeployments=enabled, and autoAssignCustomDomains=true. A future push/merge to main would automatically create a production Vercel deployment and can update witkandid.vercel.app. No settings were modified. Final approval must include that deployment effect. There is no Supabase deployment workflow in this package; SQL sources are carried without applying them.

Do not push or merge until the remaining validation failures are reviewed and the owner grants final approval.
