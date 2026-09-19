const { z } = require('zod');
const { validate, datetimeSchema } = require('../../lib/validate');

// Deal-specific schedules only (DEC-029): the obligations array IS the
// custom schedule, supplied per deal at creation. No plan templates.
const obligationInputSchema = z.object({
  dueAmount: z.coerce.number().positive('dueAmount must be positive'),
  dueDate: datetimeSchema,
});

const createPlanSchema = z.object({
  bookingId: z.string().uuid(),
  // Optional cross-check: must match the booking's deal when supplied.
  dealId: z.string().uuid().optional(),
  obligations: z.array(obligationInputSchema).min(1).max(100),
});

const planIdParamSchema = z.object({
  planId: z.string().uuid(),
});

const obligationIdParamSchema = z.object({
  obligationId: z.string().uuid(),
});

const recordIdParamSchema = z.object({
  recordId: z.string().uuid(),
});

const listQuerySchema = z.object({
  dealId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// Provider-neutral webhook boundary. No provider secrets exist in V1, so
// there is no signature to verify — eventId is the dedup identity and the
// obligation carries the tenant. Signing is deferred (see DEC-029).
const webhookSchema = z.object({
  eventId: z.string().trim().min(1).max(100),
  obligationId: z.string().uuid(),
  amount: z.coerce.number().positive('amount must be positive'),
  outcome: z.enum(['SUCCESS', 'PENDING', 'FAILED']),
  gatewayReference: z.string().trim().max(100).optional().nullable(),
  correctsRecordId: z.string().uuid().optional().nullable(),
});

module.exports = {
  createPlanSchema,
  planIdParamSchema,
  obligationIdParamSchema,
  recordIdParamSchema,
  listQuerySchema,
  webhookSchema,
  validate,
};
