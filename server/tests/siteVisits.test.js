const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/lib/prisma');
const { hashPassword } = require('../src/lib/bcrypt');

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

let phoneCtr = 9300000000;
function identity(tag) {
  phoneCtr += 1;
  return {
    contactName: `Person ${tag} ${phoneCtr}`,
    phone: String(phoneCtr),
    email: `${tag}-${phoneCtr}@test.com`,
  };
}

const HOUR = 3600000;
function iso(base, hours) {
  return new Date(base + hours * HOUR).toISOString();
}

describe('Checkpoint 9 — Site Visit', () => {
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
    ['deal', 'create'],
    ['deal', 'read'],
    ['siteVisit', 'create'],
    ['siteVisit', 'read'],
    ['siteVisit', 'update'],
    ['siteVisit', 'transition'],
  ];
  const AGENT_PERMS = [['siteVisit', 'read']];

  async function wipeAll() {
    await prisma.refreshToken.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.idempotencyKey.deleteMany({});
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

  async function makeLead(token, overrides = {}) {
    const res = await request(app)
      .post('/enquiries')
      .set('Authorization', `Bearer ${token}`)
      .send({ channel: 'WALK_IN', ...identity('sv'), ...overrides });
    expect(res.status).toBe(201);
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

  // Full fixture set through real APIs: project + contact/lead/deal chain.
  async function fixtures(token, tag) {
    const project = await makeProject(token, uid(`Proj-${tag}`));
    const lead = await makeLead(token);
    const deal = await makeDeal(token, lead.id);
    return { project, contactId: deal.contactId, dealId: deal.id };
  }

  function schedule(token, body, key) {
    const r = request(app).post('/site-visits');
    if (token) r.set('Authorization', `Bearer ${token}`);
    if (key) r.set('Idempotency-Key', key);
    return r.send(body);
  }

  function visitBody(fx, agentId, startIso, extra = {}) {
    return { agentId, projectId: fx.project.id, contactId: fx.contactId, scheduledAt: startIso, ...extra };
  }

  // -------------------------------------------------------------------------
  describe('Creation + validation', () => {
    test('creates a valid visit at SCHEDULED with 60-minute default', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'create');
      const base = Date.now() + 24 * HOUR;
      const res = await schedule(token, visitBody(fx, userAgentA.id, iso(base, 9)));
      expect(res.status).toBe(201);
      expect(res.body.siteVisit.status).toBe('SCHEDULED');
      expect(res.body.siteVisit.durationMinutes).toBe(60);
      expect(res.body.siteVisit.agentId).toBe(userAgentA.id);
      expect(res.body.siteVisit.projectId).toBe(fx.project.id);
      expect(res.body.siteVisit.contactId).toBe(fx.contactId);
      expect(res.body.siteVisit.organizationId).toBe(orgA.id);
      expect(new Date(res.body.siteVisit.scheduledAt).getTime()).toBe(new Date(iso(base, 9)).getTime());
    });

    test('custom duration within bounds accepted; out-of-range rejected', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'dur');
      const base = Date.now() + 24 * HOUR;
      const ok = await schedule(token, visitBody(fx, userAgentA.id, iso(base, 9), { durationMinutes: 30 }));
      expect(ok.status).toBe(201);
      expect(ok.body.siteVisit.durationMinutes).toBe(30);
      for (const bad of [5, 600]) {
        const res = await schedule(token, visitBody(fx, userAgentA.id, iso(base, 12), { durationMinutes: bad }));
        expect(res.status).toBe(400);
      }
    });

    test('missing/invalid ids, bad datetime, and past slots rejected', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'val');
      const base = Date.now() + 24 * HOUR;
      expect((await schedule(token, {})).status).toBe(400);
      expect((await schedule(token, visitBody(fx, 'nope', iso(base, 9)))).status).toBe(400);
      const badDate = visitBody(fx, userAgentA.id, iso(base, 9));
      badDate.scheduledAt = 'next Tuesday-ish';
      expect((await schedule(token, badDate)).status).toBe(400);
      const past = visitBody(fx, userAgentA.id, new Date(Date.now() - HOUR).toISOString());
      expect((await schedule(token, past)).status).toBe(400);
      expect((await schedule(token, visitBody(fx, userAgentA.id, iso(base, 9), { dealId: 'nope' }))).status).toBe(400);
    });

    test('deactivated agent cannot be scheduled', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'deact');
      const base = Date.now() + 24 * HOUR;
      await prisma.user.update({ where: { id: userAgentA.id }, data: { status: 'DEACTIVATED' } });
      try {
        const res = await schedule(token, visitBody(fx, userAgentA.id, iso(base, 9)));
        expect(res.status).toBe(400);
      } finally {
        await prisma.user.update({ where: { id: userAgentA.id }, data: { status: 'ACTIVE' } });
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('Ownership + optional deal', () => {
    test('visit can exist without a deal; deal links when supplied + consistent', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'nodeal');
      const base = Date.now() + 24 * HOUR;
      const bare = await schedule(token, visitBody(fx, userAgentA.id, iso(base, 9)));
      expect(bare.status).toBe(201);
      expect(bare.body.siteVisit.dealId).toBeNull();
      const linked = await schedule(token, visitBody(fx, userAgentA.id, iso(base, 12), { dealId: fx.dealId }));
      expect(linked.status).toBe(201);
      expect(linked.body.siteVisit.dealId).toBe(fx.dealId);
    });

    test('deal/contact mismatch rejected', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'mismatch');
      const other = await fixtures(token, 'mismatch2');
      const base = Date.now() + 24 * HOUR;
      const res = await schedule(
        token,
        visitBody(fx, userAgentA.id, iso(base, 9), { contactId: other.contactId, dealId: fx.dealId })
      );
      expect(res.status).toBe(400);
    });

    test('missing deal hides as 404', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'nodeal404');
      const base = Date.now() + 24 * HOUR;
      const res = await schedule(
        token,
        visitBody(fx, userAgentA.id, iso(base, 9), { dealId: '00000000-0000-4000-8000-000000000000' })
      );
      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('Reads, filters, pagination', () => {
    test('get one, list with filters and date range, paginate', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const fx = await fixtures(token, 'list');
      const base = Date.now() + 24 * HOUR;
      const v1 = (await schedule(token, visitBody(fx, userAgentA.id, iso(base, 9)))).body.siteVisit;
      const v2 = (await schedule(token, visitBody(fx, userAdminA.id, iso(base, 12)))).body.siteVisit;

      const got = await request(app).get(`/site-visits/${v1.id}`).set('Authorization', `Bearer ${token}`);
      expect(got.status).toBe(200);
      expect(got.body.id).toBe(v1.id);

      const byAgent = await request(app).get(`/site-visits?agentId=${userAgentA.id}`).set('Authorization', `Bearer ${token}`);
      expect(byAgent.body.map((v) => v.id)).toEqual([v1.id]);

      const byProject = await request(app).get(`/site-visits?projectId=${fx.project.id}`).set('Authorization', `Bearer ${token}`);
      expect(byProject.body).toHaveLength(2);

      const byStatus = await request(app).get('/site-visits?status=SCHEDULED').set('Authorization', `Bearer ${token}`);
      expect(byStatus.body).toHaveLength(2);

      const byContact = await request(app).get(`/site-visits?contactId=${fx.contactId}`).set('Authorization', `Bearer ${token}`);
      expect(byContact.body).toHaveLength(2);

      const ranged = await request(app)
        .get(`/site-visits?from=${iso(base, 8)}&to=${iso(base, 10)}`)
        .set('Authorization', `Bearer ${token}`);
      expect(ranged.body.map((v) => v.id)).toEqual([v1.id]);

      const page = await request(app).get('/site-visits?limit=1&offset=1').set('Authorization', `Bearer ${token}`);
      expect(page.body).toHaveLength(1);
      expect(page.body[0].id).toBe(v2.id);

      expect((await request(app).get('/site-visits/00000000-0000-4000-8000-000000000000').set('Authorization', `Bearer ${token}`)).status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('Lifecycle transitions', () => {
    test('all valid SCHEDULED/CONFIRMED edges succeed', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const cases = [
        ['SCHEDULED', 'confirm', null, 'CONFIRMED'],
        ['SCHEDULED', 'complete', null, 'COMPLETED'],
        ['SCHEDULED', 'no-show', null, 'NO_SHOW'],
        ['CONFIRMED', 'complete', null, 'COMPLETED'],
        ['CONFIRMED', 'no-show', null, 'NO_SHOW'],
      ];
      let hour = 9;
      for (const [from, op] of cases) {
        const fx = await fixtures(token, `lc-${op}-${hour}`);
        const v = (await schedule(token, visitBody(fx, userAgentA.id, iso(Date.now() + 24 * HOUR, hour)))).body.siteVisit;
        if (from === 'CONFIRMED') {
           
          const c = await request(app).post(`/site-visits/${v.id}/confirm`).set('Authorization', `Bearer ${token}`).send({});
          expect(c.status).toBe(200);
        }
         
        const res = await request(app).post(`/site-visits/${v.id}/${op}`).set('Authorization', `Bearer ${token}`).send(op === 'cancel' ? { cancellationReason: 'x' } : {});
        expect(res.status).toBe(200);
        hour += 3;
      }
      // cancel path with reason persisted (hour 23: loop visits occupy 09–22 for this agent)
      const fx = await fixtures(token, 'lc-cancel');
      const v = (await schedule(token, visitBody(fx, userAgentA.id, iso(Date.now() + 24 * HOUR, 23)))).body.siteVisit;
      const cancelled = await request(app)
        .post(`/site-visits/${v.id}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .send({ cancellationReason: '  client asked to postpone  ' });
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.status).toBe('CANCELLED');
      expect(cancelled.body.cancellationReason).toBe('client asked to postpone');
      expect(cancelled.body.cancelledBy).toBe(userAdminA.id);
      expect(cancelled.body.cancelledAt).not.toBeNull();
    });

    test('terminal states have no exits; invalid edges rejected', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const base = Date.now() + 24 * HOUR;
      const fx = await fixtures(token, 'term');
      const v = (await schedule(token, visitBody(fx, userAgentA.id, iso(base, 9)))).body.siteVisit;
      await request(app).post(`/site-visits/${v.id}/complete`).set('Authorization', `Bearer ${token}`).send({});
      for (const op of ['confirm', 'cancel', 'complete', 'no-show']) {
        const res = await request(app)
          .post(`/site-visits/${v.id}/${op}`)
           
          .set('Authorization', `Bearer ${token}`)
          .send(op === 'cancel' ? { cancellationReason: 'x' } : {});
        expect(res.status).toBe(400);
      }
      const stored = await request(app).get(`/site-visits/${v.id}`).set('Authorization', `Bearer ${token}`);
      expect(stored.body.status).toBe('COMPLETED');
    });

    test('cancel requires a non-empty reason; reschedule on terminal rejected', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const base = Date.now() + 24 * HOUR;
      const fx = await fixtures(token, 'cancelreq');
      const v = (await schedule(token, visitBody(fx, userAgentA.id, iso(base, 9)))).body.siteVisit;
      expect((await request(app).post(`/site-visits/${v.id}/cancel`).set('Authorization', `Bearer ${token}`).send({})).status).toBe(400);
      expect((await request(app).post(`/site-visits/${v.id}/cancel`).set('Authorization', `Bearer ${token}`).send({ cancellationReason: '   ' })).status).toBe(400);
      const still = await request(app).get(`/site-visits/${v.id}`).set('Authorization', `Bearer ${token}`);
      expect(still.body.status).toBe('SCHEDULED');

      await request(app).post(`/site-visits/${v.id}/no-show`).set('Authorization', `Bearer ${token}`).send({});
      const rs = await request(app)
        .post(`/site-visits/${v.id}/reschedule`)
        .set('Authorization', `Bearer ${token}`)
        .send({ scheduledAt: iso(base, 15) });
      expect(rs.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  describe('Reschedule', () => {
    test('moves the same row after re-check; past and conflicting slots rejected', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const base = Date.now() + 24 * HOUR;
      const fx = await fixtures(token, 'rs');
      const v = (await schedule(token, visitBody(fx, userAgentA.id, iso(base, 9)))).body.siteVisit;
      await schedule(token, visitBody(fx, userAgentA.id, iso(base, 13)));

      const moved = await request(app)
        .post(`/site-visits/${v.id}/reschedule`)
        .set('Authorization', `Bearer ${token}`)
        .send({ scheduledAt: iso(base, 15), durationMinutes: 30 });
      expect(moved.status).toBe(200);
      expect(moved.body.id).toBe(v.id);
      expect(moved.body.durationMinutes).toBe(30);
      expect(moved.body.status).toBe('SCHEDULED');

      const clash = await request(app)
        .post(`/site-visits/${v.id}/reschedule`)
        .set('Authorization', `Bearer ${token}`)
        .send({ scheduledAt: iso(base, 13.5) });
      expect(clash.status).toBe(409);

      const past = await request(app)
        .post(`/site-visits/${v.id}/reschedule`)
        .set('Authorization', `Bearer ${token}`)
        .send({ scheduledAt: new Date(Date.now() - HOUR).toISOString() });
      expect(past.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  describe('Conflict detection', () => {
    test('same-agent overlap rejected; same-project overlap rejected', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const base = Date.now() + 24 * HOUR;
      const fx = await fixtures(token, 'conf1');
      const otherProject = await makeProject(token, uid('Proj-other'));
      await schedule(token, visitBody(fx, userAgentA.id, iso(base, 9)));

      // Same agent, different project, overlapping time.
      const a = await schedule(token, {
        agentId: userAgentA.id,
        projectId: otherProject.id,
        contactId: fx.contactId,
        scheduledAt: iso(base, 9.5),
      });
      expect(a.status).toBe(409);

      // Different agent, same project, overlapping time.
      const p = await schedule(token, {
        agentId: userAdminA.id,
        projectId: fx.project.id,
        contactId: fx.contactId,
        scheduledAt: iso(base, 9.5),
      });
      expect(p.status).toBe(409);
    });

    test('back-to-back inside 15-minute buffer rejected; after buffer accepted', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const base = Date.now() + 24 * HOUR;
      const fx = await fixtures(token, 'buffer');
      // 09:00–10:00 occupies the agent until 10:15.
      await schedule(token, visitBody(fx, userAgentA.id, iso(base, 9)));

      const inside = await schedule(token, visitBody(fx, userAgentA.id, iso(base, 10)));
      expect(inside.status).toBe(409);

      const edge = await schedule(token, visitBody(fx, userAgentA.id, iso(base, 10.25)));
      expect(edge.status).toBe(201);
    });

    test('different agent + different project accepted', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const base = Date.now() + 24 * HOUR;
      const fx = await fixtures(token, 'open');
      const otherProject = await makeProject(token, uid('Proj-open'));
      await schedule(token, visitBody(fx, userAgentA.id, iso(base, 9)));
      const res = await schedule(token, {
        agentId: userAdminA.id,
        projectId: otherProject.id,
        contactId: fx.contactId,
        scheduledAt: iso(base, 9),
      });
      expect(res.status).toBe(201);
    });

    test('cancelled/completed/no-show visits do not block', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const base = Date.now() + 24 * HOUR;
      // Staggered slots: each iteration leaves a SCHEDULED `again` visit
      // behind for the same agent, so iterations must not share a slot.
      const entries = [['cx', 'cancel', 9], ['done', 'complete', 12], ['ns', 'no-show', 15]];
      for (const [tag, op, hour] of entries) {
        const fx = await fixtures(token, `hist-${tag}`);
        const v = (await schedule(token, visitBody(fx, userAgentA.id, iso(base, hour)))).body.siteVisit;
         
        const tr = await request(app)
          .post(`/site-visits/${v.id}/${op}`)
          .set('Authorization', `Bearer ${token}`)
          .send(op === 'cancel' ? { cancellationReason: 'freed' } : {});
        expect(tr.status).toBe(200);
         
        const again = await schedule(token, visitBody(fx, userAgentA.id, iso(base, hour)));
        expect(again.status).toBe(201);
      }
    });

    test('contact overlap is a preference, not a constraint', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const base = Date.now() + 24 * HOUR;
      const fx = await fixtures(token, 'pref');
      const otherProject = await makeProject(token, uid('Proj-pref'));
      await schedule(token, visitBody(fx, userAgentA.id, iso(base, 9)));
      // Same contact, same time, but a free agent and a free project.
      const res = await schedule(token, {
        agentId: userAdminA.id,
        projectId: otherProject.id,
        contactId: fx.contactId,
        scheduledAt: iso(base, 9),
      });
      expect(res.status).toBe(201);
    });
  });

  // -------------------------------------------------------------------------
  describe('Concurrent scheduling races', () => {
    test('same agent + same project: exactly one wins', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const base = Date.now() + 24 * HOUR;
      const fx = await fixtures(token, 'race1');
      const body = visitBody(fx, userAgentA.id, iso(base, 9));
      const [a, b] = await Promise.all([schedule(token, body), schedule(token, body)]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect(await prisma.siteVisit.count({ where: { organizationId: orgA.id } })).toBe(1);
    });

    test('same agent + different projects: exactly one wins', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const base = Date.now() + 24 * HOUR;
      const fx = await fixtures(token, 'race2');
      const otherProject = await makeProject(token, uid('Proj-race2'));
      const mk = (projectId) => ({
        agentId: userAgentA.id,
        projectId,
        contactId: fx.contactId,
        scheduledAt: iso(base, 9),
      });
      const [a, b] = await Promise.all([
        schedule(token, mk(fx.project.id)),
        schedule(token, mk(otherProject.id)),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect(await prisma.siteVisit.count({ where: { organizationId: orgA.id } })).toBe(1);
    });

    test('different agents + same project: exactly one wins', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const base = Date.now() + 24 * HOUR;
      const fx = await fixtures(token, 'race3');
      const mk = (agentId) => ({
        agentId,
        projectId: fx.project.id,
        contactId: fx.contactId,
        scheduledAt: iso(base, 9),
      });
      const [a, b] = await Promise.all([
        schedule(token, mk(userAgentA.id)),
        schedule(token, mk(userAdminA.id)),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect(await prisma.siteVisit.count({ where: { organizationId: orgA.id } })).toBe(1);
    });

    test('failed scheduling leaves no partial visit behind', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const base = Date.now() + 24 * HOUR;
      const fx = await fixtures(token, 'rollback');
      await schedule(token, visitBody(fx, userAgentA.id, iso(base, 9)));
      const clash = await schedule(token, visitBody(fx, userAgentA.id, iso(base, 9.5)));
      expect(clash.status).toBe(409);
      expect(await prisma.siteVisit.count({ where: { organizationId: orgA.id } })).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('Idempotent scheduling', () => {
    test('same key + same payload replays without duplicating', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const base = Date.now() + 24 * HOUR;
      const fx = await fixtures(token, 'idem');
      const key = uid('svkey');
      const body = visitBody(fx, userAgentA.id, iso(base, 9));
      const first = await schedule(token, body, key);
      expect(first.status).toBe(201);
      const replay = await schedule(token, body, key);
      expect(replay.status).toBe(200);
      expect(replay.body.siteVisit.id).toBe(first.body.siteVisit.id);
      expect(await prisma.siteVisit.count({ where: { organizationId: orgA.id } })).toBe(1);
    });

    test('same key + different payload returns 409', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const base = Date.now() + 24 * HOUR;
      const fx = await fixtures(token, 'idem409');
      const key = uid('svkey');
      const first = await schedule(token, visitBody(fx, userAgentA.id, iso(base, 9)), key);
      expect(first.status).toBe(201);
      const clash = await schedule(token, visitBody(fx, userAgentA.id, iso(base, 11)), key);
      expect(clash.status).toBe(409);
      expect(await prisma.siteVisit.count({ where: { organizationId: orgA.id } })).toBe(1);
    });

    test('concurrent retries with one key create exactly one visit', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const base = Date.now() + 24 * HOUR;
      const fx = await fixtures(token, 'idemrace');
      const key = uid('svkey');
      const body = visitBody(fx, userAgentA.id, iso(base, 9));
      const [a, b] = await Promise.all([schedule(token, body, key), schedule(token, body, key)]);
      expect([a.status, b.status].sort()).toEqual([200, 201]);
      expect(await prisma.siteVisit.count({ where: { organizationId: orgA.id } })).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('Tenant isolation attacks', () => {
    test('cross-tenant reads and writes are hidden or rejected', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const base = Date.now() + 24 * HOUR;
      const fx = await fixtures(tokenA, 'xtenant');
      const v = (await schedule(tokenA, visitBody(fx, userAgentA.id, iso(base, 9)))).body.siteVisit;

      expect((await request(app).get(`/site-visits/${v.id}`).set('Authorization', `Bearer ${tokenB}`)).status).toBe(404);
      expect((await request(app).get('/site-visits').set('Authorization', `Bearer ${tokenB}`)).body).toHaveLength(0);
      expect((await request(app).post(`/site-visits/${v.id}/confirm`).set('Authorization', `Bearer ${tokenB}`).send({})).status).toBe(404);
      expect((await request(app).post(`/site-visits/${v.id}/cancel`).set('Authorization', `Bearer ${tokenB}`).send({ cancellationReason: 'x' })).status).toBe(404);
      expect(
        (
          await request(app).post(`/site-visits/${v.id}/reschedule`).set('Authorization', `Bearer ${tokenB}`).send({ scheduledAt: iso(base, 15) })
        ).status
      ).toBe(404);
    });

    test('cross-tenant agent/project/contact/deal references rejected', async () => {
      const tokenA = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenB = await login(userAdminB.email, plainAdminB, orgB.id);
      const base = Date.now() + 24 * HOUR;
      const fxA = await fixtures(tokenA, 'xrefA');
      const fxB = await fixtures(tokenB, 'xrefB');

      const badAgent = await schedule(tokenA, visitBody(fxA, userAdminB.id, iso(base, 9)));
      expect(badAgent.status).toBe(403);
      const badProject = await schedule(tokenA, {
        agentId: userAgentA.id,
        projectId: fxB.project.id,
        contactId: fxA.contactId,
        scheduledAt: iso(base, 9),
      });
      expect(badProject.status).toBe(403);
      const badContact = await schedule(tokenA, {
        agentId: userAgentA.id,
        projectId: fxA.project.id,
        contactId: fxB.contactId,
        scheduledAt: iso(base, 9),
      });
      expect(badContact.status).toBe(403);
      const badDeal = await schedule(tokenA, {
        agentId: userAgentA.id,
        projectId: fxA.project.id,
        contactId: fxA.contactId,
        dealId: fxB.dealId,
        scheduledAt: iso(base, 9),
      });
      // Deal belongs to another org's contact AND another org: 403 either way.
      expect([403, 400]).toContain(badDeal.status);
    });
  });

  // -------------------------------------------------------------------------
  describe('Authorization matrix', () => {
    test('unauthenticated, unauthorized, and authorized behavior', async () => {
      const tokenAdmin = await login(userAdminA.email, plainAdminA, orgA.id);
      const tokenAgent = await login(userAgentA.email, plainAgentA, orgA.id);
      const base = Date.now() + 24 * HOUR;
      const fx = await fixtures(tokenAdmin, 'authz');
      const v = (await schedule(tokenAdmin, visitBody(fx, userAgentA.id, iso(base, 9)))).body.siteVisit;

      expect((await schedule(null, visitBody(fx, userAgentA.id, iso(base, 11)))).status).toBe(401);

      const list = await request(app).get('/site-visits').set('Authorization', `Bearer ${tokenAgent}`);
      expect(list.status).toBe(200);
      expect((await request(app).post('/site-visits').set('Authorization', `Bearer ${tokenAgent}`).send(visitBody(fx, userAgentA.id, iso(base, 13)))).status).toBe(403);
      expect((await request(app).post(`/site-visits/${v.id}/confirm`).set('Authorization', `Bearer ${tokenAgent}`).send({})).status).toBe(403);
      expect(
        (
          await request(app).post(`/site-visits/${v.id}/reschedule`).set('Authorization', `Bearer ${tokenAgent}`).send({ scheduledAt: iso(base, 15) })
        ).status
      ).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  describe('Unit and Deal boundaries', () => {
    test('scheduling never touches units or deal stages', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const base = Date.now() + 24 * HOUR;
      const fx = await fixtures(token, 'bounds');
      const unitCount = await prisma.unit.count({ where: { organizationId: orgA.id } });
      const v = (await schedule(token, visitBody(fx, userAgentA.id, iso(base, 9), { dealId: fx.dealId }))).body.siteVisit;
      expect(v.status).toBe('SCHEDULED');
      await request(app).post(`/site-visits/${v.id}/complete`).set('Authorization', `Bearer ${token}`).send({});
      expect(await prisma.unit.count({ where: { organizationId: orgA.id } })).toBe(unitCount);
      const deal = await prisma.deal.findUnique({ where: { id: fx.dealId } });
      expect(deal.stage).toBe('NEW');
      const units = await prisma.unit.findMany({ where: { organizationId: orgA.id } });
      expect(units.every((u) => u.availabilityStatus === 'AVAILABLE')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe('Cancelled history preserved', () => {
    test('cancelled visit remains queryable but blocks nothing', async () => {
      const token = await login(userAdminA.email, plainAdminA, orgA.id);
      const base = Date.now() + 24 * HOUR;
      const fx = await fixtures(token, 'hist');
      const v = (await schedule(token, visitBody(fx, userAgentA.id, iso(base, 9)))).body.siteVisit;
      await request(app).post(`/site-visits/${v.id}/cancel`).set('Authorization', `Bearer ${token}`).send({ cancellationReason: 'kept for history' });
      const stored = await request(app).get(`/site-visits/${v.id}`).set('Authorization', `Bearer ${token}`);
      expect(stored.status).toBe(200);
      expect(stored.body.status).toBe('CANCELLED');
      expect(stored.body.cancellationReason).toBe('kept for history');
      const listed = await request(app).get('/site-visits?status=CANCELLED').set('Authorization', `Bearer ${token}`);
      expect(listed.body.map((x) => x.id)).toContain(v.id);
    });
  });
});
