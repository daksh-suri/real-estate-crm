# CRM Engineering Context

> Read this document before modifying CRM architecture or backend behavior.
> Then read the relevant Phase 3 section for the specific task.

## 1. Purpose of This Document

- **What:** compact, durable engineering context for the Vynexa.ai Real Estate CRM.
- **Who:** future CLI coding agents and human developers joining the project.
- **Why:** prevents rediscovering decisions from chat history, cuts context/token usage at task start, and stops agents from accidentally contradicting settled decisions.
- **Relation to Phase 3:** `CRM_Implementation_Blueprint_Phase3.md` remains the primary implementation specification. This document explains the *why*, the *current state*, and the *constraints*; Phase 3 explains the *what to build next*.
- **What it does NOT replace:** Phase 3 (spec), Phase 2 (supporting context), the code/schema themselves, or task-specific instructions from the developer.
- **Living document:** it must be updated in the same task whenever architecture, business rules, tenant/auth/transaction/concurrency/idempotency behavior, or checkpoint status meaningfully changes (see §18).

Status labels used throughout:

| Label | Meaning |
|---|---|
| SPECIFIED | Required by authoritative documentation (Phase 3), not yet settled in code |
| ACCEPTED | Deliberately settled project decision |
| IMPLEMENTED | Verified in the current codebase/schema |
| DEFERRED | Deliberately postponed, may return later |
| OPEN | Genuinely unresolved — needs a decision, do not guess |

## 2. Product / Project Context

- CRM is being built for **Vynexa.ai**.
- **Production-oriented, SaaS-capable** — not a demo/college MVP. Correctness, tenancy, and auditability outrank speed of feature delivery.
- Architecture is expected to go through **multiple iterations and reviews**; this document records durable reasoning, not just current code shape.
- **Organization is the tenant boundary.** Every tenant-owned record carries `organizationId`; one deployment serves many brokerages.
- The CRM **must function independently of Vynexa's proprietary AI voice/communication infrastructure**. No AI-call-qualification, no Journeys engine, no Vynexa messaging platform as a dependency (Audit Report §Scope Correction — ACCEPTED).
- What the CRM *does* own: interaction **records** (Activity log of what was said/sent, by whom, when) and **rule-based follow-up scheduling** (Tasks with due dates/assignees). A single bounded third-party channel integration (e.g., one WhatsApp Business webhook) is a possible future feature, not a platform layer.

## 3. Technology Stack

| Layer | Accepted choice |
|---|---|
| Language | **JavaScript only** (CommonJS backend). Do NOT introduce TypeScript. |
| Frontend | React 18 + Vite |
| Backend | Node.js + Express |
| Database | PostgreSQL 16 (single shared database) |
| ORM | Prisma 6 (migrations are the single schema truth) |
| Shape | **Modular monolith** — one deployable API, one DB, one web app |

Accepted reasoning (from project docs, not generic advice):

- **Monolith over microservices:** rejected per Phase 2 Part G — operational overhead with no corresponding benefit at this scale. Module boundaries are folder-level + service-layer discipline, never network calls.
- **Shared Postgres over per-tenant DBs:** correct at every realistic scale tier (Phase 2 Part F); the future sharding path is sharding *by* `organizationId`, which is why the column is mandatory and indexed everywhere now.
- **No secondary datastore in V1:** no Elasticsearch/Redis for correctness. A Postgres-backed job mechanism suffices when background jobs arrive. Full-text needs are covered by indexed `contains` filters.
- **Note — spec/implementation skew:** Phase 3 text assumes TypeScript/Fastify. The ACCEPTED project decision is JavaScript + Express. Follow the codebase, not that sentence.

## 4. High-Level Architecture

```
Organization / Tenant (tenant root, global table)
    |
    +-- Users / Roles / Permissions / Teams / TeamMemberships
    |
    +-- Contacts
    |      +-- Requirements (Contact-owned)
    |      +-- PossibleDuplicates (PENDING review queue, never auto-merged)
    |      +-- Enquiries (intake events pointing at Contact)
    |      +-- Leads (working records pointing at Contact)
    |
    +-- LeadSource / Campaign (intake attribution config)
    +-- AssignmentRule / RoundRobinState (lead assignment config + counter)
    +-- IdempotencyKey (intake/webhook replay protection)
    |
    +-- Properties
    |      +-- Projects ── Units (availability owned by Reservation/Hold/Booking flows, never direct edits)
    |
    +-- Sales [IMPLEMENTED: Deal, SiteVisit, Reservation/Hold, Booking, PaymentPlan/Obligation/Record, Document, Activity/Task; SPECIFIED: (none)]
    +-- Jobs [IMPLEMENTED: OutboxEvent, named worker (expiry sweep + outbox processor), notification lanes, worker heartbeat]
    +-- Activity / Task [SPECIFIED, not implemented]
    +-- Document [SPECIFIED, not implemented]
    +-- Communication automation, dashboards, reports [DEFERRED / future]
```

- **Modular monolith:** `server/src/modules/<domain>/{routes,controller,service,validation}.js` plus shared `lib/` (prisma, tenant, auth helpers, idempotency) and `middleware/`. Modules call each other through service functions, never by reaching into another module's tables directly.
- **PostgreSQL is the source of truth.** All persistent state lives there. Any future sync mechanism (React Query refetch, WebSockets for live unit availability) is a *view* of that truth, never authoritative.
- **Tenant boundary:** `organizationId` on every tenant table (17 of 19 models; only `Organization` and `Permission` are global). Enforced by a fail-closed Prisma wrapper (`lib/tenant.js`), not developer discipline.
- **Transaction boundaries:** multi-record flows (intake, merge, reassignment, future reservation/booking/payment) succeed or fail atomically. Never split an established transaction for convenience.
- **No speculative infrastructure:** nothing is built "for later" unless Phase 3 names a cheap schema discipline that preserves a path (e.g., `organizationId` indexing for future sharding). See §5.8.

## 5. Core Architecture Principles

### 5.1 Tenant Isolation

- Organization is the tenant. All business queries/mutations go through `createTenantPrisma(organizationId)` from the authenticated session — never through the raw client.
- **Client-supplied `organizationId` is never trusted** for authorization; the tenant comes from the verified JWT → DB user row.
- Cross-tenant access fails safely: reads hide foreign rows (**404**, not 403, so existence never leaks); guard violations on writes are **403**.
- Inside transactions, tenant guards must use the **transaction client** (`wrapModel(..., guardClient)` bound to `rawTx`), otherwise guards cannot see uncommitted rows written earlier in the same transaction and falsely reject them. Do not regress this.

### 5.2 PostgreSQL as Source of Truth

- Postgres holds all persistent state. UI caches, optimistic displays, and any future real-time channel reflect it; conflicts resolve in favor of the database.
- Denormalized status fields (e.g., `Unit.availabilityStatus`) are updated **inside the same transaction** as the records they summarize — never by background reconciliation.

### 5.3 Transactions

Atomic today: enquiry intake (enquiry + contact + requirement + lead + assignment + links + idempotency record), contact merge (requirement migration + soft-delete + duplicate-status updates), manual reassignment, refresh-token rotation. Specified for later: reservation/booking, payment webhooks, site-visit booking, document verify. Pattern: **lock → re-check state → mutate → commit → emit side effects only after commit.**

### 5.4 Concurrency

PostgreSQL locks and constraints enforce critical invariants; application-level "check then insert" is insufficient wherever two requests can interleave. Established mechanisms: `SELECT … FOR UPDATE` row locks (contact row for intake decisions, round-robin counter, merge source row, refresh-token row), a partial unique index for open leads (see DEC-018), and composite unique keys as final backstops. A transaction aborts on *any* Postgres error — so code must never catch a constraint violation *inside* a transaction and continue; retries happen outside, against freshly committed state.

### 5.5 Idempotency

- Separate **`IdempotencyKey`** table (IMPLEMENTED): `organizationId`, `key`, `operationType` (default `ENQUIRY_INTAKE`), `requestHash` (sha256 of canonical input), `responseSnapshot` (JSON).
- Unique on **`(organizationId, key, operationType)`** — tenant-scoped key namespace, never a bare global key.
- Same key + same hash → **replay** the stored snapshot (HTTP 200, no side effects repeated).
- Same key + different hash → **409 conflict**.
- The unique constraint picks the committed winner under races; the loser resolves to replay-or-conflict, never duplicate side effects.
- Do NOT replace this with an `idempotencyKey` column on Enquiry — the table design is ACCEPTED and reusable for future webhook/payment endpoints.

### 5.6 Soft Deletion

- `deletedAt` on: User, Team, Contact, Requirement, Project, Unit, Lead.
- **Reads** exclude soft-deleted rows by default (tenant wrapper injects `deletedAt: null`) → missing-or-deleted reads as **404**.
- **Writes** against soft-deleted rows fail **400** with a reason (e.g., "cannot attach to soft-deleted project"), except cross-tenant rows which stay 404.
- History is preserved because intake/sales records are evidence (repeat enquiries, bookings, payments reference them). Enquiry itself has no delete endpoint at all.
- **Exception:** config rows without `deletedAt` (LeadSource, Campaign, AssignmentRule) use hard delete; their FKs are `SetNull` so referencing history survives.

### 5.7 Auditability / History

- No destructive merges: losing contacts are soft-deleted with `consentSource = merged_into:<id>`; duplicates flip to `CONFIRMED_SAME`, never removed.
- Origin links are permanent: `Lead.originEnquiryId` is `@unique` + `Restrict`; an origin Enquiry can never disappear under its Lead.
- Correction-over-edit is the rule for any future Tier-1 financial/legal records (compensating records referencing the original, never in-place mutation).

### 5.8 Avoid Premature Abstraction

Established rejections (Phase 2 Part G + scope corrections) — do not build: generalized workflow engines, generalized rules/assignment engines (assignment is four fixed functions, see §9), microservices, service mesh, API gateway, Elasticsearch/Redis for correctness, ML/fuzzy dedup, RERA *engines* (only targeted guards, deferred), custom observability stacks. Each rejection names a simpler mechanism that replaces it.

## 6. Authorization Model

**Role → Permission → Data Scope.** Every protected route is `authenticate` → `authorize(resource, action)` — the guard in `modules/authorization/guard.js` is the ONLY place that checks `(role, scope, resource:action)`.

- Scopes: `OWN`, `TEAM`, `PROJECT`, `ORGANIZATION`. Scope match is exact (no silent upgrade); `PROJECT` scope additionally needs business-logic context.
- V1 roles (IMPLEMENTED as `FIXED_ROLES`): `Agent`, `Team Lead`, `Manager`, `Operations/Accounts`, `Admin`. Roles are per-organization rows; the *permission mapping* is configurable per org, the five names and four scopes are fixed for V1.
- Permission resources use lowercase model names (`contact`, `lead`, `enquiry`, `leadSource`, `campaign`, `assignmentRule`, `project`, `unit`, …). New modules must follow this convention.
- **Never hardcode role-name checks** (`if (user.role === 'admin')`) in business logic — use permissions/scopes.
- Tenant isolation is separate from RBAC: no role, not even Admin, ever grants cross-tenant access. Deactivated users are rejected at authentication; `ON_LEAVE` may use the system but is excluded from *new* auto-assignment.

## 7. Domain Model

### Implemented entities

| Entity | Represents | Does NOT represent | Key invariants |
|---|---|---|---|
| Organization | Tenant root | Anything queryable by other tenants | Global table; deleted only with all its data (Cascade) |
| User | Agent/staff login + lifecycle (`ACTIVE/ON_LEAVE/DEACTIVATED`) | A channel partner (partners get no login in V1) | Email unique per org; deactivation revokes access immediately, reassignment is a separate process |
| Team / TeamMembership | Many-to-many grouping of users | Lead ownership (derived via assignment + membership) | Membership triple (user/team/membership orgs) must match |
| Contact | A real-world person, org-scoped | A per-project record (no `projectId`) | Deterministic identity = org + normalized email + normalized phone; single-signal matches are ambiguous, never auto-merged |
| Requirement | Stated customer need (type, budget, projects, notes) | Lead fields | **Belongs to Contact**; `Lead.requirementId` is a reference only; `preferredProjectIds` is a `String[]` validated to same-org, non-deleted projects |
| PossibleDuplicate | Candidate duplicate pair for human review | A merge instruction | `PENDING` by default; only manual merge flips to `CONFIRMED_SAME` |
| Enquiry | One **intake event** — what came in | A sales record; channel-specific fields live in `rawPayload`, never on Lead | Append-only; `contactId` null until matched; `linkedLeadId` set after Lead resolution |
| Lead | Working **sales opportunity/relationship** from intake | The intake history (that's Enquiry) | Created only by intake; one OPEN per org+contact+project (partial index); project-less leads are exempt by design; auto-flips to CONVERTED when a Deal is created from it (DEC-024) |
| Deal | Converted Lead's **pipeline record** — stage + lost reason | Reservation/booking/payment/site-visit state (future modules reference Deal, never the reverse) | Created only from an OPEN Lead at `NEW`; fixed 10-value `DealStage` enum, map-validated transitions, dedicated endpoint; `unitId` nullable until reservation, attach-once; soft-deleted like Leads |
| SiteVisit | One **planned customer property visit** — agent + project + slot | A calendar system, a Unit hold, a Deal stage driver | `SCHEDULED` start, 60-min default, 15-min agent-only buffer; optional dealId (contact-consistent); no `deletedAt`; transitions via dedicated ops; reschedule re-locks + re-checks |
| Reservation | One **unit claim or hold** — deal + unit + type | Booking/payment detail (references it, never the reverse) | `type` RESERVATION/HOLD on one row (no UnitHold table); `dealId` required in V1; `status` ACTIVE→EXPIRED/RELEASED/CONVERTED (CONVERTED only via Booking); `expiresAt` nullable (no-expiry hold); no `deletedAt`; Unit + row mutate in one tx under Unit `FOR UPDATE`; dedicated create/release/expiry ops |
| Booking | Finalized **unit sale record** — deal + unit + reservation | Payment detail (references it, never the reverse) | `reservationId` required + unique (one booking per reservation); `bookedAt` server-set; lifecycle is the cancel triple (no status enum, no `deletedAt`); create converts ACTIVE RESERVATION→CONVERTED + Unit RESERVED→BOOKED in one tx; cancel preserves row, frees Unit→AVAILABLE, keeps CONVERTED; no `Deal.stage` move (agent drives transition explicitly) |
| PaymentPlan | Deal-specific **installment schedule container** — one plan per deal | Reusable plan templates (deferred, see DEC-029) | `dealId` required + unique; obligations supplied per deal at creation; no template lookup, no approval state |
| PaymentObligation | One **expected payment** — plan + amount + due date | Actual payment attempts (that's PaymentRecord) | `status` PENDING/PAID stored; OVERDUE derived at read (PENDING + past dueDate), never written; PAID only via SUCCESS webhook in-tx; no `deletedAt` |
| PaymentRecord | One **payment attempt/result** — obligation + amount + outcome | Obligation state (derived from records, never edited to match) | `status` PENDING/SUCCESS/FAILED; correction-only via new row + `correctsRecordId` (original preserved); `gatewayReference` + eventId recorded; no `deletedAt`, no PATCH/DELETE |
| Document | One **file version** — contact + optional deal + type + storage key | A file host (bytes live in object storage, not Postgres) | Row-per-version (`groupId` + `version` + `supersedesId? @unique`); `storageKey` server-derived; `type` free-form (no values specified — see DEC-030); no `deletedAt`, no DELETE endpoint; review via dedicated ops with audit rows |
| Activity | One **logged interaction/event** — what happened | A task, a message sender, a workflow (records only, never acts) | Immutable (no PATCH/DELETE); `createdBy`/org server-derived; optional lead/deal links with contact-consistency; free-form `type`/`outcome` (see DEC-031) |
| Task | One **work item** — what needs to happen | An auto-completing ticket (inbound events never complete it) | OPEN→DONE via dedicated complete only (DONE terminal, 409 on repeat/race); OVERDUE derived at read + list filter, never stored; assignee same-org + alive + ACTIVE; `deletedAt` retention-only, no delete endpoint |
| AuditLog | Shared **append-only history row** (first writer: Deal) | A per-entity history table — `Deal.stageHistory` derives from these rows | `actorId` has no FK (history survives actor deletion); `deal.create` + `deal.stage_transition` entries written in the same transaction as the state change |
| LeadSource / Campaign | Intake attribution config (portal names, campaigns) | Analytics engine | Per-org unique names; campaign→source must be same-org |
| AssignmentRule | `type + order + config + active` | A script/expression (config holds params only, never logic) | V1: `ROUND_ROBIN` only; config `{ teamId }` must be a visible same-org team |
| RoundRobinState | Per-team assignment counter | Agent workload data | One row per team; `lastIndex` over id-sorted ACTIVE members; `lastAssignedUserId` has no FK so deactivation never blocks the row |
| IdempotencyKey | Processed-request record | Business data | Unique `(org, key, operationType)`; hash decides replay vs 409 |
| Project / Unit | Inventory hierarchy `Org → Project → Unit` | Availability truth beyond `availabilityStatus` | Project name unique per org; Unit identifier unique per project; `Unit.projectId` immutable; `availabilityStatus` never edited directly (future reservation/booking flows own it); `Project → Unit` FK is `Restrict` |

Protected distinctions — do not collapse: **Activity = what happened. Task = what needs to happen. Enquiry = intake event. Lead = sales opportunity/relationship.**

### Specified but NOT implemented

IntegrationConfig. Phase 3 Part B/C defines their shape; no tables, routes, or logic exist yet. (Deal + AuditLog moved to IMPLEMENTED in Checkpoint 8; SiteVisit in Checkpoint 9; Reservation/Hold in Checkpoint 10; Booking in Checkpoint 11; PaymentPlan/Obligation/Record in Checkpoint 12; Document in Checkpoint 13; Activity/Task in Checkpoint 14; OutboxEvent in Checkpoint 15.)

## 8. Critical Architecture & Business Decisions

### DEC-001 — Organization as tenant
**Status:** IMPLEMENTED
**Problem / Context:** SaaS deployment must serve many brokerages from one database without cross-tenant leaks (Phase 2 #19 — the single worst failure mode).
**Decision:** `Organization` is the tenant root; every tenant-owned table carries non-null indexed `organizationId` FK with Cascade.
**Rules:** All business access via `createTenantPrisma(orgId)`; raw client forbidden except classified re-checks and `FOR UPDATE` locks; client-supplied org ids never trusted.
**Why:** Shared Postgres scales to all realistic tiers; `organizationId`-first indexing preserves a future shard-by-tenant path cheaply.
**Important Edge Cases:** Cross-tenant reads return 404 (never 403); writes violating guards return 403.
**Implementation Notes:** `lib/tenant.js` + `lib/prisma.js` (`TENANT_MODELS` 17 entries); proven by `tenantIsolation.test.js` (50 tests).

### DEC-002 — Modular monolith
**Status:** IMPLEMENTED
**Problem / Context:** Microservices were a standing over-engineering risk for this scale (Phase 2 Part G).
**Decision:** One Express API, one Postgres DB, one Vite app. Module boundaries are folders + service-layer discipline.
**Rules:** Modules call service functions, never another module's tables directly. No network calls between domains.
**Why:** Operational overhead of services buys nothing at CRM transaction volumes.
**Implementation Notes:** `server/src/modules/<domain>/{routes,controller,service,validation}.js`.

### DEC-003 — PostgreSQL as source of truth
**Status:** IMPLEMENTED
**Problem / Context:** Dual sources of truth (Unit status vs Reservation status) were flagged in the original audit.
**Decision:** Postgres holds all persistent state; denormalized fields update inside the same transaction as their source records.
**Rules:** UI caches, refetch loops, and any future sockets are views, never authority. No background reconciliation of transactional state.
**Why:** Eliminates drift between "displayed" and "true" inventory/financial state.

### DEC-004 — No Vynexa proprietary dependency
**Status:** ACCEPTED
**Problem / Context:** Original docs assumed Vynexa AI Voice / Journeys / messaging as platform capabilities.
**Decision:** CRM ships with zero dependency on proprietary Vynexa infrastructure (Audit Report Scope Correction).
**Rules:** Workflows needing contact/qualification use agent-logged Activity + rule-based Tasks. At most one bounded third-party channel integration later.
**Why:** The intern/build team cannot consume infrastructure it does not have; the CRM must be sellable standalone.

### DEC-005 — Activity vs Task split
**Status:** SPECIFIED (neither table exists yet)
**Problem / Context:** The original model had only Activity (a log), leaving "call back tomorrow" with no entity.
**Decision:** Activity = what happened (immutable log); Task = what needs to happen (assignee, due date, status, linked record).
**Rules:** Never auto-complete Tasks from inbound messages; `NO_SHOW` is agent-marked, never automatic. Do not collapse the two concepts.
**Why:** With Journeys out of scope, Tasks become the primary follow-up mechanism.

### DEC-006 — Tiered contact dedup, manual merge only
**Status:** IMPLEMENTED
**Problem / Context:** 30–40% duplicates are normal in real-estate CRMs, but family-shared numbers make auto-merge data corruption (Phase 2 #6).
**Decision:** Tier 1 (normalized email+phone+name all match → link as likely-same, still no merge) / Tier 2 (single signal → `PossibleDuplicate` PENDING review) / Tier 3 (no match → new Contact). Merge is manual, transactional, audited, reversible-window; never automatic.
**Rules:** `normalizeEmail` (trim+lower), `normalizePhone` (Indian 10-digit canonical); deterministic identity enforced by `@@unique([organizationId, normalizedEmail, normalizedPhone])`.
**Important Edge Cases:** Same phone + different names → Tier 2, separate contacts. Null phones never match each other (phone clause added to OR only when non-null).
**Implementation Notes:** `contacts/normalization.js`, `contacts/dedup.js`; merge locks source row `FOR UPDATE`; 47 tests in `contactsRequirements.test.js`.

### DEC-007 — Enquiry as separate intake event
**Status:** IMPLEMENTED
**Problem / Context:** Writing channels straight into Lead loses "enquiries vs qualified leads" reporting and bloats Lead with intake fields (Phase 2 #38).
**Decision:** `Enquiry` is a lightweight append-only record: channel, source/campaign, `rawPayload` JSON, nullable contact/project, `linkedLeadId`. `Lead.originEnquiryId` (+ `@unique`, `Restrict`) marks the originating event.
**Rules:** No update/delete endpoints for Enquiries. Attaching an enquiry to a lead sets `linkedLeadId` — enquiries are never deleted or merged away.
**Why:** Preserves intake fidelity and funnel reporting without polluting the sales record.

### DEC-008 — Requirement belongs to Contact
**Status:** IMPLEMENTED
**Problem / Context:** "What is this customer looking for" lived only in free-text notes (Phase 2 #40).
**Decision:** `Requirement` (type, budget range, `preferredProjectIds[]`, possession, notes) is Contact-owned; `Lead.requirementId` is a nullable reference. Intake-supplied requirement data creates a NEW row each time (need history) and links it to the lead only when the lead has none.
**Rules:** `preferredProjectIds` stays a `String[]` — every id validated same-org + non-deleted at the service layer, never trusted.
**Why:** A requirement outlives any single lead/project engagement and drives re-engagement queries.

### DEC-009 — Repeat-enquiry attach behavior
**Status:** IMPLEMENTED
**Problem / Context:** Same person enquiring twice must not spawn duplicate working leads (Phase 3 Part E).
**Decision:** Same Contact + same Project + existing OPEN Lead → new Enquiry attaches to that Lead (`linkedLeadId`), origin preserved, assignment untouched. Closed/soft-deleted leads never capture repeats — a fresh Lead opens.
**Rules:** Attachment never re-runs assignment (manual always wins). Repeat requirement data does not overwrite an existing lead requirement.
**Implementation Notes:** Covered by dedicated tests including the concurrent same-contact case.

### DEC-010 — Project-less enquiries open separate Leads
**Status:** ACCEPTED + IMPLEMENTED (current rule — do not regress)
**Problem / Context:** Without a project there is no stable engagement identity to deduplicate on.
**Decision:** If `projectId` is absent, each enquiry creates its own Lead. Do NOT merge project-less enquiries into one Lead per Contact (that alternative was considered and rejected).
**Rules:** The partial unique index explicitly excludes `projectId IS NULL` rows. A future explicit-linking UI may attach them; the backend must not guess.
**Why:** Auto-merging unrelated interests (e.g., "2BHK for self" vs "plot for father") corrupts the sales record worse than duplicates do.

### DEC-011 — Enquiry append-only, Lead lifecycle soft-delete
**Status:** IMPLEMENTED
**Problem / Context:** Intake events are evidence; sales records carry history.
**Decision:** Enquiries: no delete path at all. Leads: soft-delete (`deletedAt`), hidden from reads (404), blocking for writes (400 on update/reassign of deleted).
**Rules:** Soft-deleted or closed leads release their uniqueness slot (partial index predicate), so a fresh Lead can open afterwards.

### DEC-012 — Lead creation restricted to intake
**Status:** IMPLEMENTED
**Problem / Context:** A manual `POST /leads` would bypass matching, dedup, uniqueness, and assignment.
**Decision:** No `POST /leads` endpoint exists in Checkpoint 7. All Leads originate from `POST /enquiries`.
**Rules:** Do not add a manual lead-create route without also routing it through the full intake pipeline.

### DEC-013 — Lead lifecycle (OPEN → CONVERTED / DISQUALIFIED)
**Status:** IMPLEMENTED
**Problem / Context:** Intake linking needs a definition of "open/active" (Phase 3 #38).
**Decision:** `LeadStatus`: `OPEN`, `CONVERTED`, `DISQUALIFIED`. Allowed via generic PATCH: OPEN→DISQUALIFIED; DISQUALIFIED→OPEN (reopen). CONVERTED is terminal and reachable ONLY through `POST /deals` (hardening correction 2026-09-20: PATCH OPEN→CONVERTED stranded leads with no Deal and blocked the real conversion — see DEC-038).
**Rules:** Reopening into an occupied slot trips the partial index → 409. `assignedAgentId` is rejected on PATCH (use reassign). PATCH to CONVERTED is rejected 400.

### DEC-014 — Manual reassignment
**Status:** IMPLEMENTED
**Problem / Context:** Managers must be able to move leads; auto-assignment must never silently override them (Phase 2 #10).
**Decision:** `POST /leads/:leadId/reassign` (`lead:assign` permission), transactional, target must be a visible ACTIVE same-org user; sets `assignmentSource=MANUAL` + `assignedAt`. This is NOT the same thing as `MANUAL_OVERRIDE_CHECK` (a deferred automatic rule type — see §9).
**Rules:** Cross-tenant target → 403; deactivated/ON_LEAVE target → 400; foreign lead → 404.

### DEC-015 — Purpose-built assignment, not an engine
**Status:** IMPLEMENTED (subset) + SPECIFIED (remainder)
**Problem / Context:** "Configurable assignment" without building a rules engine (Phase 3 scope adjustment #3).
**Decision:** `AssignmentRule(organizationId, type, order, config JSON, active)` evaluated by a hardcoded `evaluateAssignment()` loop over fixed rule-type functions. Config carries parameters only — adding a type means writing a function, never extending an interpreter.
**Rules:** Never introduce scripting, expression languages, or no-code automation here.

### DEC-016 — ROUND_ROBIN implementation
**Status:** IMPLEMENTED
**Problem / Context:** Concurrent creations must not double-assign the "next" agent (Phase 3 Part G #5).
**Decision:** `RoundRobinState(teamId UNIQUE, lastAssignedUserId, lastIndex)`; counter row locked `FOR UPDATE` inside the creation transaction; eligibility = ACTIVE, non-deleted team members checked live, id-sorted; `next = (last+1) % eligible.length`. Empty/ineligible team → Lead stays `UNASSIGNED` (visible on future manager views, never null-silently).
**Rules:** `lastAssignedUserId` intentionally has no FK. Missing state row = first assignment (`lastIndex` starts −1).

### DEC-017 — IdempotencyKey architecture
**Status:** IMPLEMENTED — see §5.5 and DEC-019 for the race protocol. Statuses: pre-existing record + same hash → replay (200); different hash → 409; insert-race loser → resolve against the committed winner.

### DEC-018 — Lead uniqueness strategy
**Status:** IMPLEMENTED
**Problem / Context:** "One active lead per org+contact+project" cannot be a plain unique constraint (closed/deleted/project-less rows must coexist).
**Decision:** Partial unique index `leads_open_contact_project_key` on `(organizationId, contactId, projectId)` `WHERE status='OPEN' AND deletedAt IS NULL AND projectId IS NOT NULL`, applied in migration `20260918160000_checkpoint_7_lead_open_uniqueness` (Prisma cannot express partial indexes — raw SQL migration is the sanctioned pattern).
**Rules:** Application pre-checks (`findOpenLeadForUpdate`) are an optimization; the index is the guarantee. Never drop it to "fix" a 409 — the 409 is the invariant working.

### DEC-019 — Transaction-context tenant guards + retry discipline
**Status:** IMPLEMENTED
**Problem / Context:** Intake creates Contact then references it in the same transaction; guards bound to the global client cannot see uncommitted rows and falsely reject.
**Decision:** `wrapModel(modelName, rawModel, organizationId, guardClient)`; `$transaction` binds guards to `rawTx`. Residual unique violations abort the tx and are retried OUTSIDE (≤3 attempts), never caught-and-continued inside.
**Rules:** No `try/catch P2002 → continue` inside any `$transaction` callback on Postgres. Pre-check (not catch) for ignorable conflicts inside transactions.

### DEC-020 — Property hierarchy rules
**Status:** IMPLEMENTED (structure) + SPECIFIED (availability drivers)
**Decision:** `Organization → Project → Unit`. `Unit.projectId` immutable; `availabilityStatus` (incl. `ON_HOLD`, `BLOCKED`) editable only by future reservation/booking flows; `Project → Unit` FK is `Restrict`; deleted/inactive projects reject intake association (same-org deleted → 400, cross-tenant → 404).
**Rules:** Do not add direct availability editing to unblock a demo — the restriction is load-bearing for Checkpoint 9–11 concurrency work.

### DEC-021 — Deferred-but-shaped items (RERA, partners, comms)
**Status:** DEFERRED — see §15. RERA guardrails re-enter as additive guards on payment-plan/booking flows (per confirmed developer decision); ChannelPartner as attribution-only entity; communication stays records + Tasks.

### DEC-022 — Fixed Deal pipeline + dedicated transition operation
**Status:** IMPLEMENTED
**Problem / Context:** Pipeline stages were referenced but never enumerated; transitions need backend validation, not free enum flips (Phase 2 #7, Phase 3 Part E/G).
**Decision:** `DealStage` enum with the exact 10 values; literal `ALLOWED_TRANSITIONS` map (forward chain + `CLOSED_LOST` from any of the 8 active stages; terminals have zero exits); `POST /deals/:dealId/stage-transition` is the ONLY stage mutator, with optional `fromStage` optimistic-concurrency check (mismatch → 409).
**Rules:** No custom/per-org/per-project stages, no pipeline templates, no `dealType`/RERA fields. `SITE_VISIT_SCHEDULED` is a display marker — it never requires a SiteVisit record.
**Why:** A literal map is itself the auditable spec; any deviation is a diff, not a config change.
**Important Edge Cases:** Same-stage, backward, and skipping transitions all reject 400 with state and audit counts untouched.

### DEC-023 — Shared audit_logs table, same-transaction writes
**Status:** IMPLEMENTED
**Problem / Context:** Phase 3 derives `Deal.stageHistory` from `audit_logs`, but no audit infrastructure existed (verified: zero matches in code/schema before Checkpoint 8).
**Decision:** Created the Phase-3-specified general-purpose `audit_logs` table (`organizationId, actorId [no FK], entityType, entityId, action, beforeState/afterState JSON, createdAt`), tenant-wrapped like any tenant model. Deal writes `deal.create` and `deal.stage_transition` entries in the SAME transaction as the state change. Verified requirement-by-requirement that Phase 3 mandates audit rows only for Deal creation/transitions (plus merge, document-verify, RERA-override) — notably NOT for Lead conversion itself, so no `lead.converted` entry is written.
**Rules:** Future modules reuse this table; never create per-entity history tables. No sensitive fields exist on Deal today (stage + agent-entered lostReason); apply Phase 3 redaction rules when financial/credential fields enter audit payloads.
**Why:** One append-only table serves every future checkpoint; per-entity tables would fragment the trail Phase 14 must consolidate.

### DEC-024 — Deal creation auto-converts its Lead
**Status:** IMPLEMENTED (resolves O-1)
**Problem / Context:** O-1 asked what converts a Lead; Phase 3 requires the source Lead be OPEN but names no separate QUALIFIED state.
**Decision:** `POST /deals` converts its source Lead `OPEN → CONVERTED` inside the same transaction (after row-locking the Lead, so concurrent double-creates serialize and the loser fails Lead-OPEN validation with 409). No separate qualification step exists — OPEN *is* qualified.
**Rules:** A second Deal from the same Lead is therefore impossible without inventing a rule: the Lead is no longer OPEN. Converted-then-lost Deals do not reopen their Lead (no reopening path exists; would need an explicit future decision).
**Why:** Gives `CONVERTED` its only current meaning and makes duplicate-deal prevention fall out of the existing Lead lifecycle instead of a new constraint.

### DEC-025 — Site Visit Agent + Project resource model
**Status:** IMPLEMENTED
**Problem / Context:** Scheduling needs a concrete conflict model without becoming a calendar engine (Phase 2 #14, Phase 3 C.1/E).
**Decision:** A visit occupies exactly two V1 resources — Agent (`User`) + Property (`Project`); per-Unit scheduling does not exist and `Unit` rows are never read or written. Duration default 60 min with per-visit 15–480 override (no org-config table exists; none built); agent buffer fixed 15 min, agent-only. Only `SCHEDULED`/`CONFIRMED` rows block; history never does. Scheduling is `validate → lock agent row → lock project row (deterministic agent→project order, no deadlock cycles) → re-check conflicts → insert → commit`, with `IdempotencyKey(operationType: SITE_VISIT_CREATE)` replay/conflict semantics reused verbatim. No `audit_logs` rows: Phase 3 mandates them only for Deal create/transitions, and visit history lives on the row (`status` + cancellation triple). No Deal stage side effects, no generic PATCH, no `deletedAt` (cancellation is the removal path).
**Rules:** Contact overlap is a preference, never a constraint. `POST /site-visits/:id/reschedule` (from `SCHEDULED`/`CONFIRMED` only, same row updated in place, locks + re-check re-run) is the sole slot mutator. Permissions: `siteVisit:create|read|update|transition`, no `delete`.
**Why:** Row locks on the two real resources close the check-then-insert race with the narrowest possible critical section; everything else is display or future scope.
**Important Edge Cases:** Concurrent same-key retries converge via the idempotency record even when the loser fails first on slot conflict (post-hoc replay resolution). Deactivated agents reject 400; cross-tenant refs hide 404 on reads, fail 403 on writes.

### DEC-026 — Reservation & Unit Hold on one row, Unit lock owns inventory
**Status:** IMPLEMENTED
**Problem / Context:** Unit claims need a concrete concurrency authority without a second availability truth or a generalized hold engine (Phase 3 C.1/E/G, Phase 9).
**Decision:** One `Reservation` row with `type` RESERVATION/HOLD (no UnitHold table). `Unit.availabilityStatus` is the authoritative inventory state; `Reservation.status` is the record lifecycle; both mutate in the same transaction under `SELECT … FOR UPDATE` on the Unit row with an in-lock AVAILABLE re-check. RESERVATION: AVAILABLE→RESERVED; HOLD: AVAILABLE→ON_HOLD (nullable `expiresAt` = management hold with no expiry); release/expiry: →AVAILABLE. `dealId` required in V1 per Phase 3 (management holds without a Deal deferred — no nullable invented). A unit-less Deal is bound to the Unit in the same transaction (attach-once preserved; bound-to-other-Unit rejects 400). `RESERVATION_CREATE`/`HOLD_CREATE` idempotency namespaces reuse the shared table verbatim. `expireDueReservations` named worker: per-candidate tx (lock Unit → re-read ACTIVE + past-due → EXPIRED + conditional AVAILABLE), re-run safe, never releases a reused Unit. No `audit_logs` rows (Phase 3 mandates them only for Deal create/transitions + merge/document/RERA), no outbox (jobs checkpoint owns dispatch), no `deletedAt` (EXPIRED/RELEASED preserve history), no generic PATCH, no CONVERTED/BOOKED (Checkpoint 11).
**Rules:** Permissions: `reservation:create|read|release` (no `delete`, no separate hold perms). `POST /reservations` (explicit `type` field, no `/holds`) is the sole create path; `POST /reservations/:id/release` the sole lifecycle mutator. Terminals never reopen; release/expiry verify the Unit still holds the expected state, never blind-set AVAILABLE.
**Why:** The Unit row lock closes the double-claim race with the narrowest critical section; the type discriminator keeps one lifecycle instead of two tables drifting apart.
**Important Edge Cases:** BLOCKED/BOOKED/RESERVED/ON_HOLD all reject 409 with the Unit untouched. Stale expiry after reuse is a no-op (loser observes terminal state). Same-key different-type payloads collide per-namespace (409 either way); same-key retries converge post-hoc like SiteVisit.

### DEC-027 — Booking converts one ACTIVE reservation; no stage move, no HOLD path
**Status:** IMPLEMENTED
**Problem / Context:** Finalizing a sale must bind Booking + Unit + Reservation atomically without forking conversion history or inventing a Booking state machine (Phase 3 C.1/E/G, Phase 9).
**Decision:** `Booking(unitId, dealId, reservationId! @unique, bookedAt server-set, cancel triple)` — no status enum, no `deletedAt`. Create converts in one tx under the Unit `FOR UPDATE` lock (Checkpoint 10 pattern): ACTIVE type=RESERVATION only (HOLD rejects 400) → Booking insert → Unit RESERVED→BOOKED → Reservation ACTIVE→CONVERTED → `BOOKING_CREATE` idempotency record. `reservationId @unique` backstops the ACTIVE re-check against double conversion. No `Deal.stage` move (Phase 3 booking effects list none; agent drives RESERVATION→BOOKING_CONFIRMED via the existing transition op). No `audit_logs` rows (Phase 3 booking row mandates none — same precedent as Checkpoints 9/10). Cancel (`POST /bookings/:id/cancel`, `booking:cancel` perm): trimmed reason required, `cancelledBy` = actor, `cancelledAt` = now; row preserved; Unit BOOKED→AVAILABLE only if still BOOKED; Reservation stays CONVERTED (history never reopened); double-cancel 400.
**Rules:** Permissions: `booking:create|read|cancel` (no `delete`, no PATCH/PUT/DELETE routes). `POST /bookings` (`{reservationId}` + optional matching `unitId/dealId` cross-checks, authority derived from the Reservation row) is the sole create path. AVAILABLE/ON_HOLD/BLOCKED/BOOKED units reject 409 with nothing converted.
**Why:** The unique conversion edge plus the Unit lock makes double-booking structurally impossible instead of convention-blocked; the missing stage move keeps one Deal mutation path.
**Important Edge Cases:** Concurrent bookings on one reservation → one 201, loser 409 (or 200 replay same-key). Cancel-after-reuse frees only a still-BOOKED unit and never touches CONVERTED. Same-key different-reservation → 409.

### DEC-028 — Contact merge reassigns all owned relations; OPEN conflict parks as DISQUALIFIED
**Status:** IMPLEMENTED
**Problem / Context:** Merge moved only Requirements, leaving Enquiry/Lead/Deal/SiteVisit rows pointing at a soft-deleted contact that tenant reads no longer expose (Phase 3: merge = transactional FK reassignment, all-or-nothing).
**Decision:** Inside the existing merge tx (duplicate row locked `FOR UPDATE`), reassign org-scoped `updateMany` for Requirement, Enquiry (links untouched), Lead (two-pass, below), Deal, SiteVisit — then soft-delete with `consentSource=merged_into:<id>` and mark the pair `CONFIRMED_SAME`. Link fields (`linkedLeadId`, origin, deal lead, visit deal) are never rewritten; history is preserved, not relinked. Moves keep `lead.contactId === deal.contactId` consistent since both move to the same contact.
**Rules:** OPEN-lead conflict (both contacts OPEN + alive on the same non-null project) moves the duplicate's lead as `DISQUALIFIED` — a reconciliation parking state, NOT a sales verdict: no lead-level marker exists (no migration for a flag); provenance is the merged contact + pair status. Reopen follows the normal `PATCH` slot rule only (409 while occupied, 200 once freed). Project-less OPEN leads never conflict by design (index excludes NULL). Anything outside these enumerated cases → 409, never guessed.
**Why:** The partial index (`leads_open_contact_project_key`) is kept as the guarantee; the two-pass move resolves the only collision shape without deleting history or forking duplicate OPEN leads.
**Important Edge Cases:** Concurrent merges serialize on the duplicate lock; the loser observes terminal state (409) with zero partial writes. Cross-tenant merges reject before the tx with nothing reassigned. Non-pair `PossibleDuplicate` rows are untouched (existing V1 simplicity). Same-key different-reservation → 409.

### DEC-029 — Payments are deal-specific schedules; provider-neutral webhook, no outbox yet
**Status:** IMPLEMENTED
**Problem / Context:** Booking needs a payment schedule + gateway-result ingestion without a plan-template system, a real provider, or background workers (Phase 3 Phase 10; RERA guards removed from V1).
**Decision:** `PaymentPlan(dealId! @unique)` + `PaymentObligation(plan, dueAmount, dueDate, PENDING/PAID stored)` + `PaymentRecord(obligation, amount, PENDING/SUCCESS/FAILED, gatewayReference?, correctsRecordId? @unique self-FK)`. Plan creation is an explicit idempotent `POST /payment-plans {bookingId, obligations[]}` (`PAYMENT_PLAN_CREATE`); the obligations array IS the custom schedule. No plan templates exist in any source (verified: "template" hits are doc/notification lanes; "installment" is a trigger label) — reusable/approved monthly templates are DEFERRED/OPEN, additive later, no V1 reshaping needed. Webhook `POST /webhooks/payment-gateway` is provider-neutral, authenticated by the V1 HMAC boundary (hardening correction 2026-09-20, see DEC-038): hex HMAC-SHA256 over the raw request body in `x-webhook-signature`, keyed by server-side `PAYMENT_WEBHOOK_SECRET` (required at boot in production; timing-safe compare; missing/invalid → 401 before validation or state change). When the secret is unset (dev/test only), the legacy unsigned path applies. Tenant derives from the obligation row, gateway `eventId` is the `PAYMENT_WEBHOOK` key. Tx: lock obligation `FOR UPDATE` → re-read → create record → SUCCESS flips PAID (already-PAID + SUCCESS → 409). No outbox (doesn't exist; jobs checkpoint owns it), no audit rows (Phase 3 payment rows mandate none), no `Deal.stage`/Booking/Unit writes, no PATCH/DELETE on payment rows.
**Rules:** Permissions: `paymentPlan:create|read`, `paymentObligation:read`, `paymentRecord:read` (webhook exempt — external boundary). OVERDUE derived at read (PENDING + past due), never written. Corrections: new row + `correctsRecordId` (same-obligation enforced, double-correction blocked by unique); originals never mutated.
**Why:** The unique(dealId) + unique(correctsRecordId) + eventId-keyed idempotency make duplicate plans/records structurally impossible; derived OVERDUE keeps the webhook the sole PAID writer with no scheduler to build.
**Important Edge Cases:** Concurrent duplicate deliveries → one 201 + one 200 replay, single SUCCESS. Same event different payload → 409. FAILED/PENDING records stay visible with obligation unpaid. Malformed/unknown/cross-tenant obligation → 400/404 with zero mutation.

### DEC-030 — Documents version as rows; Cloudflare R2 object storage
**Status:** IMPLEMENTED
**Problem / Context:** KYC/case files need upload → review → version history without storing bytes in Postgres, with no gateway or worker infrastructure in the repo (Phase 3 Phase 11; Phase 2 #12). Checkpoint 13 shipped with a stdlib-SigV4, provider-neutral boundary and no real provider; 17E selects the durable provider so document flows work against real bytes.
**Decision:** **Cloudflare R2** is the document object-storage provider. Split of responsibilities: PostgreSQL remains relational source of truth (ownership, tenant, contact/deal links, type, version, status, reviewer triple, storageKey, timestamps); R2 stores only file bytes. `server/src/lib/storage.js` is now an R2 module built on `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` against the S3-compatible endpoint `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com` (region `'auto'`, pinned path-style). Path-style signing has NOT been verified against a live R2 bucket (no credentials in this environment — verified 2026-09-20 as explicitly unverified, code unchanged on static assumptions; verify presigned PUT + PUT + HEAD + GET against a real bucket if uploads ever misbehave). Same exports and same `setStorageProvider` fake boundary as before, so the document service is untouched: `createUploadUrl` (PutObject, 15 min), `createAccessUrl` (GetObject, 15 min), `objectExists` (HeadObject: `NotFound`/`NoSuchKey`/404 → false, anything else throws — the 404-vs-outage distinction from the corrective pass is preserved). StorageKey convention unchanged (`{org}/{contact}/{group}/v{N}`, server-derived). Row-per-version, literal state map, resubmit constraints, and review/audit semantics are exactly as before.
**Why R2:** object storage is the correct shape for file bytes (Postgres holds relations, not blobs); private-by-default objects with presigned upload/download fit the existing upload-url → complete → submit flow with zero redesign; S3-compatible API means the official AWS SDK for JS works (verified via Context7 docs) with no Cloudflare-specific SDK; zero egress fees keep per-document cost predictable for a SaaS; free tier covers dev/staging; direct browser↔R2 transfer keeps multi-MB files out of the Express process.
**Alternatives considered:** Amazon S3 (identical API, but egress fees and a heavier account/IAM surface for this stage — nothing against it technically; migration path stays open precisely because we speak plain S3); Supabase Storage (would bundle auth/storage, but couples us to Supabase's platform and its own tenant model, conflicting with our org-tenancy); Backblaze B2 (S3-compatible and cheap, but egress fees and a smaller presigning/tooling ecosystem than R2's Cloudflare-backed path). R2 won on: S3 API compatibility + no egress + free tier + no platform coupling.
**Trade-offs:** Cloudflare dependency (account, bucket lifecycle owned outside the repo); S3-compat is close but not identical (region must stay `'auto'`; checksum headers differ — the SDK absorbs this); R2 credentials must exist or every storage op is 503 (by design, never faked); presigned URLs are bearer tokens (hence 15-min TTLs, down from 24h); storage is now explicit infrastructure; a future migration off R2 is possible (plain S3 calls, same keys) but not free (bytes must be copied, URLs re-issued).
**Rules:** Env is R2-only (`R2_ACCOUNT_ID/BUCKET_NAME/ACCESS_KEY_ID/SECRET_ACCESS_KEY`; legacy `STORAGE_*` names are not read — clean break, per explicit decision). Credentials server-side only, `.env.example` documents shape without values, never committed. Bucket stays private; browser transfers use short-lived presigned URLs after backend auth+authz. Tenant isolation is enforced by the CRM (scoped reads before any signing), never by key-prefix obscurity. Keys are server-generated; no client-controlled paths.
**Security implications:** bearer URLs (15-min TTL, used immediately, never persisted to state/localStorage); tenant check precedes every sign; cross-tenant IDs hide as 404 before storage is touched; error messages never leak keys/secrets (tested: 503 body contains none); upload-limiter rate Bookings on upload-url.
**Failure scenarios:** URL generation failure → 503/5xx, draft row stays NOT_SUBMITTED; R2 PUT failure → dialog error, completion never attempted; complete with missing object → 400, state unchanged; HEAD outage → 502 (never "missing"); expired URL → R2 403 on PUT, user re-requests; orphaned object (PUT succeeded, complete never called) → bytes without metadata, invisible to the CRM; deferred cleanup strategy is an open item (acceptable: private bucket, storageKey-addressable sweep later). Resubmit races keep the P2002 → 409 backstops.
**Edge cases (carried):** Concurrent resubmits → one vN+1, loser 409/replay. Cross-tenant reads hide 404, writes 403/404. Rejection without trimmed reason → 400, zero writes. `type` stays free-form (no values exist in any source).
**Operational:** `.env.example` holds the four vars; dev/test run unconfigured (fake in tests, 503 in dev); bucket CORS must allow PUT/GET/HEAD from the app origin or browser transfers fail (dashboard-side prerequisite, cannot be code); no migration (metadata model untouched).
**Reviewer questions this answers:** why not store files in Postgres (bloat, backups, no range/presign story); why not S3 (cost/surface, open path back); what happens when R2 is down (503/502, metadata safe, drafts retryable); what stops tenant A reading tenant B's bytes (backend authz before signing + private bucket + unguessable UUID keys + 15-min TTLs).

### DEC-031 — Activity is the log, Task is the work item; no rules engine
**Status:** IMPLEMENTED
**Problem / Context:** Follow-up needs a home after AI Voice/Journeys were removed, without building a configurable automation engine (Phase 2 #14/#28; Phase 3 Phase 12).
**Decision:** Two models, never collapsed. `Activity(contactId, leadId?, dealId?, free-form type ≤50, outcome? ≤50, notes ≤5000 Text, createdBy server-derived)` — immutable, no `deletedAt`, no PATCH/DELETE endpoints. `Task(assignedTo, relatedContactId?, relatedDealId?, title ≤200, dueAt, OPEN/DONE stored, createdBy, deletedAt retention-only)` — no Unit link (dealId suffices per Phase 2 #22). Explicit follow-up only: `POST /activities` accepts optional `followUpTask`, created atomically in the same tx; no outcome sniffing, no auto-completion (inbound activities never complete tasks — tested), no rule interpreter. `type`/`outcome` stay free-form (no values specified anywhere — same open treatment as Document.type). OVERDUE derived at read AND in `status` list filters (OPEN + past due), never written. DONE terminal. No audit rows (Phase 3 mandates them only for Deal create/transitions + merge/document verify-reject — same precedent as Checkpoints 9–12). No delete endpoints (Tier 2 `deletedAt` exists for retention only). Contact merge now also reassigns Activity + Document rows whole (Phase 3 merge all-or-nothing); task reference links (`relatedContactId/relatedDealId`) stay untouched like deal/visit links.
**Rules:** Permissions: `activity:create|read`, `task:create|read|complete`. Assignees: same-org + alive + ACTIVE (lead-reassign semantics); cross-tenant → 403. Task links enforce deal→contact consistency when both supplied (siteVisit/document precedent). Complete: lock row → require OPEN → DONE, else 409; no reopen. Activity+Task create is `ACTIVITY_CREATE`-idempotent.
**Why:** One atomic explicit path covers the agent workflow with zero automation surface; the derived OVERDUE keeps a single writer per lifecycle with no scheduler to build.
**Important Edge Cases:** Task-creation failure rolls back the activity (and vice versa). Concurrent completes → one 200, loser 409. Soft-deleted assignee/contact → 400. Deferred/open: rule-based Activity→Task generation, intake-time activity logging (Phase 3 L352), assignee workload/territory logic, `deletedAt` restoration flow.
**17E UI rules:** activity log dialog carries an explicit follow-up checkbox stating the atomicity (one POST, both-or-neither — the UI never splits it into two calls); activities render no edit/delete affordances (immutable by design); tasks render derived OVERDUE badges with no stored state; completion is a single guarded button (disabled when DONE, 409 → refetch); upload dialog enforces PDF/image + 10MB as UX-only guards and walks create → upload-url → R2 PUT → complete → submit, reporting only server-confirmed completion.
**17F UI rules:** `/app/communication` is a contact-scoped history over Activity (`client/src/routes/CommunicationPage.jsx`, replaces the placeholder; nav unchanged). No-contact → EmptyState + search-list picker (`GET /contacts?search=`, first page, no fetch when idle); contact → `GET /contacts/:id` header (consent badge, informational) + `GET /activities?contactId=` timeline with RelatedName lead/deal resolution. Channel filter is client-side over the loaded page (labeled as such); bare-array pagination preserved off the unfiltered length. Direction displays only on `INBOUND_`/`OUTBOUND_` outcome prefix, neutral otherwise — never sniffed from notes, never validated. Logging reuses `LogActivityButton` (prefilled contact, existing idempotency + atomic follow-up); the page performs no POSTs and creates no Tasks. 18 frontend tests.

### DEC-032 — Single worker, transactional outbox, named jobs only
**Status:** IMPLEMENTED
**Problem / Context:** Reservation expiry, notification dispatch, and future side effects need shared background infrastructure without Redis/queues/services (Phase 3 Phase 13; context §5.8).
**Decision:** `OutboxEvent(org, eventType string, payload Json, PENDING/PROCESSED/FAILED, attempts, availableAt, processedAt?, failedAt?, lastError?)` + global `WorkerHeartbeat(id, lastBeatAt, detail)` (system-owned, no tenant data; deliberate raw-Prisma bypass, documented). Rule: business mutation + event row in the SAME tx (`enqueueOutbox(tx, …)`), or both roll back. Processor claims atomically (`UPDATE … FOR UPDATE SKIP LOCKED`, attempts pre-incremented so crashes count toward the ceiling), dispatches OUTSIDE locks via the named handler for `eventType` (only `NOTIFICATION_INTERNAL/CUSTOMER` exist; unknown → retry → FAILED, never silent), marks PROCESSED only after success. At-least-once documented: providers get the stable event id as idempotency key. Retry: `min(30s·2^(attempts-1), 1h)`, 10 attempts, then FAILED with reason kept (all env-overridable in `config.worker`). Expiry sweep reuses `expireDueReservations` unchanged on a 60s cadence; no expiry outbox events (no real side effect exists — ceremony refused). Notifications: `lane` in payload, provider interface + log-only default (never claims external delivery); customer lane re-reads `communicationConsent` at dispatch and suppresses OPTED_OUT as PROCESSED-with-note; internal skips the gate. Scheduler runs the two named jobs with overlap guards + per-cycle heartbeat; `node src/worker.js` separate process with SIGTERM/SIGINT graceful stop. `/health` extended (DB ping + worker live/stale/never) without breaking existing assertions. No worker CRM role; no new permissions (enqueue is service-layer).
**Rules:** No new event type without a named handler. No dispatch before commit, no PROCESSED before success, no FAILED auto-retry, no event deletion. Worker never uses request tenant middleware — org travels on the event/row.
**Why:** One atomic claim statement makes horizontal scale structurally safe; pre-incremented attempts make crash loops terminate; derived-everything-else keeps the worker to four small files.
**Important Edge Cases:** Crash between dispatch and marking → reclaimable after the claim lease (never immediate; duplicate dispatch at the provider still possible — hence stable keys). Concurrent workers split the batch via SKIP LOCKED *and* the durable PROCESSING state (tested: claims never overlap, attempts consumed once). Stale heartbeat → `stale` (5min default), never blocks deploys. Stale-owner terminal writes (lease expired mid-dispatch) affect 0 rows and count as `stale`, never clobbering the new owner's outcome. Ownership is pinned to the exact lease: resolve predicates are `{id, PROCESSING, claimedAt: myClaim}` (hardening correction 2026-09-20 — the old `{id, PROCESSING}` predicate let a late loser overwrite a reclaimed PROCESSING row; see DEC-038).

### DEC-033 — Audit consolidation: shared helper, merge coverage, append-only enforcement
**Status:** IMPLEMENTED
**Problem / Context:** Phase 3 Part N #17 ("confirm every state-changing operation writes `audit_logs`") collides with per-checkpoint DECs that deliberately limited writes to Deal create/transition + Document verify/reject (plus merge, specified but never implemented). Blanket coverage of reservation/booking/payment/visit/task mutations would contradict DEC-025–DEC-032 and fork history across row lifecycles that already preserve it.
**Decision:** Consolidate the specified set. `server/src/lib/audit.js` `writeAudit(tx, …)` is the single writer: accepts ONLY a tx client (request-level clients refused — they carry `$transaction`), requires server-derived `organizationId` + `actorId`, never opens its own transaction. Deal create/transition + Document verify/reject refactored onto it (payloads unchanged). Missing `contact.merge` row added: controller passes `req.auth.userId`, service writes `entityType Contact / entityId duplicateId / action contact.merge` with `beforeState {survivorId, duplicateId}` + `afterState {mergedInto, moved:{…counts}}` — ids + counts only, never contact PII. Tenant wrapper (`wrapModel`) rejects `update/updateMany/updateManyAndReturn/upsert/delete/deleteMany` on `auditLog` with 403 (fail-closed, covers request + tx clients); reads + `create` unaffected. No read API (Phase 3 specifies none), no worker/system rows (expiry history lives on the row; no system-identity model invented), no Tier-1/payment/booking/visit/task expansion. Corrective pass: merge also reassigns `task.relatedContactId` (org-scoped, in-tx, counted as `moved.task`) so active tasks never point at the archived duplicate.
**Rules:** Every future mandated audit write uses `writeAudit` inside the business tx. No audit read/update/delete endpoints. No PII in before/after payloads.
**Why:** One helper + one enforcement point keeps the trail append-only by construction instead of by convention; the merge row closes the last Phase-3-mandated gap without reopening settled non-coverage decisions.
**Important Edge Cases:** Concurrent merges → one 200 + one 409, single row (loser observes soft-delete). Failed/forged merges throw before the write → zero rows. Idempotent retries converge on the business mutation, so no duplicate rows.

### DEC-034 — Frontend foundation: router, fetch+hooks, loop-proof session
**Status:** IMPLEMENTED
**Problem / Context:** The Checkpoint-1 client was a dark marketing scaffold with no router, no API layer, and one raw `/health` fetch. Domain screens need shared shell/tokens/primitives plus a session boundary that cannot loop on 401s.
**Decision:** `client/src` foundation: `react-router-dom` (sole runtime dep; nested `/app` hierarchy, `RequireAuth`); plain CSS variables (`styles/tokens.css`, light warm/off-white — no dark mode, no Tailwind); server state via hand-rolled `apiClient` (single-attempt, never retries) + `useApi` hook (no query library, per explicit decision). Access token in memory only, refresh on HttpOnly cookie. 401 orchestration in framework-free `auth/sessionManager.js`: `apiClient` never refreshes; one shared `refreshInFlight` promise (cleared in `finally`); `refreshFailed` latched until explicit login; bootstrap calls (`login/me/refresh`) and flagged replays go straight to unauthenticated — replay exactly once per caller, replay-401 never refreshes. Permission boundary (`can(resource,action)` + `PermissionGate`) is UX-only and visible-by-default until the backend emits a session permission list; never gate on role names. Only `/app/dashboard` is real (labeled mock data); all other routes are explicit placeholders — no fake domain data.
**Rules:** No new client deps without a checkpoint-level reason. No tokens in storage. No retry/refresh inside `apiClient`. No role-name checks in UI code. No domain business logic in foundation components.
**Why:** One refresh site + typed single-attempt fetch makes redirect/refresh loops structurally impossible (proven by 6 exact-count tests); visible-by-default gates keep nav working before the permissions contract lands.
**Important Edge Cases:** Triple-concurrent 401s share one refresh with per-caller replays (1 refresh / 6 data calls). Latch blocks all further refresh until login. Boot/login 401s never touch refresh. Logout is idempotent under concurrent handlers.
**Open items:** Login requires pasting an org UUID (org discovery is a future backend+frontend task); session permission list not yet emitted by `GET /auth/me`.

### DEC-035 — Frontend slice conventions + enquiry `unmatched` filter (17B)
**Status:** IMPLEMENTED
**Problem / Context:** The first domain slice needed list/detail/URL conventions that later screens will follow, and the unmatched-enquiry review queue had no server filter (`contactId: null` is not expressible through the existing exact-match filters).
**Decision:** (1) Backend: `GET /enquiries?unmatched=true|false` maps to `where.contactId = null | { not: null }` (validation + controller passthrough + service clause, ~10 lines, no migration). Narrowly scoped per the frontend-checkpoint backend-change rule; covered by backend tests. (2) Frontend: `useUrlListState` (search/page/declared filter keys ↔ URL, refresh-safe deep links); bare-array lists paginate offset-style with total-less `Pagination` (`hasMore = rows.length === limit`); flat rows resolve names via bounded per-page `RelatedName` batching (no per-row hooks, no store); request endpoints resolve exclusively through the `KINDS[kind]` map (`buildRelatedRequests`, unit-tested — callers pass `{key, kind}` only, never raw endpoints); lead status UI offers only `validLeadTransitions` (frontend mirror of the backend map — both must change together); no `POST /leads` UI (intake-only creation preserved); merge UI selects IDs only, backend transaction stays authoritative; deal rows on contact/lead details are read-only text (no links until deal screens land).
**Rules:** Lists paginate server-side; filters must exist server-side (the `unmatched` addition is the model, not an exception); no client-side filtering of paged data except the search box where the backend supports `search`.
**Why:** URL state makes every list deep-linkable for free; the tiny backend filter keeps the review queue correct at any scale instead of scanning a truncated page client-side.

### DEC-036 — Reports are explicit read-only aggregates over existing records (17G)
**Status:** IMPLEMENTED
**Problem / Context:** Management needs pipeline/operations/money visibility, but the database keeps no transition history for most lifecycles (no `completedAt`/`paidAt`/stage-change clocks except Deal `audit_logs` + a few dedicated fields), and the repo has no chart infra, no reporting service, and no scope-aware read filtering anywhere.
**Decision:** `server/src/modules/reports/` (`{routes,controller,service,validation}.js`, mounted at `/reports`): ten explicit GET endpoints (deals, leads, visits, bookings, payments, tasks, activities, inventory, documents, contacts), each guarded by its domain's existing `:read` permission — no new permission, no seed change. Shared `?from=&to=` half-open `[from, to)` UTC range (400 on `from > to` / unparseable); snapshots (inventory, current mixes) ignore the range. Aggregation is `tenantPrisma.groupBy/count/aggregate` (tenancy fail-closed); data scopes stay unenforced exactly as on every other list endpoint. Source timestamps: `createdAt` everywhere except SiteVisit `scheduledAt`, Booking `bookedAt`/`cancelledAt`, Obligation `dueDate` (derived overdue) + SUCCESS `PaymentRecord.createdAt` (collected), Task `dueAt` (derived overdue), Document `reviewedAt`. No new indexes (existing org+status/stage composites suffice at V1 scale). Frontend `/app/reports` (replaces placeholder): Pipeline/Operations/Money&Docs tabs (URL `view`), date inputs (URL `from`/`to`, end day inclusive), `StatTile` KPIs + CSS distribution bars (no chart dep) + per-section loading/empty/error states. Client-side channel filtering is allowed only when labeled page-only (17F precedent).
**Rules:** No metric without a supporting field (deferred, never approximated): stage/lead velocity, time-to-pay, task completion duration, inventory turnover, consent-change rate, visit actual duration, doc queue aging, historical overdue transitions. No AuditLog range queries (no `action`/`createdAt` index). No dashboard in 17G (`/app/reports` is analytical, not the 17H dashboard).
**Why:** Ten small explicit endpoints keep every number traceable to one query; PostgreSQL aggregation is sufficient at V1 scale with zero new infrastructure.
**Implementation Notes:** 8 backend tests (`server/tests/reports.test.js`: aggregation, half-open boundaries, isolation, 401/403, empty, invalid filters); 11 frontend tests; no migration.

### DEC-037 — Dashboard is operational overview; authenticate-only; single endpoint
**Status:** IMPLEMENTED
**Problem / Context:** Management needs a quick "what needs attention" view separate from the analytical Reports surface.  Reports (DEC-036) cover broader analytics; Dashboard is operational.  A single endpoint avoids N independent fetches from the frontend.
**Decision:** `server/src/modules/dashboard/` (`{routes,controller,service}.js`, mounted at `/dashboard`): one `GET /dashboard` returning all operational KPIs, distributions, and short lists in one JSON response.  Authorization: `authenticate` only — no `authorize()` call, no new permission.  Reasoning: the endpoint aggregates 8+ domains; gating on any single domain's `:read` would 403 most users (e.g. an Agent with `task:read` but not `deal:read` sees nothing).  This is consistent with the reports precedent where data scopes (OWN/TEAM/PROJECT) are unenforced on every list endpoint.  Frontend `/app/dashboard` replaces the `PlaceholderPage`: KPI strip, Needs Attention cards, Pipeline/Inventory distributions (CSS bars, no chart library), Upcoming Visits + Recent Activity tables (RelatedName resolution).  Single `useApi('/dashboard')` call — no independent domain fetches.
**Rules:** Dashboard never bypasses tenant isolation (all queries via `tenantPrisma`).  `groupBy` requires explicit `deletedAt: null` — the tenant wrapper's auto-injection covers `count`/`findMany` but NOT `groupBy` (service-level filter).  Soft-deleted records excluded: Lead (`deletedAt`), Deal (`deletedAt`), Unit (`deletedAt`), Task (`deletedAt`).  Models without `deletedAt` (SiteVisit, Reservation, PaymentObligation, Activity) follow their lifecycle/status rules.  OVERDUE payments = `PENDING + past dueDate` (never `status: 'OVERDUE'`).  Expiring reservations = `ACTIVE ∧ expiresAt >= now ∧ expiresAt < now+7d` (upcoming only, not already-expired).  Data scopes OWN/TEAM/PROJECT are unenforced (explicit V1 limitation, same as every other list endpoint).
**Why:** One endpoint keeps the frontend simple; authenticate-only avoids inventing a new permission that every role would need; tenant wrapper's groupBy gap is documented to prevent future leaks.
**Important Edge Cases:** An empty org returns valid zero/empty structures (not an error).  0 overdue tasks is a successful state, not an error.  The 7-day expiring window excludes already-expired reservations (which remain visible in the reservation list but not as "expiring").
**Implementation Notes:** 13 backend tests (`server/tests/dashboard.test.js`: KPI counts, soft-delete exclusion, tenant isolation, auth, empty structures, overdue tasks/payments, expiring window, stage/availability grouping, activity/visit ordering+limit); 18 frontend source-contract tests; no migration.

### DEC-038 — Production hardening corrections (2026-09-20)
**Status:** IMPLEMENTED
**Problem / Context:** Read-only production audit found one deployment blocker (fresh DB migrate failure), one pre-money financial-auth gap (unsigned webhook), and a set of small fail-closed/concurrency/lifecycle defects. No new infrastructure, no scope expansion (OWN/TEAM/PROJECT enforcement, refresh-family revocation, Redis, structured logging stay DEFERRED).
**Decision:**
- **Migration repair:** `20260920105433` ALTERed `claimedAt` before `20260920120000` created it (fresh deploy failed; dev applied out of order so it was masked). `105433` is now a guarded no-op when the column is absent; new forward-only `20260920130000_outbox_claimedat_repair` converges any state with `IF NOT EXISTS` guards. Proven: fresh-DB deploy of all 19 migrations green + schema-valid; dev deploy no-op with data intact. Deviation note: `105433` was edited in place (single statement → guarded block) because the pair is self-contradictory — no appended migration can run before the failing one — and `migrate status` reports no drift.
- **Webhook HMAC (V1 generic boundary):** `PAYMENT_WEBHOOK_SECRET`, hex HMAC-SHA256 over raw bytes (`x-webhook-signature`, timing-safe, 401 pre-validation). Required at boot in prod; unsigned allowed only when unset (dev/test). Idempotency, tenant-from-row, and tx/lock behavior unchanged.
- **Lead conversion:** PATCH OPEN→CONVERTED removed (stranded leads, blocked real conversion); conversion only via `POST /deals` (DEC-024). `enquiryLead` lifecycle test updated to the new contract.
- **Fail-closed config:** prod refuses dev JWT (any `dev-` value, min 32 chars), missing `CORS_ORIGIN`/`DATABASE_URL`/`PAYMENT_WEBHOOK_SECRET`; client prod build throws without `VITE_API_URL` (CI provides an explicit build var).
- **Refresh CSRF:** cookie refresh in prod requires Origin/Referer matching `corsOrigin` (presence-only was spoofable); body tokens rejected in prod. Rate-limit keys are `req.ip`-only (XFF fallback removed, no `trust proxy` — single-instance topology documented).
- **Error fallback:** raw P2002→409 / P2025→404 centrally; service handlers keep precedence; no DB detail leaks.
- **Reports groupBy:** explicit `deletedAt: null` on deal/lead/task/contact/unit/project groupBys (wrapper gap, dashboard precedent). `leadsReport` keeps a separate lead-only filter — Enquiry has no `deletedAt`.
- **Idempotency:** Intake/Schedule dialogs use stable `useIdempotencyKey`; standalone `POST /tasks` is `TASK_CREATE`-keyed end to end.
- **Outbox lease:** resolve pins `{id, PROCESSING, claimedAt: myClaim}`; stale reclaim-path covered by test.
- **Validation bounds:** login password `.max(72)` (bcrypt truncation); refresh/logout tokens `.max(200)`; prod JWT min 32.
- **R2 `forcePathStyle`:** contradiction resolved as explicitly UNVERIFIED (no live bucket) — comments/docs softened, code untouched.
- **Resubmit UI:** `UploadDialog` accepts `documentId` (skips metadata create, runs upload-url→PUT→complete→submit); detail page opens it for the v2 row.
**Why:** Each item is the smallest change that closes a concrete, evidenced defect; anything needing new infrastructure or a redesigned contract was deferred, not half-built.
**Important Edge Cases:** Fresh vs dev vs partial DBs (repair covers all three); HMAC signs raw bytes, not re-serialized JSON; bcrypt cap is characters with a byte-truncation rationale; resubmit v2 statuses already permitted the file steps server-side.
**Implementation Notes:** New suites — `errorFallback`, `configFailClosed`, `rateLimiterKeys`, `refreshCsrf`, `reportsSoftDelete`, `webhookAuth`, `taskIdempotency`, `authBounds` (backend); `idempotencyKeys`, `resubmitFlow` (client). Extended: `enquiryLead` lifecycle, `workerOutbox` reclaim.
**Second pass (2026-09-21, verification + micro-fixes, no scope change):** all 15 first-pass items re-verified IMPLEMENTED in code; `migrate status` clean, fresh-DB deploy of all 19 migrations green with schema-matching end state (`claimedAt`, 4 enum values, 19 applied rows), dev DB healthy. Micro-fixes: payment amounts `.finite()` (Infinity passes `positive()` but breaks Decimal writes), explicit `express.json({limit:'100kb'})`, `refreshLimiter` on logout, RelatedName project → detail route, `busy` re-entry guards on verify/resubmit, VisitsPage UTC-midnight filters. Verified adequate as-is: rawPayload service cap, storage error messages, UX-only permission gates, mutation `retry` wiring, unmapped P2003.
**Intentionally deferred:** full data-scope enforcement, refresh-family revocation, Redis/distributed limits, structured logging, correlation IDs, generalized validation, broad DB optimization, minor UI cleanup.

### DEC-039 — Settings & administration (Checkpoint 18)
**Status:** IMPLEMENTED
**Problem / Context:** Admin configuration (teams, roles, lead sources, campaigns, assignment rules) lived in placeholder screens, and no production path existed to provision employee accounts — only `seed-dev` and tests created users, so a real Admin could never onboard staff.
**Decision:**
- **User directory + employee provisioning** (`server/src/modules/users/`, mounted at `/users` alongside the existing `/users/:userId/teams` route — shapes do not overlap). `GET /users?search&status&teamId&limit&offset` and `GET /users/:userId` expose safe fields only (`passwordHash` stripped in the service presenter; role name + team list included in one query, no N+1). `POST /users {name, email, password, roleId}` creates an ACTIVE employee with a bcrypt hash: the initial password is admin-set and must reach the employee out-of-band — no mail infrastructure exists in V1, so an invite-token flow is deferred, not half-built. Role must be a same-org role (`resolveRef`: cross-tenant → 403, missing → 404); duplicate email → 409. No PATCH status, no deactivate, no reassignment queue — lifecycle stays deferred.
- **Read-only roles matrix** (`server/src/modules/roles/`, `GET /roles` with permission+scope mapping, `GET /roles/permissions/catalogue` off the global table). No grant/revoke endpoints: the mapping stays backend configuration in V1 and the UI states that. Frontend gates remain UX-only; `GET /auth/me` still emits no permission list (emitting it would flip every gate's visibility contract — deferred as its own decision).
- **New permissions** (same `resource:action` convention, no new framework): `user:read`, `user:create`, `role:read` — seed-granted to Admin at ORGANIZATION scope. Teams/lead-sources/campaigns/rules reuse their existing permission sets; all routes carry `authenticate` + `authorize`.
- **Frontend** (`client/src/routes/settings/`): hub + Team (directory, teams, per-team members, employee dialog with optional immediate team add) + read-only Roles matrix (tabs per role, domain-grouped catalogue with scope badges) + LeadSources/Campaigns/AssignmentRules as `ProjectsPage`-pattern clones (list/create/edit/ConfirmDialog-delete; rules toggle `active` via PATCH; ROUND_ROBIN `{teamId}` picker; hard deletes orphan to NULL by existing design). New `GET /users/:userId` also closes the `KINDS.user` gap, so assignee names resolve app-wide. No TanStack Query, no store, no chart deps.
**Why:** Smallest backend surface that makes Admin self-sufficient (directory + create + reads); everything else reuses proven endpoints and UI patterns instead of inventing a user-management system or an RBAC editor.
**Important Edge Cases:** Mixed-case emails: the unique index is case-sensitive while login lowercases — pre-existing gap, untouched; provisioning lowercases at the boundary. `POST /users` retry-after-commit surfaces 409 (no `USER_CREATE` idempotency namespace — deliberate, mirrors deal-create semantics). Deleting a team keeps member accounts; deleting a source/campaign NULLs history links.
**Implementation Notes:** Backend suites `users.test.js` (auth/authz/isolation/validation/login-works/409/403) + `rolesRead.test.js` (matrix shape, scopes, isolation, catalogue order); client `settings.test.js` contracts + `relatedNames` user-kind case + `teamMemberName` unit. No schema change → no migration.
**Intentionally deferred:** grant/revoke endpoints, invite-token flow, activation/deactivation, session permission emission, `RoundRobinState` readout, data-scope enforcement.

### DEC-040 — Final UI/UX polish: Settings IA, Calendar, Reassignment
**Status:** IMPLEMENTED
**Problem / Context:** Individually-implemented pages felt like a collection, not a coherent CRM: Settings + 5 children were flat siblings (both `Settings` and active child highlighted via prefix `isActive`), `Assignment Rules` advertised as top-level despite being an admin implementation detail, lead reassignment required pasting a raw UUID with `AUTO` enum exposed, Team role not visually scannable, and agents had no visual schedule beyond list tables.
**Decision:**
- **Settings IA:** `Settings` is a **navigation parent / section label** (`client/src/routes/navConfig.js` `Admin → Settings {children:[Team, Roles & perms, Lead sources, Campaigns]}`), not a page. `AppShell` `Sidebar` renders parent as `sidebar__section-label` (text+icon, no `NavLink` active background) and children as `NavLink end` with `sidebar__link--child` indented and exact-match `isActive`; only the current child gets `--active`. `/app/settings` `Navigate to="settings/team" replace` (no hub page). `/app/settings/assignment-rules` remains routable (`App.jsx` hidden route) but not in `NAV_GROUPS`; backend `AssignmentRule` model/API/round-robin eval unchanged.
- **Lead reassignment:** `POST /leads/:id/reassign {assignedAgentId}` contract unchanged. UI replaces raw UUID `Input` with a searchable `AgentPicker` reusing `GET /users?search=&status=ACTIVE&limit=20` (`TeamPage:MemberPicker` pattern: `SearchInput min2 → useApi` filtered `!existing`), showing `name · email · teams` and `current` disabled, `Selected` state, `Cancel/Reassign` with `pending` guard. Assignee displays via `RelatedName kind=user` and `assignmentSource` maps `AUTO→Automatic, MANUAL→Manual, UNASSIGNED→Unassigned` (backend enums unchanged; also applied to `LeadsPage` `Source` column).
- **Calendar (internal, no external sync):** New route `GET /app/calendar` (`client/src/routes/calendar/CalendarPage.jsx` + `calendar.css`) mounted at `/app/calendar` and added to `Sales` near `Site Visits` (`navConfig.js`). Uses existing `GET /site-visits?from=&to=&limit=100` (primary) and `GET /tasks?limit=100` (filtered client-side to `OPEN` + `dueAt` in month) — no new model, no new index (existing `org+scheduledAt` / `org+dueAt` indexes suffice). Month grid (CSS Grid 7×6, native `Date` APIs, no lib) + selected-day `Agenda` (visits `scheduledAt·duration → RelatedName contact/project + StatusBadge`, tasks `dueAt → title + StatusBadge`, both `Link to /app/site-visits/:id` / `/app/tasks/:id`). Toolbar `Prev/Next`, `Today`, `monthLabel`; responsive `grid 1.6fr 1fr → 1fr @900px`, compressed cells `@640px`. Dashboard `Upcoming Site Visits` adds `View calendar →` (`DashboardPage.jsx`) alongside `View all site visits →`.
- **Team/Roles polish (truthful):** `TeamPage` remains `GET /users` directory (`search/status/teamId`) + `GET /teams` + `GET /teams/:id/members`; role stays `Badge tone neutral` (`StatusBadge` for `ACTIVE/ON_LEAVE/DEACTIVATED` already semantic), no fake per-role differences — `RolesPage` (`GET /roles` + `GET /roles/permissions/catalogue`, `Tabs` per role, `groupByResource` + `StatusBadge scope`) still reads backend truth (seed gives near-identical perms per `seed-qa.js` — intentional; UI does not pretend differences). Card/Table/FilterBar/Skeleton/Table-scroll consistencies preserved; control heights via tokens (`--space-2/3`, `btn --sm/--md`), `content-max-width 1200`, `section-stack gap --space-5`.
**Why:** Exact `end` matching removes ambiguous double-active; hidden `Assignment Rules` keeps admin detail from cluttering nav while preserving `ROUND_ROBIN` evaluation and `roundRobinState` locking; searchable `ACTIVE`-only picker prevents `400 Cannot assign to DEACTIVATED` and UUID exposure; internal calendar gives operational visibility without OAuth/recurring-engine cost.
**Alternatives considered:** `Settings` hub page with cards (rejected — duplicate nav), Redux/TanStack for calendar (rejected — `useApi` + URL state suffice), external `fullcalendar` lib (rejected — 7×6 grid 60 lines of `Date` suffices), new calendar backend model (rejected — `SiteVisit.scheduledAt/duration/project/contact` already authoritative).
**Trade-offs:** `Settings` hub file remains but unrouted (not deleted — backward compat); calendar has no drag-drop or agent filter in V1 (deferred); `Team` `Agent` role shows near-identical perms until seed intentionally diverges (truthful matrix).
**Authorization implications:** `lead:assign` gate preserved (`PermissionGate resource=lead action=assign`); `calendar` fetches via existing `siteVisit:read` / `task:read` (no new permission), tenant-scoped.
**Intentionally deferred:** grant/revoke UI, invite/deactivate flows, drag-drop, per-agent calendar filter, calendar backend model, `Assignment Rules` prominent nav.

### DEC-041 — Fresh-install Signup & Organization Onboarding
**Status:** IMPLEMENTED
**Problem / Context:** After QA consolidation the dev DB was empty after `migrate deploy`; there was no way to create the first organization without a seed, and `POST /auth/login` required `organizationId` (UUID paste) which is not a viable fresh-install UX. The repository must support `clone → create DB → migrate → open /signup → create org + Admin → enter CRM` from an empty database without a seed.
**Decision:**
- **New public endpoint** `POST /auth/signup {organizationName, name, email, password, confirmPassword}` (no `authenticate`, `loginLimiter 20/15m`, `zod` at boundary `organizationName 2-100, name 2-100, email 100, password 8-72, confirm 8-72 + `refine` match). Email lowercased+trimmed via `normalizeEmail`; password `8-72` matches `hashPassword` bcrypt truncation guard.
- **Atomic tenant bootstrap** `prisma.$transaction` (10s): `organization.create({name: trimmed})` (global `@unique` → `409` on duplicate) + `role.create({name:'Admin', organizationId})` (org-scoped `@@unique[org,name]`) + `rolePermission` for **all** global `Permission` rows (upserted outside tx for idempotency, then `create` inside) at `ORGANIZATION` scope + `user.create({name, email: normalized, passwordHash: hash, organizationId, roleId, status:'ACTIVE'})` (per-org `@@unique[org,email]` + global email pre-check `findFirst` outside tx and re-check `findFirst` inside tx to close `SELECT→INSERT` race → `409 Email already in use`). Hash `await hashPassword` **outside** tx to avoid holding DB lock during bcrypt. `P2002` on `organizations.name` or `users.email` maps to `409` via `httpError`, no raw Prisma leak.
- **Minimal RBAC init:** Only `Admin` role created for the new org (all perms `ORGANIZATION`). `FIXED_ROLES` 5 are vocabulary, not cardinality — `guard.js` never checks count, `RolesPage` renders whatever exists, `seed-dev.js` is `Admin`-only proof; other roles are created on demand later.
- **Auto-login:** `signup` reuses `login` token path — `signAccessToken({userId, organizationId})` + `generateRawRefreshToken` + `hashRefreshToken` + `createRefreshTokenRecord` + `setRefreshCookie` (same `HttpOnly secure sameSite` as login) → `201 {accessToken, user: safeUser, organization}` (+ `refreshToken` in `isTest`). Client `AuthContext.signup` (`bootstrap:true, withToken:false`) → `setToken` + `resetOnLogin` + `fetchMe` → `navigate('/app/dashboard')`.
- **Login contract simplified:** `POST /auth/login {email, password}` (removed `organizationId`). Service `findUsersByEmail` (`prisma.user.findMany` case-insensitive, `deletedAt:null`) → `0→401`, `>1→401 Multiple accounts found — contact support`, `1→` verify `Organization` exists + `DEACTIVATED` →401 + `verifyPassword` → tokens. Global email uniqueness enforced at `signup` (pre+inside tx) so `>1` is edge-case for legacy duplicate data.
- **Security:** Same `helmet`, `loginLimiter`, `express.json({limit:'100kb'})`, `validate` flatten, no `console.log` of passwords/tokens, `500` never leaks `P2002` raw.
**Why:** One atomic `BEGIN→validate→hash→upsert perms→tx org/role/perms/user→COMMIT` guarantees no stray org without Admin; reusing existing `bcrypt/JWT/refresh/tenant` keeps single auth system.
**Alternatives considered:** Keep `organizationId` on login (rejected — fresh user would need to paste UUID, violates “Clone→Signup→CRM”); create all 5 roles per org on signup (rejected — not required, `Admin`-only is minimal and matches `seed-dev`); generic `POST /organizations` + `POST /users` two-step (rejected — not atomic, could strand org).
**Trade-offs:** Cross-org email reuse now blocked at `signup` (global check, not DB constraint) to make `email`-only login unambiguous; `P2002` on `org name` still relies on DB `@@unique`.
**Authorization implications:** New org’s `Admin` gets `ORGANIZATION` scope `authorize(resource,action)` passes immediately; tenant isolation `createTenantPrisma` still injects `organizationId` from JWT.
**Intentionally deferred:** email verification, password reset, org join/switch, SSO/MFA, billing, `Team` bootstrap (no default team on signup).

### DEC-042 — Organization-Scoped Role Creation & Permission Assignment
**Status:** IMPLEMENTED
**Problem / Context:** Fresh orgs from `POST /auth/signup` received only the `Admin` role; `GET /roles` could display it, but there was no way to create additional roles (e.g. `Sales Agent`) — the matrix was read-only (`DEC-039`). QA orgs had multiple roles only because seeds created them (`FIXED_ROLES` loop). The product needs `Signup → Admin → Settings → Roles & Permissions → Create Role → assign perms/scopes → new role usable for users` without automatically creating all five fixed roles.
**Decision:**
- **Endpoints (permission-gated, not role-name-gated):** `POST /roles {name, permissions:[{permissionId, scope}]}` → `authorize('role','create')` and `PUT /roles/:roleId/permissions {permissions:[...]}` → `authorize('role','update')`. Both `authenticate` first. `name` trimmed `2-100`, `permissions` optional (create) / required (replace) array `max 200`, each `permissionId uuid, scope OWN|TEAM|PROJECT|ORGANIZATION`, duplicate `permissionId:scope` → `400`. Custom names allowed (not restricted to `FIXED_ROLES` — seed vocabulary only, runtime `guard.js` never checks `FIXED_ROLES`). `organizationId` never accepted from body — tenant comes from `req.auth.organizationId` via `createTenantPrisma`.
- **Atomic:** `prisma.$transaction` (10s) — `role.create({name})` + `rolePermission.create` per validated item; `PUT` does `deleteMany where roleId` then `create` new set. Any `P2002` (duplicate `@@unique[org,name]`) → `409 Role name already exists`, invalid `permissionId` → `400 Permission not found` (checked against global `permission` table), invalid `scope` → `400` via `zod`, duplicate `permissionId:scope` → `400`. No partial role left behind.
- **Tenant isolation:** `Role` and `RolePermission` are tenant-scoped (`wrapModel` injects `organizationId`, `GUARDS_CREATE` checks `role.organizationId===tenant`), `Permission` global. `GET /roles` and `PUT /roles/:id` use `tenantPrisma` — cross-tenant `id` hides as `404` (same as `GET /roles/:id` convention). `Permission` being global does not make `RolePermission` global.
- **Bootstrap:** `BOOTSTRAP_PERMISSIONS` now includes `role:create` + `role:update` (global upsert) and `seed-dev/qa/dev-qa` grant them to `Admin` at `ORGANIZATION`. New orgs via `signup` get `Admin` with all perms including the two new ones; existing orgs gain them on next seed re-run (upsert).
- **Frontend:** `RolesPage.jsx` `PageHeader` `Create role` (`PermissionGate role:create`) + `Manage permissions` per role (`role:update`), both dialogs reuse `GET /roles/permissions/catalogue` grouped by `resource` (collapsible per-resource checkboxes + per-checked `Select` scope default `ORGANIZATION`), scrollable `maxHeight 320/360`, `pending` guard + `ErrorState` + `Toast` + `retry()`. `Tabs` show `name (count)`, no hardcoded 5-role list.
- **User assignment:** `POST /users {roleId}` already validates `roleId` same-org via `resolveRef` (`tenantPrisma` 404 vs raw 403, `P2002→409` dup email). New custom `roleId` works normally; `hasPermission`/`authorize` resolves via `rolePermission` DB, not name.
- **Protection:** No `role:delete`/rename-transaction, no self-lockout guard — `PUT` is uniform for any role including `Admin`; stripping `Admin`'s own `role:create/update` is allowed and documented as deliberate limitation (no recovery system).
**Why:** `POST + PUT replace` covers create and fix-misclick without parallel APIs; `Admin`-only gate keeps `ORGANIZATION` authorization (no `if role==='Admin'`); custom names keep DB as source of truth while `FIXED_ROLES` stays vocabulary for seeds only.
**Alternatives considered:** Auto-create all 5 roles on signup (rejected — violates Q3 “Admin bootstrap unchanged”); keep read-only matrix (rejected — leaves “no way to create additional roles”); per-user overrides / JSON perms (rejected — second system).
**Trade-offs:** `PUT` is full replace, not patch — client must send complete set; `Admin` can self-strip and lock out (documented); no `organizationId` in body means join arbitrary org impossible.
**Security implications:** `role:create/update` at `ORGANIZATION` scope; `tenantPrisma` ensures `role.organizationId` cannot be spoofed; `P2002` never leaks raw SQL.
**Intentionally deferred:** `role:delete`, rename, hierarchy, per-user overrides, `Team` auto-bootstrap.

## 9. Assignment Architecture

```
AssignmentRule
    |
    +-- type    (V1: ROUND_ROBIN only)
    +-- order   (lowest-first evaluation; quoted "order" column — quote it in raw SQL)
    +-- config  (parameters only, e.g. { teamId }; never logic)
    +-- active  (toggle without deleting)
```

**Current V1 implementation:** `ROUND_ROBIN` + manual reassignment (`POST /leads/:id/reassign`).
**Deferred rule types:** `PROJECT_AFFINITY`, `TERRITORY`, `MANUAL_OVERRIDE_CHECK` — each arrives as a new row type plus a new small function inside `evaluateAssignment()`. Do not implement them unless the task explicitly promotes one.

**Manual reassignment ≠ MANUAL_OVERRIDE_CHECK.** The former is an explicit user action recording `assignmentSource=MANUAL`. The latter is a future *automatic* rule step (e.g., "respect a pre-set preferred agent before other rules"). Conflating them breaks the audit meaning of `assignmentSource`.

**RoundRobinState:** one row per team (`teamId` unique, Cascades with team). `lastAssignedUserId` (no FK — deactivation/deletion of a user must never block the counter row), `lastIndex` (position in the id-sorted ACTIVE-member list at assignment time). Counter row is `SELECT … FOR UPDATE` locked inside the Lead-creation transaction; deactivated/`ON_LEAVE`/deleted users are excluded live (never cached); empty eligibility → `UNASSIGNED` with null agent/assignedAt, surfaced to management views later.

## 10. Enquiry → Contact → Lead Flow

```
Capture (any of 4 channels → one intake shape)
    v
Validate references (source/campaign/project: same-org, non-deleted)
    v
Resolve Contact (Checkpoint 5 matching; unmatched → contactId null, preserved)
    v
Create/link Requirement where appropriate (Contact-owned; link only if Lead has none)
    v
Create Enquiry
    v
Link existing OPEN Lead OR create Lead (partial-index protected)
    v
Assignment (new Leads only; never re-run over assigned Leads)
    v
Link Enquiry to Lead (linkedLeadId)
    v
Persist idempotency result (if key supplied)
```

- **Channels:** `PORTAL`, `WALK_IN`, `PHONE`, `OWNED_FORM`. One service function (`intakeEnquiry`); adapters translate provider payloads *before* the transaction — no network calls inside it (rawPayload capped at 20KB).
- **Unmatched enquiries:** missing phone+email (after normalization) → enquiry stored with `contactId null`, no Lead, `_unmatchedReason` in payload — visible for a future queue UI, never dropped, never 4xx merely for being unmatchable.
- **Contact matching:** STRONG (both signals) reuses; single-signal creates + flags PENDING duplicates; name required when identity present.
- **Repeat enquiries:** same Contact+Project+OPEN Lead → attach, origin kept, no reassignment, no requirement overwrite.
- **Uniqueness:** project-scoped via partial index; project-less always creates (DEC-010).
- **Transaction boundary:** the whole chain above is one `$transaction` (15s timeout); contact-row lock serializes same-contact decisions.
- **Idempotency / assignment:** §5.5 / §9.
- The Enquiries list shows **individual intake events** — several rows may point at one Lead. Attaching is linking, not merging or deleting.

## 11. Concurrency & Consistency Patterns — DO NOT BREAK THESE INVARIANTS

### Same-contact intake
Contact-row `FOR UPDATE` serializes Lead link-or-create per Contact. Removing the lock reopens the duplicate-Lead race the partial index then only punishes (409s) instead of preventing.

### Duplicate OPEN project-specific Leads
Partial unique index `leads_open_contact_project_key` is the guarantee; the `findOpenLeadForUpdate` select is just the fast path. If a 409 appears here, the invariant worked — investigate the caller, never drop the index.

### Round robin
`RoundRobinState` locked before advancing. Without the lock, concurrent creations read the same `lastIndex` and assign the same agent twice while skipping another.

### Idempotency race
Unique `(org, key, operationType)` elects exactly one committed winner. The loser must resolve to **replay** (same hash → stored snapshot, HTTP 200) or **conflict** (different hash → 409). Any third outcome (e.g., creating side effects anyway) is a correctness bug.

### Transaction-context tenant guards
Guards bound to `rawTx` see uncommitted rows; guards bound to the global client do not and will falsely reject legitimate in-transaction writes. Any new tenant-scoped write path inside a transaction must use the tx-bound wrapper.

### Site-visit slot lock order
Schedule and reschedule both lock the agent `users` row first, then the project `projects` row, then (reschedule only) the visit row. Same global order from every entry point means concurrent schedulings can wait on each other but never deadlock in a cycle. Do not add a third lockable resource or reorder without re-proving acyclicity.

### Reservation unit lock order
Create, release, and each expiry candidate lock exactly one row — the target `units` row `FOR UPDATE` — then re-read reservation state while holding it. Booking create/cancel reuse the same single-lock shape (lock Unit → re-read Reservation/Booking under lock). Single-lock transactions cannot deadlock in a cycle; the lock + re-check is the enforcement, the pre-lock read is only a fast-path courtesy. Never mutate `availabilityStatus`, `Reservation.status`, or Booking rows outside this lock; never blind-set AVAILABLE without verifying the expected holder state.

Each pattern exists because application-only checks (`if (!x) create x`) fail under interleaving — the lock/constraint is the enforcement, the code check is the courtesy fast path.

## 12. API / Backend Conventions

- **Module layout:** `server/src/modules/<domain>/{routes,controller,service,validation}.js` — routes declare `authenticate` + `authorize(resource, action)`; controllers do zod validation + status codes + response shape; services hold all business logic and throw `err.statusCode`-carrying errors; `validation.js` owns every zod schema plus a shared `validate()` (400 + details).
- **Tenant wrapper:** all business data access via `req.tenantPrisma`; `tenantPrisma.$transaction(async (tx) => …)` for multi-write flows; `tx._raw` ONLY for classified re-checks and `FOR UPDATE` locks (each use needs a comment justifying it).
- **Error semantics:** 401 unauthenticated/expired/deactivated; 403 guard violation or confirmed cross-tenant write; 404 unknown id OR cross-tenant/deleted read (hide existence); 400 validation, bad transition, soft-deleted write, direct-mutation attempts; 409 uniqueness/idempotency-hash conflicts. Envelope: `{ error: { message, status } }` (+ stack off-prod).
- **Validation:** zod at the boundary before any service logic; coerce query numerics; unknown-keys policy: immutable/system fields checked against the raw body for precise 400s (see unit/projectId, lead/assignedAgentId pattern).
- **Pagination/filtering:** `limit` (default 20, cap 100) + `offset` + whitelisted exact-match filters and `contains+insensitive` search. Cursor pagination is Phase 2 guidance for large lists — NOT yet adopted; prefer it for new high-volume list endpoints.
- **Direct mutation restrictions (do not bypass):** no `POST /leads`; no `availabilityStatus` or `Unit.projectId` writes; no assignment via `PATCH /leads`; no auto-merge of duplicates; no generic `PATCH /site-visits` (status/slot move only via dedicated ops); no generic `PATCH /reservations` (status/type/unitId/dealId immutable — ACTIVE moves only via release/expiry/Booking); no `PATCH/PUT/DELETE /bookings` (finalized rows mutate only via dedicated cancel); no `PATCH/PUT/DELETE` on any payment row (obligations flip PAID only via webhook; records correct only via new row + `correctsRecordId`); no `PATCH/PUT/DELETE /documents` (drafts advance via complete/submit, review via verify/reject, history via resubmit row); no `PATCH/PUT/DELETE /activities` (immutable log); no generic task PATCH (OPEN→DONE via dedicated complete only).
- **Endpoint naming:** plural kebab resources (`/enquiries`, `/leads`, `/lead-sources`, `/campaigns`, `/assignment-rules`, `/projects`, `/units`, `/contacts`, `/requirements`, `/teams`, `/organizations`, `/deals`, `/site-visits`, `/reservations`, `/bookings`, `/payment-plans`, `/payment-obligations`, `/payment-records`, `/webhooks/payment-gateway`, `/documents`, `/activities`, `/tasks`); actions as subpaths (`/:id/reassign`, `/:id/merge`, `/:projectId/units`, `/:id/stage-transition`, `/:id/confirm|cancel|complete|no-show|reschedule`, `/:id/release`, `/:id/cancel`, `/:id/verify|reject|submit|complete|resubmit`, `/:id/upload-url|access-url`, `/tasks/:id/complete`).

## 13. Testing Philosophy

Strong tests are required for: tenant isolation, authorization matrix, transactions, concurrent requests, idempotency (replay + conflict + races), state transitions (valid and invalid), uniqueness (including reopen conflicts), soft-delete read/write behavior, cross-organization attacks, external failure boundaries (malformed payloads preserved, not dropped), assignment (order, concurrency, deactivation, manual-wins), contact matching tiers, repeat-enquiry attach-vs-create.

Snapshot (not a requirement): **460 tests / 18 suites** — auth 61, tenantIsolation 50, contactsRequirements 56, enquiryLead 34, organizationsTeams 33, reservations 32, siteVisits 29, propertyHierarchy 28, bookings 21, documents 25, payments 17, workerOutbox 18, activitiesTasks 14, dealsPipeline 20, auditTrail 10, storage 7, refreshConcurrency 3, health 2. Client: 30 vitest tests (+ documents review/overdue/upload-label rules). Concurrency-sensitive tests are re-run multiple times before sign-off. Never weaken an existing test to make a new feature pass.

## 14. Implementation Status

| Checkpoint | Area | Status | Important Notes |
|---|---|---|---|
| 1 | Project init | COMPLETE | Monorepo, client shell, health, CI, docs |
| 2 | DB + tenant scoping | COMPLETE | Fail-closed wrapper + leak tests |
| 3 | Auth + AuthZ | COMPLETE | JWT, refresh rotation w/ row-lock, RBAC guard, rate limits |
| 4 | Organizations + Teams | COMPLETE | Tenant-safe CRUD, soft-delete, M:M membership |
| 5 | Contact + Requirement | COMPLETE | Tiered dedup, PossibleDuplicate queue, manual merge |
| 6 | Property hierarchy | COMPLETE | Project/Unit, Restrict FK, immutable project link |
| 7 | Enquiry + Lead foundation | COMPLETE | See below; implemented + validated |
| 8 | Deal + pipeline | COMPLETE | Fixed 10-value enum, map-validated transitions, shared audit_logs, auto-convert; 20 integration tests |
| 9 | Site visit | COMPLETE | Agent + Project resources, 60/15 defaults, lock + re-check, idempotent schedule, dedicated lifecycle/reschedule ops; 29 integration tests |
| 10 | Reservation & Unit Hold | COMPLETE | One-row RESERVATION/HOLD discriminator, dealId required (V1), Unit FOR UPDATE + re-check, idempotent create, dedicated release, named expiry worker; 32 integration tests |
| 11 | Booking | COMPLETE | ACTIVE RESERVATION→CONVERTED + Unit RESERVED→BOOKED in one tx, reservationId required + unique, idempotent create, dedicated cancel; 21 integration tests |
| 12 | Payments | COMPLETE | Deal-specific plans, derived OVERDUE, correction-only records, idempotent provider-neutral webhook; 17 integration tests |
| 13 | Documents | COMPLETE | Row-per-version lifecycle, SigV4 storage boundary, role-gated verify/reject with audit, idempotent resubmit; 20 integration tests |
| 14 | Activity & Task | COMPLETE | Immutable activity log, OPEN/DONE tasks with derived OVERDUE, atomic explicit follow-ups, dedicated complete; 14 integration tests; uncommitted on `dev` at time of writing |
| 15 | Background jobs & outbox | COMPLETE | OutboxEvent + SKIP LOCKED processor, named scheduler (expiry + outbox), notification lanes with dispatch-time consent, heartbeat health; 15 integration tests; uncommitted on `dev` at time of writing |
| 16 | Audit trail consolidation | COMPLETE | Shared writeAudit helper, contact.merge coverage, append-only enforcement; specified set only, no read API, no worker rows; 8 integration tests |
| 17+ | Frontend, dashboards, observability | IN PROGRESS (17H slice) | Full intake-to-reports chain screens; dashboard implemented (17H); settings pending |

Checkpoint 7 verified status: intake pipeline; Checkpoint-5 matching reuse (no second implementation); Lead foundation (no manual create); ROUND_ROBIN (+deterministic, concurrent-safe) and manual reassignment; IdempotencyKey table + replay/conflict/race semantics; partial-index + row-lock concurrency protection; 33 integration tests; project-less enquiries open separate Leads; Activity integration deferred (no Activity table yet); PROJECT_AFFINITY/TERRITORY/MANUAL_OVERRIDE_CHECK deferred.

Checkpoint 8 verified status: Deal creation from OPEN Lead only (contact derived, never client-supplied; unitId optional, availability untouched); Lead auto-converts in the same transaction (resolves O-1); fixed pipeline with literal transition map + dedicated endpoint + `fromStage` concurrency check; CLOSED_LOST requires trimmed reason, terminals have no exits, forward moves clear the reason; `deal.create` + `deal.stage_transition` audit rows in-transaction (no `lead.converted` entry — Phase 3 does not require it); PATCH limited to unit attach-once; soft-delete consistent with Leads; 20 integration tests; no SiteVisit/Reservation/Booking/Payment/Document/Activity/RERA leakage.

Checkpoint 9 verified status: Agent + Project resource model (no per-Unit scheduling, Unit rows untouched); 60-min default with 15–480 per-visit override, 15-min agent-only buffer; SCHEDULED/CONFIRMED block, histories never do; contact overlap is preference-only; deterministic agent→project `FOR UPDATE` lock order + in-lock re-check; `SITE_VISIT_CREATE` idempotency incl. post-hoc replay on slot-conflict races; lifecycle map + cancel triple + in-place reschedule via dedicated ops (no generic PATCH, no `deletedAt`, no audit rows per spec); 29 integration tests incl. 3 real concurrent double-book races; no Reservation/Booking/Payment/Document/Activity/Task/Notification/RERA leakage.

Checkpoint 10 verified status: One-row RESERVATION/HOLD discriminator (no UnitHold table); `dealId` required in V1 per Phase 3 (management Deal-less holds deferred, see DEC-026); AVAILABLE→RESERVED / AVAILABLE→ON_HOLD creation with Unit `FOR UPDATE` + in-lock re-check; unit-less Deal bound in-transaction (attach-once preserved); `RESERVATION_CREATE`/`HOLD_CREATE` idempotency incl. post-hoc replay; ACTIVE→RELEASED dedicated release + ACTIVE→EXPIRED named worker (`expireDueReservations`, per-candidate tx, conditional AVAILABLE, re-run/stale safe); no generic PATCH, no `deletedAt`, no audit/outbox rows per spec; 32 integration tests incl. 4 real concurrent claim races + release/expiry race; no Payment/Document/Activity/Task/Notification/RERA leakage.

Checkpoint 11 verified status: `Booking(unitId, dealId, reservationId! @unique, bookedAt server-set, cancel triple)` — no status enum, no `deletedAt`; create converts ACTIVE type=RESERVATION only (HOLD rejects 400) via Unit `FOR UPDATE` + in-lock re-check (Booking insert + RESERVED→BOOKED + ACTIVE→CONVERTED + `BOOKING_CREATE` idempotency in one tx); no `Deal.stage` move (agent uses existing transition op); no audit/outbox rows per spec; cancel preserves row (actor + trimmed reason + timestamp), frees BOOKED→AVAILABLE, keeps CONVERTED, double-cancel 400; no PATCH/PUT/DELETE; 21 integration tests incl. 3 concurrent booking races; no Payment/Document/Activity/Task/Notification/RERA leakage.

Checkpoint 12 verified status: `PaymentPlan(dealId! @unique)` + `PaymentObligation(plan, dueAmount, dueDate, PENDING/PAID stored)` + `PaymentRecord(obligation, amount, PENDING/SUCCESS/FAILED, gatewayReference?, correctsRecordId? @unique self-FK)` — no `deletedAt`; explicit idempotent `POST /payment-plans {bookingId, obligations[]}` (deal-specific schedule, unique(dealId) backstop, booking/deal state untouched); provider-neutral unauthenticated `POST /webhooks/payment-gateway` (eventId = `PAYMENT_WEBHOOK` key, tenant from obligation row, obligation `FOR UPDATE` + re-read, record + SUCCESS→PAID in one tx, already-PAID + SUCCESS → 409); OVERDUE derived at read, never written; corrections via new row + `correctsRecordId` (same-obligation enforced); no `Deal.stage`/Booking/Unit writes, no audit/outbox rows per spec, no PATCH/DELETE; 17 integration tests incl. concurrent duplicate deliveries; no Document/Activity/Task/Notification/RERA/refund/ledger leakage.

Checkpoint 13 verified status: `Document(groupId, version, supersedesId? @unique, contactId, dealId?, free-form type ≤50, 6-state lifecycle, server-derived storageKey, reviewer triple)` — no `deletedAt`, no DELETE endpoint; agent flow create → upload-url (rate-limited) → complete → submit, review via verify/reject (grants only, actor/timestamp server-set, trimmed reason, audit row in-tx); resubmit inserts vN+1 as RESUBMITTED sharing group/type/links (lock latest row → require REJECTED + latest → insert + `DOCUMENT_RESUBMIT` key); `supersedesId @unique` + live-group partial index `(org, groupId) WHERE SUBMITTED/UNDER_REVIEW/RESUBMITTED` backstop races as P2002 → 409; storage is SigV4 presigning via stdlib crypto (env-only, 24h URLs, unconfigured → 503, fake in tests); 20 integration tests incl. concurrent resubmits + raw P2002 backstop proofs; no Activity/Task/Notification/RERA/OCR/AI/customer-auth leakage.

Checkpoint 14 verified status: `Activity(contactId, leadId?, dealId?, free-form type/outcome, notes Text, createdBy server-derived)` immutable (no PATCH/DELETE) + `Task(assignedTo, relatedContactId?, relatedDealId?, title, dueAt, OPEN/DONE stored, deletedAt retention-only)`; explicit `followUpTask` created atomically in the same tx (`ACTIVITY_CREATE`-keyed); no outcome sniffing, no auto-completion, no rules engine; OVERDUE derived at read + list filter, never stored; DONE terminal (lock → re-check → mutate, repeat/race → 409); contact merge now also reassigns Activity + Document rows whole (task reference links untouched like deal/visit links); 14 integration tests incl. rollback + concurrent completes; no Voice/Journeys/messaging/rules-engine/workload/territory leakage.

Checkpoint 15 verified status: `OutboxEvent(org, eventType string, payload Json, PENDING/PROCESSED/FAILED, attempts, availableAt, processedAt?, failedAt?, lastError?)` + global `WorkerHeartbeat(id, lastBeatAt, detail)` (system-owned, raw-Prisma bypass documented); `enqueueOutbox(tx, …)` same-tx rule; atomic claim (`UPDATE … FOR UPDATE SKIP LOCKED`, attempts pre-incremented) → dispatch outside locks via named handler → PROCESSED only after success; retry `min(30s·2^(attempts-1), 1h)` to 10 attempts then FAILED with reason (all env-overridable); expiry sweep reuses `expireDueReservations` unchanged on 60s cadence (no expiry events — no real side effect); notification lanes with provider interface + log default, stable event-id keys, customer consent re-read at dispatch (OPTED_OUT → PROCESSED-suppressed), internal skips gate; scheduler with overlap guards + heartbeat, `node src/worker.js` with graceful stop; `/health` extended (db + worker live/stale/never, old assertions intact); 15 integration tests incl. commit/rollback pairing, crash-window retry, concurrent claim split, tenant forgery; no Redis/queues/services/voice/AI/provider-integration leakage.

## 15. Deferred vs Out of Scope

### Deferred (planned later, shapes preserved for)

- `PROJECT_AFFINITY`, `TERRITORY`, `MANUAL_OVERRIDE_CHECK` assignment types
- Activity logging on repeat-enquiry attach (needs Activity infra)
- RERA guardrails: pre-agreement cap, project registration status gate, EOI type — re-enter as **additive** guards on payment-plan/booking flows, no V1 reshaping needed
- ChannelPartner attribution-only entity (calculation explicitly later)
- Customer self-service site-visit confirm/cancel; per-state rule tables; escrow/TDS automation
- Sharding by `organizationId` (schema discipline already in place)
- Dashboards, reports, notification lanes, consent-gated sends, full-text search upgrades

### Out of Scope (do not build)

- Any dependency on Vynexa proprietary AI voice/communication infrastructure
- Generalized workflow / rules / automation engines
- Microservices, service mesh, API gateway
- Elasticsearch/Redis/distributed infra for correctness
- Enterprise fuzzy/ML identity resolution
- Custom observability stacks (use managed tooling)

## 16. Open Decisions

**O-1 — RESOLVED by DEC-024 (Checkpoint 8):** conversion happens implicitly on Deal creation (`OPEN → CONVERTED` in-transaction). Manual `PATCH` to CONVERTED remains possible. Whether a converted-then-lost Deal can reopen its Lead is still undecided — no reopening path exists; needs an explicit future decision, not silent invention.
**O-2 — Dead or future `lead:create` permission?** Tests seed a `lead:create` permission but no route uses it. Decide in Checkpoint 8: either wire a pipeline-routed manual intake that reuses `intakeEnquiry`, or remove the seed. Do not add a bare `POST /leads`.
**O-3 — Cursor pagination default.** Phase 2 prescribes cursor-first for large lists; current endpoints use limit/offset. Decide per-endpoint at next list-endpoint work; leads/activities are the priority candidates.

## 17. Agent Operating Rules

1. Read this document before touching architecture or backend behavior; then the relevant Phase 3 section.
2. Treat ACCEPTED and IMPLEMENTED as constraints — flag conflicts instead of silently rerouting.
3. Reuse existing patterns (`tenantPrisma`, guard, zod-at-boundary, service-layer calls); no parallel abstractions.
4. Preserve tenant isolation, authorization boundaries, transaction boundaries.
5. Never remove a lock, partial/unique index, or idempotency check without proving the invariant holds otherwise.
6. Never implement DEFERRED items unless the task explicitly promotes them; never invent fields/entities/rules.
7. Stay production-oriented but speculation-free.
8. Test invariants and attacks, not just happy paths; re-run concurrency tests.
9. After implementing: run tests + lint + build + `prisma validate/generate` (+ `migrate status` if schema changed).
10. Do not commit, push, merge, or touch git config unless the developer explicitly instructs it.

## 18. Maintaining This Document

**MUST update in the same task when it:** adds/changes an architectural or business decision, entity relationship, tenancy/auth/transaction/concurrency/idempotency behavior, or backend convention; resolves an OPEN item; defers or drops planned functionality; completes a checkpoint.
**SHOULD NOT update for:** pure bug fixes, cosmetic UI, behavior-preserving refactors, test-only changes, trivia.
**How:** edit the relevant section in place (no duplicates); mark superseded decisions as superseded with the new decision recorded; keep ACCEPTED/IMPLEMENTED/DEFERRED/OPEN labels accurate; keep it scannable (tables, bullets, short records); verify claims against code + Phase 3; never use it to invent requirements.

## 19. Quick Reference — If You Only Read One Section

**Stack:** JavaScript + React + Node/Express + PostgreSQL + Prisma.
**Architecture:** Modular monolith + organization-based multi-tenancy.
**Core principles:** Postgres is the source of truth. Tenancy is mandatory and fail-closed. Permissions/scopes, never role-name checks. Transactions guard multi-record flows. Constraints + row locks guard concurrency. Idempotency lives in a tenant-safe table. Activity = happened; Task = to-do; Enquiry = intake event; Lead = opportunity. Project repeats may reuse an OPEN Lead; project-less enquiries never auto-reuse. No bypassing auth/tenancy/transactions/idempotency. No speculative infra. No deferred features without a decision.
**Current checkpoint:** Fresh-install Signup (`POST /auth/signup` atomic org+Admin, `POST /auth/login {email,password}`) implemented and validated; empty DB → `migrate deploy` → `/signup` is the normal onboarding (seed optional).
**Signup conventions:** `POST /auth/signup {organizationName, name, email, password, confirmPassword}` validates `2-100/2-100/email/8-72` + `refine` match, lowercases email, global email uniqueness pre+inside `prisma.$transaction` (org+Admin role+all `ORGANIZATION` perms+user), `P2002→409`, auto-login `201 {accessToken, user, organization}` + `HttpOnly refreshToken` via `setRefreshCookie` reusing login token path; `POST /auth/login {email,password}` finds user globally (0→401, >1→401 multiple, 1→password+org check) — no `organizationId` in V1.
**17H conventions:** `GET /dashboard` returns operational overview in one JSON response; authenticate-only (no new permission); tenant isolation via `tenantPrisma`; explicit `deletedAt: null` required on `groupBy` queries (wrapper gap); overdue payments = PENDING + past dueDate; expiring reservations = ACTIVE + [now, now+7d); data scopes OWN/TEAM/PROJECT unenforced (V1 limitation); CSS distribution bars (local, not shared with Reports); RelatedName for entity resolution in tables.
**17G conventions:** ten explicit read-only report endpoints under `/reports`, each on its domain `:read` permission; half-open `[from, to)` UTC ranges (end day inclusive in UI); snapshots ignore the range; CSS distribution bars, no chart dependency; deferred-not-approximated metrics listed in DEC-036.
**17F conventions:** communication is a contact-scoped frontend view over `GET /activities?contactId=` — no Communication entity, no migration, no providers; direction is convention-encoded (`INBOUND_`/`OUTBOUND_` outcome prefix, outcome-prefix-only rule, neutral otherwise); channel filter is client-side over the loaded page; logging reuses LogActivityDialog (contact prefilled, idempotent); consent is informational only; tasks are linked, never embedded or completed.
**17E conventions:** R2 SDK boundary with fake-injection preserved (`setStorageProvider`); upload is a five-step dialog (metadata → URL → PUT → complete → submit) reporting only confirmed completion; access URLs are fetch-on-click bearer tokens; activity/task duality enforced in UI (no auto-complete, no edit affordances on activities).
**17D conventions:** idempotency key per dialog mount (`useIdempotencyKey`, stable across retries of one submission); booking conversion and availability are single-server-operation submissions with confirm steps — the UI never mutates unit/reservation state; booking has no status enum (cancelled = cancel triple); overdue is display-only derived state; payment records are read-only (webhook-owned).
**17C conventions:** workflow-mirror libs (`dealWorkflow`, `visitWorkflow`, following the `leadWorkflow` pattern — frontend transition maps must change with the backend maps); unit availability is display-only (backend rejects direct writes); pipeline is click-to-detail with valid-only transitions, no drag-and-drop; visit slots use `datetime-local` via `to/fromInputValue`; `deal` added to RelatedName KINDS.
**Fresh install:** Empty DB → `npx prisma migrate deploy` (19) → `npm run dev` → `http://localhost:5173/signup` → `Organization name, Name, Email, Password, Confirm` → `Create workspace` → auto-login `accessToken`+`HttpOnly refreshToken` → `/app/dashboard`; `Login` is `email+password` only (`/login` ↔ `/signup` links); `seed:dev` (`abc`+`18dakshsuri@gmail.com`) remains optional dev convenience (upsert-only, refuses `NODE_ENV=production`), never required for fresh install.
