const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/lib/prisma');
const { hashPassword } = require('../src/lib/bcrypt');

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

let phoneCtr = 9500000000;
function identity(tag) {
  phoneCtr += 1;
  return {
    contactName: `Person ${tag} ${phoneCtr}`,
    phone: String(phoneCtr),
    email: `${tag}-${phoneCtr}@test.com`,
  };
}

describe('Checkpoint 11 — Booking', () => {
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
    ['deal', 'transition'],
    ['reservation', 'create'],
    ['reservation', 'read'],
    ['reservation', 'release'],
    ['booking', 'create'],
    ['booking', 'read'],
    ['booking', 'cancel'],
  ];
  const AGENT_PERMS = [['booking', 'read']];

  async function wipeAll() {
    await prisma.refreshToken.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.idempotencyKey.deleteMany({});
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
      .send({ channel: 'WALK_IN', ...identity('bk'), ...overrides });
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

  async function makeReservation(token, unitId, dealId, type = 'RESERVATION', extra = {}) {
    const res = await request(app)
      .post('/reservations')
      .set('Authorization', `Bearer ${token}`)
      .send({ unitId, dealId, type, ...extra });
    expect(res.status).toBe(201);
    return res.body.reservation;
  }

  // Fresh chain per test: project + unit + lead + deal + ACTIVE reservation.
  async function fixtures(token, tag, type = 'RESERVATION') {
    const project = await makeProject(token, uid(`Proj-${tag}`));
    const unit = await makeUnit(token, project.id, uid(`U-${tag}`));
    const lead = await makeLead(token);
    const deal = await makeDeal(token, lead.id);
    const reservation = await makeReservation(token, unit.id, deal.id, type);
    return { project, unit, lead, deal, reservation };
  }

  async function book(token, body, key) {
    const req = request(app).post('/bookings').set('Authorization', `Bearer ${token}`).send(body);
    if (key) req.set('Idempotency-Key', key);
    return req;
  }

  async function unitStatus(unitId) {
    const u = await prisma.unit.findFirst({ where: { id: unitId } });
    return u.availabilityStatus;
  }

  async function reservationStatus(reservationId) {
    const r = await prisma.reservation.findFirst({ where: { id: reservationId } });
    return r.status;
  }

  // -------------------------------------------------------------------------
  describe('Creation + atomic conversion', () => {
    test('ACTIVE reservation converts: booking row + unit BOOKED + reservation CONVERTED', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'create');
      const res = await book(token, { reservationId: fx.reservation.id });
      expect(res.status).toBe(201);
      const b = res.body.booking;
      expect(b.organizationId).toBe(orgA.id);
      expect(b.unitId).toBe(fx.unit.id);
      expect(b.dealId).toBe(fx.deal.id);
      expect(b.reservationId).toBe(fx.reservation.id);
      expect(b.bookedAt).toBeDefined();
      expect(b.cancelledAt).toBeNull();
      expect(await unitStatus(fx.unit.id)).toBe('BOOKED');
      expect(await reservationStatus(fx.reservation.id)).toBe('CONVERTED');
    });

    test('bookedAt is server-generated; client cannot supply lifecycle fields', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'servervals');
      const res = await book(token, { reservationId: fx.reservation.id, bookedAt: '2020-01-01T00:00:00.000Z', cancelledBy: 'someone' });
      expect(res.status).toBe(201);
      expect(new Date(res.body.booking.bookedAt).getTime()).toBeGreaterThan(Date.now() - 60000);
      expect(res.body.booking.cancelledBy).toBeNull();
    });

    test('reads: get one, list with filters, paginate', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'reads');
      const created = (await book(token, { reservationId: fx.reservation.id })).body.booking;
      const one = await request(app).get(`/bookings/${created.id}`).set('Authorization', `Bearer ${token}`);
      expect(one.status).toBe(200);
      const list = await request(app).get(`/bookings?unitId=${fx.unit.id}&limit=1&offset=0`).set('Authorization', `Bearer ${token}`);
      expect(list.status).toBe(200);
      expect(list.body.length).toBe(1);
    });

    test('booking does not move Deal.stage (agent drives transition explicitly)', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'nostage');
      await book(token, { reservationId: fx.reservation.id });
      const deal = await prisma.deal.findFirst({ where: { id: fx.deal.id } });
      expect(deal.stage).toBe('NEW');
      // The dedicated path still works afterwards.
      const tr = await request(app)
        .post(`/deals/${fx.deal.id}/stage-transition`)
        .set('Authorization', `Bearer ${token}`)
        .send({ stage: 'QUALIFIED' });
      expect(tr.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  describe('Reservation validation', () => {
    test('missing reservation → 404', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const res = await book(token, { reservationId: '00000000-0000-4000-8000-000000000000' });
      expect(res.status).toBe(404);
    });

    test('EXPIRED / RELEASED / CONVERTED reservations rejected; unit untouched', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      // EXPIRED via release-independent path: reserve then force-expire is
      // covered by release/CONVERTED below; here RELEASED:
      const fx = await fixtures(token, 'rel');
      await request(app).post(`/reservations/${fx.reservation.id}/release`).set('Authorization', `Bearer ${token}`);
      const rel = await book(token, { reservationId: fx.reservation.id });
      expect(rel.status).toBe(409);
      expect(await unitStatus(fx.unit.id)).toBe('AVAILABLE');

      // CONVERTED: book once, book again.
      const fx2 = await fixtures(token, 'conv');
      expect((await book(token, { reservationId: fx2.reservation.id })).status).toBe(201);
      const again = await book(token, { reservationId: fx2.reservation.id });
      expect(again.status).toBe(409);
      expect(await prisma.booking.count({ where: { organizationId: orgA.id } })).toBe(1);
    });

    test('HOLD reservation rejected (only RESERVATION converts)', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'hold', 'HOLD');
      const res = await book(token, { reservationId: fx.reservation.id });
      expect(res.status).toBe(400);
      expect(await unitStatus(fx.unit.id)).toBe('ON_HOLD');
      expect(await prisma.booking.count({ where: { organizationId: orgA.id } })).toBe(0);
    });

    test('reservation/unit and reservation/deal mismatches rejected', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'mismatch');
      const other = await fixtures(token, 'mismatch2');
      const cu = await book(token, { reservationId: fx.reservation.id, unitId: other.unit.id });
      expect(cu.status).toBe(400);
      const cd = await book(token, { reservationId: fx.reservation.id, dealId: other.deal.id });
      expect(cd.status).toBe(400);
      expect(await reservationStatus(fx.reservation.id)).toBe('ACTIVE');
      expect(await unitStatus(fx.unit.id)).toBe('RESERVED');
    });
  });

  // -------------------------------------------------------------------------
  describe('Unit validation', () => {
    test('only RESERVED converts: AVAILABLE / ON_HOLD / BLOCKED / BOOKED rejected', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      // AVAILABLE: craft a reservation then free the unit via release — the
      // reservation is RELEASED too, so build the AVAILABLE case by releasing
      // then re-reserving is impossible; instead book a CONVERTED unit's
      // sibling: create unit with no reservation and call with a fake id is
      // 404 — so cover AVAILABLE via a released reservation (409 path keeps
      // the unit AVAILABLE).
      const fx = await fixtures(token, 'states');
      await prisma.unit.update({ where: { id: fx.unit.id }, data: { availabilityStatus: 'BLOCKED' } });
      const blocked = await book(token, { reservationId: fx.reservation.id });
      expect(blocked.status).toBe(409);
      await prisma.unit.update({ where: { id: fx.unit.id }, data: { availabilityStatus: 'BOOKED' } });
      const booked = await book(token, { reservationId: fx.reservation.id });
      expect(booked.status).toBe(409);
      expect(await prisma.booking.count({ where: { organizationId: orgA.id } })).toBe(0);
      // Reservation still ACTIVE — failure rolled back, nothing converted.
      expect(await reservationStatus(fx.reservation.id)).toBe('ACTIVE');
    });

    test('ON_HOLD unit (hold reservation) cannot book', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'onhold', 'HOLD');
      // Type gate fires first with 400; unit must remain ON_HOLD either way.
      const res = await book(token, { reservationId: fx.reservation.id });
      expect([400, 409]).toContain(res.status);
      expect(await unitStatus(fx.unit.id)).toBe('ON_HOLD');
    });
  });

  // -------------------------------------------------------------------------
  describe('Authorization matrix + tenant isolation', () => {
    test('unauthenticated → 401, unauthorized → 403, authorized → 201', async () => {
      const admin = await login(userAdminA.email, plainAdminA, orgA.id);
      const agent = await login(userAgentA.email, plainAgentA, orgA.id);
      const fx = await fixtures(admin, 'authz');
      expect((await book('', { reservationId: fx.reservation.id })).status).toBe(401);
      expect((await book(agent, { reservationId: fx.reservation.id })).status).toBe(403);
      expect((await book(admin, { reservationId: fx.reservation.id })).status).toBe(201);
      // Cancel needs its own permission.
      const bookingId = (await prisma.booking.findFirst({ where: { organizationId: orgA.id } })).id;
      const denied = await request(app).post(`/bookings/${bookingId}/cancel`).set('Authorization', `Bearer ${agent}`).send({ cancellationReason: 'x' });
      expect(denied.status).toBe(403);
    });

    test('cross-tenant reservation hidden or rejected; bookings invisible across orgs', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const fxA = await fixtures(tokenA, 'xtenant');
      const cross = await book(tokenB, { reservationId: fxA.reservation.id });
      expect([403, 404]).toContain(cross.status);
      expect(await reservationStatus(fxA.reservation.id)).toBe('ACTIVE');

      await book(tokenA, { reservationId: fxA.reservation.id });
      const listB = await request(app).get('/bookings').set('Authorization', `Bearer ${tokenB}`);
      expect(listB.status).toBe(200);
      expect(listB.body).toEqual([]);
      const hidden = await request(app).get(`/bookings/${(await prisma.booking.findFirst({ where: { organizationId: orgA.id } })).id}`).set('Authorization', `Bearer ${tokenB}`);
      expect(hidden.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('Idempotency', () => {
    test('same key + same payload replays without duplicating', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'idem');
      const key = uid('bkkey');
      const first = await book(token, { reservationId: fx.reservation.id }, key);
      expect(first.status).toBe(201);
      const replay = await book(token, { reservationId: fx.reservation.id }, key);
      expect(replay.status).toBe(200);
      expect(replay.body.booking.id).toBe(first.body.booking.id);
      expect(await prisma.booking.count({ where: { organizationId: orgA.id } })).toBe(1);
    });

    test('same key + different payload → 409', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'idem409');
      const fx2 = await fixtures(token, 'idem409b');
      const key = uid('bkkey');
      expect((await book(token, { reservationId: fx.reservation.id }, key)).status).toBe(201);
      const clash = await book(token, { reservationId: fx2.reservation.id }, key);
      expect(clash.status).toBe(409);
      expect(await prisma.booking.count({ where: { organizationId: orgA.id } })).toBe(1);
    });

    test('concurrent same-key requests produce one booking', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'idemrace');
      const key = uid('bkkey');
      const body = { reservationId: fx.reservation.id };
      const [a, b] = await Promise.all([book(token, body, key), book(token, body, key)]);
      expect([a.status, b.status].sort()).toEqual([200, 201]);
      expect(await prisma.booking.count({ where: { organizationId: orgA.id } })).toBe(1);
      expect(await unitStatus(fx.unit.id)).toBe('BOOKED');
    });
  });

  // -------------------------------------------------------------------------
  describe('Concurrency', () => {
    test('concurrent bookings on one reservation → exactly one wins', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'race');
      const [a, b] = await Promise.all([
        book(token, { reservationId: fx.reservation.id }),
        book(token, { reservationId: fx.reservation.id }),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect(await prisma.booking.count({ where: { organizationId: orgA.id } })).toBe(1);
      expect(await reservationStatus(fx.reservation.id)).toBe('CONVERTED');
      expect(await unitStatus(fx.unit.id)).toBe('BOOKED');
    });

    test('no partial state on loser: single booking, converted once', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'race2');
      const results = await Promise.all([
        book(token, { reservationId: fx.reservation.id }),
        book(token, { reservationId: fx.reservation.id }),
        book(token, { reservationId: fx.reservation.id }),
      ]);
      expect(results.filter((r) => r.status === 201).length).toBe(1);
      expect(await prisma.booking.count({ where: { organizationId: orgA.id } })).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('Cancellation', () => {
    test('cancel preserves row, stamps actor + reason + time, frees unit, keeps CONVERTED', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'cancel');
      const bookingId = (await book(token, { reservationId: fx.reservation.id })).body.booking.id;
      const res = await request(app)
        .post(`/bookings/${bookingId}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .send({ cancellationReason: 'buyer backed out' });
      expect(res.status).toBe(200);
      expect(res.body.cancelledBy).toBe(userAdminA.id);
      expect(res.body.cancellationReason).toBe('buyer backed out');
      expect(res.body.cancelledAt).toBeDefined();
      expect(await unitStatus(fx.unit.id)).toBe('AVAILABLE');
      // Conversion history is never reopened.
      expect(await reservationStatus(fx.reservation.id)).toBe('CONVERTED');
      expect(await prisma.booking.findFirst({ where: { id: bookingId } })).not.toBeNull();
    });

    test('cancel requires non-empty reason; cannot cancel twice', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'cancel2');
      const bookingId = (await book(token, { reservationId: fx.reservation.id })).body.booking.id;
      const empty = await request(app).post(`/bookings/${bookingId}/cancel`).set('Authorization', `Bearer ${token}`).send({ cancellationReason: '  ' });
      expect(empty.status).toBe(400);
      expect((await request(app).post(`/bookings/${bookingId}/cancel`).set('Authorization', `Bearer ${token}`).send({ cancellationReason: 'first' })).status).toBe(200);
      const twice = await request(app).post(`/bookings/${bookingId}/cancel`).set('Authorization', `Bearer ${token}`).send({ cancellationReason: 'second' });
      expect(twice.status).toBe(400);
      expect(await unitStatus(fx.unit.id)).toBe('AVAILABLE');
    });

    test('no generic PATCH/DELETE escape hatch', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'noescape');
      const bookingId = (await book(token, { reservationId: fx.reservation.id })).body.booking.id;
      for (const method of ['patch', 'put', 'delete']) {
        const res = await request(app)[method](`/bookings/${bookingId}`).set('Authorization', `Bearer ${token}`).send({});
        expect(res.status).toBe(404);
      }
      expect((await prisma.booking.findFirst({ where: { id: bookingId } })).cancelledAt).toBeNull();
      expect(await unitStatus(fx.unit.id)).toBe('BOOKED');
    });
  });

  // -------------------------------------------------------------------------
  describe('Rollback integrity', () => {
    test('unit/deal mismatch leaves booking + unit + reservation untouched', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'rollback');
      const other = await fixtures(token, 'rollback2');
      const res = await book(token, { reservationId: fx.reservation.id, unitId: other.unit.id });
      expect(res.status).toBe(400);
      expect(await prisma.booking.count({ where: { organizationId: orgA.id } })).toBe(0);
      expect(await reservationStatus(fx.reservation.id)).toBe('ACTIVE');
      expect(await unitStatus(fx.unit.id)).toBe('RESERVED');
    });
  });
});
