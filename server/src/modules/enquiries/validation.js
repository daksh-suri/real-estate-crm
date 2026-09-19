const { z } = require('zod');
const { validate, withBudgetRange } = require('../../lib/validate');

const channels = ['PORTAL', 'WALK_IN', 'PHONE', 'OWNED_FORM'];

const requirementInputSchema = withBudgetRange(z.object({
  unitTypePreference: z.string().trim().max(50).optional().nullable(),
  budgetMin: z.coerce.number().nonnegative().optional().nullable(),
  budgetMax: z.coerce.number().nonnegative().optional().nullable(),
  preferredProjectIds: z.array(z.string().uuid()).optional().default([]),
  possessionPreference: z.string().trim().max(50).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
}));

// One normalized intake shape for all four channels (portal adapter, walk-in
// form, phone form, owned form). Channel only describes capture; downstream
// processing is channel-agnostic.
const intakeSchema = z.object({
  channel: z.enum(channels),
  contactName: z.string().trim().min(2).max(100).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  email: z.string().trim().email('Invalid email').max(100).optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
  leadSourceId: z.string().uuid().optional().nullable(),
  campaignId: z.string().uuid().optional().nullable(),
  requirement: requirementInputSchema.optional(),
  rawPayload: z.record(z.any()).optional().default({}),
  communicationConsent: z.enum(['OPTED_IN', 'OPTED_OUT']).optional(),
  consentSource: z.string().trim().max(100).optional().nullable(),
});

const enquiryIdParamSchema = z.object({
  enquiryId: z.string().uuid(),
});

const listQuerySchema = z.object({
  channel: z.enum(channels).optional(),
  contactId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  leadSourceId: z.string().uuid().optional(),
  campaignId: z.string().uuid().optional(),
  linkedLeadId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});


module.exports = {
  channels,
  intakeSchema,
  enquiryIdParamSchema,
  listQuerySchema,
  validate,
};
