/* eslint-disable no-unused-vars */
const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/lib/prisma');
const { hashPassword } = require('../src/lib/bcrypt');
const { normalizeEmail, normalizePhone } = require('../src/modules/contacts/normalization');
const { createTenantPrisma } = require('../src/lib/tenant');

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

describe('Checkpoint 5 — Contact + Requirement', () => {
  let orgA, orgB;
  let roleAdminA, roleAgentA, roleAdminB;
  let permContactCreate, permContactRead, permContactUpdate, permContactDelete;
  let permReqCreate, permReqRead, permReqUpdate, permReqDelete;
  let permEnquiryCreate, permDealCreate, permSiteVisitCreate, permLeadUpdate, permLeadRead;
  let userAdminA, userAgentA, userAdminB;
  let plainAdminA = 'AdminPass123!';
  let plainAgentA = 'AgentPass123!';
  let plainAdminB = 'AdminBPass123!';

  beforeAll(async () => {
    await prisma.refreshToken.deleteMany({});
    await prisma.idempotencyKey.deleteMany({});
    await prisma.siteVisit.deleteMany({});
    await prisma.deal.deleteMany({});
    await prisma.lead.deleteMany({});
    await prisma.enquiry.deleteMany({});
    await prisma.possibleDuplicate.deleteMany({});
    await prisma.requirement.deleteMany({});
    await prisma.unit.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.contact.deleteMany({});
    await prisma.teamMembership.deleteMany({});
    await prisma.rolePermission.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.team.deleteMany({});
    await prisma.role.deleteMany({});
    await prisma.permission.deleteMany({});
    await prisma.organization.deleteMany({});

    orgA = await prisma.organization.create({ data: { name: uid('OrgA') } });
    orgB = await prisma.organization.create({ data: { name: uid('OrgB') } });

    permContactCreate = await prisma.permission.create({ data: { resource: 'contact', action: 'create' } });
    permContactRead = await prisma.permission.create({ data: { resource: 'contact', action: 'read' } });
    permContactUpdate = await prisma.permission.create({ data: { resource: 'contact', action: 'update' } });
    permContactDelete = await prisma.permission.create({ data: { resource: 'contact', action: 'delete' } });
    permReqCreate = await prisma.permission.create({ data: { resource: 'requirement', action: 'create' } });
    permReqRead = await prisma.permission.create({ data: { resource: 'requirement', action: 'read' } });
    permReqUpdate = await prisma.permission.create({ data: { resource: 'requirement', action: 'update' } });
    permReqDelete = await prisma.permission.create({ data: { resource: 'requirement', action: 'delete' } });
    // Additive-only: fixtures for merge-reassignment tests (lead/deal/visit chains)
    permEnquiryCreate = await prisma.permission.create({ data: { resource: 'enquiry', action: 'create' } });
    permDealCreate = await prisma.permission.create({ data: { resource: 'deal', action: 'create' } });
    permSiteVisitCreate = await prisma.permission.create({ data: { resource: 'siteVisit', action: 'create' } });
    permLeadUpdate = await prisma.permission.create({ data: { resource: 'lead', action: 'update' } });
    permLeadRead = await prisma.permission.create({ data: { resource: 'lead', action: 'read' } });

    roleAdminA = await prisma.role.create({ data: { name: 'Admin', organizationId: orgA.id } });
    roleAgentA = await prisma.role.create({ data: { name: 'Agent', organizationId: orgA.id } });
    roleAdminB = await prisma.role.create({ data: { name: 'Admin', organizationId: orgB.id } });

    for (const perm of [permContactCreate, permContactRead, permContactUpdate, permContactDelete, permReqCreate, permReqRead, permReqUpdate, permReqDelete, permEnquiryCreate, permDealCreate, permSiteVisitCreate, permLeadUpdate, permLeadRead]) {
      await prisma.rolePermission.create({ data: { organizationId: orgA.id, roleId: roleAdminA.id, permissionId: perm.id, scope: 'ORGANIZATION' } });
    }
    for (const perm of [permContactRead, permReqRead]) {
      await prisma.rolePermission.create({ data: { organizationId: orgA.id, roleId: roleAgentA.id, permissionId: perm.id, scope: 'ORGANIZATION' } });
    }
    for (const perm of [permContactCreate, permContactRead, permContactUpdate, permContactDelete, permReqCreate, permReqRead, permReqUpdate, permReqDelete, permEnquiryCreate, permDealCreate, permSiteVisitCreate, permLeadUpdate, permLeadRead]) {
      await prisma.rolePermission.create({ data: { organizationId: orgB.id, roleId: roleAdminB.id, permissionId: perm.id, scope: 'ORGANIZATION' } });
    }

    userAdminA = await prisma.user.create({
      data: { name: 'AdminA', email: uid('adminA') + '@test.com', organizationId: orgA.id, roleId: roleAdminA.id, passwordHash: await hashPassword(plainAdminA), status: 'ACTIVE' },
    });
    userAgentA = await prisma.user.create({
      data: { name: 'AgentA', email: uid('agentA') + '@test.com', organizationId: orgA.id, roleId: roleAgentA.id, passwordHash: await hashPassword(plainAgentA), status: 'ACTIVE' },
    });
    userAdminB = await prisma.user.create({
      data: { name: 'AdminB', email: uid('adminB') + '@test.com', organizationId: orgB.id, roleId: roleAdminB.id, passwordHash: await hashPassword(plainAdminB), status: 'ACTIVE' },
    });
  });

  afterAll(async () => {
    await prisma.refreshToken.deleteMany({});
    await prisma.idempotencyKey.deleteMany({});
    await prisma.siteVisit.deleteMany({});
    await prisma.deal.deleteMany({});
    await prisma.lead.deleteMany({});
    await prisma.enquiry.deleteMany({});
    await prisma.possibleDuplicate.deleteMany({});
    await prisma.requirement.deleteMany({});
    await prisma.unit.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.contact.deleteMany({});
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
    await prisma.idempotencyKey.deleteMany({});
    await prisma.siteVisit.deleteMany({});
    await prisma.deal.deleteMany({});
    await prisma.lead.deleteMany({});
    await prisma.enquiry.deleteMany({});
    await prisma.possibleDuplicate.deleteMany({});
    await prisma.requirement.deleteMany({});
    await prisma.unit.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.contact.deleteMany({});
    await prisma.refreshToken.deleteMany({});
    // Keep users/orgs/roles/perms, but clean extra users
    const keepIds = [userAdminA.id, userAgentA.id, userAdminB.id];
    await prisma.user.deleteMany({ where: { id: { notIn: keepIds } } });
    await prisma.user.updateMany({ where: { id: { in: keepIds } }, data: { status: 'ACTIVE', deletedAt: null, deactivatedAt: null } });
  });

  async function login(email, password, organizationId) {
    const res = await request(app).post('/auth/login').send({ email, password, organizationId });
    expect(res.status).toBe(200);
    return res.body.accessToken;
  }

  // 1. Create contact successfully
  describe('1. Create contact', () => {
    test('creates contact with normalized fields', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const res = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'John Doe', phone: '+91 98765 43210', email: 'John@Example.COM ' });
      expect(res.status).toBe(201);
      expect(res.body.contact).toHaveProperty('id');
      expect(res.body.contact.organizationId).toBe(orgA.id);
      expect(res.body.contact.normalizedEmail).toBe('john@example.com');
      expect(res.body.contact.normalizedPhone).toBe('9876543210');
      expect(res.body.contact.phone).toBe('+91 98765 43210');
      expect(res.body.contact.communicationConsent).toBe('OPTED_IN');
    });
  });

  // 2. Validation failures
  describe('2. Validation failures', () => {
    test('missing name fails 400', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const res = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ phone: '9876543210' });
      expect(res.status).toBe(400);
    });
    test('invalid email fails', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const res = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'Test', email: 'not-an-email' });
      expect(res.status).toBe(400);
    });
  });

  // 3. Get contact
  describe('3. Get contact', () => {
    test('get contact by id', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const created = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'Jane', email: 'jane@test.com', phone: '9876543211' });
      const res = await request(app).get(`/contacts/${created.body.contact.id}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Jane');
    });
  });

  // 4. Update contact
  describe('4. Update contact', () => {
    test('update name and phone', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const created = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'Old', email: 'old@test.com', phone: '9000000001' });
      const res = await request(app).patch(`/contacts/${created.body.contact.id}`).set('Authorization', `Bearer ${token}`).send({ name: 'New', phone: '9000000002' });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('New');
      expect(res.body.normalizedPhone).toBe('9000000002');
    });
  });

  // 5. List/search contacts
  describe('5. List/search contacts', () => {
    test('list and search are tenant-scoped', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      await request(app).post('/contacts').set('Authorization', `Bearer ${tokenA}`).send({ name: 'Alice OrgA', email: 'aliceA@test.com', phone: '9000000011' });
      await request(app).post('/contacts').set('Authorization', `Bearer ${tokenB}`).send({ name: 'Bob OrgB', email: 'bobB@test.com', phone: '9000000022' });
      const listA = await request(app).get('/contacts').set('Authorization', `Bearer ${tokenA}`);
      expect(listA.body.every((c) => c.organizationId === orgA.id)).toBe(true);
      expect(listA.body.find((c) => c.name === 'Bob OrgB')).toBeUndefined();
      const search = await request(app).get('/contacts?search=Alice').set('Authorization', `Bearer ${tokenA}`);
      expect(search.body.length).toBeGreaterThan(0);
      expect(search.body[0].name).toMatch(/Alice/);
    });
  });

  // 6-8. Tenant isolation
  describe('6-8. Tenant isolation', () => {
    test('6. tenant isolation: list only own', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const cA = await request(app).post('/contacts').set('Authorization', `Bearer ${tokenA}`).send({ name: 'TA', email: 'ta@test.com', phone: '9000000033' });
      const listB = await request(app).get('/contacts').set('Authorization', `Bearer ${tokenB}`);
      expect(listB.body.find((c) => c.id === cA.body.contact.id)).toBeUndefined();
    });
    test('7. cannot access contact from another org', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const cA = await request(app).post('/contacts').set('Authorization', `Bearer ${tokenA}`).send({ name: 'TA', email: 'ta2@test.com', phone: '9000000044' });
      const getByB = await request(app).get(`/contacts/${cA.body.contact.id}`).set('Authorization', `Bearer ${tokenB}`);
      expect(getByB.status).toBe(404);
    });
    test('8. client-supplied organizationId cannot override tenant', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const res = await request(app).post('/contacts').set('Authorization', `Bearer ${tokenA}`).send({ name: 'Hack', email: 'hack@test.com', phone: '9000000055', organizationId: orgB.id });
      // Service ignores body organizationId and uses auth org
      expect(res.status).toBe(201);
      expect(res.body.contact.organizationId).toBe(orgA.id);
      expect(res.body.contact.organizationId).not.toBe(orgB.id);
    });
  });

  // 9-10. Normalization
  describe('9-10. Normalization', () => {
    test('9. email normalization: trim lower', async () => {
      expect(normalizeEmail('  JOHN@Example.COM ')).toBe('john@example.com');
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const res = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'Norm', email: '  Foo@Bar.COM  ', phone: '9000000066' });
      expect(res.body.contact.normalizedEmail).toBe('foo@bar.com');
    });
    test('10. phone normalization: Indian +91, 0 prefix, formatting', async () => {
      expect(normalizePhone('+91 98765-43210')).toBe('9876543210');
      expect(normalizePhone('0919876543210')).toBe('9876543210');
      expect(normalizePhone('919876543210')).toBe('9876543210');
      expect(normalizePhone('(987) 654-3210')).toBe('9876543210');
      expect(normalizePhone(' 9876543210 ')).toBe('9876543210');
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const res = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'Phone', phone: '+91-98765 43210', email: 'phone@test.com' });
      expect(res.body.contact.normalizedPhone).toBe('9876543210');
      expect(res.body.contact.phone).toBe('+91-98765 43210');
    });
  });

  // 11-13. Matching
  describe('11-13. Matching', () => {
    test('11. clear email match is detected as possible (single signal)', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const c1 = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'First', email: 'dup@test.com', phone: '9000000077' });
      expect(c1.status).toBe(201);
      const c2 = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'Second', email: 'dup@test.com', phone: '9000000088' });
      // Single signal email match -> should still create but with possibleDuplicates
      expect(c2.status).toBe(201);
      expect(c2.body.possibleDuplicates.length).toBeGreaterThan(0);
      expect(c2.body.matchType).toBe('POSSIBLE');
      // Verify PossibleDuplicate persisted
      const dups = await request(app).get(`/contacts/${c2.body.contact.id}/possible-duplicates`).set('Authorization', `Bearer ${token}`);
      expect(dups.body.length).toBeGreaterThan(0);
    });

    test('12. clear phone match is detected as possible', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const c1 = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'P1', email: 'p1@test.com', phone: '9000000099' });
      const c2 = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'P2', email: 'p2@test.com', phone: '9000000099' });
      expect(c2.status).toBe(201);
      expect(c2.body.matchType).toBe('POSSIBLE');
    });

    test('13. no-match creates new contact', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const c1 = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'NoMatch1', email: 'nomatch1@test.com', phone: '9000000101' });
      const c2 = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'NoMatch2', email: 'nomatch2@test.com', phone: '9000000102' });
      expect(c1.status).toBe(201);
      expect(c2.status).toBe(201);
      expect(c2.body.possibleDuplicates.length).toBe(0);
      expect(c2.body.matchType).toBe('NONE');
    });

    test('13b. same email with null phone: possible duplicate', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const c1 = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'EmailNullP1', email: 'emailnull@test.com', phone: '9000000601' });
      const c2 = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'EmailNullP2', email: 'emailnull@test.com' });
      expect(c1.status).toBe(201);
      expect(c2.status).toBe(201);
      expect(c2.body.matchType).toBe('POSSIBLE');
      expect(c2.body.possibleDuplicates.length).toBeGreaterThan(0);
    });

    test('13c. both identifiers null: no dedup, creates cleanly', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const c1 = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'BothNull1' });
      const c2 = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'BothNull2' });
      expect(c1.status).toBe(201);
      expect(c2.status).toBe(201);
      expect(c2.body.matchType).toBe('NONE');
      expect(c2.body.possibleDuplicates.length).toBe(0);
    });

    test('13d. null phone contact does not false-positive match unrelated null-phone contacts', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const c1 = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'NullPPhone1', email: 'nullphone1@test.com', phone: '9000000602' });
      const c2 = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'NullPPhone2', email: 'nullphone2@test.com' });
      expect(c1.status).toBe(201);
      expect(c2.status).toBe(201);
      expect(c2.body.matchType).toBe('NONE');
      expect(c2.body.possibleDuplicates.length).toBe(0);
    });

    test('13e. same email + different phone: possible duplicate', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const c1 = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'SameE1', email: 'samee@test.com', phone: '9000000603' });
      const c2 = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'SameE2', email: 'samee@test.com', phone: '9000000604' });
      expect(c1.status).toBe(201);
      expect(c2.status).toBe(201);
      expect(c2.body.matchType).toBe('POSSIBLE');
      expect(c2.body.possibleDuplicates.length).toBeGreaterThan(0);
    });

    test('13f. same phone + different email: possible duplicate', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const c1 = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'SamePh1', email: 'sameph1@test.com', phone: '9000000605' });
      const c2 = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'SamePh2', email: 'sameph2@test.com', phone: '9000000605' });
      expect(c1.status).toBe(201);
      expect(c2.status).toBe(201);
      expect(c2.body.matchType).toBe('POSSIBLE');
      expect(c2.body.possibleDuplicates.length).toBeGreaterThan(0);
    });
  });

  // 14. Ambiguous NOT silently merged
  describe('14. Ambiguous matching is NOT silently merged', () => {
    test('family-shared number: same phone different name/email creates separate contacts', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const c1 = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'John', email: 'john@test.com', phone: '9000000111' });
      const c2 = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'Jane', email: 'jane@test.com', phone: '9000000111' });
      expect(c1.status).toBe(201);
      expect(c2.status).toBe(201);
      expect(c1.body.contact.id).not.toBe(c2.body.contact.id);
      // Both exist separately
      const get1 = await request(app).get(`/contacts/${c1.body.contact.id}`).set('Authorization', `Bearer ${token}`);
      const get2 = await request(app).get(`/contacts/${c2.body.contact.id}`).set('Authorization', `Bearer ${token}`);
      expect(get1.status).toBe(200);
      expect(get2.status).toBe(200);
    });
  });

  // 15. Deterministic duplicate handled
  describe('15. Duplicate deterministic identity is handled safely', () => {
    test('same email+phone in same org returns 409', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const data = { name: 'Dup', email: 'deterministic@test.com', phone: '9000000122' };
      const r1 = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send(data);
      expect(r1.status).toBe(201);
      const r2 = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send(data);
      expect(r2.status).toBe(409);
      expect(r2.body.error.existingContact).toBeDefined();
      // Same identity in different org should succeed (tenant-scoped)
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const r3 = await request(app).post('/contacts').set('Authorization', `Bearer ${tokenB}`).send(data);
      expect(r3.status).toBe(201);
    });
  });

  // 16. Update cannot create collision
  describe('16. Contact update cannot create an invalid identity collision', () => {
    test('update to existing email+phone fails 409', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const c1 = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'C1', email: 'c1@test.com', phone: '9000000133' });
      const c2 = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'C2', email: 'c2@test.com', phone: '9000000144' });
      const upd = await request(app).patch(`/contacts/${c2.body.contact.id}`).set('Authorization', `Bearer ${token}`).send({ email: 'c1@test.com', phone: '9000000133' });
      expect(upd.status).toBe(409);
    });
  });

  // 17. Concurrent deterministic duplicate
  describe('17. Concurrent deterministic duplicate creation is handled correctly', () => {
    test('concurrent same email+phone: exactly one 201, one 409', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const data = { name: 'Conc', email: 'conc@test.com', phone: '9000000155' };
      const p1 = request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send(data);
      const p2 = request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send(data);
      const [r1, r2] = await Promise.all([p1, p2]);
      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual([201, 409]);
      const count = await prisma.contact.count({ where: { organizationId: orgA.id, normalizedEmail: 'conc@test.com', normalizedPhone: '9000000155' } });
      expect(count).toBe(1);
    });
  });

  // Requirement tests 18-26
  describe('Requirement', () => {
    let contactA;
    beforeEach(async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const res = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'ReqContact', email: uid('req') + '@test.com', phone: '9000000166' });
      contactA = res.body.contact;
    });

    test('18. Create requirement for same-org contact', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const res = await request(app).post(`/contacts/${contactA.id}/requirements`).set('Authorization', `Bearer ${token}`).send({ unitTypePreference: '2BHK', budgetMin: 5000000, budgetMax: 7000000, notes: 'Need urgent' });
      expect(res.status).toBe(201);
      expect(res.body.contactId).toBe(contactA.id);
      expect(res.body.organizationId).toBe(orgA.id);
      expect(String(res.body.budgetMin)).toBe('5000000');
    });

    test('19. Multiple requirements can belong to one contact', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const r1 = await request(app).post(`/contacts/${contactA.id}/requirements`).set('Authorization', `Bearer ${token}`).send({ unitTypePreference: '1BHK', budgetMin: 3000000 });
      const r2 = await request(app).post(`/contacts/${contactA.id}/requirements`).set('Authorization', `Bearer ${token}`).send({ unitTypePreference: '3BHK', budgetMax: 10000000 });
      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
      const list = await request(app).get(`/contacts/${contactA.id}/requirements`).set('Authorization', `Bearer ${token}`);
      expect(list.body.length).toBe(2);
    });

    test('20. Get/list requirements', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const created = await request(app).post(`/contacts/${contactA.id}/requirements`).set('Authorization', `Bearer ${token}`).send({ unitTypePreference: '2BHK' });
      const get = await request(app).get(`/requirements/${created.body.id}`).set('Authorization', `Bearer ${token}`);
      expect(get.status).toBe(200);
      expect(get.body.id).toBe(created.body.id);
      const list = await request(app).get(`/contacts/${contactA.id}/requirements`).set('Authorization', `Bearer ${token}`);
      expect(list.body.find((r) => r.id === created.body.id)).toBeDefined();
    });

    test('21. Update requirement', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const created = await request(app).post(`/contacts/${contactA.id}/requirements`).set('Authorization', `Bearer ${token}`).send({ unitTypePreference: '1BHK', budgetMin: 1000000 });
      const upd = await request(app).patch(`/requirements/${created.body.id}`).set('Authorization', `Bearer ${token}`).send({ budgetMax: 2000000, notes: 'Updated' });
      expect(upd.status).toBe(200);
      expect(String(upd.body.budgetMax)).toBe('2000000');
      expect(upd.body.notes).toBe('Updated');
    });

    test('22. Invalid contact reference rejected', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fakeId = '00000000-0000-4000-a000-000000000000';
      const res = await request(app).post('/requirements').set('Authorization', `Bearer ${token}`).send({ contactId: fakeId, unitTypePreference: '2BHK' });
      expect(res.status).toBe(404);
      const res2 = await request(app).post(`/contacts/${fakeId}/requirements`).set('Authorization', `Bearer ${token}`).send({ unitTypePreference: '2BHK' });
      expect(res2.status).toBe(404);
    });

    test('23. Cross-tenant requirement creation rejected', async () => {
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const res = await request(app).post('/requirements').set('Authorization', `Bearer ${tokenB}`).send({ contactId: contactA.id, unitTypePreference: '2BHK' });
      expect(res.status).toBe(404);
      const res2 = await request(app).post(`/contacts/${contactA.id}/requirements`).set('Authorization', `Bearer ${tokenB}`).send({ unitTypePreference: '2BHK' });
      expect(res2.status).toBe(404);
    });

    test('24. Cross-tenant requirement read rejected', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const created = await request(app).post(`/contacts/${contactA.id}/requirements`).set('Authorization', `Bearer ${tokenA}`).send({ unitTypePreference: '2BHK' });
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const get = await request(app).get(`/requirements/${created.body.id}`).set('Authorization', `Bearer ${tokenB}`);
      expect(get.status).toBe(404);
    });

    test('25. Cross-tenant requirement update rejected', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const created = await request(app).post(`/contacts/${contactA.id}/requirements`).set('Authorization', `Bearer ${tokenA}`).send({ unitTypePreference: '2BHK' });
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const upd = await request(app).patch(`/requirements/${created.body.id}`).set('Authorization', `Bearer ${tokenB}`).send({ notes: 'hack' });
      expect(upd.status).toBe(404);
    });

    test('26. Deleted contact behavior: cannot create requirement for deleted contact', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const del = await request(app).delete(`/contacts/${contactA.id}`).set('Authorization', `Bearer ${token}`);
      expect(del.status).toBe(200);
      const res = await request(app).post(`/contacts/${contactA.id}/requirements`).set('Authorization', `Bearer ${token}`).send({ unitTypePreference: '2BHK' });
      expect(res.status).toBe(404);
      // But existing requirements remain readable? Should still be via direct requirement id? Let's check
      // For now, listing requirements for deleted contact should be 404
      const list = await request(app).get(`/contacts/${contactA.id}/requirements`).set('Authorization', `Bearer ${token}`);
      expect(list.status).toBe(404);
    });
  });

  // Authorization 27-30
  describe('Authorization', () => {
    test('27. Unauthorized user receives 401', async () => {
      const res = await request(app).get('/contacts');
      expect(res.status).toBe(401);
    });
    test('28. Authenticated user without permission receives 403', async () => {
      const tokenAgent = await login(userAgentA.email, plainAgentA, orgA.id);
      const res = await request(app).post('/contacts').set('Authorization', `Bearer ${tokenAgent}`).send({ name: 'NoPerm', email: 'noperm@test.com', phone: '9000000200' });
      expect(res.status).toBe(403);
    });
    test('29. Appropriate permission grants access', async () => {
      const tokenAdmin = await login(userAdminA.email, plainAdminA, orgA.id);
      const res = await request(app).post('/contacts').set('Authorization', `Bearer ${tokenAdmin}`).send({ name: 'PermOk', email: 'permok@test.com', phone: '9000000211' });
      expect(res.status).toBe(201);
    });
    test('30. Permission changes are respected using DB-authoritative behavior', async () => {
      const tokenAgent = await login(userAgentA.email, plainAgentA, orgA.id);
      let res = await request(app).get('/contacts').set('Authorization', `Bearer ${tokenAgent}`);
      expect(res.status).toBe(200); // has read
      res = await request(app).post('/contacts').set('Authorization', `Bearer ${tokenAgent}`).send({ name: 'Before', email: 'before@test.com', phone: '9000000222' });
      expect(res.status).toBe(403);
      // Grant create
      await prisma.rolePermission.create({ data: { organizationId: orgA.id, roleId: roleAgentA.id, permissionId: permContactCreate.id, scope: 'ORGANIZATION' } });
      res = await request(app).post('/contacts').set('Authorization', `Bearer ${tokenAgent}`).send({ name: 'After', email: 'after@test.com', phone: '9000000233' });
      expect(res.status).toBe(201);
      // Revoke
      await prisma.rolePermission.deleteMany({ where: { roleId: roleAgentA.id, permissionId: permContactCreate.id } });
      res = await request(app).post('/contacts').set('Authorization', `Bearer ${tokenAgent}`).send({ name: 'AfterRevoke', email: 'afterrevoke@test.com', phone: '9000000244' });
      expect(res.status).toBe(403);
    });
  });

  // Merge tests
  describe('Merge', () => {
    test('successful merge migrates requirements and soft-deletes duplicate', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const c1 = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'Survivor', email: 'survivor@test.com', phone: '9000000301' });
      const c2 = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'Dup', email: 'dupmerge@test.com', phone: '9000000302' });
      // Create requirement for duplicate
      const req = await request(app).post(`/contacts/${c2.body.contact.id}/requirements`).set('Authorization', `Bearer ${token}`).send({ unitTypePreference: '2BHK', budgetMin: 5000000 });
      expect(req.status).toBe(201);
      // Merge c2 into c1 (c2 is duplicate loser, c1 survivor)
      const mergeRes = await request(app).post(`/contacts/${c2.body.contact.id}/merge`).set('Authorization', `Bearer ${token}`).send({ targetId: c1.body.contact.id });
      expect(mergeRes.status).toBe(200);
      expect(mergeRes.body.survivor.id).toBe(c1.body.contact.id);
      // Requirement should now belong to survivor
      const reqAfter = await request(app).get(`/requirements/${req.body.id}`).set('Authorization', `Bearer ${token}`);
      expect(reqAfter.body.contactId).toBe(c1.body.contact.id);
      // Duplicate should be soft-deleted
      const getDup = await request(app).get(`/contacts/${c2.body.contact.id}`).set('Authorization', `Bearer ${token}`);
      expect(getDup.status).toBe(404);
      const rawDup = await prisma.contact.findFirst({ where: { id: c2.body.contact.id } });
      expect(rawDup.deletedAt).not.toBeNull();
    });

    test('cross-tenant merge rejected', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const cA = await request(app).post('/contacts').set('Authorization', `Bearer ${tokenA}`).send({ name: 'CA', email: 'ca@test.com', phone: '9000000311' });
      const cB = await request(app).post('/contacts').set('Authorization', `Bearer ${tokenB}`).send({ name: 'CB', email: 'cb@test.com', phone: '9000000322' });
      const res = await request(app).post(`/contacts/${cA.body.contact.id}/merge`).set('Authorization', `Bearer ${tokenB}`).send({ targetId: cB.body.contact.id });
      expect([404, 403]).toContain(res.status);
    });

    test('self-merge rejected', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const c1 = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'Self', email: 'self@test.com', phone: '9000000501' });
      const res = await request(app).post(`/contacts/${c1.body.contact.id}/merge`).set('Authorization', `Bearer ${token}`).send({ targetId: c1.body.contact.id });
      expect(res.status).toBe(400);
    });

    test('deleted source rejected', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const c1 = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'SrcDel', email: 'srcdel@test.com', phone: '9000000502' });
      const c2 = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'Tgt', email: 'tgt@test.com', phone: '9000000503' });
      await request(app).delete(`/contacts/${c1.body.contact.id}`).set('Authorization', `Bearer ${token}`);
      const res = await request(app).post(`/contacts/${c1.body.contact.id}/merge`).set('Authorization', `Bearer ${token}`).send({ targetId: c2.body.contact.id });
      // Soft-deleted source is already merged/gone → 409
      expect(res.status).toBe(409);
    });

    test('deleted target rejected', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const c1 = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'Src2', email: 'src2@test.com', phone: '9000000504' });
      const c2 = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'TgtDel', email: 'tgtdel@test.com', phone: '9000000505' });
      await request(app).delete(`/contacts/${c2.body.contact.id}`).set('Authorization', `Bearer ${token}`);
      const res = await request(app).post(`/contacts/${c1.body.contact.id}/merge`).set('Authorization', `Bearer ${token}`).send({ targetId: c2.body.contact.id });
      // Soft-deleted target is invisible to tenant wrapper → 404
      expect([400, 404]).toContain(res.status);
    });

    test('repeated merge returns 409', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const c1 = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'Rep1', email: 'rep1@test.com', phone: '9000000506' });
      const c2 = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'Rep2', email: 'rep2@test.com', phone: '9000000507' });
      const r1 = await request(app).post(`/contacts/${c1.body.contact.id}/merge`).set('Authorization', `Bearer ${token}`).send({ targetId: c2.body.contact.id });
      expect(r1.status).toBe(200);
      const r2 = await request(app).post(`/contacts/${c1.body.contact.id}/merge`).set('Authorization', `Bearer ${token}`).send({ targetId: c2.body.contact.id });
      // Source is soft-deleted after first merge → 409 already merged
      expect(r2.status).toBe(409);
    });

    test('requirements migrated exactly once on merge', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const survivor = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'Surv', email: 'surv@test.com', phone: '9000000508' });
      const dup = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'Dup', email: 'dup.once@test.com', phone: '9000000509' });
      const req1 = await request(app).post(`/contacts/${dup.body.contact.id}/requirements`).set('Authorization', `Bearer ${token}`).send({ unitTypePreference: '2BHK', budgetMin: 5000000 });
      const req2 = await request(app).post(`/contacts/${dup.body.contact.id}/requirements`).set('Authorization', `Bearer ${token}`).send({ unitTypePreference: '3BHK', budgetMax: 10000000 });
      expect(req1.status).toBe(201);
      expect(req2.status).toBe(201);
      await request(app).post(`/contacts/${dup.body.contact.id}/merge`).set('Authorization', `Bearer ${token}`).send({ targetId: survivor.body.contact.id });
      const list = await request(app).get(`/contacts/${survivor.body.contact.id}/requirements`).set('Authorization', `Bearer ${token}`);
      const ids = list.body.map((r) => r.id).sort();
      expect(ids).toContain(req1.body.id);
      expect(ids).toContain(req2.body.id);
      expect(list.body.length).toBe(2);
    });

    test('concurrent merge of same pair: one succeeds, one gets 409', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const c1 = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'Conc1', email: 'conc1@test.com', phone: '9000000510' });
      const c2 = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'Conc2', email: 'conc2@test.com', phone: '9000000511' });
      const p1 = request(app).post(`/contacts/${c1.body.contact.id}/merge`).set('Authorization', `Bearer ${token}`).send({ targetId: c2.body.contact.id });
      const p2 = request(app).post(`/contacts/${c1.body.contact.id}/merge`).set('Authorization', `Bearer ${token}`).send({ targetId: c2.body.contact.id });
      const [r1, r2] = await Promise.all([p1, p2]);
      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual([200, 409]);
    });

    test('concurrent merge X->Y and X->Z: exactly one succeeds, requirements only on winner', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const x = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'SrcX', email: 'srcx@test.com', phone: '9000000512' });
      const y = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'TgtY', email: 'tgty@test.com', phone: '9000000513' });
      const z = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'TgtZ', email: 'tgtz@test.com', phone: '9000000514' });
      const req = await request(app).post(`/contacts/${x.body.contact.id}/requirements`).set('Authorization', `Bearer ${token}`).send({ unitTypePreference: '2BHK', budgetMin: 5000000 });
      expect(req.status).toBe(201);
      const pY = request(app).post(`/contacts/${x.body.contact.id}/merge`).set('Authorization', `Bearer ${token}`).send({ targetId: y.body.contact.id });
      const pZ = request(app).post(`/contacts/${x.body.contact.id}/merge`).set('Authorization', `Bearer ${token}`).send({ targetId: z.body.contact.id });
      const [rY, rZ] = await Promise.all([pY, pZ]);
      const statuses = [rY.status, rZ.status].sort();
      expect(statuses).toEqual([200, 409]);
      // Winner is whichever returned 200; requirement must live only on the winner
      const winnerId = rY.status === 200 ? y.body.contact.id : z.body.contact.id;
      const loserId = rY.status === 200 ? z.body.contact.id : y.body.contact.id;
      const reqAfter = await request(app).get(`/requirements/${req.body.id}`).set('Authorization', `Bearer ${token}`);
      expect(reqAfter.body.contactId).toBe(winnerId);
      const loserReqs = await request(app).get(`/contacts/${loserId}/requirements`).set('Authorization', `Bearer ${token}`);
      expect(loserReqs.body.find((r) => r.id === req.body.id)).toBeUndefined();
      // Source is merged (invisible)
      const getX = await request(app).get(`/contacts/${x.body.contact.id}`).set('Authorization', `Bearer ${token}`);
      expect(getX.status).toBe(404);
    });

    // Fixtures for reassignment tests: project + intake lead (+deal, +visit) per contact.
    async function mergeProject(token, tag) {
      return prisma.project.create({ data: { name: `${tag}-${Date.now()}`, organizationId: orgA.id } });
    }
    async function intakeLead(token, { name, email, phone, projectId }) {
      const body = { channel: 'WALK_IN', contactName: name, phone, email };
      if (projectId) body.projectId = projectId;
      const res = await request(app).post('/enquiries').set('Authorization', `Bearer ${token}`).send(body);
      expect(res.status).toBe(201);
      return prisma.lead.findFirst({ where: { id: res.body.lead.id } });
    }
    async function makeDealFor(token, leadId) {
      const res = await request(app).post('/deals').set('Authorization', `Bearer ${token}`).send({ leadId });
      expect(res.status).toBe(201);
      return res.body;
    }
    async function makeVisitFor(token, { contactId, projectId, dealId }) {
      const res = await request(app)
        .post('/site-visits')
        .set('Authorization', `Bearer ${token}`)
        .send({ agentId: userAdminA.id, projectId, contactId, dealId, scheduledAt: new Date(Date.now() + 24 * 3600000).toISOString() });
      expect(res.status).toBe(201);
      return res.body.siteVisit;
    }

    test('merge reassigns enquiries and leads to survivor', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const s = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'SurvEL', email: 'survel@test.com', phone: '9100000101' });
      const d = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'DupEL', email: 'dupel@test.com', phone: '9100000102' });
      const project = await mergeProject(token, 'ProjEL');
      await intakeLead(token, { name: 'DupEL', email: 'dupel@test.com', phone: '9100000102', projectId: project.id });
      const mergeRes = await request(app).post(`/contacts/${d.body.contact.id}/merge`).set('Authorization', `Bearer ${token}`).send({ targetId: s.body.contact.id });
      expect(mergeRes.status).toBe(200);
      const enquiries = await prisma.enquiry.findMany({ where: { contactId: s.body.contact.id } });
      expect(enquiries.length).toBeGreaterThan(0);
      expect(await prisma.enquiry.count({ where: { contactId: d.body.contact.id } })).toBe(0);
      const lead = await prisma.lead.findFirst({ where: { contactId: s.body.contact.id, projectId: project.id } });
      expect(lead).not.toBeNull();
      expect(lead.status).toBe('OPEN');
    });

    test('merge reassigns deals with lead consistency intact', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const s = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'SurvD', email: 'survd@test.com', phone: '9100000201' });
      const d = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'DupD', email: 'dupd@test.com', phone: '9100000202' });
      const project = await mergeProject(token, 'ProjD');
      const lead = await intakeLead(token, { name: 'DupD', email: 'dupd@test.com', phone: '9100000202', projectId: project.id });
      const deal = await makeDealFor(token, lead.id);
      const mergeRes = await request(app).post(`/contacts/${d.body.contact.id}/merge`).set('Authorization', `Bearer ${token}`).send({ targetId: s.body.contact.id });
      expect(mergeRes.status).toBe(200);
      const dealAfter = await prisma.deal.findFirst({ where: { id: deal.id } });
      const leadAfter = await prisma.lead.findFirst({ where: { id: lead.id } });
      expect(dealAfter.contactId).toBe(s.body.contact.id);
      expect(leadAfter.contactId).toBe(s.body.contact.id);
      expect(dealAfter.leadId).toBe(lead.id);
      expect(leadAfter.id).toBe(dealAfter.leadId);
    });

    test('merge reassigns site visits to survivor', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const s = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'SurvV', email: 'survv@test.com', phone: '9100000301' });
      const d = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'DupV', email: 'dupv@test.com', phone: '9100000302' });
      const project = await mergeProject(token, 'ProjV');
      const lead = await intakeLead(token, { name: 'DupV', email: 'dupv@test.com', phone: '9100000302', projectId: project.id });
      const deal = await makeDealFor(token, lead.id);
      const visit = await makeVisitFor(token, { contactId: d.body.contact.id, projectId: project.id, dealId: deal.id });
      const mergeRes = await request(app).post(`/contacts/${d.body.contact.id}/merge`).set('Authorization', `Bearer ${token}`).send({ targetId: s.body.contact.id });
      expect(mergeRes.status).toBe(200);
      const visitAfter = await prisma.siteVisit.findFirst({ where: { id: visit.id } });
      expect(visitAfter.contactId).toBe(s.body.contact.id);
      expect(visitAfter.dealId).toBe(deal.id);
      expect(await prisma.siteVisit.count({ where: { contactId: d.body.contact.id } })).toBe(0);
    });

    test('combined merge reassigns all relation types then soft-deletes duplicate', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const s = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'SurvAll', email: 'survall@test.com', phone: '9100000401' });
      const d = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'DupAll', email: 'dupall@test.com', phone: '9100000402' });
      const project = await mergeProject(token, 'ProjAll');
      const req = await request(app).post(`/contacts/${d.body.contact.id}/requirements`).set('Authorization', `Bearer ${token}`).send({ unitTypePreference: '2BHK' });
      expect(req.status).toBe(201);
      const lead = await intakeLead(token, { name: 'DupAll', email: 'dupall@test.com', phone: '9100000402', projectId: project.id });
      const deal = await makeDealFor(token, lead.id);
      const visit = await makeVisitFor(token, { contactId: d.body.contact.id, projectId: project.id, dealId: deal.id });
      const mergeRes = await request(app).post(`/contacts/${d.body.contact.id}/merge`).set('Authorization', `Bearer ${token}`).send({ targetId: s.body.contact.id });
      expect(mergeRes.status).toBe(200);
      const sid = s.body.contact.id, did = d.body.contact.id;
      expect((await prisma.requirement.findFirst({ where: { id: req.body.id } })).contactId).toBe(sid);
      expect(await prisma.enquiry.count({ where: { contactId: did } })).toBe(0);
      expect((await prisma.lead.findFirst({ where: { id: lead.id } })).contactId).toBe(sid);
      expect((await prisma.deal.findFirst({ where: { id: deal.id } })).contactId).toBe(sid);
      expect((await prisma.siteVisit.findFirst({ where: { id: visit.id } })).contactId).toBe(sid);
      const rawDup = await prisma.contact.findFirst({ where: { id: did } });
      expect(rawDup.deletedAt).not.toBeNull();
      expect(rawDup.consentSource).toBe(`merged_into:${sid}`);
      expect((await request(app).get(`/contacts/${did}`).set('Authorization', `Bearer ${token}`)).status).toBe(404);
    });

    test('OPEN lead conflict moves duplicate lead as DISQUALIFIED without duplicate OPEN', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const s = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'SurvC', email: 'survc@test.com', phone: '9100000501' });
      const d = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'DupC', email: 'dupc@test.com', phone: '9100000502' });
      const project = await mergeProject(token, 'ProjC');
      const leadA = await intakeLead(token, { name: 'SurvC', email: 'survc@test.com', phone: '9100000501', projectId: project.id });
      const leadB = await intakeLead(token, { name: 'DupC', email: 'dupc@test.com', phone: '9100000502', projectId: project.id });
      const mergeRes = await request(app).post(`/contacts/${d.body.contact.id}/merge`).set('Authorization', `Bearer ${token}`).send({ targetId: s.body.contact.id });
      expect(mergeRes.status).toBe(200);
      // No duplicate OPEN lead for the same contact + project
      expect(await prisma.lead.count({ where: { contactId: s.body.contact.id, projectId: project.id, status: 'OPEN', deletedAt: null } })).toBe(1);
      // Survivor's own lead untouched and still OPEN
      expect((await prisma.lead.findFirst({ where: { id: leadA.id } })).status).toBe('OPEN');
      // Duplicate's lead moved as DISQUALIFIED — reconciliation parking, not a verdict
      const moved = await prisma.lead.findFirst({ where: { id: leadB.id } });
      expect(moved.contactId).toBe(s.body.contact.id);
      expect(moved.status).toBe('DISQUALIFIED');
      // Row otherwise untouched: same project, origin, assignment
      expect(moved.projectId).toBe(project.id);
      expect(moved.originEnquiryId).toBe(leadB.originEnquiryId);
      expect(moved.assignedAgentId).toBe(leadB.assignedAgentId);
      // History preserved: origin enquiry moved to survivor but still linked
      const origin = await prisma.enquiry.findFirst({ where: { id: leadB.originEnquiryId } });
      expect(origin.contactId).toBe(s.body.contact.id);
      expect(origin.linkedLeadId).toBe(leadB.id);
    });

    test('reconciled lead reopens only when the slot frees (not terminal)', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const s = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'SurvR', email: 'survr@test.com', phone: '9100000601' });
      const d = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'DupR', email: 'dupr@test.com', phone: '9100000602' });
      const project = await mergeProject(token, 'ProjR');
      const leadA = await intakeLead(token, { name: 'SurvR', email: 'survr@test.com', phone: '9100000601', projectId: project.id });
      const leadB = await intakeLead(token, { name: 'DupR', email: 'dupr@test.com', phone: '9100000602', projectId: project.id });
      await request(app).post(`/contacts/${d.body.contact.id}/merge`).set('Authorization', `Bearer ${token}`).send({ targetId: s.body.contact.id });
      // Slot occupied → reopen refused by the uniqueness guard, not by stigma
      const blocked = await request(app).patch(`/leads/${leadB.id}`).set('Authorization', `Bearer ${token}`).send({ status: 'OPEN' });
      expect(blocked.status).toBe(409);
      // Slot frees → the reconciled lead reopens like any disqualified lead
      const closeA = await request(app).patch(`/leads/${leadA.id}`).set('Authorization', `Bearer ${token}`).send({ status: 'DISQUALIFIED' });
      expect(closeA.status).toBe(200);
      const reopen = await request(app).patch(`/leads/${leadB.id}`).set('Authorization', `Bearer ${token}`).send({ status: 'OPEN' });
      expect(reopen.status).toBe(200);
      expect(await prisma.lead.count({ where: { contactId: s.body.contact.id, projectId: project.id, status: 'OPEN', deletedAt: null } })).toBe(1);
    });

    test('failed merge performs zero writes across all relations', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const s = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'SurvF', email: 'survf@test.com', phone: '9100000701' });
      const d = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'DupF', email: 'dupf@test.com', phone: '9100000702' });
      const project = await mergeProject(token, 'ProjF');
      const lead = await intakeLead(token, { name: 'DupF', email: 'dupf@test.com', phone: '9100000702', projectId: project.id });
      await makeDealFor(token, lead.id);
      const res = await request(app).post(`/contacts/${d.body.contact.id}/merge`).set('Authorization', `Bearer ${token}`).send({ targetId: '00000000-0000-4000-8000-000000000000' });
      expect(res.status).toBe(404);
      const did = d.body.contact.id;
      expect((await request(app).get(`/contacts/${did}`).set('Authorization', `Bearer ${token}`)).status).toBe(200);
      expect(await prisma.enquiry.count({ where: { contactId: did } })).toBeGreaterThan(0);
      expect((await prisma.lead.findFirst({ where: { id: lead.id } })).contactId).toBe(did);
      expect(await prisma.deal.count({ where: { contactId: did } })).toBe(1);
      expect((await prisma.contact.findFirst({ where: { id: did } })).deletedAt).toBeNull();
    });

    test('cross-tenant merge reassigns nothing', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const cA = await request(app).post('/contacts').set('Authorization', `Bearer ${tokenA}`).send({ name: 'CTenantA', email: 'ctenanta@test.com', phone: '9100000801' });
      const cB = await request(app).post('/contacts').set('Authorization', `Bearer ${tokenB}`).send({ name: 'CTenantB', email: 'ctenantb@test.com', phone: '9100000802' });
      const project = await prisma.project.create({ data: { name: `ProjX-${Date.now()}`, organizationId: orgA.id } });
      await intakeLead(tokenA, { name: 'CTenantA', email: 'ctenanta@test.com', phone: '9100000801', projectId: project.id });
      const res = await request(app).post(`/contacts/${cA.body.contact.id}/merge`).set('Authorization', `Bearer ${tokenA}`).send({ targetId: cB.body.contact.id });
      expect([403, 404]).toContain(res.status);
      expect((await prisma.lead.findFirst({ where: { contactId: cA.body.contact.id, projectId: project.id } })).contactId).toBe(cA.body.contact.id);
      expect(await prisma.enquiry.count({ where: { contactId: cA.body.contact.id } })).toBeGreaterThan(0);
      expect((await prisma.contact.findFirst({ where: { id: cA.body.contact.id } })).deletedAt).toBeNull();
    });

    test('concurrent merge loser leaves no partial reassignment', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const x = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'SrcXP', email: 'srcxp@test.com', phone: '9100000901' });
      const y = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'TgtYP', email: 'tgtyp@test.com', phone: '9100000902' });
      const z = await request(app).post('/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'TgtZP', email: 'tgtzp@test.com', phone: '9100000903' });
      const project = await mergeProject(token, 'ProjP');
      const lead = await intakeLead(token, { name: 'SrcXP', email: 'srcxp@test.com', phone: '9100000901', projectId: project.id });
      const deal = await makeDealFor(token, lead.id);
      const visit = await makeVisitFor(token, { contactId: x.body.contact.id, projectId: project.id, dealId: deal.id });
      const pY = request(app).post(`/contacts/${x.body.contact.id}/merge`).set('Authorization', `Bearer ${token}`).send({ targetId: y.body.contact.id });
      const pZ = request(app).post(`/contacts/${x.body.contact.id}/merge`).set('Authorization', `Bearer ${token}`).send({ targetId: z.body.contact.id });
      const [rY, rZ] = await Promise.all([pY, pZ]);
      expect([rY.status, rZ.status].sort()).toEqual([200, 409]);
      const winnerId = rY.status === 200 ? y.body.contact.id : z.body.contact.id;
      expect((await prisma.lead.findFirst({ where: { id: lead.id } })).contactId).toBe(winnerId);
      expect((await prisma.deal.findFirst({ where: { id: deal.id } })).contactId).toBe(winnerId);
      expect((await prisma.siteVisit.findFirst({ where: { id: visit.id } })).contactId).toBe(winnerId);
      expect(await prisma.enquiry.count({ where: { contactId: x.body.contact.id } })).toBe(0);
    });
  });

  // Regression 31
  describe('Regression', () => {
    test('31. Health still works', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
    test('tenant isolation still enforced for contacts', async () => {
      const tenantA = createTenantPrisma(orgA.id);
      const contactA = await tenantA.contact.create({ data: { name: 'Iso', email: 'iso@test.com', normalizedEmail: 'iso@test.com', phone: '9000000400', normalizedPhone: '9000000400' } });
      const tenantB = createTenantPrisma(orgB.id);
      const found = await tenantB.contact.findUnique({ where: { id: contactA.id } });
      expect(found).toBeNull();
    });
  });
});
