const { validate, reportRangeSchema } = require('./validation');
const service = require('./service');

function rangeOf(req) {
  const { from, to } = validate(reportRangeSchema, req.query);
  return { from: from ?? null, to: to ?? null };
}

function handler(fn) {
  return async (req, res, next) => {
    try {
      const { from, to } = rangeOf(req);
      const report = await fn({ tenantPrisma: req.tenantPrisma, from, to });
      return res.json(report);
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = {
  deals: handler(service.dealsReport),
  leads: handler(service.leadsReport),
  visits: handler(service.visitsReport),
  bookings: handler(service.bookingsReport),
  payments: handler(service.paymentsReport),
  tasks: handler(service.tasksReport),
  activities: handler(service.activitiesReport),
  inventory: handler(service.inventoryReport),
  documents: handler(service.documentsReport),
  contacts: handler(service.contactsReport),
};
