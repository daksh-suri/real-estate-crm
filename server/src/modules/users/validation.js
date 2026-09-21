const { z } = require('zod');
const { validate } = require('../../lib/validate');

const userStatuses = ['ACTIVE', 'ON_LEAVE', 'DEACTIVATED'];

// Employee account creation by an Admin: initial password is admin-set and
// must reach the employee out-of-band (no mail infra in V1 — invite flow
// deferred). Upper bound mirrors the login rule (bcrypt truncates past 72).
const createUserSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().email('Invalid email').trim().toLowerCase().max(255),
  password: z.string().min(8, 'Password must be at least 8 characters').max(72, 'Password too long'),
  roleId: z.string().uuid('roleId must be a valid UUID'),
});

const userIdParamSchema = z.object({
  userId: z.string().uuid('userId must be a valid UUID'),
});

const listQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(userStatuses).optional(),
  teamId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

module.exports = { createUserSchema, userIdParamSchema, listQuerySchema, userStatuses, validate };
