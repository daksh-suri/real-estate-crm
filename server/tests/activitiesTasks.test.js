const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/lib/prisma');
const { hashPassword } = require('../src/lib/bcrypt');

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

let phoneCtr = 9800000000;
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

describe('Checkpoint 14 — Activity & Task', () => {
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
    ['contact', 'update'],
    ['deal', 'create'],
    ['deal', 'read'],
    ['activity', 'create'],
    ['activity', 'read'],
    ['task', 'create'],
    ['task', 'read'],
    ['task', 'complete'],
  ];
  const AGENT_PERMS = [['activity', 'create'], ['activity', 'read'], ['task', 'create'], ['task', 'read']];

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
    await prisma.document.deleteMany({});
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

  async function makeContact(token, tag) {
    const id = identity(tag);
    const res = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: id.contactName, phone: id.phone, email: id.email });
    expect(res.status).toBe(201);
    return res.body.contact;
  }

  async function makeLeadDeal(token, tag) {
    const id = identity(`ld${tag}`);
    const enq = await request(app).post('/enquiries').set('Authorization', `Bearer ${token}`).send({ channel: 'WALK_IN', ...id });
    expect(enq.status).toBe(201);
    const deal = await request(app).post('/deals').set('Authorization', `Bearer ${token}`).send({ leadId: enq.body.lead.id });
    expect(deal.status).toBe(201);
    return { lead: enq.body.lead, deal: deal.body };
  }

  function activityBody(contactId, extra = {}) {
    return { contactId, type: 'CALL', outcome: 'CONNECTED', notes: 'Called about 2BHK', ...extra };
  }

  function taskBody(assignedTo, extra = {}) {
    return { assignedTo, title: 'Call back tomorrow', dueAt: isoFuture(24), ...extra };
  }

  // -------------------------------------------------------------------------
  describe('Activity', () => {
    test('creates activity with server-derived createdBy + org; links lead/deal', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const contact = await makeContact(token, 'act');
      const { lead } = await makeLeadDeal(token, 'act');
      // Lead/deal belong to a different contact — use matching ones: rebuild via same contact is intake-driven,
      // so assert cross-link consistency rejection instead, then a clean link.
      const bad = await request(app).post('/activities').set('Authorization', `Bearer ${token}`).send(activityBody(contact.id, { leadId: lead.id }));
      expect(bad.status).toBe(400);
      const own = await makeLeadDeal(token, 'actown');
      const ownContact = await prisma.contact.findFirst({ where: { id: own.lead.contactId } });
      const res = await request(app)
        .post('/activities')
        .set('Authorization', `Bearer ${token}`)
        .send(activityBody(ownContact.id, { leadId: own.lead.id, dealId: own.deal.id, createdBy: 'spoofed-id', organizationId: orgB.id }));
      expect(res.status).toBe(201);
      expect(res.body.activity.contactId).toBe(ownContact.id);
      expect(res.body.activity.leadId).toBe(own.lead.id);
      expect(res.body.activity.dealId).toBe(own.deal.id);
      expect(res.body.activity.createdBy).toBe(userAdminA.id);
      expect(res.body.activity.organizationId).toBe(orgA.id);
    });

    test('cross-tenant / soft-deleted refs rejected; reads hidden', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const contactB = await makeContact(tokenB, 'xref');
      const contactA = await makeContact(tokenA, 'xrefa');
      expect((await request(app).post('/activities').set('Authorization', `Bearer ${tokenA}`).send(activityBody(contactB.id))).status).toBe(403);
      await prisma.contact.update({ where: { id: contactA.id }, data: { deletedAt: new Date() } });
      expect((await request(app).post('/activities').set('Authorization', `Bearer ${tokenA}`).send(activityBody(contactA.id))).status).toBe(400);
      const act = (await request(app).post('/activities').set('Authorization', `Bearer ${tokenB}`).send(activityBody(contactB.id))).body.activity;
      expect((await request(app).get(`/activities/${act.id}`).set('Authorization', `Bearer ${tokenA}`)).status).toBe(404);
      expect(await prisma.activity.count({ where: { organizationId: orgA.id } })).toBe(0);
    });

    test('list filters + no PATCH/DELETE escape hatch', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const contact = await makeContact(token, 'list');
      const created = (await request(app).post('/activities').set('Authorization', `Bearer ${token}`).send(activityBody(contact.id))).body.activity;
      const list = await request(app).get(`/activities?contactId=${contact.id}&limit=10`).set('Authorization', `Bearer ${token}`);
      expect(list.status).toBe(200);
      expect(list.body.length).toBe(1);
      for (const method of ['patch', 'put', 'delete']) {
        expect((await request(app)[method](`/activities/${created.id}`).set('Authorization', `Bearer ${token}`).send({ notes: 'rewritten' })).status).toBe(404);
      }
      expect((await prisma.activity.findFirst({ where: { id: created.id } })).notes).toBe('Called about 2BHK');
    });
  });

  // -------------------------------------------------------------------------
  describe('Task', () => {
    test('creates OPEN task with persisted dueAt; assignee rules enforced', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const contact = await makeContact(token, 'task');
      const res = await request(app)
        .post('/tasks')
        .set('Authorization', `Bearer ${token}`)
        .send(taskBody(userAgentA.id, { relatedContactId: contact.id }));
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('OPEN');
      expect(res.body.assignedTo).toBe(userAgentA.id);
      expect(res.body.createdBy).toBe(userAdminA.id);
      expect(new Date(res.body.dueAt).getTime()).toBeGreaterThan(Date.now());
      // Cross-tenant assignee/contact rejected.
      expect((await request(app).post('/tasks').set('Authorization', `Bearer ${token}`).send(taskBody(userAdminB.id))).status).toBe(403);
      const contactB = await makeContact(tokenB, 'taskx');
      expect((await request(app).post('/tasks').set('Authorization', `Bearer ${token}`).send(taskBody(userAgentA.id, { relatedContactId: contactB.id }))).status).toBe(403);
      expect(await prisma.task.count({ where: { organizationId: orgA.id } })).toBe(1);
    });

    test('OVERDUE derived at read, DONE stays DONE', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const stored = await prisma.task.create({
        data: { organizationId: orgA.id, assignedTo: userAgentA.id, title: 'Late', dueAt: new Date(Date.now() - HOUR), status: 'OPEN', createdBy: userAdminA.id },
      });
      expect(stored.status).toBe('OPEN');
      const read = await request(app).get(`/tasks/${stored.id}`).set('Authorization', `Bearer ${token}`);
      expect(read.body.status).toBe('OVERDUE');
      const done = await request(app).post(`/tasks/${stored.id}/complete`).set('Authorization', `Bearer ${token}`);
      expect(done.body.status).toBe('DONE');
      await prisma.task.update({ where: { id: stored.id }, data: { dueAt: new Date(Date.now() - 2 * HOUR) } });
      const reread = await request(app).get(`/tasks/${stored.id}`).set('Authorization', `Bearer ${token}`);
      expect(reread.body.status).toBe('DONE');
      const filtered = await request(app).get('/tasks?status=OVERDUE').set('Authorization', `Bearer ${token}`);
      expect(filtered.body.find((t) => t.id === stored.id)).toBeUndefined();
    });

    test('complete succeeds once; repeat + cross-tenant + noperm rejected', async () => {
      const admin = await login(userAdminA.email, plainAdminA, orgA.id);
      const agent = await login(userAgentA.email, plainAgentA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const task = (await request(app).post('/tasks').set('Authorization', `Bearer ${admin}`).send(taskBody(userAgentA.id))).body;
      expect((await request(app).post(`/tasks/${task.id}/complete`).set('Authorization', `Bearer ${tokenB}`)).status).toBe(404);
      expect((await request(app).post(`/tasks/${task.id}/complete`).set('Authorization', `Bearer ${agent}`)).status).toBe(403);
      expect((await request(app).post(`/tasks/${task.id}/complete`).set('Authorization', `Bearer ${admin}`)).status).toBe(200);
      expect((await request(app).post(`/tasks/${task.id}/complete`).set('Authorization', `Bearer ${admin}`)).status).toBe(409);
      expect((await prisma.task.findFirst({ where: { id: task.id } })).status).toBe('DONE');
    });

    test('concurrent completes: exactly one wins', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const task = (await request(app).post('/tasks').set('Authorization', `Bearer ${token}`).send(taskBody(userAgentA.id))).body;
      const [a, b] = await Promise.all([
        request(app).post(`/tasks/${task.id}/complete`).set('Authorization', `Bearer ${token}`),
        request(app).post(`/tasks/${task.id}/complete`).set('Authorization', `Bearer ${token}`),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect((await prisma.task.findFirst({ where: { id: task.id } })).status).toBe('DONE');
    });
  });

  // -------------------------------------------------------------------------
  describe('Activity + follow-up Task', () => {
    test('atomic joint creation links task to contact/deal', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const { deal } = await makeLeadDeal(token, 'joint');
      const dealContact = await prisma.contact.findFirst({ where: { id: deal.contactId } });
      const res = await request(app)
        .post('/activities')
        .set('Authorization', `Bearer ${token}`)
        .send({
          ...activityBody(dealContact.id, { dealId: deal.id }),
          followUpTask: { assignedTo: userAgentA.id, title: 'Collect KYC', dueAt: isoFuture(48), relatedContactId: dealContact.id, relatedDealId: deal.id },
        });
      expect(res.status).toBe(201);
      expect(res.body.task.relatedContactId).toBe(dealContact.id);
      expect(res.body.task.relatedDealId).toBe(deal.id);
      expect(res.body.task.status).toBe('OPEN');
    });

    test('task failure rolls back the activity', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const contact = await makeContact(token, 'rollback');
      const before = await prisma.activity.count({ where: { organizationId: orgA.id } });
      const res = await request(app)
        .post('/activities')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...activityBody(contact.id), followUpTask: { assignedTo: userAdminB.id, title: 'X', dueAt: isoFuture(24) } });
      expect(res.status).toBe(403);
      expect(await prisma.activity.count({ where: { organizationId: orgA.id } })).toBe(before);
      expect(await prisma.task.count({ where: { organizationId: orgA.id } })).toBe(0);
    });

    test('inbound activity never auto-completes tasks', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const contact = await makeContact(token, 'noauto');
      const task = (await request(app).post('/tasks').set('Authorization', `Bearer ${token}`).send(taskBody(userAgentA.id, { relatedContactId: contact.id }))).body;
      await request(app).post('/activities').set('Authorization', `Bearer ${token}`).send(activityBody(contact.id, { outcome: 'CONNECTED' }));
      await request(app).post('/activities').set('Authorization', `Bearer ${token}`).send(activityBody(contact.id, { outcome: 'FOLLOW_UP_DONE' }));
      expect((await prisma.task.findFirst({ where: { id: task.id } })).status).toBe('OPEN');
      expect((await request(app).get(`/tasks/${task.id}`).set('Authorization', `Bearer ${token}`)).body.status).not.toBe('DONE');
    });

    test('idempotent retry replays without duplicating either row', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const contact = await makeContact(token, 'idem');
      const key = uid('actkey');
      const body = { ...activityBody(contact.id), followUpTask: { assignedTo: userAgentA.id, title: 'T', dueAt: isoFuture(24) } };
      const first = await request(app).post('/activities').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', key).send(body);
      expect(first.status).toBe(201);
      const replay = await request(app).post('/activities').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', key).send(body);
      expect(replay.status).toBe(200);
      expect(replay.body.activity.id).toBe(first.body.activity.id);
      expect(await prisma.activity.count({ where: { organizationId: orgA.id } })).toBe(1);
      expect(await prisma.task.count({ where: { organizationId: orgA.id } })).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('Merge reassignment + matrix', () => {
    test('merge moves activities to survivor', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const s = await makeContact(token, 'mergea');
      const d = await makeContact(token, 'merged');
      await request(app).post('/activities').set('Authorization', `Bearer ${token}`).send(activityBody(d.id));
      const mergeRes = await request(app).post(`/contacts/${d.id}/merge`).set('Authorization', `Bearer ${token}`).send({ targetId: s.id });
      expect(mergeRes.status).toBe(200);
      expect(await prisma.activity.count({ where: { contactId: d.id } })).toBe(0);
      expect(await prisma.activity.count({ where: { contactId: s.id } })).toBe(1);
    });

    test('merge moves documents to survivor with chains intact', async () => {
      const admin = await login(userAdminA.email, plainAdminA, orgA.id);
      const s = await makeContact(admin, 'mergedocA');
      const d = await makeContact(admin, 'mergedocB');
      // Document routes are seeded in the documents suite; create the row directly here.
      const groupId = `grp-${Date.now()}`;
      const v1 = await prisma.document.create({
        data: { organizationId: orgA.id, groupId, version: 1, contactId: d.id, type: 'ID_PROOF', status: 'REJECTED', storageKey: `k/${groupId}/v1` },
      });
      const mergeRes = await request(app).post(`/contacts/${d.id}/merge`).set('Authorization', `Bearer ${admin}`).send({ targetId: s.id });
      expect(mergeRes.status).toBe(200);
      const after = await prisma.document.findFirst({ where: { id: v1.id } });
      expect(after.contactId).toBe(s.id);
      expect(after.groupId).toBe(groupId);
      expect(after.version).toBe(1);
      expect(after.status).toBe('REJECTED');
    });

    test('auth matrix: 401/403 + tenant-scoped lists', async () => {
      const admin = await login(userAdminA.email, plainAdminA, orgA.id);
      const agent = await login(userAgentA.email, plainAgentA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const contact = await makeContact(admin, 'matrix');
      expect((await request(app).get('/activities')).status).toBe(401);
      const task = (await request(app).post('/tasks').set('Authorization', `Bearer ${admin}`).send(taskBody(userAgentA.id))).body;
      expect((await request(app).post(`/tasks/${task.id}/complete`).set('Authorization', `Bearer ${agent}`)).status).toBe(403);
      await request(app).post('/activities').set('Authorization', `Bearer ${admin}`).send(activityBody(contact.id));
      const listB = await request(app).get('/activities').set('Authorization', `Bearer ${tokenB}`);
      expect(listB.body).toEqual([]);
      const tasksB = await request(app).get('/tasks').set('Authorization', `Bearer ${tokenB}`);
      expect(tasksB.body).toEqual([]);
    });
  });
});
