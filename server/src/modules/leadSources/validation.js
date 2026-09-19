const { z } = require('zod');

const createLeadSourceSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  type: z.string().trim().max(50).optional().nullable(),
});

const updateLeadSourceSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  type: z.string().trim().max(50).optional().nullable(),
});

const leadSourceIdParamSchema = z.object({
  leadSourceId: z.string().uuid(),
});

const listQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
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

module.exports = {
  createLeadSourceSchema,
  updateLeadSourceSchema,
  leadSourceIdParamSchema,
  listQuerySchema,
  validate,
};
