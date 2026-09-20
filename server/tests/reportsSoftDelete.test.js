// Reports groupBy soft-delete exclusion (hardening pass): the tenant
// wrapper injects deletedAt on count/findMany but NOT on groupBy, so report
// services must exclude soft-deleted rows explicitly. Soft-deleted deals,
// leads, tasks, contacts, units and projects must not appear in report
// distributions.
const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/lib/prisma');
const { hashPassword } = require('../src/lib/bcrypt');

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

let phoneCtr = 9860000000;

describe('reports exclude soft-deleted rows', () => {
  let org, token, admin, leadId, dealId, taskId, contactId, unitId, projectId;

  const PERMS = [
    ['contact', 'create'], ['contact', 'read'],
    ['enquiry', 'create'],
    ['deal', 'create'], ['deal', 'read'],
    ['lead', 'read'],
    ['task', 'read'],
    ['unit', 'read'],
  ];

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

  beforeAll(async () => {
    await wipeAll();
    org = await prisma.organization.create({ data: { name: uid('OrgSD') } });
    const role = await prisma.role.create({ data: { name: 'Admin', organizationId: org.id } });
    for (const [resource, action] of PERMS) {
      let perm = await prisma.permission.findFirst({ where: { resource, action } });
      if (!perm) perm = await prisma.permission.create({ data: { resource, action } });
      await prisma.rolePermission.create({
        data: { organizationId: org.id, roleId: role.id, permissionId: perm.id, scope: 'ORGANIZATION' },
      });
    }
    admin = await prisma.user.create({
      data: {
        name: 'AdminSD',
        email: `${uid('sd-admin')}@test.com`,
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
    token = login.body.accessToken;
    const auth = (r) => r.set('Authorization', `Bearer ${token}`);

    phoneCtr += 1;
    const contactRes = await auth(request(app).post('/contacts')).send({
      name: `SD Person ${phoneCtr}`,
      phone: String(phoneCtr),
      email: `sd-${phoneCtr}@test.com`,
    });
    expect(contactRes.status).toBe(201);
    contactId = contactRes.body.contact.id;

    const enquiryRes = await auth(request(app).post('/enquiries')).send({
      channel: 'WALK_IN',
      contactName: `SD Person ${phoneCtr}`,
      phone: String(phoneCtr),
      email: `sd-${phoneCtr}@test.com`,
    });
    expect(enquiryRes.status).toBe(201);
    leadId = enquiryRes.body.lead.id;

    const dealRes = await auth(request(app).post('/deals')).send({ leadId });
    expect(dealRes.status).toBe(201);
    dealId = dealRes.body.id;

    const task = await prisma.task.create({
      data: {
        organizationId: org.id,
        assignedTo: admin.id,
        title: 'SD follow up',
        dueAt: new Date(Date.now() + 86400000),
        createdBy: admin.id,
      },
    });
    taskId = task.id;

    const project = await prisma.project.create({ data: { name: uid('ProjSD'), organizationId: org.id } });
    projectId = project.id;
    const unit = await prisma.unit.create({
      data: { identifier: 'SD-101', projectId: project.id, organizationId: org.id },
    });
    unitId = unit.id;

    // Sanity: everything visible before soft deletion.
    const before = await auth(request(app).get('/reports/deals'));
    expect(before.body.created).toBe(1);

    const now = new Date();
    await prisma.deal.update({ where: { id: dealId }, data: { deletedAt: now } });
    await prisma.lead.update({ where: { id: leadId }, data: { deletedAt: now } });
    await prisma.task.update({ where: { id: taskId }, data: { deletedAt: now } });
    await prisma.contact.update({ where: { id: contactId }, data: { deletedAt: now } });
    await prisma.unit.update({ where: { id: unitId }, data: { deletedAt: now } });
    await prisma.project.update({ where: { id: projectId }, data: { deletedAt: now } });
  });

  afterAll(async () => {
    await wipeAll();
    await prisma.$disconnect();
  });

  test('deals report excludes soft-deleted deals', async () => {
    const res = await request(app).get('/reports/deals').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(0);
    expect(res.body.byStage).toEqual([]);
    expect(res.body.lostReasons).toEqual([]);
  });

  test('leads report excludes soft-deleted leads', async () => {
    const res = await request(app).get('/reports/leads').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(0);
    expect(res.body.byStatus).toEqual([]);
  });

  test('tasks report excludes soft-deleted tasks', async () => {
    const res = await request(app).get('/reports/tasks').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(0);
    expect(res.body.byStatus).toEqual([]);
  });

  test('contacts report excludes soft-deleted contacts', async () => {
    const res = await request(app).get('/reports/contacts').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(0);
    expect(res.body.byConsent).toEqual([]);
  });

  test('inventory report excludes soft-deleted units and projects', async () => {
    const res = await request(app).get('/reports/inventory').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.unitsByAvailability).toEqual([]);
    expect(res.body.projectsByStatus).toEqual([]);
  });
});
