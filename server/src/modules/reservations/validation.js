const { z } = require('zod');
const { validate, datetimeSchema } = require('../../lib/validate');

// V1 discriminator + lifecycle. Mirrors the Prisma enums exactly.
// CONVERTED is reserved for Checkpoint 11 Booking and never produced here,
// but stays listable so history queries need no later shape change.
const reservationTypes = ['RESERVATION', 'HOLD'];
const reservationStatuses = ['ACTIVE', 'EXPIRED', 'CONVERTED', 'RELEASED'];

const createReservationSchema = z.object({
  unitId: z.string().uuid(),
  // Required in V1 per Phase 3 (management holds without a Deal are deferred,
  // see DEC-026) — never silently nulled to make HOLD easier.
  dealId: z.string().uuid(),
  type: z.enum(reservationTypes),
  // Null/absent = no expiry (management-placed hold). A supplied value must
  // be in the future — enforced again transactionally in the service.
  expiresAt: datetimeSchema.optional().nullable(),
});

const reservationIdParamSchema = z.object({
  reservationId: z.string().uuid(),
});

const listQuerySchema = z.object({
  unitId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
  type: z.enum(reservationTypes).optional(),
  status: z.enum(reservationStatuses).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});


module.exports = {
  reservationTypes,
  reservationStatuses,
  createReservationSchema,
  reservationIdParamSchema,
  listQuerySchema,
  validate,
};
