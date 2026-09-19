// Enquiry intake pipeline (Phase 3 #38) + Lead link-or-create + assignment.
// Enquiry = append-only intake event ("what came in"). Lead = working sales
// record. All four channels funnel into intakeEnquiry(); downstream is
// channel-agnostic. Deals/pipeline are explicitly OUT of this checkpoint.
//
// Atomicity: the whole flow runs in ONE transaction (enquiry + contact +
// requirement + lead + assignment + links). No external network calls inside.
//
// Concurrency: (1) the resolved Contact row is SELECT ... FOR UPDATE locked
// so concurrent intakes for the same Contact serialize their Lead
// link-or-create decision; (2) the partial unique index on
// (org, contact, project) WHERE OPEN + not-deleted is the final backstop —
// a residual P2002 aborts the transaction and the outer retry loop re-runs
// the intake (aborted work leaves no trace, so no duplicate Enquiry).
// PostgreSQL aborts a transaction on ANY error, so nothing inside the
// transaction catches P2002 and continues — retries happen OUTSIDE.

const { normalizeEmail, normalizePhone } = require('../contacts/normalization');
const { findStrongMatch, findPossibleMatches, buildMatchSignals } = require('../contacts/dedup');
const { createRequirement } = require('../requirements/service');
const { resolveProject } = require('../property/service');
const { evaluateAssignment } = require('../leads/assignment');
const {
  OPERATION_ENQUIRY_INTAKE,
  canonicalHash,
  IdempotentReplay,
  IdempotencyConflict,
  findRecord,
  recordIdempotency,
  resolveIdempotencyConflict,
} = require('../../lib/idempotency');

const MAX_INTAKE_ATTEMPTS = 3;
const MAX_RAW_PAYLOAD_BYTES = 20 * 1024;

// ---------------------------------------------------------------------------
// Reference validation (same-org, non-deleted). Reads use the tenant client
// (cross-tenant rows invisible -> 404); raw classification distinguishes
// cross-tenant (403) from soft-deleted (400) without leaking existence.
// ---------------------------------------------------------------------------

async function assertIntakeLeadSource({ tx, organizationId, leadSourceId }) {
  if (!leadSourceId) return null;
  const src = await tx.leadSource.findUnique({ where: { id: leadSourceId } });
  if (src) return src;
  const raw = await tx._raw.leadSource.findUnique({ where: { id: leadSourceId } });
  if (raw && raw.organizationId !== organizationId) {
    const err = new Error('Cannot associate enquiry with a lead source from another organization');
    err.statusCode = 403;
    throw err;
  }
  const err = new Error('LeadSource not found');
  err.statusCode = 404;
  throw err;
}

async function assertIntakeCampaign({ tx, organizationId, campaignId, leadSourceId }) {
  if (!campaignId) return null;
  const campaign = await tx.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) {
    const raw = await tx._raw.campaign.findUnique({ where: { id: campaignId } });
    if (raw && raw.organizationId !== organizationId) {
      const err = new Error('Cannot associate enquiry with a campaign from another organization');
      err.statusCode = 403;
      throw err;
    }
    const err = new Error('Campaign not found');
    err.statusCode = 404;
    throw err;
  }
  if (leadSourceId && campaign.leadSourceId && campaign.leadSourceId !== leadSourceId) {
    const err = new Error('Campaign does not belong to the given lead source');
    err.statusCode = 400;
    throw err;
  }
  return campaign;
}

// ---------------------------------------------------------------------------
// Contact resolution inside the intake transaction. Reuses Checkpoint 5
// normalization + tiered matching verbatim — no second implementation.
// PossibleDuplicate is NEVER auto-merged; PENDING rows are a review queue.
// ---------------------------------------------------------------------------

async function resolveContactInTx({ tx, organizationId, input }) {
  const phone = input.phone ? String(input.phone).trim() : null;
  const email = input.email ? String(input.email).trim() : null;
  const normalizedPhone = normalizePhone(phone);
  const normalizedEmail = normalizeEmail(email);

  // Insufficient identity: preserve the enquiry unmatched (contactId null)
  // for the future unmatched-enquiry queue instead of inventing a Contact.
  if (!normalizedPhone && !normalizedEmail) {
    return { contact: null, match: 'UNMATCHED', created: false, possibleDuplicates: [] };
  }

  const name = input.contactName ? String(input.contactName).trim() : null;
  if (!name) {
    const err = new Error('contactName is required when phone or email is provided');
    err.statusCode = 400;
    throw err;
  }

  if (normalizedEmail && normalizedPhone) {
    const strong = await findStrongMatch({ tenantPrisma: tx, normalizedEmail, normalizedPhone });
    if (strong) {
      return { contact: strong, match: 'STRONG', created: false, possibleDuplicates: [] };
    }
    // Deterministic-identity collision with a soft-deleted row: the tenant
    // read hides it but the DB unique index still covers it, so creation
    // would fail. Fail fast with 409 instead of burning retries.
    const retired = await tx._raw.contact.findFirst({
      where: { organizationId, normalizedEmail, normalizedPhone, deletedAt: { not: null } },
    });
    if (retired) {
      const err = new Error('A contact with the same email and phone already exists (deleted)');
      err.statusCode = 409;
      throw err;
    }
  }

  const possible = await findPossibleMatches({ tenantPrisma: tx, normalizedEmail, normalizedPhone });

  // Fresh row: concurrent same-identity creators serialize on the contacts
  // unique index; the loser gets P2002, aborts, and the outer loop retries
  // into the STRONG-reuse path above.
  const contact = await tx.contact.create({
    data: {
      name,
      phone: phone || null,
      normalizedPhone,
      email: email || null,
      normalizedEmail,
      communicationConsent: input.communicationConsent || 'OPTED_IN',
      consentSource: input.consentSource || null,
      consentUpdatedAt: new Date(),
    },
  });

  // Ambiguous single-signal matches -> PENDING review rows (never auto-merge).
  // Pre-check existence instead of catching P2002: any error inside this
  // transaction would abort it.
  const possibleDuplicates = [];
  for (const m of possible) {
    const aId = m.id < contact.id ? m.id : contact.id;
    const bId = m.id < contact.id ? contact.id : m.id;
     
    const exists = await tx.possibleDuplicate.findFirst({ where: { contactAId: aId, contactBId: bId } });
    if (exists) continue;
     
    const created = await tx.possibleDuplicate.create({
      data: {
        contactAId: aId,
        contactBId: bId,
        matchSignal: `${buildMatchSignals({ normalizedEmail, normalizedPhone, name })} vs ${buildMatchSignals({ normalizedEmail: m.normalizedEmail, normalizedPhone: m.normalizedPhone, name: m.name })}`,
        status: 'PENDING',
      },
    });
    possibleDuplicates.push(created);
  }

  return { contact, match: possible.length > 0 ? 'POSSIBLE' : 'NONE', created: true, possibleDuplicates };
}

async function lockContactRow({ tx, contactId }) {
  await tx._raw.$queryRaw`SELECT "id" FROM "contacts" WHERE "id" = ${contactId} FOR UPDATE`;
}

async function findOpenLeadForUpdate({ tx, organizationId, contactId, projectId }) {
  const rows = await tx._raw.$queryRaw`
    SELECT "id" FROM "leads"
    WHERE "organizationId" = ${organizationId}
      AND "contactId" = ${contactId}
      AND "projectId" = ${projectId}
      AND "status" = 'OPEN'
      AND "deletedAt" IS NULL
    FOR UPDATE
  `;
  if (!rows || rows.length === 0) return null;
  return tx.lead.findUnique({ where: { id: rows[0].id } });
}

// ---------------------------------------------------------------------------
// Single intake attempt (runs inside one transaction).
// ---------------------------------------------------------------------------

async function runIntakeTransaction({ tenantPrisma, organizationId, idempotencyKey, requestHash, input }) {
  return tenantPrisma.$transaction(
    async (tx) => {
      if (JSON.stringify(input.rawPayload || {}).length > MAX_RAW_PAYLOAD_BYTES) {
        const err = new Error('rawPayload exceeds 20KB');
        err.statusCode = 400;
        throw err;
      }

      await assertIntakeLeadSource({ tx, organizationId, leadSourceId: input.leadSourceId });
      await assertIntakeCampaign({
        tx,
        organizationId,
        campaignId: input.campaignId,
        leadSourceId: input.leadSourceId,
      });
      let project = null;
      if (input.projectId) {
        project = await resolveProject({
          tenantPrisma: tx,
          organizationId,
          projectId: input.projectId,
          action: 'attach an enquiry to',
        });
      }

      const resolved = await resolveContactInTx({ tx, organizationId, input });

      // Unmatched intake: preserve the event, no Contact, no Lead.
      if (!resolved.contact) {
        const enquiry = await tx.enquiry.create({
          data: {
            channel: input.channel,
            leadSourceId: input.leadSourceId || null,
            campaignId: input.campaignId || null,
            rawPayload: { ...(input.rawPayload || {}), _unmatchedReason: 'insufficient-identity' },
            contactId: null,
            projectId: project ? project.id : null,
            linkedLeadId: null,
          },
        });
        const body = { enquiry, lead: null, contact: null, contactMatch: 'UNMATCHED', requirement: null };
        if (idempotencyKey) {
          await recordIdempotency({
            tx,
            organizationId,
            key: idempotencyKey,
            operationType: OPERATION_ENQUIRY_INTAKE,
            requestHash,
            responseBody: body,
          });
        }
        return body;
      }

      const { contact } = resolved;
      // Serialize this Contact's Lead link-or-create decision.
      await lockContactRow({ tx, contactId: contact.id });

      // Requirement belongs to Contact, not Lead. Intake-supplied requirement
      // data always creates a NEW requirement row (stated-need history); it
      // is linked onto the Lead only when the Lead has none yet.
      let requirement = null;
      if (input.requirement) {
        requirement = await createRequirement({
          tenantPrisma: tx,
          organizationId,
          data: { contactId: contact.id, ...input.requirement },
        });
      }

      const enquiry = await tx.enquiry.create({
        data: {
          channel: input.channel,
          leadSourceId: input.leadSourceId || null,
          campaignId: input.campaignId || null,
          rawPayload: input.rawPayload || {},
          contactId: contact.id,
          projectId: project ? project.id : null,
          linkedLeadId: null,
        },
      });

      let lead;
      let leadCreated = false;
      if (project) {
        const existing = await findOpenLeadForUpdate({
          tx,
          organizationId,
          contactId: contact.id,
          projectId: project.id,
        });
        if (existing) {
          lead = existing;
          // Repeat enquiry: attach to the OPEN Lead. Assignment is never
          // re-run over an assigned Lead (manual always wins).
          if (requirement && !lead.requirementId) {
            lead = await tx.lead.update({ where: { id: lead.id }, data: { requirementId: requirement.id } });
          }
        } else {
          leadCreated = true;
        }
      } else {
        // Project-less enquiries intentionally create a fresh Lead each time
        // (no stable engagement identity without a Project).
        leadCreated = true;
      }

      if (leadCreated) {
        // Create first with UNASSIGNED, then evaluate assignment inside the
        // same transaction (row-locked round-robin counter).
        lead = await tx.lead.create({
          data: {
            contactId: contact.id,
            projectId: project ? project.id : null,
            requirementId: requirement ? requirement.id : null,
            leadSourceId: input.leadSourceId || null,
            campaignId: input.campaignId || null,
            originEnquiryId: enquiry.id,
            assignmentSource: 'UNASSIGNED',
          },
        });
        const assignment = await evaluateAssignment({ tx, organizationId, lead });
        lead = await tx.lead.update({
          where: { id: lead.id },
          data: {
            assignedAgentId: assignment.assignedAgentId,
            assignmentSource: assignment.assignmentSource,
            assignedAt: assignment.assignedAt,
          },
        });
      }

      await tx.enquiry.update({ where: { id: enquiry.id }, data: { linkedLeadId: lead.id } });

      const body = {
        enquiry: { ...enquiry, linkedLeadId: lead.id },
        lead,
        contact,
        contactMatch: resolved.match,
        contactCreated: resolved.created,
        possibleDuplicates: resolved.possibleDuplicates,
        requirement,
      };
      if (idempotencyKey) {
        await recordIdempotency({
          tx,
          organizationId,
          key: idempotencyKey,
          operationType: OPERATION_ENQUIRY_INTAKE,
          requestHash,
          responseBody: body,
        });
      }
      return body;
    },
    { timeout: 15000, maxWait: 5000 }
  );
}

// ---------------------------------------------------------------------------
// Public entry: idempotent, race-safe intake.
// ---------------------------------------------------------------------------

async function intakeEnquiry({ tenantPrisma, organizationId, idempotencyKey, input }) {
  const requestHash = canonicalHash(input);

  if (idempotencyKey) {
    const existing = await findRecord({
      client: tenantPrisma,
      organizationId,
      key: idempotencyKey,
      operationType: OPERATION_ENQUIRY_INTAKE,
    });
    if (existing) {
      if (existing.requestHash !== requestHash) throw new IdempotencyConflict();
      throw new IdempotentReplay(existing.responseSnapshot);
    }
  }

  let lastConflict = null;
  for (let attempt = 1; attempt <= MAX_INTAKE_ATTEMPTS; attempt += 1) {
    try {
      return await runIntakeTransaction({ tenantPrisma, organizationId, idempotencyKey, requestHash, input });
    } catch (err) {
      if (err.code === 'P2002' && attempt < MAX_INTAKE_ATTEMPTS) {
        // Aborted transaction left no trace. If the winner was an idempotent
        // commit of the SAME key, replay it; otherwise re-resolve and retry.
        if (idempotencyKey) {
          try {
             
            await resolveIdempotencyConflict({
              tx: tenantPrisma,
              organizationId,
              key: idempotencyKey,
              operationType: OPERATION_ENQUIRY_INTAKE,
              requestHash,
            });
          } catch (resolveErr) {
            if (resolveErr instanceof IdempotentReplay || resolveErr instanceof IdempotencyConflict) throw resolveErr;
            // No idempotency record won (data race) -> fall through to retry.
          }
        }
        lastConflict = err;
        continue;
      }
      throw err;
    }
  }
  const err = new Error('Concurrent intake conflict, please retry');
  err.statusCode = 409;
  err.cause = lastConflict;
  throw err;
}

async function getEnquiry({ tenantPrisma, enquiryId }) {
  const row = await tenantPrisma.enquiry.findUnique({ where: { id: enquiryId } });
  if (!row) {
    const err = new Error('Enquiry not found');
    err.statusCode = 404;
    throw err;
  }
  return row;
}

async function listEnquiries({ tenantPrisma, filters = {}, limit = 20, offset = 0 }) {
  const where = {};
  for (const key of ['channel', 'contactId', 'projectId', 'leadSourceId', 'campaignId', 'linkedLeadId']) {
    if (filters[key] !== undefined) where[key] = filters[key];
  }
  return tenantPrisma.enquiry.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100),
    skip: offset,
  });
}

module.exports = {
  intakeEnquiry,
  getEnquiry,
  listEnquiries,
};
