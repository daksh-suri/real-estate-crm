const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/lib/prisma');
const { hashPassword } = require('../src/lib/bcrypt');

function uid(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`; }

describe('roles write — create + permission assignment', () => {
  let orgA, orgB, roleAdminA, roleAgentA, tokenAdminA, tokenAgentA, tokenAdminB;
  let permLeadRead, permLeadCreate;

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

  async function grant(orgId, roleId, perms, scope='ORGANIZATION') {
    for (const [resource, action] of perms) {
      let perm = await prisma.permission.findFirst({ where: { resource, action } });
      if (!perm) perm = await prisma.permission.create({ data: { resource, action } });
      await prisma.rolePermission.create({ data: { organizationId: orgId, roleId, permissionId: perm.id, scope } });
    }
  }

  async function makeUser(orgId, roleId, tag, plain) {
    const user = await prisma.user.create({
      data: { name: tag, email: `${uid(tag)}@test.com`, organizationId: orgId, roleId, passwordHash: await hashPassword(plain), status: 'ACTIVE' },
    });
    const res = await request(app).post('/auth/login').send({ email: user.email, password: plain });
    expect(res.status).toBe(200);
    return { user, token: res.body.accessToken };
  }

  beforeAll(async () => {
    await wipeAll();
    orgA = await prisma.organization.create({ data: { name: uid('OrgA') } });
    orgB = await prisma.organization.create({ data: { name: uid('OrgB') } });
    roleAdminA = await prisma.role.create({ data: { name: 'Admin', organizationId: orgA.id } });
    roleAgentA = await prisma.role.create({ data: { name: 'Agent', organizationId: orgA.id } });
    const roleAdminB = await prisma.role.create({ data: { name: 'Admin', organizationId: orgB.id } });
    permLeadRead = await prisma.permission.upsert({ where: { resource_action: { resource: 'lead', action: 'read' } }, update: {}, create: { resource: 'lead', action: 'read' } });
    permLeadCreate = await prisma.permission.upsert({ where: { resource_action: { resource: 'lead', action: 'create' } }, update: {}, create: { resource: 'lead', action: 'create' } });
    await prisma.permission.upsert({ where: { resource_action: { resource: 'role', action: 'read' } }, update: {}, create: { resource: 'role', action: 'read' } });
    await prisma.permission.upsert({ where: { resource_action: { resource: 'role', action: 'create' } }, update: {}, create: { resource: 'role', action: 'create' } });
    await prisma.permission.upsert({ where: { resource_action: { resource: 'role', action: 'update' } }, update: {}, create: { resource: 'role', action: 'update' } });
    await grant(orgA.id, roleAdminA.id, [['role','read'],['role','create'],['role','update'],['lead','read'],['lead','create'],['user','create'],['user','read']]);
    await grant(orgA.id, roleAgentA.id, [['lead','read']], 'OWN');
    await grant(roleAdminB.organizationId || orgB.id, roleAdminB.id, [['role','read'],['role','create'],['role','update']]);
    const a = await makeUser(orgA.id, roleAdminA.id, 'AdminA', 'AdminPass123!');
    tokenAdminA = a.token;
    const ag = await makeUser(orgA.id, roleAgentA.id, 'AgentA', 'AgentPass123!');
    tokenAgentA = ag.token;
    const b = await makeUser(orgB.id, roleAdminB.id, 'AdminB', 'AdminBPass123!');
    tokenAdminB = b.token;
  });

  afterAll(async () => { await wipeAll(); await prisma.$disconnect(); });

  test('1. Admin can create a role', async () => {
    const res = await request(app).post('/roles').set('Authorization', `Bearer ${tokenAdminA}`).send({ name: 'Sales Agent', permissions: [{ permissionId: permLeadRead.id, scope: 'OWN' }] });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Sales Agent');
    expect(res.body.permissions).toEqual([{ permissionId: permLeadRead.id, resource: 'lead', action: 'read', scope: 'OWN' }]);
  });

  test('2. Non-authorized user cannot create a role (403)', async () => {
    const res = await request(app).post('/roles').set('Authorization', `Bearer ${tokenAgentA}`).send({ name: 'Nope' });
    expect(res.status).toBe(403);
  });

  test('3. Role belongs to authenticated organization', async () => {
    const name = uid('Sales');
    const res = await request(app).post('/roles').set('Authorization', `Bearer ${tokenAdminA}`).send({ name });
    expect(res.status).toBe(201);
    const row = await prisma.role.findUnique({ where: { id: res.body.id } });
    expect(row.organizationId).toBe(orgA.id);
  });

  test('4. Duplicate role name in same organization returns 409', async () => {
    const name = uid('Dup');
    const r1 = await request(app).post('/roles').set('Authorization', `Bearer ${tokenAdminA}`).send({ name });
    expect(r1.status).toBe(201);
    const r2 = await request(app).post('/roles').set('Authorization', `Bearer ${tokenAdminA}`).send({ name });
    expect(r2.status).toBe(409);
  });

  test('5. Same role name in different organizations is allowed', async () => {
    const name = uid('Shared');
    const rA = await request(app).post('/roles').set('Authorization', `Bearer ${tokenAdminA}`).send({ name });
    expect(rA.status).toBe(201);
    const rB = await request(app).post('/roles').set('Authorization', `Bearer ${tokenAdminB}`).send({ name });
    expect(rB.status).toBe(201);
  });

  test('6. Valid permissions are assigned', async () => {
    const name = uid('PermOk');
    const res = await request(app).post('/roles').set('Authorization', `Bearer ${tokenAdminA}`).send({ name, permissions: [{ permissionId: permLeadRead.id, scope: 'TEAM' }, { permissionId: permLeadCreate.id, scope: 'ORGANIZATION' }] });
    expect(res.status).toBe(201);
    expect(res.body.permissions).toHaveLength(2);
  });

  test('7. Invalid permission ID is rejected 400', async () => {
    const res = await request(app).post('/roles').set('Authorization', `Bearer ${tokenAdminA}`).send({ name: uid('BadPerm'), permissions: [{ permissionId: '00000000-0000-4000-a000-000000000000', scope: 'OWN' }] });
    expect(res.status).toBe(400);
  });

  test('8. Invalid scope is rejected 400', async () => {
    const res = await request(app).post('/roles').set('Authorization', `Bearer ${tokenAdminA}`).send({ name: uid('BadScope'), permissions: [{ permissionId: permLeadRead.id, scope: 'INVALID' }] });
    expect(res.status).toBe(400);
  });

  test('9. Role + permissions are atomic — failed permission leaves no role', async () => {
    const name = uid('Atomic');
    const res = await request(app).post('/roles').set('Authorization', `Bearer ${tokenAdminA}`).send({ name, permissions: [{ permissionId: '00000000-0000-4000-a000-000000000000', scope: 'OWN' }] });
    expect(res.status).toBe(400);
    const row = await prisma.role.findFirst({ where: { organizationId: orgA.id, name } });
    expect(row).toBeNull();
  });

  test('10. Concurrent duplicate role creation — one wins, one 409', async () => {
    const name = uid('Conc');
    const [r1, r2] = await Promise.all([
      request(app).post('/roles').set('Authorization', `Bearer ${tokenAdminA}`).send({ name }),
      request(app).post('/roles').set('Authorization', `Bearer ${tokenAdminA}`).send({ name }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);
  });

  test('11. Organization A cannot access Organization B role via PUT', async () => {
    // Create role in B
    const bRole = await request(app).post('/roles').set('Authorization', `Bearer ${tokenAdminB}`).send({ name: uid('BRole') });
    expect(bRole.status).toBe(201);
    const res = await request(app).put(`/roles/${bRole.body.id}/permissions`).set('Authorization', `Bearer ${tokenAdminA}`).send({ permissions: [] });
    expect(res.status).toBe(404);
  });

  test('12. PUT replace is atomic and tenant-isolated', async () => {
    const created = await request(app).post('/roles').set('Authorization', `Bearer ${tokenAdminA}`).send({ name: uid('Edit'), permissions: [{ permissionId: permLeadRead.id, scope: 'OWN' }] });
    expect(created.status).toBe(201);
    const bad = await request(app).put(`/roles/${created.body.id}/permissions`).set('Authorization', `Bearer ${tokenAdminA}`).send({ permissions: [{ permissionId: '00000000-0000-4000-a000-000000000000', scope: 'OWN' }] });
    expect(bad.status).toBe(400);
    // Verify original permission still there
    const list = await request(app).get('/roles').set('Authorization', `Bearer ${tokenAdminA}`);
    const found = list.body.find((r) => r.id === created.body.id);
    expect(found.permissions).toHaveLength(1);
  });

  test('13. Newly created role resolves its permissions through authorization', async () => {
    const created = await request(app).post('/roles').set('Authorization', `Bearer ${tokenAdminA}`).send({ name: uid('AuthRes'), permissions: [{ permissionId: permLeadRead.id, scope: 'ORGANIZATION' }] });
    expect(created.status).toBe(201);
    // Assign to a new user and verify the permission resolves via guard
    const email = uid('roleauth') + '@test.com';
    const user = await prisma.user.create({ data: { name: 'RoleAuth', email, organizationId: orgA.id, roleId: created.body.id, passwordHash: await hashPassword('Pass123!'), status: 'ACTIVE' } });
    const login = await request(app).post('/auth/login').send({ email, password: 'Pass123!' });
    expect(login.status).toBe(200);
    // Should have lead:read (granted) but not role:read
    const ok = await request(app).get('/leads').set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(ok.status).toBe(200);
    const forbidden = await request(app).get('/roles').set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(forbidden.status).toBe(403);
  });

  test('14. New role can be assigned to a user via existing user API', async () => {
    const role = await request(app).post('/roles').set('Authorization', `Bearer ${tokenAdminA}`).send({ name: uid('Assign'), permissions: [] });
    expect(role.status).toBe(201);
    const email = uid('assign') + '@test.com';
    const res = await request(app).post('/users').set('Authorization', `Bearer ${tokenAdminA}`).send({ name: 'Assign', email, password: 'Pass123!', roleId: role.body.id });
    expect(res.status).toBe(201);
    expect(res.body.roleName).toBe(role.body.name);
  });

  test('15. Admin retains its permissions after another role is created', async () => {
    const before = await request(app).get('/roles').set('Authorization', `Bearer ${tokenAdminA}`);
    const adminBefore = before.body.find((r) => r.name === 'Admin');
    const countBefore = adminBefore.permissions.length;
    await request(app).post('/roles').set('Authorization', `Bearer ${tokenAdminA}`).send({ name: uid('Other') });
    const after = await request(app).get('/roles').set('Authorization', `Bearer ${tokenAdminA}`);
    const adminAfter = after.body.find((r) => r.name === 'Admin');
    expect(adminAfter.permissions.length).toBe(countBefore);
  });

  test('Duplicate permission+scope in one request is 400', async () => {
    const res = await request(app).post('/roles').set('Authorization', `Bearer ${tokenAdminA}`).send({ name: uid('DupPerm'), permissions: [{ permissionId: permLeadRead.id, scope: 'OWN' }, { permissionId: permLeadRead.id, scope: 'OWN' }] });
    expect(res.status).toBe(400);
  });
});
