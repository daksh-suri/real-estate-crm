const { validate, createTeamSchema, updateTeamSchema, addMemberSchema, teamIdParamSchema, userIdParamSchema } = require('./validation');
const service = require('./service');

async function create(req, res, next) {
  try {
    const { name } = validate(createTeamSchema, req.body);
    const team = await service.createTeam({
      tenantPrisma: req.tenantPrisma,
      organizationId: req.auth.organizationId,
      name,
    });
    return res.status(201).json(team);
  } catch (err) {
    return next(err);
  }
}

async function list(req, res, next) {
  try {
    const teams = await service.listTeams({ tenantPrisma: req.tenantPrisma });
    return res.json(teams);
  } catch (err) {
    return next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const { teamId } = validate(teamIdParamSchema, req.params);
    const team = await service.getTeam({ tenantPrisma: req.tenantPrisma, teamId });
    return res.json(team);
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const { teamId } = validate(teamIdParamSchema, req.params);
    const data = validate(updateTeamSchema, req.body);
    const updated = await service.updateTeam({ tenantPrisma: req.tenantPrisma, teamId, data });
    return res.json(updated);
  } catch (err) {
    return next(err);
  }
}

async function remove(req, res, next) {
  try {
    const { teamId } = validate(teamIdParamSchema, req.params);
    const archived = await service.deleteTeam({ tenantPrisma: req.tenantPrisma, teamId });
    return res.json(archived);
  } catch (err) {
    return next(err);
  }
}

async function addMember(req, res, next) {
  try {
    const { teamId } = validate(teamIdParamSchema, req.params);
    const { userId } = validate(addMemberSchema, req.body);
    const membership = await service.addMember({
      tenantPrisma: req.tenantPrisma,
      organizationId: req.auth.organizationId,
      teamId,
      userId,
    });
    return res.status(201).json(membership);
  } catch (err) {
    return next(err);
  }
}

async function removeMember(req, res, next) {
  try {
    const { teamId } = validate(teamIdParamSchema, { teamId: req.params.teamId });
    const { userId } = validate(userIdParamSchema, { userId: req.params.userId });
    const result = await service.removeMember({
      tenantPrisma: req.tenantPrisma,
      teamId,
      userId,
    });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

async function listMembers(req, res, next) {
  try {
    const { teamId } = validate(teamIdParamSchema, req.params);
    const members = await service.listTeamMembers({ tenantPrisma: req.tenantPrisma, teamId });
    return res.json(members);
  } catch (err) {
    return next(err);
  }
}

async function listUserTeams(req, res, next) {
  try {
    const { userId } = validate(userIdParamSchema, req.params);
    const teams = await service.listUserTeams({ tenantPrisma: req.tenantPrisma, userId });
    return res.json(teams);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  create,
  list,
  getOne,
  update,
  remove,
  addMember,
  removeMember,
  listMembers,
  listUserTeams,
};
