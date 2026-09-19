const { z } = require('zod');
const { validate } = require('../../lib/validate');

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


module.exports = {
  leadStatuses,
  updateLeadSchema,
  reassignSchema,
  leadIdParamSchema,
  listQuerySchema,
  validate,
};
