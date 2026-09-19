const { z } = require('zod');
const { validate, cancellationReasonSchema } = require('../../lib/validate');

// Booking has no status enum and no client-mutable fields beyond the
// conversion reference: bookedAt/cancelled* are server-derived, availability
// and reservation lifecycles move only inside the service transaction.
const createBookingSchema = z.object({
  reservationId: z.string().uuid(),
  // Optional cross-checks: when supplied they must match the Reservation's
  // own unit/deal — the service derives authority from the Reservation row,
  // never from these duplicates.
  unitId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
});

const bookingIdParamSchema = z.object({
  bookingId: z.string().uuid(),
});

const cancelBookingSchema = z.object({
  cancellationReason: cancellationReasonSchema,
});

const listQuerySchema = z.object({
  unitId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
  reservationId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});


module.exports = {
  createBookingSchema,
  bookingIdParamSchema,
  cancelBookingSchema,
  listQuerySchema,
  validate,
};
