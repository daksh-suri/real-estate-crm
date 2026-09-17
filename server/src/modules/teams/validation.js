const { z } = require('zod');

const createTeamSchema = z.object({
  name: z.string().trim().min(2, 'Team name must be at least 2 characters').max(100),
});

const updateTeamSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
});

const addMemberSchema = z.object({
  userId: z.string().uuid('userId must be a valid UUID'),
});

const teamIdParamSchema = z.object({
  teamId: z.string().uuid(),
});

const userIdParamSchema = z.object({
  userId: z.string().uuid(),
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
  createTeamSchema,
  updateTeamSchema,
  addMemberSchema,
  teamIdParamSchema,
  userIdParamSchema,
  validate,
};
