# Implementation status

Updated: 2026-08-03

## Phase 1 — Foundation

- [x] Initialize the Next.js App Router TypeScript application in strict mode.
- [x] Configure Tailwind CSS, source-owned shadcn-style primitives, ESLint, Prettier, Vitest, and Playwright.
- [x] Configure PostgreSQL 17, PostGIS, Prisma 7, migrations, and Docker Compose.
- [x] Model users/sessions, geography, raw imports, permits, projects, saved searches, alerts, and operational runs.
- [x] Add deterministic synthetic seed data for required project scenarios and both user roles.
- [x] Add database-backed email/password authentication, secure sessions, role checks, CSRF origin checks, and login throttling.
- [x] Add a responsive first dashboard and sign-in experience using synthetic fixtures.
- [x] Add a health endpoint, structured process logs, worker/scheduler foundations, and a backfill queue command.
- [x] Add Docker, Caddy, Mac mini deployment, backup/restore, GitHub templates, Dependabot, and CI.
- [x] Add unit coverage for normalization, permit identity, matching, classification/scoring, alert deduplication, and saved-search matching.
- [ ] Run the migrations and seed against a live Docker/PostGIS instance on the target Mac.
- [ ] Run Playwright with the browser binary installed in the target development environment.

## Phase 2 — Permit ingestion

- [x] Define the `PermitDataProvider` contract and normalized Zod schemas.
- [x] Implement development- and building-permit Socrata adapters.
- [x] Add revision-safe keyset pagination, retry/backoff, rate limiting, request bounds, and structured logs.
- [x] Persist raw records before normalized records.
- [x] Implement idempotent snapshot comparison and date-range backfill jobs.
- [x] Add per-record quarantine, duplicate/schema/count guards, and import summaries.
- [x] Track City-reported occupancy dates as a distinct building-permit milestone.
- [x] Add fixture-based provider/import tests and PostgreSQL persistence coverage.
- [ ] Run the first complete City snapshot on the target Mac mini and review the quarantine queue.

## Phase 3 — Project intelligence

- [x] Establish deterministic address normalization and initial rule configuration.
- [x] Establish pure project-matching and classification/scoring primitives.
- [x] Connect matching and classification to persisted permit events and scheduled job runs.
- [x] Build chronological project aggregation and stage precedence, including occupancy completion.
- [x] Add durable admin-only overrides, merge, event reassignment, and action auditing services.
- [x] Add database-backed project-intelligence integration tests.

## Phase 4 — User interface

- [x] Create the responsive product visual system and dashboard shell.
- [x] Connect dashboard metrics, lifecycle milestones, import state, and warnings to live records.
- [x] Build MapLibre map/list/split exploration with URL-backed filters, a real geographic basemap, clustering, and an explicit unavailable state.
- [x] Build sortable/paginated project results and formula-safe filtered CSV export.
- [x] Build project detail, evidence explanation, robust building-permit occupancy timing, occupancy follow-up, source timeline, and admin-only raw view.
- [x] Build admin import, failed-record, review/correction, rules-preview, and evidence-backed health workflows.
- [x] Add real-user navigation, role-aware administration, session-revoking logout, and safe application-update status/handoff.

## Phase 5 — Alerts

- [ ] Build saved-search creation, pause/resume, and result preview.
- [ ] Match new events against active saved searches.
- [ ] Generate deduplicated alert events.
- [ ] Send daily email summaries and record delivery history.
- [ ] Keep immediate, weekly, and Pushover delivery behind interfaces.

## Phase 6 — Production readiness

- [x] Add a guided, loopback-only Mac installer and guarded update/import/backup commands.
- [x] Complete ingestion-aware database, scheduler, job-lease, quarantine, matching, and review health views.
- [ ] Complete the accessibility review; dependency audit and recurring support-image security gates are in CI.
- [ ] Perform a backup-and-restore drill on the Mac mini.
- [x] Validate loopback Caddy and private Tailscale HTTPS deployment on the target Mac mini.
- [ ] Document the first reviewed release and safe update outcome.
