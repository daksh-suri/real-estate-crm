const { z } = require('zod');

const leadStatuses = ['OPEN', 'CONVERTED', 'DISQUALIFIED'];

const updateLeadSchema = z.object({
  status: z.enum(leadStatuses).optional(),
  requirementId: z.string().uuid().optional().nullable(),
});

const reassignSchema = z.object({
  assignedAgentId: z.string().uuid(),
});

const leadIdParamSchema = z.object({
  leadId: z.string().uuid(),
});

const listQuerySchema = z.object({
  status: z.enum(leadStatuses).optional(),
  contactId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  assignedAgentId: z.string().uuid().optional(),
  leadSourceId: z.string().uuid().optional(),
  campaignId: z.string().uuid().optional(),
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
  leadStatuses,
  updateLeadSchema,
  reassignSchema,
  leadIdParamSchema,
  listQuerySchema,
  validate,
};
