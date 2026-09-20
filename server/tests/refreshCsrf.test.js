// Refresh CSRF hardening: cookie refresh in production requires a present
// Origin/Referer matching the configured CORS origin; JS-readable body
// tokens are rejected in production. Non-production behavior is unchanged
// (existing auth/refreshConcurrency suites cover it).
const request = require('supertest');
const app = require('../src/app');
const config = require('../src/config');
const { originMatchesAllowed } = require('../src/modules/auth/controller');
const { prisma } = require('../src/lib/prisma');
const { hashPassword } = require('../src/lib/bcrypt');

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

describe('originMatchesAllowed', () => {
  const allowed = 'https://app.example.com';
  test('exact origin matches', () => {
    expect(originMatchesAllowed('https://app.example.com', allowed)).toBe(true);
  });
  test('referer rooted at origin matches', () => {
    expect(originMatchesAllowed('https://app.example.com/login', allowed)).toBe(true);
  });
  test('evil origin does not match', () => {
    expect(originMatchesAllowed('https://evil.com', allowed)).toBe(false);
  });
  test('subdomain does not match', () => {
    expect(originMatchesAllowed('https://app.example.com.evil.com', allowed)).toBe(false);
  });
  test('wildcard allowed-origin never matches', () => {
    expect(originMatchesAllowed('https://anything.com', '*')).toBe(false);
  });
  test('missing values do not match', () => {
    expect(originMatchesAllowed('', allowed)).toBe(false);
    expect(originMatchesAllowed('https://app.example.com', '')).toBe(false);
  });
});

describe('POST /auth/refresh CSRF enforcement (production mode)', () => {
  let org, refreshToken, cookieHeader, loginEmail;
  const prevProd = config.isProduction;

  beforeAll(async () => {
    await prisma.refreshToken.deleteMany({});
    await prisma.user.deleteMany({ where: { email: { contains: 'csrf-' } } });
    await prisma.organization.deleteMany({ where: { name: { contains: 'CsrfOrg-' } } });
    org = await prisma.organization.create({ data: { name: uid('CsrfOrg-') } });
    const role = await prisma.role.create({ data: { name: 'Agent', organizationId: org.id } });
    const email = `csrf-${uid('u')}@test.com`;
    loginEmail = email;
    await prisma.user.create({
      data: {
        name: 'Csrf',
        email,
        organizationId: org.id,
        roleId: role.id,
        passwordHash: await hashPassword('CsrfPass123!'),
        status: 'ACTIVE',
      },
    });
    const login = await request(app)
      .post('/auth/login')
      .send({ email, password: 'CsrfPass123!', organizationId: org.id });
    expect(login.status).toBe(200);
    // isTest echoes the raw refresh token; carry it as a manual Cookie
    // header (avoids Secure-cookie jar behavior over plain HTTP).
    refreshToken = login.body.refreshToken;
    expect(refreshToken).toBeTruthy();
    cookieHeader = `${config.cookies.refreshName}=${refreshToken}`;
    config.isProduction = true;
  });

  afterAll(async () => {
    config.isProduction = prevProd;
    await prisma.refreshToken.deleteMany({});
    await prisma.user.deleteMany({ where: { organizationId: org.id } });
    await prisma.role.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.deleteMany({ where: { id: org.id } });
    await prisma.$disconnect();
  });

  test('valid origin refreshes via cookie', async () => {
    const res = await request(app)
      .post('/auth/refresh')
      .set('Cookie', cookieHeader)
      .set('Origin', config.corsOrigin);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
  });

  test('mismatched origin is rejected without consuming the token', async () => {
    const bad = await request(app)
      .post('/auth/refresh')
      .set('Cookie', cookieHeader)
      .set('Origin', 'https://evil.example');
    expect(bad.status).toBe(403);
    expect(bad.body.error.message).toMatch(/origin mismatch/);
  });

  test('missing origin is rejected', async () => {
    const res = await request(app).post('/auth/refresh').set('Cookie', cookieHeader);
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/missing Origin/);
  });

  test('body token is rejected in production', async () => {
    // Fresh token: the earlier cookie test rotated (single-use) the first one.
    const again = await request(app).post('/auth/login').send({
      email: loginEmail,
      password: 'CsrfPass123!',
      organizationId: org.id,
    });
    expect(again.status).toBe(200);
    const res = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: again.body.refreshToken })
      .set('Origin', config.corsOrigin);
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/not accepted in production/);
  });
});
