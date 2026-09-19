const { z } = require('zod');
const { validate } = require('../../lib/validate');

const projectStatuses = ['PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'];
const unitAvailabilities = ['AVAILABLE', 'ON_HOLD', 'RESERVED', 'BOOKED', 'BLOCKED'];

const createProjectSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  location: z.string().trim().max(200).optional().nullable(),
  status: z.enum(projectStatuses).optional(),
});

const updateProjectSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  location: z.string().trim().max(200).optional().nullable(),
  status: z.enum(projectStatuses).optional(),
});

const projectIdParamSchema = z.object({
  projectId: z.string().uuid(),
});

const listQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const createUnitSchema = z.object({
  identifier: z.string().trim().min(1, 'Identifier is required').max(50),
  totalCost: z.coerce.number().nonnegative().optional().nullable(),
  // Creation may only establish initial inventory states. RESERVED / BOOKED /
  // ON_HOLD are owned exclusively by future Reservation/Booking workflows.
  // The Prisma UnitAvailability enum is unchanged and still supports them.
  availabilityStatus: z.enum(['AVAILABLE', 'BLOCKED']).optional(),
});

const updateUnitSchema = z.object({
  identifier: z.string().trim().min(1).max(50).optional(),
  totalCost: z.coerce.number().nonnegative().optional().nullable(),
  // availabilityStatus is intentionally NOT updatable here: transitions are
  // driven only by Reservation/Hold/Booking flows (later checkpoints), never
  // edited directly. See service.updateUnit enforcement.
});

const unitIdParamSchema = z.object({
  unitId: z.string().uuid(),
});


module.exports = {
  projectStatuses,
  unitAvailabilities,
  createProjectSchema,
  updateProjectSchema,
  projectIdParamSchema,
  listQuerySchema,
  createUnitSchema,
  updateUnitSchema,
  unitIdParamSchema,
  validate,
};
