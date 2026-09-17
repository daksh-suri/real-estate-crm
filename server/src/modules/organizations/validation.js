const { z } = require('zod');

const updateOrganizationSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100).optional(),
});

function validateUpdateOrganization(data) {
  const result = updateOrganizationSchema.safeParse(data);
  if (!result.success) {
    const err = new Error('Validation failed');
    err.statusCode = 400;
    err.details = result.error.flatten();
    throw err;
  }
  return result.data;
}

module.exports = { updateOrganizationSchema, validateUpdateOrganization };
