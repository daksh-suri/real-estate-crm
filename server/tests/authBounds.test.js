// Auth input bounds (hardening pass): over-long passwords must fail fast at
// validation (bcrypt truncates past 72 bytes — never let a prefix verify),
// and refresh/logout tokens carry a generous cap against pathological input.
// Both reject before any DB or crypto work, so no fixtures are needed.
const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/lib/prisma');
const { validate, createPlanSchema, webhookSchema } = require('../src/modules/payments/validation');

describe('auth input bounds', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  test('73-char password is rejected at validation, not hashed', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({
        email: 'anyone@test.com',
        password: 'p'.repeat(73),
        organizationId: '00000000-0000-4000-8000-000000000000',
      });
    expect(res.status).toBe(400);
  });

  test('72-char password passes validation (fails auth, not shape)', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({
        email: 'anyone@test.com',
        password: 'p'.repeat(72),
        organizationId: '00000000-0000-4000-8000-000000000000',
      });
    // Unknown org -> 401 from the service, proving the shape was accepted.
    expect(res.status).toBe(401);
  });

  test('oversized refresh token is rejected at validation', async () => {
    const res = await request(app).post('/auth/refresh').send({ refreshToken: 'a'.repeat(201) });
    expect(res.status).toBe(400);
  });

  test('oversized logout token is rejected at validation', async () => {
    const res = await request(app).post('/auth/logout').send({ refreshToken: 'a'.repeat(201) });
    expect(res.status).toBe(400);
  });
});

describe('payment amount finiteness (second hardening pass)', () => {
  const obligationId = '00000000-0000-4000-8000-000000000001';
  const bookingId = '00000000-0000-4000-8000-000000000002';

  test('non-finite dueAmount is rejected at validation', () => {
    expect(() =>
      validate(createPlanSchema, {
        bookingId,
        obligations: [{ dueAmount: Number.POSITIVE_INFINITY, dueDate: new Date().toISOString() }],
      })
    ).toThrow();
  });

  test('non-finite webhook amount is rejected at validation', () => {
    expect(() =>
      validate(webhookSchema, {
        eventId: 'evt-1',
        obligationId,
        amount: Number.POSITIVE_INFINITY,
        outcome: 'SUCCESS',
      })
    ).toThrow();
  });

  test('finite positive amounts still validate', () => {
    const plan = validate(createPlanSchema, {
      bookingId,
      obligations: [{ dueAmount: 50000, dueDate: new Date().toISOString() }],
    });
    expect(plan.obligations[0].dueAmount).toBe(50000);
  });
});
