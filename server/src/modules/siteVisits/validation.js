const { z } = require('zod');
const { validate, datetimeSchema, cancellationReasonSchema } = require('../../lib/validate');

// V1 visit lifecycle. Terminal/historical states have no exits.
// Mirrors the SiteVisitStatus Prisma enum exactly.
const siteVisitStatuses = ['SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];

const createSiteVisitSchema = z.object({
  agentId: z.string().uuid(),
  projectId: z.string().uuid(),
  contactId: z.string().uuid(),
  dealId: z.string().uuid().optional().nullable(),
  scheduledAt: datetimeSchema,
  // Per-visit duration override. No org-level duration configuration exists in
  // V1 and none is built here — the documented 60-minute default applies
  // unless the caller passes an explicit value within sane bounds.
  durationMinutes: z.coerce.number().int().min(15).max(480).optional(),
});

// Rescheduling re-runs the full lock + conflict check; it is never a plain
// field edit. Same row is updated in place — never delete/recreate.
const rescheduleSchema = z.object({
  scheduledAt: datetimeSchema,
  durationMinutes: z.coerce.number().int().min(15).max(480).optional(),
});

const cancelSchema = z.object({
  cancellationReason: cancellationReasonSchema,
});

const siteVisitIdParamSchema = z.object({
  siteVisitId: z.string().uuid(),
});

const listQuerySchema = z.object({
  agentId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
  status: z.enum(siteVisitStatuses).optional(),
  from: datetimeSchema.optional(),
  to: datetimeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});


module.exports = {
  siteVisitStatuses,
  createSiteVisitSchema,
  rescheduleSchema,
  cancelSchema,
  siteVisitIdParamSchema,
  listQuerySchema,
  validate,
};
