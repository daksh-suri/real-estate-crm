const { z } = require('zod');
const { validate } = require('../../lib/validate');

const loginSchema = z.object({
  email: z.string().email('Invalid email').trim().toLowerCase(),
  password: z.string().min(1, 'Password required'),
  organizationId: z.string().uuid('organizationId must be a valid UUID'),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(10).optional(),
});

const logoutSchema = z.object({
  refreshToken: z.string().min(10).optional(),
});


module.exports = { loginSchema, refreshSchema, logoutSchema, validate };
