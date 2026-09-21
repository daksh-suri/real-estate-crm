const service = require('./service');
const { validate, createRoleSchema, replacePermissionsSchema, roleIdParamSchema } = require('./validation');

async function list(req, res, next) {
  try {
    const rows = await service.listRoles({ tenantPrisma: req.tenantPrisma });
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
}

async function catalogue(req, res, next) {
  try {
    const rows = await service.listPermissions();
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
}

async function create(req, res, next) {
  try {
    const { name, permissions } = validate(createRoleSchema, req.body);
    const role = await service.createRole({
      tenantPrisma: req.tenantPrisma,
      organizationId: req.auth.organizationId,
      name,
      permissions,
    });
    return res.status(201).json(role);
  } catch (err) {
    return next(err);
  }
}

async function replacePermissions(req, res, next) {
  try {
    const { roleId } = validate(roleIdParamSchema, req.params);
    const { permissions } = validate(replacePermissionsSchema, req.body);
    const role = await service.replaceRolePermissions({
      tenantPrisma: req.tenantPrisma,
      organizationId: req.auth.organizationId,
      roleId,
      permissions,
    });
    return res.json(role);
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, catalogue, create, replacePermissions };
