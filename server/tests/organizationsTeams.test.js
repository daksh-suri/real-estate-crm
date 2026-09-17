const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/lib/prisma');
const { hashPassword } = require('../src/lib/bcrypt');
const { createTenantPrisma } = require('../src/lib/tenant');

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

describe('Checkpoint 4 — Organizations & Teams', () => {
  let orgA;
  let orgB;
  let roleAdminA;
  let roleAgentA;
  let roleAdminB;
  let permOrgRead;
  let permOrgUpdate;
  let permTeamCreate;
  let permTeamRead;
  let permTeamUpdate;
  let permTeamDelete;
  let permTeamManageMembers;
  let userAdminA;
  let userAgentA;
  let userAdminB;
  let plainAdminA = 'AdminPass123!';
  let plainAgentA = 'AgentPass123!';
  let plainAdminB = 'AdminBPass123!';

  beforeAll(async () => {
    await prisma.refreshToken.deleteMany({});
    await prisma.teamMembership.deleteMany({});
    await prisma.rolePermission.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.team.deleteMany({});
    await prisma.role.deleteMany({});
    await prisma.permission.deleteMany({});
    await prisma.organization.deleteMany({});

    orgA = await prisma.organization.create({ data: { name: uid('OrgA') } });
    orgB = await prisma.organization.create({ data: { name: uid('OrgB') } });

    // Permissions for org/team
    permOrgRead = await prisma.permission.create({ data: { resource: 'organization', action: 'read' } });
    permOrgUpdate = await prisma.permission.create({ data: { resource: 'organization', action: 'update' } });
    permTeamCreate = await prisma.permission.create({ data: { resource: 'team', action: 'create' } });
    permTeamRead = await prisma.permission.create({ data: { resource: 'team', action: 'read' } });
    permTeamUpdate = await prisma.permission.create({ data: { resource: 'team', action: 'update' } });
    permTeamDelete = await prisma.permission.create({ data: { resource: 'team', action: 'delete' } });
    permTeamManageMembers = await prisma.permission.create({ data: { resource: 'team', action: 'manage_members' } });

    // Roles — 5 fixed, we create Admin and Agent for test
    roleAdminA = await prisma.role.create({ data: { name: 'Admin', organizationId: orgA.id } });
    roleAgentA = await prisma.role.create({ data: { name: 'Agent', organizationId: orgA.id } });
    roleAdminB = await prisma.role.create({ data: { name: 'Admin', organizationId: orgB.id } });

    // AdminA has all perms ORGANIZATION scope
    for (const perm of [permOrgRead, permOrgUpdate, permTeamCreate, permTeamRead, permTeamUpdate, permTeamDelete, permTeamManageMembers]) {
      await prisma.rolePermission.create({ data: { organizationId: orgA.id, roleId: roleAdminA.id, permissionId: perm.id, scope: 'ORGANIZATION' } });
    }
    // AgentA only team:read
    await prisma.rolePermission.create({ data: { organizationId: orgA.id, roleId: roleAgentA.id, permissionId: permTeamRead.id, scope: 'ORGANIZATION' } });
    // AdminB has all for orgB
    for (const perm of [permOrgRead, permOrgUpdate, permTeamCreate, permTeamRead, permTeamUpdate, permTeamDelete, permTeamManageMembers]) {
      await prisma.rolePermission.create({ data: { organizationId: orgB.id, roleId: roleAdminB.id, permissionId: perm.id, scope: 'ORGANIZATION' } });
    }

    userAdminA = await prisma.user.create({
      data: {
        name: 'AdminA',
        email: uid('adminA') + '@test.com',
        organizationId: orgA.id,
        roleId: roleAdminA.id,
        passwordHash: await hashPassword(plainAdminA),
        status: 'ACTIVE',
      },
    });
    userAgentA = await prisma.user.create({
      data: {
        name: 'AgentA',
        email: uid('agentA') + '@test.com',
        organizationId: orgA.id,
        roleId: roleAgentA.id,
        passwordHash: await hashPassword(plainAgentA),
        status: 'ACTIVE',
      },
    });
    userAdminB = await prisma.user.create({
      data: {
        name: 'AdminB',
        email: uid('adminB') + '@test.com',
        organizationId: orgB.id,
        roleId: roleAdminB.id,
        passwordHash: await hashPassword(plainAdminB),
        status: 'ACTIVE',
      },
    });
  });

  afterAll(async () => {
    await prisma.refreshToken.deleteMany({});
    await prisma.teamMembership.deleteMany({});
    await prisma.rolePermission.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.team.deleteMany({});
    await prisma.role.deleteMany({});
    await prisma.permission.deleteMany({});
    await prisma.organization.deleteMany({});
    await prisma.$disconnect();
  });

  afterEach(async () => {
    // Clean teams and memberships but keep orgs/users/roles/perms
    await prisma.teamMembership.deleteMany({});
    await prisma.team.deleteMany({});
    // Reset user statuses
    await prisma.user.updateMany({ where: { id: { in: [userAdminA.id, userAgentA.id, userAdminB.id] } }, data: { status: 'ACTIVE', deletedAt: null, deactivatedAt: null } });
    // Remove extra users created in tests (keep base 3)
    const keepIds = [userAdminA.id, userAgentA.id, userAdminB.id];
    await prisma.user.deleteMany({ where: { id: { notIn: keepIds } } });
    await prisma.refreshToken.deleteMany({});
  });

  async function login(email, password, organizationId) {
    const res = await request(app).post('/auth/login').send({ email, password, organizationId });
    expect(res.status).toBe(200);
    return res.body.accessToken;
  }

  // 1. Organization access is tenant-safe
  describe('1. Organization access is tenant-safe', () => {
    test('GET /organizations/me returns current org and not others', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const resA = await request(app).get('/organizations/me').set('Authorization', `Bearer ${tokenA}`);
      expect(resA.status).toBe(200);
      expect(resA.body.id).toBe(orgA.id);
      expect(resA.body.name).toBe(orgA.name);

      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const resB = await request(app).get('/organizations/me').set('Authorization', `Bearer ${tokenB}`);
      expect(resB.body.id).toBe(orgB.id);
    });

    test('GET /organizations/:id with cross-tenant id fails', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const res = await request(app).get(`/organizations/${orgB.id}`).set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(403);
    });

    test('PATCH /organizations/me updates own org and is tenant isolated', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const newName = uid('NewOrgA');
      const res = await request(app).patch('/organizations/me').set('Authorization', `Bearer ${tokenA}`).send({ name: newName });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe(newName);
      // Verify B not affected
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const meB = await request(app).get('/organizations/me').set('Authorization', `Bearer ${tokenB}`);
      expect(meB.body.name).not.toBe(newName);
      // Restore
      await prisma.organization.update({ where: { id: orgA.id }, data: { name: orgA.name } });
      orgA.name = (await prisma.organization.findUnique({ where: { id: orgA.id } })).name;
    });

    test('PATCH other org via /organizations/me cannot affect other tenant (no orgId in body trusted)', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      // Try to send organizationId in body to hijack — should be ignored, still updates own
      const res = await request(app).patch('/organizations/me').set('Authorization', `Bearer ${tokenA}`).send({ name: uid('Hack'), organizationId: orgB.id });
      // Our service ignores organizationId in body, only uses auth context, so it still updates orgA
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(orgA.id);
      // Verify orgB unchanged
      const orgBAfter = await prisma.organization.findUnique({ where: { id: orgB.id } });
      expect(orgBAfter.name).toBe(orgB.name);
      // Restore
      await prisma.organization.update({ where: { id: orgA.id }, data: { name: orgA.name } });
    });
  });

  // 2. Team creation
  describe('2. Team creation within an organization succeeds', () => {
    test('Admin can create team', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const res = await request(app).post('/teams').set('Authorization', `Bearer ${token}`).send({ name: uid('TeamA') });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.organizationId).toBe(orgA.id);
      expect(res.body.name).toBeDefined();
    });

    test('Team name unique per organization, not globally', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const name = uid('SharedTeam');
      const resA = await request(app).post('/teams').set('Authorization', `Bearer ${tokenA}`).send({ name });
      expect(resA.status).toBe(201);
      const resB = await request(app).post('/teams').set('Authorization', `Bearer ${tokenB}`).send({ name });
      expect(resB.status).toBe(201);
      expect(resA.body.id).not.toBe(resB.body.id);
    });

    test('Duplicate team name in same org fails 409', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const name = uid('DupTeam');
      const r1 = await request(app).post('/teams').set('Authorization', `Bearer ${token}`).send({ name });
      expect(r1.status).toBe(201);
      const r2 = await request(app).post('/teams').set('Authorization', `Bearer ${token}`).send({ name });
      expect(r2.status).toBe(409);
    });
  });

  // 3. Team listing tenant-safe
  describe('3. Team listing returns only current-organization teams', () => {
    test('list returns only own org teams', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const tA1 = await request(app).post('/teams').set('Authorization', `Bearer ${tokenA}`).send({ name: uid('TeamA1') });
      const tA2 = await request(app).post('/teams').set('Authorization', `Bearer ${tokenA}`).send({ name: uid('TeamA2') });
      const tB1 = await request(app).post('/teams').set('Authorization', `Bearer ${tokenB}`).send({ name: uid('TeamB1') });
      expect(tA1.status).toBe(201);
      expect(tA2.status).toBe(201);
      expect(tB1.status).toBe(201);

      const listA = await request(app).get('/teams').set('Authorization', `Bearer ${tokenA}`);
      expect(listA.status).toBe(200);
      expect(listA.body.length).toBe(2);
      expect(listA.body.every((t) => t.organizationId === orgA.id)).toBe(true);

      const listB = await request(app).get('/teams').set('Authorization', `Bearer ${tokenB}`);
      expect(listB.body.length).toBe(1);
      expect(listB.body[0].organizationId).toBe(orgB.id);
    });

    test('soft-deleted team not returned in list', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const created = await request(app).post('/teams').set('Authorization', `Bearer ${token}`).send({ name: uid('ToDelete') });
      expect(created.status).toBe(201);
      const del = await request(app).delete(`/teams/${created.body.id}`).set('Authorization', `Bearer ${token}`);
      expect(del.status).toBe(200);
      expect(del.body.deletedAt).not.toBeNull();
      const list = await request(app).get('/teams').set('Authorization', `Bearer ${token}`);
      expect(list.body.find((t) => t.id === created.body.id)).toBeUndefined();
      // But raw DB still has it with deletedAt
      const raw = await prisma.team.findFirst({ where: { id: created.body.id } });
      expect(raw.deletedAt).not.toBeNull();
    });
  });

  // 4. Cross-tenant team access fails
  describe('4. Cross-tenant team access fails', () => {
    test('GET /teams/:teamId cross-tenant returns 404', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const teamA = await request(app).post('/teams').set('Authorization', `Bearer ${tokenA}`).send({ name: uid('TeamA') });
      const getByB = await request(app).get(`/teams/${teamA.body.id}`).set('Authorization', `Bearer ${tokenB}`);
      expect(getByB.status).toBe(404);
    });
  });

  // 5. Team update tenant boundaries
  describe('5. Team update cannot cross tenant boundaries', () => {
    test('PATCH cross-tenant returns 404', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const teamA = await request(app).post('/teams').set('Authorization', `Bearer ${tokenA}`).send({ name: uid('TeamA') });
      const upd = await request(app).patch(`/teams/${teamA.body.id}`).set('Authorization', `Bearer ${tokenB}`).send({ name: 'Hacked' });
      expect(upd.status).toBe(404);
      // Verify not changed via tenant A
      const getA = await request(app).get(`/teams/${teamA.body.id}`).set('Authorization', `Bearer ${tokenA}`);
      expect(getA.body.name).not.toBe('Hacked');
    });

    test('PATCH with duplicate name in same org fails 409', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const t1 = await request(app).post('/teams').set('Authorization', `Bearer ${token}`).send({ name: uid('Team1') });
      const t2 = await request(app).post('/teams').set('Authorization', `Bearer ${token}`).send({ name: uid('Team2') });
      const upd = await request(app).patch(`/teams/${t2.body.id}`).set('Authorization', `Bearer ${token}`).send({ name: t1.body.name });
      expect(upd.status).toBe(409);
    });
  });

  // 6. Add member same org
  describe('6. User can be added to a team in the same organization', () => {
    test('add member succeeds', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const team = await request(app).post('/teams').set('Authorization', `Bearer ${token}`).send({ name: uid('TeamAdd') });
      const newUser = await prisma.user.create({
        data: {
          name: 'Member',
          email: uid('member') + '@test.com',
          organizationId: orgA.id,
          roleId: roleAgentA.id,
          passwordHash: await hashPassword('Pass123!'),
          status: 'ACTIVE',
        },
      });
      const res = await request(app).post(`/teams/${team.body.id}/members`).set('Authorization', `Bearer ${token}`).send({ userId: newUser.id });
      expect(res.status).toBe(201);
      expect(res.body.userId).toBe(newUser.id);
      expect(res.body.teamId).toBe(team.body.id);
      expect(res.body.organizationId).toBe(orgA.id);
    });
  });

  // 7. Cross-tenant membership fails
  describe('7. Cross-tenant membership creation fails', () => {
    test('add user from orgB to team in orgA fails', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const teamA = await request(app).post('/teams').set('Authorization', `Bearer ${tokenA}`).send({ name: uid('TeamA') });
      const res = await request(app).post(`/teams/${teamA.body.id}/members`).set('Authorization', `Bearer ${tokenA}`).send({ userId: userAdminB.id });
      expect(res.status).toBe(404); // user not found in tenant
    });

    test('add user from orgA to team in orgB fails', async () => {
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const teamB = await request(app).post('/teams').set('Authorization', `Bearer ${tokenB}`).send({ name: uid('TeamB') });
      const res = await request(app).post(`/teams/${teamB.body.id}/members`).set('Authorization', `Bearer ${tokenB}`).send({ userId: userAdminA.id });
      expect(res.status).toBe(404);
    });

    test('direct DB cross-tenant via tenant wrapper fails', async () => {
      const tenantA = createTenantPrisma(orgA.id);
      const teamA = await tenantA.team.create({ data: { name: uid('TeamA') } });
      await expect(tenantA.teamMembership.create({ data: { userId: userAdminB.id, teamId: teamA.id } })).rejects.toThrow();
    });
  });

  // 8. Duplicate membership prevented
  describe('8. Duplicate team membership is prevented', () => {
    test('second add same user to same team returns 409', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const team = await request(app).post('/teams').set('Authorization', `Bearer ${token}`).send({ name: uid('TeamDup') });
      const user = await prisma.user.create({
        data: {
          name: 'Dup',
          email: uid('dup') + '@test.com',
          organizationId: orgA.id,
          roleId: roleAgentA.id,
          passwordHash: await hashPassword('Pass123!'),
        },
      });
      const r1 = await request(app).post(`/teams/${team.body.id}/members`).set('Authorization', `Bearer ${token}`).send({ userId: user.id });
      expect(r1.status).toBe(201);
      const r2 = await request(app).post(`/teams/${team.body.id}/members`).set('Authorization', `Bearer ${token}`).send({ userId: user.id });
      expect(r2.status).toBe(409);
      expect(r2.body.error.message).toMatch(/already a member/i);
    });

    test('concurrent duplicate membership: exactly one succeeds', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const team = await request(app).post('/teams').set('Authorization', `Bearer ${token}`).send({ name: uid('TeamConc') });
      const user = await prisma.user.create({
        data: {
          name: 'Conc',
          email: uid('conc') + '@test.com',
          organizationId: orgA.id,
          roleId: roleAgentA.id,
          passwordHash: await hashPassword('Pass123!'),
        },
      });
      const p1 = request(app).post(`/teams/${team.body.id}/members`).set('Authorization', `Bearer ${token}`).send({ userId: user.id });
      const p2 = request(app).post(`/teams/${team.body.id}/members`).set('Authorization', `Bearer ${token}`).send({ userId: user.id });
      const [r1, r2] = await Promise.all([p1, p2]);
      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual([201, 409]);
      // Verify only one membership in DB
      const count = await prisma.teamMembership.count({ where: { teamId: team.body.id, userId: user.id } });
      expect(count).toBe(1);
    });
  });

  // 9. Deactivated user cannot be added
  describe('9. Deactivated user cannot receive a new team assignment', () => {
    test('deactivated user add fails 403', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const team = await request(app).post('/teams').set('Authorization', `Bearer ${token}`).send({ name: uid('TeamDeact') });
      const deactUser = await prisma.user.create({
        data: {
          name: 'Deact',
          email: uid('deact') + '@test.com',
          organizationId: orgA.id,
          roleId: roleAgentA.id,
          passwordHash: await hashPassword('Pass123!'),
          status: 'DEACTIVATED',
          deactivatedAt: new Date(),
        },
      });
      const res = await request(app).post(`/teams/${team.body.id}/members`).set('Authorization', `Bearer ${token}`).send({ userId: deactUser.id });
      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/Deactivated/i);
    });

    test('existing membership for deactivated user remains', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const team = await request(app).post('/teams').set('Authorization', `Bearer ${token}`).send({ name: uid('TeamKeep') });
      const user = await prisma.user.create({
        data: {
          name: 'Keep',
          email: uid('keep') + '@test.com',
          organizationId: orgA.id,
          roleId: roleAgentA.id,
          passwordHash: await hashPassword('Pass123!'),
          status: 'ACTIVE',
        },
      });
      const added = await request(app).post(`/teams/${team.body.id}/members`).set('Authorization', `Bearer ${token}`).send({ userId: user.id });
      expect(added.status).toBe(201);
      // Deactivate user afterwards
      await prisma.user.update({ where: { id: user.id }, data: { status: 'DEACTIVATED', deactivatedAt: new Date() } });
      const members = await request(app).get(`/teams/${team.body.id}/members`).set('Authorization', `Bearer ${token}`);
      expect(members.status).toBe(200);
      expect(members.body.find((m) => m.user.id === user.id)).toBeDefined();
    });
  });

  // 10. Soft-deleted user cannot be added
  describe('10. Soft-deleted user cannot receive a new team assignment', () => {
    test('soft-deleted user add fails', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const team = await request(app).post('/teams').set('Authorization', `Bearer ${token}`).send({ name: uid('TeamDel') });
      const delUser = await prisma.user.create({
        data: {
          name: 'Del',
          email: uid('del') + '@test.com',
          organizationId: orgA.id,
          roleId: roleAgentA.id,
          passwordHash: await hashPassword('Pass123!'),
          status: 'ACTIVE',
          deletedAt: new Date(),
        },
      });
      const res = await request(app).post(`/teams/${team.body.id}/members`).set('Authorization', `Bearer ${token}`).send({ userId: delUser.id });
      // Our service checks via tenantPrisma.user.findUnique which filters deletedAt null, so will be 404
      expect([404, 403]).toContain(res.status);
    });
  });

  // 11. Removing membership works
  describe('11. Removing membership works correctly', () => {
    test('remove member succeeds and is tenant-safe', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const team = await request(app).post('/teams').set('Authorization', `Bearer ${tokenA}`).send({ name: uid('TeamRem') });
      const user = await prisma.user.create({
        data: {
          name: 'Rem',
          email: uid('rem') + '@test.com',
          organizationId: orgA.id,
          roleId: roleAgentA.id,
          passwordHash: await hashPassword('Pass123!'),
        },
      });
      await request(app).post(`/teams/${team.body.id}/members`).set('Authorization', `Bearer ${tokenA}`).send({ userId: user.id });
      const del = await request(app).delete(`/teams/${team.body.id}/members/${user.id}`).set('Authorization', `Bearer ${tokenA}`);
      expect(del.status).toBe(200);
      const members = await request(app).get(`/teams/${team.body.id}/members`).set('Authorization', `Bearer ${tokenA}`);
      expect(members.body.find((m) => m.user.id === user.id)).toBeUndefined();
      // Cross-tenant remove should fail
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const teamB = await request(app).post('/teams').set('Authorization', `Bearer ${tokenB}`).send({ name: uid('TeamBRem') });
      // Try to remove with wrong token
      const crossDel = await request(app).delete(`/teams/${teamB.body.id}/members/${user.id}`).set('Authorization', `Bearer ${tokenA}`);
      expect(crossDel.status).toBe(404);
    });

    test('remove non-existent membership returns 404', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const team = await request(app).post('/teams').set('Authorization', `Bearer ${token}`).send({ name: uid('TeamNon') });
      const fakeUserId = '00000000-0000-4000-a000-000000000000';
      const res = await request(app).delete(`/teams/${team.body.id}/members/${fakeUserId}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });
  });

  // 12. Listing team members tenant-safe
  describe('12. Listing team members is tenant-safe', () => {
    test('team members list only for own org', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const teamA = await request(app).post('/teams').set('Authorization', `Bearer ${tokenA}`).send({ name: uid('TeamMemA') });
      const teamB = await request(app).post('/teams').set('Authorization', `Bearer ${tokenB}`).send({ name: uid('TeamMemB') });
      const userA = await prisma.user.create({
        data: { name: 'MA', email: uid('ma') + '@test.com', organizationId: orgA.id, roleId: roleAgentA.id, passwordHash: await hashPassword('Pass123!') },
      });
      const userB = await prisma.user.create({
        data: { name: 'MB', email: uid('mb') + '@test.com', organizationId: orgB.id, roleId: roleAdminB.id, passwordHash: await hashPassword('Pass123!') },
      });
      await request(app).post(`/teams/${teamA.body.id}/members`).set('Authorization', `Bearer ${tokenA}`).send({ userId: userA.id });
      await request(app).post(`/teams/${teamB.body.id}/members`).set('Authorization', `Bearer ${tokenB}`).send({ userId: userB.id });

      const listA = await request(app).get(`/teams/${teamA.body.id}/members`).set('Authorization', `Bearer ${tokenA}`);
      expect(listA.status).toBe(200);
      expect(listA.body.length).toBe(1);
      expect(listA.body[0].user.id).toBe(userA.id);

      const cross = await request(app).get(`/teams/${teamA.body.id}/members`).set('Authorization', `Bearer ${tokenB}`);
      expect(cross.status).toBe(404);

      const listB = await request(app).get(`/teams/${teamB.body.id}/members`).set('Authorization', `Bearer ${tokenB}`);
      expect(listB.body[0].user.id).toBe(userB.id);
    });
  });

  // 13. Listing user's teams tenant-safe
  describe('13. Listing a user\'s teams is tenant-safe', () => {
    test('user teams list only own org', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const teamA = await request(app).post('/teams').set('Authorization', `Bearer ${tokenA}`).send({ name: uid('TeamUserA') });
      const userA = await prisma.user.create({
        data: { name: 'UA', email: uid('ua') + '@test.com', organizationId: orgA.id, roleId: roleAgentA.id, passwordHash: await hashPassword('Pass123!') },
      });
      await request(app).post(`/teams/${teamA.body.id}/members`).set('Authorization', `Bearer ${tokenA}`).send({ userId: userA.id });

      const listA = await request(app).get(`/users/${userA.id}/teams`).set('Authorization', `Bearer ${tokenA}`);
      expect(listA.status).toBe(200);
      expect(listA.body.length).toBe(1);
      expect(listA.body[0].id).toBe(teamA.body.id);

      const cross = await request(app).get(`/users/${userA.id}/teams`).set('Authorization', `Bearer ${tokenB}`);
      expect(cross.status).toBe(404);

      const listBForAuser = await request(app).get(`/users/${userAdminA.id}/teams`).set('Authorization', `Bearer ${tokenA}`);
      expect(listBForAuser.status).toBe(200);
    });

    test('user with multiple teams returns all', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const t1 = await request(app).post('/teams').set('Authorization', `Bearer ${token}`).send({ name: uid('Multi1') });
      const t2 = await request(app).post('/teams').set('Authorization', `Bearer ${token}`).send({ name: uid('Multi2') });
      const user = await prisma.user.create({
        data: { name: 'Multi', email: uid('multi') + '@test.com', organizationId: orgA.id, roleId: roleAgentA.id, passwordHash: await hashPassword('Pass123!') },
      });
      await request(app).post(`/teams/${t1.body.id}/members`).set('Authorization', `Bearer ${token}`).send({ userId: user.id });
      await request(app).post(`/teams/${t2.body.id}/members`).set('Authorization', `Bearer ${token}`).send({ userId: user.id });
      const list = await request(app).get(`/users/${user.id}/teams`).set('Authorization', `Bearer ${token}`);
      expect(list.body.length).toBe(2);
    });
  });

  // 14. Authorization enforced
  describe('14. Authorization is enforced through the existing permission system', () => {
    test('Agent without team:create cannot create team', async () => {
      const tokenAgent = await login(userAgentA.email, plainAgentA, orgA.id);
      const res = await request(app).post('/teams').set('Authorization', `Bearer ${tokenAgent}`).send({ name: uid('NoPerm') });
      expect(res.status).toBe(403);
    });

    test('Admin with team:create can create', async () => {
      const tokenAdmin = await login(userAdminA.email, plainAdminA, orgA.id);
      const res = await request(app).post('/teams').set('Authorization', `Bearer ${tokenAdmin}`).send({ name: uid('AdminTeam') });
      expect(res.status).toBe(201);
    });

    test('Agent with only team:read can list but not create', async () => {
      const tokenAgent = await login(userAgentA.email, plainAgentA, orgA.id);
      const list = await request(app).get('/teams').set('Authorization', `Bearer ${tokenAgent}`);
      expect(list.status).toBe(200);
      const create = await request(app).post('/teams').set('Authorization', `Bearer ${tokenAgent}`).send({ name: uid('Fail') });
      expect(create.status).toBe(403);
    });

    test('Unauthenticated request fails 401', async () => {
      const res = await request(app).get('/teams');
      expect(res.status).toBe(401);
    });

    test('Wrong resource/action denied, no role-name hardcoding', async () => {
      // Create a new role with only organization:read, try team:create
      const permOrgReadOnly = await prisma.permission.findFirst({ where: { resource: 'organization', action: 'read' } });
      const roleOnlyOrgRead = await prisma.role.create({ data: { name: uid('OnlyOrgRead'), organizationId: orgA.id } });
      await prisma.rolePermission.create({ data: { organizationId: orgA.id, roleId: roleOnlyOrgRead.id, permissionId: permOrgReadOnly.id, scope: 'ORGANIZATION' } });
      const userOnlyOrg = await prisma.user.create({
        data: { name: 'OnlyOrg', email: uid('onlyorg') + '@test.com', organizationId: orgA.id, roleId: roleOnlyOrgRead.id, passwordHash: await hashPassword('Pass123!') },
      });
      const token = await login(userOnlyOrg.email, 'Pass123!', orgA.id);
      const res = await request(app).post('/teams').set('Authorization', `Bearer ${token}`).send({ name: uid('ShouldFail') });
      expect(res.status).toBe(403);
    });

    test('Permission change takes effect immediately without new JWT', async () => {
      const tokenAgent = await login(userAgentA.email, plainAgentA, orgA.id);
      // Initially Agent cannot create
      let res = await request(app).post('/teams').set('Authorization', `Bearer ${tokenAgent}`).send({ name: uid('BeforePerm') });
      expect(res.status).toBe(403);
      // Grant permission
      await prisma.rolePermission.create({ data: { organizationId: orgA.id, roleId: roleAgentA.id, permissionId: permTeamCreate.id, scope: 'ORGANIZATION' } });
      res = await request(app).post('/teams').set('Authorization', `Bearer ${tokenAgent}`).send({ name: uid('AfterPerm') });
      expect(res.status).toBe(201);
      // Revoke
      await prisma.rolePermission.deleteMany({ where: { roleId: roleAgentA.id, permissionId: permTeamCreate.id } });
      res = await request(app).post('/teams').set('Authorization', `Bearer ${tokenAgent}`).send({ name: uid('AfterRevoke') });
      expect(res.status).toBe(403);
    });
  });

  // 15. Existing tests continue to pass is verified via full suite run
  describe('15. Tenant isolation preserved for all operations', () => {
    test('organization isolation still enforced via tenant wrapper', async () => {
      const tenantA = createTenantPrisma(orgA.id);
      const teamA = await tenantA.team.create({ data: { name: uid('IsoTeamA') } });
      const tenantB = createTenantPrisma(orgB.id);
      const foundByB = await tenantB.team.findUnique({ where: { id: teamA.id } });
      expect(foundByB).toBeNull();
    });
  });
});
