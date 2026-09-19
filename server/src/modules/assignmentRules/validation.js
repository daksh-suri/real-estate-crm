const { z } = require('zod');
const { validate } = require('../../lib/validate');

const ruleTypes = ['ROUND_ROBIN'];

const createAssignmentRuleSchema = z.object({
  type: z.enum(ruleTypes),
  order: z.coerce.number().int().min(0).optional().default(0),
  // ROUND_ROBIN requires { teamId: uuid }. Extra keys are ignored (never logic).
  config: z.object({ teamId: z.string().uuid().optional() }).passthrough().optional().default({}),
  active: z.boolean().optional().default(true),
});

const updateAssignmentRuleSchema = z.object({
  type: z.enum(ruleTypes).optional(),
  order: z.coerce.number().int().min(0).optional(),
  config: z.object({ teamId: z.string().uuid().optional() }).passthrough().optional(),
  active: z.boolean().optional(),
});

const assignmentRuleIdParamSchema = z.object({
  assignmentRuleId: z.string().uuid(),
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});


module.exports = {
  ruleTypes,
  createAssignmentRuleSchema,
  updateAssignmentRuleSchema,
  assignmentRuleIdParamSchema,
  listQuerySchema,
  validate,
};
