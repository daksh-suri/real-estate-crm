const { z } = require('zod');

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

const datetimeSchema = z
  .string()
  .trim()
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: 'Invalid datetime' })
  .transform((s) => new Date(s));

const cancellationReasonSchema = z.string().trim().min(1, 'cancellationReason is required').max(500);

function withBudgetRange(schema) {
  return schema.refine(
    (data) => data.budgetMin == null || data.budgetMax == null || data.budgetMax >= data.budgetMin,
    { message: 'budgetMax must be >= budgetMin', path: ['budgetMax'] }
  );
}

module.exports = { validate, datetimeSchema, cancellationReasonSchema, withBudgetRange };
