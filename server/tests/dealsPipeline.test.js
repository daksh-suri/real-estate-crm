const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/lib/prisma');
const { hashPassword } = require('../src/lib/bcrypt');

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

let phoneCtr = 9200000000;
function identity(tag) {
  phoneCtr += 1;
  return {
    contactName: `Person ${tag} ${phoneCtr}`,
    phone: String(phoneCtr),
    email: `${tag}-${phoneCtr}@test.com`,
  };
}

describe('Checkpoint 8 — Deal & Pipeline', () => {
  let orgA, orgB;
  let roleAdminA, roleAgentA, roleAdminB;
  let userAdminA, userAgentA, userAdminB;
  let plainAdminA = 'AdminPass123!';
  let plainAgentA = 'AgentPass123!';
  let plainAdminB = 'AdminBPass123!';

  const PERMS = [
    ['enquiry', 'create'],
    ['lead', 'read'],
    ['contact', 'create'],
    ['contact', 'read'],
    ['project', 'create'],
    ['project', 'read'],
    ['unit', 'create'],
    ['unit', 'read'],
    ['unit', 'delete'],
    ['deal', 'create'],
    ['deal', 'read'],
    ['deal', 'update'],
    ['deal', 'transition'],
    ['deal', 'delete'],
  ];
  const AGENT_PERMS = [['deal', 'read']];

  async function wipeAll() {
    await prisma.refreshToken.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.idempotencyKey.deleteMany({});
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
    userAdminB = await prisma.user.create({
      data: { name: 'AdminB', email: uid('adminB') + '@test.com', organizationId: orgB.id, roleId: roleAdminB.id, passwordHash: await hashPassword(plainAdminB), status: 'ACTIVE' },
    });
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

  async function makeUnit(token, projectId, identifier) {
    const res = await request(app)
      .post(`/projects/${projectId}/units`)
      .set('Authorization', `Bearer ${token}`)
      .send({ identifier: identifier || uid('U') });
    expect(res.status).toBe(201);
    return res.body;
  }

  // Mint an OPEN lead through the real intake pipeline (no assignment rules
  // seeded, so leads stay UNASSIGNED — irrelevant for Deal tests).
  async function makeLead(token, overrides = {}) {
    const res = await request(app)
      .post('/enquiries')
      .set('Authorization', `Bearer ${token}`)
      .send({ channel: 'WALK_IN', ...identity('dl'), ...overrides });
    expect(res.status).toBe(201);
    expect(res.body.lead.status).toBe('OPEN');
    return res.body.lead;
  }

  async function makeDeal(token, leadId, extra = {}) {
    const res = await request(app)
      .post('/deals')
      .set('Authorization', `Bearer ${token}`)
      .send({ leadId, ...extra });
    expect(res.status).toBe(201);
    return res.body;
  }

  async function transition(token, dealId, body) {
    return request(app)
      .post(`/deals/${dealId}/stage-transition`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  async function auditRows(dealId, orgId) {
    return prisma.auditLog.findMany({
      where: { organizationId: orgId, entityType: 'Deal', entityId: dealId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // -------------------------------------------------------------------------
  describe('Deal creation', () => {
    test('creates deal at NEW with contact+lead linked, converts lead, audits', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const lead = await makeLead(token);

      const res = await request(app).post('/deals').set('Authorization', `Bearer ${token}`).send({ leadId: lead.id });
      expect(res.status).toBe(201);
      expect(res.body.stage).toBe('NEW');
      expect(res.body.contactId).toBe(lead.contactId);
      expect(res.body.leadId).toBe(lead.id);
      expect(res.body.unitId).toBeNull();
      expect(res.body.lostReason).toBeNull();
      expect(res.body.organizationId).toBe(orgA.id);

      const leadAfter = await request(app).get(`/leads/${lead.id}`).set('Authorization', `Bearer ${token}`);
      expect(leadAfter.body.status).toBe('CONVERTED');

      const rows = await auditRows(res.body.id, orgA.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe('deal.create');
      expect(rows[0].actorId).toBe(userAdminA.id);
      expect(rows[0].beforeState).toBeNull();
      expect(rows[0].afterState.stage).toBe('NEW');
    });

    test('unitId can be attached at creation without touching availability', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const project = await makeProject(token);
      const unit = await makeUnit(token, project.id);
      const lead = await makeLead(token);

      const deal = await makeDeal(token, lead.id, { unitId: unit.id });
      expect(deal.unitId).toBe(unit.id);

      const unitAfter = await prisma.unit.findUnique({ where: { id: unit.id } });
      expect(unitAfter.availabilityStatus).toBe('AVAILABLE');
    });

    test('missing lead 404; DISQUALIFIED lead 409; second deal from same lead 409', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const missing = await request(app)
        .post('/deals')
        .set('Authorization', `Bearer ${token}`)
        .send({ leadId: '00000000-0000-4000-8000-000000000000' });
      expect(missing.status).toBe(404);

      const lead = await makeLead(token);
      await prisma.lead.update({ where: { id: lead.id }, data: { status: 'DISQUALIFIED' } });
      const disq = await request(app).post('/deals').set('Authorization', `Bearer ${token}`).send({ leadId: lead.id });
      expect(disq.status).toBe(409);

      const lead2 = await makeLead(token);
      await makeDeal(token, lead2.id);
      const again = await request(app).post('/deals').set('Authorization', `Bearer ${token}`).send({ leadId: lead2.id });
      expect(again.status).toBe(409);
    });

    test('concurrent double-create from one lead yields exactly one deal', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const lead = await makeLead(token);
      const [a, b] = await Promise.all([
        request(app).post('/deals').set('Authorization', `Bearer ${token}`).send({ leadId: lead.id }),
        request(app).post('/deals').set('Authorization', `Bearer ${token}`).send({ leadId: lead.id }),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect(await prisma.deal.count({ where: { organizationId: orgA.id } })).toBe(1);
    });

    test('payload validation: missing leadId, bad uuid, bad unitId', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      expect((await request(app).post('/deals').set('Authorization', `Bearer ${token}`).send({})).status).toBe(400);
      expect((await request(app).post('/deals').set('Authorization', `Bearer ${token}`).send({ leadId: 'nope' })).status).toBe(400);
      const lead = await makeLead(token);
      const badUnit = await request(app).post('/deals').set('Authorization', `Bearer ${token}`).send({ leadId: lead.id, unitId: 'nope' });
      expect(badUnit.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  describe('Forward pipeline', () => {
    test('walks the full chain NEW to CLOSED_WON with audit per step', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const deal = await makeDeal(token, (await makeLead(token)).id);
      const chain = ['QUALIFIED', 'SITE_VISIT_SCHEDULED', 'NEGOTIATION', 'RESERVATION', 'BOOKING_CONFIRMED', 'AGREEMENT_SIGNED', 'PAYMENT_IN_PROGRESS', 'CLOSED_WON'];
      let current = 'NEW';
      for (const next of chain) {
         
        const res = await transition(token, deal.id, { stage: next });
        expect(res.status).toBe(200);
        expect(res.body.stage).toBe(next);
        expect(res.body.lostReason).toBeNull();
        current = next;
      }
      expect(current).toBe('CLOSED_WON');
      const rows = await auditRows(deal.id, orgA.id);
      expect(rows).toHaveLength(1 + chain.length);
      expect(rows.every((r) => r.action === 'deal.create' || r.action === 'deal.stage_transition')).toBe(true);
      const last = rows[rows.length - 1];
      expect(last.beforeState).toEqual({ stage: 'PAYMENT_IN_PROGRESS', lostReason: null });
      expect(last.afterState).toEqual({ stage: 'CLOSED_WON', lostReason: null });
      expect(rows.every((r) => r.actorId === userAdminA.id)).toBe(true);
    });

    test('QUALIFIED can skip directly to NEGOTIATION', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const deal = await makeDeal(token, (await makeLead(token)).id);
      expect((await transition(token, deal.id, { stage: 'QUALIFIED' })).status).toBe(200);
      const res = await transition(token, deal.id, { stage: 'NEGOTIATION' });
      expect(res.status).toBe(200);
      expect(res.body.stage).toBe('NEGOTIATION');
    });

    test('SITE_VISIT_SCHEDULED needs no SiteVisit record', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const deal = await makeDeal(token, (await makeLead(token)).id);
      await transition(token, deal.id, { stage: 'QUALIFIED' });
      const res = await transition(token, deal.id, { stage: 'SITE_VISIT_SCHEDULED' });
      expect(res.status).toBe(200);
    });

    test('fromStage optimistic concurrency: match passes, mismatch 409', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const deal = await makeDeal(token, (await makeLead(token)).id);
      const ok = await transition(token, deal.id, { stage: 'QUALIFIED', fromStage: 'NEW' });
      expect(ok.status).toBe(200);
      const stale = await transition(token, deal.id, { stage: 'NEGOTIATION', fromStage: 'NEW' });
      expect(stale.status).toBe(409);
    });
  });

  // -------------------------------------------------------------------------
  describe('Invalid transitions', () => {
    test('jumps, backward moves, same-stage, and unknown-out rejected; state+audit untouched', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const deal = await makeDeal(token, (await makeLead(token)).id);

      expect((await transition(token, deal.id, { stage: 'AGREEMENT_SIGNED' })).status).toBe(400);
      expect((await transition(token, deal.id, { stage: 'NEW' })).status).toBe(400);
      expect((await transition(token, deal.id, { stage: 'RESERVATION' })).status).toBe(400);
      expect((await transition(token, deal.id, { stage: 'CLOSED_WON' })).status).toBe(400);

      await transition(token, deal.id, { stage: 'QUALIFIED' });
      expect((await transition(token, deal.id, { stage: 'NEW' })).status).toBe(400);
      expect((await transition(token, deal.id, { stage: 'RESERVATION' })).status).toBe(400);

      const stored = await request(app).get(`/deals/${deal.id}`).set('Authorization', `Bearer ${token}`);
      expect(stored.body.stage).toBe('QUALIFIED');
      expect((await auditRows(deal.id, orgA.id)).filter((r) => r.action === 'deal.stage_transition')).toHaveLength(1);
    });

    test('bad stage enum and missing stage fail validation', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const deal = await makeDeal(token, (await makeLead(token)).id);
      expect((await transition(token, deal.id, { stage: 'SOLD' })).status).toBe(400);
      expect((await transition(token, deal.id, {})).status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  describe('CLOSED_LOST', () => {
    test('reachable from NEW and mid-pipeline with trimmed reason; terminal after', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const d1 = await makeDeal(token, (await makeLead(token)).id);
      const lost1 = await transition(token, d1.id, { stage: 'CLOSED_LOST', lostReason: '  price too high  ' });
      expect(lost1.status).toBe(200);
      expect(lost1.body.lostReason).toBe('price too high');

      const d2 = await makeDeal(token, (await makeLead(token)).id);
      await transition(token, d2.id, { stage: 'QUALIFIED' });
      await transition(token, d2.id, { stage: 'NEGOTIATION' });
      const lost2 = await transition(token, d2.id, { stage: 'CLOSED_LOST', lostReason: 'went with competitor' });
      expect(lost2.status).toBe(200);

      for (const d of [d1, d2]) {
         
        const exit = await transition(token, d.id, { stage: 'NEGOTIATION' });
        expect(exit.status).toBe(400);
      }
      const rows = await auditRows(d2.id, orgA.id);
      const last = rows[rows.length - 1];
      expect(last.afterState).toEqual({ stage: 'CLOSED_LOST', lostReason: 'went with competitor' });
    });

    test('missing, blank, and overlong reasons rejected', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const deal = await makeDeal(token, (await makeLead(token)).id);
      expect((await transition(token, deal.id, { stage: 'CLOSED_LOST' })).status).toBe(400);
      expect((await transition(token, deal.id, { stage: 'CLOSED_LOST', lostReason: '   ' })).status).toBe(400);
      expect((await transition(token, deal.id, { stage: 'CLOSED_LOST', lostReason: 'x'.repeat(501) })).status).toBe(400);
      const stored = await request(app).get(`/deals/${deal.id}`).set('Authorization', `Bearer ${token}`);
      expect(stored.body.stage).toBe('NEW');
    });

    test('CLOSED_WON is terminal', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const deal = await makeDeal(token, (await makeLead(token)).id);
      for (const s of ['QUALIFIED', 'NEGOTIATION', 'RESERVATION', 'BOOKING_CONFIRMED', 'AGREEMENT_SIGNED', 'PAYMENT_IN_PROGRESS', 'CLOSED_WON']) {
         
        expect((await transition(token, deal.id, { stage: s })).status).toBe(200);
      }
      expect((await transition(token, deal.id, { stage: 'CLOSED_LOST', lostReason: 'regret' })).status).toBe(400);
      expect((await transition(token, deal.id, { stage: 'NEGOTIATION' })).status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  describe('Generic PATCH boundaries', () => {
    test('stage/lostReason/relationships rejected; unit attach-once works', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const project = await makeProject(token);
      const unit = await makeUnit(token, project.id);
      const deal = await makeDeal(token, (await makeLead(token)).id);

      for (const body of [
        { stage: 'QUALIFIED' },
        { lostReason: 'sneaky' },
        { contactId: deal.contactId },
        { leadId: deal.leadId },
        { organizationId: orgA.id },
      ]) {
         
        expect((await request(app).patch(`/deals/${deal.id}`).set('Authorization', `Bearer ${token}`).send(body)).status).toBe(400);
      }

      const attach = await request(app).patch(`/deals/${deal.id}`).set('Authorization', `Bearer ${token}`).send({ unitId: unit.id });
      expect(attach.status).toBe(200);
      expect(attach.body.unitId).toBe(unit.id);

      const unit2 = await makeUnit(token, project.id);
      expect((await request(app).patch(`/deals/${deal.id}`).set('Authorization', `Bearer ${token}`).send({ unitId: unit2.id })).status).toBe(400);
      expect((await request(app).patch(`/deals/${deal.id}`).set('Authorization', `Bearer ${token}`).send({ unitId: null })).status).toBe(400);
      expect((await request(app).patch(`/deals/${deal.id}`).set('Authorization', `Bearer ${token}`).send({})).status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  describe('Reads, filters, soft delete', () => {
    test('list filters by stage/lead/contact and paginates', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const lead1 = await makeLead(token);
      const d1 = await makeDeal(token, lead1.id);
      const lead2 = await makeLead(token);
      await makeDeal(token, lead2.id);
      await transition(token, d1.id, { stage: 'QUALIFIED' });

      const byStage = await request(app).get('/deals?stage=QUALIFIED').set('Authorization', `Bearer ${token}`);
      expect(byStage.body).toHaveLength(1);
      const byLead = await request(app).get(`/deals?leadId=${lead2.id}`).set('Authorization', `Bearer ${token}`);
      expect(byLead.body).toHaveLength(1);
      const byContact = await request(app).get(`/deals?contactId=${lead1.contactId}`).set('Authorization', `Bearer ${token}`);
      expect(byContact.body).toHaveLength(1);
      const page = await request(app).get('/deals?limit=1&offset=1').set('Authorization', `Bearer ${token}`);
      expect(page.body).toHaveLength(1);
    });

    test('soft-deleted deal hidden from reads/transitions, history preserved', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const deal = await makeDeal(token, (await makeLead(token)).id);
      await transition(token, deal.id, { stage: 'QUALIFIED' });

      const del = await request(app).delete(`/deals/${deal.id}`).set('Authorization', `Bearer ${token}`);
      expect(del.status).toBe(200);
      expect(del.body.deletedAt).not.toBeNull();
      expect((await request(app).get(`/deals/${deal.id}`).set('Authorization', `Bearer ${token}`)).status).toBe(404);
      expect((await request(app).get('/deals').set('Authorization', `Bearer ${token}`)).body).toHaveLength(0);
      expect((await transition(token, deal.id, { stage: 'NEGOTIATION' })).status).toBe(404);
      expect((await request(app).delete(`/deals/${deal.id}`).set('Authorization', `Bearer ${token}`)).status).toBe(404);
      expect((await auditRows(deal.id, orgA.id)).length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('Tenant isolation attacks', () => {
    test('cross-tenant deal access blocked and hidden', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const leadA = await makeLead(tokenA);
      const dealA = await makeDeal(tokenA, leadA.id);

      expect((await request(app).get(`/deals/${dealA.id}`).set('Authorization', `Bearer ${tokenB}`)).status).toBe(404);
      expect((await request(app).patch(`/deals/${dealA.id}`).set('Authorization', `Bearer ${tokenB}`).send({})).status).toBe(404);
      expect((await transition(tokenB, dealA.id, { stage: 'QUALIFIED' })).status).toBe(404);
      expect((await request(app).delete(`/deals/${dealA.id}`).set('Authorization', `Bearer ${tokenB}`)).status).toBe(404);
      expect((await request(app).get('/deals').set('Authorization', `Bearer ${tokenB}`)).body).toHaveLength(0);

      const crossLead = await request(app).post('/deals').set('Authorization', `Bearer ${tokenB}`).send({ leadId: leadA.id });
      expect(crossLead.status).toBe(404);
    });

    test('cross-tenant unit rejected on create and attach', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const projectB = await makeProject(tokenB);
      const unitB = await makeUnit(tokenB, projectB.id);
      const leadA = await makeLead(tokenA);

      const crossCreate = await request(app).post('/deals').set('Authorization', `Bearer ${tokenA}`).send({ leadId: leadA.id, unitId: unitB.id });
      expect(crossCreate.status).toBe(404);

      const projectA = await makeProject(tokenA);
      const softUnit = await makeUnit(tokenA, projectA.id);
      await request(app).delete(`/units/${softUnit.id}`).set('Authorization', `Bearer ${tokenA}`);
      const softCreate = await request(app).post('/deals').set('Authorization', `Bearer ${tokenA}`).send({ leadId: leadA.id, unitId: softUnit.id });
      expect(softCreate.status).toBe(400);

      const deal = await makeDeal(tokenA, (await makeLead(tokenA)).id);
      const crossPatch = await request(app).patch(`/deals/${deal.id}`).set('Authorization', `Bearer ${tokenA}`).send({ unitId: unitB.id });
      expect(crossPatch.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('Authorization matrix', () => {
    test('401 without token; read-only agent blocked from writes', async () => {
      const tokenAdmin = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenAgent = await login(userAgentA.email, plainAgentA, orgA.id);
      const deal = await makeDeal(tokenAdmin, (await makeLead(tokenAdmin)).id);

      expect((await request(app).post('/deals').send({ leadId: deal.leadId })).status).toBe(401);
      expect((await request(app).get('/deals').set('Authorization', `Bearer ${tokenAgent}`)).status).toBe(200);
      expect((await request(app).get(`/deals/${deal.id}`).set('Authorization', `Bearer ${tokenAgent}`)).status).toBe(200);
      expect((await request(app).post('/deals').set('Authorization', `Bearer ${tokenAgent}`).send({ leadId: deal.leadId })).status).toBe(403);
      expect((await request(app).patch(`/deals/${deal.id}`).set('Authorization', `Bearer ${tokenAgent}`).send({})).status).toBe(403);
      expect((await transition(tokenAgent, deal.id, { stage: 'QUALIFIED' })).status).toBe(403);
      expect((await request(app).delete(`/deals/${deal.id}`).set('Authorization', `Bearer ${tokenAgent}`)).status).toBe(403);
    });
  });
});
