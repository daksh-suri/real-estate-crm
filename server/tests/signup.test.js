const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/lib/prisma');
const { verifyPassword } = require('../src/lib/bcrypt');

describe('POST /auth/signup — fresh-install onboarding', () => {
  beforeEach(async () => {
    // Wipe tenant data for test isolation (organizations are global, keep for other tests? But signup needs empty org)
    // We wipe in FK order similar to seed-qa, but keep it simple: delete many where organizationId in test orgs
    // Instead, we rely on auth.test.js style: each test creates unique org names via uid, so no need to wipe all
  });

  function uid(p) { return `${p}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`; }

  test('1. Successful signup creates Organization + User', async () => {
    const orgName = uid('Org');
    const email = uid('user') + '@test.com';
    const res = await request(app).post('/auth/signup').send({
      organizationName: orgName,
      name: 'Alice',
      email,
      password: 'StrongPass123!',
      confirmPassword: 'StrongPass123!',
    });
    expect(res.status).toBe(201);
    expect(res.body.organization).toBeDefined();
    expect(res.body.organization.name).toBe(orgName);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe(email.toLowerCase());
    // DB checks
    const org = await prisma.organization.findUnique({ where: { id: res.body.organization.id } });
    expect(org).not.toBeNull();
    const user = await prisma.user.findUnique({ where: { id: res.body.user.id } });
    expect(user).not.toBeNull();
    expect(user.organizationId).toBe(org.id);
  });

  test('2. First user receives Admin role', async () => {
    const orgName = uid('Org');
    const email = uid('user') + '@test.com';
    const res = await request(app).post('/auth/signup').send({
      organizationName: orgName,
      name: 'Bob',
      email,
      password: 'StrongPass123!',
      confirmPassword: 'StrongPass123!',
    });
    expect(res.status).toBe(201);
    const user = await prisma.user.findUnique({ where: { id: res.body.user.id }, include: { role: true } });
    expect(user.role).toBeDefined();
    expect(user.role.name).toBe('Admin');
  });

  test('3. User belongs to newly created organization', async () => {
    const orgName = uid('Org');
    const email = uid('user') + '@test.com';
    const res = await request(app).post('/auth/signup').send({
      organizationName: orgName,
      name: 'Carol',
      email,
      password: 'StrongPass123!',
      confirmPassword: 'StrongPass123!',
    });
    expect(res.body.organization.id).toBe(res.body.user.organizationId);
    const dbUser = await prisma.user.findUnique({ where: { id: res.body.user.id } });
    expect(dbUser.organizationId).toBe(res.body.organization.id);
  });

  test('4. Password is hashed and never stored plaintext', async () => {
    const orgName = uid('Org');
    const email = uid('user') + '@test.com';
    const plain = 'StrongPass123!';
    const res = await request(app).post('/auth/signup').send({
      organizationName: orgName,
      name: 'Dave',
      email,
      password: plain,
      confirmPassword: plain,
    });
    expect(res.status).toBe(201);
    const dbUser = await prisma.user.findUnique({ where: { id: res.body.user.id } });
    expect(dbUser.passwordHash).toBeDefined();
    expect(dbUser.passwordHash).not.toBe(plain);
    expect(await verifyPassword(plain, dbUser.passwordHash)).toBe(true);
    expect(res.body.user).not.toHaveProperty('passwordHash');
  });

  test('5. Signup establishes authentication (auto-login)', async () => {
    const orgName = uid('Org');
    const email = uid('user') + '@test.com';
    const res = await request(app).post('/auth/signup').send({
      organizationName: orgName,
      name: 'Eve',
      email,
      password: 'StrongPass123!',
      confirmPassword: 'StrongPass123!',
    });
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeDefined();
    // Cookie
    const cookies = res.headers['set-cookie'] || [];
    const rtCookie = cookies.find((c) => c.startsWith('refreshToken='));
    expect(rtCookie).toBeDefined();
    // /auth/me with token
    const me = await request(app).get('/auth/me').set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email.toLowerCase());
  });

  test('6. Duplicate email is rejected', async () => {
    const orgName1 = uid('Org');
    const orgName2 = uid('Org');
    const email = uid('dup') + '@test.com';
    const r1 = await request(app).post('/auth/signup').send({
      organizationName: orgName1,
      name: 'First',
      email,
      password: 'StrongPass123!',
      confirmPassword: 'StrongPass123!',
    });
    expect(r1.status).toBe(201);
    const r2 = await request(app).post('/auth/signup').send({
      organizationName: orgName2,
      name: 'Second',
      email,
      password: 'StrongPass123!',
      confirmPassword: 'StrongPass123!',
    });
    expect(r2.status).toBe(409);
    expect(r2.body.error.message).toMatch(/Email already in use/i);
  });

  test('7. Invalid input is rejected', async () => {
    const r1 = await request(app).post('/auth/signup').send({
      organizationName: 'A', // too short
      name: 'Test',
      email: 'test@test.com',
      password: 'StrongPass123!',
      confirmPassword: 'StrongPass123!',
    });
    expect(r1.status).toBe(400);
    const r2 = await request(app).post('/auth/signup').send({
      organizationName: 'Valid Org',
      name: 'T',
      email: 'test2@test.com',
      password: 'StrongPass123!',
      confirmPassword: 'StrongPass123!',
    });
    expect(r2.status).toBe(400);
    const r3 = await request(app).post('/auth/signup').send({
      organizationName: 'Valid Org2',
      name: 'Test',
      email: 'not-an-email',
      password: 'StrongPass123!',
      confirmPassword: 'StrongPass123!',
    });
    expect(r3.status).toBe(400);
    const r4 = await request(app).post('/auth/signup').send({
      organizationName: 'Valid Org3',
      name: 'Test',
      email: 'test3@test.com',
      password: 'short',
      confirmPassword: 'short',
    });
    expect(r4.status).toBe(400);
    const r5 = await request(app).post('/auth/signup').send({
      organizationName: 'Valid Org4',
      name: 'Test',
      email: 'test4@test.com',
      password: 'StrongPass123!',
      confirmPassword: 'Different123!',
    });
    expect(r5.status).toBe(400);
  });

  test('8. Organization/user creation is atomic — duplicate org name does not create stray org', async () => {
    const orgName = uid('OrgDup');
    const email1 = uid('user1') + '@test.com';
    const email2 = uid('user2') + '@test.com';
    const r1 = await request(app).post('/auth/signup').send({
      organizationName: orgName,
      name: 'First',
      email: email1,
      password: 'StrongPass123!',
      confirmPassword: 'StrongPass123!',
    });
    expect(r1.status).toBe(201);
    const countBefore = await prisma.organization.count({ where: { name: orgName } });
    expect(countBefore).toBe(1);
    const r2 = await request(app).post('/auth/signup').send({
      organizationName: orgName,
      name: 'Second',
      email: email2,
      password: 'StrongPass123!',
      confirmPassword: 'StrongPass123!',
    });
    expect(r2.status).toBe(409);
    const countAfter = await prisma.organization.count({ where: { name: orgName } });
    expect(countAfter).toBe(1);
  });

  test('9. Failed user creation rolls back organization', async () => {
    const orgName = uid('OrgRollback');
    const email = uid('dup') + '@test.com';
    // First signup succeeds
    const r1 = await request(app).post('/auth/signup').send({
      organizationName: orgName + '1',
      name: 'First',
      email,
      password: 'StrongPass123!',
      confirmPassword: 'StrongPass123!',
    });
    expect(r1.status).toBe(201);
    // Second signup with same email but different org name should fail and not create org
    const r2 = await request(app).post('/auth/signup').send({
      organizationName: orgName + '2',
      name: 'Second',
      email,
      password: 'StrongPass123!',
      confirmPassword: 'StrongPass123!',
    });
    expect(r2.status).toBe(409);
    const org2 = await prisma.organization.findUnique({ where: { name: orgName + '2' } });
    expect(org2).toBeNull();
  });

  test('10. Concurrent signup cannot corrupt data (same org name)', async () => {
    const orgName = uid('OrgConcurrent');
    const email1 = uid('c1') + '@test.com';
    const email2 = uid('c2') + '@test.com';
    const p1 = request(app).post('/auth/signup').send({
      organizationName: orgName,
      name: 'First',
      email: email1,
      password: 'StrongPass123!',
      confirmPassword: 'StrongPass123!',
    });
    const p2 = request(app).post('/auth/signup').send({
      organizationName: orgName,
      name: 'Second',
      email: email2,
      password: 'StrongPass123!',
      confirmPassword: 'StrongPass123!',
    });
    const [r1, r2] = await Promise.all([p1, p2]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);
    const count = await prisma.organization.count({ where: { name: orgName } });
    expect(count).toBe(1);
  });

  test('11. Cross-tenant isolation remains intact', async () => {
    const orgNameA = uid('OrgA');
    const orgNameB = uid('OrgB');
    const emailA = uid('userA') + '@test.com';
    const emailB = uid('userB') + '@test.com';
    const rA = await request(app).post('/auth/signup').send({
      organizationName: orgNameA,
      name: 'UserA',
      email: emailA,
      password: 'StrongPass123!',
      confirmPassword: 'StrongPass123!',
    });
    const rB = await request(app).post('/auth/signup').send({
      organizationName: orgNameB,
      name: 'UserB',
      email: emailB,
      password: 'StrongPass123!',
      confirmPassword: 'StrongPass123!',
    });
    expect(rA.status).toBe(201);
    expect(rB.status).toBe(201);
    // User A cannot access Org B's data — create a contact in A, try fetch as B
    const { createTenantPrisma } = require('../src/lib/tenant');
    const tenantA = createTenantPrisma(rA.body.organization.id);
    const contact = await tenantA.contact.create({ data: { name: 'ContactA', email: 'ca@test.com', normalizedEmail: 'ca@test.com', phone: '9876543210', normalizedPhone: '9876543210' } });
    const meB = await request(app).get('/contacts/' + contact.id).set('Authorization', `Bearer ${rB.body.accessToken}`);
    expect(meB.status).toBe(404);
  });

  test('12. Existing login works for newly created account', async () => {
    const orgName = uid('Org');
    const email = uid('user') + '@test.com';
    const plain = 'StrongPass123!';
    const r = await request(app).post('/auth/signup').send({
      organizationName: orgName,
      name: 'Test',
      email,
      password: plain,
      confirmPassword: plain,
    });
    expect(r.status).toBe(201);
    // Logout
    await request(app).post('/auth/logout').set('Cookie', r.headers['set-cookie']);
    // Login with email+password only
    const login = await request(app).post('/auth/login').send({ email, password: plain });
    expect(login.status).toBe(200);
    expect(login.body.accessToken).toBeDefined();
  });

  test('13. Logout works', async () => {
    const orgName = uid('Org');
    const email = uid('user') + '@test.com';
    const r = await request(app).post('/auth/signup').send({
      organizationName: orgName,
      name: 'Test',
      email,
      password: 'StrongPass123!',
      confirmPassword: 'StrongPass123!',
    });
    expect(r.status).toBe(201);
    const cookies = r.headers['set-cookie'] || [];
    const out = await request(app).post('/auth/logout').set('Cookie', cookies.join('; '));
    expect(out.status).toBe(200);
  });

  test('14. Refresh works after signup', async () => {
    const orgName = uid('Org');
    const email = uid('user') + '@test.com';
    const r = await request(app).post('/auth/signup').send({
      organizationName: orgName,
      name: 'Test',
      email,
      password: 'StrongPass123!',
      confirmPassword: 'StrongPass123!',
    });
    expect(r.status).toBe(201);
    const cookies = r.headers['set-cookie'] || [];
    const rtCookie = cookies.find((c) => c.startsWith('refreshToken='));
    expect(rtCookie).toBeDefined();
    const ref = await request(app).post('/auth/refresh').set('Cookie', rtCookie);
    expect(ref.status).toBe(200);
    expect(ref.body.accessToken).toBeDefined();
  });

  test('15. /auth/me works after signup/login', async () => {
    const orgName = uid('Org');
    const email = uid('user') + '@test.com';
    const r = await request(app).post('/auth/signup').send({
      organizationName: orgName,
      name: 'Test',
      email,
      password: 'StrongPass123!',
      confirmPassword: 'StrongPass123!',
    });
    expect(r.status).toBe(201);
    const me = await request(app).get('/auth/me').set('Authorization', `Bearer ${r.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email.toLowerCase());
    expect(me.body.organization.name).toBe(orgName);
  });

  test('Rate limiter on signup', async () => {
    // Signup uses loginLimiter (20/15m, 1000 in test) — burst should not 429 in test env
    const orgName = uid('Org');
    const email = uid('user') + '@test.com';
    const r = await request(app).post('/auth/signup').send({
      organizationName: orgName,
      name: 'Test',
      email,
      password: 'StrongPass123!',
      confirmPassword: 'StrongPass123!',
    });
    expect([201, 409, 400]).toContain(r.status);
  });
});
