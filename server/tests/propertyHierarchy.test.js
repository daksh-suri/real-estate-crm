const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/lib/prisma');
const { hashPassword } = require('../src/lib/bcrypt');
const { createTenantPrisma } = require('../src/lib/tenant');

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

describe('Checkpoint 6 — Property Hierarchy', () => {
  let orgA, orgB;
  let roleAdminA, roleAgentA, roleAdminB;
  let userAdminA, userAgentA, userAdminB;
  let plainAdminA = 'AdminPass123!';
  let plainAgentA = 'AgentPass123!';
  let plainAdminB = 'AdminBPass123!';

  const projectPerms = {};
  const unitPerms = {};
  let permReqCreate, permReqRead, permReqUpdate;

  beforeAll(async () => {
    await prisma.refreshToken.deleteMany({});
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

    orgA = await prisma.organization.create({ data: { name: uid('OrgA') } });
    orgB = await prisma.organization.create({ data: { name: uid('OrgB') } });

    for (const action of ['create', 'read', 'update', 'delete']) {
      projectPerms[action] = await prisma.permission.create({ data: { resource: 'project', action } });
      unitPerms[action] = await prisma.permission.create({ data: { resource: 'unit', action } });
    }
    permReqCreate = await prisma.permission.create({ data: { resource: 'requirement', action: 'create' } });
    permReqRead = await prisma.permission.create({ data: { resource: 'requirement', action: 'read' } });
    permReqUpdate = await prisma.permission.create({ data: { resource: 'requirement', action: 'update' } });

    roleAdminA = await prisma.role.create({ data: { name: 'Admin', organizationId: orgA.id } });
    roleAgentA = await prisma.role.create({ data: { name: 'Agent', organizationId: orgA.id } });
    roleAdminB = await prisma.role.create({ data: { name: 'Admin', organizationId: orgB.id } });

    const adminPerms = [...Object.values(projectPerms), ...Object.values(unitPerms), permReqCreate, permReqRead, permReqUpdate];
    for (const perm of adminPerms) {
      await prisma.rolePermission.create({ data: { organizationId: orgA.id, roleId: roleAdminA.id, permissionId: perm.id, scope: 'ORGANIZATION' } });
      await prisma.rolePermission.create({ data: { organizationId: orgB.id, roleId: roleAdminB.id, permissionId: perm.id, scope: 'ORGANIZATION' } });
    }
    for (const perm of [projectPerms.read, unitPerms.read]) {
      await prisma.rolePermission.create({ data: { organizationId: orgA.id, roleId: roleAgentA.id, permissionId: perm.id, scope: 'ORGANIZATION' } });
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
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.requirement.deleteMany({});
    await prisma.unit.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.contact.deleteMany({});
    await prisma.refreshToken.deleteMany({});
  });

  async function login(email, password, organizationId) {
    const res = await request(app).post('/auth/login').send({ email, password, organizationId });
    expect(res.status).toBe(200);
    return res.body.accessToken;
  }

  async function makeContact(orgId, tag) {
    return prisma.contact.create({
      data: {
        name: `Contact ${tag}`,
        organizationId: orgId,
        email: uid(`c-${tag}`) + '@test.com',
        normalizedEmail: uid(`cn-${tag}`) + '@test.com',
        phone: `91${Math.floor(100000000 + Math.random() * 900000000)}`,
        normalizedPhone: `${Math.floor(1000000000 + Math.random() * 9000000000)}`,
      },
    });
  }

  // -------------------------------------------------------------------------
  describe('Project CRUD', () => {
    test('creates project with defaults', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const res = await request(app).post('/projects').set('Authorization', `Bearer ${token}`).send({ name: 'Sunrise Towers', location: 'Pune' });
      expect(res.status).toBe(201);
      expect(res.body.organizationId).toBe(orgA.id);
      expect(res.body.name).toBe('Sunrise Towers');
      expect(res.body.status).toBe('ACTIVE');
    });

    test('missing name fails 400; invalid status fails 400', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const r1 = await request(app).post('/projects').set('Authorization', `Bearer ${token}`).send({ location: 'Pune' });
      expect(r1.status).toBe(400);
      const r2 = await request(app).post('/projects').set('Authorization', `Bearer ${token}`).send({ name: 'X', status: 'SOLD' });
      expect(r2.status).toBe(400);
    });

    test('duplicate name in same org 409; same name in other org 201', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const r1 = await request(app).post('/projects').set('Authorization', `Bearer ${tokenA}`).send({ name: 'Dup Project' });
      expect(r1.status).toBe(201);
      const r2 = await request(app).post('/projects').set('Authorization', `Bearer ${tokenA}`).send({ name: 'Dup Project' });
      expect(r2.status).toBe(409);
      const r3 = await request(app).post('/projects').set('Authorization', `Bearer ${tokenB}`).send({ name: 'Dup Project' });
      expect(r3.status).toBe(201);
    });

    test('get/list/update project', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const created = await request(app).post('/projects').set('Authorization', `Bearer ${token}`).send({ name: 'GetMe', location: 'Mumbai' });
      const get = await request(app).get(`/projects/${created.body.id}`).set('Authorization', `Bearer ${token}`);
      expect(get.status).toBe(200);
      expect(get.body.name).toBe('GetMe');
      const list = await request(app).get('/projects?search=GetMe').set('Authorization', `Bearer ${token}`);
      expect(list.body.find((p) => p.id === created.body.id)).toBeDefined();
      const upd = await request(app).patch(`/projects/${created.body.id}`).set('Authorization', `Bearer ${token}`).send({ status: 'ON_HOLD', location: 'Thane' });
      expect(upd.status).toBe(200);
      expect(upd.body.status).toBe('ON_HOLD');
      expect(upd.body.location).toBe('Thane');
    });

    test('rename conflict 409', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      await request(app).post('/projects').set('Authorization', `Bearer ${token}`).send({ name: 'Taken' });
      const other = await request(app).post('/projects').set('Authorization', `Bearer ${token}`).send({ name: 'Other' });
      const upd = await request(app).patch(`/projects/${other.body.id}`).set('Authorization', `Bearer ${token}`).send({ name: 'Taken' });
      expect(upd.status).toBe(409);
    });

    test('soft delete hides project from reads but preserves row', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const created = await request(app).post('/projects').set('Authorization', `Bearer ${token}`).send({ name: 'DeleteMe' });
      const del = await request(app).delete(`/projects/${created.body.id}`).set('Authorization', `Bearer ${token}`);
      expect(del.status).toBe(200);
      const get = await request(app).get(`/projects/${created.body.id}`).set('Authorization', `Bearer ${token}`);
      expect(get.status).toBe(404);
      const list = await request(app).get('/projects').set('Authorization', `Bearer ${token}`);
      expect(list.body.find((p) => p.id === created.body.id)).toBeUndefined();
      const raw = await prisma.project.findFirst({ where: { id: created.body.id } });
      expect(raw.deletedAt).not.toBeNull();
    });

    test('client-supplied organizationId is ignored', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const res = await request(app).post('/projects').set('Authorization', `Bearer ${token}`).send({ name: 'Hack', organizationId: orgB.id });
      expect(res.status).toBe(201);
      expect(res.body.organizationId).toBe(orgA.id);
    });
  });

  // -------------------------------------------------------------------------
  describe('Unit CRUD', () => {
    test('creates unit with defaults under project', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const proj = await request(app).post('/projects').set('Authorization', `Bearer ${token}`).send({ name: 'UProj' });
      const res = await request(app).post(`/projects/${proj.body.id}/units`).set('Authorization', `Bearer ${token}`).send({ identifier: 'A-101', totalCost: 7500000 });
      expect(res.status).toBe(201);
      expect(res.body.projectId).toBe(proj.body.id);
      expect(res.body.organizationId).toBe(orgA.id);
      expect(res.body.availabilityStatus).toBe('AVAILABLE');
      expect(String(res.body.totalCost)).toBe('7500000');
    });

    test('creation availability guard: only AVAILABLE/BLOCKED allowed', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const proj = await request(app).post('/projects').set('Authorization', `Bearer ${token}`).send({ name: 'AvailGuard' });
      const create = (identifier, body) => request(app).post(`/projects/${proj.body.id}/units`).set('Authorization', `Bearer ${token}`).send({ identifier, ...body });
      // 1. omitted → AVAILABLE
      const omitted = await create('AG-OMIT', {});
      expect(omitted.status).toBe(201);
      expect(omitted.body.availabilityStatus).toBe('AVAILABLE');
      // 2. explicit AVAILABLE → accepted
      const avail = await create('AG-AVAIL', { availabilityStatus: 'AVAILABLE' });
      expect(avail.status).toBe(201);
      expect(avail.body.availabilityStatus).toBe('AVAILABLE');
      // 3. explicit BLOCKED → accepted
      const blocked = await create('AG-BLOCK', { availabilityStatus: 'BLOCKED' });
      expect(blocked.status).toBe(201);
      expect(blocked.body.availabilityStatus).toBe('BLOCKED');
      // 4-6. workflow-owned states → 400
      for (const [tag, status] of [['AG-RES', 'RESERVED'], ['AG-BKD', 'BOOKED'], ['AG-HOLD', 'ON_HOLD']]) {
        const res = await create(tag, { availabilityStatus: status });
        expect(res.status).toBe(400);
      }
      // 7. PATCH availabilityStatus remains rejected
      const patch = await request(app).patch(`/units/${omitted.body.id}`).set('Authorization', `Bearer ${token}`).send({ availabilityStatus: 'BLOCKED' });
      expect(patch.status).toBe(400);
      const get = await request(app).get(`/units/${omitted.body.id}`).set('Authorization', `Bearer ${token}`);
      expect(get.body.availabilityStatus).toBe('AVAILABLE');
    });

    test('duplicate identifier in same project 409; same identifier in other project 201', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const p1 = await request(app).post('/projects').set('Authorization', `Bearer ${token}`).send({ name: 'P1' });
      const p2 = await request(app).post('/projects').set('Authorization', `Bearer ${token}`).send({ name: 'P2' });
      const u1 = await request(app).post(`/projects/${p1.body.id}/units`).set('Authorization', `Bearer ${token}`).send({ identifier: 'A-101' });
      expect(u1.status).toBe(201);
      const u2 = await request(app).post(`/projects/${p1.body.id}/units`).set('Authorization', `Bearer ${token}`).send({ identifier: 'A-101' });
      expect(u2.status).toBe(409);
      const u3 = await request(app).post(`/projects/${p2.body.id}/units`).set('Authorization', `Bearer ${token}`).send({ identifier: 'A-101' });
      expect(u3.status).toBe(201);
    });

    test('validation: missing identifier 400, negative cost 400, bad status 400, bad project 404', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const proj = await request(app).post('/projects').set('Authorization', `Bearer ${token}`).send({ name: 'VProj' });
      const r1 = await request(app).post(`/projects/${proj.body.id}/units`).set('Authorization', `Bearer ${token}`).send({ totalCost: 100 });
      expect(r1.status).toBe(400);
      const r2 = await request(app).post(`/projects/${proj.body.id}/units`).set('Authorization', `Bearer ${token}`).send({ identifier: 'X', totalCost: -5 });
      expect(r2.status).toBe(400);
      const r3 = await request(app).post(`/projects/${proj.body.id}/units`).set('Authorization', `Bearer ${token}`).send({ identifier: 'X', availabilityStatus: 'SOLD' });
      expect(r3.status).toBe(400);
      const fakeId = '00000000-0000-4000-a000-000000000000';
      const r4 = await request(app).post(`/projects/${fakeId}/units`).set('Authorization', `Bearer ${token}`).send({ identifier: 'X' });
      expect(r4.status).toBe(404);
    });

    test('get/list units by project and global inventory list with filters', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const proj = await request(app).post('/projects').set('Authorization', `Bearer ${token}`).send({ name: 'LProj' });
      await request(app).post(`/projects/${proj.body.id}/units`).set('Authorization', `Bearer ${token}`).send({ identifier: 'B-201', availabilityStatus: 'BLOCKED' });
      await request(app).post(`/projects/${proj.body.id}/units`).set('Authorization', `Bearer ${token}`).send({ identifier: 'B-202' });
      const byProject = await request(app).get(`/projects/${proj.body.id}/units`).set('Authorization', `Bearer ${token}`);
      expect(byProject.body.length).toBe(2);
      const filtered = await request(app).get('/units?availabilityStatus=BLOCKED').set('Authorization', `Bearer ${token}`);
      expect(filtered.body.every((u) => u.availabilityStatus === 'BLOCKED')).toBe(true);
      expect(filtered.body.find((u) => u.identifier === 'B-201')).toBeDefined();
      const badFilter = await request(app).get('/units?availabilityStatus=SOLD').set('Authorization', `Bearer ${token}`);
      expect(badFilter.status).toBe(400);
    });

    test('update identifier/totalCost; conflict 409', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const proj = await request(app).post('/projects').set('Authorization', `Bearer ${token}`).send({ name: 'UPProj' });
      const u1 = await request(app).post(`/projects/${proj.body.id}/units`).set('Authorization', `Bearer ${token}`).send({ identifier: 'C-1', totalCost: 1000000 });
      await request(app).post(`/projects/${proj.body.id}/units`).set('Authorization', `Bearer ${token}`).send({ identifier: 'C-2' });
      const upd = await request(app).patch(`/units/${u1.body.id}`).set('Authorization', `Bearer ${token}`).send({ identifier: 'C-1B', totalCost: 2000000 });
      expect(upd.status).toBe(200);
      expect(upd.body.identifier).toBe('C-1B');
      expect(String(upd.body.totalCost)).toBe('2000000');
      const conflict = await request(app).patch(`/units/${u1.body.id}`).set('Authorization', `Bearer ${token}`).send({ identifier: 'C-2' });
      expect(conflict.status).toBe(409);
    });

    test('availabilityStatus cannot be edited directly; projectId is immutable', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const p1 = await request(app).post('/projects').set('Authorization', `Bearer ${token}`).send({ name: 'IP1' });
      const p2 = await request(app).post('/projects').set('Authorization', `Bearer ${token}`).send({ name: 'IP2' });
      const u = await request(app).post(`/projects/${p1.body.id}/units`).set('Authorization', `Bearer ${token}`).send({ identifier: 'D-1' });
      const r1 = await request(app).patch(`/units/${u.body.id}`).set('Authorization', `Bearer ${token}`).send({ availabilityStatus: 'RESERVED' });
      expect(r1.status).toBe(400);
      const r2 = await request(app).patch(`/units/${u.body.id}`).set('Authorization', `Bearer ${token}`).send({ projectId: p2.body.id });
      expect(r2.status).toBe(400);
      // State unchanged
      const get = await request(app).get(`/units/${u.body.id}`).set('Authorization', `Bearer ${token}`);
      expect(get.body.availabilityStatus).toBe('AVAILABLE');
      expect(get.body.projectId).toBe(p1.body.id);
    });

    test('soft delete hides unit but preserves row', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const proj = await request(app).post('/projects').set('Authorization', `Bearer ${token}`).send({ name: 'DProj' });
      const u = await request(app).post(`/projects/${proj.body.id}/units`).set('Authorization', `Bearer ${token}`).send({ identifier: 'E-1' });
      const del = await request(app).delete(`/units/${u.body.id}`).set('Authorization', `Bearer ${token}`);
      expect(del.status).toBe(200);
      const get = await request(app).get(`/units/${u.body.id}`).set('Authorization', `Bearer ${token}`);
      expect(get.status).toBe(404);
      const raw = await prisma.unit.findFirst({ where: { id: u.body.id } });
      expect(raw.deletedAt).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe('Project ↔ Unit integrity', () => {
    test('cannot create unit under soft-deleted project', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const proj = await request(app).post('/projects').set('Authorization', `Bearer ${token}`).send({ name: 'DelParent' });
      await request(app).delete(`/projects/${proj.body.id}`).set('Authorization', `Bearer ${token}`);
      const res = await request(app).post(`/projects/${proj.body.id}/units`).set('Authorization', `Bearer ${token}`).send({ identifier: 'F-1' });
      expect(res.status).toBe(400);
    });

    test('units survive project soft-delete; nested listing 404s', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const proj = await request(app).post('/projects').set('Authorization', `Bearer ${token}`).send({ name: 'ParentGone' });
      const u = await request(app).post(`/projects/${proj.body.id}/units`).set('Authorization', `Bearer ${token}`).send({ identifier: 'G-1' });
      await request(app).delete(`/projects/${proj.body.id}`).set('Authorization', `Bearer ${token}`);
      const direct = await request(app).get(`/units/${u.body.id}`).set('Authorization', `Bearer ${token}`);
      expect(direct.status).toBe(200);
      const nested = await request(app).get(`/projects/${proj.body.id}/units`).set('Authorization', `Bearer ${token}`);
      expect(nested.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('Requirement ↔ Project association', () => {
    test('requirement can prefer multiple same-org projects', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const p1 = await request(app).post('/projects').set('Authorization', `Bearer ${token}`).send({ name: 'RP1' });
      const p2 = await request(app).post('/projects').set('Authorization', `Bearer ${token}`).send({ name: 'RP2' });
      const contact = await makeContact(orgA.id, 'rp');
      const res = await request(app).post('/requirements').set('Authorization', `Bearer ${token}`).send({
        contactId: contact.id,
        unitTypePreference: '2BHK',
        preferredProjectIds: [p1.body.id, p2.body.id],
      });
      expect(res.status).toBe(201);
      expect(res.body.preferredProjectIds).toEqual(expect.arrayContaining([p1.body.id, p2.body.id]));
    });

    test('requirement cannot reference another org project → 403', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const pB = await request(app).post('/projects').set('Authorization', `Bearer ${tokenB}`).send({ name: 'Foreign' });
      const contact = await makeContact(orgA.id, 'xeno');
      const res = await request(app).post('/requirements').set('Authorization', `Bearer ${tokenA}`).send({
        contactId: contact.id,
        preferredProjectIds: [pB.body.id],
      });
      expect(res.status).toBe(403);
    });

    test('requirement with unknown project → 404; with deleted project → 400', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const contact = await makeContact(orgA.id, 'badref');
      const fakeId = '00000000-0000-4000-a000-000000000000';
      const r1 = await request(app).post('/requirements').set('Authorization', `Bearer ${token}`).send({
        contactId: contact.id,
        preferredProjectIds: [fakeId],
      });
      expect(r1.status).toBe(404);
      const p = await request(app).post('/projects').set('Authorization', `Bearer ${token}`).send({ name: 'SoonGone' });
      await request(app).delete(`/projects/${p.body.id}`).set('Authorization', `Bearer ${token}`);
      const r2 = await request(app).post('/requirements').set('Authorization', `Bearer ${token}`).send({
        contactId: contact.id,
        preferredProjectIds: [p.body.id],
      });
      expect(r2.status).toBe(400);
    });

    test('requirement update validates new preferred projects', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const pB = await request(app).post('/projects').set('Authorization', `Bearer ${tokenB}`).send({ name: 'UpdForeign' });
      const pA = await request(app).post('/projects').set('Authorization', `Bearer ${tokenA}`).send({ name: 'UpdLocal' });
      const contact = await makeContact(orgA.id, 'upd');
      const created = await request(app).post('/requirements').set('Authorization', `Bearer ${tokenA}`).send({ contactId: contact.id });
      expect(created.status).toBe(201);
      const bad = await request(app).patch(`/requirements/${created.body.id}`).set('Authorization', `Bearer ${tokenA}`).send({ preferredProjectIds: [pB.body.id] });
      expect(bad.status).toBe(403);
      const good = await request(app).patch(`/requirements/${created.body.id}`).set('Authorization', `Bearer ${tokenA}`).send({ preferredProjectIds: [pA.body.id] });
      expect(good.status).toBe(200);
      expect(good.body.preferredProjectIds).toContain(pA.body.id);
    });
  });

  // -------------------------------------------------------------------------
  describe('Tenant isolation attacks', () => {
    test('org B cannot GET/PATCH/DELETE org A project', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const p = await request(app).post('/projects').set('Authorization', `Bearer ${tokenA}`).send({ name: 'Secret' });
      expect(await request(app).get(`/projects/${p.body.id}`).set('Authorization', `Bearer ${tokenB}`).then((r) => r.status)).toBe(404);
      expect(await request(app).patch(`/projects/${p.body.id}`).set('Authorization', `Bearer ${tokenB}`).send({ name: 'Hack' }).then((r) => r.status)).toBe(404);
      expect(await request(app).delete(`/projects/${p.body.id}`).set('Authorization', `Bearer ${tokenB}`).then((r) => r.status)).toBe(404);
      // Untouched
      const get = await request(app).get(`/projects/${p.body.id}`).set('Authorization', `Bearer ${tokenA}`);
      expect(get.body.name).toBe('Secret');
    });

    test('org B cannot GET/PATCH/DELETE org A unit', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const p = await request(app).post('/projects').set('Authorization', `Bearer ${tokenA}`).send({ name: 'SecretU' });
      const u = await request(app).post(`/projects/${p.body.id}/units`).set('Authorization', `Bearer ${tokenA}`).send({ identifier: 'S-1' });
      expect(await request(app).get(`/units/${u.body.id}`).set('Authorization', `Bearer ${tokenB}`).then((r) => r.status)).toBe(404);
      expect(await request(app).patch(`/units/${u.body.id}`).set('Authorization', `Bearer ${tokenB}`).send({ identifier: 'H' }).then((r) => r.status)).toBe(404);
      expect(await request(app).delete(`/units/${u.body.id}`).set('Authorization', `Bearer ${tokenB}`).then((r) => r.status)).toBe(404);
    });

    test('org B cannot create unit under org A project', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const p = await request(app).post('/projects').set('Authorization', `Bearer ${tokenA}`).send({ name: 'NoEntry' });
      const res = await request(app).post(`/projects/${p.body.id}/units`).set('Authorization', `Bearer ${tokenB}`).send({ identifier: 'H-1' });
      expect([403, 404]).toContain(res.status);
      // Nothing created in A
      const list = await request(app).get(`/projects/${p.body.id}/units`).set('Authorization', `Bearer ${tokenA}`);
      expect(list.body.length).toBe(0);
    });

    test('project/unit lists are tenant-scoped', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      await request(app).post('/projects').set('Authorization', `Bearer ${tokenA}`).send({ name: 'OnlyA' });
      const listB = await request(app).get('/projects').set('Authorization', `Bearer ${tokenB}`);
      expect(listB.body.find((p) => p.name === 'OnlyA')).toBeUndefined();
      expect(listB.body.every((p) => p.organizationId === orgB.id)).toBe(true);
    });

    test('tenant wrapper isolates projects/units at DB layer', async () => {
      const tenantA = createTenantPrisma(orgA.id);
      const tenantB = createTenantPrisma(orgB.id);
      const proj = await tenantA.project.create({ data: { name: 'IsoProj' } });
      await tenantA.unit.create({ data: { projectId: proj.id, identifier: 'ISO-1' } });
      expect(await tenantB.project.findUnique({ where: { id: proj.id } })).toBeNull();
      const foundUnits = await tenantB.unit.findMany({ where: {} });
      expect(foundUnits.find((u) => u.projectId === proj.id)).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  describe('Authorization', () => {
    test('unauthenticated → 401', async () => {
      expect((await request(app).get('/projects')).status).toBe(401);
      expect((await request(app).get('/units')).status).toBe(401);
    });

    test('read-only role cannot create/update/delete', async () => {
      const tokenAgent = await login(userAgentA.email, plainAgentA, orgA.id);
      const tokenAdmin = await login(userAdminA.email, plainAdminA, orgA.id);
      expect((await request(app).post('/projects').set('Authorization', `Bearer ${tokenAgent}`).send({ name: 'NoPerm' })).status).toBe(403);
      const proj = await request(app).post('/projects').set('Authorization', `Bearer ${tokenAdmin}`).send({ name: 'ReadOk' });
      expect((await request(app).get('/projects').set('Authorization', `Bearer ${tokenAgent}`)).status).toBe(200);
      expect((await request(app).patch(`/projects/${proj.body.id}`).set('Authorization', `Bearer ${tokenAgent}`).send({ name: 'X' })).status).toBe(403);
      expect((await request(app).delete(`/projects/${proj.body.id}`).set('Authorization', `Bearer ${tokenAgent}`)).status).toBe(403);
      const unit = await request(app).post(`/projects/${proj.body.id}/units`).set('Authorization', `Bearer ${tokenAdmin}`).send({ identifier: 'R-1' });
      expect((await request(app).post(`/projects/${proj.body.id}/units`).set('Authorization', `Bearer ${tokenAgent}`).send({ identifier: 'R-2' })).status).toBe(403);
      expect((await request(app).patch(`/units/${unit.body.id}`).set('Authorization', `Bearer ${tokenAgent}`).send({ identifier: 'R-X' })).status).toBe(403);
      expect((await request(app).delete(`/units/${unit.body.id}`).set('Authorization', `Bearer ${tokenAgent}`)).status).toBe(403);
    });
  });
});
