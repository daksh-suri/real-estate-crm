// Reports & Analytics (Checkpoint 17G). Read-only aggregates over existing
// records — no new entities, no history reconstruction. Every query runs
// through tenantPrisma, so organizationId is injected fail-closed; data
// scopes (OWN/TEAM/PROJECT) stay unenforced here exactly as on every other
// list endpoint. Snapshot metrics ignore the date range (current state);
// volume metrics filter it half-open: [from, to).
function rangeOn(field, from, to) {
  if (!from && !to) return {};
  const clause = {};
  if (from) clause.gte = from;
  if (to) clause.lt = to;
  return { [field]: clause };
}

function rangeEnvelope(from, to) {
  return { from: from ? from.toISOString() : null, to: to ? to.toISOString() : null };
}

function counts(rows, key) {
  return rows.map((r) => ({ [key]: r[key], count: r._count._all }));
}

async function dealsReport({ tenantPrisma, from, to }) {
  // NOTE: groupBy does not inherit the wrapper's deletedAt filter (see
  // dashboard service) — soft-deleted deals must be excluded explicitly.
  const where = { deletedAt: null, ...rangeOn('createdAt', from, to) };
  const [byStage, created, lost] = await Promise.all([
    tenantPrisma.deal.groupBy({ by: ['stage'], where, _count: { _all: true } }),
    tenantPrisma.deal.count({ where }),
    tenantPrisma.deal.groupBy({
      by: ['lostReason'],
      where: { ...where, stage: 'CLOSED_LOST', lostReason: { not: null } },
      _count: { _all: true },
    }),
  ]);
  return {
    ...rangeEnvelope(from, to),
    created,
    byStage: counts(byStage, 'stage'),
    lostReasons: lost.map((r) => ({ reason: r.lostReason, count: r._count._all })),
  };
}

async function leadsReport({ tenantPrisma, from, to }) {
  const range = rangeOn('createdAt', from, to);
  // deletedAt applies to leads only: the shared range is also used for the
  // enquiry channel breakdown, and Enquiry has no deletedAt column.
  const leadWhere = { deletedAt: null, ...range };
  const [byStatus, created, intakeByChannel] = await Promise.all([
    tenantPrisma.lead.groupBy({ by: ['status'], where: leadWhere, _count: { _all: true } }),
    tenantPrisma.lead.count({ where: leadWhere }),
    tenantPrisma.enquiry.groupBy({ by: ['channel'], where: range, _count: { _all: true } }),
  ]);
  return {
    ...rangeEnvelope(from, to),
    created,
    byStatus: counts(byStatus, 'status'),
    intakeByChannel: counts(intakeByChannel, 'channel'),
  };
}

async function visitsReport({ tenantPrisma, from, to }) {
  const [byStatus, scheduled, cancelled] = await Promise.all([
    tenantPrisma.siteVisit.groupBy({ by: ['status'], _count: { _all: true } }),
    tenantPrisma.siteVisit.count({ where: { ...rangeOn('scheduledAt', from, to) } }),
    tenantPrisma.siteVisit.count({ where: { status: 'CANCELLED', ...rangeOn('cancelledAt', from, to) } }),
  ]);
  return {
    ...rangeEnvelope(from, to),
    scheduled,
    cancelled,
    byStatus: counts(byStatus, 'status'),
  };
}

async function bookingsReport({ tenantPrisma, from, to }) {
  const [booked, cancelled, resByStatus, resByType, expiring] = await Promise.all([
    tenantPrisma.booking.count({ where: { ...rangeOn('bookedAt', from, to) } }),
    tenantPrisma.booking.count({ where: { cancelledAt: { not: null }, ...rangeOn('cancelledAt', from, to) } }),
    tenantPrisma.reservation.groupBy({ by: ['status'], _count: { _all: true } }),
    tenantPrisma.reservation.groupBy({ by: ['type'], _count: { _all: true } }),
    tenantPrisma.reservation.count({
      where: { status: 'ACTIVE', expiresAt: { not: null }, ...rangeOn('expiresAt', from, to) },
    }),
  ]);
  return {
    ...rangeEnvelope(from, to),
    booked,
    cancelled,
    reservationsByStatus: counts(resByStatus, 'status'),
    reservationsByType: counts(resByType, 'type'),
    expiringHolds: expiring,
  };
}

async function paymentsReport({ tenantPrisma, from, to }) {
  const [byStatus, overdue, collected, attempts] = await Promise.all([
    tenantPrisma.paymentObligation.groupBy({ by: ['status'], _count: { _all: true } }),
    tenantPrisma.paymentObligation.count({ where: { status: 'PENDING', dueDate: { lt: new Date() } } }),
    tenantPrisma.paymentRecord.aggregate({
      where: { status: 'SUCCESS', ...rangeOn('createdAt', from, to) },
      _sum: { amount: true },
    }),
    tenantPrisma.paymentRecord.groupBy({
      by: ['status'],
      where: { ...rangeOn('createdAt', from, to) },
      _count: { _all: true },
    }),
  ]);
  return {
    ...rangeEnvelope(from, to),
    obligationsByStatus: counts(byStatus, 'status'),
    overdueNow: overdue,
    collected: collected._sum.amount,
    attemptsByStatus: counts(attempts, 'status'),
  };
}

async function tasksReport({ tenantPrisma, from, to }) {
  const [byStatus, overdue, created, due] = await Promise.all([
    tenantPrisma.task.groupBy({ by: ['status'], where: { deletedAt: null }, _count: { _all: true } }),
    tenantPrisma.task.count({ where: { status: 'OPEN', dueAt: { lt: new Date() } } }),
    tenantPrisma.task.count({ where: { ...rangeOn('createdAt', from, to) } }),
    tenantPrisma.task.count({ where: { ...rangeOn('dueAt', from, to) } }),
  ]);
  return {
    ...rangeEnvelope(from, to),
    created,
    dueInRange: due,
    overdueNow: overdue,
    byStatus: counts(byStatus, 'status'),
  };
}

async function activitiesReport({ tenantPrisma, from, to }) {
  const where = { ...rangeOn('createdAt', from, to) };
  const [total, byType] = await Promise.all([
    tenantPrisma.activity.count({ where }),
    tenantPrisma.activity.groupBy({ by: ['type'], where, _count: { _all: true } }),
  ]);
  return { ...rangeEnvelope(from, to), total, byType: counts(byType, 'type') };
}

async function inventoryReport({ tenantPrisma }) {
  // Snapshot of current state — the date range does not apply (availability
  // is overwritten in place with no history).
  const [units, projects] = await Promise.all([
    tenantPrisma.unit.groupBy({ by: ['availabilityStatus'], where: { deletedAt: null }, _count: { _all: true } }),
    tenantPrisma.project.groupBy({ by: ['status'], where: { deletedAt: null }, _count: { _all: true } }),
  ]);
  return {
    ...rangeEnvelope(null, null),
    unitsByAvailability: counts(units, 'availabilityStatus'),
    projectsByStatus: counts(projects, 'status'),
  };
}

async function documentsReport({ tenantPrisma, from, to }) {
  const [byStatus, byType, reviewed] = await Promise.all([
    tenantPrisma.document.groupBy({ by: ['status'], _count: { _all: true } }),
    tenantPrisma.document.groupBy({ by: ['type'], _count: { _all: true } }),
    tenantPrisma.document.count({ where: { reviewedAt: { not: null }, ...rangeOn('reviewedAt', from, to) } }),
  ]);
  return {
    ...rangeEnvelope(from, to),
    reviewed,
    byStatus: counts(byStatus, 'status'),
    byType: counts(byType, 'type'),
  };
}

async function contactsReport({ tenantPrisma, from, to }) {
  const where = { deletedAt: null, ...rangeOn('createdAt', from, to) };
  const [created, byConsent, duplicatesPending] = await Promise.all([
    tenantPrisma.contact.count({ where }),
    tenantPrisma.contact.groupBy({ by: ['communicationConsent'], where, _count: { _all: true } }),
    tenantPrisma.possibleDuplicate.count({ where: { status: 'PENDING' } }),
  ]);
  return {
    ...rangeEnvelope(from, to),
    created,
    byConsent: counts(byConsent, 'communicationConsent'),
    duplicatesPending,
  };
}

module.exports = {
  dealsReport,
  leadsReport,
  visitsReport,
  bookingsReport,
  paymentsReport,
  tasksReport,
  activitiesReport,
  inventoryReport,
  documentsReport,
  contactsReport,
};
