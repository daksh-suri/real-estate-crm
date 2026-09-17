# Real Estate CRM — Phase 2 Architecture Re-Audit & Decision Record

**Scope:** Fresh, independent re-audit of the full architecture. CLOSED decisions are treated as proposals, not conclusions. Every genuine issue gets a working decision, not just a flag.

---

## PART A/B/C — CHECKPOINT-BY-CHECKPOINT REVIEW

### Group 1: Decisions that hold up (upheld, brief reasoning only)

These were tested against concurrency, tenancy, correctness and SaaS-fitness. No flaws found that justify reopening.

| # | Decision | Why it holds |
|---|---|---|
| 8 | Row-level pessimistic lock (`SELECT ... FOR UPDATE`) for reservation creation | Correct under concurrency, cheap at CRM transaction volumes (this is not a high-frequency trading system — lock hold time is milliseconds), and simpler than optimistic retry loops or advisory locks. Works fine per-tenant since the lock is scoped to a single `Unit` row. |
| 9 | Client-generated UUID idempotency keys, backend-enforced | Standard, correct pattern. Only refinement: the key must be stored with a composite uniqueness of `(organizationId, idempotencyKey, operationType)`, not just the key alone, or two tenants could theoretically collide on the same client-generated UUID (astronomically unlikely with UUIDv4, but the composite constraint costs nothing and closes the gap). |
| 15/30 | Query-driven indexing | Correct approach — indexing against real query patterns instead of speculative coverage is the only sane strategy pre-launch. Ties into #19 below: every tenant-scoped table needs `organizationId` as the leading column in its primary lookup indexes. |
| 25 | DB-enforced structural integrity | Correct layering. No changes. |
| 26 | Managed Postgres backup/DR | Correct for V1. One addition: object storage (documents) needs the *same* RPO/RTO conversation explicitly, not an afterthought — see #27. |
| 29 | Frontend UX / backend authoritative / DB structural / transaction-for-multi-record | Correct and standard. No changes. |
| 31 | Server-side pagination/filtering/sorting, tenant-scoped, whitelisted fields | Correct. Add: cursor pagination should be the *default* for any list endpoint that can be filtered by agents across a large dataset (leads, activities), not just "where high volume justifies it" — deciding this per-endpoint later invites inconsistency. Offset pagination is fine only for small, bounded lists (e.g., a project's unit list on a low-rise project).
| 32 | Rollback/retry/idempotency layering | Correct, standard outbox-adjacent pattern. No changes. |
| 33 | Transactional outbox for external side effects | Correct — this is the right call given you explicitly reject a generalized workflow engine. It gives you reliability without the automation-engine overhead. No changes. |
| 35 | Timestamps, soft delete, auditable restoration | Correct. Tie to #16 below for retention specifics. |
| 36 | Observability (structured logs, error tracking, correlation IDs, job monitoring, health checks) | Correct scope for V1. No changes. |
| 37 | Testing priorities | Correct priority list. No changes. |

### Group 2: Decisions that are directionally correct but need a specific addition (reopened, not replaced)

---

### #1 — Communication & Follow-up

**Problem:** The direction (Activity = what happened, Task = what needs to happen, no auto-completion from inbound messages) is sound. What's missing: nothing says what happens to consent/opt-out. If a customer replies "STOP" or asks not to be contacted, and this isn't captured as CRM state, every future automated reminder (#28) and every agent risks a compliance violation.

**Why it matters:** India has TRAI's regulatory framework around unsolicited commercial communication (DND registry, consent requirements for promotional calls/SMS/WhatsApp). A CRM that has no concept of contact consent state is a compliance liability the moment it's used at scale, and retrofitting it after agents have logged thousands of activities is expensive.

**Edge cases:** customer opts out via a call but the record was logged manually days later; a Contact is shared across multiple Leads/Deals (does opt-out apply per-contact or per-lead?); reactivation if the customer re-initiates contact later.

**Recommended solution:** Add a `communicationConsent` state on `Contact` (not per-Activity): `OPTED_IN` (default/implicit for inbound enquiries) → `OPTED_OUT` (explicit). Any outbound automated notification (#28) checks this flag before sending. Manual agent-initiated calls are not blocked by this (agents use judgement/compliance training), but automated SMS/WhatsApp/email sends are hard-gated by it.

**Data model impact:** `Contact.communicationConsent` (enum), `Contact.consentUpdatedAt`, `Contact.consentSource` (which activity/channel recorded the change).

**Workflow impact:** Logging an Activity with `outcome = OPTED_OUT` (or equivalent) updates the Contact record in the same transaction.

**Backend/API impact:** Notification/background job service (#28) must check consent before dispatch — this is a required gate, not optional.

**Frontend/UI impact:** Visible consent badge on Contact/Lead detail view; warning before manual bulk actions.

**V1 scope:** The consent flag + gate on automated sends. Full DND-registry cross-checking is future scope.

**Future scope:** Integrating actual DND registry lookups, granular per-channel consent (SMS vs WhatsApp vs call).

**Final decision:** Add `Contact.communicationConsent` as a first-class field, gate all automated outbound communication on it. #1 direction otherwise stands as CLOSED.

---

### #5 — Unit Availability Source of Truth

**Problem:** Direction is correct (Unit.availabilityStatus as SoT), but the status enum implied so far is binary-ish (AVAILABLE/RESERVED/BOOKED). Real sales floors also need a soft "on hold" state that isn't a formal Reservation — e.g., a sales manager verbally holding a unit for an agent's VIP client for an hour while paperwork is arranged, or a unit temporarily pulled from sale for internal reasons (compliance issue, pricing correction).

**Why it matters:** Without this, agents will invent workarounds (assigning a throwaway reservation just to "hold" a unit), which pollutes the Reservation entity's meaning and breaks the expiry/concurrency logic built for #4/#8.

**Edge cases:** internal hold vs customer-facing hold; who can place/release a hold; hold with no expiry (management decision) vs timed hold.

**Recommended solution:** Extend `Unit.availabilityStatus` enum to include `ON_HOLD` alongside `AVAILABLE / RESERVED / BOOKED / BLOCKED`. `BLOCKED` = admin-only, not customer-facing (compliance/pricing pause). `ON_HOLD` = manager/authorized-role placed, optionally time-boxed, reuses the same expiry-scheduler mechanism built for Reservation (#4) rather than inventing a second scheduler.

**Data model impact:** Extend `Unit.availabilityStatus` enum; `UnitHold` as a lightweight entity (or reuse `Reservation` with a `type: HOLD` discriminator — recommended, to avoid duplicating the expiry/concurrency machinery).

**Workflow impact:** Hold placement/release goes through the same locking transaction as Reservation creation (#8).

**Backend/API impact:** No new mechanism — reuses #4/#8/#9 machinery with a type discriminator.

**Frontend/UI impact:** Distinct visual state for held vs reserved vs booked units on inventory views.

**V1 scope:** `ON_HOLD` and `BLOCKED` states, reusing Reservation's expiry/locking machinery.

**Future scope:** Hold approval workflows (e.g., holds beyond X hours need manager sign-off).

**Final decision:** Extend the availability enum with `ON_HOLD`/`BLOCKED`, implemented via the existing Reservation entity with a type discriminator rather than a new entity. #5's core principle (single source of truth, DB as authority over WebSocket state) stands as CLOSED.

---

### #16 / #17 / #26 / #27 — Retention & Immutability (consolidated)

**Problem:** Soft delete, audit trail, backup/DR and document storage were each closed independently, but none of them specify retention *duration* or which records must be legally immutable. For a real estate CRM this isn't optional — Agreement for Sale documents, payment records, and RERA-relevant booking data <cite index="7-1">are subject to mandated disclosure and legal documentation requirements under RERA</cite>, and <cite index="9-1">RERA Section 61 penalizes promoters for compliance violations tied to booking and agreement records</cite>, so these records existing, being accurate, and being tamper-evident is a legal requirement, not just good practice.

**Why it matters:** If a dispute goes to a State RERA tribunal, the developer needs to produce an accurate, unaltered history of what was agreed, paid, and disclosed, potentially years later. A generic "soft delete + audit log" without an explicit legal-hold/immutability rule for financial and agreement-linked records is a real business risk, not just an architecture nicety.

**Edge cases:** a payment record needs correction (bank reconciliation error) — how is that handled without breaking the "never alter" rule; an audit log itself needs redaction of sensitive fields (bank account numbers) without breaking the trail.

**Recommended solution:** Classify entities into two retention tiers. **Tier 1 (financial/legal/compliance-critical):** Payment Record, Payment Plan, Booking, Reservation history, Document (Agreement for Sale, KYC), audit_logs entries referencing these — no hard delete ever, no in-place mutation after a defined "finalized" state; corrections are new compensating records that reference the original, never edits. **Tier 2 (operational):** Lead, Task, Activity, general CRM notes — normal soft delete with restoration, standard backup retention (no special immutability requirement).

**Data model impact:** A `retentionTier` convention documented per entity (not necessarily a DB column — an architectural rule enforced in the service layer); correction records reference `correctsRecordId` rather than overwriting.

**Workflow impact:** Payment/document correction becomes an explicit "create correction, link to original, mark original superseded" flow, not an edit form.

**Backend/API impact:** Tier 1 entities get no `PUT`/`PATCH` update path in the API for their core financial fields once finalized — only append-style correction endpoints.

**Frontend/UI impact:** Correction UI is visually distinct from editing (shows old value, new value, reason, both preserved).

**V1 scope:** The Tier 1/Tier 2 classification and the compensating-record correction pattern for Payment Record and Document.

**Future scope:** Formal legal-hold tooling (freezing records under active dispute/litigation).

**Final decision:** Adopt a two-tier retention model. Financial/legal-critical records are correction-only, never edited or hard-deleted, regardless of the general soft-delete policy in #16. #17/#26/#27 otherwise stand as CLOSED/PROVISIONALLY CLOSED.

---

### #19 — Multi-Tenancy / Organization Isolation (see also PART F below)

**Problem:** Shared PostgreSQL + `organizationId` is the right V1 call — reviewed in full under Part F. The one addition here: the audit needs to explicitly confirm that *every* tenant-scoped table has `organizationId` NOT NULL with FK to Organization, and that this is enforced by a repeatable convention (e.g., a Prisma middleware or a required base model), not developer discipline alone.

**Why it matters:** A single forgotten `WHERE organizationId = ?` clause is a cross-tenant data leak — the single worst failure mode for a SaaS product. This is a correctness/security issue, not a scaling issue.

**Recommended solution:** Enforce tenant scoping at the ORM/query-builder layer (a Prisma extension/middleware that injects `organizationId` into every query automatically for tenant-scoped models) rather than trusting every hand-written query. Treat any query that bypasses this as requiring explicit code review sign-off.

**Data model impact:** All tenant-owned tables get `organizationId` as a required, indexed FK.

**Backend/API impact:** Tenant scoping enforced centrally, not per-endpoint.

**V1 scope:** ORM-level enforcement mechanism.

**Future scope:** Formal per-tenant resource quotas/rate limits if noisy-neighbor issues emerge.

**Final decision:** #19 stands as CLOSED for the tenancy model itself; adding a mandatory ORM-level enforcement mechanism as a non-negotiable implementation detail, not left to convention.

---

### #28 — Notification/Reminder Execution

**Problem:** The background-job/worker/retry direction is correct. Missing: the same DND/consent concern as #1 applies specifically here, since this is where actual message dispatch happens. Also missing: no distinction between transactional notifications (agent's own reminder that their task is due — internal, not customer-facing) and customer-facing notifications (payment due, site visit reminder), which have very different compliance requirements.

**Recommended solution:** Split the notification job into two lanes at the queue level: internal (agent/staff reminders — no consent gating needed, it's not "commercial communication") and customer-facing (gated by `Contact.communicationConsent` from #1, and logged as Activity for audit purposes).

**Data model impact:** Notification job records carry a `lane: INTERNAL | CUSTOMER_FACING` field.

**Backend/API impact:** Customer-facing lane checks consent (#1) before every send; failures/skips are logged, not silently dropped.

**V1 scope:** The two-lane split and the consent gate.

**Future scope:** Full DND-registry integration, channel-level consent granularity.

**Final decision:** #28 stands as PROVISIONALLY CLOSED with the two-lane split and consent gate added as a required detail.

---

## PART C — RESOLVING THE EXISTING OPEN ITEMS

### #6 — Contact Deduplication

**Problem:** Phone/email matching alone can't safely auto-merge (family-shared-number case explicitly called out).

**Why it matters:** Auto-merging wrongly creates a corrupted customer history (wrong person's enquiries/deals attributed to someone else) — worse than having duplicates, because duplicates are visible and fixable, incorrect merges are silent data corruption.

**Edge cases:** two family members share a phone but are genuinely different buyers on different projects; the same person uses a work email and personal email; a channel partner submits a lead using their own contact number by mistake.

**Recommended solution:** Three-tier matching. **Tier 1 (auto-link, no merge):** exact normalized phone+email+name match → link as "likely same contact," but still require agent confirmation before *merging* histories; two records can share a `possibleDuplicateOf` pointer without being merged. **Tier 2 (flag for review):** phone or email matches but name differs → surfaced in a "possible duplicates" queue for agent/ops review, never auto-merged. **Tier 3 (no match):** proceed as new Contact. Merging is always a manual, logged, reversible-within-a-window action performed by an authorized role, never automatic.

**Data model impact:** `Contact.normalizedPhone`, `Contact.normalizedEmail` (indexed), `PossibleDuplicate` linking table (`contactAId`, `contactBId`, `matchSignal`, `status: PENDING/CONFIRMED_SAME/CONFIRMED_DIFFERENT`), merge operation writes to `audit_logs` (#34) with full before/after state.

**Workflow impact:** New enquiry creation always runs the matching check; the agent sees "possible existing contact" suggestions rather than the system deciding for them.

**Backend/API impact:** Merge is a transactional operation: reassign all FK references (Leads, Deals, Activities, Documents) from the losing record to the surviving record, mark losing record as merged (soft, not deleted, for traceability).

**Frontend/UI impact:** Duplicate review queue; merge confirmation screen showing both records side by side.

**V1 scope:** Tier 1/2/3 matching + manual merge with full audit trail.

**Future scope:** Fuzzy name matching, ML-assisted merge suggestions.

**Final decision:** No automatic merging, ever, in V1. Matching surfaces suggestions; a human confirms. This is the correct trade-off given the explicit family-shared-number risk you flagged.

---

### #7 — Deal Pipeline Stages

**Problem:** No enumerated stage list exists yet.

**Recommended solution:** A fixed, configurable-later stage list reflecting the actual Indian resale/primary-sales funnel, kept intentionally small for V1:

`NEW → QUALIFIED → SITE_VISIT_SCHEDULED → NEGOTIATION → RESERVATION → BOOKING_CONFIRMED → AGREEMENT_SIGNED → PAYMENT_IN_PROGRESS → CLOSED_WON` , with a parallel `CLOSED_LOST` (reachable from any stage, with a required `lostReason`).

Site Visit is correctly kept as its own entity/workflow (per your existing decision) — a Deal can have zero, one, or many site visits without that being a stage transition; `SITE_VISIT_SCHEDULED` is a convenience stage marker for pipeline visibility only, not a hard dependency the backend enforces.

**Data model impact:** `Deal.stage` enum, `Deal.stageHistory` (or derive from audit_logs per #17), `Deal.lostReason` (nullable, required when `CLOSED_LOST`).

**Workflow impact:** Stage transitions are backend-validated against an allowed-transitions map (not a free-for-all enum flip) — e.g., you can't jump from `NEW` directly to `AGREEMENT_SIGNED`.

**Backend/API impact:** Stage transition is its own endpoint/operation (not a generic PATCH), so business rules and audit logging attach cleanly.

**V1 scope:** The 9-stage list above + transition validation.

**Future scope:** Per-project or per-organization customizable pipelines — explicitly deferred; V1 ships one fixed pipeline shared across the tenant.

**Final decision:** Adopt the fixed stage list above for V1. Reopen only if real usage shows the granularity is wrong — do not let this stay unresolved into implementation, since Deal is the spine of the sales workflow.

---

### #10 — Lead Assignment

**Problem:** Needs a concrete rule architecture, not just "should be configurable."

**Recommended solution:** A small ordered rule chain evaluated top-to-bottom per organization, not a generic rules engine: `[Manual override check] → [Project/Property affinity] → [Territory/location] → [Round-robin among eligible agents]`. Each organization configures which rules are active and their order via a simple config table (not free-form scripting). If no rule produces an eligible agent, the Lead is `UNASSIGNED` and surfaced on a manager dashboard.

**Edge cases:** an agent is deactivated mid-round-robin (must be excluded, not just skipped silently); manual assignment happening while an automatic assignment job is mid-run (manual always wins — the assignment job should check-then-skip if already manually assigned, inside the same transaction).

**Data model impact:** `AssignmentRule` (organization-scoped, ordered, type enum, config JSON for that rule type), `Lead.assignedAgentId`, `Lead.assignmentSource` (MANUAL/AUTO/UNASSIGNED), `Lead.assignedAt`.

**Workflow impact:** Assignment is triggered at Lead creation and re-evaluated only on explicit reassignment request — never silently re-run on an already-assigned lead.

**Backend/API impact:** Assignment logic runs inside the same transaction as Lead creation where possible; round-robin state (whose turn is next) needs its own row-locked counter per team to avoid race conditions under concurrent lead creation.

**V1 scope:** The four rule types above, configurable per organization, manual-override protection.

**Future scope:** Workload-based and source-based rules, more complex weighting.

**Final decision:** Ship the ordered rule-chain model with the four rule types listed. This satisfies "configurable, not hard-coded" without building a generalized engine.

---

### #11 — Lead Sources, Campaigns & External Integrations

**Problem:** Needs the adapter/capability model made concrete enough to implement.

**Recommended solution:** `LeadSource` and `Campaign` as first-class, organization-scoped configuration entities (not enums — they need to be creatable by admins: "99acres," "MagicBricks," "Housing.com," "Walk-in," "Referral," "Channel Partner"). External integrations implement a small `IntegrationCapability` interface with explicit methods only for capabilities they actually support (`ingestLead`, `sendMessage`, `receiveMessage`); the CRM checks capability support before attempting an action rather than assuming.

**Data model impact:** `LeadSource(id, organizationId, name, type)`, `Campaign(id, organizationId, name, leadSourceId, startDate, endDate)`, `Lead.leadSourceId`, `Lead.campaignId`, `IntegrationConfig(organizationId, provider, credentials, enabledCapabilities[])`.

**Workflow impact:** Inbound lead ingestion (webhook from a portal) maps to `LeadSource` by provider identity, attaches `Campaign` if the payload carries a recognizable campaign reference, else leaves it null (not guessed).

**Backend/API impact:** Each integration is a thin adapter translating provider-specific payloads into the standard `EnquiryIntake` shape (see #38 below) — this keeps provider-specific logic out of core CRM services.

**V1 scope:** `LeadSource`/`Campaign` as data, manual portal-lead entry, one or two real adapters (whichever portals are actually prioritized).

**Future scope:** Bidirectional integrations, more providers, automated campaign attribution logic.

**Final decision:** First-class configurable `LeadSource`/`Campaign` entities + capability-checked adapters. Detailed per-platform research stays open and is a business/ops task, not an architecture blocker.

---

### #12 — Document Verification

**Problem:** Lifecycle proposed but stage gating and auth unresolved.

**Recommended solution:** Keep the proposed lifecycle (`NOT_SUBMITTED → SUBMITTED → UNDER_REVIEW → VERIFIED/REJECTED → RESUBMITTED → UNDER_REVIEW`). Gate: only `Operations/Accounts` and `Manager/Admin` roles can transition to `VERIFIED`/`REJECTED` (agents can move `NOT_SUBMITTED → SUBMITTED` by uploading, nothing further). Auth for online upload: short-lived signed upload URL scoped to a specific `Document` record and `Contact`, expiring in a small fixed window (e.g., 24–48 hours), no additional customer-account-creation requirement for V1 (that's meaningfully more infrastructure for marginal benefit at this stage).

**Data model impact:** `Document.status`, `Document.rejectionReason` (nullable, required on reject), `Document.reviewedBy`, `Document.reviewedAt`, `Document.version` (per #27, retain history).

**Workflow impact:** Rejection requires a reason; resubmission creates a new version linked to the same logical document, old version retained per the retention tier rule above.

**Backend/API impact:** Signed URL generation is a distinct, rate-limited endpoint (prevents URL-spam abuse).

**V1 scope:** Full lifecycle, role-gated verification, signed-URL upload.

**Future scope:** Additional customer-facing authentication for upload links, OCR/auto-validation of document contents.

**Final decision:** Resolved as above — this was a well-scoped OPEN item and doesn't need to stay open into implementation.

---

### #13 — Payment Plans & Actual Payments (reopened jointly with RERA findings — see #39)

**Problem:** The Payment Plan / Payment Record split is correct, but it was designed without an explicit regulatory constraint that materially affects it: <cite index="9-1">RERA Section 13(1) caps advance/booking payments at 10% of the total property cost before a registered Agreement for Sale is executed</cite>, and <cite index="7-1">the agreement itself must define the payment schedule, and a portion of collected funds is subject to escrow requirements</cite>. A generic "Payment Plan = expected obligations" model that doesn't know about this cap could let an agent (or a bug) generate a payment request that's legally non-compliant.

**Why it matters:** This isn't a UX nicety — collecting more than the statutory cap without a registered agreement is a regulatory violation with real penalties <cite index="9-1">of up to 5% of the project's estimated cost under Section 61</cite>.

**Edge cases:** resale/secondary-market transactions (not all RERA rules apply the same way as primary developer sales — this needs a product decision on which transaction types the CRM handles); multi-state deployment where each State RERA has its own specific percentages/timelines <cite index="6-1">since the refund timeline depends on the respective State RERA</cite>.

**Recommended solution:** Add a `preAgreementCapPercent` config at the organization or project level (default 10%, overridable per state/project since state rules vary), and a backend validation that blocks generating a payment request for booking-stage payments exceeding that percentage of `Unit.totalCost` unless `Deal.agreementForSaleStatus = REGISTERED`. This is a business-rule guard, not a hard database constraint (it needs to be overridable by an authorized role with a logged justification, since edge cases and legal nuance exist) — implemented as backend validation, not UI-only.

**Data model impact:** `Deal.agreementForSaleStatus` (NOT_EXECUTED/EXECUTED/REGISTERED), `PaymentPlan.preAgreementCapPercent`, `Organization`/`Project`-level default config.

**Workflow impact:** Booking-stage payment request generation checks this cap before allowing the request to be created.

**Backend/API impact:** Override requires an explicit authorized action, separately audit-logged (ties to #17).

**V1 scope:** The cap check, `agreementForSaleStatus` field, override-with-audit path.

**Future scope:** Full per-state rule tables, automated escrow-account reconciliation, TDS-threshold flagging for payments above the applicable threshold.

**Final decision:** #13's Payment Plan/Payment Record split stands, with the RERA advance cap added as a mandatory backend guard. This is a case where "further research required" would be irresponsible — the cap is a known, citable legal fact, not a genuinely open business question.

---

### #14 — Site Visit Scheduling & Concurrency

**Problem:** Needs a concrete conflict model.

**Recommended solution:** Model availability as time-slot resources for two dimensions only in V1 — **Agent** and **Property/Project** (not per-Unit; a site visit tours a project/sample flat, not a specific numbered unit in most cases) — with fixed-duration slots (default 60 min, configurable per organization) and a mandatory buffer (default 15 min) between consecutive visits for the same agent. Booking a visit is a transaction: check agent-slot and property-slot availability, re-validate at commit time (same pattern as #8), create the `SiteVisit` record. Customer availability is captured as a preference, not a hard resource constraint (you can't lock a customer's calendar).

**Edge cases:** same agent double-booked across two properties at overlapping times (blocked by the agent-slot check); a visit that runs long and pushes into the next slot (handled operationally, not architecturally — V1 doesn't need real-time slot-shifting); rescheduling (cancel + recreate through the same transactional check, not an in-place time edit, so the concurrency guard always applies).

**Recommended solution (state machine):** `SCHEDULED → CONFIRMED → COMPLETED / CANCELLED / NO_SHOW`. `NO_SHOW` is agent-marked, never automatic (consistent with your existing #24 decision that a passed scheduled time doesn't auto-imply no-show).

**Data model impact:** `SiteVisit(agentId, propertyId, scheduledAt, durationMinutes, status, contactId, dealId nullable)`.

**Backend/API impact:** Same row-lock-and-recheck transaction pattern as Reservation (#8) — this is architecturally the same concurrency problem, reuse the pattern rather than inventing a new one.

**V1 scope:** Agent + property slot model, buffer, the state machine above.

**Future scope:** Per-unit-specific visit slots (for large inventory with distinct sample units), external calendar sync (Google Calendar/Outlook), customer self-service booking.

**Final decision:** Resolved as above. This was flagged as needing "backend concurrency validation" already — the missing piece was the actual resource model, now specified.

---

### #18 — Security & Access Control

**Problem:** Role → Permission → Scope direction exists; catalogue and scope implementation undefined.

**Recommended solution:** Ship a fixed default role set for V1 (not a fully generic role-builder, which is more than this product needs right now): `Agent`, `Team Lead`, `Manager`, `Operations/Accounts`, `Admin`. Each maps to a default permission set across the four scopes already identified (`OWN/TEAM/PROJECT/ORGANIZATION`). Permission checks are resource-action pairs (`lead:read`, `lead:assign`, `payment:verify`, etc.) evaluated against `(role, scope)` at the backend for every request — never trust a frontend-hidden button as the control. Admins can adjust which permissions attach to which role (permission-to-role mapping is configurable), but the five roles and the scope model itself are fixed for V1 — full custom-role creation is future scope.

**Data model impact:** `Role`, `Permission`, `RolePermission` (organization-scoped, so admins can customize per org), `User.roleId`, scope resolution logic (e.g., `TEAM` scope resolves via `User.teamId`).

**Backend/API impact:** A single authorization middleware/guard applied uniformly — not ad hoc checks scattered per-endpoint, or this will drift and create holes.

**V1 scope:** Five fixed roles, configurable role-to-permission mapping, four scopes, centralized enforcement.

**Future scope:** Fully custom roles, field-level permission granularity.

**Final decision:** Fixed role set + configurable permission mapping + centralized enforcement. This avoids both under-building (hardcoded permissions) and over-building (a full RBAC editor nobody asked for).

---

### #20 — Data Ownership & Organizational Structure

**Problem:** Needs the actual relationships specified.

**Recommended solution:** `Organization → Team (optional) → User`, with `User` allowed membership in multiple Teams (many-to-many, not a single `teamId` FK) since the existing notes already say users aren't confined to one team/project. `Organization → Project → Unit`, straightforward one-to-many, since a Project structurally belongs to one Organization and a Unit to one Project. Cross-project customer interest is handled at the `Requirement` level (see #40 below), not by making Contact/Lead belong to a Project — Contact and Lead are organization-scoped, not project-scoped, and link to specific Projects/Units only through Requirement/Deal/SiteVisit.

**Data model impact:** `TeamMembership(userId, teamId)` join table; `Project.organizationId`; `Unit.projectId`; Contact/Lead carry `organizationId` only, never `projectId` directly.

**Workflow impact:** "Which leads is this team responsible for" is derived (via assignment + team membership), not a stored redundant field.

**V1 scope:** The structure above.

**Future scope:** Hierarchical teams (sub-teams), cross-organization brokerage relationships.

**Final decision:** Resolved as above.

---

### #21 — Agent Lifecycle

**Problem:** States and reassignment rules unspecified.

**Recommended solution:** `ACTIVE → ON_LEAVE → DEACTIVATED`, with `ON_LEAVE` as an explicit state (not just "deactivated for a while") because it needs different behavior: an on-leave agent keeps their assignments (someone might just need to cover temporarily) but is excluded from *new* auto-assignment (#10) until reactivated. `DEACTIVATED` triggers a mandatory reassignment workflow: system surfaces all their open Leads/Deals/Tasks to their Manager, who must explicitly reassign each (or bulk-reassign to themselves/a designated agent) — the deactivation itself does not complete until this is acknowledged, though the account access is revoked immediately regardless.

**Data model impact:** `User.status` enum, `User.deactivatedAt`, `User.reassignmentCompletedAt`.

**Workflow impact:** Access revocation (immediate, security-critical) is decoupled from workload reassignment (can take time, is a business process) — these must not be conflated into one blocking step.

**Backend/API impact:** Deactivation endpoint immediately revokes auth tokens/sessions; a separate "pending reassignment" queue surfaces the workload.

**V1 scope:** Three-state lifecycle, decoupled access-revocation-vs-reassignment.

**Future scope:** Automated leave calendars, temporary delegation (agent B covers agent A's leads for exactly the leave window, then auto-reverts).

**Final decision:** Resolved as above.

---

### #22 — Communication History → Deal / Unit Linkage

**Problem:** Whether Unit-level linkage is needed when Deal already references Unit.

**Recommended solution:** No separate `Activity.unitId` in V1. `Activity.dealId` is sufficient since Deal already carries the Unit reference — adding a redundant direct link creates a second source of truth for "what unit was this about" with no real benefit at this scope. For interactions that happen *before* a Deal exists (early-stage lead enquiry about a specific unit), `Activity` links to `Lead` and can carry an optional free-text or `Requirement`-linked reference (see #40) rather than a hard Unit FK — pre-Deal unit interest is inherently fuzzy ("interested in a 2BHK," not "interested in Unit #4B-201" necessarily).

**Data model impact:** No new field. `Activity(contactId required, leadId nullable, dealId nullable)`.

**Workflow impact:** As a Lead converts to Deal, existing Activities remain linked to Contact/Lead — no relinking operation needed since Deal itself references back to the originating Lead.

**V1 scope:** Current model, confirmed sufficient, no Unit-level Activity link.

**Future scope:** Revisit only if multi-unit-interaction reporting becomes a real, requested use case.

**Final decision:** Resolved — no new entity/field needed. This OPEN item closes as "current model is sufficient," which is itself a valid outcome per your instructions.

---

### #23 — Failure & Non-Happy-Path Workflows

**Problem:** Needs domain-specific behavior defined, not a generic engine (correctly rejected).

**Recommended solution:** Rather than one abstract "failure handling" checkpoint, treat this as a per-domain checklist to be completed during each domain's implementation, anchored to a shared minimal contract: every domain must define (a) what "cancelled by whom" looks like, (b) what reverses (inventory availability, holds) on cancellation, and (c) whether the record is preserved for audit (it always is, per #17/#34). Concretely for the domains already well-specified: Reservation cancellation → releases Unit to AVAILABLE (already covered by #4/#5 logic). Booking cancellation → needs a defined refund-eligibility rule tied to #39 (RERA refund rules), not just "cancel the record." Payment failure (gateway declines/webhook failure) → Payment Record stays in a `FAILED`/`PENDING` state, does not silently disappear, retried via the outbox pattern (#33). Site Visit no-show → agent-marked (#14), does not cascade any automatic Deal-stage change.

**Data model impact:** Consistent `cancelledBy`, `cancellationReason`, `cancelledAt` fields across cancellable entities (Reservation, Booking, SiteVisit) rather than ad hoc per-entity naming.

**V1 scope:** The shared minimal contract applied to Reservation, Booking, Payment, Site Visit specifically (the domains already in V1 scope).

**Future scope:** Document and external-integration failure handling, once those subsystems have concrete implementations to react to.

**Final decision:** No generalized engine (confirmed correct). A shared minimal cancellation/failure contract applied consistently across entities, rather than solving this abstractly.

---

### #24 — Time / Stale State / Scheduled Processing

**Problem:** Individual pieces decided; needs the cross-domain review requested.

**Recommended solution:** Consolidate every time-driven state change in the system into a single registry so they're auditable as a set rather than scattered:

| Time-driven change | Trigger | Auto or requires human confirmation |
|---|---|---|
| Reservation expiry (#4) | Scheduled job + transaction-time check | Automatic |
| Task overdue flag (#24 existing) | Derived from `dueAt`, computed on read | Automatic (display-only, no state mutation) |
| Site Visit no-show (#14) | — | Human (agent) only, never automatic |
| Deal inactivity (#24 existing) | — | Never automatic; V1 ships a "stale deal" *report* surfaced to managers, not a state change |
| Unit hold expiry (#5, new) | Scheduled job, reuses Reservation expiry mechanism | Automatic |
| Document link expiry (#12) | TTL on signed URL | Automatic (URL-level, not a Document state change) |

**Why this matters as a consolidated view:** the risk in time-driven logic isn't any single rule, it's inconsistency between rules (one entity auto-transitions, a conceptually similar one doesn't, and nobody documented why). This table is the answer to that.

**V1 scope:** The table above, implemented consistently.

**Final decision:** No new mechanism needed beyond what #4/#5/#14 already define — this closes as a documentation/consistency exercise, confirming the principle "state changes affecting money or availability are automatic + re-validated at transaction time; state changes reflecting business judgement (no-show, staleness) require a human."

---

## PART D — NEW CHECKPOINTS

### #38 — Enquiry Intake & Lead Creation

**Problem:** Enquiries arrive via portal, walk-in, phone, or owned form. Whether this needs a separate entity from Lead was explicitly left open.

**Why it matters:** If every channel writes directly into `Lead`, you lose the ability to answer "how many enquiries did we get this week vs. how many became qualified leads" — a basic reporting need — and you have no clean place to attach channel-specific intake data (portal's raw payload, walk-in visitor's ID proof reference, call recording reference) without bloating `Lead` with mostly-null fields.

**Edge cases:** the same person enquires twice about the same project a week apart (repeat enquiry — should it create a new Lead or reactivate the existing one? see below); an enquiry that never gets contacted and just expires from relevance; a portal sends a malformed/incomplete payload (missing phone).

**Recommended solution:** `Enquiry` is a separate, lightweight, append-only entity representing the raw intake event. Every enquiry creates or links to exactly one `Lead` via the Contact-matching logic from #6: if an existing Lead for this Contact + Project is still open/active, the new Enquiry attaches to it (repeat enquiry → doesn't spawn a duplicate Lead) and logs an Activity; if no matching open Lead exists, a new Lead is created from the Enquiry. This makes `Enquiry` the audit trail of "what came in" and `Lead` the working sales record — matching your existing Activity-vs-Task distinction pattern (a record of what happened vs. a record to act on).

**Data model impact:** `Enquiry(id, organizationId, channel, leadSourceId, campaignId, rawPayload JSON, contactId nullable-until-matched, projectId nullable, createdAt)`, `Lead.originEnquiryId` (first enquiry that created it), `Enquiry.linkedLeadId`.

**Workflow impact:** Intake pipeline is uniform across channels: **capture → Contact match (#6) → Lead link-or-create → assignment (#10)**. Channel only affects the *first* step (how the raw data arrives); everything downstream is channel-agnostic.

**Backend/API impact:** One `EnquiryIntake` service/endpoint shape that all four channels funnel into — portal webhooks and integration adapters (#11) translate to this shape; walk-in and phone are agent-entered through the same shape via a form in the CRM itself.

**Frontend/UI impact:** Enquiry appears as a sub-record/timeline entry on the Lead it's linked to; a raw "unmatched enquiries" queue for payloads that failed Contact matching (e.g., missing phone) needs manual agent resolution.

**V1 scope:** `Enquiry` entity, uniform intake pipeline, repeat-enquiry linking logic.

**Future scope:** Enquiry-level analytics/funnel dashboards, automatic quality scoring of incoming enquiries.

**Final decision:** `Enquiry` is a separate, first-class entity. This resolves the explicitly flagged gap and is necessary — folding this into Lead would either lose intake-channel fidelity or bloat Lead with intake-specific fields it doesn't otherwise need.

---

### #39 — RERA & Regulatory Compliance Guardrails

**Problem:** Not represented anywhere in the original checklist. The CRM handles booking amounts, agreements, and payments for what is, for many customers of this product, RERA-registered project sales in India. <cite index="8-1">Under RERA, developers cannot legally collect booking amounts before project registration</cite>, and the payment-cap issue is already addressed under #13.

**Why it matters:** This isn't a "nice compliance feature" — it's the difference between the CRM being usable by a real developer/broker in India without exposing them to regulatory penalty, and being a generic CRM that happens to sell real estate.

**Edge cases:** secondary/resale transactions where RERA's primary-sale rules don't apply the same way; pre-launch EOI collection <cite index="8-1">which is a distinct, earlier stage than formal RERA-compliant booking</cite> and needs to be tracked separately so it isn't mistaken for an official booking; multi-state operation, since <cite index="6-1">refund and compliance timelines are set by each State's RERA authority individually</cite>, not uniformly at the central level.

**Recommended solution:** Three concrete additions, kept minimal and data-driven rather than building a compliance engine: (1) the pre-agreement payment cap guard already specified in #13; (2) a `Project.rraRegistrationStatus` and `Project.rraRegistrationNumber` field so the system knows whether a project can legally accept bookings at all, with booking creation blocked (again, override-with-audit, not a hard block) if unregistered; (3) an explicit `EOI` (Expression of Interest) stage/type kept structurally distinct from `Booking`, so pre-launch interest capture <cite index="8-1">doesn't get mistaken for an official RERA-compliant booking</cite> in reporting or in customer-facing communication.

**Data model impact:** `Project.rraRegistrationStatus`, `Project.rraRegistrationNumber`, `Project.stateJurisdiction` (drives which state's percentage/timeline config applies, per #13's `preAgreementCapPercent`), `Deal.dealType: EOI | FORMAL_BOOKING`.

**Workflow impact:** EOI stage is a distinct, low-commitment entry point that can lead into the standard pipeline (#7) once a project is registered and the customer proceeds to a formal booking — it isn't a pipeline stage, it's a pre-pipeline state.

**Backend/API impact:** Same override-with-audit pattern as #13's cap guard, applied to registration-status blocking.

**Frontend/UI impact:** Clear visual distinction between EOI and confirmed Booking anywhere both appear (dashboards, customer-facing documents).

**V1 scope:** Registration status field + guard, EOI as a distinct type, tie-in to #13's cap logic.

**Future scope:** Per-state rule tables beyond the payment cap, automated escrow reconciliation, TDS-threshold flagging <cite index="10-1">for transactions above the applicable threshold</cite>.

**Final decision:** New checkpoint #39, necessary. This is a case where the practical solution is clear and citable (not a vague "further research required") — the specific percentages and thresholds are set by statute and by each State RERA authority, so the *architecture* just needs to model them as configuration, not hardcode a single number nationally.

---

### #40 — Requirement Entity & Lead-to-Inventory Matching

**Problem:** "Requirement" is mentioned in your own scope list but has no defined data model. A customer's stated interest ("2BHK, budget ₹80L–1Cr, Project X or Y, ready-to-move preferred") is distinct from any single Lead or Deal, and is the thing that actually drives which units get shown to them and which future projects they might be re-engaged for.

**Why it matters:** Without a Requirement entity, "what is this customer actually looking for" lives only in unstructured Activity notes, which means agents can't filter/search customers by requirement, and cross-project interest (explicitly mentioned in your own #20 notes) has nowhere structured to live.

**Recommended solution:** `Requirement` belongs to a Contact (not a Lead — a customer's requirement can outlive a specific lead/project engagement and inform future ones), with structured fields for the common filters (unit type, budget range, preferred project(s)/location, possession timeline) plus free-text notes. A Lead or Deal can reference the Requirement that generated it.

**Data model impact:** `Requirement(id, contactId, unitTypePreference, budgetMin, budgetMax, preferredProjectIds[], possessionPreference, notes, createdAt)`, `Lead.requirementId` (nullable).

**Workflow impact:** Enquiry intake (#38) can create or update a Requirement alongside the Lead; agents can query "who has an open requirement matching Project Z's newly released units" for re-engagement.

**Backend/API impact:** Simple filtered query, not a matching/recommendation engine — V1 doesn't need scoring or ML matching, just structured filterable fields.

**V1 scope:** The entity and structured fields above, basic filter query support.

**Future scope:** Automated match-and-notify when new inventory fits an open Requirement.

**Final decision:** New checkpoint #40, necessary — this closes a real gap between your stated scope ("requirements") and the actual data model as decided so far.

---

### #41 — Channel Partner / Co-Broking & Commission Tracking

**Problem:** Not discussed anywhere, but structurally significant in the Indian market: a meaningful share of leads and closings in Indian real estate flow through external channel partners/brokers (not just in-house agents), who are commercially distinct from employees — they need attribution and commission tracking, not CRM login/assignment the same way an in-house agent gets.

**Why it matters:** If this isn't modeled from the start, "which channel partner sourced this deal" ends up as an unstructured note, and commission calculation becomes a manual spreadsheet exercise outside the system — exactly the kind of gap that looks minor in V1 and becomes a painful retrofit once deals are flowing.

**Recommended solution:** `ChannelPartner` as a lightweight organization-scoped entity (name, contact info, commission structure reference), distinct from `User`/`Agent` (a channel partner does not get CRM system access in V1 — they're a reference/attribution record, not an authenticated actor). `Lead.channelPartnerId` (nullable) captures attribution at intake. Commission *calculation and payout* is explicitly out of V1 scope (that's closer to an accounting/ERP function), but the attribution data point is captured from day one so it exists when that capability is built.

**Data model impact:** `ChannelPartner(id, organizationId, name, contactInfo, commissionStructureNotes)`, `Lead.channelPartnerId`.

**Workflow impact:** Enquiry intake (#38) captures channel partner attribution when applicable, same as `LeadSource`.

**V1 scope:** The attribution entity and field only.

**Future scope:** Commission calculation, payout tracking, channel partner portal/self-service access.

**Final decision:** New checkpoint #41, necessary as a data-capture point even though the full commission workflow is explicitly deferred — this is cheap to add now and expensive to retrofit.

---

## PART E — END-TO-END WORKFLOW AUDIT

Walking the full lifecycle against the ten questions (trigger / record change / state change / validation / authorization / transaction / concurrency / retry / failure / resulting state):

| Transition | Trigger | Transaction? | Concurrency risk? | Retry-safe? |
|---|---|---|---|---|
| Enquiry → Lead | Any channel intake (#38) | Yes — Contact match + Lead create/link must be atomic | Two simultaneous enquiries from the same contact could both try to create a Lead — needs the same match-then-create transactional pattern as Reservation | Yes, via idempotency key on intake (#9), especially important for portal webhook retries |
| Lead → Assignment | Lead creation or manual reassign | Yes, with round-robin counter lock (#10) | Concurrent lead creation racing for round-robin "next agent" — needs row-locked counter | Yes |
| Lead → Requirement captured | Agent qualifies lead | No transaction needed (single-entity write) | None | N/A |
| Lead → Deal | Agent converts qualified lead | Yes — Deal creation should reference and not duplicate Lead's Requirement/Contact data | Low | Yes |
| Deal → Site Visit scheduled | Agent action | Yes — slot lock (#14) | Real — same agent/property double-booking | Yes, via idempotency key |
| Deal stage transitions | Agent action, validated against allowed-transitions map (#7) | Yes (state + audit log together) | Low (single Deal, single agent typically) | Yes |
| Deal → Reservation | Agent action | Yes — row lock on Unit (#8) | Real — this is the highest-contention path in the system | Yes, idempotency key mandatory |
| Reservation → expiry | Scheduled job + transaction-time recheck (#4) | Yes | Handled by #8's lock pattern | Job itself must be safe to re-run (idempotent expiry check) |
| Reservation → Booking | Agent action, requires #39 registration-status check | Yes | Low (Unit already locked to this reservation) | Yes |
| Booking → Payment Plan generated | System, on booking confirmation | Yes | Low | Yes |
| Payment Plan → Payment request | Agent or scheduled (installment due) | No hard DB transaction needed for request generation itself; the cap check (#13) runs here | Low | Yes |
| Payment request → Payment Record (webhook) | External gateway webhook | Yes — webhook processing must be transactional and idempotent (#33 outbox pattern applies in reverse: inbound webhook → idempotent processing) | Real — duplicate webhook delivery is common with real payment gateways | Mandatory — this is the single most important idempotency point in the system |
| Document upload → verification | Agent/customer upload, then Ops/Admin review (#12) | Yes for the verify/reject transition + audit log | Low | Yes |
| Agent deactivation → reassignment | Manager action (#21) | Yes for access revocation; reassignment itself can be multi-step, not required to be one transaction | Low | N/A (human-driven) |

**Contradiction found and resolved:** the original model implicitly treated "Site Visit scheduled" as something that might gate Deal stage progression. Per your existing decision (Site Visit is a separate entity, not a Deal stage) and the #7 resolution above, this is now explicit: `SITE_VISIT_SCHEDULED` is a display-convenience stage marker only, the backend does not require a completed site visit to progress a Deal to `NEGOTIATION` or beyond. This was worth stating explicitly because the two decisions (Site Visit as separate entity; a stage literally named "Site Visit Scheduled") could otherwise be read as contradictory by an implementing developer.

---

## PART F — SAAS / SCALE REVIEW

**Small broker / individual team:** Shared Postgres + `organizationId` is more than sufficient — single-digit-to-low-hundreds of users, no scale concern at all.

**Mid-size organization (tens to low hundreds of agents):** Still comfortably within shared Postgres. The indexing discipline (#15/#30) and mandatory `organizationId`-scoping enforcement (#19 addition above) is what actually matters at this tier, not the tenancy model itself.

**Larger organizations (hundreds of agents within one tenant):** This is a within-tenant scale question, not a multi-tenant one — the relevant architecture is good indexing, cursor pagination (#31), and background job throughput (#28/#33), all already addressed. No change to the tenancy decision needed.

**Multiple organizations/tenants at platform scale:** This is where sharding becomes a real future question — but the trigger for needing it is aggregate data volume/query load across all tenants combined, not the tenant count itself. Shared Postgres with proper indexing and `organizationId` as the leading key on major tables (per the #19 addition) comfortably scales to a large number of tenants before this becomes a bottleneck; when/if it does, the natural migration path is sharding *by* `organizationId` (each tenant's data lives entirely within one shard), which is exactly why enforcing `organizationId` as a mandatory, consistently-present, indexed column on every tenant table now is the single most important thing to get right for future sharding — retrofitting a scattered schema to be shard-friendly later is far more painful than building it in from day one.

**Verdict:** #19 stands as CLOSED for V1. Shared Postgres is correct at every scale tier realistically expected for this product in the near-to-medium term, and the schema discipline required to make future sharding viable is cheap to enforce now and expensive to add retroactively — this is the "leave a sensible path" requirement satisfied without building sharding infrastructure nobody needs yet.

---

## PART G — SCOPE & OVER-ENGINEERING CHECK

| Component | Verdict |
|---|---|
| Microservices | Rejected — correctly. A monolith (or a small number of coarse services) is the right call at this scale; splitting services now adds operational overhead with no corresponding benefit. |
| Generalized workflow/rules engine | Rejected — correctly, confirmed again in #7/#10/#23 above, where domain-specific rule chains solve the actual need without the engine's overhead. |
| Fuzzy identity/ML dedup | Rejected for V1 (#6) — correctly; deterministic tiered matching with human confirmation is the right level of sophistication right now. |
| Search infrastructure (Elasticsearch etc.) | Not currently justified — Postgres full-text search (`tsvector`) and indexed filtering (#31) cover CRM-scale search needs (leads, contacts, deals) without adding a second datastore to operate. Flag for future reconsideration only if free-text search over large documents/notes becomes a heavily used feature. |
| Sharding now | Rejected for V1 (#19/Part F) — correctly deferred, with the schema discipline to make it viable later. |
| Compliance/RERA engine | Rejected in favor of targeted guardrails (#39) — a small number of config fields and validation checks, not a rules engine, matching your stated philosophy. |
| Custom observability stack | Rejected (#36, confirmed) — standard managed tooling is sufficient. |

No under-engineering found in the areas reviewed — every rejected component above was rejected in favor of a specific, named simpler mechanism (rule chains, config fields, standard indexing), not simply left unaddressed.

---

## PART H — PRIORITIZATION

**P0 — Must resolve before implementation begins**
- #7 Deal pipeline stages (spine of the sales workflow — everything else references it)
- #38 Enquiry entity + intake pipeline (affects the shape of Lead creation everywhere)
- #6 Contact deduplication matching tiers (affects Enquiry/Lead creation correctness)
- #13/#39 RERA payment cap guard + registration status (legal exposure if missed)
- #19 addition: ORM-level tenant scoping enforcement mechanism (security-critical, must be in place before any tenant-scoped code is written)

**P1 — Must resolve during V1 implementation**
- #10 Lead assignment rule chain
- #14 Site visit resource/concurrency model
- #18 Role/permission/scope catalogue
- #12 Document verification gating
- #5 Unit availability enum extension (ON_HOLD/BLOCKED)
- #16/#17 Tier 1/Tier 2 retention classification

**P2 — Important, can refine after V1 ships**
- #1/#28 Consent gating and notification lanes (important, but can launch with manual-only communication if timeline pressure is real, then add before any automated send goes live)
- #20 Org/team structure refinement
- #21 Agent lifecycle states
- #22 (confirmed no change needed)
- #40 Requirement entity (valuable early but the CRM functions without it for a short period, with requirement data living in Activity notes temporarily)

**P3 — Future/optional**
- #41 Channel partner commission calculation (attribution field is P1/P0-adjacent since it's cheap; calculation itself is P3)
- #11 Additional platform integrations beyond the first one or two
- Everything explicitly marked "Future scope" throughout this document

**Status classification:**
- **REOPENED and resolved in this document:** #1, #5, #6, #7, #10, #11, #12, #13, #14, #16, #17, #18, #19 (addition only), #20, #21, #22 (closed, no change), #23, #24, #27 (retention addition), #28
- **Remain CLOSED as originally decided, no change:** #4, #8, #9, #15, #25, #26, #29, #30, #31, #32, #33, #34, #35, #36, #37
- **Newly discovered checkpoints:** #38 Enquiry Intake, #39 RERA & Regulatory Compliance, #40 Requirement Entity, #41 Channel Partner/Commission

---

## PART I — CONSOLIDATED DECISION RECORD

*(Format: # | Title | Status | Final Decision — condensed; full reasoning/edge cases/impacts are in Parts A–D above for every entry, not repeated here.)*

| # | Title | Status | Final Decision |
|---|---|---|---|
| 1 | Communication & Follow-up | Reopened, resolved | Add `Contact.communicationConsent`, gate automated sends on it |
| 4 | Reservation Expiry | Closed | Unchanged |
| 5 | Unit Availability SoT | Reopened, resolved | Add `ON_HOLD`/`BLOCKED` states via Reservation-type discriminator |
| 6 | Contact Deduplication | Reopened, resolved | Tiered matching, manual merge only, never automatic |
| 7 | Deal Pipeline Stages | Reopened, resolved | Fixed 9-stage list + `CLOSED_LOST`, backend-validated transitions |
| 8 | Reservation Concurrency | Closed | Unchanged |
| 9 | Idempotency | Closed | Add composite uniqueness including `organizationId` |
| 10 | Lead Assignment | Reopened, resolved | Ordered rule chain, config-driven, manual-override-protected |
| 11 | Lead Sources/Campaigns/Integrations | Reopened, resolved | First-class entities + capability-checked adapters |
| 12 | Document Verification | Reopened, resolved | Lifecycle confirmed, role-gated verify/reject, signed-URL upload |
| 13 | Payment Plans & Payments | Reopened, resolved | Add RERA pre-agreement cap guard tied to `agreementForSaleStatus` |
| 14 | Site Visit Scheduling | Reopened, resolved | Agent + property slot model, transactional booking, agent-marked no-show |
| 15/30 | Indexing | Closed | Unchanged |
| 16 | Soft Delete vs Backup | Reopened, resolved | Two-tier retention: financial/legal records are correction-only |
| 17 | Audit Trail | Reopened, resolved | Tied to two-tier retention above |
| 18 | Security & Access Control | Reopened, resolved | Five fixed roles, configurable permission mapping, centralized enforcement |
| 19 | Multi-Tenancy | Reopened, resolved | Shared Postgres confirmed correct at all realistic scale tiers; add mandatory ORM-level scoping enforcement |
| 20 | Data Ownership/Org Structure | Reopened, resolved | Org → Team (M:M with User) → User; Org → Project → Unit |
| 21 | Agent Lifecycle | Reopened, resolved | ACTIVE/ON_LEAVE/DEACTIVATED, decoupled access-revocation from reassignment |
| 22 | Communication → Deal/Unit Linkage | Reopened, closed unchanged | Current model (Activity → Contact/Lead/Deal) confirmed sufficient |
| 23 | Failure/Non-Happy-Path | Reopened, resolved | Shared minimal cancellation contract applied per domain |
| 24 | Time/Stale State | Reopened, resolved | Consolidated registry table, no new mechanism needed |
| 25 | DB Constraints | Closed | Unchanged |
| 26 | Backup & DR | Closed | Unchanged, tied to retention tiers |
| 27 | File/Document Storage | Reopened, resolved | Tied to two-tier retention |
| 28 | Notifications | Reopened, resolved | Two-lane split (internal/customer-facing), consent-gated |
| 29 | Validation Layering | Closed | Unchanged |
| 31 | Pagination | Closed | Cursor pagination as default for large-dataset endpoints |
| 32 | Failure Handling | Closed | Unchanged |
| 33 | External Side Effects | Closed | Unchanged |
| 34 | Audit Trail Storage | Closed | Unchanged |
| 35 | Data Lifecycle | Closed | Unchanged |
| 36 | Observability | Closed | Unchanged |
| 37 | Testing Strategy | Closed | Unchanged |
| 38 | **Enquiry Intake & Lead Creation** (new) | Resolved | Separate `Enquiry` entity, uniform intake pipeline across channels |
| 39 | **RERA & Regulatory Compliance** (new) | Resolved | Payment cap guard, project registration-status guard, distinct EOI type |
| 40 | **Requirement Entity** (new) | Resolved | Contact-owned `Requirement` with structured filterable fields |
| 41 | **Channel Partner/Commission** (new) | Resolved (attribution only) | `ChannelPartner` attribution entity now, calculation deferred |

---

**Note on RERA sourcing:** the regulatory specifics cited above (10% cap, Section 61 penalties, state-level variation, escrow) reflect current published guidance and are directionally reliable for architecture purposes, but should be confirmed with actual legal counsel before being treated as compliance-complete — an architecture document is not a substitute for that review, it's just making sure the schema doesn't foreclose the correct legal behavior.
