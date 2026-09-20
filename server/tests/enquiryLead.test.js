const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/lib/prisma');
const { hashPassword } = require('../src/lib/bcrypt');

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

let phoneCtr = 9100000000;
function identity(tag) {
  phoneCtr += 1;
  return {
    contactName: `Person ${tag} ${phoneCtr}`,
    phone: String(phoneCtr),
    email: `${tag}-${phoneCtr}@test.com`,
  };
}

describe('Checkpoint 7 — Enquiry Intake + Lead Foundation', () => {
  let orgA, orgB;
  let roleAdminA, roleAgentA, roleAdminB;
  let userAdminA, userAgentA, userAgentA2, userAdminB;
  let plainAdminA = 'AdminPass123!';
  let plainAgentA = 'AgentPass123!';
  let plainAgentA2 = 'Agent2Pass123!';
  let plainAdminB = 'AdminBPass123!';
  let teamRR;

  const PERMS = [
    ['enquiry', 'create'],
    ['enquiry', 'read'],
    ['lead', 'read'],
    ['lead', 'update'],
    ['lead', 'delete'],
    ['lead', 'assign'],
    ['deal', 'create'],
    ['leadSource', 'create'],
    ['leadSource', 'read'],
    ['leadSource', 'update'],
    ['leadSource', 'delete'],
    ['campaign', 'create'],
    ['campaign', 'read'],
    ['campaign', 'update'],
    ['campaign', 'delete'],
    ['assignmentRule', 'create'],
    ['assignmentRule', 'read'],
    ['assignmentRule', 'update'],
    ['assignmentRule', 'delete'],
    ['contact', 'create'],
    ['contact', 'read'],
    ['project', 'create'],
    ['project', 'read'],
    ['requirement', 'create'],
    ['requirement', 'read'],
  ];
  const AGENT_PERMS = [
    ['enquiry', 'create'],
    ['enquiry', 'read'],
    ['lead', 'read'],
  ];

  async function wipeAll() {
    await prisma.refreshToken.deleteMany({});
    await prisma.idempotencyKey.deleteMany({});
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
    await prisma.refreshToken.deleteMany({});
    await prisma.idempotencyKey.deleteMany({});
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
  }

  beforeAll(async () => {
    await wipeAll();

    orgA = await prisma.organization.create({ data: { name: uid('OrgA') } });
    orgB = await prisma.organization.create({ data: { name: uid('OrgB') } });

    const permByKey = {};
    for (const [resource, action] of PERMS) {
      const p = await prisma.permission.create({ data: { resource, action } });
      permByKey[`${resource}:${action}`] = p;
    }

    roleAdminA = await prisma.role.create({ data: { name: 'Admin', organizationId: orgA.id } });
    roleAgentA = await prisma.role.create({ data: { name: 'Agent', organizationId: orgA.id } });
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

    userAdminA = await prisma.user.create({
      data: { name: 'AdminA', email: uid('adminA') + '@test.com', organizationId: orgA.id, roleId: roleAdminA.id, passwordHash: await hashPassword(plainAdminA), status: 'ACTIVE' },
    });
    userAgentA = await prisma.user.create({
      data: { name: 'AgentA', email: uid('agentA') + '@test.com', organizationId: orgA.id, roleId: roleAgentA.id, passwordHash: await hashPassword(plainAgentA), status: 'ACTIVE' },
    });
    userAgentA2 = await prisma.user.create({
      data: { name: 'AgentA2', email: uid('agentA2') + '@test.com', organizationId: orgA.id, roleId: roleAgentA.id, passwordHash: await hashPassword(plainAgentA2), status: 'ACTIVE' },
    });
    userAdminB = await prisma.user.create({
      data: { name: 'AdminB', email: uid('adminB') + '@test.com', organizationId: orgB.id, roleId: roleAdminB.id, passwordHash: await hashPassword(plainAdminB), status: 'ACTIVE' },
    });

    teamRR = await prisma.team.create({ data: { name: 'RoundRobin', organizationId: orgA.id } });
    await prisma.teamMembership.create({ data: { userId: userAgentA.id, teamId: teamRR.id, organizationId: orgA.id } });
    await prisma.teamMembership.create({ data: { userId: userAgentA2.id, teamId: teamRR.id, organizationId: orgA.id } });
  });

  afterAll(async () => {
    await wipeAll();
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await wipeDomain();
  });

  async function login(email, password, organizationId) {
    const res = await request(app).post('/auth/login').send({ email, password, organizationId });
    expect(res.status).toBe(200);
    return res.body.accessToken;
  }

  async function makeProject(token, name) {
    const res = await request(app).post('/projects').set('Authorization', `Bearer ${token}`).send({ name: name || uid('Proj') });
    expect(res.status).toBe(201);
    return res.body;
  }

  function postIntake(token, payload, key) {
    const r = request(app).post('/enquiries').set('Authorization', `Bearer ${token}`);
    if (key) r.set('Idempotency-Key', key);
    return r.send(payload);
  }

  // -------------------------------------------------------------------------
  describe('LeadSource / Campaign CRUD', () => {
    test('full CRUD with per-org uniqueness', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);

      const s1 = await request(app).post('/lead-sources').set('Authorization', `Bearer ${tokenA}`).send({ name: '99acres', type: 'PORTAL' });
      expect(s1.status).toBe(201);
      const dup = await request(app).post('/lead-sources').set('Authorization', `Bearer ${tokenA}`).send({ name: '99acres' });
      expect(dup.status).toBe(409);
      const other = await request(app).post('/lead-sources').set('Authorization', `Bearer ${tokenB}`).send({ name: '99acres' });
      expect(other.status).toBe(201);

      const c1 = await request(app).post('/campaigns').set('Authorization', `Bearer ${tokenA}`).send({ name: 'Diwali Push', leadSourceId: s1.body.id });
      expect(c1.status).toBe(201);
      const badSrc = await request(app).post('/campaigns').set('Authorization', `Bearer ${tokenA}`).send({ name: 'Bad', leadSourceId: other.body.id });
      expect(badSrc.status).toBe(403);

      const upd = await request(app).patch(`/lead-sources/${s1.body.id}`).set('Authorization', `Bearer ${tokenA}`).send({ type: 'AGGREGATOR' });
      expect(upd.status).toBe(200);
      expect(upd.body.type).toBe('AGGREGATOR');

      const del = await request(app).delete(`/campaigns/${c1.body.id}`).set('Authorization', `Bearer ${tokenA}`);
      expect(del.status).toBe(200);
      const gone = await request(app).get(`/campaigns/${c1.body.id}`).set('Authorization', `Bearer ${tokenA}`);
      expect(gone.status).toBe(404);
    });

    test('cross-tenant source/campaign reads hidden', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const s1 = await request(app).post('/lead-sources').set('Authorization', `Bearer ${tokenA}`).send({ name: 'SecretSrc' });
      const r = await request(app).get(`/lead-sources/${s1.body.id}`).set('Authorization', `Bearer ${tokenB}`);
      expect(r.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('AssignmentRule CRUD', () => {
    test('CRUD + config validation', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);

      const noTeam = await request(app).post('/assignment-rules').set('Authorization', `Bearer ${tokenA}`).send({ type: 'ROUND_ROBIN', order: 0, config: {} });
      expect(noTeam.status).toBe(400);

      const teamB = await prisma.team.create({ data: { name: uid('TeamB'), organizationId: orgB.id } });
      const crossTeam = await request(app).post('/assignment-rules').set('Authorization', `Bearer ${tokenA}`).send({ type: 'ROUND_ROBIN', order: 0, config: { teamId: teamB.id } });
      expect(crossTeam.status).toBe(403);

      const ok = await request(app).post('/assignment-rules').set('Authorization', `Bearer ${tokenA}`).send({ type: 'ROUND_ROBIN', order: 0, config: { teamId: teamRR.id } });
      expect(ok.status).toBe(201);

      const list = await request(app).get('/assignment-rules').set('Authorization', `Bearer ${tokenA}`);
      expect(list.status).toBe(200);
      expect(list.body.length).toBe(1);

      const other = await request(app).get('/assignment-rules').set('Authorization', `Bearer ${tokenB}`);
      expect(other.body.length).toBe(0);

      const off = await request(app).patch(`/assignment-rules/${ok.body.id}`).set('Authorization', `Bearer ${tokenA}`).send({ active: false });
      expect(off.body.active).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe('Basic intake', () => {
    test('new contact + project creates enquiry + OPEN UNASSIGNED lead', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const project = await makeProject(token);
      const id = identity('basic');
      const res = await postIntake(token, { channel: 'WALK_IN', ...id, projectId: project.id, rawPayload: { desk: 'front' } });
      expect(res.status).toBe(201);
      expect(res.body.contactMatch).toBe('NONE');
      expect(res.body.contactCreated).toBe(true);
      expect(res.body.enquiry.contactId).toBe(res.body.contact.id);
      expect(res.body.enquiry.projectId).toBe(project.id);
      expect(res.body.lead.status).toBe('OPEN');
      expect(res.body.lead.contactId).toBe(res.body.contact.id);
      expect(res.body.lead.projectId).toBe(project.id);
      expect(res.body.lead.originEnquiryId).toBe(res.body.enquiry.id);
      expect(res.body.enquiry.linkedLeadId).toBe(res.body.lead.id);
      expect(res.body.lead.assignmentSource).toBe('UNASSIGNED');
      expect(res.body.lead.assignedAgentId).toBeNull();
    });

    test('all four channels funnel into one pipeline', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      for (const channel of ['PORTAL', 'WALK_IN', 'PHONE', 'OWNED_FORM']) {
        const res = await postIntake(token, { channel, ...identity(`ch-${channel}`) });
        expect(res.status).toBe(201);
        expect(res.body.lead).not.toBeNull();
        expect(res.body.lead.projectId).toBeNull();
      }
      const bad = await postIntake(token, { channel: 'PIGEON', ...identity('bad') });
      expect(bad.status).toBe(400);
    });

    test('existing contact reused via normalized identity', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const id = identity('reuse');
      const r1 = await postIntake(token, { channel: 'PHONE', ...id });
      const r2 = await postIntake(token, { channel: 'PHONE', contactName: id.contactName, phone: `+91 ${id.phone.slice(0, 5)} ${id.phone.slice(5)}`, email: `  ${id.email.toUpperCase()}  ` });
      expect(r2.status).toBe(201);
      expect(r2.body.contact.id).toBe(r1.body.contact.id);
      expect(r2.body.contactMatch).toBe('STRONG');
      expect(r2.body.contactCreated).toBe(false);
    });

    test('intake with source + campaign links them', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const src = await request(app).post('/lead-sources').set('Authorization', `Bearer ${token}`).send({ name: 'MagicBricks' });
      const camp = await request(app).post('/campaigns').set('Authorization', `Bearer ${token}`).send({ name: 'Festive', leadSourceId: src.body.id });
      const res = await postIntake(token, { channel: 'PORTAL', ...identity('attr'), leadSourceId: src.body.id, campaignId: camp.body.id });
      expect(res.status).toBe(201);
      expect(res.body.lead.leadSourceId).toBe(src.body.id);
      expect(res.body.lead.campaignId).toBe(camp.body.id);
      expect(res.body.enquiry.leadSourceId).toBe(src.body.id);
    });

    test('campaign/source mismatch rejected; cross-tenant refs rejected', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const srcA = await request(app).post('/lead-sources').set('Authorization', `Bearer ${tokenA}`).send({ name: 'SrcA' });
      const srcB = await request(app).post('/lead-sources').set('Authorization', `Bearer ${tokenB}`).send({ name: 'SrcB' });
      const campA = await request(app).post('/campaigns').set('Authorization', `Bearer ${tokenA}`).send({ name: 'CampA', leadSourceId: srcA.body.id });

      const mismatch = await postIntake(tokenA, { channel: 'PORTAL', ...identity('mm'), leadSourceId: srcB.body.id, campaignId: campA.body.id });
      expect([400, 403, 404]).toContain(mismatch.status);

      const crossSrc = await postIntake(tokenA, { channel: 'PORTAL', ...identity('cs'), leadSourceId: srcB.body.id });
      expect(crossSrc.status).toBe(403);

      const crossCamp = await postIntake(tokenB, { channel: 'PORTAL', ...identity('cc'), campaignId: campA.body.id });
      expect(crossCamp.status).toBe(403);
    });

    test('project validation: missing 404, cross-tenant 404, soft-deleted 400', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const projA = await makeProject(tokenA);

      const missing = await postIntake(tokenA, { channel: 'PHONE', ...identity('mp'), projectId: '00000000-0000-4000-8000-000000000000' });
      expect(missing.status).toBe(404);

      const cross = await postIntake(tokenB, { channel: 'PHONE', ...identity('cp'), projectId: projA.id });
      expect(cross.status).toBe(404);

      await prisma.project.update({ where: { id: projA.id }, data: { deletedAt: new Date() } });
      const gone = await postIntake(tokenA, { channel: 'PHONE', ...identity('dp'), projectId: projA.id });
      expect(gone.status).toBe(400);
    });

    test('unmatched enquiry preserved with null contact/lead', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const res = await postIntake(token, { channel: 'PORTAL', rawPayload: { blob: 'no-identity' } });
      expect(res.status).toBe(201);
      expect(res.body.contact).toBeNull();
      expect(res.body.lead).toBeNull();
      expect(res.body.contactMatch).toBe('UNMATCHED');
      expect(res.body.enquiry.contactId).toBeNull();
      expect(res.body.enquiry.linkedLeadId).toBeNull();

      const got = await request(app).get(`/enquiries/${res.body.enquiry.id}`).set('Authorization', `Bearer ${token}`);
      expect(got.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  describe('Repeat enquiry + project-less behavior', () => {
    test('same contact + project attaches to OPEN lead, preserves origin', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const project = await makeProject(token);
      const id = identity('repeat');
      const r1 = await postIntake(token, { channel: 'WALK_IN', ...id, projectId: project.id });
      const r2 = await postIntake(token, { channel: 'PHONE', ...id, projectId: project.id });
      expect(r2.status).toBe(201);
      expect(r2.body.lead.id).toBe(r1.body.lead.id);
      expect(r2.body.lead.originEnquiryId).toBe(r1.body.enquiry.id);
      expect(r2.body.enquiry.linkedLeadId).toBe(r1.body.lead.id);

      const leads = await prisma.lead.findMany({ where: { organizationId: orgA.id } });
      expect(leads.length).toBe(1);
      const enquiries = await prisma.enquiry.findMany({ where: { organizationId: orgA.id } });
      expect(enquiries.length).toBe(2);
    });

    test('closed lead does not capture repeat enquiry; new lead opens', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const project = await makeProject(token);
      const id = identity('closed');
      const r1 = await postIntake(token, { channel: 'WALK_IN', ...id, projectId: project.id });
      const close = await request(app).patch(`/leads/${r1.body.lead.id}`).set('Authorization', `Bearer ${token}`).send({ status: 'DISQUALIFIED' });
      expect(close.status).toBe(200);
      const r2 = await postIntake(token, { channel: 'PHONE', ...id, projectId: project.id });
      expect(r2.body.lead.id).not.toBe(r1.body.lead.id);
      expect(r2.body.lead.status).toBe('OPEN');
    });

    test('project-less enquiries each open their own lead', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const id = identity('noproject');
      const r1 = await postIntake(token, { channel: 'PHONE', ...id });
      const r2 = await postIntake(token, { channel: 'PHONE', ...id });
      expect(r2.body.lead.id).not.toBe(r1.body.lead.id);
    });

    test('concurrent same-contact+project intakes yield one lead, two enquiries', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const project = await makeProject(token);
      const id = identity('race');
      const [a, b] = await Promise.all([
        postIntake(token, { channel: 'WALK_IN', ...id, projectId: project.id }),
        postIntake(token, { channel: 'PHONE', ...id, projectId: project.id }),
      ]);
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(a.body.lead.id).toBe(b.body.lead.id);
      expect(a.body.enquiry.id).not.toBe(b.body.enquiry.id);
      const leads = await prisma.lead.findMany({ where: { organizationId: orgA.id, contactId: a.body.contact.id } });
      expect(leads.length).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('Requirement integration', () => {
    test('intake requirement attaches to contact and references from lead', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const project = await makeProject(token);
      const id = identity('req');
      const res = await postIntake(token, {
        channel: 'OWNED_FORM',
        ...id,
        projectId: project.id,
        requirement: { unitTypePreference: '2BHK', budgetMin: 50, budgetMax: 80, preferredProjectIds: [project.id], notes: 'ready to move' },
      });
      expect(res.status).toBe(201);
      expect(res.body.requirement).not.toBeNull();
      expect(res.body.requirement.contactId).toBe(res.body.contact.id);
      expect(res.body.lead.requirementId).toBe(res.body.requirement.id);
    });

    test('repeat enquiry does not overwrite existing lead requirement', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const project = await makeProject(token);
      const id = identity('req2');
      const r1 = await postIntake(token, { channel: 'OWNED_FORM', ...id, projectId: project.id, requirement: { notes: 'first' } });
      const r2 = await postIntake(token, { channel: 'OWNED_FORM', ...id, projectId: project.id, requirement: { notes: 'second' } });
      expect(r2.body.lead.requirementId).toBe(r1.body.requirement.id);
      const reqs = await prisma.requirement.findMany({ where: { organizationId: orgA.id } });
      expect(reqs.length).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  describe('Idempotency', () => {
    test('same key twice: 201 then 200 replay, single enquiry+lead', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const key = `k-${Date.now()}-a`;
      const payload = { channel: 'PORTAL', ...identity('idem') };
      const r1 = await postIntake(token, payload, key);
      expect(r1.status).toBe(201);
      const r2 = await postIntake(token, payload, key);
      expect(r2.status).toBe(200);
      expect(r2.body.enquiry.id).toBe(r1.body.enquiry.id);
      expect(r2.body.lead.id).toBe(r1.body.lead.id);
      expect(await prisma.enquiry.count({ where: { organizationId: orgA.id } })).toBe(1);
      expect(await prisma.lead.count({ where: { organizationId: orgA.id } })).toBe(1);
    });

    test('same key with different payload rejected 409', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const key = `k-${Date.now()}-b`;
      const r1 = await postIntake(token, { channel: 'PORTAL', ...identity('idemB') }, key);
      expect(r1.status).toBe(201);
      const r2 = await postIntake(token, { channel: 'PORTAL', ...identity('idemC') }, key);
      expect(r2.status).toBe(409);
    });

    test('concurrent retries with same key create one enquiry', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const key = `k-${Date.now()}-c`;
      const id = identity('idemRace');
      const payload = { channel: 'PORTAL', ...id };
      const [a, b] = await Promise.all([postIntake(token, payload, key), postIntake(token, payload, key)]);
      expect([a.status, b.status].sort()).toEqual([200, 201]);
      expect(await prisma.enquiry.count({ where: { organizationId: orgA.id } })).toBe(1);
      expect(await prisma.lead.count({ where: { organizationId: orgA.id } })).toBe(1);
    });

    test('idempotency keys are tenant-scoped', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const key = `k-${Date.now()}-d`;
      const r1 = await postIntake(tokenA, { channel: 'PORTAL', ...identity('idemD') }, key);
      expect(r1.status).toBe(201);
      const r2 = await postIntake(tokenB, { channel: 'PORTAL', ...identity('idemE') }, key);
      expect(r2.status).toBe(201);
      expect(r2.body.enquiry.id).not.toBe(r1.body.enquiry.id);
    });
  });

  // -------------------------------------------------------------------------
  describe('Assignment', () => {
    async function enableRR(token, order = 0) {
      const res = await request(app).post('/assignment-rules').set('Authorization', `Bearer ${token}`).send({ type: 'ROUND_ROBIN', order, config: { teamId: teamRR.id } });
      expect(res.status).toBe(201);
      return res.body;
    }

    test('deterministic round-robin rotation across sequential intakes', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      await enableRR(token);
      const sorted = [userAgentA.id, userAgentA2.id].sort();
      const got = [];
      for (let i = 0; i < 4; i += 1) {
         
        const r = await postIntake(token, { channel: 'WALK_IN', ...identity(`rr${i}`) });
        expect(r.status).toBe(201);
        expect(r.body.lead.assignmentSource).toBe('AUTO');
        expect(r.body.lead.assignedAt).not.toBeNull();
        got.push(r.body.lead.assignedAgentId);
      }
      expect(got).toEqual([sorted[0], sorted[1], sorted[0], sorted[1]]);
    });

    test('concurrent creations distribute without double-assigning the counter', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      await enableRR(token);
      const payloads = Array.from({ length: 6 }, (_, i) => ({ channel: 'PORTAL', ...identity(`rrc${i}`) }));
      const results = await Promise.all(payloads.map((p) => postIntake(token, p)));
      for (const r of results) expect(r.status).toBe(201);
      const counts = {};
      for (const r of results) {
        expect(r.body.lead.assignmentSource).toBe('AUTO');
        counts[r.body.lead.assignedAgentId] = (counts[r.body.lead.assignedAgentId] || 0) + 1;
      }
      expect(counts[userAgentA.id]).toBe(3);
      expect(counts[userAgentA2.id]).toBe(3);
    });

    test('no eligible agent leaves lead UNASSIGNED and visible', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const emptyTeam = await prisma.team.create({ data: { name: uid('Empty'), organizationId: orgA.id } });
      const res = await request(app).post('/assignment-rules').set('Authorization', `Bearer ${token}`).send({ type: 'ROUND_ROBIN', order: 0, config: { teamId: emptyTeam.id } });
      expect(res.status).toBe(201);
      const r = await postIntake(token, { channel: 'PHONE', ...identity('unassigned') });
      expect(r.body.lead.assignmentSource).toBe('UNASSIGNED');
      expect(r.body.lead.assignedAgentId).toBeNull();
      expect(r.body.lead.assignedAt).toBeNull();
      const list = await request(app).get('/leads').set('Authorization', `Bearer ${token}`);
      expect(list.body.find((l) => l.id === r.body.lead.id).assignmentSource).toBe('UNASSIGNED');
    });

    test('deactivated agent excluded from rotation', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      await enableRR(token);
      await prisma.user.update({ where: { id: userAgentA2.id }, data: { status: 'DEACTIVATED' } });
      try {
        const r = await postIntake(token, { channel: 'PHONE', ...identity('deact') });
        expect(r.body.lead.assignedAgentId).toBe(userAgentA.id);
      } finally {
        await prisma.user.update({ where: { id: userAgentA2.id }, data: { status: 'ACTIVE' } });
      }
    });

    test('manual reassignment records MANUAL source; validates target', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const r = await postIntake(token, { channel: 'PHONE', ...identity('reassign') });
      const leadId = r.body.lead.id;

      const ok = await request(app).post(`/leads/${leadId}/reassign`).set('Authorization', `Bearer ${token}`).send({ assignedAgentId: userAgentA.id });
      expect(ok.status).toBe(200);
      expect(ok.body.assignmentSource).toBe('MANUAL');
      expect(ok.body.assignedAgentId).toBe(userAgentA.id);
      expect(ok.body.assignedAt).not.toBeNull();

      const cross = await request(app).post(`/leads/${leadId}/reassign`).set('Authorization', `Bearer ${token}`).send({ assignedAgentId: userAdminB.id });
      expect(cross.status).toBe(403);

      await prisma.user.update({ where: { id: userAgentA2.id }, data: { status: 'DEACTIVATED' } });
      try {
        const deact = await request(app).post(`/leads/${leadId}/reassign`).set('Authorization', `Bearer ${token}`).send({ assignedAgentId: userAgentA2.id });
        expect(deact.status).toBe(400);
      } finally {
        await prisma.user.update({ where: { id: userAgentA2.id }, data: { status: 'ACTIVE' } });
      }

      const missing = await request(app).post(`/leads/${leadId}/reassign`).set('Authorization', `Bearer ${tokenB}`).send({ assignedAgentId: userAdminB.id });
      expect(missing.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('Lead lifecycle', () => {
    test('status transitions enforced; reopen conflict surfaces 409', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const project = await makeProject(token);
      const id = identity('lifecycle');
      const r1 = await postIntake(token, { channel: 'WALK_IN', ...id, projectId: project.id });

      const bad = await request(app).patch(`/leads/${r1.body.lead.id}`).set('Authorization', `Bearer ${token}`).send({ status: 'OPEN' });
      expect(bad.status).toBe(400);

      const conv = await request(app).patch(`/leads/${r1.body.lead.id}`).set('Authorization', `Bearer ${token}`).send({ status: 'CONVERTED' });
      expect(conv.status).toBe(400);

      const stillOpen = await request(app).get(`/leads/${r1.body.lead.id}`).set('Authorization', `Bearer ${token}`);
      expect(stillOpen.status).toBe(200);
      expect(stillOpen.body.status).toBe('OPEN');

      // Conversion happens exclusively through deal creation.
      const deal = await request(app).post('/deals').set('Authorization', `Bearer ${token}`).send({ leadId: r1.body.lead.id });
      expect(deal.status).toBe(201);
      const converted = await request(app).get(`/leads/${r1.body.lead.id}`).set('Authorization', `Bearer ${token}`);
      expect(converted.body.status).toBe('CONVERTED');

      const terminal = await request(app).patch(`/leads/${r1.body.lead.id}`).set('Authorization', `Bearer ${token}`).send({ status: 'OPEN' });
      expect(terminal.status).toBe(400);

      const r2 = await postIntake(token, { channel: 'WALK_IN', ...id, projectId: project.id });
      const disq = await request(app).patch(`/leads/${r2.body.lead.id}`).set('Authorization', `Bearer ${token}`).send({ status: 'DISQUALIFIED' });
      expect(disq.status).toBe(200);
      const r3 = await postIntake(token, { channel: 'WALK_IN', ...id, projectId: project.id });
      const reopen = await request(app).patch(`/leads/${r2.body.lead.id}`).set('Authorization', `Bearer ${token}`).send({ status: 'OPEN' });
      expect(reopen.status).toBe(409);
      expect(r3.body.lead.status).toBe('OPEN');
    });

    test('PATCH cannot change assignment directly', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const r = await postIntake(token, { channel: 'PHONE', ...identity('noDirect') });
      const res = await request(app).patch(`/leads/${r.body.lead.id}`).set('Authorization', `Bearer ${token}`).send({ assignedAgentId: userAgentA.id });
      expect(res.status).toBe(400);
    });

    test('soft-deleted lead hidden; repeat enquiry opens fresh lead', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const project = await makeProject(token);
      const id = identity('softdel');
      const r1 = await postIntake(token, { channel: 'WALK_IN', ...id, projectId: project.id });
      const del = await request(app).delete(`/leads/${r1.body.lead.id}`).set('Authorization', `Bearer ${token}`);
      expect(del.status).toBe(200);
      const got = await request(app).get(`/leads/${r1.body.lead.id}`).set('Authorization', `Bearer ${token}`);
      expect(got.status).toBe(404);
      const r2 = await postIntake(token, { channel: 'WALK_IN', ...id, projectId: project.id });
      expect(r2.body.lead.id).not.toBe(r1.body.lead.id);
    });
  });

  // -------------------------------------------------------------------------
  describe('Dedup preserved (no auto-merge)', () => {
    test('single-signal match creates separate contact + PENDING duplicate', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const id = identity('dup');
      const r1 = await postIntake(token, { channel: 'PHONE', ...id });
      const r2 = await postIntake(token, {
        channel: 'PHONE',
        contactName: 'Different Person',
        phone: id.phone,
        email: `other-${Date.now()}@test.com`,
      });
      expect(r2.status).toBe(201);
      expect(r2.body.contact.id).not.toBe(r1.body.contact.id);
      const dups = await prisma.possibleDuplicate.findMany({ where: { organizationId: orgA.id } });
      expect(dups.length).toBeGreaterThan(0);
      expect(dups.every((d) => d.status === 'PENDING')).toBe(true);
      const contacts = await prisma.contact.findMany({ where: { organizationId: orgA.id } });
      expect(contacts.length).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  describe('Tenant isolation attacks', () => {
    test('cross-tenant reads/links blocked', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const projectA = await makeProject(tokenA);
      const id = identity('attack');
      const r1 = await postIntake(tokenA, { channel: 'WALK_IN', ...id, projectId: projectA.id });
      expect(r1.status).toBe(201);

      expect((await request(app).get(`/enquiries/${r1.body.enquiry.id}`).set('Authorization', `Bearer ${tokenB}`)).status).toBe(404);
      expect((await request(app).get(`/leads/${r1.body.lead.id}`).set('Authorization', `Bearer ${tokenB}`)).status).toBe(404);
      expect((await request(app).post(`/leads/${r1.body.lead.id}/reassign`).set('Authorization', `Bearer ${tokenB}`).send({ assignedAgentId: userAdminB.id })).status).toBe(404);
      expect((await request(app).patch(`/leads/${r1.body.lead.id}`).set('Authorization', `Bearer ${tokenB}`).send({ status: 'DISQUALIFIED' })).status).toBe(404);

      // Same identity in another tenant creates an isolated contact, never links across.
      const rB = await postIntake(tokenB, { channel: 'WALK_IN', ...id, projectId: undefined });
      expect(rB.status).toBe(201);
      expect(rB.body.contact.id).not.toBe(r1.body.contact.id);
      expect(rB.body.lead.id).not.toBe(r1.body.lead.id);
    });

    test('enquiry/lead lists are tenant-scoped', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      await postIntake(tokenA, { channel: 'PHONE', ...identity('scopeA') });
      const listB = await request(app).get('/enquiries').set('Authorization', `Bearer ${tokenB}`);
      expect(listB.body.length).toBe(0);
      const leadsB = await request(app).get('/leads').set('Authorization', `Bearer ${tokenB}`);
      expect(leadsB.body.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('Authorization', () => {
    test('401 without token; 403 without permission; scoped role works', async () => {
      const tokenAgent = await login(userAgentA.email, plainAgentA, orgA.id);
      const tokenAdmin = await login(userAdminA.email, plainAdminA, orgA.id);

      expect((await request(app).post('/enquiries').send({ channel: 'PHONE' })).status).toBe(401);

      // Agent has enquiry:create/read + lead:read only.
      const ok = await postIntake(tokenAgent, { channel: 'PHONE', ...identity('authz') });
      expect(ok.status).toBe(201);
      const list = await request(app).get('/leads').set('Authorization', `Bearer ${tokenAgent}`);
      expect(list.status).toBe(200);

      const noUpdate = await request(app).patch(`/leads/${ok.body.lead.id}`).set('Authorization', `Bearer ${tokenAgent}`).send({ status: 'DISQUALIFIED' });
      expect(noUpdate.status).toBe(403);
      const noAssign = await request(app).post(`/leads/${ok.body.lead.id}/reassign`).set('Authorization', `Bearer ${tokenAgent}`).send({ assignedAgentId: userAgentA.id });
      expect(noAssign.status).toBe(403);
      const noRule = await request(app).post('/assignment-rules').set('Authorization', `Bearer ${tokenAgent}`).send({ type: 'ROUND_ROBIN', config: { teamId: teamRR.id } });
      expect(noRule.status).toBe(403);

      const adminUpd = await request(app).patch(`/leads/${ok.body.lead.id}`).set('Authorization', `Bearer ${tokenAdmin}`).send({ status: 'DISQUALIFIED' });
      expect(adminUpd.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  describe('Search / filtering', () => {
    test('enquiry and lead filters work', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const project = await makeProject(token);
      const id = identity('filter');
      const r1 = await postIntake(token, { channel: 'PORTAL', ...id, projectId: project.id });
      await postIntake(token, { channel: 'PHONE', ...identity('filter2') });

      const byChannel = await request(app).get('/enquiries?channel=PORTAL').set('Authorization', `Bearer ${token}`);
      expect(byChannel.body.length).toBe(1);
      const byProject = await request(app).get(`/enquiries?projectId=${project.id}`).set('Authorization', `Bearer ${token}`);
      expect(byProject.body.length).toBe(1);
      const byContact = await request(app).get(`/leads?contactId=${r1.body.contact.id}`).set('Authorization', `Bearer ${token}`);
      expect(byContact.body.length).toBe(1);
      const byStatus = await request(app).get('/leads?status=OPEN').set('Authorization', `Bearer ${token}`);
      expect(byStatus.body.length).toBe(2);
    });

    test('unmatched filter splits contact-less and matched enquiries', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      await postIntake(token, { channel: 'PORTAL', ...identity('um1') });
      await postIntake(token, { channel: 'WALK_IN', rawPayload: { note: 'no-identity' } });

      const unmatched = await request(app).get('/enquiries?unmatched=true').set('Authorization', `Bearer ${token}`);
      expect(unmatched.status).toBe(200);
      expect(unmatched.body.length).toBe(1);
      expect(unmatched.body[0].contactId).toBeNull();

      const matched = await request(app).get('/enquiries?unmatched=false').set('Authorization', `Bearer ${token}`);
      expect(matched.status).toBe(200);
      expect(matched.body.length).toBe(1);
      expect(matched.body[0].contactId).not.toBeNull();

      const bad = await request(app).get('/enquiries?unmatched=yes').set('Authorization', `Bearer ${token}`);
      expect(bad.status).toBe(400);
    });
  });
});
