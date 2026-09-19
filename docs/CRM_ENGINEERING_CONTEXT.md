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
    +-- Sales [IMPLEMENTED: Deal, SiteVisit, Reservation/Hold, Booking, PaymentPlan/Obligation/Record; SPECIFIED: Documents]
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
| AuditLog | Shared **append-only history row** (first writer: Deal) | A per-entity history table — `Deal.stageHistory` derives from these rows | `actorId` has no FK (history survives actor deletion); `deal.create` + `deal.stage_transition` entries written in the same transaction as the state change |
| LeadSource / Campaign | Intake attribution config (portal names, campaigns) | Analytics engine | Per-org unique names; campaign→source must be same-org |
| AssignmentRule | `type + order + config + active` | A script/expression (config holds params only, never logic) | V1: `ROUND_ROBIN` only; config `{ teamId }` must be a visible same-org team |
| RoundRobinState | Per-team assignment counter | Agent workload data | One row per team; `lastIndex` over id-sorted ACTIVE members; `lastAssignedUserId` has no FK so deactivation never blocks the row |
| IdempotencyKey | Processed-request record | Business data | Unique `(org, key, operationType)`; hash decides replay vs 409 |
| Project / Unit | Inventory hierarchy `Org → Project → Unit` | Availability truth beyond `availabilityStatus` | Project name unique per org; Unit identifier unique per project; `Unit.projectId` immutable; `availabilityStatus` never edited directly (future reservation/booking flows own it); `Project → Unit` FK is `Restrict` |

Protected distinctions — do not collapse: **Activity = what happened. Task = what needs to happen. Enquiry = intake event. Lead = sales opportunity/relationship.**

### Specified but NOT implemented

Document, Activity, Task, OutboxEvent, IntegrationConfig. Phase 3 Part B/C defines their shape; no tables, routes, or logic exist yet. (Deal + AuditLog moved to IMPLEMENTED in Checkpoint 8; SiteVisit in Checkpoint 9; Reservation/Hold in Checkpoint 10; Booking in Checkpoint 11; PaymentPlan/Obligation/Record in Checkpoint 12.)

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
**Decision:** `LeadStatus`: `OPEN`, `CONVERTED`, `DISQUALIFIED`. Allowed: OPEN→either closed state; DISQUALIFIED→OPEN (reopen). CONVERTED is terminal in Checkpoint 7.
**Rules:** Reopening into an occupied slot trips the partial index → 409. `assignedAgentId` is rejected on PATCH (use reassign).

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
**Decision:** `PaymentPlan(dealId! @unique)` + `PaymentObligation(plan, dueAmount, dueDate, PENDING/PAID stored)` + `PaymentRecord(obligation, amount, PENDING/SUCCESS/FAILED, gatewayReference?, correctsRecordId? @unique self-FK)`. Plan creation is an explicit idempotent `POST /payment-plans {bookingId, obligations[]}` (`PAYMENT_PLAN_CREATE`); the obligations array IS the custom schedule. No plan templates exist in any source (verified: "template" hits are doc/notification lanes; "installment" is a trigger label) — reusable/approved monthly templates are DEFERRED/OPEN, additive later, no V1 reshaping needed. Webhook `POST /webhooks/payment-gateway` is provider-neutral and unauthenticated by necessity (no gateway/secret in repo — signing deferred, documented risk); tenant derives from the obligation row, gateway `eventId` is the `PAYMENT_WEBHOOK` key. Tx: lock obligation `FOR UPDATE` → re-read → create record → SUCCESS flips PAID (already-PAID + SUCCESS → 409). No outbox (doesn't exist; jobs checkpoint owns it), no audit rows (Phase 3 payment rows mandate none), no `Deal.stage`/Booking/Unit writes, no PATCH/DELETE on payment rows.
**Rules:** Permissions: `paymentPlan:create|read`, `paymentObligation:read`, `paymentRecord:read` (webhook exempt — external boundary). OVERDUE derived at read (PENDING + past due), never written. Corrections: new row + `correctsRecordId` (same-obligation enforced, double-correction blocked by unique); originals never mutated.
**Why:** The unique(dealId) + unique(correctsRecordId) + eventId-keyed idempotency make duplicate plans/records structurally impossible; derived OVERDUE keeps the webhook the sole PAID writer with no scheduler to build.
**Important Edge Cases:** Concurrent duplicate deliveries → one 201 + one 200 replay, single SUCCESS. Same event different payload → 409. FAILED/PENDING records stay visible with obligation unpaid. Malformed/unknown/cross-tenant obligation → 400/404 with zero mutation.

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
- **Direct mutation restrictions (do not bypass):** no `POST /leads`; no `availabilityStatus` or `Unit.projectId` writes; no assignment via `PATCH /leads`; no auto-merge of duplicates; no generic `PATCH /site-visits` (status/slot move only via dedicated ops); no generic `PATCH /reservations` (status/type/unitId/dealId immutable — ACTIVE moves only via release/expiry/Booking); no `PATCH/PUT/DELETE /bookings` (finalized rows mutate only via dedicated cancel); no `PATCH/PUT/DELETE` on any payment row (obligations flip PAID only via webhook; records correct only via new row + `correctsRecordId`).
- **Endpoint naming:** plural kebab resources (`/enquiries`, `/leads`, `/lead-sources`, `/campaigns`, `/assignment-rules`, `/projects`, `/units`, `/contacts`, `/requirements`, `/teams`, `/organizations`, `/deals`, `/site-visits`, `/reservations`, `/bookings`, `/payment-plans`, `/payment-obligations`, `/payment-records`, `/webhooks/payment-gateway`); actions as subpaths (`/:id/reassign`, `/:id/merge`, `/:projectId/units`, `/:id/stage-transition`, `/:id/confirm|cancel|complete|no-show|reschedule`, `/:id/release`, `/:id/cancel`).

## 13. Testing Philosophy

Strong tests are required for: tenant isolation, authorization matrix, transactions, concurrent requests, idempotency (replay + conflict + races), state transitions (valid and invalid), uniqueness (including reopen conflicts), soft-delete read/write behavior, cross-organization attacks, external failure boundaries (malformed payloads preserved, not dropped), assignment (order, concurrency, deactivation, manual-wins), contact matching tiers, repeat-enquiry attach-vs-create.

Snapshot (not a requirement): **385 tests / 13 suites** — auth 61, tenantIsolation 50, contactsRequirements 56, enquiryLead 33, organizationsTeams 33, reservations 32, siteVisits 29, propertyHierarchy 28, bookings 21, payments 17, dealsPipeline 20, refreshConcurrency 3, health 2. Concurrency-sensitive tests are re-run multiple times before sign-off. Never weaken an existing test to make a new feature pass.

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
| 11 | Booking | COMPLETE | ACTIVE RESERVATION→CONVERTED + Unit RESERVED→BOOKED in one tx, reservationId required + unique, idempotent create, dedicated cancel; 21 integration tests; uncommitted on `dev` at time of writing |
| 12 | Payments | COMPLETE | Deal-specific plans, derived OVERDUE, correction-only records, idempotent provider-neutral webhook; 17 integration tests; uncommitted on `dev` at time of writing |
| 13 | Documents | NOT STARTED | Build on stable Booking/Payment |
| 14+ | Activity/Task, jobs/outbox, audit pass, frontend, dashboards, observability | NOT STARTED | Phase 3 Part N order |

Checkpoint 7 verified status: intake pipeline; Checkpoint-5 matching reuse (no second implementation); Lead foundation (no manual create); ROUND_ROBIN (+deterministic, concurrent-safe) and manual reassignment; IdempotencyKey table + replay/conflict/race semantics; partial-index + row-lock concurrency protection; 33 integration tests; project-less enquiries open separate Leads; Activity integration deferred (no Activity table yet); PROJECT_AFFINITY/TERRITORY/MANUAL_OVERRIDE_CHECK deferred.

Checkpoint 8 verified status: Deal creation from OPEN Lead only (contact derived, never client-supplied; unitId optional, availability untouched); Lead auto-converts in the same transaction (resolves O-1); fixed pipeline with literal transition map + dedicated endpoint + `fromStage` concurrency check; CLOSED_LOST requires trimmed reason, terminals have no exits, forward moves clear the reason; `deal.create` + `deal.stage_transition` audit rows in-transaction (no `lead.converted` entry — Phase 3 does not require it); PATCH limited to unit attach-once; soft-delete consistent with Leads; 20 integration tests; no SiteVisit/Reservation/Booking/Payment/Document/Activity/RERA leakage.

Checkpoint 9 verified status: Agent + Project resource model (no per-Unit scheduling, Unit rows untouched); 60-min default with 15–480 per-visit override, 15-min agent-only buffer; SCHEDULED/CONFIRMED block, histories never do; contact overlap is preference-only; deterministic agent→project `FOR UPDATE` lock order + in-lock re-check; `SITE_VISIT_CREATE` idempotency incl. post-hoc replay on slot-conflict races; lifecycle map + cancel triple + in-place reschedule via dedicated ops (no generic PATCH, no `deletedAt`, no audit rows per spec); 29 integration tests incl. 3 real concurrent double-book races; no Reservation/Booking/Payment/Document/Activity/Task/Notification/RERA leakage.

Checkpoint 10 verified status: One-row RESERVATION/HOLD discriminator (no UnitHold table); `dealId` required in V1 per Phase 3 (management Deal-less holds deferred, see DEC-026); AVAILABLE→RESERVED / AVAILABLE→ON_HOLD creation with Unit `FOR UPDATE` + in-lock re-check; unit-less Deal bound in-transaction (attach-once preserved); `RESERVATION_CREATE`/`HOLD_CREATE` idempotency incl. post-hoc replay; ACTIVE→RELEASED dedicated release + ACTIVE→EXPIRED named worker (`expireDueReservations`, per-candidate tx, conditional AVAILABLE, re-run/stale safe); no generic PATCH, no `deletedAt`, no audit/outbox rows per spec; 32 integration tests incl. 4 real concurrent claim races + release/expiry race; no Payment/Document/Activity/Task/Notification/RERA leakage.

Checkpoint 11 verified status: `Booking(unitId, dealId, reservationId! @unique, bookedAt server-set, cancel triple)` — no status enum, no `deletedAt`; create converts ACTIVE type=RESERVATION only (HOLD rejects 400) via Unit `FOR UPDATE` + in-lock re-check (Booking insert + RESERVED→BOOKED + ACTIVE→CONVERTED + `BOOKING_CREATE` idempotency in one tx); no `Deal.stage` move (agent uses existing transition op); no audit/outbox rows per spec; cancel preserves row (actor + trimmed reason + timestamp), frees BOOKED→AVAILABLE, keeps CONVERTED, double-cancel 400; no PATCH/PUT/DELETE; 21 integration tests incl. 3 concurrent booking races; no Payment/Document/Activity/Task/Notification/RERA leakage.

Checkpoint 12 verified status: `PaymentPlan(dealId! @unique)` + `PaymentObligation(plan, dueAmount, dueDate, PENDING/PAID stored)` + `PaymentRecord(obligation, amount, PENDING/SUCCESS/FAILED, gatewayReference?, correctsRecordId? @unique self-FK)` — no `deletedAt`; explicit idempotent `POST /payment-plans {bookingId, obligations[]}` (deal-specific schedule, unique(dealId) backstop, booking/deal state untouched); provider-neutral unauthenticated `POST /webhooks/payment-gateway` (eventId = `PAYMENT_WEBHOOK` key, tenant from obligation row, obligation `FOR UPDATE` + re-read, record + SUCCESS→PAID in one tx, already-PAID + SUCCESS → 409); OVERDUE derived at read, never written; corrections via new row + `correctsRecordId` (same-obligation enforced); no `Deal.stage`/Booking/Unit writes, no audit/outbox rows per spec, no PATCH/DELETE; 17 integration tests incl. concurrent duplicate deliveries; no Document/Activity/Task/Notification/RERA/refund/ledger leakage.

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
**Current checkpoint:** 12 (Payments) implemented and validated; Documents next.
