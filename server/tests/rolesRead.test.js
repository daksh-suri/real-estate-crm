// Checkpoint 18 — read-only Role → Permission → Data Scope matrix.
const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/lib/prisma');
const { hashPassword } = require('../src/lib/bcrypt');

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

describe('roles read-only matrix', () => {
  let orgA, orgB, tokenA, tokenAgentA, tokenB;

  async function wipeAll() {
    await prisma.refreshToken.deleteMany({});
    await prisma.teamMembership.deleteMany({});
    await prisma.rolePermission.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.team.deleteMany({});
    await prisma.role.deleteMany({});
    await prisma.permission.deleteMany({});
    await prisma.organization.deleteMany({});
  }

  async function grant(orgId, roleId, perms, scope = 'ORGANIZATION') {
    for (const [resource, action] of perms) {
      let perm = await prisma.permission.findFirst({ where: { resource, action } });
      if (!perm) perm = await prisma.permission.create({ data: { resource, action } });
      await prisma.rolePermission.create({
        data: { organizationId: orgId, roleId, permissionId: perm.id, scope },
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
    const res = await request(app).post('/auth/login').send({ email: user.email, password: plain });
    expect(res.status).toBe(200);
    return res.body.accessToken;
  }

  beforeAll(async () => {
    await wipeAll();
    orgA = await prisma.organization.create({ data: { name: uid('OrgA') } });
    orgB = await prisma.organization.create({ data: { name: uid('OrgB') } });
    const roleAdminA = await prisma.role.create({ data: { name: 'Admin', organizationId: orgA.id } });
    const roleAgentA = await prisma.role.create({ data: { name: 'Agent', organizationId: orgA.id } });
    const roleAdminB = await prisma.role.create({ data: { name: 'Admin', organizationId: orgB.id } });
    await grant(orgA.id, roleAdminA.id, [['role', 'read'], ['lead', 'read']]);
    await grant(orgA.id, roleAgentA.id, [['lead', 'read']], 'OWN');
    await grant(orgB.id, roleAdminB.id, [['role', 'read']]);
    tokenA = await makeUser(orgA.id, roleAdminA.id, 'AdminA', 'AdminPass123!');
    tokenAgentA = await makeUser(orgA.id, roleAgentA.id, 'AgentA', 'AgentPass123!');
    tokenB = await makeUser(orgB.id, roleAdminB.id, 'AdminB', 'AdminBPass123!');
  });

  afterAll(async () => {
    await wipeAll();
    await prisma.$disconnect();
  });

  test('401 without token; 403 without role:read', async () => {
    expect((await request(app).get('/roles')).status).toBe(401);
    expect((await request(app).get('/roles/permissions/catalogue')).status).toBe(401);
    expect((await request(app).get('/roles').set('Authorization', `Bearer ${tokenAgentA}`)).status).toBe(403);
  });

  test('GET /roles returns org roles with permission+scope mapping', async () => {
    const res = await request(app).get('/roles').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    const names = res.body.map((r) => r.name).sort();
    expect(names).toEqual(['Admin', 'Agent']);
    const admin = res.body.find((r) => r.name === 'Admin');
    expect(admin.permissions).toEqual(expect.arrayContaining([expect.objectContaining({ resource: 'role', action: 'read', scope: 'ORGANIZATION' })]));
    const agent = res.body.find((r) => r.name === 'Agent');
    expect(agent.permissions).toEqual(expect.arrayContaining([expect.objectContaining({ resource: 'lead', action: 'read', scope: 'OWN' })]));
    // No cross-tenant roles leak.
    expect(res.body.every((r) => r.id)).toBe(true);
  });

  test('roles are tenant-isolated', async () => {
    const b = await request(app).get('/roles').set('Authorization', `Bearer ${tokenB}`);
    expect(b.status).toBe(200);
    expect(b.body.map((r) => r.name)).toEqual(['Admin']);
  });

  test('GET /roles/permissions/catalogue returns the global catalogue ordered', async () => {
    const res = await request(app).get('/roles/permissions/catalogue').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body).toEqual(expect.arrayContaining([expect.objectContaining({ resource: 'lead', action: 'read' })]));
    const keys = res.body.map((p) => `${p.resource}:${p.action}`);
    expect([...keys].sort()).toEqual(keys);
    expect(res.body.every((p) => p.id)).toBe(true);
  });
});
