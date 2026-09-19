const { z } = require('zod');
const { validate, datetimeSchema } = require('../../lib/validate');

// `type`/`outcome` are free-form: no allowed values exist in any source.
// Constrained strings, never an invented taxonomy (see DEC-031).
const createActivitySchema = z.object({
  contactId: z.string().uuid(),
  leadId: z.string().uuid().optional().nullable(),
  dealId: z.string().uuid().optional().nullable(),
  type: z.string().trim().min(1).max(50),
  outcome: z.string().trim().max(50).optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
  followUpTask: z
    .object({
      assignedTo: z.string().uuid(),
      title: z.string().trim().min(1).max(200),
      dueAt: datetimeSchema,
      relatedContactId: z.string().uuid().optional().nullable(),
      relatedDealId: z.string().uuid().optional().nullable(),
    })
    .optional(),
});

const activityIdParamSchema = z.object({
  activityId: z.string().uuid(),
});

const activityListQuerySchema = z.object({
  contactId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const createTaskSchema = z.object({
  assignedTo: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  dueAt: datetimeSchema,
  relatedContactId: z.string().uuid().optional().nullable(),
  relatedDealId: z.string().uuid().optional().nullable(),
});

const taskIdParamSchema = z.object({
  taskId: z.string().uuid(),
});

const taskListQuerySchema = z.object({
  assignedTo: z.string().uuid().optional(),
  status: z.enum(['OPEN', 'DONE', 'OVERDUE']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

module.exports = {
  createActivitySchema,
  activityIdParamSchema,
  activityListQuerySchema,
  createTaskSchema,
  taskIdParamSchema,
  taskListQuerySchema,
  validate,
};
