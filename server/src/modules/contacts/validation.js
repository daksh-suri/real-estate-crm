const { z } = require('zod');
const { validate } = require('../../lib/validate');

const createContactSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  phone: z.string().trim().max(30).optional().nullable(),
  email: z.string().trim().email('Invalid email').max(100).optional().nullable(),
  communicationConsent: z.enum(['OPTED_IN', 'OPTED_OUT']).optional(),
  consentSource: z.string().trim().max(100).optional().nullable(),
});

const updateContactSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  phone: z.string().trim().max(30).optional().nullable(),
  email: z.string().trim().email('Invalid email').max(100).optional().nullable(),
  communicationConsent: z.enum(['OPTED_IN', 'OPTED_OUT']).optional(),
  consentSource: z.string().trim().max(100).optional().nullable(),
});

const contactIdParamSchema = z.object({
  contactId: z.string().uuid(),
});

const listQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const mergeSchema = z.object({
  targetId: z.string().uuid('targetId must be a valid UUID (survivor)'),
  // Alternative: survivorId, duplicateId handled via params
});


module.exports = {
  createContactSchema,
  updateContactSchema,
  contactIdParamSchema,
  listQuerySchema,
  mergeSchema,
  validate,
};
