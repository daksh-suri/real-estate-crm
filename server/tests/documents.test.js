const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/lib/prisma');
const { hashPassword } = require('../src/lib/bcrypt');
const { setStorageProvider } = require('../src/lib/storage');

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

let phoneCtr = 9700000000;
function identity(tag) {
  phoneCtr += 1;
  return {
    contactName: `Person ${tag} ${phoneCtr}`,
    phone: String(phoneCtr),
    email: `${tag}-${phoneCtr}@test.com`,
  };
}

const fakeStorage = {
  createUploadUrl: ({ storageKey }) => ({ url: `https://fake-storage/upload/${storageKey}`, expiresInSeconds: 86400, storageKey }),
  createAccessUrl: ({ storageKey }) => ({ url: `https://fake-storage/access/${storageKey}`, expiresInSeconds: 86400, storageKey }),
};

describe('Checkpoint 13 — Documents', () => {
  let orgA, orgB;
  let roleAdminA, roleAgentA, roleReviewerA, roleAdminB;
  let userAdminA, userAgentA, userReviewerA, userAdminB;
  let plainAdminA = 'AdminPass123!';
  let plainAgentA = 'AgentPass123!';
  let plainReviewerA = 'ReviewerPass123!';
  let plainAdminB = 'AdminBPass123!';

  const PERMS = [
    ['enquiry', 'create'],
    ['lead', 'read'],
    ['contact', 'create'],
    ['contact', 'read'],
    ['deal', 'create'],
    ['deal', 'read'],
    ['document', 'create'],
    ['document', 'read'],
    ['document', 'upload'],
    ['document', 'verify'],
    ['document', 'reject'],
  ];
  // Agents upload/submit but never verify/reject.
  const AGENT_PERMS = [['contact', 'create'], ['enquiry', 'create'], ['deal', 'create'], ['document', 'create'], ['document', 'read'], ['document', 'upload']];
  // Reviewers (Ops/Manager/Admin shape) verify/reject but need no upload rights.
  const REVIEWER_PERMS = [['document', 'read'], ['document', 'verify'], ['document', 'reject']];

  async function wipeAll() {
    await prisma.refreshToken.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.idempotencyKey.deleteMany({});
    await prisma.document.deleteMany({});
    await prisma.booking.deleteMany({});
    await prisma.reservation.deleteMany({});
    await prisma.siteVisit.deleteMany({});
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

  async function wipeDomain() {
    await prisma.auditLog.deleteMany({});
    await prisma.idempotencyKey.deleteMany({});
    await prisma.document.deleteMany({});
    await prisma.booking.deleteMany({});
    await prisma.reservation.deleteMany({});
    await prisma.siteVisit.deleteMany({});
    await prisma.deal.deleteMany({});
    await prisma.lead.deleteMany({});
    await prisma.enquiry.deleteMany({});
    await prisma.requirement.deleteMany({});
    await prisma.unit.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.possibleDuplicate.deleteMany({});
    await prisma.contact.deleteMany({});
    await prisma.refreshToken.deleteMany({});
  }

  beforeAll(async () => {
    await wipeAll();
    setStorageProvider(fakeStorage);

    orgA = await prisma.organization.create({ data: { name: uid('OrgA') } });
    orgB = await prisma.organization.create({ data: { name: uid('OrgB') } });

    const permByKey = {};
    for (const [resource, action] of PERMS) {
      const p = await prisma.permission.create({ data: { resource, action } });
      permByKey[`${resource}:${action}`] = p;
    }

    roleAdminA = await prisma.role.create({ data: { name: 'Admin', organizationId: orgA.id } });
    roleAgentA = await prisma.role.create({ data: { name: 'Agent', organizationId: orgA.id } });
    roleReviewerA = await prisma.role.create({ data: { name: 'Manager', organizationId: orgA.id } });
    roleAdminB = await prisma.role.create({ data: { name: 'Admin', organizationId: orgB.id } });

    for (const p of Object.values(permByKey)) {
      await prisma.rolePermission.create({
        data: { organizationId: orgA.id, roleId: roleAdminA.id, permissionId: p.id, scope: 'ORGANIZATION' },
      });
      await prisma.rolePermission.create({
        data: { organizationId: orgB.id, roleId: roleAdminB.id, permissionId: p.id, scope: 'ORGANIZATION' },
      });
    }
    for (const [resource, action] of AGENT_PERMS) {
      await prisma.rolePermission.create({
        data: {
          organizationId: orgA.id,
          roleId: roleAgentA.id,
          permissionId: permByKey[`${resource}:${action}`].id,
          scope: 'ORGANIZATION',
        },
      });
    }
    for (const [resource, action] of REVIEWER_PERMS) {
      await prisma.rolePermission.create({
        data: {
          organizationId: orgA.id,
          roleId: roleReviewerA.id,
          permissionId: permByKey[`${resource}:${action}`].id,
          scope: 'ORGANIZATION',
        },
      });
    }

    userAdminA = await prisma.user.create({
      data: { name: 'AdminA', email: uid('adminA') + '@test.com', organizationId: orgA.id, roleId: roleAdminA.id, passwordHash: await hashPassword(plainAdminA), status: 'ACTIVE' },
    });
    userAgentA = await prisma.user.create({
      data: { name: 'AgentA', email: uid('agentA') + '@test.com', organizationId: orgA.id, roleId: roleAgentA.id, passwordHash: await hashPassword(plainAgentA), status: 'ACTIVE' },
    });
    userReviewerA = await prisma.user.create({
      data: { name: 'ReviewerA', email: uid('reviewerA') + '@test.com', organizationId: orgA.id, roleId: roleReviewerA.id, passwordHash: await hashPassword(plainReviewerA), status: 'ACTIVE' },
    });
    userAdminB = await prisma.user.create({
      data: { name: 'AdminB', email: uid('adminB') + '@test.com', organizationId: orgB.id, roleId: roleAdminB.id, passwordHash: await hashPassword(plainAdminB), status: 'ACTIVE' },
    });
  });

  afterAll(async () => {
    setStorageProvider(null);
    await wipeAll();
    await prisma.$disconnect();
  });

  afterEach(async () => {
    setStorageProvider(fakeStorage);
    await wipeDomain();
  });

  async function login(email, password, organizationId) {
    const res = await request(app).post('/auth/login').send({ email, password, organizationId });
    expect(res.status).toBe(200);
    return res.body.accessToken;
  }

  async function makeContact(token, tag) {
    const id = identity(tag);
    const res = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: id.contactName, phone: id.phone, email: id.email });
    expect(res.status).toBe(201);
    return res.body.contact;
  }

  async function makeDeal(token, tag) {
    const id = identity(`deal${tag}`);
    const enq = await request(app).post('/enquiries').set('Authorization', `Bearer ${token}`).send({ channel: 'WALK_IN', ...id });
    expect(enq.status).toBe(201);
    const deal = await request(app).post('/deals').set('Authorization', `Bearer ${token}`).send({ leadId: enq.body.lead.id });
    expect(deal.status).toBe(201);
    return deal.body;
  }

  async function makeDoc(token, contactId, extra = {}, key) {
    const req = request(app).post('/documents').set('Authorization', `Bearer ${token}`).send({ contactId, type: 'ID_PROOF', ...extra });
    if (key) req.set('Idempotency-Key', key);
    return req;
  }

  // Full agent-side flow to UNDER_REVIEW.
  async function toReview(token, docId) {
    expect((await request(app).post(`/documents/${docId}/upload-url`).set('Authorization', `Bearer ${token}`)).status).toBe(200);
    expect((await request(app).post(`/documents/${docId}/complete`).set('Authorization', `Bearer ${token}`)).status).toBe(200);
    const submitted = await request(app).post(`/documents/${docId}/submit`).set('Authorization', `Bearer ${token}`);
    expect(submitted.status).toBe(200);
    return submitted.body;
  }

  async function auditRows(entityId) {
    return prisma.auditLog.findMany({ where: { organizationId: orgA.id, entityType: 'Document', entityId } });
  }

  // -------------------------------------------------------------------------
  describe('Creation + reads', () => {
    test('creates v1 NOT_SUBMITTED with server-derived key; client key ignored', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const contact = await makeContact(token, 'create');
      const res = await makeDoc(token, contact.id, { storageKey: 'evil/key' });
      expect(res.status).toBe(201);
      const d = res.body.document;
      expect(d.version).toBe(1);
      expect(d.status).toBe('NOT_SUBMITTED');
      expect(d.groupId).toBeDefined();
      expect(d.storageKey).toBe(`${orgA.id}/${contact.id}/${d.groupId}/v1`);
      expect(d.organizationId).toBe(orgA.id);
    });

    test('deal-linked document carries dealId; deal-less allowed', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const deal = await makeDeal(token, 'withdeal');
      const contact = await makeContact(token, 'nodeal');
      const withDeal = await makeDoc(token, deal.contactId, { dealId: deal.id });
      expect(withDeal.status).toBe(201);
      expect(withDeal.body.document.dealId).toBe(deal.id);
      const withoutDeal = await makeDoc(token, contact.id);
      expect(withoutDeal.status).toBe(201);
      expect(withoutDeal.body.document.dealId).toBeNull();
    });

    test('cross-tenant / soft-deleted / mismatched refs rejected', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const contactB = await makeContact(tokenB, 'xref');
      const dealA = await makeDeal(tokenA, 'xrefdeal');
      expect((await makeDoc(tokenA, contactB.id)).status).toBe(403);
      // Deal of another contact (same org) → 400, nothing created.
      const other = await makeContact(tokenA, 'xother');
      expect((await makeDoc(tokenA, other.id, { dealId: dealA.id })).status).toBe(400);
      expect(await prisma.document.count({ where: { organizationId: orgA.id } })).toBe(0);
      // Soft-deleted contact → 400.
      await prisma.contact.update({ where: { id: other.id }, data: { deletedAt: new Date() } });
      expect((await makeDoc(tokenA, other.id)).status).toBe(400);
    });

    test('list filters by contact/group/status; get one', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const contact = await makeContact(token, 'list');
      const created = (await makeDoc(token, contact.id)).body.document;
      const one = await request(app).get(`/documents/${created.id}`).set('Authorization', `Bearer ${token}`);
      expect(one.status).toBe(200);
      const list = await request(app).get(`/documents?contactId=${contact.id}&status=NOT_SUBMITTED&limit=10`).set('Authorization', `Bearer ${token}`);
      expect(list.status).toBe(200);
      expect(list.body.length).toBe(1);
      const group = await request(app).get(`/documents?groupId=${created.groupId}`).set('Authorization', `Bearer ${token}`);
      expect(group.body.length).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('Upload URLs', () => {
    test('returns scoped short-lived URL for draft states only', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const contact = await makeContact(token, 'url');
      const doc = (await makeDoc(token, contact.id)).body.document;
      const res = await request(app).post(`/documents/${doc.id}/upload-url`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.url).toBe(`https://fake-storage/upload/${doc.storageKey}`);
      expect(res.body.expiresInSeconds).toBe(86400);
      expect(res.body.storageKey).toBe(doc.storageKey);
      // Generating a URL never advances state.
      expect((await prisma.document.findFirst({ where: { id: doc.id } })).status).toBe('NOT_SUBMITTED');
      // Past review states refuse URLs.
      await toReview(token, doc.id);
      await request(app).post(`/documents/${doc.id}/verify`).set('Authorization', `Bearer ${await login(userReviewerA.email, plainReviewerA, orgA.id)}`);
      expect((await request(app).post(`/documents/${doc.id}/upload-url`).set('Authorization', `Bearer ${token}`)).status).toBe(400);
    });

    test('cross-tenant URL generation hides as 404; unauth 401; noperm 403', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const contact = await makeContact(tokenA, 'urlx');
      const doc = (await makeDoc(tokenA, contact.id)).body.document;
      expect((await request(app).post(`/documents/${doc.id}/upload-url`).set('Authorization', `Bearer ${tokenB}`)).status).toBe(404);
      expect((await request(app).post(`/documents/${doc.id}/upload-url`)).status).toBe(401);
      // Reviewer lacks document:upload.
      const reviewer = await login(userReviewerA.email, plainReviewerA, orgA.id);
      expect((await request(app).post(`/documents/${doc.id}/upload-url`).set('Authorization', `Bearer ${reviewer}`)).status).toBe(403);
    });

    test('unconfigured storage → 503 with no leak', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const contact = await makeContact(token, 'url503');
      const doc = (await makeDoc(token, contact.id)).body.document;
      setStorageProvider(null);
      const res = await request(app).post(`/documents/${doc.id}/upload-url`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(503);
      expect(res.body.error.message).not.toMatch(/key|secret|credential/i);
    });

    test('SigV4 shape against dummy env (structure, scope, expiry)', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const contact = await makeContact(token, 'sigv4');
      const doc = (await makeDoc(token, contact.id)).body.document;
      setStorageProvider(null);
      process.env.STORAGE_ENDPOINT = 'https://s3.example.com';
      process.env.STORAGE_BUCKET = 'crm-docs';
      process.env.STORAGE_REGION = 'us-east-1';
      process.env.STORAGE_ACCESS_KEY_ID = 'AKID';
      process.env.STORAGE_SECRET_ACCESS_KEY = 'SECRET';
      try {
        const res = await request(app).post(`/documents/${doc.id}/upload-url`).set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(res.body.url).toMatch(/^https:\/\/s3\.example\.com\/crm-docs\//);
        expect(res.body.url).toContain(encodeURIComponent(doc.storageKey).replace(/%2F/g, '/'));
        expect(res.body.url).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
        expect(res.body.url).toContain('X-Amz-Expires=86400');
        expect(res.body.url).toMatch(/X-Amz-Signature=[0-9a-f]{64}/);
        // Access key ID rides in the credential scope by SigV4 design; the
        // secret itself must never appear.
        expect(res.body.url).toContain('X-Amz-Credential=AKID');
        expect(res.body.url).not.toMatch(/SECRET/);
      } finally {
        delete process.env.STORAGE_ENDPOINT;
        delete process.env.STORAGE_BUCKET;
        delete process.env.STORAGE_REGION;
        delete process.env.STORAGE_ACCESS_KEY_ID;
        delete process.env.STORAGE_SECRET_ACCESS_KEY;
        setStorageProvider(fakeStorage);
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('Review workflow', () => {
    test('agent submits, reviewer verifies: metadata + audit atomic', async () => {
      const agent = await login(userAgentA.email, plainAgentA, orgA.id);
      const reviewer = await login(userReviewerA.email, plainReviewerA, orgA.id);
      const contact = await makeContact(agent, 'verify');
      const doc = (await makeDoc(agent, contact.id)).body.document;
      await toReview(agent, doc.id);
      const res = await request(app).post(`/documents/${doc.id}/verify`).set('Authorization', `Bearer ${reviewer}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('VERIFIED');
      expect(res.body.reviewedBy).toBe(userReviewerA.id);
      expect(new Date(res.body.reviewedAt).getTime()).toBeGreaterThan(Date.now() - 60000);
      const rows = await auditRows(doc.id);
      expect(rows.length).toBe(1);
      expect(rows[0].action).toBe('document.verify');
      expect(rows[0].actorId).toBe(userReviewerA.id);
      expect(rows[0].beforeState.status).toBe('UNDER_REVIEW');
      expect(rows[0].afterState.status).toBe('VERIFIED');
    });

    test('agent cannot verify or reject; reviewer cannot upload', async () => {
      const agent = await login(userAgentA.email, plainAgentA, orgA.id);
      const reviewer = await login(userReviewerA.email, plainReviewerA, orgA.id);
      const contact = await makeContact(agent, 'gates');
      const doc = (await makeDoc(agent, contact.id)).body.document;
      await toReview(agent, doc.id);
      expect((await request(app).post(`/documents/${doc.id}/verify`).set('Authorization', `Bearer ${agent}`)).status).toBe(403);
      expect((await request(app).post(`/documents/${doc.id}/reject`).set('Authorization', `Bearer ${agent}`).send({ rejectionReason: 'no' })).status).toBe(403);
      // Reviewer (Manager-shaped) verifies and rejects on separate docs.
      expect((await request(app).post(`/documents/${doc.id}/verify`).set('Authorization', `Bearer ${reviewer}`)).status).toBe(200);
      const doc2 = (await makeDoc(agent, contact.id)).body.document;
      await toReview(agent, doc2.id);
      const rej = await request(app).post(`/documents/${doc2.id}/reject`).set('Authorization', `Bearer ${reviewer}`).send({ rejectionReason: 'blurry scan' });
      expect(rej.status).toBe(200);
      expect(rej.body.status).toBe('REJECTED');
      // Admin verifies too.
      const admin = await login(userAdminA.email, plainAdminA, orgA.id);
      const doc3 = (await makeDoc(agent, contact.id)).body.document;
      await toReview(agent, doc3.id);
      expect((await request(app).post(`/documents/${doc3.id}/verify`).set('Authorization', `Bearer ${admin}`)).status).toBe(200);
    });

    test('verify requires UNDER_REVIEW; invalid edges rejected', async () => {
      const agent = await login(userAgentA.email, plainAgentA, orgA.id);
      const reviewer = await login(userReviewerA.email, plainReviewerA, orgA.id);
      const contact = await makeContact(agent, 'edges');
      const doc = (await makeDoc(agent, contact.id)).body.document;
      expect((await request(app).post(`/documents/${doc.id}/verify`).set('Authorization', `Bearer ${reviewer}`)).status).toBe(400);
      expect((await request(app).post(`/documents/${doc.id}/submit`).set('Authorization', `Bearer ${agent}`)).status).toBe(400);
      await request(app).post(`/documents/${doc.id}/complete`).set('Authorization', `Bearer ${agent}`);
      expect((await request(app).post(`/documents/${doc.id}/complete`).set('Authorization', `Bearer ${agent}`)).status).toBe(400);
      await request(app).post(`/documents/${doc.id}/submit`).set('Authorization', `Bearer ${agent}`);
      await request(app).post(`/documents/${doc.id}/verify`).set('Authorization', `Bearer ${reviewer}`);
      // VERIFIED terminal: verify/reject/submit/complete all refuse.
      expect((await request(app).post(`/documents/${doc.id}/verify`).set('Authorization', `Bearer ${reviewer}`)).status).toBe(400);
      expect((await request(app).post(`/documents/${doc.id}/reject`).set('Authorization', `Bearer ${reviewer}`).send({ rejectionReason: 'x' })).status).toBe(400);
      expect((await request(app).post(`/documents/${doc.id}/submit`).set('Authorization', `Bearer ${agent}`)).status).toBe(400);
      expect((await prisma.document.findFirst({ where: { id: doc.id } })).status).toBe('VERIFIED');
    });

    test('reject requires trimmed reason; failure writes nothing', async () => {
      const agent = await login(userAgentA.email, plainAgentA, orgA.id);
      const reviewer = await login(userReviewerA.email, plainReviewerA, orgA.id);
      const contact = await makeContact(agent, 'reason');
      const doc = (await makeDoc(agent, contact.id)).body.document;
      await toReview(agent, doc.id);
      expect((await request(app).post(`/documents/${doc.id}/reject`).set('Authorization', `Bearer ${reviewer}`).send({ rejectionReason: '   ' })).status).toBe(400);
      expect((await request(app).post(`/documents/${doc.id}/reject`).set('Authorization', `Bearer ${reviewer}`).send({})).status).toBe(400);
      expect((await prisma.document.findFirst({ where: { id: doc.id } })).status).toBe('UNDER_REVIEW');
      expect(await auditRows(doc.id)).toEqual([]);
      const ok = await request(app).post(`/documents/${doc.id}/reject`).set('Authorization', `Bearer ${reviewer}`).send({ rejectionReason: '  expired id  ' });
      expect(ok.status).toBe(200);
      expect(ok.body.rejectionReason).toBe('expired id');
      expect(ok.body.reviewedBy).toBe(userReviewerA.id);
      const rows = await auditRows(doc.id);
      expect(rows.length).toBe(1);
      expect(rows[0].action).toBe('document.reject');
    });

    test('no generic PATCH/DELETE escape hatch', async () => {
      const agent = await login(userAgentA.email, plainAgentA, orgA.id);
      const contact = await makeContact(agent, 'noescape');
      const doc = (await makeDoc(agent, contact.id)).body.document;
      for (const method of ['patch', 'put', 'delete']) {
        expect((await request(app)[method](`/documents/${doc.id}`).set('Authorization', `Bearer ${agent}`).send({ status: 'VERIFIED' })).status).toBe(404);
      }
      expect((await prisma.document.findFirst({ where: { id: doc.id } })).status).toBe('NOT_SUBMITTED');
    });
  });

  // -------------------------------------------------------------------------
  describe('Resubmission + versioning', () => {
    async function rejectedDoc(agent, reviewer, tag) {
      const contact = await makeContact(agent, `${tag}c`);
      const doc = (await makeDoc(agent, contact.id)).body.document;
      await toReview(agent, doc.id);
      const rej = await request(app).post(`/documents/${doc.id}/reject`).set('Authorization', `Bearer ${reviewer}`).send({ rejectionReason: 'bad' });
      expect(rej.status).toBe(200);
      return { contact, doc };
    }

    test('resubmit creates v2 RESUBMITTED, retains v1, carries links', async () => {
      const agent = await login(userAgentA.email, plainAgentA, orgA.id);
      const reviewer = await login(userReviewerA.email, plainReviewerA, orgA.id);
      const deal = await makeDeal(agent, 'resub');
      const contact = await prisma.contact.findFirst({ where: { id: deal.contactId } });
      const doc = (await makeDoc(agent, contact.id, { dealId: deal.id })).body.document;
      await toReview(agent, doc.id);
      await request(app).post(`/documents/${doc.id}/reject`).set('Authorization', `Bearer ${reviewer}`).send({ rejectionReason: 'bad' });
      const res = await request(app).post(`/documents/${doc.id}/resubmit`).set('Authorization', `Bearer ${agent}`);
      expect(res.status).toBe(201);
      const v2 = res.body.document;
      expect(v2.version).toBe(2);
      expect(v2.status).toBe('RESUBMITTED');
      expect(v2.groupId).toBe(doc.groupId);
      expect(v2.supersedesId).toBe(doc.id);
      expect(v2.type).toBe(doc.type);
      expect(v2.contactId).toBe(doc.contactId);
      expect(v2.dealId).toBe(deal.id);
      expect(v2.storageKey).toBe(`${orgA.id}/${doc.contactId}/${doc.groupId}/v2`);
      // v1 retained untouched.
      const v1 = await prisma.document.findFirst({ where: { id: doc.id } });
      expect(v1.status).toBe('REJECTED');
      expect(v1.version).toBe(1);
      // v2 flows again: upload-url works, complete → SUBMITTED, submit → review, verify.
      expect((await request(app).post(`/documents/${v2.id}/upload-url`).set('Authorization', `Bearer ${agent}`)).status).toBe(200);
      expect((await request(app).post(`/documents/${v2.id}/complete`).set('Authorization', `Bearer ${agent}`)).body.status).toBe('SUBMITTED');
      expect((await request(app).post(`/documents/${v2.id}/submit`).set('Authorization', `Bearer ${agent}`)).body.status).toBe('UNDER_REVIEW');
      expect((await request(app).post(`/documents/${v2.id}/verify`).set('Authorization', `Bearer ${reviewer}`)).body.status).toBe('VERIFIED');
      expect((await prisma.document.findFirst({ where: { id: doc.id } })).status).toBe('REJECTED');
    });

    test('resubmit rejected unless latest is REJECTED', async () => {
      const agent = await login(userAgentA.email, plainAgentA, orgA.id);
      const reviewer = await login(userReviewerA.email, plainReviewerA, orgA.id);
      const { doc } = await rejectedDoc(agent, reviewer, 'guard');
      // Non-latest: resubmit v1 after v2 exists → 409.
      const v2 = (await request(app).post(`/documents/${doc.id}/resubmit`).set('Authorization', `Bearer ${agent}`)).body.document;
      expect((await request(app).post(`/documents/${doc.id}/resubmit`).set('Authorization', `Bearer ${agent}`)).status).toBe(409);
      expect((await request(app).post(`/documents/${v2.id}/resubmit`).set('Authorization', `Bearer ${agent}`)).status).toBe(409);
      // Non-REJECTED latest: fresh draft → 409.
      const contact = await makeContact(agent, 'guard2');
      const draft = (await makeDoc(agent, contact.id)).body.document;
      expect((await request(app).post(`/documents/${draft.id}/resubmit`).set('Authorization', `Bearer ${agent}`)).status).toBe(409);
      expect(await prisma.document.count({ where: { groupId: doc.groupId } })).toBe(2);
    });

    test('concurrent resubmits fork nothing: one v2, single winner', async () => {
      const agent = await login(userAgentA.email, plainAgentA, orgA.id);
      const reviewer = await login(userReviewerA.email, plainReviewerA, orgA.id);
      const { doc } = await rejectedDoc(agent, reviewer, 'race');
      const key = uid('rskey');
      const mk = (k) => {
        const req = request(app).post(`/documents/${doc.id}/resubmit`).set('Authorization', `Bearer ${agent}`);
        if (k) req.set('Idempotency-Key', k);
        return req;
      };
      const [a, b] = await Promise.all([mk(), mk()]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect(await prisma.document.count({ where: { groupId: doc.groupId } })).toBe(2);
      // Keyed retries converge.
      const [c, d] = await Promise.all([mk(key), mk(key)]);
      // First keyed attempt may itself race the earlier winner's state;
      // converge means no third version either way.
      expect(await prisma.document.count({ where: { groupId: doc.groupId } })).toBe(2);
      expect([c.status, d.status].every((s) => [200, 201, 409].includes(s))).toBe(true);
    });

    test('keyed resubmit replays without duplicating', async () => {
      const agent = await login(userAgentA.email, plainAgentA, orgA.id);
      const reviewer = await login(userReviewerA.email, plainReviewerA, orgA.id);
      const { doc } = await rejectedDoc(agent, reviewer, 'idem');
      const key = uid('rskey');
      const first = await request(app).post(`/documents/${doc.id}/resubmit`).set('Authorization', `Bearer ${agent}`).set('Idempotency-Key', key);
      expect(first.status).toBe(201);
      const replay = await request(app).post(`/documents/${doc.id}/resubmit`).set('Authorization', `Bearer ${agent}`).set('Idempotency-Key', key);
      expect(replay.status).toBe(200);
      expect(replay.body.document.id).toBe(first.body.document.id);
      expect(await prisma.document.count({ where: { groupId: doc.groupId } })).toBe(2);
    });

    test('DB backstops exist: supersedes unique + live-group partial index', async () => {
      const agent = await login(userAgentA.email, plainAgentA, orgA.id);
      const reviewer = await login(userReviewerA.email, plainReviewerA, orgA.id);
      const { contact, doc } = await rejectedDoc(agent, reviewer, 'backstop');
      const v2 = (await request(app).post(`/documents/${doc.id}/resubmit`).set('Authorization', `Bearer ${agent}`)).body.document;
      // Second child of the same parent → P2002 (supersedesId unique).
      await expect(
        prisma.document.create({
          data: { organizationId: orgA.id, groupId: doc.groupId, version: 99, supersedesId: doc.id, contactId: contact.id, type: 'X', status: 'NOT_SUBMITTED', storageKey: 'x' },
        })
      ).rejects.toMatchObject({ code: 'P2002' });
      // Second live version in the group → P2002 (partial index).
      await expect(
        prisma.document.create({
          data: { organizationId: orgA.id, groupId: doc.groupId, version: 98, contactId: contact.id, type: 'X', status: 'SUBMITTED', storageKey: 'y' },
        })
      ).rejects.toMatchObject({ code: 'P2002' });
      expect(v2.version).toBe(2);
    });

    test('cross-tenant resubmit hides as 404 with nothing created', async () => {
      const agent = await login(userAgentA.email, plainAgentA, orgA.id);
      const reviewer = await login(userReviewerA.email, plainReviewerA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const { doc } = await rejectedDoc(agent, reviewer, 'xtenant');
      expect((await request(app).post(`/documents/${doc.id}/resubmit`).set('Authorization', `Bearer ${tokenB}`)).status).toBe(404);
      expect(await prisma.document.count({ where: { groupId: doc.groupId } })).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('Authorization matrix + tenant isolation', () => {
    test('unauthenticated → 401, wrong grants → 403, tenant lists scoped', async () => {
      const agent = await login(userAgentA.email, plainAgentA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const contact = await makeContact(agent, 'authz');
      const doc = (await makeDoc(agent, contact.id)).body.document;
      expect((await request(app).get(`/documents/${doc.id}`)).status).toBe(401);
      expect((await request(app).get(`/documents/${doc.id}`).set('Authorization', `Bearer ${tokenB}`)).status).toBe(404);
      const listB = await request(app).get('/documents').set('Authorization', `Bearer ${tokenB}`);
      expect(listB.status).toBe(200);
      expect(listB.body).toEqual([]);
      // Access URL respects tenancy too.
      expect((await request(app).post(`/documents/${doc.id}/access-url`).set('Authorization', `Bearer ${tokenB}`)).status).toBe(404);
      const ok = await request(app).post(`/documents/${doc.id}/access-url`).set('Authorization', `Bearer ${agent}`);
      expect(ok.status).toBe(200);
      expect(ok.body.url).toContain(doc.storageKey);
    });
  });
});
