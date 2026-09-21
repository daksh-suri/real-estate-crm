const service = require('./service');

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

module.exports = { list, catalogue };
