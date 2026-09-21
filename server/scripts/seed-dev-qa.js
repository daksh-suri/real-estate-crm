// Dev consolidation seed — makes real_estate_crm contain the SAME deterministic
// dataset as real_estate_crm_qa (source of truth: server/scripts/seed-qa.js).
//
// Usage:
//   DATABASE_URL=postgresql://postgres:dakshsuri@localhost:5432/real_estate_crm?schema=public npm run seed:dev:qa --workspace=server
// or from server/: $env:DATABASE_URL="...real_estate_crm..."; npm run seed:dev:qa
//
// SAFETY: FAILS CLOSED unless DATABASE_URL pathname is exactly real_estate_crm.
// Never performs unfiltered deleteMany on an unknown DB. Every destructive
// operation is explicit and verified. Does NOT touch real_estate_crm_qa or
// real_estate_crm_test. Intended to replace the old "abc" dev data with the
// deterministic QA dataset (org "qa") for submission/demo.

const { prisma } = require('../src/lib/prisma');
const { hashPassword } = require('../src/lib/bcrypt');
const { normalizeEmail, normalizePhone } = require('../src/modules/contacts/normalization');

const QA_ORG_NAME = 'qa';
const QA_PASSWORD = 'QaPass123!';
const FIXED_ROLES = ['Agent', 'Team Lead', 'Manager', 'Operations/Accounts', 'Admin'];

const QA_USERS = [
  { name: 'QA Admin', email: 'qa-admin@qa.local', role: 'Admin' },
  { name: 'QA Manager', email: 'qa-manager@qa.local', role: 'Manager' },
  { name: 'QA Team Lead', email: 'qa-lead@qa.local', role: 'Team Lead' },
  { name: 'QA Agent 1', email: 'qa-agent1@qa.local', role: 'Agent' },
  { name: 'QA Agent 2', email: 'qa-agent2@qa.local', role: 'Agent' },
];

const PERMISSIONS = [
  ['activity', 'create'], ['activity', 'read'],
  ['task', 'create'], ['task', 'read'], ['task', 'complete'],
  ['assignmentRule', 'create'], ['assignmentRule', 'read'], ['assignmentRule', 'update'], ['assignmentRule', 'delete'],
  ['booking', 'create'], ['booking', 'read'], ['booking', 'cancel'],
  ['campaign', 'create'], ['campaign', 'read'], ['campaign', 'update'], ['campaign', 'delete'],
  ['contact', 'create'], ['contact', 'read'], ['contact', 'update'], ['contact', 'delete'],
  ['requirement', 'create'], ['requirement', 'read'], ['requirement', 'update'], ['requirement', 'delete'],
  ['deal', 'create'], ['deal', 'read'], ['deal', 'update'], ['deal', 'delete'], ['deal', 'transition'],
  ['team', 'create'], ['team', 'read'], ['team', 'update'], ['team', 'delete'], ['team', 'manage_members'],
  ['user', 'read'], ['user', 'create'], ['role', 'read'],
  ['enquiry', 'create'], ['enquiry', 'read'],
  ['organization', 'read'], ['organization', 'update'],
  ['leadSource', 'create'], ['leadSource', 'read'], ['leadSource', 'update'], ['leadSource', 'delete'],
  ['project', 'create'], ['project', 'read'], ['project', 'update'], ['project', 'delete'],
  ['unit', 'create'], ['unit', 'read'], ['unit', 'update'], ['unit', 'delete'],
  ['document', 'create'], ['document', 'read'], ['document', 'upload'], ['document', 'verify'], ['document', 'reject'],
  ['lead', 'create'], ['lead', 'read'], ['lead', 'update'], ['lead', 'delete'], ['lead', 'assign'],
  ['payment', 'verify'], ['paymentPlan', 'create'], ['paymentPlan', 'read'], ['paymentObligation', 'read'], ['paymentRecord', 'read'],
  ['reservation', 'create'], ['reservation', 'read'], ['reservation', 'release'],
  ['siteVisit', 'create'], ['siteVisit', 'read'], ['siteVisit', 'update'], ['siteVisit', 'transition'],
];

function assertDevDatabase() {
  const raw = process.env.DATABASE_URL || '';
  let db = '';
  try { db = new URL(raw).pathname.replace(/^\//, '').split('?')[0]; } catch { db = ''; }
  if (db !== 'real_estate_crm') {
    throw new Error(`seed:dev:qa refused — DATABASE_URL must target real_estate_crm (got "${db || raw || '(empty)'}"). Set DATABASE_URL=postgresql://.../real_estate_crm?schema=public`);
  }
  // Extra safety: refuse if host is not localhost (local-only)
  let host = '';
  try { host = new URL(raw).hostname; } catch (_e) { void _e; }
  if (host && host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error(`seed:dev:qa refused — host must be localhost for local dev (got "${host}")`);
  }
}

async function wipeAllForDev() {
  // For dev consolidation we want dev to contain ONLY the QA dataset (org "qa").
  // Wipe all tenant data for any existing orgs (e.g. old "abc") in safe FK order.
  // Every delete is scoped but we enumerate all orgs to ensure clean state.
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  const orgIds = orgs.map(o => o.id);
  if (orgIds.length === 0) return;
  const whereIn = { organizationId: { in: orgIds } };
  // Children first
  await prisma.refreshToken.deleteMany({ where: whereIn });
  await prisma.paymentRecord.deleteMany({ where: whereIn });
  await prisma.paymentObligation.deleteMany({ where: whereIn });
  await prisma.paymentPlan.deleteMany({ where: whereIn });
  await prisma.booking.deleteMany({ where: whereIn });
  await prisma.reservation.deleteMany({ where: whereIn });
  await prisma.siteVisit.deleteMany({ where: whereIn });
  await prisma.auditLog.deleteMany({ where: whereIn });
  await prisma.deal.deleteMany({ where: whereIn });
  await prisma.lead.deleteMany({ where: whereIn });
  await prisma.enquiry.deleteMany({ where: whereIn });
  await prisma.possibleDuplicate.deleteMany({ where: whereIn });
  await prisma.requirement.deleteMany({ where: whereIn });
  await prisma.document.deleteMany({ where: whereIn });
  await prisma.activity.deleteMany({ where: whereIn });
  await prisma.task.deleteMany({ where: whereIn });
  await prisma.assignmentRule.deleteMany({ where: whereIn });
  await prisma.roundRobinState.deleteMany({ where: whereIn });
  await prisma.idempotencyKey.deleteMany({ where: whereIn });
  await prisma.outboxEvent.deleteMany({ where: whereIn });
  await prisma.teamMembership.deleteMany({ where: whereIn });
  await prisma.campaign.deleteMany({ where: whereIn });
  await prisma.leadSource.deleteMany({ where: whereIn });
  await prisma.unit.deleteMany({ where: whereIn });
  await prisma.project.deleteMany({ where: whereIn });
  await prisma.contact.deleteMany({ where: whereIn });
  await prisma.user.deleteMany({ where: whereIn });
  await prisma.rolePermission.deleteMany({ where: whereIn });
  await prisma.role.deleteMany({ where: whereIn });
  await prisma.team.deleteMany({ where: whereIn });
  // Finally organizations themselves (any org not "qa" will be removed; "qa" will be upserted after)
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
}

async function main() {
  assertDevDatabase();
  console.log('seed:dev:qa — targeting real_estate_crm (dev) with deterministic QA dataset');

  // Verify explicitly before destructive
  const raw = process.env.DATABASE_URL || '';
  let db = '';
  try { db = new URL(raw).pathname.replace(/^\//, '').split('?')[0]; } catch (_e) { void _e; }
  console.log(`  verified target: ${db} on ${new URL(raw).hostname}`);

  // Wipe all existing dev data (safe, scoped, verified)
  console.log('  wiping previous dev data (all orgs) — will recreate deterministic QA dataset');
  await wipeAllForDev();

  const org = await prisma.organization.upsert({
    where: { name: QA_ORG_NAME },
    update: {},
    create: { name: QA_ORG_NAME },
  });
  console.log(`  org: ${org.name} (${org.id})`);

  // Permissions (global, upsert)
  const permRows = [];
  for (const [resource, action] of PERMISSIONS) {
    permRows.push(await prisma.permission.upsert({
      where: { resource_action: { resource, action } },
      update: {},
      create: { resource, action },
    }));
  }

  // Roles
  const rolesByName = {};
  for (const name of FIXED_ROLES) {
    const r = await prisma.role.create({ data: { name, organizationId: org.id } });
    rolesByName[name] = r;
  }
  for (const perm of permRows) {
    await prisma.rolePermission.create({ data: { organizationId: org.id, roleId: rolesByName['Admin'].id, permissionId: perm.id, scope: 'ORGANIZATION' } });
  }
  for (const perm of permRows) {
    await prisma.rolePermission.create({ data: { organizationId: org.id, roleId: rolesByName['Manager'].id, permissionId: perm.id, scope: 'ORGANIZATION' } });
  }
  for (const perm of permRows) {
    await prisma.rolePermission.create({ data: { organizationId: org.id, roleId: rolesByName['Team Lead'].id, permissionId: perm.id, scope: 'ORGANIZATION' } });
  }
  for (const perm of permRows) {
    if (perm.resource === 'organization' && perm.action === 'update') continue;
    await prisma.rolePermission.create({ data: { organizationId: org.id, roleId: rolesByName['Agent'].id, permissionId: perm.id, scope: 'ORGANIZATION' } });
  }
  for (const perm of permRows) {
    await prisma.rolePermission.create({ data: { organizationId: org.id, roleId: rolesByName['Operations/Accounts'].id, permissionId: perm.id, scope: 'ORGANIZATION' } });
  }

  // Users
  const pw = await hashPassword(QA_PASSWORD);
  const usersByEmail = {};
  for (const u of QA_USERS) {
    const role = rolesByName[u.role];
    const row = await prisma.user.create({
      data: { name: u.name, email: u.email, passwordHash: pw, organizationId: org.id, roleId: role.id, status: 'ACTIVE' },
    });
    usersByEmail[u.email] = row;
  }

  // Teams
  const teamAlpha = await prisma.team.create({ data: { name: 'Alpha Sales', organizationId: org.id } });
  const teamBeta = await prisma.team.create({ data: { name: 'Beta Ops', organizationId: org.id } });
  const alphaEmails = ['qa-admin@qa.local', 'qa-manager@qa.local', 'qa-lead@qa.local', 'qa-agent1@qa.local'];
  for (const em of alphaEmails) {
    await prisma.teamMembership.create({ data: { userId: usersByEmail[em].id, teamId: teamAlpha.id, organizationId: org.id } });
  }
  await prisma.teamMembership.create({ data: { userId: usersByEmail['qa-agent2@qa.local'].id, teamId: teamBeta.id, organizationId: org.id } });

  // AssignmentRule must exist BEFORE intake
  await prisma.assignmentRule.create({ data: { organizationId: org.id, type: 'ROUND_ROBIN', order: 0, config: { teamId: teamAlpha.id }, active: true } });

  // LeadSources + Campaigns
  const lsWebsite = await prisma.leadSource.create({ data: { name: 'Website', type: 'Digital', organizationId: org.id } });
  const lsReferral = await prisma.leadSource.create({ data: { name: 'Referral', type: 'Referral', organizationId: org.id } });
  const lsWalkin = await prisma.leadSource.create({ data: { name: 'Walk-in', type: 'Offline', organizationId: org.id } });
  const lsPortal = await prisma.leadSource.create({ data: { name: 'Property Portal', type: 'Portal', organizationId: org.id } });
  const campResidential = await prisma.campaign.create({ data: { name: 'Residential Campaign', leadSourceId: lsWebsite.id, organizationId: org.id, startDate: new Date('2025-10-01'), endDate: new Date('2025-12-31') } });
  const campFestival = await prisma.campaign.create({ data: { name: 'Festival Campaign', leadSourceId: lsPortal.id, organizationId: org.id, startDate: new Date('2025-11-01'), endDate: new Date('2026-01-15') } });

  // Projects + Units
  const projPalm = await prisma.project.create({ data: { name: 'Palm Meadows', location: 'Mumbai', status: 'ACTIVE', organizationId: org.id } });
  const projSky = await prisma.project.create({ data: { name: 'Skyline Towers', location: 'Pune', status: 'PLANNED', organizationId: org.id } });
  const unitA101 = await prisma.unit.create({ data: { identifier: 'A-101', projectId: projPalm.id, organizationId: org.id, totalCost: 7500000, availabilityStatus: 'AVAILABLE' } });
  const unitA102 = await prisma.unit.create({ data: { identifier: 'A-102', projectId: projPalm.id, organizationId: org.id, totalCost: 8200000, availabilityStatus: 'AVAILABLE' } });
  const unitA103 = await prisma.unit.create({ data: { identifier: 'A-103', projectId: projPalm.id, organizationId: org.id, totalCost: 6800000, availabilityStatus: 'BLOCKED' } });
  const unitB201 = await prisma.unit.create({ data: { identifier: 'B-201', projectId: projSky.id, organizationId: org.id, totalCost: 9000000, availabilityStatus: 'AVAILABLE' } });
  const unitB202 = await prisma.unit.create({ data: { identifier: 'B-202', projectId: projSky.id, organizationId: org.id, totalCost: 9500000, availabilityStatus: 'AVAILABLE' } });

  function cData(name, email, phone, extra = {}) {
    return { name, email, phone, normalizedEmail: normalizeEmail(email), normalizedPhone: normalizePhone(phone), organizationId: org.id, communicationConsent: extra.communicationConsent || 'OPTED_IN', consentSource: extra.consentSource || 'qa-seed', consentUpdatedAt: new Date(), ...extra };
  }
  const contactAarav = await prisma.contact.create({ data: cData('Aarav Sharma', 'aarav@qa.local', '9876543210') });
  const contactPriya = await prisma.contact.create({ data: cData('Priya Patel', 'priya@qa.local', '9876543211') });
  const contactRohan = await prisma.contact.create({ data: cData('Rohan Mehta', 'rohan@qa.local', '9876543212') });
  const contactSneha = await prisma.contact.create({ data: cData('Sneha Reddy', 'sneha@qa.local', '9876543213') });
  const contactVikram = await prisma.contact.create({ data: cData('Vikram Singh', 'vikram@qa.local', '9876543214') });
  const contactAnanya = await prisma.contact.create({ data: cData('Ananya Gupta', 'ananya@qa.local', '9876543215') });
  const contactKabir = await prisma.contact.create({ data: cData('Kabir Khan', 'kabir@qa.local', '9876543216') });

  await prisma.requirement.create({ data: { organizationId: org.id, contactId: contactAarav.id, unitTypePreference: '2BHK', budgetMin: 5000000, budgetMax: 8000000, preferredProjectIds: [projPalm.id], possessionPreference: 'Ready', notes: 'Needs 2BHK near Mumbai' } });
  await prisma.requirement.create({ data: { organizationId: org.id, contactId: contactPriya.id, unitTypePreference: '3BHK', budgetMin: 8000000, budgetMax: 12000000, preferredProjectIds: [], notes: 'Unlinked example — intake will not overwrite' } });
  await prisma.requirement.create({ data: { organizationId: org.id, contactId: contactRohan.id, unitTypePreference: '1BHK', budgetMin: 3000000, budgetMax: 5000000, preferredProjectIds: [projSky.id], notes: 'Multi-enquiry contact' } });

  const { createTenantPrisma } = require('../src/lib/tenant');
  const { intakeEnquiry } = require('../src/modules/enquiries/service');
  const tenantPrisma = createTenantPrisma(org.id);

  await intakeEnquiry({ tenantPrisma, organizationId: org.id, idempotencyKey: 'qa-e1', input: { channel: 'PORTAL', contactName: 'Aarav Sharma', phone: '9876543210', email: 'aarav@qa.local', projectId: projPalm.id, leadSourceId: lsWebsite.id, campaignId: campResidential.id, rawPayload: { source: 'qa-e1' } } });
  await intakeEnquiry({ tenantPrisma, organizationId: org.id, idempotencyKey: 'qa-e2', input: { channel: 'WALK_IN', contactName: 'Rohan Mehta', phone: '9876543212', email: 'rohan@qa.local', projectId: projSky.id, leadSourceId: lsWalkin.id, rawPayload: { source: 'qa-e2' } } });
  await intakeEnquiry({ tenantPrisma, organizationId: org.id, idempotencyKey: 'qa-e3', input: { channel: 'PHONE', contactName: 'Unknown Caller', phone: '', email: '', projectId: projPalm.id, rawPayload: { notes: 'missed call, no identity' } } });
  await intakeEnquiry({ tenantPrisma, organizationId: org.id, idempotencyKey: 'qa-e4', input: { channel: 'OWNED_FORM', contactName: 'Priya Patel', phone: '9876543211', email: 'priya@qa.local', projectId: projPalm.id, leadSourceId: lsReferral.id, rawPayload: { source: 'qa-e4' }, requirement: { unitTypePreference: '3BHK', budgetMin: 8000000, budgetMax: 12000000, preferredProjectIds: [projPalm.id], notes: 'Intake-supplied requirement' } } });
  await intakeEnquiry({ tenantPrisma, organizationId: org.id, idempotencyKey: 'qa-e5', input: { channel: 'PORTAL', contactName: 'Aarav Sharma', phone: '9876543210', email: 'aarav@qa.local', projectId: projPalm.id, leadSourceId: lsPortal.id, campaignId: campFestival.id, rawPayload: { source: 'qa-e5 repeat' } } });
  await intakeEnquiry({ tenantPrisma, organizationId: org.id, idempotencyKey: 'qa-e6', input: { channel: 'PORTAL', contactName: 'Sneha Reddy', phone: '9876543213', email: 'sneha@qa.local', projectId: projPalm.id, leadSourceId: lsWebsite.id, rawPayload: { source: 'qa-e6' } } });

  let leads = await prisma.lead.findMany({ where: { organizationId: org.id }, orderBy: { createdAt: 'asc' } });
  console.log(`  enquiries: 6, leads: ${leads.length}`);
  const priyaLead = leads.find(l => l.contactId === contactPriya.id);
  if (priyaLead) {
    await prisma.lead.update({ where: { id: priyaLead.id }, data: { status: 'DISQUALIFIED' } });
    console.log(`  lead DISQUALIFIED: ${priyaLead.id} (Priya)`);
  }
  leads = await prisma.lead.findMany({ where: { organizationId: org.id }, orderBy: { createdAt: 'asc' } });

  const { createDeal, transitionDeal } = require('../src/modules/deals/service');
  const adminUser = usersByEmail['qa-admin@qa.local'];
  const openLeads = await prisma.lead.findMany({ where: { organizationId: org.id, status: 'OPEN' }, orderBy: { createdAt: 'asc' } });
  const dealLead1 = openLeads.find(l => l.contactId === contactAarav.id) || openLeads[0];
  const dealLead2 = openLeads.find(l => l.contactId === contactRohan.id) || openLeads[1] || openLeads[0];
  const snehaLead = openLeads.find(l => l.contactId === contactSneha.id) || openLeads[openLeads.length - 1];
  const deal1 = await createDeal({ tenantPrisma, organizationId: org.id, actorId: adminUser.id, leadId: dealLead1.id });
  const deal2 = await createDeal({ tenantPrisma, organizationId: org.id, actorId: adminUser.id, leadId: dealLead2.id });
  const deal3 = await createDeal({ tenantPrisma, organizationId: org.id, actorId: adminUser.id, leadId: snehaLead.id });
  console.log(`  deals: 3 (${deal1.id}, ${deal2.id}, ${deal3.id})`);
  const forward = ['QUALIFIED','SITE_VISIT_SCHEDULED','NEGOTIATION','RESERVATION','BOOKING_CONFIRMED','AGREEMENT_SIGNED','PAYMENT_IN_PROGRESS','CLOSED_WON'];
  for (const stage of forward) { await transitionDeal({ tenantPrisma, organizationId: org.id, actorId: adminUser.id, dealId: deal1.id, stage }); }
  for (const stage of ['QUALIFIED','SITE_VISIT_SCHEDULED','NEGOTIATION']) { await transitionDeal({ tenantPrisma, organizationId: org.id, actorId: adminUser.id, dealId: deal2.id, stage }); }
  await transitionDeal({ tenantPrisma, organizationId: org.id, actorId: adminUser.id, dealId: deal2.id, stage: 'CLOSED_LOST', lostReason: 'Budget shifted to other city' });

  const now = Date.now();
  const day = 24*60*60*1000;
  const agent1 = usersByEmail['qa-agent1@qa.local'];
  const agent2 = usersByEmail['qa-agent2@qa.local'];
  const sv1 = await prisma.siteVisit.create({ data: { organizationId: org.id, agentId: agent1.id, projectId: projPalm.id, contactId: contactAarav.id, dealId: deal1.id, scheduledAt: new Date(now + 2*day), durationMinutes: 60, status: 'SCHEDULED' } });
  const sv2 = await prisma.siteVisit.create({ data: { organizationId: org.id, agentId: agent2.id, projectId: projSky.id, contactId: contactRohan.id, dealId: deal2.id, scheduledAt: new Date(now + 3*day), durationMinutes: 45, status: 'CONFIRMED' } });
  const sv3 = await prisma.siteVisit.create({ data: { organizationId: org.id, agentId: agent1.id, projectId: projPalm.id, contactId: contactSneha.id, dealId: deal3.id, scheduledAt: new Date(now - 5*day), durationMinutes: 60, status: 'COMPLETED' } });
  const sv4 = await prisma.siteVisit.create({ data: { organizationId: org.id, agentId: agent2.id, projectId: projPalm.id, contactId: contactVikram.id, scheduledAt: new Date(now - 2*day), durationMinutes: 60, status: 'CANCELLED', cancelledBy: adminUser.id, cancellationReason: 'Client requested reschedule', cancelledAt: new Date(now - 2*day + 60*60000) } });
  const sv5 = await prisma.siteVisit.create({ data: { organizationId: org.id, agentId: agent1.id, projectId: projSky.id, contactId: contactAnanya.id, scheduledAt: new Date(now - 1*day), durationMinutes: 60, status: 'NO_SHOW' } });
  const { rescheduleSiteVisit } = require('../src/modules/siteVisits/service');
  await rescheduleSiteVisit({ tenantPrisma, organizationId: org.id, siteVisitId: sv1.id, scheduledAt: new Date(now + 4*day), durationMinutes: 90 });

  const resActive = await prisma.reservation.create({ data: { organizationId: org.id, unitId: unitA101.id, dealId: deal1.id, type: 'RESERVATION', status: 'ACTIVE', expiresAt: new Date(now + 5*day) } });
  await prisma.unit.update({ where: { id: unitA101.id }, data: { availabilityStatus: 'RESERVED' } });
  await prisma.deal.update({ where: { id: deal1.id }, data: { unitId: unitA101.id } });
  const holdActive = await prisma.reservation.create({ data: { organizationId: org.id, unitId: unitA102.id, dealId: deal2.id, type: 'HOLD', status: 'ACTIVE', expiresAt: null } });
  await prisma.unit.update({ where: { id: unitA102.id }, data: { availabilityStatus: 'ON_HOLD' } });
  const resExpiring = await prisma.reservation.create({ data: { organizationId: org.id, unitId: unitB201.id, dealId: deal3.id, type: 'RESERVATION', status: 'ACTIVE', expiresAt: new Date(now + 2*60*60*1000) } });
  await prisma.unit.update({ where: { id: unitB201.id }, data: { availabilityStatus: 'RESERVED' } });
  await prisma.deal.update({ where: { id: deal3.id }, data: { unitId: unitB201.id } });
  const resForRelease = await prisma.reservation.create({ data: { organizationId: org.id, unitId: unitB202.id, dealId: deal2.id, type: 'RESERVATION', status: 'ACTIVE', expiresAt: new Date(now + 10*day) } });
  await prisma.unit.update({ where: { id: unitB202.id }, data: { availabilityStatus: 'RESERVED' } });
  await prisma.reservation.update({ where: { id: resForRelease.id }, data: { status: 'RELEASED' } });
  await prisma.unit.update({ where: { id: unitB202.id }, data: { availabilityStatus: 'AVAILABLE' } });
  await prisma.reservation.create({ data: { organizationId: org.id, unitId: unitB202.id, dealId: deal1.id, type: 'RESERVATION', status: 'EXPIRED', expiresAt: new Date(now - 1*day) } });
  const extraUnit = await prisma.unit.create({ data: { identifier: 'A-104', projectId: projPalm.id, organizationId: org.id, totalCost: 7900000, availabilityStatus: 'AVAILABLE' } });
  const resForBooking = await prisma.reservation.create({ data: { organizationId: org.id, unitId: extraUnit.id, dealId: deal1.id, type: 'RESERVATION', status: 'ACTIVE', expiresAt: new Date(now + 7*day) } });
  await prisma.unit.update({ where: { id: extraUnit.id }, data: { availabilityStatus: 'RESERVED' } });
  const booking = await prisma.booking.create({ data: { organizationId: org.id, unitId: extraUnit.id, dealId: deal1.id, reservationId: resForBooking.id } });
  await prisma.unit.update({ where: { id: extraUnit.id }, data: { availabilityStatus: 'BOOKED' } });
  await prisma.reservation.update({ where: { id: resForBooking.id }, data: { status: 'CONVERTED' } });

  const plan = await prisma.paymentPlan.create({ data: { organizationId: org.id, dealId: deal1.id } });
  const obFuture = await prisma.paymentObligation.create({ data: { organizationId: org.id, paymentPlanId: plan.id, dueAmount: 500000, dueDate: new Date(now + 10*day), status: 'PENDING' } });
  const obPastDue = await prisma.paymentObligation.create({ data: { organizationId: org.id, paymentPlanId: plan.id, dueAmount: 300000, dueDate: new Date(now - 3*day), status: 'PENDING' } });
  const obPaid = await prisma.paymentObligation.create({ data: { organizationId: org.id, paymentPlanId: plan.id, dueAmount: 250000, dueDate: new Date(now - 10*day), status: 'PAID' } });
  await prisma.paymentRecord.create({ data: { organizationId: org.id, obligationId: obPaid.id, amount: 250000, status: 'SUCCESS', gatewayReference: 'GW-PAID-1' } });
  await prisma.paymentRecord.create({ data: { organizationId: org.id, obligationId: obPastDue.id, amount: 100000, status: 'FAILED', gatewayReference: 'GW-FAIL-1' } });
  await prisma.paymentRecord.create({ data: { organizationId: org.id, obligationId: obFuture.id, amount: 500000, status: 'PENDING' } });
  const failedRec = await prisma.paymentRecord.findFirst({ where: { organizationId: org.id, gatewayReference: 'GW-FAIL-1' } });
  await prisma.paymentRecord.create({ data: { organizationId: org.id, obligationId: obPastDue.id, amount: 300000, status: 'SUCCESS', gatewayReference: 'GW-CORR-1', correctsRecordId: failedRec.id } });

  const { randomUUID } = require('crypto');
  function storageKey(orgId, contactId, groupId, version) { return `${orgId}/${contactId}/${groupId}/v${version}`; }
  const docGroup1 = randomUUID();
  await prisma.document.create({ data: { organizationId: org.id, groupId: docGroup1, version: 1, contactId: contactAarav.id, dealId: deal1.id, type: 'KYC_Aadhaar', status: 'VERIFIED', storageKey: storageKey(org.id, contactAarav.id, docGroup1, 1), reviewedBy: adminUser.id, reviewedAt: new Date(now - 1*day) } });
  const docGroup2 = randomUUID();
  await prisma.document.create({ data: { organizationId: org.id, groupId: docGroup2, version: 1, contactId: contactPriya.id, type: 'KYC_PAN', status: 'UNDER_REVIEW', storageKey: storageKey(org.id, contactPriya.id, docGroup2, 1) } });
  const docGroup3 = randomUUID();
  const doc3v1 = await prisma.document.create({ data: { organizationId: org.id, groupId: docGroup3, version: 1, contactId: contactSneha.id, dealId: deal3.id, type: 'Agreement', status: 'REJECTED', storageKey: storageKey(org.id, contactSneha.id, docGroup3, 1), rejectionReason: 'Blurry scan', reviewedBy: adminUser.id, reviewedAt: new Date(now - 2*60*60000) } });
  await prisma.document.create({ data: { organizationId: org.id, groupId: docGroup3, version: 2, supersedesId: doc3v1.id, contactId: contactSneha.id, dealId: deal3.id, type: 'Agreement', status: 'RESUBMITTED', storageKey: storageKey(org.id, contactSneha.id, docGroup3, 2) } });
  const docGroup4 = randomUUID();
  await prisma.document.create({ data: { organizationId: org.id, groupId: docGroup4, version: 1, contactId: contactVikram.id, type: 'IncomeProof', status: 'SUBMITTED', storageKey: storageKey(org.id, contactVikram.id, docGroup4, 1) } });

  await prisma.activity.create({ data: { organizationId: org.id, contactId: contactAarav.id, dealId: deal1.id, type: 'Call', outcome: 'OUTBOUND_connected', notes: 'Discussed 2BHK pricing', createdBy: adminUser.id } });
  await prisma.activity.create({ data: { organizationId: org.id, contactId: contactRohan.id, type: 'Meeting', outcome: 'INBOUND_site_visit_requested', notes: 'Wants visit next week', createdBy: usersByEmail['qa-agent1@qa.local'].id } });
  await prisma.activity.create({ data: { organizationId: org.id, contactId: contactSneha.id, dealId: deal3.id, type: 'FollowUp', outcome: 'OUTBOUND_no_answer', notes: 'Follow up on booking', createdBy: adminUser.id } });
  await prisma.activity.create({ data: { organizationId: org.id, contactId: contactVikram.id, type: 'Note', outcome: null, notes: 'General note without outcome', createdBy: adminUser.id } });
  await prisma.task.create({ data: { organizationId: org.id, assignedTo: usersByEmail['qa-agent1@qa.local'].id, relatedContactId: contactAarav.id, relatedDealId: deal1.id, title: 'Call Aarav back tomorrow', dueAt: new Date(now + 1*day), status: 'OPEN', createdBy: adminUser.id } });
  await prisma.task.create({ data: { organizationId: org.id, assignedTo: usersByEmail['qa-agent2@qa.local'].id, relatedContactId: contactRohan.id, title: 'Send brochure to Rohan', dueAt: new Date(now - 1*day), status: 'DONE', createdBy: adminUser.id } });
  await prisma.task.create({ data: { organizationId: org.id, assignedTo: usersByEmail['qa-agent1@qa.local'].id, relatedContactId: contactSneha.id, title: 'Overdue: close verification', dueAt: new Date(now - 5*day), status: 'OPEN', createdBy: adminUser.id } });

  const counts = {
    organization: org.name,
    users: 5, teams: 2, leadSources: 4, campaigns: 2, projects: 2, units: 6, contacts: 7, requirements: 3,
    enquiries: await prisma.enquiry.count({ where: { organizationId: org.id } }),
    leads: await prisma.lead.count({ where: { organizationId: org.id } }),
    deals: await prisma.deal.count({ where: { organizationId: org.id } }),
    siteVisits: await prisma.siteVisit.count({ where: { organizationId: org.id } }),
    reservations: await prisma.reservation.count({ where: { organizationId: org.id } }),
    bookings: await prisma.booking.count({ where: { organizationId: org.id } }),
    paymentPlans: await prisma.paymentPlan.count({ where: { organizationId: org.id } }),
    paymentObligations: await prisma.paymentObligation.count({ where: { organizationId: org.id } }),
    paymentRecords: await prisma.paymentRecord.count({ where: { organizationId: org.id } }),
    documents: await prisma.document.count({ where: { organizationId: org.id } }),
    activities: await prisma.activity.count({ where: { organizationId: org.id } }),
    tasks: await prisma.task.count({ where: { organizationId: org.id } }),
  };
  console.log('seed:dev:qa complete — dev now mirrors QA deterministic dataset');
  console.log(`  org: ${counts.organization} (${org.id}) — use this ID on login`);
  console.log(`  users (password: ${QA_PASSWORD}):`);
  for (const u of QA_USERS) console.log(`    ${u.email} (${u.role})`);
  console.log('  counts:', JSON.stringify(counts, null, 2));
}

main().catch((err) => {
  console.error(`seed:dev:qa failed: ${err.message}`);
  if (err.stack) console.error(err.stack);
  process.exitCode = 1;
}).finally(async () => { await prisma.$disconnect(); });
