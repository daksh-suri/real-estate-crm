const { z } = require('zod');
const { validate } = require('../../lib/validate');

const createCampaignSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  leadSourceId: z.string().uuid().optional().nullable(),
  startDate: z.coerce.date().optional().nullable(),
  endDate: z.coerce.date().optional().nullable(),
});

const updateCampaignSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  leadSourceId: z.string().uuid().optional().nullable(),
  startDate: z.coerce.date().optional().nullable(),
  endDate: z.coerce.date().optional().nullable(),
});

const campaignIdParamSchema = z.object({
  campaignId: z.string().uuid(),
});

const listQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});


module.exports = {
  createCampaignSchema,
  updateCampaignSchema,
  campaignIdParamSchema,
  listQuerySchema,
  validate,
};
