const { z } = require('zod');
const { validate, datetimeSchema } = require('../../lib/validate');

// Shared half-open date range: [from, to), interpreted at UTC midnight for
// date-only input. Both ends optional (absent = unbounded). from <= to.
const reportRangeSchema = z
  .object({
    from: datetimeSchema.optional(),
    to: datetimeSchema.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'from must be <= to',
    path: ['from'],
  });

module.exports = { validate, reportRangeSchema };
