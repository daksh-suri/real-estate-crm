const { PrismaClient } = require('@prisma/client');

// Singleton raw Prisma client — the only instance that talks to PostgreSQL.
// This client is NOT tenant-scoped. Tenant-scoped access must go through
// createTenantPrisma(organizationId) in tenant.js, which wraps this client
// with fail-closed, operation-correct injection of organizationId.

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'test' ? [] : ['warn', 'error'],
});

// Model classification — single source of truth for tenant scoping.
// Keep in sync with prisma/schema.prisma comments.
//
// GLOBAL: no organizationId column, must NOT be filtered by tenant extension.
// TENANT-SCOPED: organizationId NOT NULL, every query must be constrained.
const TENANT_MODELS = new Set([
  'role',
  'team',
  'user',
  'teamMembership',
  'rolePermission',
  'refreshToken',
]);

const GLOBAL_MODELS = new Set([
  'organization',
  'permission',
]);

// Prisma client property names are lowercase camelCase matching model names.
// Maps for validation / documentation.
const TENANT_MODEL_NAMES = ['Role', 'Team', 'User', 'TeamMembership', 'RolePermission', 'RefreshToken'];
const GLOBAL_MODEL_NAMES = ['Organization', 'Permission'];

module.exports = {
  prisma,
  TENANT_MODELS,
  GLOBAL_MODELS,
  TENANT_MODEL_NAMES,
  GLOBAL_MODEL_NAMES,
};
