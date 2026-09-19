const { normalizeEmail, normalizePhone } = require('./normalization');
const { findStrongMatch, findPossibleMatches, buildMatchSignals } = require('./dedup');

async function createContact({ tenantPrisma, organizationId, data }) {
  const name = data.name?.trim();
  if (!name) {
    const err = new Error('Name is required');
    err.statusCode = 400;
    throw err;
  }

  const phone = data.phone ? String(data.phone).trim() : null;
  const email = data.email ? String(data.email).trim() : null;
  const normalizedPhone = normalizePhone(phone);
  const normalizedEmail = normalizeEmail(email);
  const communicationConsent = data.communicationConsent || 'OPTED_IN';
  const consentSource = data.consentSource || null;

  // Validate at least one identifier? Allow name-only for now, but document
  // If both phone and email are null, we skip dedup and directly create

  // Check strong match (deterministic duplicate)
  let strongExisting = null;
  if (normalizedEmail && normalizedPhone) {
    strongExisting = await findStrongMatch({ tenantPrisma, normalizedEmail, normalizedPhone });
    if (strongExisting) {
      // Prevent duplicate creation — return existing with signal
      const err = new Error('Contact with same email and phone already exists');
      err.statusCode = 409;
      err.existingContact = strongExisting;
      err.matchType = 'STRONG';
      throw err;
    }
  }

  // Check possible matches (single signal)
  const possibleMatches = await findPossibleMatches({ tenantPrisma, normalizedEmail, normalizedPhone });
  // Filter out the strong match if it was found (already handled), but we already returned
  // For ambiguous, we will create new contact but also flag

  // Attempt to create — rely on DB composite unique as final guard for race
  let contact;
  try {
    contact = await tenantPrisma.contact.create({
      data: {
        name,
        phone: phone || null,
        normalizedPhone,
        email: email || null,
        normalizedEmail,
        communicationConsent,
        consentSource,
        consentUpdatedAt: new Date(),
      },
    });
  } catch (err) {
    if (err.code === 'P2002') {
      // Race: another request created same deterministic duplicate concurrently
      // Find the existing that caused violation
      const existing = await findStrongMatch({ tenantPrisma, normalizedEmail, normalizedPhone });
      if (existing) {
        const e = new Error('Contact with same email and phone already exists (concurrent)');
        e.statusCode = 409;
        e.existingContact = existing;
        e.matchType = 'STRONG';
        throw e;
      }
      // If not strong, it may be unique violation on (org, email, phone) where one is null? But Prisma unique with nulls shouldn't conflict, so this is unexpected
      throw err;
    }
    throw err;
  }

  // For ambiguous, create PossibleDuplicate entries for each possible match
  let possibleDuplicates = [];
  if (possibleMatches.length > 0) {
    // Create PossibleDuplicate records for review queue
    // Use transaction to create all
    const toCreate = possibleMatches.map((m) => ({
      organizationId,
      contactAId: m.id,
      contactBId: contact.id,
      matchSignal: buildMatchSignals({ normalizedEmail, normalizedPhone }) + ' vs ' + buildMatchSignals({ normalizedEmail: m.normalizedEmail, normalizedPhone: m.normalizedPhone, name: m.name }),
      status: 'PENDING',
    }));
    // Use raw prisma with organizationId injection via tenantPrisma? Use tenantPrisma for each
    // Create sequentially to handle ordering (ensure contactAId < contactBId lexical to avoid duplicate ordering issues? But unique is on (org, A, B) ordered, so A->B and B->A are different. We should ensure consistent ordering: smaller id first)
    for (const pd of toCreate) {
      // Ensure consistent ordering to avoid duplicate reverse entries
      let aId = pd.contactAId;
      let bId = pd.contactBId;
      if (aId > bId) {
        // swap to keep lexical order, but keep matchSignal
        [aId, bId] = [bId, aId];
      }
      try {
        const created = await tenantPrisma.possibleDuplicate.create({
          data: {
            contactAId: aId,
            contactBId: bId,
            matchSignal: pd.matchSignal,
            status: 'PENDING',
          },
        });
        possibleDuplicates.push(created);
      } catch (e) {
        // Ignore duplicate PossibleDuplicate unique violation (if already exists)
        if (e.code !== 'P2002') throw e;
      }
    }
  }

  return { contact, possibleDuplicates, matchType: possibleMatches.length > 0 ? 'POSSIBLE' : 'NONE' };
}

async function getContact({ tenantPrisma, contactId }) {
  const contact = await tenantPrisma.contact.findUnique({ where: { id: contactId } });
  if (!contact) {
    const err = new Error('Contact not found');
    err.statusCode = 404;
    throw err;
  }
  return contact;
}

async function listContacts({ tenantPrisma, search, limit = 20, offset = 0 }) {
  const where = {};
  if (search) {
    const term = search.trim();
    // Simple search via OR on name, email, phone, normalized fields
    // Use case-insensitive contains via mode insensitive
    where.OR = [
      { name: { contains: term, mode: 'insensitive' } },
      { email: { contains: term, mode: 'insensitive' } },
      { phone: { contains: term, mode: 'insensitive' } },
      { normalizedEmail: { contains: term.toLowerCase(), mode: 'insensitive' } },
      { normalizedPhone: { contains: term.replace(/\D/g, ''), mode: 'insensitive' } },
    ];
  }
  const contacts = await tenantPrisma.contact.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100),
    skip: offset,
  });
  return contacts;
}

async function updateContact({ tenantPrisma, organizationId: _organizationId, contactId, data }) {
  const existing = await tenantPrisma.contact.findUnique({ where: { id: contactId } });
  if (!existing) {
    const err = new Error('Contact not found');
    err.statusCode = 404;
    throw err;
  }

  const updateData = {};
  if (data.name !== undefined) updateData.name = data.name.trim();
  if (data.phone !== undefined) {
    const phone = data.phone ? String(data.phone).trim() : null;
    updateData.phone = phone;
    updateData.normalizedPhone = normalizePhone(phone);
  }
  if (data.email !== undefined) {
    const email = data.email ? String(data.email).trim() : null;
    updateData.email = email;
    updateData.normalizedEmail = normalizeEmail(email);
  }
  if (data.communicationConsent !== undefined) {
    updateData.communicationConsent = data.communicationConsent;
    updateData.consentUpdatedAt = new Date();
    if (data.consentSource !== undefined) updateData.consentSource = data.consentSource;
  } else if (data.consentSource !== undefined) {
    updateData.consentSource = data.consentSource;
  }

  if (Object.keys(updateData).length === 0) {
    const err = new Error('No valid fields to update');
    err.statusCode = 400;
    throw err;
  }

  // Determine new normalized values for dedup check
  const newNormalizedEmail = updateData.normalizedEmail !== undefined ? updateData.normalizedEmail : existing.normalizedEmail;
  const newNormalizedPhone = updateData.normalizedPhone !== undefined ? updateData.normalizedPhone : existing.normalizedPhone;

  // Check for deterministic collision (excluding self)
  if (newNormalizedEmail && newNormalizedPhone) {
    const strong = await findStrongMatch({ tenantPrisma, normalizedEmail: newNormalizedEmail, normalizedPhone: newNormalizedPhone });
    if (strong && strong.id !== contactId) {
      const err = new Error('Another contact with same email and phone already exists');
      err.statusCode = 409;
      err.existingContact = strong;
      throw err;
    }
  }

  // Check for ambiguous matches (excluding self) — we will not block update, but we will create PossibleDuplicate entries for review
  // Perform update first, then create PossibleDuplicate if needed
  try {
    const updated = await tenantPrisma.contact.update({ where: { id: contactId }, data: updateData });
    // After successful update, check for possible matches (excluding self) and create PossibleDuplicate if any
    if (newNormalizedEmail || newNormalizedPhone) {
      const possible = await findPossibleMatches({ tenantPrisma, normalizedEmail: newNormalizedEmail, normalizedPhone: newNormalizedPhone, excludeId: contactId });
      // Filter out the strong match already handled (if any) — but we already ensured no strong exists, so all possible are ambiguous
      for (const m of possible) {
        let aId = m.id;
        let bId = updated.id;
        if (aId > bId) [aId, bId] = [bId, aId];
        try {
          await tenantPrisma.possibleDuplicate.create({
            data: {
              contactAId: aId,
              contactBId: bId,
              matchSignal: `UPDATE:${buildMatchSignals({ normalizedEmail: newNormalizedEmail, normalizedPhone: newNormalizedPhone })}`,
              status: 'PENDING',
            },
          });
        } catch (e) {
          if (e.code !== 'P2002') throw e;
        }
      }
    }
    return updated;
  } catch (err) {
    if (err.code === 'P2002') {
      const e = new Error('Contact with same email and phone already exists');
      e.statusCode = 409;
      throw e;
    }
    throw err;
  }
}

async function deleteContact({ tenantPrisma, contactId }) {
  const existing = await tenantPrisma.contact.findUnique({ where: { id: contactId } });
  if (!existing) {
    const err = new Error('Contact not found');
    err.statusCode = 404;
    throw err;
  }
  // Check if contact has active requirements? For V1, we allow soft delete even with requirements, but requirements will remain and be filtered via contact's deletedAt check in requirement service
  const deleted = await tenantPrisma.contact.update({ where: { id: contactId }, data: { deletedAt: new Date() } });
  return deleted;
}

async function mergeContacts({ tenantPrisma, organizationId, survivorId, duplicateId }) {
  if (survivorId === duplicateId) {
    const err = new Error('Cannot merge contact with itself');
    err.statusCode = 400;
    throw err;
  }
  const [survivor, duplicate] = await Promise.all([
    tenantPrisma.contact.findUnique({ where: { id: survivorId } }),
    tenantPrisma.contact.findUnique({ where: { id: duplicateId } }),
  ]);
  if (!survivor || !duplicate) {
    // Tenant reads filter out soft-deleted rows, so a null here is ambiguous:
    // it can mean "never existed / other tenant" OR "already merged/soft-deleted".
    // Use a raw lookup to distinguish so a repeated merge returns 409 (not 404).
    const raw = tenantPrisma._raw;
    if (!duplicate) {
      const rawDup = await raw.contact.findUnique({ where: { id: duplicateId } });
      if (rawDup && rawDup.organizationId === organizationId && rawDup.deletedAt) {
        const err = new Error('This contact has already been merged');
        err.statusCode = 409;
        throw err;
      }
      if (rawDup && rawDup.organizationId !== organizationId) {
        const err = new Error('Cross-tenant merge not allowed');
        err.statusCode = 403;
        throw err;
      }
    }
    if (!survivor) {
      const rawSurv = await raw.contact.findUnique({ where: { id: survivorId } });
      if (rawSurv && rawSurv.organizationId === organizationId && rawSurv.deletedAt) {
        const err = new Error('Cannot merge into a soft-deleted contact');
        err.statusCode = 400;
        throw err;
      }
      if (rawSurv && rawSurv.organizationId !== organizationId) {
        const err = new Error('Cross-tenant merge not allowed');
        err.statusCode = 403;
        throw err;
      }
    }
    const err = new Error('One or both contacts not found');
    err.statusCode = 404;
    throw err;
  }
  // Both must belong to same org (tenantPrisma already ensures, but double-check)
  if (survivor.organizationId !== organizationId || duplicate.organizationId !== organizationId) {
    const err = new Error('Cross-tenant merge not allowed');
    err.statusCode = 403;
    throw err;
  }
  if (survivor.deletedAt || duplicate.deletedAt) {
    const err = new Error('Cannot merge soft-deleted contacts');
    err.statusCode = 400;
    throw err;
  }

  // Transaction: lock the source Contact row BEFORE the final mergeable check,
  // then re-read inside the lock, migrate all Contact-owned relations,
  // soft-delete source, update PossibleDuplicate statuses. The competing transaction blocks on the
  // lock; after acquiring it, it observes the completed merge and returns 409.
  const result = await tenantPrisma.$transaction(
    async (tx) => {
      // Acquire the authoritative row-level lock on the source contact.
      // Plain findUnique does NOT lock — without FOR UPDATE both concurrent
      // transactions read deletedAt=null before either commits (READ COMMITTED).
      const lockedRows = await tx._raw.$queryRaw`
        SELECT "id", "organizationId", "deletedAt"
        FROM "contacts"
        WHERE "id" = ${duplicateId}
        FOR UPDATE
      `;
      const lockedDup = lockedRows && lockedRows[0];
      if (!lockedDup) {
        const err = new Error('One or both contacts not found');
        err.statusCode = 404;
        throw err;
      }
      if (lockedDup.organizationId !== organizationId) {
        const err = new Error('Cross-tenant merge not allowed');
        err.statusCode = 403;
        throw err;
      }
      if (lockedDup.deletedAt) {
        const err = new Error('This contact has already been merged');
        err.statusCode = 409;
        throw err;
      }

      // Re-validate the survivor inside the same transaction (raw read so a
      // concurrently soft-deleted survivor is visible instead of filtered).
      const freshSurvivor = await tx._raw.contact.findUnique({ where: { id: survivorId } });
      if (!freshSurvivor || freshSurvivor.organizationId !== organizationId) {
        const err = new Error('One or both contacts not found');
        err.statusCode = 404;
        throw err;
      }
      if (freshSurvivor.deletedAt) {
        const err = new Error('Cannot merge into a soft-deleted contact');
        err.statusCode = 400;
        throw err;
      }

      // Move requirements
      await tx.requirement.updateMany({
        where: { contactId: duplicateId, organizationId },
        data: { contactId: survivorId },
      });

      // Reassign every other Contact-owned relation to the survivor BEFORE
      // soft-delete, or active records would point at a contact that tenant
      // reads no longer expose. All writes are org-scoped; any failure rolls
      // back the whole merge. Link fields (linkedLeadId, origin, deal lead,
      // visit deal) are untouched — history is preserved, not rewritten.

      // Enquiries (contactId optional; unmatched null-contact rows unaffected).
      await tx.enquiry.updateMany({
        where: { contactId: duplicateId, organizationId },
        data: { contactId: survivorId },
      });

      // Leads: conflicting OPEN leads (survivor holds an OPEN lead on the
      // same non-null project) move as DISQUALIFIED — a reconciliation
      // parking state, not a sales verdict (see DEC-028). Everything else
      // keeps its status; project-less OPEN leads never conflict by design.
      const dupLeads = await tx.lead.findMany({
        where: { contactId: duplicateId, organizationId },
        select: { id: true, projectId: true, status: true, deletedAt: true },
      });
      const conflictingIds = [];
      for (const lead of dupLeads) {
        if (lead.status !== 'OPEN' || lead.deletedAt || !lead.projectId) continue;
        const clash = await tx.lead.findFirst({
          where: { contactId: survivorId, organizationId, projectId: lead.projectId, status: 'OPEN' },
          select: { id: true },
        });
        if (clash) conflictingIds.push(lead.id);
      }
      if (conflictingIds.length > 0) {
        await tx.lead.updateMany({
          where: { organizationId, id: { in: conflictingIds } },
          data: { contactId: survivorId, status: 'DISQUALIFIED' },
        });
      }
      await tx.lead.updateMany({
        where: { contactId: duplicateId, organizationId, NOT: { id: { in: conflictingIds } } },
        data: { contactId: survivorId },
      });

      // Deals: their leads moved above to the same contact, so the
      // lead.contactId === deal.contactId invariant holds post-move.
      await tx.deal.updateMany({
        where: { contactId: duplicateId, organizationId },
        data: { contactId: survivorId },
      });

      // Site visits: paired deals move in the same transaction.
      await tx.siteVisit.updateMany({
        where: { contactId: duplicateId, organizationId },
        data: { contactId: survivorId },
      });
      // Soft delete duplicate, store merge metadata in consentSource? For V1, use deletedAt + notes
      const mergedDuplicate = await tx.contact.update({
        where: { id: duplicateId },
        data: { deletedAt: new Date(), consentSource: `merged_into:${survivorId}` },
      });
      // Update PossibleDuplicate statuses for this pair to CONFIRMED_SAME
      // Find possible duplicates involving these two
      await tx.possibleDuplicate.updateMany({
        where: {
          organizationId,
          OR: [
            { contactAId: survivorId, contactBId: duplicateId },
            { contactAId: duplicateId, contactBId: survivorId },
          ],
        },
        data: { status: 'CONFIRMED_SAME' },
      });
      // Also update any other PossibleDuplicates where duplicate was involved to reflect merge? For V1, keep simple
      return { survivor, duplicate: mergedDuplicate };
    },
    { timeout: 10000, maxWait: 5000 }
  );

  return result;
}

module.exports = {
  createContact,
  getContact,
  listContacts,
  updateContact,
  deleteContact,
  mergeContacts,
};



