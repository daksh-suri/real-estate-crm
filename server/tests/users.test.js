// Checkpoint 18 — organization user directory + employee provisioning.
const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/lib/prisma');
const { hashPassword } = require('../src/lib/bcrypt');

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

describe('users directory + provisioning', () => {
  let orgA, orgB, roleAdminA, roleAgentA, roleAdminB;
  let tokenA, tokenAgentA, tokenB;

  const ADMIN_PERMS = [['user', 'read'], ['user', 'create'], ['team', 'read'], ['team', 'manage_members']];
  const AGENT_PERMS = [['team', 'read']];

  async function wipeAll() {
    await prisma.refreshToken.deleteMany({});
    await prisma.idempotencyKey.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.teamMembership.deleteMany({});
    await prisma.rolePermission.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.team.deleteMany({});
    await prisma.role.deleteMany({});
    await prisma.permission.deleteMany({});
    await prisma.organization.deleteMany({});
  }

  async function grant(orgId, roleId, perms) {
    for (const [resource, action] of perms) {
      let perm = await prisma.permission.findFirst({ where: { resource, action } });
      if (!perm) perm = await prisma.permission.create({ data: { resource, action } });
      await prisma.rolePermission.create({
        data: { organizationId: orgId, roleId, permissionId: perm.id, scope: 'ORGANIZATION' },
      });
    }
  }

  async function makeUser(orgId, roleId, tag, plain, status = 'ACTIVE') {
    const user = await prisma.user.create({
      data: {
        name: tag, email: `${uid(tag)}@test.com`, organizationId: orgId, roleId,
        passwordHash: await hashPassword(plain), status,
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
    roleAdminA = await prisma.role.create({ data: { name: 'Admin', organizationId: orgA.id } });
    roleAgentA = await prisma.role.create({ data: { name: 'Agent', organizationId: orgA.id } });
    roleAdminB = await prisma.role.create({ data: { name: 'Admin', organizationId: orgB.id } });
    await grant(orgA.id, roleAdminA.id, ADMIN_PERMS);
    await grant(orgA.id, roleAgentA.id, AGENT_PERMS);
    await grant(orgB.id, roleAdminB.id, ADMIN_PERMS);
    ({ token: tokenA } = await makeUser(orgA.id, roleAdminA.id, 'AdminA', 'AdminPass123!'));
    ({ token: tokenAgentA } = await makeUser(orgA.id, roleAgentA.id, 'AgentA', 'AgentPass123!'));
    ({ token: tokenB } = await makeUser(orgB.id, roleAdminB.id, 'AdminB', 'AdminBPass123!'));
  });

  afterAll(async () => {
    await wipeAll();
    await prisma.$disconnect();
  });

  test('401 without token; 403 without the permission', async () => {
    expect((await request(app).get('/users')).status).toBe(401);
    expect((await request(app).post('/users').send({})).status).toBe(401);
    const agentList = await request(app).get('/users').set('Authorization', `Bearer ${tokenAgentA}`);
    expect(agentList.status).toBe(403);
    const agentCreate = await request(app)
      .post('/users')
      .set('Authorization', `Bearer ${tokenAgentA}`)
      .send({ name: 'X', email: 'x@t.com', password: 'Password123!', roleId: roleAgentA.id });
    expect(agentCreate.status).toBe(403);
  });

  test('directory lists org users with safe fields only', async () => {
    const res = await request(app).get('/users').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    for (const u of res.body) {
      expect(u).toMatchObject({ organizationId: orgA.id });
      expect(u.passwordHash).toBeUndefined();
      expect(u).toHaveProperty('roleName');
      expect(u).toHaveProperty('teams');
    }
    // No cross-tenant rows.
    expect(res.body.every((u) => u.organizationId === orgA.id)).toBe(true);
  });

  test('search/status/teamId filters work', async () => {
    const auth = (r) => r.set('Authorization', `Bearer ${tokenA}`);
    const team = await prisma.team.create({ data: { name: uid('T'), organizationId: orgA.id } });
    const member = await prisma.user.findFirst({ where: { organizationId: orgA.id, name: 'AgentA' } });
    await prisma.teamMembership.create({ data: { userId: member.id, teamId: team.id, organizationId: orgA.id } });

    const bySearch = await auth(request(app).get('/users?search=agenta'));
    expect(bySearch.status).toBe(200);
    expect(bySearch.body.length).toBeGreaterThanOrEqual(1);
    expect(bySearch.body.every((u) => /agenta/i.test(u.name) || /agenta/i.test(u.email))).toBe(true);

    const byStatus = await auth(request(app).get('/users?status=ACTIVE'));
    expect(byStatus.body.every((u) => u.status === 'ACTIVE')).toBe(true);

    const byTeam = await auth(request(app).get(`/users?teamId=${team.id}`));
    expect(byTeam.status).toBe(200);
    expect(byTeam.body.map((u) => u.id)).toContain(member.id);
  });

  test('directory is tenant-isolated per organization', async () => {
    const b = await request(app).get('/users').set('Authorization', `Bearer ${tokenB}`);
    expect(b.status).toBe(200);
    expect(b.body.length).toBeGreaterThanOrEqual(1);
    expect(b.body.every((u) => u.organizationId === orgB.id)).toBe(true);
  });

  test('GET /users/:id hides cross-tenant users as 404', async () => {
    const other = await prisma.user.findFirst({ where: { organizationId: orgB.id } });
    const res = await request(app).get(`/users/${other.id}`).set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(404);
    const own = await prisma.user.findFirst({ where: { organizationId: orgA.id } });
    const ok = await request(app).get(`/users/${own.id}`).set('Authorization', `Bearer ${tokenA}`);
    expect(ok.status).toBe(200);
    expect(ok.body.passwordHash).toBeUndefined();
  });

  test('POST /users provisions an employee who can log in', async () => {
    const email = `${uid('emp')}@test.com`;
    const res = await request(app)
      .post('/users')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'New Employee', email, password: 'Employee123!', roleId: roleAgentA.id });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'New Employee', email, status: 'ACTIVE', roleName: 'Agent' });
    expect(res.body.passwordHash).toBeUndefined();

    // Credential flow works end to end.
    const login = await request(app).post('/auth/login').send({ email, password: 'Employee123!', organizationId: orgA.id });
    expect(login.status).toBe(200);
    expect(login.body.accessToken).toBeTruthy();
  });

  test('duplicate email conflicts; validation rejects bad input', async () => {
    const auth = (r) => r.set('Authorization', `Bearer ${tokenA}`);
    const email = `${uid('dup')}@test.com`.toLowerCase();
    const created = await auth(request(app).post('/users')).send({
      name: 'Dup', email, password: 'Password123!', roleId: roleAgentA.id,
    });
    expect(created.status).toBe(201);
    const dup = await auth(request(app).post('/users')).send({
      name: 'Dup Again', email, password: 'Password123!', roleId: roleAgentA.id,
    });
    expect(dup.status).toBe(409);

    const badEmail = await auth(request(app).post('/users')).send({
      name: 'Bad', email: 'not-an-email', password: 'Password123!', roleId: roleAgentA.id,
    });
    expect(badEmail.status).toBe(400);

    const shortPw = await auth(request(app).post('/users')).send({
      name: 'Short', email: `${uid('s')}@test.com`, password: 'short', roleId: roleAgentA.id,
    });
    expect(shortPw.status).toBe(400);
  });

  test('cross-tenant role is rejected; unknown role is 404', async () => {
    const auth = (r) => r.set('Authorization', `Bearer ${tokenA}`);
    const foreign = await auth(request(app).post('/users')).send({
      name: 'Foreign', email: `${uid('f')}@test.com`, password: 'Password123!', roleId: roleAdminB.id,
    });
    expect(foreign.status).toBe(403);
    const missing = await auth(request(app).post('/users')).send({
      name: 'Missing', email: `${uid('m')}@test.com`, password: 'Password123!', roleId: '00000000-0000-4000-8000-000000000000',
    });
    expect(missing.status).toBe(404);
  });
});
