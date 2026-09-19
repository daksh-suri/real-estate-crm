const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/lib/prisma');
const { hashPassword } = require('../src/lib/bcrypt');

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

let phoneCtr = 9600000000;
function identity(tag) {
  phoneCtr += 1;
  return {
    contactName: `Person ${tag} ${phoneCtr}`,
    phone: String(phoneCtr),
    email: `${tag}-${phoneCtr}@test.com`,
  };
}

const HOUR = 3600000;
function isoFuture(hours) {
  return new Date(Date.now() + hours * HOUR).toISOString();
}

describe('Checkpoint 12 — Payments', () => {
  let orgA, orgB;
  let roleAdminA, roleAgentA, roleAdminB;
  let userAdminA, userAgentA, userAdminB;
  let plainAdminA = 'AdminPass123!';
  let plainAgentA = 'AgentPass123!';
  let plainAdminB = 'AdminBPass123!';

  const PERMS = [
    ['enquiry', 'create'],
    ['lead', 'read'],
    ['contact', 'create'],
    ['contact', 'read'],
    ['project', 'create'],
    ['project', 'read'],
    ['unit', 'create'],
    ['unit', 'read'],
    ['deal', 'create'],
    ['deal', 'read'],
    ['reservation', 'create'],
    ['reservation', 'read'],
    ['booking', 'create'],
    ['booking', 'read'],
    ['paymentPlan', 'create'],
    ['paymentPlan', 'read'],
    ['paymentObligation', 'read'],
    ['paymentRecord', 'read'],
  ];
  const AGENT_PERMS = [['paymentPlan', 'read']];

  async function wipeAll() {
    await prisma.refreshToken.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.idempotencyKey.deleteMany({});
    await prisma.paymentRecord.deleteMany({});
    await prisma.paymentObligation.deleteMany({});
    await prisma.paymentPlan.deleteMany({});
    await prisma.booking.deleteMany({});
    await prisma.reservation.deleteMany({});
    await prisma.siteVisit.deleteMany({});
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

  async function wipeDomain() {
    await prisma.auditLog.deleteMany({});
    await prisma.idempotencyKey.deleteMany({});
    await prisma.paymentRecord.deleteMany({});
    await prisma.paymentObligation.deleteMany({});
    await prisma.paymentPlan.deleteMany({});
    await prisma.booking.deleteMany({});
    await prisma.reservation.deleteMany({});
    await prisma.siteVisit.deleteMany({});
    await prisma.deal.deleteMany({});
    await prisma.lead.deleteMany({});
    await prisma.enquiry.deleteMany({});
    await prisma.requirement.deleteMany({});
    await prisma.unit.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.possibleDuplicate.deleteMany({});
    await prisma.contact.deleteMany({});
    await prisma.refreshToken.deleteMany({});
  }

  beforeAll(async () => {
    await wipeAll();

    orgA = await prisma.organization.create({ data: { name: uid('OrgA') } });
    orgB = await prisma.organization.create({ data: { name: uid('OrgB') } });

    const permByKey = {};
    for (const [resource, action] of PERMS) {
      const p = await prisma.permission.create({ data: { resource, action } });
      permByKey[`${resource}:${action}`] = p;
    }

    roleAdminA = await prisma.role.create({ data: { name: 'Admin', organizationId: orgA.id } });
    roleAgentA = await prisma.role.create({ data: { name: 'Agent', organizationId: orgA.id } });
    roleAdminB = await prisma.role.create({ data: { name: 'Admin', organizationId: orgB.id } });

    for (const p of Object.values(permByKey)) {
      await prisma.rolePermission.create({
        data: { organizationId: orgA.id, roleId: roleAdminA.id, permissionId: p.id, scope: 'ORGANIZATION' },
      });
      await prisma.rolePermission.create({
        data: { organizationId: orgB.id, roleId: roleAdminB.id, permissionId: p.id, scope: 'ORGANIZATION' },
      });
    }
    for (const [resource, action] of AGENT_PERMS) {
      await prisma.rolePermission.create({
        data: {
          organizationId: orgA.id,
          roleId: roleAgentA.id,
          permissionId: permByKey[`${resource}:${action}`].id,
          scope: 'ORGANIZATION',
        },
      });
    }

    userAdminA = await prisma.user.create({
      data: { name: 'AdminA', email: uid('adminA') + '@test.com', organizationId: orgA.id, roleId: roleAdminA.id, passwordHash: await hashPassword(plainAdminA), status: 'ACTIVE' },
    });
    userAgentA = await prisma.user.create({
      data: { name: 'AgentA', email: uid('agentA') + '@test.com', organizationId: orgA.id, roleId: roleAgentA.id, passwordHash: await hashPassword(plainAgentA), status: 'ACTIVE' },
    });
    userAdminB = await prisma.user.create({
      data: { name: 'AdminB', email: uid('adminB') + '@test.com', organizationId: orgB.id, roleId: roleAdminB.id, passwordHash: await hashPassword(plainAdminB), status: 'ACTIVE' },
    });
  });

  afterAll(async () => {
    await wipeAll();
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await wipeDomain();
  });

  async function login(email, password, organizationId) {
    const res = await request(app).post('/auth/login').send({ email, password, organizationId });
    expect(res.status).toBe(200);
    return res.body.accessToken;
  }

  async function makeProject(token, name) {
    const res = await request(app).post('/projects').set('Authorization', `Bearer ${token}`).send({ name: name || uid('Proj') });
    expect(res.status).toBe(201);
    return res.body;
  }

  async function makeUnit(token, projectId, identifier) {
    const res = await request(app)
      .post(`/projects/${projectId}/units`)
      .set('Authorization', `Bearer ${token}`)
      .send({ identifier: identifier || uid('U') });
    expect(res.status).toBe(201);
    return res.body;
  }

  async function makeLead(token, overrides = {}) {
    const res = await request(app)
      .post('/enquiries')
      .set('Authorization', `Bearer ${token}`)
      .send({ channel: 'WALK_IN', ...identity('pay'), ...overrides });
    expect(res.status).toBe(201);
    return res.body.lead;
  }

  async function makeDeal(token, leadId) {
    const res = await request(app).post('/deals').set('Authorization', `Bearer ${token}`).send({ leadId });
    expect(res.status).toBe(201);
    return res.body;
  }

  async function makeReservation(token, unitId, dealId, type = 'RESERVATION') {
    const res = await request(app)
      .post('/reservations')
      .set('Authorization', `Bearer ${token}`)
      .send({ unitId, dealId, type });
    expect(res.status).toBe(201);
    return res.body.reservation;
  }

  async function makeBooking(token, reservationId, key) {
    const req = request(app).post('/bookings').set('Authorization', `Bearer ${token}`).send({ reservationId });
    if (key) req.set('Idempotency-Key', key);
    const res = await req;
    expect(res.status).toBe(201);
    return res.body.booking;
  }

  // Full chain per test: project → unit → lead → deal → reservation → booking.
  async function fixtures(token, tag) {
    const project = await makeProject(token, uid(`Proj-${tag}`));
    const unit = await makeUnit(token, project.id, uid(`U-${tag}`));
    const lead = await makeLead(token);
    const deal = await makeDeal(token, lead.id);
    const reservation = await makeReservation(token, unit.id, deal.id);
    const booking = await makeBooking(token, reservation.id);
    return { project, unit, lead, deal, reservation, booking };
  }

  function planBody(booking, dealId, n = 2) {
    const obligations = [];
    for (let i = 1; i <= n; i += 1) {
      obligations.push({ dueAmount: 50000 * i, dueDate: isoFuture(24 * 30 * i) });
    }
    const body = { bookingId: booking.id, obligations };
    if (dealId) body.dealId = dealId;
    return body;
  }

  async function createPlan(token, body, key) {
    const req = request(app).post('/payment-plans').set('Authorization', `Bearer ${token}`).send(body);
    if (key) req.set('Idempotency-Key', key);
    return req;
  }

  function webhookBody(obligationId, overrides = {}) {
    return {
      eventId: uid('evt'),
      obligationId,
      amount: 50000,
      outcome: 'SUCCESS',
      gatewayReference: uid('gw'),
      ...overrides,
    };
  }

  async function webhook(body) {
    return request(app).post('/webhooks/payment-gateway').send(body);
  }

  // -------------------------------------------------------------------------
  describe('Plan generation', () => {
    test('creates plan + obligations for a booking deal; second deal unaffected', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'plan');
      const res = await createPlan(token, planBody(fx.booking));
      expect(res.status).toBe(201);
      expect(res.body.plan.dealId).toBe(fx.deal.id);
      expect(res.body.plan.organizationId).toBe(orgA.id);
      expect(res.body.obligations.length).toBe(2);
      expect(res.body.obligations.every((o) => o.status === 'PENDING')).toBe(true);
      // Retry without key but same deal → 409, no duplicate plan.
      const dup = await createPlan(token, planBody(fx.booking));
      expect(dup.status).toBe(409);
      expect(await prisma.paymentPlan.count({ where: { organizationId: orgA.id } })).toBe(1);
    });

    test('booking state untouched by plan generation', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'untouched');
      await createPlan(token, planBody(fx.booking));
      const booking = await prisma.booking.findFirst({ where: { id: fx.booking.id } });
      expect(booking).not.toBeNull();
      expect(await prisma.unit.findFirst({ where: { id: fx.unit.id } })).toMatchObject({ availabilityStatus: 'BOOKED' });
      expect((await prisma.reservation.findFirst({ where: { id: fx.reservation.id } })).status).toBe('CONVERTED');
      const deal = await prisma.deal.findFirst({ where: { id: fx.deal.id } });
      expect(deal.stage).toBe('NEW');
    });

    test('missing booking → 404; deal mismatch → 400; bad amounts rejected', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'badplan');
      const fx2 = await fixtures(token, 'badplan2');
      expect((await createPlan(token, { bookingId: '00000000-0000-4000-8000-000000000000', obligations: [{ dueAmount: 1, dueDate: isoFuture(1) }] })).status).toBe(404);
      expect((await createPlan(token, planBody(fx.booking, fx2.deal.id))).status).toBe(400);
      expect((await createPlan(token, { bookingId: fx.booking.id, obligations: [{ dueAmount: -5, dueDate: isoFuture(1) }] })).status).toBe(400);
      expect((await createPlan(token, { bookingId: fx.booking.id, obligations: [] })).status).toBe(400);
      expect(await prisma.paymentPlan.count({ where: { organizationId: orgA.id } })).toBe(0);
    });

    test('reads: plan with obligations, obligation with records, record, list', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'reads');
      const planId = (await createPlan(token, planBody(fx.booking))).body.plan.id;
      const one = await request(app).get(`/payment-plans/${planId}`).set('Authorization', `Bearer ${token}`);
      expect(one.status).toBe(200);
      expect(one.body.obligations.length).toBe(2);
      const obId = one.body.obligations[0].id;
      const ob = await request(app).get(`/payment-obligations/${obId}`).set('Authorization', `Bearer ${token}`);
      expect(ob.status).toBe(200);
      expect(ob.body.status).toBe('PENDING');
      const list = await request(app).get(`/payment-plans?dealId=${fx.deal.id}&limit=10`).set('Authorization', `Bearer ${token}`);
      expect(list.status).toBe(200);
      expect(list.body.length).toBe(1);
    });

    test('OVERDUE derived at read, never stored', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'overdue');
      const planId = (await createPlan(token, planBody(fx.booking))).body.plan.id;
      const obId = (await prisma.paymentObligation.findFirst({ where: { paymentPlanId: planId } })).id;
      await prisma.paymentObligation.update({ where: { id: obId }, data: { dueDate: new Date(Date.now() - HOUR) } });
      const stored = await prisma.paymentObligation.findFirst({ where: { id: obId } });
      expect(stored.status).toBe('PENDING');
      const read = await request(app).get(`/payment-obligations/${obId}`).set('Authorization', `Bearer ${token}`);
      expect(read.body.status).toBe('OVERDUE');
    });
  });

  // -------------------------------------------------------------------------
  describe('Webhook processing', () => {
    test('SUCCESS creates record and flips obligation PAID atomically', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'whok');
      const obId = (await createPlan(token, planBody(fx.booking, null, 1))).body.obligations[0].id;
      const res = await webhook(webhookBody(obId));
      expect(res.status).toBe(201);
      expect(res.body.record.status).toBe('SUCCESS');
      expect(res.body.record.obligationId).toBe(obId);
      expect(res.body.obligation.status).toBe('PAID');
      expect((await prisma.paymentObligation.findFirst({ where: { id: obId } })).status).toBe('PAID');
    });

    test('FAILED and PENDING records stay visible; obligation unpaid', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'wfail');
      const obs = (await createPlan(token, planBody(fx.booking))).body.obligations;
      const failed = await webhook(webhookBody(obs[0].id, { outcome: 'FAILED' }));
      expect(failed.status).toBe(201);
      expect(failed.body.record.status).toBe('FAILED');
      expect(failed.body.obligation.status).toBe('PENDING');
      const pending = await webhook(webhookBody(obs[1].id, { outcome: 'PENDING' }));
      expect(pending.body.record.status).toBe('PENDING');
      expect(pending.body.obligation.status).toBe('PENDING');
      expect(await prisma.paymentRecord.count({ where: { organizationId: orgA.id } })).toBe(2);
    });

    test('malformed payload, bad amount, unknown obligation rejected with no mutation', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'wbad');
      const obId = (await createPlan(token, planBody(fx.booking, null, 1))).body.obligations[0].id;
      expect((await webhook({ eventId: uid('e'), obligationId: obId, amount: -1, outcome: 'SUCCESS' })).status).toBe(400);
      expect((await webhook({ eventId: uid('e'), obligationId: 'not-a-uuid', amount: 1, outcome: 'SUCCESS' })).status).toBe(400);
      expect((await webhook({ eventId: uid('e'), obligationId: '00000000-0000-4000-8000-000000000000', amount: 1, outcome: 'SUCCESS' })).status).toBe(404);
      expect((await webhook({ eventId: uid('e'), obligationId: obId, amount: 1, outcome: 'REFUNDED' })).status).toBe(400);
      expect(await prisma.paymentRecord.count({ where: { organizationId: orgA.id } })).toBe(0);
      expect((await prisma.paymentObligation.findFirst({ where: { id: obId } })).status).toBe('PENDING');
    });

    test('second SUCCESS on PAID obligation → 409, no duplicate SUCCESS', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'wpaid');
      const obId = (await createPlan(token, planBody(fx.booking, null, 1))).body.obligations[0].id;
      expect((await webhook(webhookBody(obId))).status).toBe(201);
      const again = await webhook(webhookBody(obId));
      expect(again.status).toBe(409);
      expect(await prisma.paymentRecord.count({ where: { obligationId: obId, status: 'SUCCESS' } })).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('Webhook idempotency + concurrency', () => {
    test('same eventId + same payload replays; different payload → 409', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'widem');
      const obId = (await createPlan(token, planBody(fx.booking, null, 1))).body.obligations[0].id;
      const body = webhookBody(obId, { eventId: uid('evt') });
      const first = await webhook(body);
      expect(first.status).toBe(201);
      const replay = await webhook(body);
      expect(replay.status).toBe(200);
      expect(replay.body.record.id).toBe(first.body.record.id);
      const clash = await webhook({ ...body, amount: body.amount + 1 });
      expect(clash.status).toBe(409);
      expect(await prisma.paymentRecord.count({ where: { obligationId: obId } })).toBe(1);
    });

    test('concurrent duplicate deliveries → one SUCCESS, one replay', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'wrace');
      const obId = (await createPlan(token, planBody(fx.booking, null, 1))).body.obligations[0].id;
      const body = webhookBody(obId, { eventId: uid('evt') });
      const [a, b] = await Promise.all([webhook(body), webhook(body)]);
      expect([a.status, b.status].sort()).toEqual([200, 201]);
      expect(await prisma.paymentRecord.count({ where: { obligationId: obId, status: 'SUCCESS' } })).toBe(1);
      expect((await prisma.paymentObligation.findFirst({ where: { id: obId } })).status).toBe('PAID');
    });

    test('plan retry with same key replays; different payload → 409', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'planidem');
      const key = uid('plankey');
      const body = planBody(fx.booking);
      const first = await createPlan(token, body, key);
      expect(first.status).toBe(201);
      const replay = await createPlan(token, body, key);
      expect(replay.status).toBe(200);
      expect(replay.body.plan.id).toBe(first.body.plan.id);
      const fx2 = await fixtures(token, 'planidem2');
      const clash = await createPlan(token, planBody(fx2.booking), key);
      expect(clash.status).toBe(409);
      expect(await prisma.paymentPlan.count({ where: { organizationId: orgA.id } })).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('Corrections', () => {
    test('correction preserves original and points at it', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'corr');
      const obId = (await createPlan(token, planBody(fx.booking, null, 1))).body.obligations[0].id;
      const original = (await webhook(webhookBody(obId, { outcome: 'FAILED' }))).body.record;
      const correction = await webhook(webhookBody(obId, { outcome: 'SUCCESS', correctsRecordId: original.id }));
      expect(correction.status).toBe(201);
      expect(correction.body.record.correctsRecordId).toBe(original.id);
      expect((await prisma.paymentRecord.findFirst({ where: { id: original.id } })).status).toBe('FAILED');
      expect((await prisma.paymentObligation.findFirst({ where: { id: obId } })).status).toBe('PAID');
    });

    test('correction of missing or foreign record rejected', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'corr bad');
      const fx2 = await fixtures(token, 'corrbad2');
      const obId = (await createPlan(token, planBody(fx.booking, null, 1))).body.obligations[0].id;
      const otherObId = (await createPlan(token, planBody(fx2.booking, null, 1))).body.obligations[0].id;
      const foreign = (await webhook(webhookBody(otherObId, { outcome: 'FAILED' }))).body.record;
      expect((await webhook(webhookBody(obId, { correctsRecordId: '00000000-0000-4000-8000-000000000000' }))).status).toBe(404);
      expect((await webhook(webhookBody(obId, { correctsRecordId: foreign.id }))).status).toBe(400);
      expect(await prisma.paymentRecord.count({ where: { obligationId: obId } })).toBe(0);
    });

    test('no generic PATCH/DELETE on payment rows', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'noescape');
      const planId = (await createPlan(token, planBody(fx.booking, null, 1))).body.plan.id;
      for (const method of ['patch', 'put', 'delete']) {
        expect((await request(app)[method](`/payment-plans/${planId}`).set('Authorization', `Bearer ${token}`).send({})).status).toBe(404);
      }
      const obId = (await prisma.paymentObligation.findFirst({ where: { paymentPlanId: planId } })).id;
      expect((await request(app).patch(`/payment-obligations/${obId}`).set('Authorization', `Bearer ${token}`).send({ status: 'PAID' })).status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('Authorization + tenant isolation', () => {
    test('unauthenticated → 401, unauthorized → 403 on plan endpoints', async () => {
      const admin = await login(userAdminA.email, plainAdminA, orgA.id);
      const agent = await login(userAgentA.email, plainAgentA, orgA.id);
      const fx = await fixtures(admin, 'authz');
      expect((await createPlan('', planBody(fx.booking))).status).toBe(401);
      expect((await createPlan(agent, planBody(fx.booking))).status).toBe(403);
      // Agent has paymentPlan:read — reads allowed.
      const planId = (await createPlan(admin, planBody(fx.booking))).body.plan.id;
      expect((await request(app).get(`/payment-plans/${planId}`).set('Authorization', `Bearer ${agent}`)).status).toBe(200);
    });

    test('cross-tenant plans/obligations/records hidden; cross-tenant deal rejected', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const fxA = await fixtures(tokenA, 'xtenant');
      const planId = (await createPlan(tokenA, planBody(fxA.booking))).body.plan.id;
      const obId = (await prisma.paymentObligation.findFirst({ where: { paymentPlanId: planId } })).id;
      expect((await request(app).get(`/payment-plans/${planId}`).set('Authorization', `Bearer ${tokenB}`)).status).toBe(404);
      expect((await request(app).get(`/payment-obligations/${obId}`).set('Authorization', `Bearer ${tokenB}`)).status).toBe(404);
      const listB = await request(app).get('/payment-plans').set('Authorization', `Bearer ${tokenB}`);
      expect(listB.status).toBe(200);
      expect(listB.body).toEqual([]);
      // Webhook for B's obligation derives B's tenant — A's records untouched.
      const fxB = await fixtures(tokenB, 'xtenantB');
      const obB = (await createPlan(tokenB, planBody(fxB.booking, null, 1))).body.obligations[0].id;
      const res = await webhook(webhookBody(obB));
      expect(res.status).toBe(201);
      expect(res.body.record.organizationId).toBe(orgB.id);
      expect(await prisma.paymentRecord.count({ where: { organizationId: orgA.id } })).toBe(0);
    });
  });
});
