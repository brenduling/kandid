# Kandid — AI Agent Working Rules

## 1. Project

Kandid is an existing production-connected centralized election management
system for student organizations.

Primary stack:
- React
- Vite
- Supabase
- Tailwind/CSS
- Supabase Edge Functions
- Solidity / blockchain anchoring where applicable

This is a mature existing system.

Do not treat Kandid as a new project.
Do not rebuild existing architecture simply because another implementation
would be cleaner.

Preserve existing behavior unless the task explicitly authorizes a behavioral
change.


## 2. Working Tree Safety

The working tree may intentionally contain many modified and untracked files.

These changes are legitimate ongoing Kandid development.

NEVER automatically:

- git restore
- git reset
- git clean
- git stash
- git checkout over modified files
- delete untracked files
- revert unrelated changes
- stage files
- commit
- push

Never use:

git add .

Do not attempt to make the working tree clean.

Only modify files required by the current task.

Before changing an already-modified file, preserve unrelated existing changes.

Never assume an existing modification was created by you.


## 3. Git

Current development normally occurs on the existing Kandid checkpoint
workspace/branch.

Do not create branches or worktrees unless explicitly requested.

Do not commit or push unless explicitly authorized.

A request to implement, redesign, fix, test, or build does NOT imply
authorization to commit or push.

When reviewing changes, prefer targeted git diff inspection.


## 4. Production Safety

Kandid is connected to real Supabase infrastructure.

Production data and production database state must be treated as protected.

Unless explicitly authorized:

- do not mutate production data
- do not apply migrations
- do not deploy Edge Functions
- do not alter RLS
- do not alter grants
- do not change authentication configuration
- do not modify secrets
- do not rotate credentials
- do not run destructive SQL

Production SQL work is READ-ONLY unless the task explicitly authorizes a
controlled mutation.

Never run:

npx supabase db push --include-all

Never run:

supabase migration repair

Do not modify migration history simply to make local state look clean.


## 5. Secrets

Never expose or print:

- Supabase service-role keys
- private keys
- worker tokens
- access tokens
- API secrets
- passwords
- environment variable values containing secrets

Never move server secrets into browser-accessible VITE environment variables.

Do not request that the user paste secrets into chat or terminal output.


## 6. Database and Authentication Changes

Database, authentication, RLS, voting, eligibility, receipt, and blockchain
changes are HIGH-RISK work.

For these tasks:

1. inspect the exact relevant implementation
2. explain the intended change
3. minimize scope
4. preserve existing contracts
5. validate before any production action

Do not make broad security changes as a side effect of frontend work.

Do not weaken RLS or grants to make a UI feature work.

Do not introduce new direct browser access to sensitive student data.


## 7. Student Identity Model

Kandid separates persistent student identity from term enrollment.

Central identity:
public.students

Term enrollment:
public.student_term_enrollments

Organization participation and election eligibility are separate concerns.

A student who is absent from a new semester must NOT automatically be treated
as:

- graduated
- transferred
- stopped
- disabled

Central student status uses the established values:

- pending
- active
- disabled

Do not invent additional central status values without explicit authorization.

Login eligibility and current-term voting eligibility are not the same thing.


## 8. Voting Integrity

Voting is security-sensitive.

Do not change voting behavior during visual redesign work.

Preserve:

- one-vote safeguards
- election eligibility
- abstain behavior
- ballot receipts
- result behavior
- JWT-derived student identity
- Ballot V1
- vote hashes
- ballot hashes
- blockchain anchoring behavior

Never trust a client-supplied student identity when an existing trusted
server-side identity mechanism is available.


## 9. Blockchain

Kandid uses blockchain anchoring as an integrity/audit mechanism.

Do not redesign or replace the blockchain architecture during unrelated work.

Preserve existing ballot hashing and anchoring behavior unless explicitly
tasked with blockchain work.

Never expose blockchain private keys or signing credentials to the frontend.


## 10. Design Identity

Kandid's established visual identity is:

Digital Election Newsprint × Digital Bond Paper

The interface should still behave like a modern web application.

It must NOT look like:

- a literal newspaper
- a vintage poster
- a generic SaaS dashboard
- an AI-generated template

Use Kandid Orange sparingly and purposefully.


## 11. Geometry

Kandid's default structural geometry is SHARP and RECTILINEAR.

Default:

border-radius: 0

This applies to structural and interactive components such as:

- buttons
- inputs
- selects
- textareas
- dialogs
- dropdowns
- tables
- management controls
- navigation surfaces where appropriate

Rounded geometry is reserved for genuinely semantic circular elements such as
avatars or circular indicators.

Do not introduce soft rounded cards as a default visual language.


## 12. Avoid

Avoid introducing:

- gradients
- glassmorphism
- excessive cards
- excessive borders
- excessive shadows
- large floating soft shadows
- decorative dot patterns without meaning
- generic pastel icon containers
- pill-heavy interfaces
- oversized badges
- giant decorative hero sections
- unnecessary illustrations
- excessive whitespace without structural purpose

Do not create visual novelty simply to make a page look redesigned.


## 13. Typography Hierarchy

The PAGE TITLE must always be the strongest heading.

Hierarchy:

Level 1 — Page title
Level 2 — Major section
Level 3 — Record / item / subsection
Level 4 — Eyebrow / index / metadata

Never allow an inner section heading to visually overpower the page title.

Editorial personality should come from hierarchy, rules, spacing, typography,
and alignment — not oversized secondary headlines.


## 14. Portal Personalities

Kandid has three distinct authenticated audiences.

### Student

Question:

"What matters to me?"

Student is:
- personal
- understandable
- warmer
- constituency-oriented
- visually approachable

Student may use more visual organization/campaign presentation when it helps
recognition.

Do not make Student look like an admin dashboard.


### Electoral Board

Question:

"What am I managing?"

Board is:
- operational
- organization-scoped
- election-focused
- management-oriented

Do not invent cross-organization access or organization switching when the
existing account is organization-scoped.


### Super Admin

Question:

"What is happening across the system?"

Super Admin is:
- institutional
- system-level
- restrained
- registry/command oriented

Management information should prioritize scanning and comparison.


## 15. Same Skeleton, Different Content

Pages within the same portal should share a recognizable structural skeleton.

Typical hierarchy:

KANDID / PORTAL
small orange context eyebrow
page title
concise description
transition rule
page-specific workspace

However, do NOT force every page into the same card composition.

Same skeleton.
Different content behavior.


## 16. Shared Shell

The authenticated sidebar and topbar are established shared Kandid components.

Treat them as visually locked unless the task explicitly concerns them or a
real runtime defect is demonstrated.

Do not redesign the sidebar/topbar while working on an unrelated page.


## 17. Management Interfaces

When the primary task is scanning/comparing structured management data,
prefer:

- compact registers
- tables
- structured rows
- editorial summary rails

over:

- large card galleries
- floating KPI cards
- oversized visual tiles

Status/type presentation should prefer restrained text, square markers, or
rules instead of rounded colored pills.


## 18. Student Visual Interfaces

Student-facing discovery pages may remain more visual when recognition is
important.

Examples include:

- organizations
- campaigns
- candidates

Visual does NOT mean decorative clutter.

Prioritize actual information and recognition over card decoration.


## 19. Forms and Modals

Forms must preserve their existing behavior and validation.

Use clear groups and hierarchy.

Dialogs and controls should follow zero-radius geometry.

Some dialogs are rendered through React portals directly under document.body.

When styling portaled dialogs, inspect the actual DOM/cascade.

Do not assume selectors requiring a .kandid-app-theme ancestor will match a
portaled modal.

Prefer narrow modal-specific selectors.

Do not blindly add !important.

Use !important only when necessary to defeat a verified legacy !important
rule and keep the override narrowly scoped.


## 20. CSS

Kandid contains substantial accumulated CSS history.

Do NOT perform broad CSS cleanup during feature or redesign tasks.

Do not remove apparently unused CSS without proving it is safe.

Do not normalize the entire stylesheet as a side effect.

Prefer narrowly scoped page/component rules.

Runtime computed behavior is the source of truth, not merely static CSS.


## 21. Responsive Behavior

Preserve desktop, tablet, and mobile behavior.

For visual work, check representative layouts including approximately:

- desktop
- tablet
- 390px mobile

Avoid horizontal overflow.

Do not damage a working mobile experience merely to improve desktop.


## 22. UI Work Strategy

For a known visual defect:

Use a SURGICAL FIX.

Do not audit the entire portal.

For a new page redesign:

Inspect only the relevant page and nearby approved references.

For security/database/auth/voting/blockchain work:

Use a comprehensive and cautious investigation.

Do not repeatedly rediscover already-established project rules.


## 23. Functionality Preservation

A visual redesign must not silently change:

- routes
- Supabase queries
- authentication
- authorization
- RLS assumptions
- voting logic
- election lifecycle
- eligibility
- receipts
- blockchain behavior
- PWA behavior
- organization scope
- data semantics

Change presentation without changing behavior unless behavioral change is
explicitly requested.


## 24. Validation

For ordinary scoped UI work, prefer efficient validation:

1. inspect relevant diff
2. run targeted lint where useful
3. run build
4. confirm responsive behavior when applicable

Do not perform an enormous audit for a simple CSS correction.

For high-risk backend/security work, use deeper validation.


## 25. Reporting

After implementation, report concisely:

- files changed
- what changed
- functionality preserved
- validation performed
- build/lint result
- relevant blockers

Do not write a long essay unless requested.


## 26. Default Scope Rule

When uncertain:

DO LESS.

Make the smallest change that correctly satisfies the request.

Do not expand scope because nearby code could also be improved.

Ask before making architectural changes.


## 27. Permanent Principle

Kandid already works.

The agent's job is to improve the requested part without destabilizing the
system around it.

Preserve trust.
Preserve data.
Preserve behavior.
Preserve intentional existing work.

## Pre-Implementation Inspection and Blockers

Before implementing a requested change, inspect only the minimum relevant
files needed to understand the existing implementation and contracts.

Do not perform a broad repository audit unless explicitly requested.

If the requested change can be completed safely within the existing
frontend/backend contract, proceed.

If implementation would require an unrequested change to:
- database schema or migrations
- RLS or grants
- authentication or authorization
- voting or ballot integrity
- eligibility rules
- sensitive student data access
- Edge Function trust boundaries
- blockchain infrastructure
- production configuration
- established architecture

STOP implementation and report the blocker.

Do not invent a workaround, weaken an existing safeguard, or expand scope
just to complete the requested UI.

Report:
- what blocks the request
- relevant files/contracts
- what kind of change would be required
- whether any files were modified before discovering the blocker