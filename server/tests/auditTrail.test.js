const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/lib/prisma');
const { hashPassword } = require('../src/lib/bcrypt');
const { createTenantPrisma } = require('../src/lib/tenant');
const { writeAudit } = require('../src/lib/audit');

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

let phoneCtr = 9300000000;
function identity(tag) {
  phoneCtr += 1;
  return {
    contactName: `Person ${tag} ${phoneCtr}`,
    phone: String(phoneCtr),
    email: `${tag}-${phoneCtr}@test.com`,
  };
}

describe('Checkpoint 16 — Audit Trail consolidation', () => {
  const PERMS = [
    ['contact', 'create'],
    ['contact', 'read'],
    ['contact', 'update'],
    ['contact', 'delete'],
    ['enquiry', 'create'],
    ['lead', 'read'],
    ['deal', 'create'],
    ['deal', 'read'],
    ['deal', 'transition'],
    ['task', 'create'],
  ];

  let orgA, orgB;
  let roleAdminA, roleAdminB;
  let userAdminA, userAdminB;
  const plainAdminA = 'AdminPass123!';
  const plainAdminB = 'AdminBPass123!';

  async function wipeAll() {
    await prisma.refreshToken.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.idempotencyKey.deleteMany({});
    await prisma.task.deleteMany({});
    await prisma.activity.deleteMany({});
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
    await prisma.task.deleteMany({});
    await prisma.activity.deleteMany({});
    await prisma.deal.deleteMany({});
    await prisma.lead.deleteMany({});
    await prisma.enquiry.deleteMany({});
    await prisma.possibleDuplicate.deleteMany({});
    await prisma.requirement.deleteMany({});
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
    roleAdminB = await prisma.role.create({ data: { name: 'Admin', organizationId: orgB.id } });

    for (const p of Object.values(permByKey)) {
      await prisma.rolePermission.create({
        data: { organizationId: orgA.id, roleId: roleAdminA.id, permissionId: p.id, scope: 'ORGANIZATION' },
      });
      await prisma.rolePermission.create({
        data: { organizationId: orgB.id, roleId: roleAdminB.id, permissionId: p.id, scope: 'ORGANIZATION' },
      });
    }

    userAdminA = await prisma.user.create({
      data: { name: 'AdminA', email: uid('adminA') + '@test.com', organizationId: orgA.id, roleId: roleAdminA.id, passwordHash: await hashPassword(plainAdminA), status: 'ACTIVE' },
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

  async function makeContact(token, overrides = {}) {
    const id = identity('ct');
    const res = await request(app)
      .post('/contacts')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: id.contactName, phone: id.phone, email: id.email, ...overrides });
    expect(res.status).toBe(201);
    return res.body.contact;
  }

  async function makeLead(token, overrides = {}) {
    const res = await request(app)
      .post('/enquiries')
      .set('Authorization', `Bearer ${token}`)
      .send({ channel: 'WALK_IN', ...identity('au'), ...overrides });
    expect(res.status).toBe(201);
    expect(res.body.lead.status).toBe('OPEN');
    return res.body.lead;
  }

  async function makeTask(token, assigneeId, relatedContactId) {
    const res = await request(app)
      .post('/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({
        assignedTo: assigneeId,
        title: 'Follow up on site visit',
        dueAt: new Date(Date.now() + 86400000).toISOString(),
        relatedContactId,
      });
    expect(res.status).toBe(201);
    return res.body;
  }

  async function auditRows(where) {
    return prisma.auditLog.findMany({ where, orderBy: { createdAt: 'asc' } });
  }

  describe('contact.merge coverage', () => {
    test('successful merge writes one contact.merge row with org/actor/before/after and no PII', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const survivor = await makeContact(token);
      const duplicate = await makeContact(token);

      const res = await request(app)
        .post(`/contacts/${duplicate.id}/merge`)
        .set('Authorization', `Bearer ${token}`)
        .send({ targetId: survivor.id });
      expect(res.status).toBe(200);

      const rows = await auditRows({ organizationId: orgA.id, entityType: 'Contact', entityId: duplicate.id });
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe('contact.merge');
      expect(rows[0].actorId).toBe(userAdminA.id);
      expect(rows[0].organizationId).toBe(orgA.id);
      expect(rows[0].beforeState).toMatchObject({ survivorId: survivor.id, duplicateId: duplicate.id });
      expect(rows[0].afterState.mergedInto).toBe(survivor.id);
      expect(rows[0].afterState.moved).toBeDefined();
      // No contact PII may leak into audit payloads.
      const serialized = JSON.stringify(rows[0]);
      expect(serialized).not.toContain(duplicate.email);
      expect(serialized).not.toContain(duplicate.phone);
    });

    test('failed merge (into soft-deleted contact) writes no audit row', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const survivor = await makeContact(token);
      const duplicate = await makeContact(token);
      const doomed = await makeContact(token);

      const del = await request(app).delete(`/contacts/${survivor.id}`).set('Authorization', `Bearer ${token}`);
      expect(del.status).toBe(200);

      const res = await request(app)
        .post(`/contacts/${duplicate.id}/merge`)
        .set('Authorization', `Bearer ${token}`)
        .send({ targetId: survivor.id });
      expect(res.status).toBe(400);
      expect(doomed.id).toBeDefined();

      const rows = await auditRows({ organizationId: orgA.id, entityType: 'Contact' });
      expect(rows).toHaveLength(0);
    });

    test('cross-tenant merge is rejected and writes no audit row', async () => {      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const contactA = await makeContact(tokenA);
      const contactB = await makeContact(tokenB);

      const res = await request(app)
        .post(`/contacts/${contactB.id}/merge`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetId: contactA.id });
      expect(res.status).toBe(403);

      expect(await auditRows({ entityType: 'Contact', entityId: contactB.id })).toHaveLength(0);
      expect(await auditRows({ entityType: 'Contact', entityId: contactA.id })).toHaveLength(0);
    });

    test('concurrent merges yield one success and exactly one audit row', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const survivor = await makeContact(token);
      const duplicate = await makeContact(token);

      const [a, b] = await Promise.all([
        request(app).post(`/contacts/${duplicate.id}/merge`).set('Authorization', `Bearer ${token}`).send({ targetId: survivor.id }),
        request(app).post(`/contacts/${duplicate.id}/merge`).set('Authorization', `Bearer ${token}`).send({ targetId: survivor.id }),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([200, 409]);

      const rows = await auditRows({ organizationId: orgA.id, entityType: 'Contact', entityId: duplicate.id });
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe('contact.merge');
    });

    test('merge reassigns tasks to the survivor, unchanged otherwise, counted in audit', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const survivor = await makeContact(token);
      const duplicate = await makeContact(token);
      const before = await makeTask(token, userAdminA.id, duplicate.id);

      const res = await request(app)
        .post(`/contacts/${duplicate.id}/merge`)
        .set('Authorization', `Bearer ${token}`)
        .send({ targetId: survivor.id });
      expect(res.status).toBe(200);

      const after = await prisma.task.findFirst({ where: { id: before.id } });
      expect(after.relatedContactId).toBe(survivor.id);
      expect(after.status).toBe(before.status);
      expect(after.title).toBe(before.title);
      expect(after.assignedTo).toBe(before.assignedTo);
      expect(new Date(after.dueAt).getTime()).toBe(new Date(before.dueAt).getTime());

      const rows = await auditRows({ organizationId: orgA.id, entityType: 'Contact', entityId: duplicate.id });
      expect(rows).toHaveLength(1);
      expect(rows[0].afterState.moved.task).toBe(1);
    });

    test('failed merge moves no tasks; cross-org tasks untouched', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const survivor = await makeContact(tokenA);
      const duplicate = await makeContact(tokenA);
      const taskA = await makeTask(tokenA, userAdminA.id, duplicate.id);
      const contactB = await makeContact(tokenB);
      const taskB = await makeTask(tokenB, userAdminB.id, contactB.id);

      // Failed merge (self-merge) rolls back everything including tasks.
      const bad = await request(app)
        .post(`/contacts/${duplicate.id}/merge`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetId: duplicate.id });
      expect(bad.status).toBe(400);
      expect((await prisma.task.findFirst({ where: { id: taskA.id } })).relatedContactId).toBe(duplicate.id);
      expect(await auditRows({ organizationId: orgA.id, entityType: 'Contact', entityId: duplicate.id })).toHaveLength(0);

      // Successful org-A merge cannot touch org-B tasks.
      const ok = await request(app)
        .post(`/contacts/${duplicate.id}/merge`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetId: survivor.id });
      expect(ok.status).toBe(200);
      expect((await prisma.task.findFirst({ where: { id: taskB.id } })).relatedContactId).toBe(contactB.id);
      expect((await prisma.task.findFirst({ where: { id: taskA.id } })).relatedContactId).toBe(survivor.id);
    });
  });

  describe('append-only enforcement', () => {
    test('tenant client rejects update/delete/upsert on auditLog but allows reads', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const survivor = await makeContact(token);
      const duplicate = await makeContact(token);
      await request(app).post(`/contacts/${duplicate.id}/merge`).set('Authorization', `Bearer ${token}`).send({ targetId: survivor.id });

      const tenant = createTenantPrisma(orgA.id);
      const existing = await tenant.auditLog.findMany({ where: { entityId: duplicate.id } });
      expect(existing).toHaveLength(1);

      await expect(tenant.auditLog.update({ where: { id: existing[0].id }, data: { action: 'tampered' } })).rejects.toMatchObject({ statusCode: 403 });
      await expect(tenant.auditLog.updateMany({ where: {}, data: { action: 'tampered' } })).rejects.toMatchObject({ statusCode: 403 });
      await expect(tenant.auditLog.delete({ where: { id: existing[0].id } })).rejects.toMatchObject({ statusCode: 403 });
      await expect(tenant.auditLog.deleteMany({ where: {} })).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        tenant.auditLog.upsert({ where: { id: existing[0].id }, create: { actorId: 'x', entityType: 'T', entityId: 'e', action: 'a' }, update: { action: 'tampered' } })
      ).rejects.toMatchObject({ statusCode: 403 });

      // History is untouched.
      expect(await auditRows({ organizationId: orgA.id, entityType: 'Contact', entityId: duplicate.id })).toHaveLength(1);
    });

    test('writeAudit refuses non-transaction clients and missing actorId', async () => {
      const tenant = createTenantPrisma(orgA.id);
      await expect(
        writeAudit(tenant, { organizationId: orgA.id, actorId: userAdminA.id, entityType: 'Contact', entityId: 'e', action: 'contact.merge' })
      ).rejects.toMatchObject({ statusCode: 400 });

      await expect(
        tenant.$transaction(async (tx) =>
          writeAudit(tx, { organizationId: orgA.id, actorId: null, entityType: 'Contact', entityId: 'e', action: 'contact.merge' })
        )
      ).rejects.toMatchObject({ statusCode: 400 });

      expect(await auditRows({ organizationId: orgA.id })).toHaveLength(0);
    });
  });

  describe('shared-helper regression (deal writes unchanged)', () => {
    test('deal create + transition still write deal.create / deal.stage_transition with actor', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const lead = await makeLead(token);

      const created = await request(app).post('/deals').set('Authorization', `Bearer ${token}`).send({ leadId: lead.id });
      expect(created.status).toBe(201);

      const moved = await request(app)
        .post(`/deals/${created.body.id}/stage-transition`)
        .set('Authorization', `Bearer ${token}`)
        .send({ stage: 'QUALIFIED' });
      expect(moved.status).toBe(200);

      const rows = await auditRows({ organizationId: orgA.id, entityType: 'Deal', entityId: created.body.id });
      expect(rows.map((r) => r.action)).toEqual(['deal.create', 'deal.stage_transition']);
      expect(rows[0].actorId).toBe(userAdminA.id);
      expect(rows[0].beforeState).toBeNull();
      expect(rows[0].afterState.stage).toBe('NEW');
      expect(rows[1].beforeState.stage).toBe('NEW');
      expect(rows[1].afterState.stage).toBe('QUALIFIED');
    });

    test('invalid transition writes no audit row', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const lead = await makeLead(token);
      const created = await request(app).post('/deals').set('Authorization', `Bearer ${token}`).send({ leadId: lead.id });
      expect(created.status).toBe(201);

      const bad = await request(app)
        .post(`/deals/${created.body.id}/stage-transition`)
        .set('Authorization', `Bearer ${token}`)
        .send({ stage: 'CLOSED_WON' });
      expect(bad.status).toBe(400);

      const rows = await auditRows({ organizationId: orgA.id, entityType: 'Deal', entityId: created.body.id });
      expect(rows).toHaveLength(1);
    });
  });
});
