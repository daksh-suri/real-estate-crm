const { z } = require('zod');

const createRequirementSchema = z.object({
  contactId: z.string().uuid(),
  unitTypePreference: z.string().trim().max(50).optional().nullable(),
  budgetMin: z.coerce.number().nonnegative().optional().nullable(),
  budgetMax: z.coerce.number().nonnegative().optional().nullable(),
  preferredProjectIds: z.array(z.string().uuid()).optional().default([]),
  possessionPreference: z.string().trim().max(50).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  isActive: z.boolean().optional(),
}).refine((data) => {
  if (data.budgetMin != null && data.budgetMax != null) {
    return data.budgetMax >= data.budgetMin;
  }
  return true;
}, { message: 'budgetMax must be >= budgetMin', path: ['budgetMax'] });

const updateRequirementSchema = z.object({
  unitTypePreference: z.string().trim().max(50).optional().nullable(),
  budgetMin: z.coerce.number().nonnegative().optional().nullable(),
  budgetMax: z.coerce.number().nonnegative().optional().nullable(),
  preferredProjectIds: z.array(z.string().uuid()).optional(),
  possessionPreference: z.string().trim().max(50).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  isActive: z.boolean().optional(),
}).refine((data) => {
  if (data.budgetMin != null && data.budgetMax != null) {
    return data.budgetMax >= data.budgetMin;
  }
  return true;
}, { message: 'budgetMax must be >= budgetMin', path: ['budgetMax'] });

const requirementIdParamSchema = z.object({
  requirementId: z.string().uuid(),
});

const contactIdParamSchema = z.object({
  contactId: z.string().uuid(),
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
  createRequirementSchema,
  updateRequirementSchema,
  requirementIdParamSchema,
  contactIdParamSchema,
  validate,
};
