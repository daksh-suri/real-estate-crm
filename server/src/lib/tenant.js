const { prisma } = require('./prisma');

// ---------------------------------------------------------------------------
// Tenant isolation — centralized, fail-closed Prisma wrapping
// ---------------------------------------------------------------------------

class TenantContextError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TenantContextError';
    this.statusCode = 400;
  }
}

class CrossTenantError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CrossTenantError';
    this.statusCode = 403;
  }
}

// Flatten Prisma compound-unique where shapes like
//   { organizationId_email: { organizationId, email } }
// into a plain filter object { organizationId, email }.
// For normal where { id: "abc" } it is a no-op.
function flattenWhere(where) {
  if (!where || typeof where !== 'object') return {};
  const flat = {};
  for (const [key, value] of Object.entries(where)) {
    // Prisma compound unique keys contain '_' and value is an object with the parts.
    // Example: organizationId_email, organizationId_name, roleId_permissionId_scope
    if (key.includes('_') && value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(flat, value);
    } else {
      flat[key] = value;
    }
  }
  return flat;
}

function assertTenantContext(organizationId) {
  if (!organizationId || typeof organizationId !== 'string' || organizationId.trim() === '') {
    throw new TenantContextError(
      'Missing tenant context: organizationId is required for tenant-scoped operations. ' +
        'Use createTenantPrisma(organizationId) and never query tenant models via the raw Prisma client.'
    );
  }
}

function assertWhereTenantMatches(where, organizationId) {
  if (!where) return;
  const flat = flattenWhere(where);
  if (flat.organizationId !== undefined && flat.organizationId !== organizationId) {
    throw new CrossTenantError(
      `Cross-tenant where clause: where.organizationId (${flat.organizationId}) does not match tenant context (${organizationId}).`
    );
  }
  // Also check compound keys that embed organizationId
  for (const [key, value] of Object.entries(where)) {
    if (key.includes('organizationId') && typeof value === 'object' && value !== null) {
      if (value.organizationId !== undefined && value.organizationId !== organizationId) {
        throw new CrossTenantError(
          `Cross-tenant compound where ${key}.organizationId (${value.organizationId}) does not match tenant context (${organizationId}).`
        );
      }
    }
  }
}

function injectWhere(where, organizationId) {
  assertWhereTenantMatches(where, organizationId);
  const flat = flattenWhere(where);
  // Preserve non-organization fields, always force tenant id
  const { organizationId: _ignored, ...rest } = flat;
  void _ignored;
  return { ...rest, organizationId };
}

function injectDataOrganizationId(data, organizationId) {
  if (!data || typeof data !== 'object') return { organizationId };
  if (Array.isArray(data)) {
    return data.map((item) => injectDataOrganizationId(item, organizationId));
  }
  if (data.organizationId !== undefined && data.organizationId !== organizationId) {
    throw new CrossTenantError(
      `Cross-tenant data: data.organizationId (${data.organizationId}) does not match tenant context (${organizationId}).`
    );
  }
  return { ...data, organizationId };
}

// ---------------------------------------------------------------------------
// Cross-organization relationship guards
// ---------------------------------------------------------------------------

async function assertMembershipTenantIntegrity(organizationId, data, rawPrisma) {
  // data contains userId, teamId, organizationId (already injected)
  const userId = data.userId;
  const teamId = data.teamId;
  if (!userId || !teamId) return;
  const [user, team] = await Promise.all([
    rawPrisma.user.findUnique({ where: { id: userId } }),
    rawPrisma.team.findUnique({ where: { id: teamId } }),
  ]);
  if (!user) throw new CrossTenantError(`TeamMembership userId ${userId} does not exist`);
  if (!team) throw new CrossTenantError(`TeamMembership teamId ${teamId} does not exist`);
  if (user.organizationId !== organizationId) {
    throw new CrossTenantError(
      `Cross-tenant membership: user ${userId} belongs to org ${user.organizationId}, not ${organizationId}`
    );
  }
  if (team.organizationId !== organizationId) {
    throw new CrossTenantError(
      `Cross-tenant membership: team ${teamId} belongs to org ${team.organizationId}, not ${organizationId}`
    );
  }
  if (user.organizationId !== team.organizationId) {
    throw new CrossTenantError(
      `Cross-tenant membership: user org ${user.organizationId} != team org ${team.organizationId}`
    );
  }
}

async function assertUserRoleTenantIntegrity(organizationId, data, rawPrisma) {
  if (!data.roleId) return;
  const role = await rawPrisma.role.findUnique({ where: { id: data.roleId } });
  if (!role) throw new CrossTenantError(`User roleId ${data.roleId} does not exist`);
  if (role.organizationId !== organizationId) {
    throw new CrossTenantError(
      `Cross-tenant user-role: role ${data.roleId} belongs to org ${role.organizationId}, not ${organizationId}`
    );
  }
}

async function assertRolePermissionTenantIntegrity(organizationId, data, rawPrisma) {
  if (!data.roleId) return;
  const role = await rawPrisma.role.findUnique({ where: { id: data.roleId } });
  if (!role) throw new CrossTenantError(`RolePermission roleId ${data.roleId} does not exist`);
  if (role.organizationId !== organizationId) {
    throw new CrossTenantError(
      `Cross-tenant role-permission: role ${data.roleId} belongs to org ${role.organizationId}, not ${organizationId}`
    );
  }
  // permission is global, no org check
}

async function assertRequirementContactIntegrity(organizationId, data, rawPrisma) {
  if (!data.contactId) return;
  const contact = await rawPrisma.contact.findUnique({ where: { id: data.contactId } });
  if (!contact) throw new CrossTenantError(`Requirement contactId ${data.contactId} does not exist`);
  if (contact.organizationId !== organizationId) {
    throw new CrossTenantError(
      `Cross-tenant requirement: contact ${data.contactId} belongs to org ${contact.organizationId}, not ${organizationId}`
    );
  }
  if (contact.deletedAt) {
    throw new CrossTenantError(`Requirement cannot be attached to soft-deleted contact ${data.contactId}`);
  }
}

async function assertPossibleDuplicateIntegrity(organizationId, data, rawPrisma) {
  if (!data.contactAId || !data.contactBId) return;
  if (data.contactAId === data.contactBId) {
    throw new CrossTenantError('PossibleDuplicate contactAId and contactBId must be different');
  }
  const [a, b] = await Promise.all([
    rawPrisma.contact.findUnique({ where: { id: data.contactAId } }),
    rawPrisma.contact.findUnique({ where: { id: data.contactBId } }),
  ]);
  if (!a) throw new CrossTenantError(`PossibleDuplicate contactAId ${data.contactAId} does not exist`);
  if (!b) throw new CrossTenantError(`PossibleDuplicate contactBId ${data.contactBId} does not exist`);
  if (a.organizationId !== organizationId || b.organizationId !== organizationId) {
    throw new CrossTenantError('Cross-tenant PossibleDuplicate: contacts must belong to same organization');
  }
}

async function assertUnitProjectIntegrity(organizationId, data, rawPrisma) {
  if (!data.projectId) return;
  const project = await rawPrisma.project.findUnique({ where: { id: data.projectId } });
  if (!project) throw new CrossTenantError(`Unit projectId ${data.projectId} does not exist`);
  if (project.organizationId !== organizationId) {
    throw new CrossTenantError(
      `Cross-tenant unit: project ${data.projectId} belongs to org ${project.organizationId}, not ${organizationId}`
    );
  }
  if (project.deletedAt) {
    throw new CrossTenantError(`Unit cannot be attached to soft-deleted project ${data.projectId}`);
  }
}

async function assertCampaignIntegrity(organizationId, data, rawPrisma) {
  if (!data.leadSourceId) return;
  const src = await rawPrisma.leadSource.findUnique({ where: { id: data.leadSourceId } });
  if (!src) throw new CrossTenantError(`Campaign leadSourceId ${data.leadSourceId} does not exist`);
  if (src.organizationId !== organizationId) {
    throw new CrossTenantError(
      `Cross-tenant campaign: leadSource ${data.leadSourceId} belongs to org ${src.organizationId}, not ${organizationId}`
    );
  }
}

async function assertSameOrgReference(rawPrisma, model, id, organizationId, label) {
  const row = await rawPrisma[model].findUnique({ where: { id } });
  if (!row) throw new CrossTenantError(`${label} ${id} does not exist`);
  if (row.organizationId !== organizationId) {
    throw new CrossTenantError(
      `Cross-tenant ${label.toLowerCase()}: ${id} belongs to org ${row.organizationId}, not ${organizationId}`
    );
  }
  return row;
}

async function assertLeadIntegrity(organizationId, data, rawPrisma) {
  if (data.contactId) {
    const contact = await assertSameOrgReference(rawPrisma, 'contact', data.contactId, organizationId, 'Lead contactId');
    if (contact.deletedAt) {
      throw new CrossTenantError(`Lead cannot be attached to soft-deleted contact ${data.contactId}`);
    }
  }
  if (data.projectId) {
    const project = await assertSameOrgReference(rawPrisma, 'project', data.projectId, organizationId, 'Lead projectId');
    if (project.deletedAt) {
      throw new CrossTenantError(`Lead cannot be attached to soft-deleted project ${data.projectId}`);
    }
  }
  if (data.requirementId) {
    const req = await assertSameOrgReference(rawPrisma, 'requirement', data.requirementId, organizationId, 'Lead requirementId');
    if (req.deletedAt) {
      throw new CrossTenantError(`Lead cannot reference soft-deleted requirement ${data.requirementId}`);
    }
    if (data.contactId && req.contactId !== data.contactId) {
      throw new CrossTenantError(
        `Lead requirement ${data.requirementId} belongs to contact ${req.contactId}, not ${data.contactId}`
      );
    }
  }
  if (data.leadSourceId) {
    await assertSameOrgReference(rawPrisma, 'leadSource', data.leadSourceId, organizationId, 'Lead leadSourceId');
  }
  if (data.campaignId) {
    await assertSameOrgReference(rawPrisma, 'campaign', data.campaignId, organizationId, 'Lead campaignId');
  }
  if (data.assignedAgentId) {
    const agent = await assertSameOrgReference(rawPrisma, 'user', data.assignedAgentId, organizationId, 'Lead assignedAgentId');
    if (agent.deletedAt) {
      throw new CrossTenantError(`Lead cannot be assigned to soft-deleted user ${data.assignedAgentId}`);
    }
  }
  if (data.originEnquiryId) {
    await assertSameOrgReference(rawPrisma, 'enquiry', data.originEnquiryId, organizationId, 'Lead originEnquiryId');
  }
}

async function assertEnquiryIntegrity(organizationId, data, rawPrisma) {
  if (data.contactId) {
    const contact = await assertSameOrgReference(rawPrisma, 'contact', data.contactId, organizationId, 'Enquiry contactId');
    if (contact.deletedAt) {
      throw new CrossTenantError(`Enquiry cannot be attached to soft-deleted contact ${data.contactId}`);
    }
  }
  if (data.projectId) {
    const project = await assertSameOrgReference(rawPrisma, 'project', data.projectId, organizationId, 'Enquiry projectId');
    if (project.deletedAt) {
      throw new CrossTenantError(`Enquiry cannot be attached to soft-deleted project ${data.projectId}`);
    }
  }
  if (data.leadSourceId) {
    await assertSameOrgReference(rawPrisma, 'leadSource', data.leadSourceId, organizationId, 'Enquiry leadSourceId');
  }
  if (data.campaignId) {
    await assertSameOrgReference(rawPrisma, 'campaign', data.campaignId, organizationId, 'Enquiry campaignId');
  }
  if (data.linkedLeadId) {
    await assertSameOrgReference(rawPrisma, 'lead', data.linkedLeadId, organizationId, 'Enquiry linkedLeadId');
  }
}

async function assertRoundRobinIntegrity(organizationId, data, rawPrisma) {
  if (!data.teamId) return;
  const team = await rawPrisma.team.findUnique({ where: { id: data.teamId } });
  if (!team) throw new CrossTenantError(`RoundRobinState teamId ${data.teamId} does not exist`);
  if (team.organizationId !== organizationId) {
    throw new CrossTenantError(
      `Cross-tenant round-robin: team ${data.teamId} belongs to org ${team.organizationId}, not ${organizationId}`
    );
  }
}

async function assertSiteVisitIntegrity(organizationId, data, rawPrisma) {
  if (data.agentId) {
    const agent = await assertSameOrgReference(rawPrisma, 'user', data.agentId, organizationId, 'SiteVisit agentId');
    if (agent.deletedAt) {
      throw new CrossTenantError(`SiteVisit cannot be assigned to soft-deleted user ${data.agentId}`);
    }
  }
  if (data.projectId) {
    const project = await assertSameOrgReference(rawPrisma, 'project', data.projectId, organizationId, 'SiteVisit projectId');
    if (project.deletedAt) {
      throw new CrossTenantError(`SiteVisit cannot be attached to soft-deleted project ${data.projectId}`);
    }
  }
  if (data.contactId) {
    const contact = await assertSameOrgReference(rawPrisma, 'contact', data.contactId, organizationId, 'SiteVisit contactId');
    if (contact.deletedAt) {
      throw new CrossTenantError(`SiteVisit cannot be attached to soft-deleted contact ${data.contactId}`);
    }
  }
  if (data.dealId) {
    const deal = await assertSameOrgReference(rawPrisma, 'deal', data.dealId, organizationId, 'SiteVisit dealId');
    if (deal.deletedAt) {
      throw new CrossTenantError(`SiteVisit cannot be attached to soft-deleted deal ${data.dealId}`);
    }
    if (data.contactId && deal.contactId !== data.contactId) {
      throw new CrossTenantError(
        `SiteVisit deal ${data.dealId} belongs to contact ${deal.contactId}, not ${data.contactId}`
      );
    }
  }
}

function withSiteVisitExisting(existing, patch) {
  return {
    agentId: existing.agentId,
    projectId: existing.projectId,
    contactId: existing.contactId,
    dealId: existing.dealId,
    ...patch,
  };
}

function withReservationExisting(existing, patch) {
  return {
    unitId: existing.unitId,
    dealId: existing.dealId,
    ...patch,
  };
}

async function assertBookingIntegrity(organizationId, data, rawPrisma) {
  if (data.unitId) {
    const unit = await assertSameOrgReference(rawPrisma, 'unit', data.unitId, organizationId, 'Booking unitId');
    if (unit.deletedAt) {
      throw new CrossTenantError(`Booking cannot be attached to soft-deleted unit ${data.unitId}`);
    }
  }
  if (data.dealId) {
    const deal = await assertSameOrgReference(rawPrisma, 'deal', data.dealId, organizationId, 'Booking dealId');
    if (deal.deletedAt) {
      throw new CrossTenantError(`Booking cannot be attached to soft-deleted deal ${data.dealId}`);
    }
  }
  if (data.reservationId) {
    await assertSameOrgReference(rawPrisma, 'reservation', data.reservationId, organizationId, 'Booking reservationId');
  }
}

function withBookingExisting(existing, patch) {
  return {
    unitId: existing.unitId,
    dealId: existing.dealId,
    reservationId: existing.reservationId,
    ...patch,
  };
}

async function assertPaymentPlanIntegrity(organizationId, data, rawPrisma) {
  if (data.dealId) {
    const deal = await assertSameOrgReference(rawPrisma, 'deal', data.dealId, organizationId, 'PaymentPlan dealId');
    if (deal.deletedAt) {
      throw new CrossTenantError(`PaymentPlan cannot be attached to soft-deleted deal ${data.dealId}`);
    }
  }
}

async function assertPaymentObligationIntegrity(organizationId, data, rawPrisma) {
  if (data.paymentPlanId) {
    await assertSameOrgReference(rawPrisma, 'paymentPlan', data.paymentPlanId, organizationId, 'PaymentObligation paymentPlanId');
  }
}

async function assertPaymentRecordIntegrity(organizationId, data, rawPrisma) {
  if (data.obligationId) {
    await assertSameOrgReference(rawPrisma, 'paymentObligation', data.obligationId, organizationId, 'PaymentRecord obligationId');
  }
  if (data.correctsRecordId) {
    await assertSameOrgReference(rawPrisma, 'paymentRecord', data.correctsRecordId, organizationId, 'PaymentRecord correctsRecordId');
  }
}

function withPaymentObligationExisting(existing, patch) {
  return { paymentPlanId: existing.paymentPlanId, ...patch };
}

function withPaymentRecordExisting(existing, patch) {
  return { obligationId: existing.obligationId, correctsRecordId: existing.correctsRecordId, ...patch };
}

async function assertDealIntegrity(organizationId, data, rawPrisma) {
  if (data.contactId) {
    const contact = await assertSameOrgReference(rawPrisma, 'contact', data.contactId, organizationId, 'Deal contactId');
    if (contact.deletedAt) {
      throw new CrossTenantError(`Deal cannot be attached to soft-deleted contact ${data.contactId}`);
    }
  }
  if (data.leadId) {
    const lead = await assertSameOrgReference(rawPrisma, 'lead', data.leadId, organizationId, 'Deal leadId');
    if (lead.deletedAt) {
      throw new CrossTenantError(`Deal cannot be attached to soft-deleted lead ${data.leadId}`);
    }
    if (data.contactId && lead.contactId !== data.contactId) {
      throw new CrossTenantError(
        `Deal lead ${data.leadId} belongs to contact ${lead.contactId}, not ${data.contactId}`
      );
    }
  }
  if (data.unitId) {
    const unit = await assertSameOrgReference(rawPrisma, 'unit', data.unitId, organizationId, 'Deal unitId');
    if (unit.deletedAt) {
      throw new CrossTenantError(`Deal cannot be attached to soft-deleted unit ${data.unitId}`);
    }
  }
}

async function assertReservationIntegrity(organizationId, data, rawPrisma) {
  if (data.unitId) {
    const unit = await assertSameOrgReference(rawPrisma, 'unit', data.unitId, organizationId, 'Reservation unitId');
    if (unit.deletedAt) {
      throw new CrossTenantError(`Reservation cannot be attached to soft-deleted unit ${data.unitId}`);
    }
  }
  if (data.dealId) {
    const deal = await assertSameOrgReference(rawPrisma, 'deal', data.dealId, organizationId, 'Reservation dealId');
    if (deal.deletedAt) {
      throw new CrossTenantError(`Reservation cannot be attached to soft-deleted deal ${data.dealId}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Wrap a single model delegate with tenant logic
// ---------------------------------------------------------------------------

function wrapModel(modelName, rawModel, organizationId, guardClient) {
  // guardClient is the Prisma client used for cross-tenant relationship
  // guards. Inside $transaction callbacks it MUST be the transaction-bound
  // client (rawTx) so guards see rows created earlier in the same
  // transaction; outside transactions it is the global raw client.
  const guards = guardClient || prisma;
  return {
    // ----- READ: filter-injected -----
    findMany: async (args = {}) => {
      assertTenantContext(organizationId);
      const where = injectWhere(args.where, organizationId);
      // Soft-delete: exclude deletedAt not null for User, Team, Contact, Requirement unless explicitly queried
      if ((['user', 'team', 'contact', 'requirement', 'project', 'unit', 'lead', 'deal'].includes(modelName)) && where.deletedAt === undefined) {
        where.deletedAt = null;
      }
      return rawModel.findMany({ ...args, where });
    },

    findFirst: async (args = {}) => {
      assertTenantContext(organizationId);
      const where = injectWhere(args.where, organizationId);
      if ((['user', 'team', 'contact', 'requirement', 'project', 'unit', 'lead', 'deal'].includes(modelName)) && where.deletedAt === undefined) {
        where.deletedAt = null;
      }
      return rawModel.findFirst({ ...args, where });
    },

    findFirstOrThrow: async (args = {}) => {
      assertTenantContext(organizationId);
      const where = injectWhere(args.where, organizationId);
      if ((['user', 'team', 'contact', 'requirement', 'project', 'unit', 'lead', 'deal'].includes(modelName)) && where.deletedAt === undefined) {
        where.deletedAt = null;
      }
      return rawModel.findFirstOrThrow({ ...args, where });
    },

    // findUnique variants are translated to findFirst to avoid invalid Prisma
    // unique selectors like { id, organizationId } without a compound unique.
    // This is operation-correct and tenant-safe: single query, valid Prisma.
    findUnique: async (args = {}) => {
      assertTenantContext(organizationId);
      const where = args.where;
      if (!where) throw new TenantContextError('findUnique requires where');
      assertWhereTenantMatches(where, organizationId);
      const tenantWhere = injectWhere(where, organizationId);
      if ((['user', 'team', 'contact', 'requirement', 'project', 'unit', 'lead', 'deal'].includes(modelName)) && tenantWhere.deletedAt === undefined) {
        tenantWhere.deletedAt = null;
      }
      // Use findFirst with tenant filter — valid for any where shape.
      return rawModel.findFirst({ ...args, where: tenantWhere });
    },

    findUniqueOrThrow: async (args = {}) => {
      assertTenantContext(organizationId);
      const where = args.where;
      if (!where) throw new TenantContextError('findUniqueOrThrow requires where');
      assertWhereTenantMatches(where, organizationId);
      const tenantWhere = injectWhere(where, organizationId);
      if ((['user', 'team', 'contact', 'requirement', 'project', 'unit', 'lead', 'deal'].includes(modelName)) && tenantWhere.deletedAt === undefined) {
        tenantWhere.deletedAt = null;
      }
      return rawModel.findFirstOrThrow({ ...args, where: tenantWhere });
    },

    count: async (args = {}) => {
      assertTenantContext(organizationId);
      const where = injectWhere(args.where, organizationId);
      if ((['user', 'team', 'contact', 'requirement', 'project', 'unit', 'lead', 'deal'].includes(modelName)) && where.deletedAt === undefined) {
        where.deletedAt = null;
      }
      return rawModel.count({ ...args, where });
    },

    aggregate: async (args = {}) => {
      assertTenantContext(organizationId);
      const where = injectWhere(args.where, organizationId);
      return rawModel.aggregate({ ...args, where });
    },

    groupBy: async (args) => {
      assertTenantContext(organizationId);
      if (!args || !args.by) throw new Error('groupBy requires by');
      const where = injectWhere(args.where, organizationId);
      return rawModel.groupBy({ ...args, where });
    },

    // ----- WRITE: data injection + tenant verification + cross-org guards -----

    create: async (args) => {
      assertTenantContext(organizationId);
      if (!args || !args.data) throw new Error('create requires data');
      const data = injectDataOrganizationId(args.data, organizationId);

      // Cross-tenant relationship guards (inside same logical operation,
      // verified before write). These run in the same call but not yet in a
      // DB transaction — callers needing atomicity should use $transaction.
      if (modelName === 'teamMembership') {
        await assertMembershipTenantIntegrity(organizationId, data, guards);
      }
      if (modelName === 'user') {
        await assertUserRoleTenantIntegrity(organizationId, data, guards);
      }
      if (modelName === 'rolePermission') {
        await assertRolePermissionTenantIntegrity(organizationId, data, guards);
      }
      if (modelName === 'requirement') {
        await assertRequirementContactIntegrity(organizationId, data, guards);
      }
      if (modelName === 'possibleDuplicate') {
        await assertPossibleDuplicateIntegrity(organizationId, data, guards);
      }
      if (modelName === 'unit') {
        await assertUnitProjectIntegrity(organizationId, data, guards);
      }
      if (modelName === 'campaign') {
        await assertCampaignIntegrity(organizationId, data, guards);
      }
      if (modelName === 'lead') {
        await assertLeadIntegrity(organizationId, data, guards);
      }
      if (modelName === 'enquiry') {
        await assertEnquiryIntegrity(organizationId, data, guards);
      }
      if (modelName === 'roundRobinState') {
        await assertRoundRobinIntegrity(organizationId, data, guards);
      }
      if (modelName === 'deal') {
        await assertDealIntegrity(organizationId, data, guards);
      }
      if (modelName === 'siteVisit') {
        await assertSiteVisitIntegrity(organizationId, data, guards);
      }
      if (modelName === 'reservation') {
        await assertReservationIntegrity(organizationId, data, guards);
      }
      if (modelName === 'booking') {
        await assertBookingIntegrity(organizationId, data, guards);
      }
      if (modelName === 'paymentPlan') {
        await assertPaymentPlanIntegrity(organizationId, data, guards);
      }
      if (modelName === 'paymentObligation') {
        await assertPaymentObligationIntegrity(organizationId, data, guards);
      }
      if (modelName === 'paymentRecord') {
        await assertPaymentRecordIntegrity(organizationId, data, guards);
      }

      return rawModel.create({ ...args, data });
    },

    createMany: async (args) => {
      assertTenantContext(organizationId);
      if (!args || !args.data) throw new Error('createMany requires data');
      const data = Array.isArray(args.data)
        ? args.data.map((d) => injectDataOrganizationId(d, organizationId))
        : injectDataOrganizationId(args.data, organizationId);

      // For bulk, skip per-record cross-check for performance; rely on single-record guard
      // and DB FKs. If strict bulk integrity is needed, callers should use transaction + single creates.
      return rawModel.createMany({ ...args, data });
    },

    createManyAndReturn: async (args = {}) => {
      assertTenantContext(organizationId);
      if (!args.data) return rawModel.createManyAndReturn(args);
      const data = Array.isArray(args.data)
        ? args.data.map((d) => injectDataOrganizationId(d, organizationId))
        : injectDataOrganizationId(args.data, organizationId);
      return rawModel.createManyAndReturn({ ...args, data });
    },

    update: async (args) => {
      assertTenantContext(organizationId);
      if (!args || !args.where) throw new Error('update requires where');
      assertWhereTenantMatches(args.where, organizationId);
      const flatWhere = flattenWhere(args.where);
      const tenantWhere = { ...flatWhere, organizationId };
      if (args.data && args.data.organizationId !== undefined && args.data.organizationId !== organizationId) {
        throw new CrossTenantError('Cannot change organizationId via update');
      }

      // Verify the record belongs to tenant before updating (tenant isolation).
      // Use findFirst with tenant filter — valid, no invalid unique selector.
      const existing = await rawModel.findFirst({ where: tenantWhere });
      if (!existing) {
        const err = new Error(`Record not found for update (tenant ${organizationId})`);
        err.code = 'P2025';
        throw err;
      }

      // Cross-tenant guards for updates that change relationships
      if (modelName === 'user' && args.data && args.data.roleId !== undefined) {
        const newRoleId = args.data.roleId;
        if (newRoleId !== null) {
          await assertUserRoleTenantIntegrity(organizationId, { roleId: newRoleId }, guards);
        }
      }
      if (modelName === 'requirement' && args.data && args.data.contactId !== undefined) {
        await assertRequirementContactIntegrity(organizationId, { contactId: args.data.contactId }, guards);
      }
      if (modelName === 'possibleDuplicate' && args.data && (args.data.contactAId !== undefined || args.data.contactBId !== undefined)) {
        const contactAId = args.data.contactAId !== undefined ? args.data.contactAId : existing.contactAId;
        const contactBId = args.data.contactBId !== undefined ? args.data.contactBId : existing.contactBId;
        await assertPossibleDuplicateIntegrity(organizationId, { contactAId, contactBId }, guards);
      }
      if (modelName === 'unit' && args.data && args.data.projectId !== undefined) {
        await assertUnitProjectIntegrity(organizationId, { projectId: args.data.projectId }, guards);
      }
      if (modelName === 'campaign' && args.data && args.data.leadSourceId !== undefined) {
        await assertCampaignIntegrity(organizationId, { leadSourceId: args.data.leadSourceId }, guards);
      }
      if (modelName === 'roundRobinState' && args.data && args.data.teamId !== undefined) {
        await assertRoundRobinIntegrity(organizationId, { teamId: args.data.teamId }, guards);
      }
      if (modelName === 'lead' && args.data) {
        await assertLeadIntegrity(organizationId, { contactId: existing.contactId, ...args.data }, guards);
      }
      if (modelName === 'enquiry' && args.data) {
        await assertEnquiryIntegrity(organizationId, args.data, guards);
      }
      if (modelName === 'deal' && args.data) {
        await assertDealIntegrity(
          organizationId,
          { contactId: existing.contactId, leadId: existing.leadId, ...args.data },
          guards
        );
      }
      if (modelName === 'siteVisit' && args.data) {
        await assertSiteVisitIntegrity(organizationId, withSiteVisitExisting(existing, args.data), guards);
      }
      if (modelName === 'reservation' && args.data) {
        await assertReservationIntegrity(organizationId, withReservationExisting(existing, args.data), guards);
      }
      if (modelName === 'booking' && args.data) {
        await assertBookingIntegrity(organizationId, withBookingExisting(existing, args.data), guards);
      }
      if (modelName === 'paymentObligation' && args.data) {
        await assertPaymentObligationIntegrity(organizationId, withPaymentObligationExisting(existing, args.data), guards);
      }
      if (modelName === 'paymentRecord' && args.data) {
        await assertPaymentRecordIntegrity(organizationId, withPaymentRecordExisting(existing, args.data), guards);
      }

      // Perform update using the record's PK (id) which is globally unique and valid.
      // This avoids generating an invalid where: { id, organizationId } for Prisma update.
      const whereForUpdate = {};
      if (existing.id !== undefined) whereForUpdate.id = existing.id;
      else whereForUpdate.id = flatWhere.id; // fallback

      // If custom id not present (e.g., TeamMembership has id PK, but findFirst used composite),
      // use the found record's id.
      return rawModel.update({ ...args, where: whereForUpdate });
    },

    updateMany: async (args = {}) => {
      assertTenantContext(organizationId);
      const where = injectWhere(args.where, organizationId);
      if (args.data && args.data.organizationId !== undefined && args.data.organizationId !== organizationId) {
        throw new CrossTenantError('Cannot change organizationId via updateMany');
      }
      return rawModel.updateMany({ ...args, where });
    },

    updateManyAndReturn: async (args = {}) => {
      assertTenantContext(organizationId);
      const where = injectWhere(args.where, organizationId);
      if (args.data && args.data.organizationId !== undefined && args.data.organizationId !== organizationId) {
        throw new CrossTenantError('Cannot change organizationId via updateManyAndReturn');
      }
      return rawModel.updateManyAndReturn({ ...args, where });
    },

    upsert: async (args) => {
      assertTenantContext(organizationId);
      if (!args || !args.where || !args.create || !args.update) throw new Error('upsert requires where, create, update');
      assertWhereTenantMatches(args.where, organizationId);
      const flatWhere = flattenWhere(args.where);
      const tenantWhere = { ...flatWhere, organizationId };
      if (args.create.organizationId !== undefined && args.create.organizationId !== organizationId) {
        throw new CrossTenantError('Cross-tenant upsert create.organizationId mismatch');
      }
      if (args.update.organizationId !== undefined && args.update.organizationId !== organizationId) {
        throw new CrossTenantError('Cannot change organizationId via upsert update');
      }
      const create = injectDataOrganizationId(args.create, organizationId);

      // Check existence tenant-scoped
      const existing = await rawModel.findFirst({ where: tenantWhere });
      if (existing) {
        // Verify cross-tenant for update path if needed
        if (modelName === 'user' && args.update.roleId !== undefined && args.update.roleId !== null) {
          await assertUserRoleTenantIntegrity(organizationId, { roleId: args.update.roleId }, guards);
        }
        if (modelName === 'requirement' && args.update.contactId !== undefined) {
          await assertRequirementContactIntegrity(organizationId, { contactId: args.update.contactId }, guards);
        }
        if (modelName === 'possibleDuplicate' && (args.update.contactAId !== undefined || args.update.contactBId !== undefined)) {
          const contactAId = args.update.contactAId !== undefined ? args.update.contactAId : existing.contactAId;
          const contactBId = args.update.contactBId !== undefined ? args.update.contactBId : existing.contactBId;
          await assertPossibleDuplicateIntegrity(organizationId, { contactAId, contactBId }, guards);
        }
        if (modelName === 'unit' && args.update.projectId !== undefined) {
          await assertUnitProjectIntegrity(organizationId, { projectId: args.update.projectId }, guards);
        }
        if (modelName === 'lead' && args.update) {
          await assertLeadIntegrity(organizationId, { contactId: existing.contactId, ...args.update }, guards);
        }
        if (modelName === 'enquiry' && args.update) {
          await assertEnquiryIntegrity(organizationId, args.update, guards);
        }
        if (modelName === 'deal' && args.update) {
          await assertDealIntegrity(
            organizationId,
            { contactId: existing.contactId, leadId: existing.leadId, ...args.update },
            guards
          );
        }
        if (modelName === 'siteVisit' && args.update) {
          await assertSiteVisitIntegrity(organizationId, withSiteVisitExisting(existing, args.update), guards);
        }
        if (modelName === 'reservation' && args.update) {
          await assertReservationIntegrity(organizationId, withReservationExisting(existing, args.update), guards);
        }
        if (modelName === 'booking' && args.update) {
          await assertBookingIntegrity(organizationId, withBookingExisting(existing, args.update), guards);
        }
        if (modelName === 'paymentObligation' && args.update) {
          await assertPaymentObligationIntegrity(organizationId, withPaymentObligationExisting(existing, args.update), guards);
        }
        if (modelName === 'paymentRecord' && args.update) {
          await assertPaymentRecordIntegrity(organizationId, withPaymentRecordExisting(existing, args.update), guards);
        }
        const whereForUpdate = { id: existing.id };
        return rawModel.update({ where: whereForUpdate, data: args.update });
      }
      // Create path guards
      if (modelName === 'teamMembership') {
        await assertMembershipTenantIntegrity(organizationId, create, guards);
      }
      if (modelName === 'user') {
        await assertUserRoleTenantIntegrity(organizationId, create, guards);
      }
      if (modelName === 'rolePermission') {
        await assertRolePermissionTenantIntegrity(organizationId, create, guards);
      }
      if (modelName === 'requirement') {
        await assertRequirementContactIntegrity(organizationId, create, guards);
      }
      if (modelName === 'possibleDuplicate') {
        await assertPossibleDuplicateIntegrity(organizationId, create, guards);
      }
      if (modelName === 'unit') {
        await assertUnitProjectIntegrity(organizationId, create, guards);
      }
      if (modelName === 'campaign') {
        await assertCampaignIntegrity(organizationId, create, guards);
      }
      if (modelName === 'lead') {
        await assertLeadIntegrity(organizationId, create, guards);
      }
      if (modelName === 'enquiry') {
        await assertEnquiryIntegrity(organizationId, create, guards);
      }
      if (modelName === 'roundRobinState') {
        await assertRoundRobinIntegrity(organizationId, create, guards);
      }
      if (modelName === 'deal') {
        await assertDealIntegrity(organizationId, create, guards);
      }
      if (modelName === 'siteVisit') {
        await assertSiteVisitIntegrity(organizationId, create, guards);
      }
      if (modelName === 'reservation') {
        await assertReservationIntegrity(organizationId, create, guards);
      }
      if (modelName === 'booking') {
        await assertBookingIntegrity(organizationId, create, guards);
      }
      if (modelName === 'paymentPlan') {
        await assertPaymentPlanIntegrity(organizationId, create, guards);
      }
      if (modelName === 'paymentObligation') {
        await assertPaymentObligationIntegrity(organizationId, create, guards);
      }
      if (modelName === 'paymentRecord') {
        await assertPaymentRecordIntegrity(organizationId, create, guards);
      }
      return rawModel.create({ data: create });
    },

    delete: async (args) => {
      assertTenantContext(organizationId);
      if (!args || !args.where) throw new Error('delete requires where');
      assertWhereTenantMatches(args.where, organizationId);
      const flatWhere = flattenWhere(args.where);
      const tenantWhere = { ...flatWhere, organizationId };

      const existing = await rawModel.findFirst({ where: tenantWhere });
      if (!existing) {
        const err = new Error(`Record not found for delete (tenant ${organizationId})`);
        err.code = 'P2025';
        throw err;
      }
      const whereForDelete = { id: existing.id };
      return rawModel.delete({ ...args, where: whereForDelete });
    },

    deleteMany: async (args = {}) => {
      assertTenantContext(organizationId);
      const where = injectWhere(args.where, organizationId);
      return rawModel.deleteMany({ ...args, where });
    },
  };
}

// ---------------------------------------------------------------------------
// Factory: create a tenant-scoped Prisma client bound to one organizationId
// ---------------------------------------------------------------------------

function createTenantPrisma(organizationId) {
  assertTenantContext(organizationId);

  const tenantClient = {
    // Global models pass through directly (no tenant filtering)
    organization: prisma.organization,
    permission: prisma.permission,

    // Tenant-scoped wrapped delegates
    role: wrapModel('role', prisma.role, organizationId),
    team: wrapModel('team', prisma.team, organizationId),
    user: wrapModel('user', prisma.user, organizationId),
    teamMembership: wrapModel('teamMembership', prisma.teamMembership, organizationId),
    rolePermission: wrapModel('rolePermission', prisma.rolePermission, organizationId),
    contact: wrapModel('contact', prisma.contact, organizationId),
    requirement: wrapModel('requirement', prisma.requirement, organizationId),
    possibleDuplicate: wrapModel('possibleDuplicate', prisma.possibleDuplicate, organizationId),
    project: wrapModel('project', prisma.project, organizationId),
    unit: wrapModel('unit', prisma.unit, organizationId),
    leadSource: wrapModel('leadSource', prisma.leadSource, organizationId),
    campaign: wrapModel('campaign', prisma.campaign, organizationId),
    enquiry: wrapModel('enquiry', prisma.enquiry, organizationId),
    lead: wrapModel('lead', prisma.lead, organizationId),
    assignmentRule: wrapModel('assignmentRule', prisma.assignmentRule, organizationId),
    roundRobinState: wrapModel('roundRobinState', prisma.roundRobinState, organizationId),
    idempotencyKey: wrapModel('idempotencyKey', prisma.idempotencyKey, organizationId),
    deal: wrapModel('deal', prisma.deal, organizationId),
    auditLog: wrapModel('auditLog', prisma.auditLog, organizationId),
    siteVisit: wrapModel('siteVisit', prisma.siteVisit, organizationId),
    reservation: wrapModel('reservation', prisma.reservation, organizationId),
    booking: wrapModel('booking', prisma.booking, organizationId),
    paymentPlan: wrapModel('paymentPlan', prisma.paymentPlan, organizationId),
    paymentObligation: wrapModel('paymentObligation', prisma.paymentObligation, organizationId),
    paymentRecord: wrapModel('paymentRecord', prisma.paymentRecord, organizationId),

    // Preserve raw access for advanced needs, but clearly marked as unscoped
    _raw: prisma,
    _organizationId: organizationId,

    // Transaction wrapping preserves tenant context.
    // Supports both:
    //   tenant.$transaction([op1, op2])
    //   tenant.$transaction(async (tx) => { await tx.user.findMany() })
    $transaction: async (arg, options) => {
      if (Array.isArray(arg)) {
        // Array form: each element is already a Prisma promise.
        // These promises were created via tenant delegates, so they already carry tenant filtering.
        // We just delegate to raw prisma.
        return prisma.$transaction(arg, options);
      }
      if (typeof arg === 'function') {
        return prisma.$transaction(async (rawTx) => {
          // Create a tenant-scoped tx mirroring the same wrapping but bound to rawTx.
          // Guards also bind to rawTx so they observe uncommitted rows written
          // earlier in the same transaction (e.g. intake creating Contact then
          // Requirement/Lead referencing it).
          const txWrap = (modelName, rawDelegate) => wrapModel(modelName, rawDelegate, organizationId, rawTx);
          const txClient = {
            organization: rawTx.organization,
            permission: rawTx.permission,
            role: txWrap('role', rawTx.role),
            team: txWrap('team', rawTx.team),
            user: txWrap('user', rawTx.user),
            teamMembership: txWrap('teamMembership', rawTx.teamMembership),
            rolePermission: txWrap('rolePermission', rawTx.rolePermission),
            contact: txWrap('contact', rawTx.contact),
            requirement: txWrap('requirement', rawTx.requirement),
            possibleDuplicate: txWrap('possibleDuplicate', rawTx.possibleDuplicate),
            project: txWrap('project', rawTx.project),
            unit: txWrap('unit', rawTx.unit),
            leadSource: txWrap('leadSource', rawTx.leadSource),
            campaign: txWrap('campaign', rawTx.campaign),
            enquiry: txWrap('enquiry', rawTx.enquiry),
            lead: txWrap('lead', rawTx.lead),
            assignmentRule: txWrap('assignmentRule', rawTx.assignmentRule),
            roundRobinState: txWrap('roundRobinState', rawTx.roundRobinState),
            idempotencyKey: txWrap('idempotencyKey', rawTx.idempotencyKey),
            deal: txWrap('deal', rawTx.deal),
            auditLog: txWrap('auditLog', rawTx.auditLog),
            siteVisit: txWrap('siteVisit', rawTx.siteVisit),
            reservation: txWrap('reservation', rawTx.reservation),
            booking: txWrap('booking', rawTx.booking),
            paymentPlan: txWrap('paymentPlan', rawTx.paymentPlan),
            paymentObligation: txWrap('paymentObligation', rawTx.paymentObligation),
            paymentRecord: txWrap('paymentRecord', rawTx.paymentRecord),
            _raw: rawTx,
            _organizationId: organizationId,
          };
          return arg(txClient);
        }, options);
      }
      throw new Error('$transaction requires an array or callback function');
    },

    $disconnect: () => prisma.$disconnect(),
    $connect: () => prisma.$connect(),
  };

  return tenantClient;
}

module.exports = {
  TenantContextError,
  CrossTenantError,
  createTenantPrisma,
};

