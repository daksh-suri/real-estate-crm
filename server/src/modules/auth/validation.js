const { z } = require('zod');

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

function validate(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const err = new Error('Validation failed');
    err.statusCode = 400;
    err.details = result.error.flatten();
    throw err;
  }
  return result.data;
}

module.exports = { loginSchema, refreshSchema, logoutSchema, validate };
