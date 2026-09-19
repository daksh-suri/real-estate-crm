const { z } = require('zod');

// Fixed V1 pipeline (Phase 3 #7): nine forward stages plus CLOSED_LOST as a
// parallel terminal outcome. Mirrors the DealStage Prisma enum exactly.
const dealStages = [
  'NEW',
  'QUALIFIED',
  'SITE_VISIT_SCHEDULED',
  'NEGOTIATION',
  'RESERVATION',
  'BOOKING_CONFIRMED',
  'AGREEMENT_SIGNED',
  'PAYMENT_IN_PROGRESS',
  'CLOSED_WON',
  'CLOSED_LOST',
];

// Deal creation converts a Lead: only the source Lead (plus an optional Unit)
// is accepted. Contact is derived from the Lead — never client-supplied — so
// a client cannot manufacture a Deal pointing at another tenant's Contact.
const createDealSchema = z.object({
  leadId: z.string().uuid(),
  unitId: z.string().uuid().optional().nullable(),
});

// Generic PATCH is deliberately narrow: only attaching a Unit to a deal that
// has none. Stage, lostReason, and all relationships are immutable here —
// stage moves only via POST /:dealId/stage-transition.
const updateDealSchema = z.object({
  unitId: z.string().uuid().optional().nullable(),
});

const transitionSchema = z.object({
  stage: z.enum(dealStages),
  // Required (non-blank after trim) when target is CLOSED_LOST; must be
  // absent-or-null otherwise so stale reasons can never linger.
  lostReason: z.string().trim().max(500).optional().nullable(),
  // Optional optimistic concurrency: reject when the stored stage moved on.
  fromStage: z.enum(dealStages).optional(),
});

const dealIdParamSchema = z.object({
  dealId: z.string().uuid(),
});

const listQuerySchema = z.object({
  stage: z.enum(dealStages).optional(),
  contactId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  unitId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
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
  dealStages,
  createDealSchema,
  updateDealSchema,
  transitionSchema,
  dealIdParamSchema,
  listQuerySchema,
  validate,
};
