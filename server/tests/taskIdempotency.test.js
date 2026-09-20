// Standalone POST /tasks idempotency (hardening pass): TASK_CREATE reuses the
// shared idempotentCreate mechanism — same key + same payload replays,
// same key + different payload conflicts, concurrent duplicates converge.
const request = require('supertest');
const crypto = require('crypto');
const app = require('../src/app');
const { prisma } = require('../src/lib/prisma');
const { hashPassword } = require('../src/lib/bcrypt');

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

describe('POST /tasks idempotency (TASK_CREATE)', () => {
  let org, token, assigneeId;

  async function wipeAll() {
    await prisma.refreshToken.deleteMany({});
    await prisma.idempotencyKey.deleteMany({});
    await prisma.task.deleteMany({});
    await prisma.teamMembership.deleteMany({});
    await prisma.rolePermission.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.team.deleteMany({});
    await prisma.role.deleteMany({});
    await prisma.permission.deleteMany({});
    await prisma.organization.deleteMany({});
  }

  function taskBody(title = 'Call back tomorrow') {
    return {
      assignedTo: assigneeId,
      title,
      dueAt: new Date(Date.now() + 86400000).toISOString(),
    };
  }

  function postTask(body, key) {
    const req = request(app).post('/tasks').set('Authorization', `Bearer ${token}`);
    if (key) req.set('Idempotency-Key', key);
    return req.send(body);
  }

  beforeAll(async () => {
    await wipeAll();
    org = await prisma.organization.create({ data: { name: uid('OrgTask') } });
    const role = await prisma.role.create({ data: { name: 'Admin', organizationId: org.id } });
    for (const [resource, action] of [['task', 'create'], ['task', 'read']]) {
      let perm = await prisma.permission.findFirst({ where: { resource, action } });
      if (!perm) perm = await prisma.permission.create({ data: { resource, action } });
      await prisma.rolePermission.create({
        data: { organizationId: org.id, roleId: role.id, permissionId: perm.id, scope: 'ORGANIZATION' },
      });
    }
    const admin = await prisma.user.create({
      data: {
        name: 'AdminTask',
        email: `${uid('task-admin')}@test.com`,
        organizationId: org.id,
        roleId: role.id,
        passwordHash: await hashPassword('AdminPass123!'),
        status: 'ACTIVE',
      },
    });
    assigneeId = admin.id;
    const login = await request(app)
      .post('/auth/login')
      .send({ email: admin.email, password: 'AdminPass123!', organizationId: org.id });
    expect(login.status).toBe(200);
    token = login.body.accessToken;
  });

  afterAll(async () => {
    await wipeAll();
    await prisma.$disconnect();
  });

  test('same key + same payload replays the stored task', async () => {
    const key = crypto.randomUUID();
    const body = taskBody();
    const first = await postTask(body, key);
    expect(first.status).toBe(201);
    const second = await postTask(body, key);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(await prisma.task.count({ where: { organizationId: org.id } })).toBe(1);
  });

  test('same key + different payload is a conflict', async () => {
    const key = crypto.randomUUID();
    const first = await postTask(taskBody('First title'), key);
    expect(first.status).toBe(201);
    const second = await postTask(taskBody('Different title'), key);
    expect(second.status).toBe(409);
  });

  test('concurrent duplicate creates converge to a single task', async () => {
    const key = crypto.randomUUID();
    const body = taskBody('Race task');
    const before = await prisma.task.count({ where: { organizationId: org.id } });
    const [a, b] = await Promise.all([postTask(body, key), postTask(body, key)]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    const winner = a.status === 201 ? a : b;
    const loser = a.status === 200 ? a : b;
    expect(loser.body.id).toBe(winner.body.id);
    expect(await prisma.task.count({ where: { organizationId: org.id } })).toBe(before + 1);
  });

  test('keyless requests are not deduplicated (no identity, no replay)', async () => {
    const before = await prisma.task.count({ where: { organizationId: org.id } });
    const body = taskBody('Keyless task');
    const a = await postTask(body, null);
    const b = await postTask(body, null);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.id).not.toBe(a.body.id);
    expect(await prisma.task.count({ where: { organizationId: org.id } })).toBe(before + 2);
  });
});
