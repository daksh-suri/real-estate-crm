const { z } = require('zod');
const { validate } = require('../../lib/validate');

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


module.exports = {
  createLeadSourceSchema,
  updateLeadSourceSchema,
  leadSourceIdParamSchema,
  listQuerySchema,
  validate,
};
