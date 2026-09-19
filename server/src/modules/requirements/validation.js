const { z } = require('zod');
const { validate, withBudgetRange } = require('../../lib/validate');

const createRequirementSchema = withBudgetRange(z.object({
  contactId: z.string().uuid(),
  unitTypePreference: z.string().trim().max(50).optional().nullable(),
  budgetMin: z.coerce.number().nonnegative().optional().nullable(),
  budgetMax: z.coerce.number().nonnegative().optional().nullable(),
  preferredProjectIds: z.array(z.string().uuid()).optional().default([]),
  possessionPreference: z.string().trim().max(50).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  isActive: z.boolean().optional(),
}));

const updateRequirementSchema = withBudgetRange(z.object({
  unitTypePreference: z.string().trim().max(50).optional().nullable(),
  budgetMin: z.coerce.number().nonnegative().optional().nullable(),
  budgetMax: z.coerce.number().nonnegative().optional().nullable(),
  preferredProjectIds: z.array(z.string().uuid()).optional(),
  possessionPreference: z.string().trim().max(50).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  isActive: z.boolean().optional(),
}));

const requirementIdParamSchema = z.object({
  requirementId: z.string().uuid(),
});

const contactIdParamSchema = z.object({
  contactId: z.string().uuid(),
});


module.exports = {
  createRequirementSchema,
  updateRequirementSchema,
  requirementIdParamSchema,
  contactIdParamSchema,
  validate,
};
