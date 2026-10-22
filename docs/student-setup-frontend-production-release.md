# Student Setup contract-3 frontend Production deployment

Verified: 23 October 2026, 01:05 Manila (22 October 2026, 17:05 UTC).

- Project: `kandidato` (`prj_5T95TJu8hU8cLPL83JzVMFCELHIt`).
- Production domain: `https://witkandid.vercel.app`.
- Deployment: `dpl_A395T8MDt9HpfB7zzXdPxupMMHwY`, `READY`, Production, CLI source.
- Deployment URL: `https://kandidato-mlc1bvkaf-mabrenquiro-2764s-projects.vercel.app`.
- Source: reviewed, uncommitted contract-3 frontend changes over base commit `3b153e57b4e45b618c0cca1c01011f2927276ebd`. No new commit or Git push occurred.
- Reviewed manifest SHA-256: `2123b0d65a8cc8f62b74fb02d1bb4941e91882ff37216ae5db2d23f56f41c11e`.
- Prebuilt artifact SHA-256: `c8b30bd2b38c2dfac6b48cd4aeca145d97e1dec3d741cbd02f64f12d77aa3774`.

The reviewed source hashes were verified before the final local Production build and again before deployment. Existing passing test evidence from `student-setup-stage2-preparation.md` was reused. Only static frontend output was deployed, from an artifact directory outside Git; the old checkpoint was not redeployed.

Live verification passed: the Production domain resolves to the new deployment, and the served entry, Supabase client, and Student Setup JavaScript asset hashes match the sealed artifact. The served Student Setup code contains the contract-3 OTP-first flow and setup-token handling. Both compiled flags and the Vercel Production settings remain literal `false`:

- `VITE_ENABLE_STUDENT_ACCOUNT_SETUP`
- `VITE_ENABLE_VERIFIED_STUDENT_SETUP`

All compiled browser environment values match the previous live build. Production settings were not changed. No Supabase operations, account modifications, OTP sends, backend deployments, or Git writes were performed.

This verifies the gated frontend deployment only. Feature activation, backend enablement, and a consenting demonstration-account OTP smoke test remain subject to separate approval; no demonstration account has been designated.

Detailed local execution evidence is in the ignored `.tmp/student-setup-frontend-production-release/` directory (`prepared.json`, `deployed.json`, and `verification.json`).
