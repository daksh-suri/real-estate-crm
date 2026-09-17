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

// ---------------------------------------------------------------------------
// Wrap a single model delegate with tenant logic
// ---------------------------------------------------------------------------

function wrapModel(modelName, rawModel, organizationId) {
  // modelName is the Prisma client property: 'user', 'role', etc.
  return {
    // ----- READ: filter-injected -----
    findMany: async (args = {}) => {
      assertTenantContext(organizationId);
      const where = injectWhere(args.where, organizationId);
      // Soft-delete: exclude deletedAt not null for User and Team unless explicitly queried
      if ((modelName === 'user' || modelName === 'team') && where.deletedAt === undefined) {
        where.deletedAt = null;
      }
      return rawModel.findMany({ ...args, where });
    },

    findFirst: async (args = {}) => {
      assertTenantContext(organizationId);
      const where = injectWhere(args.where, organizationId);
      if ((modelName === 'user' || modelName === 'team') && where.deletedAt === undefined) {
        where.deletedAt = null;
      }
      return rawModel.findFirst({ ...args, where });
    },

    findFirstOrThrow: async (args = {}) => {
      assertTenantContext(organizationId);
      const where = injectWhere(args.where, organizationId);
      if ((modelName === 'user' || modelName === 'team') && where.deletedAt === undefined) {
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
      if ((modelName === 'user' || modelName === 'team') && tenantWhere.deletedAt === undefined) {
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
      if ((modelName === 'user' || modelName === 'team') && tenantWhere.deletedAt === undefined) {
        tenantWhere.deletedAt = null;
      }
      return rawModel.findFirstOrThrow({ ...args, where: tenantWhere });
    },

    count: async (args = {}) => {
      assertTenantContext(organizationId);
      const where = injectWhere(args.where, organizationId);
      if ((modelName === 'user' || modelName === 'team') && where.deletedAt === undefined) {
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
        await assertMembershipTenantIntegrity(organizationId, data, prisma);
      }
      if (modelName === 'user') {
        await assertUserRoleTenantIntegrity(organizationId, data, prisma);
      }
      if (modelName === 'rolePermission') {
        await assertRolePermissionTenantIntegrity(organizationId, data, prisma);
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

      // Cross-tenant guard if roleId is being changed on User
      if (modelName === 'user' && args.data && args.data.roleId !== undefined) {
        const newRoleId = args.data.roleId;
        if (newRoleId !== null) {
          await assertUserRoleTenantIntegrity(organizationId, { roleId: newRoleId }, prisma);
        }
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
          await assertUserRoleTenantIntegrity(organizationId, { roleId: args.update.roleId }, prisma);
        }
        const whereForUpdate = { id: existing.id };
        return rawModel.update({ where: whereForUpdate, data: args.update });
      }
      // Create path guards
      if (modelName === 'teamMembership') {
        await assertMembershipTenantIntegrity(organizationId, create, prisma);
      }
      if (modelName === 'user') {
        await assertUserRoleTenantIntegrity(organizationId, create, prisma);
      }
      if (modelName === 'rolePermission') {
        await assertRolePermissionTenantIntegrity(organizationId, create, prisma);
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
          // Create a tenant-scoped tx mirroring the same wrapping but bound to rawTx
          const txClient = {
            organization: rawTx.organization,
            permission: rawTx.permission,
            role: wrapModel('role', rawTx.role, organizationId),
            team: wrapModel('team', rawTx.team, organizationId),
            user: wrapModel('user', rawTx.user, organizationId),
            teamMembership: wrapModel('teamMembership', rawTx.teamMembership, organizationId),
            rolePermission: wrapModel('rolePermission', rawTx.rolePermission, organizationId),
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
  flattenWhere,
  injectWhere,
};
