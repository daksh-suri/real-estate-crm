# Real Estate CRM — Vynexa.ai

Production-oriented Real Estate CRM built as a **modular monolith** (`Node + Express + Prisma + Postgres` + `React + Vite`). Single deployable API, single shared database, organization-based multi-tenancy. Built for brokerage workflows from intake → pipeline → inventory → money, with tenant isolation, RBAC, and auditability as first-class concerns.

Detailed decisions live in `docs/`:
- `docs/CRM_ENGINEERING_CONTEXT.md` — durable architecture, business rules, and checkpoint status (read this first, then Phase 3)
- `docs/CRM_Implementation_Blueprint_Phase3.md` — implementation specification (primary source of truth)
- `docs/CRM_Architecture_Audit_Phase2.md` + `CRM_Architecture_Audit_Report.md` — decision record

---

## Core Capabilities (V1 Implemented)

- **Dashboard** — operational overview (`GET /dashboard`): open leads / active deals / upcoming visits / reservations / tasks, overdue/expiring attention tiles, stage & availability distributions, upcoming visits + recent activities (RelatedName resolution).
- **Enquiries** — append-only intake events (`POST /enquiries` unified `PORTAL/WALK_IN/PHONE/OWNED_FORM`, `rawPayload` capped 20KB, `unmatched` filter, `IdempotencyKey` replay/409).
- **Leads** — working opportunities (`OPEN/CONVERTED/DISQUALIFIED`, one `OPEN` per `org+contact+project` via partial index, project-less always separate). Created only via intake; `PATCH` `OPEN↔DISQUALIFIED`, `POST /leads/:id/reassign` `lead:assign` (`MANUAL` wins), `ROUND_ROBIN` auto-assignment (team `FOR UPDATE` counter) + human-readable `Automatic/Manual/Unassigned`.
- **Contacts + Requirements** — tiered dedup (`normalizedEmail` lower + `normalizedPhone` 10-digit IN), `PossibleDuplicate PENDING` queue, transactional `POST /contacts/:id/merge`, `Requirement` is `Contact`-owned (`preferredProjectIds[]` validated same-org).
- **Properties** — `Organization → Project → Unit`, `Project` soft-delete (`Restrict` if units), `Unit.projectId` immutable, `availabilityStatus` never direct-written (`AVAILABLE/BLOCKED` at create, `RESERVED/ON_HOLD/BOOKED` via Reservation/Booking with `Unit FOR UPDATE`).
- **Deals / Pipeline** — fixed 10-stage `NEW→QUALIFIED→SITE_VISIT_SCHEDULED→NEGOTIATION→RESERVATION→BOOKING_CONFIRMED→AGREEMENT_SIGNED→PAYMENT_IN_PROGRESS→CLOSED_WON` + `CLOSED_LOST` from any active (`ALLOWED_TRANSITIONS` literal map), `POST /deals` auto-converts `OPEN→CONVERTED`, dedicated `stage-transition` with `fromStage` 409, `lostReason` required for `CLOSED_LOST`, `AuditLog deal.create`+`stage_transition` in-tx.
- **Site Visits** — `SCHEDULED/CONFIRMED/COMPLETED/CANCELLED/NO_SHOW`, 60m default 15–480 override, 15m agent-only buffer, `Agent→Project FOR UPDATE` order + `IdempotencyKey SITE_VISIT_CREATE`, dedicated `confirm/cancel/complete/no-show/reschedule` (no generic PATCH, no `deletedAt`).
- **Reservations / Holds** — single `Reservation` table `type RESERVATION|HOLD` `status ACTIVE→EXPIRED/RELEASED/CONVERTED`, `Unit FOR UPDATE` owns inventory, `dealId` required, `expiresAt` future, named expiry worker (`expireDueReservations` per-candidate tx).
- **Bookings** — conversion of one `ACTIVE RESERVATION` (`reservationId @unique` backstop) → `BOOKED` + `RESERVED→BOOKED` + `ACTIVE→CONVERTED` atomically; dedicated `cancel` preserves row.
- **Payments** — `PaymentPlan dealId @unique` + `PaymentObligation PENDING/PAID` (`OVERDUE` derived at read) + `PaymentRecord PENDING/SUCCESS/FAILED` `correctsRecordId @unique` chain; `POST /payment-plans {bookingId, obligations[]}` deal-specific schedule, `POST /webhooks/payment-gateway` provider-neutral HMAC `x-webhook-signature` (`PAYMENT_WEBHOOK_SECRET`), `FOR UPDATE` → `PAID` idempotent `eventId PAYMENT_WEBHOOK`.
- **Documents** — row-per-version `groupId+version+supersedesId @unique` `storageKey {org}/{contact}/{group}/vN` server-derived, `NOT_SUBMITTED→SUBMITTED→UNDER_REVIEW→VERIFIED/REJECTED→RESUBMITTED` literal map, `upload-url`/`access-url` 15m presigned via `@aws-sdk/client-s3` on Cloudflare R2 (`region auto`, `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`), `objectExists` 404 vs 502 distinct, `verify/reject` with `AuditLog` + reviewer triple.
- **Activities / Tasks** — `Activity` immutable log (no PATCH/DELETE, `type/outcome` free-form, optional atomic `followUpTask`), `Task OPEN→DONE` (`OVERDUE` derived `OPEN+past dueAt`), `POST /tasks/:id/complete` 409 repeat.
- **Communication** — contact-scoped `GET /activities?contactId=` timeline, `INBOUND_/OUTBOUND_` outcome prefix for direction, `LogActivityButton` recycled.
- **Reports** — 10 `GET /reports/*` (`deals/leads/visits/bookings/payments/tasks/activities/inventory/documents/contacts`) `tenantPrisma.groupBy/count`, half-open `[from,to)` UTC `toRangeStart/End`, range vs snapshot preserved (inventory snapshot ignores range, `DistBars` CSS).
- **Settings** — `Team` (`GET /users?search&status&teamId` + `POST /users` employee provisioning bcrypt, `Roles` read-only `GET /roles` + `/roles/permissions/catalogue` domain-grouped `scope` badges, `Lead Sources`, `Campaigns`, hidden `Assignment Rules` (`ROUND_ROBIN {teamId}` only, backend-controlled counter)). `GET /users/:id` closes `KINDS.user` gap for `RelatedName`.
- **Calendar** — internal month grid + agenda (no Google/Outlook sync): primary `SiteVisit.scheduledAt/duration/status` + optional `Task.dueAt` (OPEN only), `GET /site-visits?from=&to=` window, native `Date` grid, click → `/app/site-visits/:id`, responsive `1.6fr 1fr → 1fr @900px`. Dashboard links to `View calendar →`.
- **Background / Audit** — `OutboxEvent` (`PENDING/PROCESSING/PROCESSED/FAILED`, `FOR UPDATE SKIP LOCKED` claim, `min(30s·2^(n-1),1h)` 10 attempts) + `WorkerHeartbeat` (`id:main`), `node src/worker.js` scheduler (expiry 60s + outbox 10s), notification lanes `INTERNAL/CUSTOMER` (customer re-reads `communicationConsent OPTED_OUT` at dispatch).

---

## Architecture / Stack

**Actual implemented:** JavaScript (CommonJS backend, no TypeScript), React 18 + Vite 6 + React Router 7, Node 18+ + Express 4, PostgreSQL 16, Prisma 6, REST (plural kebab resources, `limit`/`offset` 20/100, zod at boundary, `{error:{message,status}}` `401/403/400/404/409`), modular monolith `server/src/modules/<domain>/{routes,controller,service,validation}.js`, shared `lib/` (`prisma` singleton + `createTenantPrisma` fail-closed wrapper, `tenant.js` `TENANT_MODELS` 17/19, `jwt`, `bcrypt`, `audit.writeAudit`, `idempotency`, `refs.resolveRef`, `storage` R2).

**Tenant isolation:** `Organization` is tenant root; every tenant table carries indexed `organizationId` FK. `createTenantPrisma(organizationId)` injects `organizationId` + `deletedAt:null` on reads; client-supplied `organizationId` never trusted (JWT→DB row). Cross-tenant reads 404, writes 403. Inside transactions, `wrapModel(..., rawTx)` sees uncommitted rows.

**Auth:** JWT access (15m) in memory + HttpOnly `refreshToken` cookie, `SELECT ... FOR UPDATE` rotation, rate limit `login 20/15m` (`ip`-only), CSRF `Origin/Referer` on refresh in prod, `express.json({limit:'100kb', verify: rawBody for HMAC})`.

**Background:** Postgres-backed jobs (no Redis/Elasticsearch for correctness), `R2` via `@aws-sdk/client-s3` + `s3-request-presigner` (S3-compatible, bucket `PRIVATE`, presigned 15m, `objectExists` HeadObject).

---

## Setup

**Prerequisites:** Node 18+ (20 recommended), npm 9+, PostgreSQL 14+.

```bash
npm install
cp .env.example .env
# edit .env: DATABASE_URL, JWT_ACCESS_SECRET, CORS_ORIGIN, etc. (placeholders below)
npm run prisma:generate
npx prisma migrate dev --name <snake>   # or: npx prisma migrate deploy (CI/prod)
```

**Environment:** copy `.env.example` → `.env` and fill (never commit real values):

```
DATABASE_URL=postgresql://user:password@localhost:5432/real_estate_crm
PORT=5000
CORS_ORIGIN=http://localhost:5173
JWT_ACCESS_SECRET=change-in-production-at-least-32-chars+
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
JWT_ISSUER=real-estate-crm
JWT_AUDIENCE=real-estate-crm-client
BCRYPT_COST=10
PAYMENT_WEBHOOK_SECRET=
R2_ACCOUNT_ID=
R2_BUCKET_NAME=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
VITE_API_URL=http://localhost:5000
```

**Database:** Prisma is source of truth; `DATABASE_URL` from `.env`. Migrations are the 19 files in `prisma/migrations` (including hand-written partial indexes `leads_open_contact_project_key` and `documents_live_group_key`). `?schema=public` is not required (public is default) — omitted for simplicity.

```bash
# dev DB (now contains deterministic demo dataset from QA seed)
psql -h localhost -U postgres -d postgres -c "CREATE DATABASE real_estate_crm"
npx prisma migrate deploy   # or: npm run prisma:migrate

# test DB (one-time, before npm test) — can be recreated if deleted: same CREATE + migrate deploy
psql -h localhost -U postgres -d postgres -c "CREATE DATABASE real_estate_crm_test"
# tests auto-rewrite DATABASE_URL to real_estate_crm_test (server/tests/setup.js, refuses otherwise) and wipe it
```

**Seeds:**

```bash
npm run seed:dev --workspace=server        # legacy org "abc" + Admin 18dakshsuri@gmail.com (dev only)
npm run seed:dev:qa --workspace=server    # deterministic demo dataset — makes real_estate_crm mirror the former QA dataset (org "qa" + 5 users QaPass123!, 4 sources/2 campaigns/2 projects/6 units/7 contacts/6 enquiries/4 leads/3 deals/5 visits/6 reservations/1 booking/1 plan/3 obligations/4 docs+version chain/4 activities/3 tasks — fail-closed unless DATABASE_URL targets real_estate_crm and host is localhost)
npm run seed:qa --workspace=server        # isolated QA variant — same dataset but targets real_estate_crm_qa (fail-closed); kept for reference but not required after consolidation
```

**Run:**

```bash
npm run dev              # concurrently: server :5000 (nodemon) + client :5173 (Vite)
npm run dev:server       # backend only
npm run dev:client       # frontend only
npm run worker --workspace=server        # background scheduler (separate process, graceful SIGTERM)
npm run build            # vite build → client/dist
npm run start:server     # production: node src/server.js
curl http://localhost:5000/health  # {"status":"ok","db":"ok","worker":"never|live|stale"}
```

Ports: API `5000`, Vite `5173` (proxies `/health` → `:5000`), worker no port.

---

## Testing

```bash
npm test                 # root delegates to server: jest --runInBand --detectOpenHandles (~2.5 min)
npm test -- tests/<name>.test.js  # from server/: e.g. npm test -- tests/auth.test.js
npm test --workspace=client        # or: cd client && npm test  (vitest run, 14 suites / 99 tests)
npm run build            # client prod build (~367kB JS)
npm run lint             # eslint . (js + jsx, React)
npm run lint:fix
npx prisma validate
npx prisma migrate status
```

Backend tests auto-rewrite `DATABASE_URL` to `real_estate_crm_test` and wipe it (`beforeAll`/`afterAll` including organizations) — never point them at development data.

---

## Environment Separation

- **Development** `real_estate_crm` (`.env` `DATABASE_URL`) — local app development, `seed:dev` safe to re-run (upserts, never deletes CRM data).
- **Test** `real_estate_crm_test` (auto) — `server/tests/setup.js` rewrites pathname, refuses any other DB; `npm test` wipes it.
- **QA** `real_estate_crm_qa` (isolated) — `seed:qa` fail-closed (`new URL(DATABASE_URL).pathname === 'real_estate_crm_qa'` else throw) and scoped deletes `WHERE organizationId=qaOrg.id`; `npm run seed:qa` is deterministic and repeatable.

Do not `prisma migrate reset`, `DROP DATABASE`, or `DELETE FROM` without an isolated disposable DB and explicit justification.

---

## Feature Limitations / Deferred

- No Google/Outlook/external calendar sync (internal `SiteVisit`+`Task` month view only).
- No Vynexa AI voice/Journeys/messaging platform dependency (CRM owns `Activity` log + rule-based `Task` follow-ups, at most one bounded third-party webhook later).
- No generalized workflow/rules/automation engines (assignment is 4 fixed functions; V1 `ROUND_ROBIN` only — `PROJECT_AFFINITY/TERRITORY/MANUAL_OVERRIDE_CHECK` deferred).
- No Elasticsearch/Redis for correctness, no ML/fuzzy dedup (deterministic `normalizedEmail/Phone` + `PossibleDuplicate PENDING` manual merge, merge reassigns all relations, OPEN conflict parks as `DISQUALIFIED`).
- No ChannelPartner, no RERA guardrails (`preAgreementCapPercent` etc. additive later), no per-entity history tables (one `audit_logs`), no invite-token/deactivate lifecycle, no grant/revoke UI (`Roles` matrix read-only, backend source of truth).
- Inverse: production hardened (`JWT 32-char, HMAC x-webhook-signature, CSRF Origin/Referer, 100kb json, rateLimiter ip-only, P2002→409/P2025→404 fallback, `groupBy deletedAt:null` gap, `FOR UPDATE` serialization, `IdempotencyKey` tenant-scoped).
