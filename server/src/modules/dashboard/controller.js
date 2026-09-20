const service = require('./service');

module.exports = {
  get: async (req, res, next) => {
    try {
      const dashboard = await service.getDashboard({ tenantPrisma: req.tenantPrisma });
      return res.json(dashboard);
    } catch (err) {
      return next(err);
    }
  },
};
