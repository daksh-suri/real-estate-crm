const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/lib/prisma');
const { hashPassword } = require('../src/lib/bcrypt');
const { expireDueReservations } = require('../src/modules/reservations/service');

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

let phoneCtr = 9400000000;
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

describe('Checkpoint 10 — Reservation & Unit Hold', () => {
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
    ['reservation', 'release'],
  ];
  const AGENT_PERMS = [['reservation', 'read']];

  async function wipeAll() {
    await prisma.refreshToken.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.idempotencyKey.deleteMany({});
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

  async function makeUnit(token, projectId, identifier, extra = {}) {
    const res = await request(app)
      .post(`/projects/${projectId}/units`)
      .set('Authorization', `Bearer ${token}`)
      .send({ identifier: identifier || uid('U'), ...extra });
    expect(res.status).toBe(201);
    return res.body;
  }

  async function makeLead(token, overrides = {}) {
    const res = await request(app)
      .post('/enquiries')
      .set('Authorization', `Bearer ${token}`)
      .send({ channel: 'WALK_IN', ...identity('rsv'), ...overrides });
    expect(res.status).toBe(201);
    expect(res.body.lead.status).toBe('OPEN');
    return res.body.lead;
  }

  async function makeDeal(token, leadId, extra = {}) {
    const res = await request(app)
      .post('/deals')
      .set('Authorization', `Bearer ${token}`)
      .send({ leadId, ...extra });
    expect(res.status).toBe(201);
    return res.body;
  }

  // Fresh project + unit + lead + deal. One bundle per test keeps the
  // Unit-row contention surface to exactly the unit under test.
  async function fixtures(token, tag) {
    const project = await makeProject(token, uid(`Proj-${tag}`));
    const unit = await makeUnit(token, project.id, uid(`U-${tag}`));
    const lead = await makeLead(token);
    const deal = await makeDeal(token, lead.id);
    return { project, unit, lead, deal };
  }

  function reserveBody(fx, type = 'RESERVATION', extra = {}) {
    return { unitId: fx.unit.id, dealId: fx.deal.id, type, ...extra };
  }

  async function reserve(token, body, key) {
    const req = request(app).post('/reservations').set('Authorization', `Bearer ${token}`).send(body);
    if (key) req.set('Idempotency-Key', key);
    return req;
  }

  async function unitStatus(unitId) {
    const u = await prisma.unit.findFirst({ where: { id: unitId } });
    return u.availabilityStatus;
  }

  // -------------------------------------------------------------------------
  describe('Creation + model behavior', () => {
    test('RESERVATION creates ACTIVE record, unit AVAILABLE → RESERVED', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'create');
      const res = await reserve(token, reserveBody(fx));
      expect(res.status).toBe(201);
      expect(res.body.reservation.status).toBe('ACTIVE');
      expect(res.body.reservation.type).toBe('RESERVATION');
      expect(res.body.reservation.unitId).toBe(fx.unit.id);
      expect(res.body.reservation.dealId).toBe(fx.deal.id);
      expect(res.body.reservation.organizationId).toBe(orgA.id);
      expect(await unitStatus(fx.unit.id)).toBe('RESERVED');
    });

    test('HOLD creates ACTIVE record, unit AVAILABLE → ON_HOLD', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'hold');
      const res = await reserve(token, reserveBody(fx, 'HOLD'));
      expect(res.status).toBe(201);
      expect(res.body.reservation.type).toBe('HOLD');
      expect(res.body.reservation.status).toBe('ACTIVE');
      expect(await unitStatus(fx.unit.id)).toBe('ON_HOLD');
    });

    test('null/absent expiresAt allowed; binds unit-less deal to the unit', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'noexp');
      expect(fx.deal.unitId).toBeNull();
      const res = await reserve(token, reserveBody(fx, 'HOLD'));
      expect(res.status).toBe(201);
      expect(res.body.reservation.expiresAt).toBeNull();
      const deal = await prisma.deal.findFirst({ where: { id: fx.deal.id } });
      expect(deal.unitId).toBe(fx.unit.id);
    });

    test('missing/invalid ids, bad type, past expiresAt rejected; unit untouched', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'bad');
      const bad = [
        { ...reserveBody(fx), unitId: 'not-a-uuid' },
        { ...reserveBody(fx), dealId: '00000000-0000-4000-8000-000000000000' },
        { ...reserveBody(fx), type: 'BOOKING' },
        { ...reserveBody(fx), expiresAt: new Date(Date.now() - HOUR).toISOString() },
        { unitId: fx.unit.id, type: 'RESERVATION' },
      ];
      for (const body of bad) {
        const res = await reserve(token, body);
        expect([400, 404]).toContain(res.status);
      }
      expect(await unitStatus(fx.unit.id)).toBe('AVAILABLE');
      expect(await prisma.reservation.count({ where: { organizationId: orgA.id } })).toBe(0);
    });

    test('reads: get one, list with filters, paginate', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'reads');
      const created = (await reserve(token, reserveBody(fx))).body.reservation;
      const one = await request(app).get(`/reservations/${created.id}`).set('Authorization', `Bearer ${token}`);
      expect(one.status).toBe(200);
      expect(one.body.id).toBe(created.id);
      const list = await request(app).get('/reservations?status=ACTIVE&type=RESERVATION&limit=1&offset=0').set('Authorization', `Bearer ${token}`);
      expect(list.status).toBe(200);
      expect(list.body.length).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('Authorization matrix', () => {
    test('unauthenticated → 401, unauthorized → 403, authorized → 201', async () => {
      const admin = await login(userAdminA.email, plainAdminA, orgA.id);
      const agent = await login(userAgentA.email, plainAgentA, orgA.id);
      const fx = await fixtures(admin, 'authz');
      const anon = await reserve('', reserveBody(fx));
      expect(anon.status).toBe(401);
      const denied = await reserve(agent, reserveBody(fx));
      expect(denied.status).toBe(403);
      const ok = await reserve(admin, reserveBody(fx));
      expect(ok.status).toBe(201);
      // Release needs its own permission: agent reads but cannot release.
      const rel = await request(app).post(`/reservations/${ok.body.reservation.id}/release`).set('Authorization', `Bearer ${agent}`);
      expect(rel.status).toBe(403);
    });

    test('cross-tenant reads hide as 404; cross-tenant refs rejected', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const fxA = await fixtures(tokenA, 'xtenant');
      const fxB = await fixtures(tokenB, 'xtenantB');
      const created = (await reserve(tokenA, reserveBody(fxA))).body.reservation;
      const hidden = await request(app).get(`/reservations/${created.id}`).set('Authorization', `Bearer ${tokenB}`);
      expect(hidden.status).toBe(404);
      // Cross-tenant unit / deal on write.
      const cu = await reserve(tokenA, { unitId: fxB.unit.id, dealId: fxA.deal.id, type: 'RESERVATION' });
      expect([403, 404]).toContain(cu.status);
      const cd = await reserve(tokenA, { unitId: fxA.unit.id, dealId: fxB.deal.id, type: 'RESERVATION' });
      expect([400, 403, 404]).toContain(cd.status);
      expect(await unitStatus(fxA.unit.id)).toBe('RESERVED');
      expect(await unitStatus(fxB.unit.id)).toBe('AVAILABLE');
    });
  });

  // -------------------------------------------------------------------------
  describe('Reservation lifecycle', () => {
    test('second reservation on RESERVED unit → 409; single ACTIVE row', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'dbl');
      const fx2 = await fixtures(token, 'dbl2');
      // fx2 reuses fx's unit with its own deal.
      const first = await reserve(token, reserveBody(fx));
      expect(first.status).toBe(201);
      const second = await reserve(token, { unitId: fx.unit.id, dealId: fx2.deal.id, type: 'RESERVATION' });
      expect(second.status).toBe(409);
      expect(await prisma.reservation.count({ where: { organizationId: orgA.id } })).toBe(1);
      expect(await unitStatus(fx.unit.id)).toBe('RESERVED');
    });

    test('release returns unit to AVAILABLE, preserves RELEASED row; no reopen', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'rel');
      const created = (await reserve(token, reserveBody(fx))).body.reservation;
      const rel = await request(app).post(`/reservations/${created.id}/release`).set('Authorization', `Bearer ${token}`);
      expect(rel.status).toBe(200);
      expect(rel.body.status).toBe('RELEASED');
      expect(await unitStatus(fx.unit.id)).toBe('AVAILABLE');
      const kept = await prisma.reservation.findFirst({ where: { id: created.id } });
      expect(kept.status).toBe('RELEASED');
      const again = await request(app).post(`/reservations/${created.id}/release`).set('Authorization', `Bearer ${token}`);
      expect(again.status).toBe(400);
      expect(await unitStatus(fx.unit.id)).toBe('AVAILABLE');
    });

    test('released unit can be reserved again by a new deal', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'reuse');
      const fx2 = await fixtures(token, 'reuse2');
      const first = (await reserve(token, reserveBody(fx))).body.reservation;
      await request(app).post(`/reservations/${first.id}/release`).set('Authorization', `Bearer ${token}`);
      const second = await reserve(token, { unitId: fx.unit.id, dealId: fx2.deal.id, type: 'RESERVATION' });
      expect(second.status).toBe(201);
      expect(await unitStatus(fx.unit.id)).toBe('RESERVED');
    });
  });

  // -------------------------------------------------------------------------
  describe('Hold lifecycle', () => {
    test('active hold blocks reservation and vice versa', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'block1');
      const fx2 = await fixtures(token, 'block2');
      expect((await reserve(token, reserveBody(fx, 'HOLD'))).status).toBe(201);
      const blockedRes = await reserve(token, { unitId: fx.unit.id, dealId: fx2.deal.id, type: 'RESERVATION' });
      expect(blockedRes.status).toBe(409);

      const fx3 = await fixtures(token, 'block3');
      expect((await reserve(token, reserveBody(fx3, 'RESERVATION'))).status).toBe(201);
      const fx4 = await fixtures(token, 'block4');
      const blockedHold = await reserve(token, { unitId: fx3.unit.id, dealId: fx4.deal.id, type: 'HOLD' });
      expect(blockedHold.status).toBe(409);
    });

    test('hold release returns unit to AVAILABLE', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'holdrel');
      const created = (await reserve(token, reserveBody(fx, 'HOLD'))).body.reservation;
      const rel = await request(app).post(`/reservations/${created.id}/release`).set('Authorization', `Bearer ${token}`);
      expect(rel.status).toBe(200);
      expect(await unitStatus(fx.unit.id)).toBe('AVAILABLE');
    });

    test('hold without expiry stays ACTIVE across sweeps', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'noexpsweep');
      const created = (await reserve(token, reserveBody(fx, 'HOLD'))).body.reservation;
      const out = await expireDueReservations({ rawPrisma: prisma });
      expect(out.checked).toBe(0);
      const row = await prisma.reservation.findFirst({ where: { id: created.id } });
      expect(row.status).toBe('ACTIVE');
      expect(await unitStatus(fx.unit.id)).toBe('ON_HOLD');
    });
  });

  // -------------------------------------------------------------------------
  describe('Expiry', () => {
    async function makeExpiring(token, tag, type) {
      const fx = await fixtures(token, tag);
      const created = (await reserve(token, { ...reserveBody(fx, type), expiresAt: isoFuture(2) })).body.reservation;
      // Age the row past due without touching lifecycle (API rejects past).
      await prisma.reservation.update({ where: { id: created.id }, data: { expiresAt: new Date(Date.now() - HOUR) } });
      return { fx, created };
    }

    test('expired RESERVATION → EXPIRED, unit RESERVED → AVAILABLE', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const { fx, created } = await makeExpiring(token, 'expr', 'RESERVATION');
      const out = await expireDueReservations({ rawPrisma: prisma });
      expect(out).toEqual({ checked: 1, expired: 1 });
      expect((await prisma.reservation.findFirst({ where: { id: created.id } })).status).toBe('EXPIRED');
      expect(await unitStatus(fx.unit.id)).toBe('AVAILABLE');
    });

    test('expired HOLD → EXPIRED, unit ON_HOLD → AVAILABLE', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const { fx, created } = await makeExpiring(token, 'exphold', 'HOLD');
      await expireDueReservations({ rawPrisma: prisma });
      expect((await prisma.reservation.findFirst({ where: { id: created.id } })).status).toBe('EXPIRED');
      expect(await unitStatus(fx.unit.id)).toBe('AVAILABLE');
    });

    test('released / already-expired rows untouched; repeat sweep no-op', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const { fx, created } = await makeExpiring(token, 'expdone', 'RESERVATION');
      await request(app).post(`/reservations/${created.id}/release`).set('Authorization', `Bearer ${token}`);
      const out = await expireDueReservations({ rawPrisma: prisma });
      expect(out.checked).toBe(0);
      expect((await prisma.reservation.findFirst({ where: { id: created.id } })).status).toBe('RELEASED');

      const second = await makeExpiring(token, 'expdone2', 'HOLD');
      await expireDueReservations({ rawPrisma: prisma });
      const repeat = await expireDueReservations({ rawPrisma: prisma });
      expect(repeat).toEqual({ checked: 0, expired: 0 });
      expect((await prisma.reservation.findFirst({ where: { id: second.created.id } })).status).toBe('EXPIRED');
      expect(await unitStatus(fx.unit.id)).toBe('AVAILABLE');
    });

    test('expired reservation cannot be released as active', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const { created } = await makeExpiring(token, 'exprel', 'RESERVATION');
      await expireDueReservations({ rawPrisma: prisma });
      const rel = await request(app).post(`/reservations/${created.id}/release`).set('Authorization', `Bearer ${token}`);
      expect(rel.status).toBe(400);
    });

    test('stale expiry never releases a legitimately reused unit', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const { fx, created } = await makeExpiring(token, 'stale', 'RESERVATION');
      await expireDueReservations({ rawPrisma: prisma });
      const fx2 = await fixtures(token, 'stale2');
      const next = await reserve(token, { unitId: fx.unit.id, dealId: fx2.deal.id, type: 'RESERVATION' });
      expect(next.status).toBe(201);
      const repeat = await expireDueReservations({ rawPrisma: prisma });
      expect(repeat).toEqual({ checked: 0, expired: 0 });
      expect((await prisma.reservation.findFirst({ where: { id: next.body.reservation.id } })).status).toBe('ACTIVE');
      expect(await unitStatus(fx.unit.id)).toBe('RESERVED');
      expect(created.id).not.toBe(next.body.reservation.id);
    });
  });

  // -------------------------------------------------------------------------
  describe('Concurrency races', () => {
    test('two simultaneous RESERVATIONs → exactly one wins', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'raceR');
      const fx2 = await fixtures(token, 'raceR2');
      const mk = (dealId) => reserve(token, { unitId: fx.unit.id, dealId, type: 'RESERVATION' });
      const [a, b] = await Promise.all([mk(fx.deal.id), mk(fx2.deal.id)]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect(await prisma.reservation.count({ where: { organizationId: orgA.id } })).toBe(1);
      expect(await unitStatus(fx.unit.id)).toBe('RESERVED');
    });

    test('two simultaneous HOLDs → exactly one wins', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'raceH');
      const fx2 = await fixtures(token, 'raceH2');
      const mk = (dealId) => reserve(token, { unitId: fx.unit.id, dealId, type: 'HOLD' });
      const [a, b] = await Promise.all([mk(fx.deal.id), mk(fx2.deal.id)]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect(await prisma.reservation.count({ where: { organizationId: orgA.id } })).toBe(1);
      expect(await unitStatus(fx.unit.id)).toBe('ON_HOLD');
    });

    test('RESERVATION vs HOLD race → exactly one wins', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'raceRH');
      const fx2 = await fixtures(token, 'raceRH2');
      const [a, b] = await Promise.all([
        reserve(token, { unitId: fx.unit.id, dealId: fx.deal.id, type: 'RESERVATION' }),
        reserve(token, { unitId: fx.unit.id, dealId: fx2.deal.id, type: 'HOLD' }),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect(await prisma.reservation.count({ where: { organizationId: orgA.id } })).toBe(1);
    });

    test('release/expiry race does not corrupt state', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'raceRE');
      const created = (await reserve(token, { ...reserveBody(fx), expiresAt: isoFuture(2) })).body.reservation;
      await prisma.reservation.update({ where: { id: created.id }, data: { expiresAt: new Date(Date.now() - HOUR) } });
      const [rel, sweep] = await Promise.all([
        request(app).post(`/reservations/${created.id}/release`).set('Authorization', `Bearer ${token}`),
        expireDueReservations({ rawPrisma: prisma }),
      ]);
      const row = await prisma.reservation.findFirst({ where: { id: created.id } });
      // Exactly one path owns the transition; either terminal is consistent
      // with an AVAILABLE unit and no duplicate rows.
      expect(['RELEASED', 'EXPIRED']).toContain(row.status);
      expect(await unitStatus(fx.unit.id)).toBe('AVAILABLE');
      expect(rel.status === 200 || sweep.expired === 1).toBe(true);
    });

    test('failed reservation rolls back cleanly, unit stays AVAILABLE', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'rollback');
      const fx2 = await fixtures(token, 'rollback2');
      expect((await reserve(token, reserveBody(fx))).status).toBe(201);
      const clash = await reserve(token, { unitId: fx.unit.id, dealId: fx2.deal.id, type: 'RESERVATION' });
      expect(clash.status).toBe(409);
      expect(await prisma.reservation.count({ where: { organizationId: orgA.id } })).toBe(1);
      expect(await unitStatus(fx.unit.id)).toBe('RESERVED');
      expect(await unitStatus(fx2.unit.id)).toBe('AVAILABLE');
    });
  });

  // -------------------------------------------------------------------------
  describe('Idempotency', () => {
    test('same key + same payload replays without duplicating', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'idem');
      const key = uid('rsvkey');
      const first = await reserve(token, reserveBody(fx), key);
      expect(first.status).toBe(201);
      const replay = await reserve(token, reserveBody(fx), key);
      expect(replay.status).toBe(200);
      expect(replay.body.reservation.id).toBe(first.body.reservation.id);
      expect(await prisma.reservation.count({ where: { organizationId: orgA.id } })).toBe(1);
      expect(await unitStatus(fx.unit.id)).toBe('RESERVED');
    });

    test('same key + different payload → 409', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'idem409');
      const key = uid('rsvkey');
      expect((await reserve(token, reserveBody(fx), key)).status).toBe(201);
      const clash = await reserve(token, reserveBody(fx, 'HOLD'), key);
      expect(clash.status).toBe(409);
      expect(await prisma.reservation.count({ where: { organizationId: orgA.id } })).toBe(1);
    });

    test('concurrent same-key requests produce one logical effect', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'idemrace');
      const key = uid('rsvkey');
      const body = reserveBody(fx);
      const [a, b] = await Promise.all([reserve(token, body, key), reserve(token, body, key)]);
      expect([a.status, b.status].sort()).toEqual([200, 201]);
      expect(await prisma.reservation.count({ where: { organizationId: orgA.id } })).toBe(1);
    });

    test('RESERVATION and HOLD keys live in separate operation namespaces', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'idemns');
      const fx2 = await fixtures(token, 'idemns2');
      const key = uid('rsvkey');
      // Same key string, different type → different operationType → the HOLD
      // hits the Unit conflict (not an idempotency collision).
      expect((await reserve(token, reserveBody(fx), key)).status).toBe(201);
      const clash = await reserve(token, { unitId: fx.unit.id, dealId: fx2.deal.id, type: 'HOLD' }, key);
      expect(clash.status).toBe(409);
    });
  });

  // -------------------------------------------------------------------------
  describe('Integrity', () => {
    test('deal already bound to another unit rejected', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'mismatch');
      const fx2 = await fixtures(token, 'mismatch2');
      expect((await reserve(token, reserveBody(fx))).status).toBe(201);
      const clash = await reserve(token, { unitId: fx2.unit.id, dealId: fx.deal.id, type: 'RESERVATION' });
      expect(clash.status).toBe(400);
      expect(await unitStatus(fx2.unit.id)).toBe('AVAILABLE');
    });

    test('soft-deleted unit/deal rejected', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'softdel');
      await prisma.unit.update({ where: { id: fx.unit.id }, data: { deletedAt: new Date() } });
      const cu = await reserve(token, reserveBody(fx));
      expect([400, 404]).toContain(cu.status);

      const fx2 = await fixtures(token, 'softdel2');
      await prisma.deal.update({ where: { id: fx2.deal.id }, data: { deletedAt: new Date() } });
      const cd = await reserve(token, reserveBody(fx2));
      expect([400, 404]).toContain(cd.status);
    });

    test('BLOCKED and BOOKED units cannot be reserved or held', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'blocked');
      await prisma.unit.update({ where: { id: fx.unit.id }, data: { availabilityStatus: 'BLOCKED' } });
      expect((await reserve(token, reserveBody(fx))).status).toBe(409);
      expect((await reserve(token, reserveBody(fx, 'HOLD'))).status).toBe(409);

      await prisma.unit.update({ where: { id: fx.unit.id }, data: { availabilityStatus: 'BOOKED' } });
      expect((await reserve(token, reserveBody(fx))).status).toBe(409);
      expect(await prisma.reservation.count({ where: { organizationId: orgA.id } })).toBe(0);
    });

    test('no generic PATCH / availability escape hatch', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'noescape');
      const created = (await reserve(token, reserveBody(fx))).body.reservation;
      for (const method of ['patch', 'put']) {
        const res = await request(app)[method](`/reservations/${created.id}`).set('Authorization', `Bearer ${token}`).send({ status: 'ACTIVE' });
        expect(res.status).toBe(404);
      }
      const unitPatch = await request(app).patch(`/units/${fx.unit.id}`).set('Authorization', `Bearer ${token}`).send({ availabilityStatus: 'AVAILABLE' });
      expect(unitPatch.status).not.toBe(200);
      expect(await unitStatus(fx.unit.id)).toBe('RESERVED');
    });

    test('tenant wrapper scopes reservation queries', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const fxA = await fixtures(tokenA, 'scope');
      await reserve(tokenA, reserveBody(fxA));
      const listB = await request(app).get('/reservations').set('Authorization', `Bearer ${tokenB}`);
      expect(listB.status).toBe(200);
      expect(listB.body).toEqual([]);
    });
  });
});
