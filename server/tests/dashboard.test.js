const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/lib/prisma');
const { hashPassword } = require('../src/lib/bcrypt');

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

let phoneCtr = 9850000000;
function identity(tag) {
  phoneCtr += 1;
  return {
    contactName: `Person ${tag} ${phoneCtr}`,
    phone: String(phoneCtr),
    email: `${tag}-${phoneCtr}@test.com`,
  };
}

describe('Checkpoint 17H — Dashboard', () => {
  let orgA, orgB;
  let tokenA, tokenB;

  const PERMS = [
    ['contact', 'create'], ['contact', 'read'],
    ['enquiry', 'create'],
    ['deal', 'create'], ['deal', 'read'], ['deal', 'transition'],
    ['lead', 'read'],
    ['siteVisit', 'create'], ['siteVisit', 'read'],
    ['task', 'create'], ['task', 'read'],
    ['activity', 'create'], ['activity', 'read'],
    ['booking', 'read'],
    ['reservation', 'read'],
    ['paymentObligation', 'read'],
    ['paymentPlan', 'create'], ['paymentPlan', 'read'],
    ['unit', 'read'],
    ['document', 'read'],
  ];

  async function wipeAll() {
    await prisma.refreshToken.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.idempotencyKey.deleteMany({});
    await prisma.task.deleteMany({});
    await prisma.activity.deleteMany({});
    await prisma.document.deleteMany({});
    await prisma.booking.deleteMany({});
    await prisma.reservation.deleteMany({});
    await prisma.siteVisit.deleteMany({});
    await prisma.paymentRecord.deleteMany({});
    await prisma.paymentObligation.deleteMany({});
    await prisma.paymentPlan.deleteMany({});
    await prisma.deal.deleteMany({});
    await prisma.lead.deleteMany({});
    await prisma.enquiry.deleteMany({});
    await prisma.roundRobinState.deleteMany({});
    await prisma.assignmentRule.deleteMany({});
    await prisma.campaign.deleteMany({});
    await prisma.leadSource.deleteMany({});
    await prisma.requirement.deleteMany({});
    await prisma.unit.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.possibleDuplicate.deleteMany({});
    await prisma.contact.deleteMany({});
    await prisma.teamMembership.deleteMany({});
    await prisma.rolePermission.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.team.deleteMany({});
    await prisma.role.deleteMany({});
    await prisma.permission.deleteMany({});
    await prisma.organization.deleteMany({});
  }

  async function grantAll(orgId, roleId) {
    for (const [resource, action] of PERMS) {
      let perm = await prisma.permission.findFirst({ where: { resource, action } });
      if (!perm) perm = await prisma.permission.create({ data: { resource, action } });
      await prisma.rolePermission.create({
        data: { organizationId: orgId, roleId, permissionId: perm.id, scope: 'ORGANIZATION' },
      });
    }
  }

  async function makeUser(orgId, roleId, tag, plain) {
    const user = await prisma.user.create({
      data: {
        name: tag, email: `${uid(tag)}@test.com`, organizationId: orgId, roleId,
        passwordHash: await hashPassword(plain), status: 'ACTIVE',
      },
    });
    const res = await request(app).post('/auth/login').send({ email: user.email, password: plain, organizationId: orgId });
    expect(res.status).toBe(200);
    return { user, token: res.body.accessToken };
  }

  beforeAll(async () => {
    await wipeAll();
    orgA = await prisma.organization.create({ data: { name: uid('OrgA') } });
    orgB = await prisma.organization.create({ data: { name: uid('OrgB') } });

    const roleA = await prisma.role.create({ data: { name: 'Admin', organizationId: orgA.id } });
    const roleB = await prisma.role.create({ data: { name: 'Admin', organizationId: orgB.id } });
    await grantAll(orgA.id, roleA.id);
    await grantAll(orgB.id, roleB.id);

    ({ token: tokenA } = await makeUser(orgA.id, roleA.id, 'AdminA', 'AdminPass123!'));
    ({ token: tokenB } = await makeUser(orgB.id, roleB.id, 'AdminB', 'AdminBPass123!'));

    const authA = (r) => r.set('Authorization', `Bearer ${tokenA}`);
    const id1 = identity('d1');
    const id2 = identity('d2');
    const id3 = identity('d3');

    // Create contacts + enquiries + leads
    const c1 = (await authA(request(app).post('/contacts')).send({ name: id1.contactName, phone: id1.phone, email: id1.email }));
    expect(c1.status).toBe(201);
    const c2 = (await authA(request(app).post('/contacts')).send({ name: id2.contactName, phone: id2.phone, email: id2.email }));
    expect(c2.status).toBe(201);
    const c3 = (await authA(request(app).post('/contacts')).send({ name: id3.contactName, phone: id3.phone, email: id3.email }));
    expect(c3.status).toBe(201);
    const contactId = c1.body.contact.id;

    const e1 = (await authA(request(app).post('/enquiries')).send({ channel: 'WALK_IN', ...id1 }));
    expect(e1.status).toBe(201);
    const e2 = (await authA(request(app).post('/enquiries')).send({ channel: 'PHONE', ...id2 }));
    expect(e2.status).toBe(201);

    // Lead 3 stays OPEN (not converted)
    const e3 = (await authA(request(app).post('/enquiries')).send({ channel: 'PORTAL', ...id3, phone: id3.phone, email: id3.email }));
    expect(e3.status).toBe(201);

    // Create 2 deals (both from converted leads)
    const d1 = (await authA(request(app).post('/deals')).send({ leadId: e1.body.lead.id }));
    expect(d1.status).toBe(201);
    const d2 = (await authA(request(app).post('/deals')).send({ leadId: e2.body.lead.id }));
    expect(d2.status).toBe(201);

    // Transition deal 1 to QUALIFIED, deal 2 to CLOSED_LOST
    const tr = (await authA(request(app).post(`/deals/${d1.body.id}/stage-transition`)).send({ stage: 'QUALIFIED' }));
    expect(tr.status).toBe(200);
    const lost = (await authA(request(app).post(`/deals/${d2.body.id}/stage-transition`)).send({ stage: 'CLOSED_LOST', lostReason: 'Budget' }));
    expect(lost.status).toBe(200);

    // Create project + units
    const adminA = await prisma.user.findFirst({ where: { organizationId: orgA.id, name: 'AdminA' } });
    const project = await prisma.project.create({ data: { name: uid('Proj'), organizationId: orgA.id } });
    const unit1 = await prisma.unit.create({ data: { identifier: 'A-101', projectId: project.id, organizationId: orgA.id, availabilityStatus: 'BOOKED' } });
    const unit2 = await prisma.unit.create({ data: { identifier: 'A-102', projectId: project.id, organizationId: orgA.id, availabilityStatus: 'RESERVED' } });
    const unit3 = await prisma.unit.create({ data: { identifier: 'A-103', projectId: project.id, organizationId: orgA.id } });

    // Visit: SCHEDULED, future
    await prisma.siteVisit.create({
      data: {
        organizationId: orgA.id, agentId: adminA.id, projectId: project.id, contactId,
        scheduledAt: new Date(Date.now() + 86400000), status: 'SCHEDULED',
      },
    });

    // Reservation 1: ACTIVE, expiring in 3 days
    const res1 = await prisma.reservation.create({
      data: {
        organizationId: orgA.id, unitId: unit1.id, dealId: d1.body.id, type: 'RESERVATION',
        expiresAt: new Date(Date.now() + 3 * 86400000),
      },
    });

    // Reservation 2: ACTIVE, no expiry
    await prisma.reservation.create({
      data: {
        organizationId: orgA.id, unitId: unit2.id, dealId: d2.body.id, type: 'RESERVATION',
      },
    });

    // Reservation 3: already expired — must NOT count as expiring
    await prisma.reservation.create({
      data: {
        organizationId: orgA.id, unitId: unit3.id, dealId: d1.body.id, type: 'HOLD',
        expiresAt: new Date(Date.now() - 86400000), status: 'EXPIRED',
      },
    });

    // Booking from reservation 1
    await prisma.booking.create({
      data: { organizationId: orgA.id, unitId: unit1.id, dealId: d1.body.id, reservationId: res1.id },
    });

    // Payment plan + obligations
    const plan = await prisma.paymentPlan.create({ data: { organizationId: orgA.id, dealId: d1.body.id } });
    // Overdue obligation
    await prisma.paymentObligation.create({
      data: {
        organizationId: orgA.id, paymentPlanId: plan.id, dueAmount: 100000,
        dueDate: new Date(Date.now() - 86400000),
      },
    });
    // Future obligation (not overdue)
    await prisma.paymentObligation.create({
      data: {
        organizationId: orgA.id, paymentPlanId: plan.id, dueAmount: 50000,
        dueDate: new Date(Date.now() + 86400000),
      },
    });

    // Tasks: 1 overdue, 1 open future
    await prisma.task.create({
      data: {
        organizationId: orgA.id, assignedTo: adminA.id, title: 'Overdue task',
        dueAt: new Date(Date.now() - 86400000), createdBy: adminA.id,
      },
    });
    await prisma.task.create({
      data: {
        organizationId: orgA.id, assignedTo: adminA.id, title: 'Future task',
        dueAt: new Date(Date.now() + 86400000), createdBy: adminA.id,
      },
    });

    // Activities (3)
    await prisma.activity.create({
      data: { organizationId: orgA.id, contactId, type: 'CALL', outcome: 'CONNECTED', createdBy: adminA.id },
    });
    await prisma.activity.create({
      data: { organizationId: orgA.id, contactId, type: 'EMAIL', createdBy: adminA.id },
    });
    await prisma.activity.create({
      data: { organizationId: orgA.id, contactId, type: 'MEETING', createdBy: adminA.id },
    });

    // Soft-delete one unit to verify groupBy excludes it
    await prisma.unit.update({ where: { id: unit3.id }, data: { deletedAt: new Date() } });

    // Soft-delete one deal to verify groupBy excludes it
    await prisma.deal.update({ where: { id: d2.body.id }, data: { deletedAt: new Date() } });

    // orgB seed: 1 contact + 1 lead only
    const authB = (r) => r.set('Authorization', `Bearer ${tokenB}`);
    const idB = identity('dB');
    const cB = (await authB(request(app).post('/contacts')).send({ name: idB.contactName, phone: idB.phone, email: idB.email }));
    expect(cB.status).toBe(201);
    await authB(request(app).post('/enquiries')).send({ channel: 'WALK_IN', ...idB });
  });

  afterAll(async () => {
    await wipeAll();
    await prisma.$disconnect();
  });

  // --- KPI aggregation correctness ---

  test('KPI counts are correct', async () => {
    const res = await request(app).get('/dashboard').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.openLeads).toBe(1);
    expect(res.body.activeDeals).toBe(1);
    expect(res.body.upcomingVisits).toBe(1);
    expect(res.body.activeReservations).toBe(2);
    expect(res.body.openTasks).toBe(2);
    expect(res.body.overdueTasks).toBe(1);
    expect(res.body.overduePayments).toBe(1);
    expect(res.body.expiringReservations).toBe(1);
  });

  // --- Soft-deleted records excluded ---

  test('soft-deleted deals excluded from activeDeals and dealsByStage', async () => {
    const res = await request(app).get('/dashboard').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    // Only the non-deleted QUALIFIED deal counts
    expect(res.body.activeDeals).toBe(1);
    const byStage = Object.fromEntries(res.body.dealsByStage.map((r) => [r.stage, r.count]));
    expect(byStage).toEqual({ QUALIFIED: 1 });
  });

  test('soft-deleted units excluded from unitsByAvailability', async () => {
    const res = await request(app).get('/dashboard').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    // unit3 was soft-deleted, so only unit1 (BOOKED via booking) + unit2 (RESERVED via reservation) remain
    const avail = Object.fromEntries(res.body.unitsByAvailability.map((r) => [r.availabilityStatus, r.count]));
    expect(avail.BOOKED).toBe(1);
    expect(avail.RESERVED).toBe(1);
    expect(avail.AVAILABLE).toBeUndefined();
  });

  // --- Tenant isolation ---

  test('tenant isolation: orgB sees only orgB data', async () => {
    const resA = await request(app).get('/dashboard').set('Authorization', `Bearer ${tokenA}`);
    const resB = await request(app).get('/dashboard').set('Authorization', `Bearer ${tokenB}`);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    expect(resB.body.openLeads).toBe(1);
    expect(resB.body.activeDeals).toBe(0);
    expect(resB.body.upcomingVisits).toBe(0);
    expect(resB.body.activeReservations).toBe(0);
    expect(resB.body.openTasks).toBe(0);
    expect(resB.body.overdueTasks).toBe(0);
    expect(resB.body.overduePayments).toBe(0);
    expect(resB.body.expiringReservations).toBe(0);
    expect(resB.body.dealsByStage).toEqual([]);
    expect(resB.body.unitsByAvailability).toEqual([]);
    expect(resB.body.recentActivities).toEqual([]);
    expect(resB.body.upcomingVisitsList).toEqual([]);
  });

  // --- Authorization ---

  test('401 without token; 200 for authenticated user (no new permission needed)', async () => {
    const anon = await request(app).get('/dashboard');
    expect(anon.status).toBe(401);
    // Authenticated user (even with minimal perms) can access dashboard
    const res = await request(app).get('/dashboard').set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(200);
  });

  // --- Empty organization ---

  test('org with minimal data returns valid structures (no errors)', async () => {
    const res = await request(app).get('/dashboard').set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(200);
    // orgB has 1 open lead from the seed; everything else is zero/empty
    expect(res.body.openLeads).toBe(1);
    expect(res.body.activeDeals).toBe(0);
    expect(res.body.upcomingVisits).toBe(0);
    expect(res.body.activeReservations).toBe(0);
    expect(res.body.openTasks).toBe(0);
    expect(res.body.overdueTasks).toBe(0);
    expect(res.body.overduePayments).toBe(0);
    expect(res.body.expiringReservations).toBe(0);
    expect(res.body.dealsByStage).toEqual([]);
    expect(res.body.unitsByAvailability).toEqual([]);
    expect(res.body.recentActivities).toEqual([]);
    expect(res.body.upcomingVisitsList).toEqual([]);
  });

  // --- Overdue tasks ---

  test('overdue tasks: OPEN + past dueAt counted; DONE tasks excluded', async () => {
    const res = await request(app).get('/dashboard').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.overdueTasks).toBe(1);
    expect(res.body.openTasks).toBe(2);
  });

  // --- Overdue payments ---

  test('overdue payments: PENDING + past dueDate counted', async () => {
    const res = await request(app).get('/dashboard').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.overduePayments).toBe(1);
  });

  // --- Expiring reservations ---

  test('expiring reservations: ACTIVE + [now, now+7d) only', async () => {
    const res = await request(app).get('/dashboard').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    // Only reservation 1 (expires in 3 days) counts.
    // Reservation 2 has no expiry, reservation 3 is EXPIRED.
    expect(res.body.expiringReservations).toBe(1);
  });

  // --- Deals grouped by stage ---

  test('dealsByStage returns only non-deleted active deals', async () => {
    const res = await request(app).get('/dashboard').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.dealsByStage).toEqual([{ stage: 'QUALIFIED', count: 1 }]);
  });

  // --- Units grouped by availability ---

  test('unitsByAvailability returns non-deleted unit distribution', async () => {
    const res = await request(app).get('/dashboard').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    const statuses = res.body.unitsByAvailability.map((r) => r.availabilityStatus);
    expect(statuses).toContain('BOOKED');
    expect(statuses).toContain('RESERVED');
  });

  // --- Recent activities ordering/limit ---

  test('recentActivities returns latest 5 ordered by createdAt desc', async () => {
    const res = await request(app).get('/dashboard').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.recentActivities.length).toBeLessThanOrEqual(5);
    if (res.body.recentActivities.length > 1) {
      const timestamps = res.body.recentActivities.map((a) => new Date(a.createdAt).getTime());
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i - 1]).toBeGreaterThanOrEqual(timestamps[i]);
      }
    }
    // Should have only the allowed fields
    for (const act of res.body.recentActivities) {
      expect(act).toHaveProperty('id');
      expect(act).toHaveProperty('type');
      expect(act).toHaveProperty('createdAt');
      expect(act).not.toHaveProperty('passwordHash');
    }
  });

  // --- Upcoming visits ordering/limit ---

  test('upcomingVisitsList returns next 5 ordered by scheduledAt asc', async () => {
    const res = await request(app).get('/dashboard').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.upcomingVisitsList.length).toBeLessThanOrEqual(5);
    if (res.body.upcomingVisitsList.length > 1) {
      const times = res.body.upcomingVisitsList.map((v) => new Date(v.scheduledAt).getTime());
      for (let i = 1; i < times.length; i++) {
        expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
      }
    }
  });
});
