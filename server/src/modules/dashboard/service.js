// Dashboard & Final Integration (Checkpoint 17H). Operational overview —
// single GET /dashboard returning counts, distributions, and short lists.
// Every query runs through tenantPrisma, so organizationId is injected
// fail-closed. Scopes (OWN/TEAM/PROJECT) are unenforced here exactly as
// on every other list endpoint (explicit V1 limitation).
//
// CRITICAL: groupBy does NOT auto-inject deletedAt: null — every query
// against soft-deletable models (lead, deal, unit, task) must pass it
// explicitly. PaymentObligation has no deletedAt; OVERDUE is derived
// (PENDING + past dueDate), never stored.

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

async function getDashboard({ tenantPrisma, now = new Date() }) {
  const nextWeek = new Date(now.getTime() + SEVEN_DAYS_MS);

  const [
    openLeads,
    activeDeals,
    upcomingVisits,
    activeReservations,
    openTasks,
    overdueTasks,
    overduePayments,
    expiringReservations,
    dealsByStage,
    unitsByAvailability,
    recentActivities,
    upcomingVisitsList,
  ] = await Promise.all([
    // KPIs
    tenantPrisma.lead.count({
      where: { status: 'OPEN' },
    }),
    tenantPrisma.deal.count({
      where: {
        stage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] },
        deletedAt: null,
      },
    }),
    tenantPrisma.siteVisit.count({
      where: {
        status: { in: ['SCHEDULED', 'CONFIRMED'] },
        scheduledAt: { gte: now },
      },
    }),
    tenantPrisma.reservation.count({
      where: { status: 'ACTIVE' },
    }),
    tenantPrisma.task.count({
      where: { status: 'OPEN' },
    }),
    tenantPrisma.task.count({
      where: { status: 'OPEN', dueAt: { lt: now } },
    }),
    tenantPrisma.paymentObligation.count({
      where: { status: 'PENDING', dueDate: { lt: now } },
    }),
    tenantPrisma.reservation.count({
      where: {
        status: 'ACTIVE',
        expiresAt: { not: null, gte: now, lt: nextWeek },
      },
    }),

    // Distributions (explicit deletedAt: null — groupBy wrapper does not add it)
    tenantPrisma.deal.groupBy({
      by: ['stage'],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
    tenantPrisma.unit.groupBy({
      by: ['availabilityStatus'],
      where: { deletedAt: null },
      _count: { _all: true },
    }),

    // Lists
    tenantPrisma.activity.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        type: true,
        outcome: true,
        notes: true,
        createdAt: true,
        contactId: true,
        leadId: true,
        dealId: true,
      },
    }),
    tenantPrisma.siteVisit.findMany({
      where: {
        status: { in: ['SCHEDULED', 'CONFIRMED'] },
        scheduledAt: { gte: now },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 5,
      select: {
        id: true,
        scheduledAt: true,
        status: true,
        contactId: true,
        projectId: true,
        dealId: true,
      },
    }),
  ]);

  return {
    openLeads,
    activeDeals,
    upcomingVisits,
    activeReservations,
    openTasks,
    overdueTasks,
    overduePayments,
    expiringReservations,
    dealsByStage: dealsByStage.map((r) => ({ stage: r.stage, count: r._count._all })),
    unitsByAvailability: unitsByAvailability.map((r) => ({
      availabilityStatus: r.availabilityStatus,
      count: r._count._all,
    })),
    recentActivities,
    upcomingVisitsList,
  };
}

module.exports = { getDashboard };
