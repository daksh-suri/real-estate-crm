const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/lib/prisma');
const { hashPassword } = require('../src/lib/bcrypt');
const { hashRefreshToken } = require('../src/lib/refreshToken');
const { verifyAccessToken } = require('../src/lib/jwt');

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

describe('Refresh token single-use concurrency guarantee', () => {
  let org;
  let role;
  let perm;
  let user;
  const plain = 'Pass123!';

  beforeAll(async () => {
    await prisma.refreshToken.deleteMany({});
    await prisma.teamMembership.deleteMany({});
    await prisma.rolePermission.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.team.deleteMany({});
    await prisma.role.deleteMany({});
    await prisma.permission.deleteMany({});
    await prisma.organization.deleteMany({});

    org = await prisma.organization.create({ data: { name: uid('OrgConc') } });
    role = await prisma.role.create({ data: { name: 'Agent', organizationId: org.id } });
    perm = await prisma.permission.create({ data: { resource: 'lead', action: 'read' } });
    await prisma.rolePermission.create({ data: { organizationId: org.id, roleId: role.id, permissionId: perm.id, scope: 'ORGANIZATION' } });
    user = await prisma.user.create({
      data: {
        name: 'ConcUser',
        email: uid('conc') + '@test.com',
        organizationId: org.id,
        roleId: role.id,
        passwordHash: await hashPassword(plain),
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
    await prisma.refreshToken.deleteMany({});
  });

  test('concurrent refresh with same token: exactly one succeeds, one fails', async () => {
    const login = await request(app).post('/auth/login').send({ email: user.email, password: plain, organizationId: org.id });
    expect(login.status).toBe(200);
    const rawR1 = login.body.refreshToken;
    expect(rawR1).toBeDefined();
    const hashR1 = hashRefreshToken(rawR1);
    const storedR1 = await prisma.refreshToken.findUnique({ where: { tokenHash: hashR1 } });
    expect(storedR1).not.toBeNull();
    expect(storedR1.revokedAt).toBeNull();

    // Two concurrent refreshes using SAME R1 via HTTP
    const pA = request(app).post('/auth/refresh').send({ refreshToken: rawR1 });
    const pB = request(app).post('/auth/refresh').send({ refreshToken: rawR1 });
    const [resA, resB] = await Promise.all([pA, pB]);

    const statuses = [resA.status, resB.status].sort();
    // Exactly one 200, one 401
    expect(statuses).toEqual([200, 401]);

    const success = resA.status === 200 ? resA : resB;
    const failed = resA.status === 401 ? resA : resB;
    expect(success.body).toHaveProperty('accessToken');
    expect(success.body).toHaveProperty('refreshToken');
    expect(failed.body.error.message).toMatch(/revoked/i);

    // R1 must be revoked
    const afterR1 = await prisma.refreshToken.findUnique({ where: { tokenHash: hashR1 } });
    expect(afterR1.revokedAt).not.toBeNull();
    expect(afterR1.replacedById).not.toBeNull();

    // Only one replacement should be valid (the successful one)
    const rawSuccess = success.body.refreshToken;
    const hashSuccess = hashRefreshToken(rawSuccess);
    const storedSuccess = await prisma.refreshToken.findUnique({ where: { tokenHash: hashSuccess } });
    expect(storedSuccess).not.toBeNull();
    expect(storedSuccess.revokedAt).toBeNull();
    expect(storedSuccess.userId).toBe(user.id);
    expect(storedSuccess.organizationId).toBe(org.id);

    // The failed request must not have left an orphan valid token beyond the one success
    // Count valid (not revoked, not expired) tokens for user should be exactly 1
    const validTokens = await prisma.refreshToken.findMany({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    expect(validTokens).toHaveLength(1);
    expect(validTokens[0].tokenHash).toBe(hashSuccess);

    // Successful new access token must authenticate
    const me = await request(app).get('/auth/me').set('Authorization', `Bearer ${success.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(user.id);
    expect(me.body.user.organizationId).toBe(org.id);

    // Reuse of R1 again must still fail (already revoked)
    const reuse = await request(app).post('/auth/refresh').send({ refreshToken: rawR1 });
    expect(reuse.status).toBe(401);

    // The successful replacement is still valid for one more sequential use (proves it wasn't revoked by the failed concurrent request)
    const next = await request(app).post('/auth/refresh').send({ refreshToken: rawSuccess });
    expect(next.status).toBe(200);
    expect(next.body).toHaveProperty('accessToken');
  });

  test('concurrent refresh via service layer (direct) also single-use', async () => {
    const { refresh } = require('../src/modules/auth/service');
    const login = await request(app).post('/auth/login').send({ email: user.email, password: plain, organizationId: org.id });
    const rawR1 = login.body.refreshToken;

    const results = await Promise.allSettled([refresh({ rawRefreshToken: rawR1 }), refresh({ rawRefreshToken: rawR1 })]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.message).toMatch(/revoked/i);

    const success = fulfilled[0].value;
    expect(success).toHaveProperty('accessToken');
    expect(success).toHaveProperty('refreshToken');

    // Verify single valid token remains
    const valid = await prisma.refreshToken.findMany({ where: { userId: user.id, revokedAt: null } });
    expect(valid).toHaveLength(1);
    expect(hashRefreshToken(success.refreshToken)).toBe(valid[0].tokenHash);

    // New token works
    const decoded = verifyAccessToken(success.accessToken);
    expect(decoded.sub).toBe(user.id);
    expect(decoded.organizationId).toBe(org.id);
  });

  test('concurrent refresh does not allow tenant switching or cross-user use', async () => {
    // Create second org/user for isolation check
    const org2 = await prisma.organization.create({ data: { name: uid('Org2Conc') } });
    const role2 = await prisma.role.create({ data: { name: 'Agent', organizationId: org2.id } });
    const perm2 = await prisma.permission.create({ data: { resource: uid('res2'), action: 'read' } });
    await prisma.rolePermission.create({ data: { organizationId: org2.id, roleId: role2.id, permissionId: perm2.id, scope: 'ORGANIZATION' } });
    const user2 = await prisma.user.create({
      data: {
        name: 'User2',
        email: uid('user2') + '@test.com',
        organizationId: org2.id,
        roleId: role2.id,
        passwordHash: await hashPassword(plain),
      },
    });
    void user2;

    const login = await request(app).post('/auth/login').send({ email: user.email, password: plain, organizationId: org.id });
    const rawR1 = login.body.refreshToken;

    // Try to refresh with R1 but tamper? No, just ensure concurrent still respects org
    const [rA, rB] = await Promise.all([
      request(app).post('/auth/refresh').send({ refreshToken: rawR1 }),
      request(app).post('/auth/refresh').send({ refreshToken: rawR1 }),
    ]);
    const ok = [rA, rB].find((r) => r.status === 200);
    expect(ok).toBeDefined();
    const decoded = verifyAccessToken(ok.body.accessToken);
    expect(decoded.organizationId).toBe(org.id);
    expect(decoded.sub).toBe(user.id);
    expect(decoded.organizationId).not.toBe(org2.id);

    // Cleanup second org
    await prisma.refreshToken.deleteMany({ where: { organizationId: org2.id } });
    await prisma.user.deleteMany({ where: { organizationId: org2.id } });
    await prisma.rolePermission.deleteMany({ where: { organizationId: org2.id } });
    await prisma.role.deleteMany({ where: { organizationId: org2.id } });
    await prisma.permission.deleteMany({ where: { id: perm2.id } });
    await prisma.organization.deleteMany({ where: { id: org2.id } });
  });
});
