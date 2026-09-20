const request = require('supertest');
const crypto = require('crypto');
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

describe('Checkpoint 17G — Reports & Analytics', () => {
  let orgA, orgB;
  let tokenA, tokenB, tokenAgentA;

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
      // Permission is a global catalogue — find-or-create, never duplicate.
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
    const roleAgentA = await prisma.role.create({ data: { name: 'Agent', organizationId: orgA.id } });
    await grantAll(orgA.id, roleA.id);
    await grantAll(orgB.id, roleB.id);
    // Agent sees activities only — reports on other domains must 403.
    for (const [resource, action] of [['activity', 'create'], ['activity', 'read']]) {
      const perm = await prisma.permission.findFirst({ where: { resource, action } });
      await prisma.rolePermission.create({
        data: { organizationId: orgA.id, roleId: roleAgentA.id, permissionId: perm.id, scope: 'ORGANIZATION' },
      });
    }

    ({ token: tokenA } = await makeUser(orgA.id, roleA.id, 'AdminA', 'AdminPass123!'));
    ({ token: tokenB } = await makeUser(orgB.id, roleB.id, 'AdminB', 'AdminBPass123!'));
    ({ token: tokenAgentA } = await makeUser(orgA.id, roleAgentA.id, 'AgentA', 'AgentPass123!'));

    // orgA seed: 2 contacts, 2 enquiries (WALK_IN + PHONE), 2 deals.
    const authA = (r) => r.set('Authorization', `Bearer ${tokenA}`);
    const id1 = identity('r1');
    const c1 = (await authA(request(app).post('/contacts')).send({ name: id1.contactName, phone: id1.phone, email: id1.email }));
    expect(c1.status).toBe(201);
    const id2 = identity('r2');
    const c2 = (await authA(request(app).post('/contacts')).send({ name: id2.contactName, phone: id2.phone, email: id2.email }));
    expect(c2.status).toBe(201);
    const e1 = (await authA(request(app).post('/enquiries')).send({ channel: 'WALK_IN', ...id1 }));
    expect(e1.status).toBe(201);
    const e2 = (await authA(request(app).post('/enquiries')).send({ channel: 'PHONE', ...id2 }));
    expect(e2.status).toBe(201);
    const d1 = (await authA(request(app).post('/deals')).send({ leadId: e1.body.lead.id }));
    expect(d1.status).toBe(201);
    const d2 = (await authA(request(app).post('/deals')).send({ leadId: e2.body.lead.id }));
    expect(d2.status).toBe(201);
    const tr = (await authA(request(app).post(`/deals/${d1.body.id}/stage-transition`)).send({ stage: 'QUALIFIED' }));
    expect(tr.status).toBe(200);
    const lost = (await authA(request(app).post(`/deals/${d2.body.id}/stage-transition`)).send({ stage: 'CLOSED_LOST', lostReason: 'Budget' }));
    expect(lost.status).toBe(200);

    // orgB seed: 1 lead only (empty-deal reports + isolation target).
    const authB = (r) => r.set('Authorization', `Bearer ${tokenB}`);
    const idB = identity('rB');
    await authB(request(app).post('/contacts')).send({ name: idB.contactName, phone: idB.phone, email: idB.email });
    const eB = (await authB(request(app).post('/enquiries')).send({ channel: 'PORTAL', ...idB }));
    expect(eB.status).toBe(201);

    // Direct rows for visit/booking/payment/task/activity/document/inventory.
    const adminA = await prisma.user.findFirst({ where: { organizationId: orgA.id, name: 'AdminA' } });
    const project = await prisma.project.create({ data: { name: uid('Proj'), organizationId: orgA.id } });
    const unit = await prisma.unit.create({ data: { identifier: 'A-101', projectId: project.id, organizationId: orgA.id } });
    const contactId = c1.body.contact.id;
    await prisma.siteVisit.create({
      data: {
        organizationId: orgA.id, agentId: adminA.id, projectId: project.id, contactId,
        scheduledAt: new Date(), status: 'SCHEDULED',
      },
    });
    const reservation = await prisma.reservation.create({
      data: { organizationId: orgA.id, unitId: unit.id, dealId: d1.body.id, type: 'RESERVATION' },
    });
    await prisma.booking.create({
      data: { organizationId: orgA.id, unitId: unit.id, dealId: d1.body.id, reservationId: reservation.id },
    });
    const plan = await prisma.paymentPlan.create({ data: { organizationId: orgA.id, dealId: d1.body.id } });
    const overdueOb = await prisma.paymentObligation.create({
      data: {
        organizationId: orgA.id, paymentPlanId: plan.id, dueAmount: 100000,
        dueDate: new Date(Date.now() - 86400000),
      },
    });
    await prisma.paymentRecord.create({
      data: { organizationId: orgA.id, obligationId: overdueOb.id, amount: 100000, status: 'SUCCESS' },
    });
    await prisma.task.create({
      data: {
        organizationId: orgA.id, assignedTo: adminA.id, title: 'Follow up',
        dueAt: new Date(Date.now() + 86400000), createdBy: adminA.id,
      },
    });
    await prisma.activity.create({
      data: { organizationId: orgA.id, contactId, type: 'CALL', outcome: 'CONNECTED', createdBy: adminA.id },
    });
    await prisma.document.create({
      data: {
        organizationId: orgA.id, groupId: crypto.randomUUID(), contactId,
        type: 'KYC', storageKey: 'org/contact/group/v1', status: 'SUBMITTED',
      },
    });
  });

  afterAll(async () => {
    await wipeAll();
    await prisma.$disconnect();
  });

  test('deals: stage distribution, creations, lost reasons', async () => {
    const res = await request(app).get('/reports/deals').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(2);
    const byStage = Object.fromEntries(res.body.byStage.map((r) => [r.stage, r.count]));
    expect(byStage).toEqual({ QUALIFIED: 1, CLOSED_LOST: 1 });
    expect(res.body.lostReasons).toEqual([{ reason: 'Budget', count: 1 }]);
  });

  test('date boundaries are half-open [from, to)', async () => {
    const deal = await prisma.deal.findFirst({ where: { organizationId: orgA.id } });
    const iso = deal.createdAt.toISOString();
    const excluded = await request(app).get(`/reports/deals?to=${iso}`).set('Authorization', `Bearer ${tokenA}`);
    expect(excluded.status).toBe(200);
    expect(excluded.body.created).toBe(0);
    const included = await request(app).get(`/reports/deals?from=${iso}`).set('Authorization', `Bearer ${tokenA}`);
    expect(included.status).toBe(200);
    expect(included.body.created).toBeGreaterThanOrEqual(1);
  });

  test('invalid range and dates are 400', async () => {
    const badOrder = await request(app).get('/reports/deals?from=2026-09-02&to=2026-09-01').set('Authorization', `Bearer ${tokenA}`);
    expect(badOrder.status).toBe(400);
    const badDate = await request(app).get('/reports/deals?from=not-a-date').set('Authorization', `Bearer ${tokenA}`);
    expect(badDate.status).toBe(400);
  });

  test('tenant isolation: orgB data invisible to orgA and vice versa', async () => {
    const aDeals = await request(app).get('/reports/deals').set('Authorization', `Bearer ${tokenA}`);
    expect(aDeals.body.created).toBe(2);
    const bDeals = await request(app).get('/reports/deals').set('Authorization', `Bearer ${tokenB}`);
    expect(bDeals.body.created).toBe(0);
    expect(bDeals.body.byStage).toEqual([]);
    const bLeads = await request(app).get('/reports/leads').set('Authorization', `Bearer ${tokenB}`);
    expect(bLeads.body.created).toBe(1);
    const aLeads = await request(app).get('/reports/leads').set('Authorization', `Bearer ${tokenA}`);
    expect(aLeads.body.created).toBe(2);
  });

  test('401 without token; 403 without the domain permission', async () => {
    const anon = await request(app).get('/reports/deals');
    expect(anon.status).toBe(401);
    const agentDeals = await request(app).get('/reports/deals').set('Authorization', `Bearer ${tokenAgentA}`);
    expect(agentDeals.status).toBe(403);
    const agentActivities = await request(app).get('/reports/activities').set('Authorization', `Bearer ${tokenAgentA}`);
    expect(agentActivities.status).toBe(200);
  });

  test('leads: status mix + intake by channel', async () => {
    const res = await request(app).get('/reports/leads').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(2);
    const byStatus = Object.fromEntries(res.body.byStatus.map((r) => [r.status, r.count]));
    expect(byStatus).toEqual({ CONVERTED: 2 });
    const channels = Object.fromEntries(res.body.intakeByChannel.map((r) => [r.channel, r.count]));
    expect(channels).toEqual({ WALK_IN: 1, PHONE: 1 });
  });

  test('visits/bookings/tasks/activities/payments/documents/contacts/inventory spot checks', async () => {
    const auth = (r) => r.set('Authorization', `Bearer ${tokenA}`);
    const visits = await auth(request(app).get('/reports/visits'));
    expect(visits.status).toBe(200);
    expect(visits.body.scheduled).toBe(1);
    expect(visits.body.byStatus).toEqual([{ status: 'SCHEDULED', count: 1 }]);

    const bookings = await auth(request(app).get('/reports/bookings'));
    expect(bookings.status).toBe(200);
    expect(bookings.body.booked).toBe(1);
    const resStatus = Object.fromEntries(bookings.body.reservationsByStatus.map((r) => [r.status, r.count]));
    expect(resStatus.ACTIVE).toBe(1);

    const tasks = await auth(request(app).get('/reports/tasks'));
    expect(tasks.status).toBe(200);
    expect(tasks.body.created).toBe(1);
    expect(tasks.body.overdueNow).toBe(0);

    const activities = await auth(request(app).get('/reports/activities'));
    expect(activities.status).toBe(200);
    expect(activities.body.total).toBe(1);
    expect(activities.body.byType).toEqual([{ type: 'CALL', count: 1 }]);

    const payments = await auth(request(app).get('/reports/payments'));
    expect(payments.status).toBe(200);
    expect(payments.body.overdueNow).toBe(1);
    expect(String(payments.body.collected)).toBe('100000');

    const documents = await auth(request(app).get('/reports/documents'));
    expect(documents.status).toBe(200);
    expect(documents.body.byStatus).toEqual([{ status: 'SUBMITTED', count: 1 }]);

    const contacts = await auth(request(app).get('/reports/contacts'));
    expect(contacts.status).toBe(200);
    expect(contacts.body.created).toBe(2);
    expect(contacts.body.byConsent).toEqual([{ communicationConsent: 'OPTED_IN', count: 2 }]);

    const inventory = await auth(request(app).get('/reports/inventory'));
    expect(inventory.status).toBe(200);
    expect(inventory.body.unitsByAvailability).toEqual([{ availabilityStatus: 'AVAILABLE', count: 1 }]);
  });

  test('empty range returns zeroes, not errors', async () => {
    const res = await request(app)
      .get('/reports/deals?from=2001-01-01&to=2001-02-01')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: 0, byStage: [], lostReasons: [] });
  });
});
