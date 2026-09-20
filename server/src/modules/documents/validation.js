const { z } = require('zod');
const { validate } = require('../../lib/validate');

// `type` is free-form: no allowed values are specified anywhere in the
// sources (see DEC-030). Constrained string, never an invented enum.
const documentStatuses = ['NOT_SUBMITTED', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'RESUBMITTED'];

const createDocumentSchema = z.object({
  contactId: z.string().uuid(),
  dealId: z.string().uuid().optional().nullable(),
  type: z.string().trim().min(1).max(50),
});

const documentIdParamSchema = z.object({
  documentId: z.string().uuid(),
});

const rejectSchema = z.object({
  rejectionReason: z.string().trim().min(1, 'rejectionReason is required').max(500),
});

const listQuerySchema = z.object({
  contactId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
  status: z.enum(documentStatuses).optional(),
  type: z.string().trim().max(50).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

module.exports = {
  documentStatuses,
  createDocumentSchema,
  documentIdParamSchema,
  rejectSchema,
  listQuerySchema,
  validate,
};
