const { z } = require('zod');
const { validate } = require('../../lib/validate');

const scopes = ['OWN', 'TEAM', 'PROJECT', 'ORGANIZATION'];

const permissionItemSchema = z.object({
  permissionId: z.string().uuid('permissionId must be a valid UUID'),
  scope: z.enum(scopes, { errorMap: () => ({ message: `scope must be one of ${scopes.join(', ')}` }) }),
});

const createRoleSchema = z.object({
  name: z.string().trim().min(2, 'Role name too short').max(100, 'Role name too long'),
  permissions: z.array(permissionItemSchema).max(200).optional().default([]),
});

const replacePermissionsSchema = z.object({
  permissions: z.array(permissionItemSchema).max(200),
});

const roleIdParamSchema = z.object({
  roleId: z.string().uuid('roleId must be a valid UUID'),
});

module.exports = { validate, createRoleSchema, replacePermissionsSchema, roleIdParamSchema };
