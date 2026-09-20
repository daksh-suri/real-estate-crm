// Payment webhook HMAC boundary (hardening pass): when PAYMENT_WEBHOOK_SECRET
// is configured, only requests carrying a valid hex HMAC-SHA256 over the raw
// body are processed. Invalid/missing/tampered signatures are rejected before
// validation or any state change. Idempotency + tenant derivation are
// preserved. When no secret is configured (dev/test default), the legacy
// unsigned path still works.
const request = require('supertest');
const crypto = require('crypto');
const app = require('../src/app');
const config = require('../src/config');
const { prisma } = require('../src/lib/prisma');
const { hashPassword } = require('../src/lib/bcrypt');
const {
  WEBHOOK_SIGNATURE_HEADER,
  signWebhookPayload,
  verifyWebhookSignature,
} = require('../src/lib/webhookAuth');

const TEST_SECRET = `test-secret-${crypto.randomBytes(16).toString('hex')}`;

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

describe('verifyWebhookSignature unit', () => {
  const secret = 's3cr3t';
  const raw = Buffer.from('{"eventId":"e1"}');
  test('valid signature verifies', () => {
    expect(verifyWebhookSignature({ rawBody: raw, signature: signWebhookPayload(raw, secret), secret })).toBe(true);
  });
  test.each([[''], ['xyz'], ['ab'.repeat(10)], [null], [undefined]])('malformed signature %p fails closed', (sig) => {
    expect(verifyWebhookSignature({ rawBody: raw, signature: sig, secret })).toBe(false);
  });
  test('missing body or secret fails closed', () => {
    expect(verifyWebhookSignature({ rawBody: null, signature: signWebhookPayload(raw, secret), secret })).toBe(false);
    expect(verifyWebhookSignature({ rawBody: raw, signature: signWebhookPayload(raw, secret), secret: null })).toBe(
      false
    );
  });
});

describe('POST /webhooks/payment-gateway HMAC enforcement', () => {
  let org, obligations;
  const prevSecret = config.webhook.paymentSecret;
  let phoneCtr = 9871000000;

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
    await prisma.paymentRecord.deleteMany({});
    await prisma.paymentObligation.deleteMany({});
    await prisma.paymentPlan.deleteMany({});
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

  function sendWebhook(payload, { secret = TEST_SECRET, tamper = false } = {}) {
    const raw = JSON.stringify(payload);
    const signed = tamper ? `${raw} ` : raw;
    const req = request(app).post('/webhooks/payment-gateway').set('Content-Type', 'application/json');
    if (secret !== null) req.set(WEBHOOK_SIGNATURE_HEADER, signWebhookPayload(Buffer.from(raw), secret));
    return req.send(signed);
  }

  function payloadFor(obligationId, eventId, outcome = 'SUCCESS') {
    return { eventId, obligationId, amount: 50000, outcome };
  }

  beforeAll(async () => {
    await wipeAll();
    org = await prisma.organization.create({ data: { name: uid('OrgWH') } });
    const role = await prisma.role.create({ data: { name: 'Admin', organizationId: org.id } });
    for (const [resource, action] of [
      ['contact', 'create'],
      ['enquiry', 'create'],
      ['deal', 'create'],
    ]) {
      let perm = await prisma.permission.findFirst({ where: { resource, action } });
      if (!perm) perm = await prisma.permission.create({ data: { resource, action } });
      await prisma.rolePermission.create({
        data: { organizationId: org.id, roleId: role.id, permissionId: perm.id, scope: 'ORGANIZATION' },
      });
    }
    const admin = await prisma.user.create({
      data: {
        name: 'AdminWH',
        email: `${uid('wh-admin')}@test.com`,
        organizationId: org.id,
        roleId: role.id,
        passwordHash: await hashPassword('AdminPass123!'),
        status: 'ACTIVE',
      },
    });
    const login = await request(app)
      .post('/auth/login')
      .send({ email: admin.email, password: 'AdminPass123!', organizationId: org.id });
    expect(login.status).toBe(200);
    const auth = (r) => r.set('Authorization', `Bearer ${login.body.accessToken}`);

    phoneCtr += 1;
    const contactRes = await auth(request(app).post('/contacts')).send({
      name: `WH Person ${phoneCtr}`,
      phone: String(phoneCtr),
      email: `wh-${phoneCtr}@test.com`,
    });
    expect(contactRes.status).toBe(201);
    const enquiryRes = await auth(request(app).post('/enquiries')).send({
      channel: 'WALK_IN',
      contactName: `WH Person ${phoneCtr}`,
      phone: String(phoneCtr),
      email: `wh-${phoneCtr}@test.com`,
    });
    expect(enquiryRes.status).toBe(201);
    const dealRes = await auth(request(app).post('/deals')).send({ leadId: enquiryRes.body.lead.id });
    expect(dealRes.status).toBe(201);

    const plan = await prisma.paymentPlan.create({ data: { organizationId: org.id, dealId: dealRes.body.id } });
    obligations = [];
    for (let i = 0; i < 4; i += 1) {
      obligations.push(
        await prisma.paymentObligation.create({
          data: {
            organizationId: org.id,
            paymentPlanId: plan.id,
            dueAmount: 50000,
            dueDate: new Date(Date.now() + 86400000),
          },
        })
      );
    }
    config.webhook.paymentSecret = TEST_SECRET;
  });

  afterAll(async () => {
    config.webhook.paymentSecret = prevSecret;
    await wipeAll();
    await prisma.$disconnect();
  });

  test('valid signature processes the webhook', async () => {
    const res = await sendWebhook(payloadFor(obligations[0].id, uid('evt-valid-')));
    expect(res.status).toBe(201);
    expect(res.body.obligation.status).toBe('PAID');
    const refreshed = await prisma.paymentObligation.findUnique({ where: { id: obligations[0].id } });
    expect(refreshed.status).toBe('PAID');
  });

  test('wrong-secret signature is rejected with zero mutation', async () => {
    const before = await prisma.paymentRecord.count({ where: { obligationId: obligations[1].id } });
    const res = await sendWebhook(payloadFor(obligations[1].id, uid('evt-forged-')), { secret: 'wrong-secret' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/Invalid webhook signature/);
    expect(await prisma.paymentRecord.count({ where: { obligationId: obligations[1].id } })).toBe(before);
    expect((await prisma.paymentObligation.findUnique({ where: { id: obligations[1].id } })).status).toBe('PENDING');
  });

  test('missing signature is rejected', async () => {
    const res = await sendWebhook(payloadFor(obligations[1].id, uid('evt-nosig-')), { secret: null });
    expect(res.status).toBe(401);
  });

  test('tampered body fails signature verification', async () => {
    const res = await sendWebhook(payloadFor(obligations[1].id, uid('evt-tamper-')), { tamper: true });
    expect(res.status).toBe(401);
  });

  test('replay with same eventId returns the stored snapshot', async () => {
    const eventId = uid('evt-replay-');
    const first = await sendWebhook(payloadFor(obligations[2].id, eventId));
    expect(first.status).toBe(201);
    const second = await sendWebhook(payloadFor(obligations[2].id, eventId));
    expect(second.status).toBe(200);
    expect(second.body.record.id).toBe(first.body.record.id);
    expect(await prisma.paymentRecord.count({ where: { obligationId: obligations[2].id } })).toBe(1);
  });

  test('same eventId with different payload is a conflict', async () => {
    const eventId = uid('evt-conflict-');
    const first = await sendWebhook(payloadFor(obligations[3].id, eventId, 'SUCCESS'));
    expect(first.status).toBe(201);
    const retry = { ...payloadFor(obligations[3].id, eventId, 'FAILED') };
    const second = await sendWebhook(retry);
    expect(second.status).toBe(409);
  });

  test('unsigned path still works when no secret is configured', async () => {
    config.webhook.paymentSecret = null;
    try {
      const res = await request(app)
        .post('/webhooks/payment-gateway')
        .send(payloadFor(obligations[1].id, uid('evt-unsigned-')));
      expect(res.status).toBe(201);
    } finally {
      config.webhook.paymentSecret = TEST_SECRET;
    }
  });
});
