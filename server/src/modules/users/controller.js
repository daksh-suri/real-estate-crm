const { validate, createUserSchema, userIdParamSchema, listQuerySchema } = require('./validation');
const service = require('./service');

async function create(req, res, next) {
  try {
    const input = validate(createUserSchema, req.body);
    const user = await service.createUser({
      tenantPrisma: req.tenantPrisma,
      organizationId: req.auth.organizationId,
      input,
    });
    return res.status(201).json(user);
  } catch (err) {
    return next(err);
  }
}

async function list(req, res, next) {
  try {
    const query = validate(listQuerySchema, req.query);
    const rows = await service.listUsers({
      tenantPrisma: req.tenantPrisma,
      filters: { search: query.search, status: query.status, teamId: query.teamId },
      limit: query.limit ?? 20,
      offset: query.offset ?? 0,
    });
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const { userId } = validate(userIdParamSchema, req.params);
    const row = await service.getUser({ tenantPrisma: req.tenantPrisma, userId });
    return res.json(row);
  } catch (err) {
    return next(err);
  }
}

module.exports = { create, list, getOne };
