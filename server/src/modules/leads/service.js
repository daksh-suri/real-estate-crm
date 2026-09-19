// Lead — working sales record (Phase 3 #38/#40).
// Leads are created ONLY by the Enquiry intake pipeline (no manual create
// endpoint in Checkpoint 7) so Contact matching, dedup, uniqueness and
// assignment can never be bypassed. This module owns reads, status updates
// and manual reassignment.

const ALLOWED_TRANSITIONS = {
  OPEN: ['CONVERTED', 'DISQUALIFIED'],
  DISQUALIFIED: ['OPEN'],
  CONVERTED: [],
};

async function getLead({ tenantPrisma, leadId }) {
  const lead = await tenantPrisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) {
    const err = new Error('Lead not found');
    err.statusCode = 404;
    throw err;
  }
  return lead;
}

async function listLeads({ tenantPrisma, filters = {}, limit = 20, offset = 0 }) {
  const where = {};
  for (const key of ['status', 'contactId', 'projectId', 'assignedAgentId', 'leadSourceId', 'campaignId']) {
    if (filters[key] !== undefined) where[key] = filters[key];
  }
  return tenantPrisma.lead.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100),
    skip: offset,
  });
}

async function updateLead({ tenantPrisma, organizationId, leadId, data }) {
  void organizationId;
  const existing = await getLead({ tenantPrisma, leadId });
  if (existing.deletedAt) {
    const err = new Error('Cannot update a soft-deleted lead');
    err.statusCode = 400;
    throw err;
  }

  const updateData = {};
  if (data.status !== undefined && data.status !== existing.status) {
    const allowed = ALLOWED_TRANSITIONS[existing.status] || [];
    if (!allowed.includes(data.status)) {
      const err = new Error(`Invalid Lead status transition ${existing.status} -> ${data.status}`);
      err.statusCode = 400;
      throw err;
    }
    updateData.status = data.status;
  }
  if (data.requirementId !== undefined) {
    if (data.requirementId !== null) {
      const req = await tenantPrisma.requirement.findUnique({ where: { id: data.requirementId } });
      if (!req) {
        const err = new Error('Requirement not found');
        err.statusCode = 404;
        throw err;
      }
      if (req.contactId !== existing.contactId) {
        const err = new Error('Requirement must belong to the Lead contact');
        err.statusCode = 400;
        throw err;
      }
    }
    updateData.requirementId = data.requirementId;
  }

  if (Object.keys(updateData).length === 0) {
    const err = new Error('No valid fields to update');
    err.statusCode = 400;
    throw err;
  }

  try {
    return await tenantPrisma.lead.update({ where: { id: leadId }, data: updateData });
  } catch (err) {
    if (err.code === 'P2002') {
      // Reopening a DISQUALIFIED lead while another OPEN lead exists for the
      // same Contact+Project trips the partial unique index.
      const e = new Error('An OPEN lead already exists for this contact and project');
      e.statusCode = 409;
      throw e;
    }
    throw err;
  }
}

async function deleteLead({ tenantPrisma, leadId }) {
  const existing = await getLead({ tenantPrisma, leadId });
  if (existing.deletedAt) {
    const err = new Error('Lead already deleted');
    err.statusCode = 400;
    throw err;
  }
  return tenantPrisma.lead.update({ where: { id: leadId }, data: { deletedAt: new Date() } });
}

// Manual reassignment (Phase 3 #10: manual always wins, never silently re-run
// auto-assignment over it). Runs in a transaction; validates the target agent
// is a visible, ACTIVE user of the same organization.
async function reassignLead({ tenantPrisma, organizationId, leadId, assignedAgentId }) {
  return tenantPrisma.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({ where: { id: leadId } });
    if (!lead) {
      const err = new Error('Lead not found');
      err.statusCode = 404;
      throw err;
    }
    if (lead.deletedAt) {
      const err = new Error('Cannot reassign a soft-deleted lead');
      err.statusCode = 400;
      throw err;
    }
    const agent = await tx.user.findUnique({ where: { id: assignedAgentId } });
    if (!agent) {
      const raw = await tx._raw.user.findUnique({ where: { id: assignedAgentId } });
      if (raw && raw.organizationId !== organizationId) {
        const err = new Error('Cannot assign lead to a user from another organization');
        err.statusCode = 403;
        throw err;
      }
      const err = new Error('User not found');
      err.statusCode = 404;
      throw err;
    }
    if (agent.status !== 'ACTIVE') {
      const err = new Error(`Cannot assign lead to a ${agent.status} user`);
      err.statusCode = 400;
      throw err;
    }
    return tx.lead.update({
      where: { id: leadId },
      data: { assignedAgentId: agent.id, assignmentSource: 'MANUAL', assignedAt: new Date() },
    });
  });
}

module.exports = {
  getLead,
  listLeads,
  updateLead,
  deleteLead,
  reassignLead,
};
