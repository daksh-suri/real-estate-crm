const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/lib/prisma');
const { hashPassword } = require('../src/lib/bcrypt');
const { createTenantPrisma } = require('../src/lib/tenant');
const {
  EVENT_TYPES,
  computeBackoff,
  enqueueOutbox,
  claimOutboxEvents,
  processOutboxBatch,
} = require('../src/worker/outbox');
const { setNotificationProvider } = require('../src/worker/notifications');
const { startScheduler, stopScheduler, runReservationExpirySweep } = require('../src/worker/scheduler');
const { expireDueReservations } = require('../src/modules/reservations/service');

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

let phoneCtr = 9900000000;
function identity(tag) {
  phoneCtr += 1;
  return {
    contactName: `Person ${tag} ${phoneCtr}`,
    phone: String(phoneCtr),
    email: `${tag}-${phoneCtr}@test.com`,
  };
}

const HOUR = 3600000;

// Recording provider: stable-key idempotent by event id.
function recordingProvider(sent) {
  return {
    async send({ eventId, lane, contact, subject }) {
      const seen = sent.find((s) => s.eventId === eventId);
      if (seen) return { delivered: true, duplicate: true };
      sent.push({ eventId, lane, contactId: contact ? contact.id : null, subject });
      return { delivered: true };
    },
  };
}

describe('Checkpoint 15 — Background Jobs & Outbox', () => {
  let orgA, orgB;
  let roleAdminA, roleAdminB;
  let userAdminA, userAdminB;
  let plainAdminA = 'AdminPass123!';
  let plainAdminB = 'AdminBPass123!';
  let sent;

  async function wipeAll() {
    await prisma.refreshToken.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.idempotencyKey.deleteMany({});
    await prisma.outboxEvent.deleteMany({});
    await prisma.workerHeartbeat.deleteMany({});
    await prisma.task.deleteMany({});
    await prisma.activity.deleteMany({});
    await prisma.document.deleteMany({});
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
    await prisma.outboxEvent.deleteMany({});
    await prisma.workerHeartbeat.deleteMany({});
    await prisma.task.deleteMany({});
    await prisma.activity.deleteMany({});
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
    await prisma.auditLog.deleteMany({});
    await prisma.idempotencyKey.deleteMany({});
  }

  beforeAll(async () => {
    await wipeAll();

    orgA = await prisma.organization.create({ data: { name: uid('OrgA') } });
    orgB = await prisma.organization.create({ data: { name: uid('OrgB') } });

    const perms = {};
    for (const [resource, action] of [['contact', 'create'], ['contact', 'read'], ['enquiry', 'create'], ['project', 'create'], ['unit', 'create'], ['deal', 'create'], ['reservation', 'create']]) {
      const p = await prisma.permission.create({ data: { resource, action } });
      perms[`${resource}:${action}`] = p;
    }

    roleAdminA = await prisma.role.create({ data: { name: 'Admin', organizationId: orgA.id } });
    roleAdminB = await prisma.role.create({ data: { name: 'Admin', organizationId: orgB.id } });
    for (const p of Object.values(perms)) {
      await prisma.rolePermission.create({ data: { organizationId: orgA.id, roleId: roleAdminA.id, permissionId: p.id, scope: 'ORGANIZATION' } });
      await prisma.rolePermission.create({ data: { organizationId: orgB.id, roleId: roleAdminB.id, permissionId: p.id, scope: 'ORGANIZATION' } });
    }

    userAdminA = await prisma.user.create({
      data: { name: 'AdminA', email: uid('adminA') + '@test.com', organizationId: orgA.id, roleId: roleAdminA.id, passwordHash: await hashPassword(plainAdminA), status: 'ACTIVE' },
    });
    userAdminB = await prisma.user.create({
      data: { name: 'AdminB', email: uid('adminB') + '@test.com', organizationId: orgB.id, roleId: roleAdminB.id, passwordHash: await hashPassword(plainAdminB), status: 'ACTIVE' },
    });
  });

  afterAll(async () => {
    setNotificationProvider(null);
    await wipeAll();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    sent = [];
    setNotificationProvider(recordingProvider(sent));
  });

  afterEach(async () => {
    setNotificationProvider(null);
    await wipeDomain();
  });

  async function login(email, password, organizationId) {
    const res = await request(app).post('/auth/login').send({ email, password, organizationId });
    expect(res.status).toBe(200);
    return res.body.accessToken;
  }

  async function makeContact(token, tag) {
    const id = identity(tag);
    const res = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: id.contactName, phone: id.phone, email: id.email });
    expect(res.status).toBe(201);
    return res.body.contact;
  }

  // -------------------------------------------------------------------------
  describe('Outbox commit/rollback + processing', () => {
    test('business mutation + event commit together; rollback takes both', async () => {
      const tenantA = createTenantPrisma(orgA.id);
      const contact = await tenantA.contact.create({
        data: { name: 'W1', email: uid('w1') + '@t.com', normalizedEmail: uid('w1') + '@t.com', phone: '9910000001', normalizedPhone: '9910000001' },
      });
      await prisma.$transaction(async (tx) => {
        await tx.contact.update({ where: { id: contact.id }, data: { name: 'W1-renamed' } });
        await enqueueOutbox(tx, { organizationId: orgA.id, eventType: EVENT_TYPES.NOTIFICATION_INTERNAL, payload: { lane: 'internal', subject: 's', body: 'b' } });
      });
      expect(await prisma.outboxEvent.count({ where: { organizationId: orgA.id } })).toBe(1);

      await expect(
        prisma.$transaction(async (tx) => {
          await tx.contact.update({ where: { id: contact.id }, data: { name: 'W1-rolledback' } });
          await enqueueOutbox(tx, { organizationId: orgA.id, eventType: EVENT_TYPES.NOTIFICATION_INTERNAL, payload: { lane: 'internal', subject: 's', body: 'b' } });
          throw new Error('forced failure');
        })
      ).rejects.toThrow('forced failure');
      expect((await prisma.contact.findFirst({ where: { id: contact.id } })).name).toBe('W1-renamed');
      expect(await prisma.outboxEvent.count({ where: { organizationId: orgA.id } })).toBe(1);
    });

    test('PENDING processes to PROCESSED via the named lane', async () => {
      const tenantA = createTenantPrisma(orgA.id);
      await tenantA.outboxEvent.create({
        data: { organizationId: orgA.id, eventType: EVENT_TYPES.NOTIFICATION_INTERNAL, payload: { lane: 'internal', subject: 'ops', body: 'hello' } },
      });
      const out = await processOutboxBatch({ client: prisma });
      expect(out).toMatchObject({ claimed: 1, processed: 1 });
      const row = await prisma.outboxEvent.findFirst({ where: { organizationId: orgA.id } });
      expect(row.status).toBe('PROCESSED');
      expect(row.processedAt).not.toBeNull();
      expect(row.attempts).toBe(1);
      expect(sent.length).toBe(1);
      expect(sent[0].lane).toBe('internal');
    });

    test('unknown event type retries with attempts, then FAILED with reason kept', async () => {
      const tenantA = createTenantPrisma(orgA.id);
      await tenantA.outboxEvent.create({
        data: { organizationId: orgA.id, eventType: 'NOPE_UNKNOWN', payload: {} },
      });
      const first = await processOutboxBatch({ client: prisma });
      expect(first).toMatchObject({ claimed: 1, retried: 1 });
      let row = await prisma.outboxEvent.findFirst({ where: { organizationId: orgA.id } });
      expect(row.status).toBe('PENDING');
      expect(row.attempts).toBe(1);
      expect(row.lastError).toMatch(/No handler/);
      expect(new Date(row.availableAt).getTime()).toBeGreaterThan(Date.now());
      // Force the ceiling: attempts already at max-1, next failure → FAILED.
      await prisma.outboxEvent.update({ where: { id: row.id }, data: { attempts: 9, availableAt: new Date(Date.now() - 1000) } });
      const second = await processOutboxBatch({ client: prisma });
      expect(second).toMatchObject({ failed: 1 });
      row = await prisma.outboxEvent.findFirst({ where: { id: row.id } });
      expect(row.status).toBe('FAILED');
      expect(row.failedAt).not.toBeNull();
      expect(row.lastError).toMatch(/No handler/);
      // FAILED rows are never reclaimed.
      expect((await processOutboxBatch({ client: prisma })).claimed).toBe(0);
    });

    test('backoff grows exponentially and caps', async () => {
      const d0 = computeBackoff(1);
      const d1 = computeBackoff(2);
      const d2 = computeBackoff(3);
      expect(d1).toBe(d0 * 2);
      expect(d2).toBe(d0 * 4);
      expect(computeBackoff(100)).toBeLessThanOrEqual(3600000);
      expect(computeBackoff(100)).toBe(3600000);
    });

    test('crash before PROCESSED leaves the event retryable', async () => {
      const tenantA = createTenantPrisma(orgA.id);
      const created = await tenantA.outboxEvent.create({
        data: { organizationId: orgA.id, eventType: EVENT_TYPES.NOTIFICATION_INTERNAL, payload: { lane: 'internal', subject: 's', body: 'b' } },
      });
      // Simulate the crash window: claimed (attempts bumped) but never marked.
      const claimed = await claimOutboxEvents(prisma, { now: new Date() });
      expect(claimed.length).toBe(1);
      expect(claimed[0].id).toBe(created.id);
      const row = await prisma.outboxEvent.findFirst({ where: { id: created.id } });
      expect(row.status).toBe('PENDING');
      // Next run still picks it up and finishes it.
      const out = await processOutboxBatch({ client: prisma });
      expect(out.processed).toBe(1);
      expect((await prisma.outboxEvent.findFirst({ where: { id: created.id } })).status).toBe('PROCESSED');
    });

    test('concurrent workers do not double-process', async () => {
      const tenantA = createTenantPrisma(orgA.id);
      for (let i = 0; i < 5; i += 1) {
        await tenantA.outboxEvent.create({
          data: { organizationId: orgA.id, eventType: EVENT_TYPES.NOTIFICATION_INTERNAL, payload: { lane: 'internal', subject: `s${i}`, body: 'b' } },
        });
      }
      const [a, b] = await Promise.all([processOutboxBatch({ client: prisma }), processOutboxBatch({ client: prisma })]);
      expect(a.claimed + b.claimed).toBe(5);
      expect(await prisma.outboxEvent.count({ where: { organizationId: orgA.id, status: 'PROCESSED' } })).toBe(5);
      expect(sent.length).toBe(5);
    });

    test('unknown event types cannot be enqueued', async () => {
      await expect(
        prisma.$transaction((tx) => enqueueOutbox(tx, { organizationId: orgA.id, eventType: 'NOPE', payload: {} }))
      ).rejects.toThrow(/Unknown outbox event type/);
    });
  });

  // -------------------------------------------------------------------------
  describe('Notification lanes + consent', () => {
    test('customer lane delivers when opted in', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const contact = await makeContact(token, 'optin');
      const tenantA = createTenantPrisma(orgA.id);
      await tenantA.outboxEvent.create({
        data: { organizationId: orgA.id, eventType: EVENT_TYPES.NOTIFICATION_CUSTOMER, payload: { lane: 'customer', contactId: contact.id, subject: 'visit', body: 'tomorrow' } },
      });
      const out = await processOutboxBatch({ client: prisma });
      expect(out.processed).toBe(1);
      expect(sent[0]).toMatchObject({ lane: 'customer', contactId: contact.id });
    });

    test('customer lane suppressed on OPTED_OUT at dispatch (stale enqueue ignored)', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const contact = await makeContact(token, 'optout');
      const tenantA = createTenantPrisma(orgA.id);
      // Enqueued while opted in...
      await tenantA.outboxEvent.create({
        data: { organizationId: orgA.id, eventType: EVENT_TYPES.NOTIFICATION_CUSTOMER, payload: { lane: 'customer', contactId: contact.id, subject: 'visit', body: 'tomorrow' } },
      });
      // ...then the customer opts out before dispatch.
      await tenantA.contact.update({ where: { id: contact.id }, data: { communicationConsent: 'OPTED_OUT' } });
      const out = await processOutboxBatch({ client: prisma });
      expect(out.processed).toBe(1);
      expect(sent.length).toBe(0);
      const row = await prisma.outboxEvent.findFirst({ where: { organizationId: orgA.id } });
      expect(row.status).toBe('PROCESSED');
      expect(row.lastError).toMatch(/suppressed/);
    });

    test('internal lane ignores consent; missing contact fails retryably', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const contact = await makeContact(token, 'internal');
      const tenantA = createTenantPrisma(orgA.id);
      await tenantA.contact.update({ where: { id: contact.id }, data: { communicationConsent: 'OPTED_OUT' } });
      await tenantA.outboxEvent.create({
        data: { organizationId: orgA.id, eventType: EVENT_TYPES.NOTIFICATION_INTERNAL, payload: { lane: 'internal', contactId: contact.id, subject: 'ops', body: 'b' } },
      });
      expect((await processOutboxBatch({ client: prisma })).processed).toBe(1);
      expect(sent.length).toBe(1);
      // Customer lane with a deleted contact → retryable failure, never silent.
      const ghost = await tenantA.outboxEvent.create({
        data: { organizationId: orgA.id, eventType: EVENT_TYPES.NOTIFICATION_CUSTOMER, payload: { lane: 'customer', contactId: '00000000-0000-4000-8000-000000000000', subject: 'x', body: 'y' } },
      });
      void ghost;
      expect((await processOutboxBatch({ client: prisma })).retried).toBe(1);
    });

    test('provider receives the stable event id across retries', async () => {
      const tenantA = createTenantPrisma(orgA.id);
      const created = await tenantA.outboxEvent.create({
        data: { organizationId: orgA.id, eventType: EVENT_TYPES.NOTIFICATION_INTERNAL, payload: { lane: 'internal', subject: 's', body: 'b' } },
      });
      setNotificationProvider({
        async send({ eventId }) {
          sent.push({ eventId, flaky: true });
          if (sent.filter((s) => s.eventId === eventId).length === 1) throw new Error('provider down once');
          return { delivered: true };
        },
      });
      expect((await processOutboxBatch({ client: prisma })).retried).toBe(1);
      await prisma.outboxEvent.update({ where: { id: created.id }, data: { availableAt: new Date(Date.now() - 1000) } });
      expect((await processOutboxBatch({ client: prisma })).processed).toBe(1);
      expect(sent.filter((s) => s.eventId === created.id).length).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  describe('Tenant isolation', () => {
    test('org A event never resolves org B data', async () => {
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const contactB = await makeContact(tokenB, 'isoB');
      const tenantA = createTenantPrisma(orgA.id);
      // Forged payload pointing at B's contact, stored under A's org.
      await tenantA.outboxEvent.create({
        data: { organizationId: orgA.id, eventType: EVENT_TYPES.NOTIFICATION_CUSTOMER, payload: { lane: 'customer', contactId: contactB.id, subject: 'x', body: 'y' } },
      });
      // Tenant-scoped read finds nothing → retryable failure, no leak.
      expect((await processOutboxBatch({ client: prisma })).retried).toBe(1);
      expect(sent.length).toBe(0);
      // B's own event resolves B's contact.
      const tenantB = createTenantPrisma(orgB.id);
      await tenantB.outboxEvent.create({
        data: { organizationId: orgB.id, eventType: EVENT_TYPES.NOTIFICATION_CUSTOMER, payload: { lane: 'customer', contactId: contactB.id, subject: 'x', body: 'y' } },
      });
      expect((await processOutboxBatch({ client: prisma })).processed).toBe(1);
      expect(sent[0].contactId).toBe(contactB.id);
    });
  });

  // -------------------------------------------------------------------------
  describe('Expiry sweep wiring', () => {
    test('due reservations release through the scheduler path', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const project = (await request(app).post('/projects').set('Authorization', `Bearer ${token}`).send({ name: uid('Proj') })).body;
      const unit = (await request(app).post(`/projects/${project.id}/units`).set('Authorization', `Bearer ${token}`).send({ identifier: uid('U') })).body;
      const id = identity('exp');
      const enq = await request(app).post('/enquiries').set('Authorization', `Bearer ${token}`).send({ channel: 'WALK_IN', ...id });
      const deal = (await request(app).post('/deals').set('Authorization', `Bearer ${token}`).send({ leadId: enq.body.lead.id })).body;
      const rsv = (await request(app).post('/reservations').set('Authorization', `Bearer ${token}`).send({ unitId: unit.id, dealId: deal.id, type: 'RESERVATION' })).body.reservation;
      await prisma.reservation.update({ where: { id: rsv.id }, data: { expiresAt: new Date(Date.now() - HOUR) } });
      const out = await runReservationExpirySweep();
      expect(out).toMatchObject({ checked: 1, expired: 1 });
      expect((await prisma.reservation.findFirst({ where: { id: rsv.id } })).status).toBe('EXPIRED');
      expect((await prisma.unit.findFirst({ where: { id: unit.id } })).availabilityStatus).toBe('AVAILABLE');
      // Business logic untouched: existing suite still owns the edge cases.
      expect((await expireDueReservations({ rawPrisma: prisma })).checked).toBe(0);
    });

    test('scheduler starts, beats, and stops gracefully', async () => {
      const state = startScheduler({ intervals: { expiry: 50, outbox: 50 } });
      await new Promise((resolve) => { setTimeout(resolve, 300); });
      await stopScheduler(state);
      expect(state.stopped).toBe(true);
      const beat = await prisma.workerHeartbeat.findUnique({ where: { id: 'main' } });
      expect(beat).not.toBeNull();
      expect(Date.now() - new Date(beat.lastBeatAt).getTime()).toBeLessThan(60000);
    });
  });

  // -------------------------------------------------------------------------
  describe('Health', () => {
    test('/health reports db and worker liveness', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.db).toBe('ok');
      expect(['live', 'stale', 'never']).toContain(res.body.worker);
    });
  });
});
