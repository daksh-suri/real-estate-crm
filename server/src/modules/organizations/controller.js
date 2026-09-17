const { validateUpdateOrganization } = require('./validation');
const service = require('./service');

async function getCurrent(req, res, next) {
  try {
    const organizationId = req.auth && req.auth.organizationId;
    if (!organizationId) {
      const err = new Error('Unauthorized');
      err.statusCode = 401;
      throw err;
    }
    const org = await service.getCurrentOrganization(organizationId);
    return res.json(org);
  } catch (err) {
    return next(err);
  }
}

async function updateCurrent(req, res, next) {
  try {
    const organizationId = req.auth && req.auth.organizationId;
    if (!organizationId) {
      const err = new Error('Unauthorized');
      err.statusCode = 401;
      throw err;
    }
    const data = validateUpdateOrganization(req.body);
    const updated = await service.updateCurrentOrganization(organizationId, data);
    return res.json(updated);
  } catch (err) {
    return next(err);
  }
}

module.exports = { getCurrent, updateCurrent };
