# Real Estate CRM — Phase 3: Final Implementation Blueprint & Coding Roadmap

**Status:** Architecture reviewed and closed. This document translates the Phase 2 decision record into an implementation plan.

**Scope adjustments applied per instruction, overriding Phase 2 on these three points only:**

1. **RERA/regulatory guardrails (Phase 2 #13's cap guard, #39) are removed from V1.** No `preAgreementCapPercent` check, no `Project.rraRegistrationStatus`, no `EOI` deal type. `Deal.dealType` and the registration-status gate do not exist in this version. If this is reintroduced later, it re-enters as an additive guard on Payment Plan generation and Booking creation — nothing in the V1 schema below needs to change shape to accommodate it later; it will slot in as new fields plus a new validation, not a redesign.
2. **Channel Partner attribution (Phase 2 #41) is deferred, not core.** `Lead.channelPartnerId` and `ChannelPartner` are listed in Part B as optional/P3, not required for V1 completion.
3. **Lead assignment (Phase 2 #10) keeps the rule-chain idea but is implemented as a small, fixed, purpose-built function — not an engine, not a generic rule interpreter.** Detailed in Part E.

Everything else in the Phase 2 decision record (Parts A–I of that document) is the baseline here.

---

## PART A — Final System Structure

### A.1 Overall shape

Modular monolith. One deployable backend service, one Postgres database, one frontend application. Module boundaries are enforced at the code/package level (folder structure + import rules), not at the network level. No microservices — confirmed correct at this scale (Phase 2, Part G).

```
crm/
├── apps/
│   ├── api/            → backend (Node/TS, modular monolith)
│   └── web/             → frontend (React/TS)
├── packages/
│   ├── db/               → Prisma schema, migrations, generated client
│   └── shared-types/    → DTOs/enums shared between api and web
└── workers/               → background job processes (separate process, same codebase)
```

### A.2 Backend architecture

- **Runtime:** Node.js + TypeScript
- **Framework:** Express or Fastify (either is fine; Fastify has better native schema validation)
- **ORM:** Prisma (Phase 2 #9/#19 assumed Prisma-style tooling — a Prisma **middleware/extension** is what enforces `organizationId` scoping centrally, per Phase 2 #19's addition)
- **Structure:** feature-module folders, each with `routes/`, `controller.ts`, `service.ts`, `repository.ts` (or Prisma calls directly if a repository layer is overkill for that module — do not force the pattern everywhere)
- **Cross-cutting middleware:** auth, tenant-scope injection, request-id/correlation-id, error handler, audit-log writer hook

### A.3 Frontend architecture

- React + TypeScript, a router with role-aware route guards
- Data layer: React Query (or equivalent) for server-state caching/refetch — this is the default sync mechanism (see Part I)
- Component structure: `pages/`, `components/` (shared), `features/<module>/` (module-local components/forms/tables)

### A.4 Database architecture

- Single PostgreSQL database, shared across tenants, `organizationId` as a mandatory column on every tenant-scoped table (Phase 2 #19)
- Prisma migrations as the single source of schema truth
- No secondary datastore in V1 (no Elasticsearch, no Redis required for correctness — a job queue library backed by Postgres, e.g. `pg-boss` or similar, is sufficient for V1 background jobs; this avoids adding infrastructure for a requirement that doesn't yet justify it)

### A.5 Major modules and boundaries

| Module | Owns | Does NOT own |
|---|---|---|
| **Identity & Access** | User, Role, Permission, RolePermission, session/auth | Business entities |
| **Organization & Team** | Organization, Team, TeamMembership | User auth details |
| **Enquiry & Intake** | Enquiry | Lead creation logic beyond the intake→match→link step (calls into Lead module) |
| **Contact** | Contact, Requirement, PossibleDuplicate | Lead/Deal specifics |
| **Lead** | Lead, LeadSource, Campaign, AssignmentRule | Deal pipeline logic |
| **Property** | Project, Unit | Deal/Reservation/Booking state |
| **Deal & Pipeline** | Deal (stage, stageHistory) | Reservation/Booking record detail (references them) |
| **Site Visit** | SiteVisit | Deal stage transitions |
| **Reservation & Booking** | Reservation (incl. Unit hold via type discriminator), Booking | Payment amounts owed (references Payment Plan) |
| **Payment** | PaymentPlan, PaymentObligation, PaymentRecord | Booking state itself |
| **Document** | Document | Any business-stage gating beyond its own verification lifecycle |
| **Activity & Task** | Activity, Task | — |
| **Notification** | Notification job records, dispatch lanes | Consent logic detail beyond checking the flag |
| **Audit** | audit_logs (append-only) | — |
| **Integration** | IntegrationConfig, adapter interfaces | Portal-specific business rules |

Each module is a Prisma model group plus a service layer. Modules call each other through service-layer functions, never by reaching into another module's Prisma models directly — this is the enforced boundary (a lint rule or code review checklist, not a runtime mechanism).

### A.6 Shared infrastructure

- Auth middleware (JWT or session, either works — pick session-based if you want simpler revocation on deactivation, since Phase 2 #21 requires immediate revocation)
- Tenant-scope Prisma extension (auto-injects `organizationId` filter — the single most important piece of shared infra, per Phase 2 #19)
- Audit-log writer (a service function called from within the same transaction as any state-changing write)
- Idempotency-key checker (a shared middleware/service for mutation endpoints that declare themselves idempotent)
- Outbox writer + outbox processor (background worker)

### A.7 Background workers/jobs

Single worker process (can scale horizontally later, doesn't need to now):
- Reservation/hold expiry sweep
- Outbox processor (dispatches side effects: notifications, integration calls)
- Notification dispatch (two lanes: internal, customer-facing)
- Webhook/integration inbound processing (if a job-queue-based approach is used instead of synchronous webhook handling — recommended for reliability)

### A.8 External integrations

Adapter interface (`IntegrationCapability`) with `ingestLead`, `sendMessage`, `receiveMessage` as optional capabilities. V1 ships zero or one real adapter depending on time; the interface exists regardless so a second portal doesn't require touching core CRM code.

### A.9 File/object storage

Document metadata in Postgres (`Document` table); actual files in object storage (S3-compatible), accessed only via short-lived signed URLs, per Phase 2 #12.

### A.10 Authentication/authorization

Central auth middleware + a single authorization guard checking `(role, scope)` against the requested `resource:action`, per Phase 2 #18. No per-endpoint ad hoc checks.

### A.11 Tenant isolation

Every tenant-scoped Prisma model gets `organizationId`. The Prisma extension injects the filter on every query for these models automatically. A code-review checklist item: any raw query or `findFirst`/`findMany` that bypasses the extension requires explicit sign-off. Detailed further in Part J.

---

## PART B — Final Database Model (V1)

Notes: `id` is UUID on every table. `organizationId` is present and indexed on every tenant-scoped table (marked **[T]**). `createdAt`/`updatedAt` on every table. `deletedAt` (soft delete) marked **[SD]** where applicable, per Phase 2's two-tier retention (Tier 1 financial/legal = correction-only, no hard delete, no in-place mutation after finalization; Tier 2 = normal soft delete).

### Organization & Access

**Organization** — root tenant entity. `id, name, createdAt`.

**Team [T]** — `id, organizationId, name`. Many-to-many with User via `TeamMembership`.

**TeamMembership [T]** — join table: `userId, teamId`.

**User [T] [SD]** — `id, organizationId, name, email (unique per org), passwordHash, roleId, status (ACTIVE/ON_LEAVE/DEACTIVATED), deactivatedAt, reassignmentCompletedAt`. FK to Role.

**Role [T]** — `id, organizationId, name` (Agent/Team Lead/Manager/Operations-Accounts/Admin — five fixed for V1, organization can rename/reconfigure permission mapping but not add new role types in V1).

**Permission** — `id, resource, action` (global catalogue, e.g. `lead:read`, `payment:verify`).

**RolePermission [T]** — `roleId, permissionId, scope (OWN/TEAM/PROJECT/ORGANIZATION)`.

### Contact & Requirement

**Contact [T] [SD]** — `id, organizationId, name, phone, normalizedPhone (indexed), email, normalizedEmail (indexed), communicationConsent (OPTED_IN/OPTED_OUT), consentUpdatedAt, consentSource`. No `projectId` — organization-scoped only, per Phase 2 #20.

**PossibleDuplicate [T]** — `contactAId, contactBId, matchSignal, status (PENDING/CONFIRMED_SAME/CONFIRMED_DIFFERENT)`.

**Requirement [T]** — `id, contactId, unitTypePreference, budgetMin, budgetMax, preferredProjectIds[], possessionPreference, notes`.

### Intake & Lead

**Enquiry [T]** — append-only. `id, organizationId, channel (PORTAL/WALK_IN/PHONE/OWNED_FORM), leadSourceId, campaignId, rawPayload (JSON), contactId (nullable until matched), projectId (nullable), linkedLeadId`.

**LeadSource [T]** — `id, organizationId, name, type`.

**Campaign [T]** — `id, organizationId, name, leadSourceId, startDate, endDate`.

**Lead [T] [SD]** — `id, organizationId, contactId, projectId (nullable), requirementId (nullable), leadSourceId, campaignId, originEnquiryId, assignedAgentId (nullable), assignmentSource (MANUAL/AUTO/UNASSIGNED), assignedAt, status (open/closed-ish — derived mostly from linked Deal, but Lead itself needs at least OPEN/CONVERTED/DISQUALIFIED for the intake-linking check in #38)`.
Note: `channelPartnerId` is **optional for V1** — add the column only if the attribution feature is actually built this cycle; otherwise omit and add via migration later. No schema harm either way.

**AssignmentRule [T]** — `id, organizationId, type (MANUAL_OVERRIDE_CHECK/PROJECT_AFFINITY/TERRITORY/ROUND_ROBIN), order, config (JSON), active`.

### Property Hierarchy

**Project [T]** — `id, organizationId, name, location, status`. (No RERA fields in V1.)

**Unit** — `id, projectId, identifier, totalCost, availabilityStatus (AVAILABLE/ON_HOLD/RESERVED/BOOKED/BLOCKED)`.

### Deal & Pipeline

**Deal [T] [SD]** — `id, organizationId, contactId, leadId, unitId (nullable until reservation), stage (NEW/QUALIFIED/SITE_VISIT_SCHEDULED/NEGOTIATION/RESERVATION/BOOKING_CONFIRMED/AGREEMENT_SIGNED/PAYMENT_IN_PROGRESS/CLOSED_WON/CLOSED_LOST), lostReason (nullable, required if CLOSED_LOST)`.
`Deal.stageHistory` derived from `audit_logs`, not a separate table.
Note: no `dealType` (EOI/FORMAL_BOOKING) field — that was the RERA-linked addition, removed per scope instruction.

### Site Visit

**SiteVisit [T]** — `id, organizationId, agentId, propertyId, contactId, dealId (nullable), scheduledAt, durationMinutes (default 60), status (SCHEDULED/CONFIRMED/COMPLETED/CANCELLED/NO_SHOW), cancelledBy, cancellationReason, cancelledAt`.

### Reservation, Hold & Booking

**Reservation [T]** — `id, organizationId, unitId, dealId, type (RESERVATION/HOLD), expiresAt (nullable for management-placed holds with no expiry), status (ACTIVE/EXPIRED/CONVERTED/RELEASED), idempotencyKey (composite unique with organizationId + operationType per #9)`.

**Booking [T] [SD-restricted, Tier 1]** — `id, organizationId, dealId, unitId, bookedAt, cancelledBy, cancellationReason, cancelledAt`. No hard delete, no in-place edit post-finalization — corrections are new linked records.

### Payment

**PaymentPlan [T] [Tier 1]** — `id, organizationId, dealId`. (No `preAgreementCapPercent` field — removed with the RERA guard.)

**PaymentObligation [T] [Tier 1]** — `id, paymentPlanId, dueAmount, dueDate, status (PENDING/PAID/OVERDUE)`.

**PaymentRecord [T] [Tier 1, correction-only]** — `id, organizationId, obligationId, amount, status (PENDING/SUCCESS/FAILED), gatewayReference, correctsRecordId (nullable, self-referencing for corrections)`.

### Document

**Document [T]** — `id, organizationId, contactId, dealId (nullable), type, status (NOT_SUBMITTED/SUBMITTED/UNDER_REVIEW/VERIFIED/REJECTED/RESUBMITTED), rejectionReason, reviewedBy, reviewedAt, version, storageKey`. Tier 1 for finalized/verified documents (no overwrite; resubmission is a new version).

### Activity & Task

**Activity [T]** — `id, organizationId, contactId, leadId (nullable), dealId (nullable), type, outcome, notes, createdBy`.

**Task [T] [SD]** — `id, organizationId, assignedTo, relatedContactId (nullable), relatedDealId (nullable), title, dueAt, status (OPEN/DONE/OVERDUE-derived), createdBy`.

### Audit & Reliability

**audit_logs [T]** — append-only. `id, organizationId, actorId, entityType, entityId, action, beforeState (JSON), afterState (JSON), createdAt`.

**IdempotencyKey [T]** — `id, organizationId, key, operationType, requestHash, responseSnapshot, createdAt`. Unique on `(organizationId, key, operationType)`.

**OutboxEvent [T]** — `id, organizationId, eventType, payload (JSON), status (PENDING/PROCESSED/FAILED), attempts, createdAt, processedAt`.

### Integration (optional, build only if an adapter ships)

**IntegrationConfig [T]** — `id, organizationId, provider, credentials, enabledCapabilities[]`.

### Deferred to P3 (do not build unless time allows)

**ChannelPartner [T]** — `id, organizationId, name, contactInfo, commissionStructureNotes`. `Lead.channelPartnerId` nullable FK, added only if this ships.

---

## PART C — Complete Business Workflow (V1)

### C.1 Core pipeline: Enquiry → Lead → Assignment → Qualification → Requirement → Deal → Site Visit → Reservation → Booking → Payment Plan → Payment

| Step | Trigger | Actor | Validation | DB change | Transaction? | Concurrency | Idempotency | Failure behaviour | Resulting state |
|---|---|---|---|---|---|---|---|---|---|
| Enquiry intake | Portal webhook / walk-in / phone / form | System (adapter) or Agent | Payload shape check | `Enquiry` insert; Contact match (Phase 2 #6 tiers); Lead link-or-create | Yes — match+link/create atomic | Concurrent enquiries from same contact | Idempotency key on intake, esp. webhook retries | Malformed payload → unmatched-enquiries queue, not silently dropped | `Enquiry` linked to `Lead`; `Lead` OPEN |
| Assignment | Lead creation or manual reassign request | System or Manager | AssignmentRule chain evaluated in order | `Lead.assignedAgentId`, `assignmentSource`, `assignedAt` | Yes, with row-locked round-robin counter | Concurrent lead creation racing for "next agent" | N/A (single evaluation) | No eligible agent → `UNASSIGNED`, surfaced to manager | Lead assigned or flagged unassigned |
| Qualification | Agent reviews Lead | Agent | Manual, no schema gate | `Lead.status` update; optional `Requirement` create/update | No transaction needed (single entity, or two entities in a light transaction if both written together) | None | N/A | N/A | Lead qualified, Requirement attached |
| Deal creation | Agent converts qualified Lead | Agent | Lead must be OPEN/qualified | `Deal` insert referencing Contact/Lead/Requirement | Yes — avoid duplicating Lead data | Low | N/A | N/A | `Deal.stage = NEW` |
| Site Visit scheduling | Agent action | Agent | Agent-slot + property-slot availability check | `SiteVisit` insert | Yes — slot lock, re-check at commit | Real — same agent/property double-booking | Idempotency key | Slot taken → reject with conflict, do not silently double-book | `SiteVisit.status = SCHEDULED`; Deal stage may move to `SITE_VISIT_SCHEDULED` (display-only marker) |
| Deal stage transition | Agent action | Agent | Validated against allowed-transitions map | `Deal.stage`; `audit_logs` entry | Yes (state + audit together) | Low | N/A | Invalid transition rejected at validation | New stage |
| Reservation | Agent action | Agent | Unit must be AVAILABLE | Row lock on `Unit` → check → `Reservation` insert → `Unit.availabilityStatus = RESERVED` | Yes — highest-contention path in system | Real — two agents reserving same unit | Idempotency key mandatory | Lock contention → second agent gets rejection, not a corrupted state | Unit RESERVED, Reservation ACTIVE |
| Reservation expiry | Scheduled job | System | Re-check at transaction time | `Reservation.status = EXPIRED`; `Unit.availabilityStatus = AVAILABLE` | Yes | Handled by reservation's lock pattern | Job must be safe to re-run | N/A | Unit released |
| Booking | Agent action, reservation still ACTIVE | Agent | Reservation valid | `Booking` insert; `Unit.availabilityStatus = BOOKED`; `Reservation.status = CONVERTED` | Yes | Low (unit already locked to this reservation) | Yes | N/A | Unit BOOKED |
| Payment Plan generation | System, on booking confirmation | System | N/A | `PaymentPlan` + `PaymentObligation` rows | Yes | Low | Yes | N/A | Plan exists |
| Payment request | Agent or scheduled (installment due) | Agent/System | N/A (no cap check in V1 — RERA guard removed) | `PaymentObligation.status` check | No hard transaction needed for generation | Low | Yes | N/A | Obligation flagged due |
| Payment Record (webhook) | External gateway webhook | System | Signature/payload validation | `PaymentRecord` insert; `PaymentObligation.status` update | Yes — transactional and idempotent | Real — duplicate webhook delivery is common | Mandatory — single most important idempotency point in system | Failed/duplicate webhook → `PaymentRecord.status = FAILED/PENDING`, never silently dropped, retried via outbox | Obligation PAID or still PENDING |

### C.2 Other workflows

- **Customer/contact lifecycle:** Enquiry-triggered creation → dedup matching (Phase 2 #6) → merge only by manual authorized action, logged.
- **Property/inventory lifecycle:** Project/Unit created by Admin/Ops → `availabilityStatus` transitions driven only by Reservation/Hold/Booking flows above, never edited directly.
- **Activity/task workflow:** Activity is a log of what happened (created alongside any interaction); Task is what needs to happen (assigned, due-dated, no auto-completion from inbound messages).
- **Document workflow:** `NOT_SUBMITTED → SUBMITTED` (agent/customer upload) → `UNDER_REVIEW → VERIFIED/REJECTED` (Ops/Admin only) → `RESUBMITTED` creates new version, old retained.
- **Cancellation/expiry:** shared minimal contract — `cancelledBy`, `cancellationReason`, `cancelledAt` fields consistent across Reservation, Booking, SiteVisit; cancellation always reverses the relevant availability state and is preserved for audit, never hard-deleted.
- **Failure/recovery:** payment failures stay visible (`FAILED`/`PENDING`, retried via outbox), never silently disappear.
- **External integration events:** inbound webhook → idempotent processing via outbox-reverse pattern; outbound side effects → transactional outbox → worker dispatch.

---

## PART D — Implementation Order

Dependency-driven, not requirements-order.

**Phase 0 — Project Initialization**
Repo scaffold, TypeScript config, Prisma setup, CI skeleton (lint + typecheck + test run), environment config structure. *Why first:* nothing else can be built without a working toolchain and a place for migrations to live.

**Phase 1 — Database Foundation**
Organization, User, Role, Permission, RolePermission, Team, TeamMembership schemas + first migration. Tenant-scope Prisma extension built and tested against a dummy model. *Why here:* every other table depends on `organizationId` existing and the enforcement mechanism being provable before real data flows through it. Building this after other tables exist means retrofitting tenant scoping — expensive, per Phase 2 #19.

**Phase 2 — Authentication & Authorization**
Login/session, auth middleware, the single authorization guard checking `(role, scope)`. *Why here:* every subsequent endpoint needs this in place from its first line of code, not bolted on later.

**Phase 3 — Organizations & Teams (operational)**
Org/Team CRUD, TeamMembership management, Admin UI shell. *Why here:* needed before there's any meaningful multi-user testing of anything downstream.

**Phase 4 — Contact & Requirement**
Contact CRUD, dedup matching (Tier 1/2/3), Requirement entity. *Why here:* Lead cannot meaningfully exist without Contact; dedup logic needs to exist before Lead creation paths are wired up, or Lead creation will need to be revisited.

**Phase 5 — Property Hierarchy**
Project, Unit. *Why here:* Deal, Reservation, Booking, SiteVisit all reference Unit/Project; needs to exist before pipeline work, but has no dependency on Contact/Lead itself, so it can be built in parallel with Phase 4 if two developers are available.

**Phase 6 — Enquiry & Lead (incl. LeadSource/Campaign, AssignmentRule)**
Enquiry intake pipeline, Contact-match-then-link-or-create, LeadSource/Campaign as config entities, the assignment mechanism (Part E). *Why here:* depends on Contact (Phase 4) and needs Property (Phase 5) for project association.

**Phase 7 — Deal & Pipeline**
Deal entity, fixed 9-stage pipeline, allowed-transitions validation. *Why here:* depends on Lead (Phase 6).

**Phase 8 — Site Visit**
Slot model, transactional booking, state machine. *Why here:* depends on Deal (optional link) and Property (agent/property slots) — can start once Phase 5 and Phase 7 exist.

**Phase 9 — Reservation (incl. Unit Hold) & Booking**
Row-lock-and-recheck transactional flow, Unit availability state machine, expiry scheduler. *Why here:* the highest-risk concurrency code in the system; build it once Deal and Unit both exist and are stable, so testing isn't fighting a moving schema underneath it.

**Phase 10 — Payment Plan / Obligation / Record**
Plan generation on booking confirmation, webhook idempotent processing. *Why here:* strictly depends on Booking existing.

**Phase 11 — Document**
Upload, signed URLs, verification lifecycle. *Why here:* can technically start earlier (only depends on Contact/Deal existing loosely) but is lower-risk and can be slotted in whenever convenient — placed here so it doesn't compete for attention with the concurrency-heavy phases.

**Phase 12 — Activity & Task**
Can start as early as Phase 4 in parallel, since it only needs Contact to exist; placed here in the narrative for completeness, but in practice build incrementally alongside every phase from 4 onward, since almost every workflow above logs an Activity or creates a Task.

**Phase 13 — Notifications & Background Jobs consolidation**
Outbox processor, reservation-expiry sweep, notification dispatch (internal/customer-facing lanes). *Why here:* individual triggers exist earlier (Reservation expiry in Phase 9, e.g.) but the worker process and outbox pattern should be built as shared infrastructure once 2–3 real trigger sources exist, not before there's anything real to process.

**Phase 14 — Audit Trail Consolidation & Retention**
Formalize `audit_logs` writes across all modules (should already be happening incrementally per-module from Phase 4 onward — this phase is the review/consistency pass), Tier 1 correction-only enforcement on Payment/Document.

**Phase 15 — Frontend Polish, Dashboards, Observability, Deployment**
Role-aware dashboards, structured logging, correlation IDs, health checks, migration/deploy pipeline, backups.

---

## PART E — Feature-by-Feature Coding Plan

*(Representative set covering the highest-complexity and highest-priority features per Phase 2's P0/P1 list. Apply the same template to every remaining feature during implementation.)*

### Feature: Tenant Scoping Enforcement (P0)

**Goal:** Make it structurally difficult to write a query that leaks cross-tenant data.

**Database work:** `organizationId` column, NOT NULL, indexed, on every tenant-scoped table.

**Backend work:**
- Prisma client extension that reads `organizationId` from the authenticated request context and injects it as a `where` filter on all reads/writes for tenant-scoped models.
- A short allow-list of models exempt from this (e.g. `Permission`, which is global).
- Middleware that attaches `organizationId` to request context from the authenticated session, before any service code runs.

**Frontend work:** None directly — but every API client call assumes the session carries org context implicitly.

**Error handling:** Any attempt to query a tenant-scoped model without org context in the request throws before reaching the database.

**Tests:** Integration test proving a query for Org A's data with Org B's session context returns nothing. This is the single most important test in the codebase.

**Dependencies:** Phase 1 completion.

**Definition of Done:** Every tenant-scoped model is covered by the extension; the cross-tenant leak test passes; a raw/bypassing query anywhere in the codebase requires an explicit code-review-flagged exception.

---

### Feature: Contact Deduplication (P0)

**Goal:** Prevent silent data corruption from auto-merging, while surfacing likely duplicates.

**Database work:** `Contact.normalizedPhone`, `normalizedEmail` (indexed); `PossibleDuplicate` table.

**Backend work:**
- Normalization function (phone → E.164-ish canonical form, email → lowercase/trimmed).
- Matching service: Tier 1 (exact phone+email+name → auto-link as possible-same, no merge), Tier 2 (phone or email matches, name differs → flag for review), Tier 3 (no match → new Contact).
- Merge endpoint: transactional reassignment of FK references (Lead, Deal, Activity, Document) from losing record to surviving record; losing record soft-marked merged, not deleted.
- Authorization: merge restricted to an authorized role.

**Frontend work:** "Possible existing contact" suggestion UI during enquiry/contact creation; duplicate review queue; merge confirmation screen (side-by-side).

**Error handling:** Merge failure mid-transaction rolls back completely — no partial reassignment.

**Tests:** Unit tests per tier; integration test for merge transactional integrity; test for the family-shared-number edge case (same phone, different names → Tier 2, not auto-merge).

**Dependencies:** Phase 1 (tenant scoping).

**Definition of Done:** All three tiers implemented; merge is transactional, logged to `audit_logs`, and reversible-within-a-window per policy (or at minimum fully auditable even if not literally undoable in V1).

---

### Feature: Enquiry Intake Pipeline (P0)

**Goal:** Uniform capture → match → link-or-create pipeline across all four channels.

**Database work:** `Enquiry` table; `Lead.originEnquiryId`; `Enquiry.linkedLeadId`.

**Backend work:**
- One `EnquiryIntake` service function that all four channels funnel into.
- Portal webhook handler translates provider payload into the standard intake shape, then calls the same service as walk-in/phone (agent-entered form) and owned-form submissions.
- Within the service: Contact match (reuses dedup tiers) → if an open Lead for this Contact+Project exists, attach new Enquiry to it and log an Activity; else create new Lead from Enquiry.
- Idempotency key required on the intake endpoint (critical for webhook retries).

**Frontend work:** Manual intake form (walk-in/phone) reusing the same service; "unmatched enquiries" queue for payloads that failed matching (e.g. missing phone), with manual resolution UI.

**Error handling:** Malformed payload → stored as unmatched Enquiry with `contactId = null`, surfaced in queue, never dropped.

**Tests:** Repeat-enquiry linking test (same contact, same project, within an open Lead's lifetime → attaches, doesn't duplicate); concurrent-enquiry race test (two simultaneous enquiries from same contact don't create two Leads).

**Dependencies:** Contact module (Phase 4), Lead module skeleton.

**Definition of Done:** All four channels produce identical downstream behavior through the one service function; idempotency proven under simulated webhook retry.

---

### Feature: Lead Assignment (P0/P1 — purpose-built, not a rules engine)

**Goal:** Deterministic, configurable, auditable assignment without building a generic rule interpreter.

**Database work:** `AssignmentRule(organizationId, type, order, config JSON, active)`; `Lead.assignedAgentId`, `assignmentSource`, `assignedAt`; a per-team row-locked round-robin counter table (e.g. `RoundRobinState(teamId, lastAssignedUserId)`).

**Backend work:**
- A single hardcoded function `evaluateAssignment(lead, rules)` that iterates a fixed, small set of rule *types* in configured order: `MANUAL_OVERRIDE_CHECK → PROJECT_AFFINITY → TERRITORY → ROUND_ROBIN`. Each rule type is its own small, explicit function — not a generic expression evaluator, not a scripting layer. `config` JSON only carries type-specific parameters (e.g. which territory maps to which agents), never logic.
- This keeps the "configurable, not hardcoded" property (organizations can turn rule types on/off and reorder them) without ever building a rules engine — there is no interpreter, no user-authored logic, no plugin system. Adding a fifth rule type in the future means writing a fifth function, not extending an engine.
- Round-robin uses the row-locked counter inside the same transaction as Lead creation, to avoid two concurrent lead creations both landing on the same "next agent."
- Deactivated agents excluded from round-robin eligibility (checked live, not cached).
- Manual assignment always wins over a mid-run automatic job (check-then-skip inside the same transaction).

**Frontend work:** Manager dashboard listing `UNASSIGNED` leads; simple ordered rule-toggle UI (drag order, enable/disable each of the four fixed types) — not a rule builder.

**Error handling:** No eligible agent after all rules exhausted → `Lead.assignmentSource = UNASSIGNED`, surfaced on manager dashboard, not silently left null with no visibility.

**Tests:** Concurrency test for round-robin under simultaneous lead creation; deactivated-agent exclusion test; manual-override-wins test.

**Dependencies:** Lead module skeleton, User/Role module (Phase 2/3).

**Definition of Done:** Four fixed rule types implemented and independently toggleable/orderable per organization; round-robin race-condition-free under test; no code path resembles a generic rule interpreter.

---

### Feature: Reservation (Row-Lock-and-Recheck) (P0/P1)

**Goal:** Correct concurrency handling on the highest-contention operation in the system.

**Database work:** `Reservation(unitId, dealId, type, expiresAt, status, idempotencyKey)`; composite unique on `(organizationId, idempotencyKey, operationType)`.

**Backend work:**
- Transaction: `SELECT ... FOR UPDATE` on the target `Unit` row → re-check `availabilityStatus == AVAILABLE` → insert `Reservation` → update `Unit.availabilityStatus = RESERVED` → commit → emit outbox event post-commit (for any downstream notification).
- Idempotency key check before starting the transaction (duplicate request with same key returns the original result, doesn't re-lock/re-reserve).

**Frontend work:** Reserve button on Unit detail with clear conflict messaging ("this unit was just reserved by another agent") rather than a generic error.

**Error handling:** Lock contention on a second concurrent request → that request's re-check fails after acquiring the lock → clean rejection, not a corrupted or partial state.

**Tests:** Concurrency test firing two simultaneous reservation attempts on the same Unit, asserting exactly one succeeds; idempotency replay test.

**Dependencies:** Deal (Phase 7), Unit (Phase 5).

**Definition of Done:** Concurrency test passes reliably under repeated runs (not flaky); idempotency proven; expiry scheduler correctly reverses `RESERVED → AVAILABLE` and is safe to re-run.

---

*(The same template applies to Site Visit scheduling, Payment webhook processing, Document verification, and every other P0/P1 feature. Each should be written up individually before its implementation phase begins — this document establishes the pattern, not an exhaustive enumeration of all features.)*

---

## PART F — API Design (representative, by module)

Only business-workflow-defining endpoints listed — not exhaustive CRUD.

**Enquiry/Lead**
- `POST /enquiries` — intake (idempotency-keyed). Validates payload shape; runs match-then-link-or-create; returns linked Lead.
- `POST /leads/:id/reassign` — manual reassignment; authorization: Manager+; transactional check-then-skip against in-flight auto-assignment.

**Contact**
- `POST /contacts/:id/merge` — transactional merge; authorization: authorized role only; returns reassignment summary.

**Deal**
- `POST /deals/:id/transition` — stage transition; validated against allowed-transitions map; writes `audit_logs` in same transaction; conflict response if the current stage doesn't match the client's expected `fromStage` (optimistic concurrency on stage field).

**Site Visit**
- `POST /site-visits` — idempotency-keyed; validates agent-slot + property-slot availability at commit time; conflict response on overlap.

**Reservation**
- `POST /reservations` — idempotency-keyed; row-lock-and-recheck as described in Part E/G; conflict response if Unit not AVAILABLE at recheck.
- `POST /reservations/:id/release` — explicit release (or convert to Booking via a separate endpoint).

**Booking**
- `POST /bookings` — requires Reservation `ACTIVE`; transactional; idempotency-keyed.

**Payment**
- `POST /webhooks/payment-gateway` — inbound, idempotent (dedup on gateway's own event ID plus internal idempotency record); transactional update of `PaymentObligation`/`PaymentRecord`.

**Document**
- `POST /documents/:id/upload-url` — rate-limited, returns short-lived signed URL scoped to that Document+Contact.
- `POST /documents/:id/verify` / `/reject` — role-gated (Ops/Admin/Manager only).

---

## PART G — Critical Transaction & Concurrency Operations

Every operation below **requires** a DB transaction:

1. **Reservation creation** — `lock Unit row (FOR UPDATE) → re-check AVAILABLE → insert Reservation → update Unit status → commit → emit outbox event post-commit.` Two simultaneous agents: both attempt the lock; one acquires it first, re-checks, succeeds; the second acquires the lock after release, re-checks, sees `RESERVED`, and is rejected cleanly — no double-reservation is possible because the check happens *inside* the lock, not before it.
2. **Booking creation** — depends on Reservation already holding the lock's effect (Unit is already RESERVED to this Deal); transaction updates Unit → BOOKED and Reservation → CONVERTED together.
3. **Payment webhook processing** — transaction wraps idempotency-record check + `PaymentObligation`/`PaymentRecord` update; duplicate webhook delivery (common with real gateways) is caught by the idempotency record before any state changes, so replays are no-ops.
4. **Site Visit booking** — same lock-and-recheck pattern applied to two virtual resources (agent-slot, property-slot) instead of one row; both checked inside one transaction.
5. **Lead assignment (round-robin)** — row-locked counter per team; two concurrent Lead creations both wanting "next agent" serialize on this lock.
6. **Enquiry → Lead match-and-link** — Contact match + Lead link/create wrapped together so two simultaneous enquiries from the same contact can't both create a Lead.
7. **Contact merge** — all FK reassignments (Lead, Deal, Activity, Document) happen in one transaction; a partial merge is worse than no merge, so this must be all-or-nothing.
8. **Document verify/reject** — status transition + audit_logs write together.

Pattern used consistently across all of these: **lock (where a physical or virtual resource is contended) → re-check state → perform change → commit → emit event after commit, never before.** Emitting the event before commit risks notifying about a change that then rolls back.

---

## PART H — Asynchronous Processing

| Job | Trigger | Persisted info | Retry policy | Idempotency | Dead-letter | Crash behaviour |
|---|---|---|---|---|---|---|
| Reservation/Hold expiry sweep | Scheduled (e.g. every minute) | Reservation rows with `expiresAt` | N/A — re-run safe | Re-checks status before transitioning; running twice on an already-expired row is a no-op | N/A | Next scheduled run picks up any missed sweep; no state lost since it's driven by `expiresAt`, not a queue |
| Outbox processor | Polls `OutboxEvent` table (status PENDING) | Event payload, attempts count | Exponential backoff, capped attempts | Event marked PROCESSED only after successful dispatch; safe to reprocess a PENDING event | After max attempts, mark FAILED and surface on an ops dashboard | On crash mid-dispatch, event remains PENDING (not marked PROCESSED until confirmed) — next worker pickup retries it |
| Notification dispatch (internal/customer-facing lanes) | Outbox event of notification type | `lane` field on job record | Standard retry via outbox | Consent check (customer-facing lane) happens at dispatch time, not at enqueue time, so a consent change between enqueue and dispatch is respected | Failed sends logged, not silently dropped | Same as outbox processor (it's a consumer of the same mechanism) |
| Webhook/integration inbound processing | External call | Idempotency record keyed on gateway event ID | Gateway's own retry (idempotent processing absorbs duplicates) | Mandatory — see Part G #3 | N/A (rejection is idempotent, not a failure state) | Transactional; a crash mid-processing leaves the transaction uncommitted, so the webhook effectively wasn't processed and the gateway's retry will complete it |

No generic automation engine — every job above is a specific, named worker function, not a configurable pipeline.

---

## PART I — Frontend Implementation

**Routing:** role-aware route guards reading the authenticated user's role/scope; unauthorized routes redirect, not 404 (so the nav doesn't silently disappear without explanation).

**Authentication flow:** login → session established → role/permission set loaded once and cached in app state → route guards and UI element visibility both read from this same source, so a hidden button and a blocked route are never out of sync.

**Layout/navigation:** persistent sidebar for main modules (Leads, Deals, Site Visits, Inventory, Documents, Tasks), scoped by what the user's role can see.

**Major pages:** Lead list/detail, Deal pipeline (kanban-style by stage), Unit/Inventory browser, Site Visit calendar, Contact detail (with Requirement, Activity timeline, Documents), Manager dashboard (unassigned leads, duplicate review queue, stale-deal report).

**Reusable components:** data table with server-side pagination/filtering/sorting (cursor-based for large lists per Phase 2 #31), stage-transition control (only shows valid next stages), file upload with signed-URL flow, duplicate-merge side-by-side view.

**Forms:** enquiry/contact intake form, reservation/booking action forms, payment recording — all validate client-side for UX but treat backend as authoritative (resubmit-safe, shows server validation errors clearly).

**Permission-aware UI:** buttons/actions hidden or disabled based on the same `(role, scope)` check the backend enforces — never the only line of defense, per Part J.

**State sync:** React Query (or equivalent) for server-state; refetch-on-focus/interval for most views. **WebSockets are useful specifically for:** live Unit availability status on the inventory browser (so two agents viewing the same unit see a reservation happen in near-real-time, reducing failed-attempt frustration even though the backend transaction is the actual source of truth) and live assignment notifications on the manager dashboard. **Normal refetching is sufficient for:** everything else — Lead lists, Deal pipeline, Task lists, reports. Don't build a WebSocket channel for every view; only where stale data causes a real workflow problem (double-reservation attempts).

---

## PART J — Security & Multi-Tenancy

- **Authentication:** session or JWT; either is acceptable, but immediate revocation on deactivation (Phase 2 #21) is easier with server-side sessions.
- **Authorization:** single centralized guard middleware checking `(role, scope, resource:action)` on every request — never a per-endpoint ad hoc `if (user.role === 'admin')` check scattered through controllers.
- **Organization isolation:** the Prisma tenant-scope extension (Part E, Feature 1) is the enforcement mechanism. To make it structurally hard to bypass: tenant-scoped models should not be queryable through the raw Prisma client at all outside the extension-wrapped instance — enforce this via a lint rule or by only exporting the wrapped client from the shared db package.
- **Role/permission checks:** evaluated server-side on every mutating and sensitive-read request; frontend hiding is UX only, never the actual gate.
- **Data scopes:** `OWN` (assigned to this user), `TEAM` (via TeamMembership), `PROJECT`, `ORGANIZATION` — scope resolution is a shared function, not duplicated per module.
- **Secure document access:** signed URLs, short expiry (24–48h), scoped to one Document+Contact, generated through a rate-limited endpoint to prevent URL-spam abuse.
- **Input validation:** schema validation (e.g. Zod) at the API boundary for every mutation endpoint, before any service logic runs.
- **Sensitive-data protection:** payment gateway credentials and integration credentials encrypted at rest; audit logs redact clearly-sensitive fields (e.g. don't log full bank account numbers even in `beforeState`/`afterState`).

**How a developer is prevented from accidentally leaking cross-tenant data:** by construction, since the only exported Prisma client is the tenant-scoped extension, a query written without thinking about tenancy still gets filtered — the failure mode shrinks from "leaked another org's data" to, at worst, "an intentional bypass that requires an explicit, reviewed exception."

---

## PART K — Integrations

- **Adapter structure:** `IntegrationCapability` interface with optional methods (`ingestLead`, `sendMessage`, `receiveMessage`); each provider implements only what it supports, and the CRM checks capability support before calling rather than assuming.
- **Inbound webhooks:** received into a queue/job (via the outbox-reverse pattern) rather than processed fully synchronously in the request handler, so a slow downstream operation doesn't hold the webhook connection open and risk the provider's own retry/timeout logic firing unnecessarily.
- **Outbound operations:** all outbound side effects (sending a message, pushing a lead update to a portal) go through the transactional outbox — written in the same transaction as the business state change, dispatched after commit by the worker.
- **Retries:** exponential backoff, capped, on the outbox processor (Part H).
- **Idempotency:** every inbound webhook processed against a stored event-ID idempotency record; every outbound call carries an idempotency key where the provider supports it.
- **Integration failure states:** a failed integration call doesn't roll back the underlying CRM state (the Lead/Enquiry/etc. already exists correctly) — it's tracked separately as a FAILED outbox event, retried, and surfaced on an ops view if it exhausts retries.
- V1 ships zero or one real adapter; the structure is what makes adding a second one later a matter of implementing the interface, not touching core Lead/Enquiry code.

---

## PART L — Testing Plan

| Area | Test type |
|---|---|
| Tenant isolation (cross-org query leak) | Integration |
| Database constraints (unique keys, FK integrity) | Unit/Integration |
| Reservation concurrency | Concurrency (two simultaneous requests, assert exactly one succeeds) |
| Site visit slot concurrency | Concurrency |
| Round-robin assignment concurrency | Concurrency |
| Idempotency (reservation, booking, enquiry intake, payment webhook) | Integration (replay same key, assert single effect) |
| Authorization (role/scope matrix) | Integration |
| Deal stage transitions (valid/invalid) | Unit |
| Contact dedup tiers | Unit |
| Payment webhook duplication | Integration |
| External integration adapter failure/retry | Integration |
| Document verification workflow (role gating, version handling) | Integration |
| Critical end-to-end workflows (Enquiry → Lead → Deal → Reservation → Booking → Payment) | E2E, small number of high-value paths, not exhaustive |

Prioritize concurrency and idempotency tests above UI/E2E coverage — these are the areas Phase 2's audit identified as highest-risk, and they're the hardest to catch via manual QA.

---

## PART M — Observability & Deployment

- **Logging:** structured JSON logs, one line per significant event, correlation ID attached from request entry through to any background job it spawns.
- **Error tracking:** a standard managed error-tracking tool (e.g. Sentry) — no custom infra.
- **Correlation IDs:** generated at request entry, propagated into outbox events so a job's logs can be traced back to the request that created it.
- **Background-job monitoring:** dashboard or log-based view of PENDING/FAILED outbox event counts; alert if FAILED count grows unexpectedly.
- **Health checks:** a simple `/health` endpoint checking DB connectivity and worker liveness.
- **Environment configuration:** `.env`-based per-environment config, secrets not committed, separate config for dev/staging/prod.
- **Database migrations:** Prisma migrate, applied via CI/CD pipeline, never manually against production.
- **Backups:** managed Postgres provider's built-in backup/DR (Phase 2 #26), same RPO/RTO conversation extended explicitly to object storage (documents).
- **Deployment:** single backend service + worker process + frontend static build; standard CI/CD (build → test → migrate → deploy); no Kubernetes/microservices infra needed at this scale.

---

## PART N — Final Implementation Checkpoints

1. **Project scaffold & CI** — repo, TypeScript, Prisma, lint/test pipeline.
2. **Database foundation & tenant scoping extension** — Org/User/Role/Permission schema + the Prisma extension, proven with a cross-tenant leak test.
3. **Authentication & authorization** — login, session, central `(role, scope)` guard.
4. **Organization & Team management** — Admin CRUD for org structure.
5. **Contact module + deduplication** — Contact CRUD, Tier 1/2/3 matching, merge flow.
6. **Property hierarchy** — Project/Unit CRUD, availability enum.
7. **Enquiry intake pipeline** — unified intake service across channels, match-or-link-or-create.
8. **Lead module + assignment mechanism** — LeadSource/Campaign config, four-rule-type assignment.
9. **Deal & pipeline** — fixed 9-stage model, transition validation.
10. **Site Visit scheduling** — agent/property slot model, transactional booking.
11. **Reservation (incl. Unit Hold)** — row-lock-and-recheck, expiry scheduler.
12. **Booking** — transactional creation from active Reservation.
13. **Payment Plan / Obligation / Record** — plan generation, idempotent webhook processing.
14. **Document verification workflow** — upload, signed URLs, role-gated verify/reject.
15. **Activity & Task** — logging and assignment, integrated incrementally across prior checkpoints.
16. **Background job infrastructure** — outbox processor, notification lanes, expiry sweep consolidation.
17. **Audit trail consistency pass** — confirm every state-changing operation writes `audit_logs`.
18. **Frontend core pages** — Lead/Deal/Contact/Inventory/Site Visit views, permission-aware.
19. **Dashboards & manager views** — unassigned leads, duplicate queue, stale-deal report.
20. **Observability & deployment pipeline** — logging, health checks, migration/deploy automation.

---

## PART O — Coding Start Point

**If coding starts tomorrow morning, in order:**

1. Scaffold the repo (Prisma + TypeScript + Express/Fastify + a basic React app), get CI running on an empty project.
2. Write the `Organization`, `User`, `Role`, `Permission`, `RolePermission` Prisma models and run the first migration.
3. Build the tenant-scope Prisma extension immediately, before writing any other model, and write the cross-tenant leak test against these first few models even though there's nothing meaningful to leak yet — this proves the mechanism works before anything depends on it.
4. Build login/session + the central authorization guard.
5. Only after that: start Contact, then Enquiry/Lead, following the phase order in Part D.

**Final V1 milestone before calling it functionally complete:** the full Enquiry → Lead → Assignment → Deal → Site Visit → Reservation → Booking → Payment Plan → Payment Record chain runs end-to-end through the real API (not mocked), with the concurrency tests (Reservation, Site Visit, round-robin) passing reliably, tenant isolation proven, and role-based authorization enforced on every mutation endpoint in that chain. Documents, notifications, dashboards, and reporting can lag behind this core chain without blocking a "V1 works" claim — but the chain above, with its concurrency and idempotency guarantees intact, is the non-negotiable finish line.
