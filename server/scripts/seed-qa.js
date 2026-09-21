// QA seed for real_estate_crm_qa — deterministic, repeatable, isolated.
//
// Usage:
//   DATABASE_URL=postgresql://postgres:dakshsuri@localhost:5432/real_estate_crm_qa?schema=public npm run seed:qa --workspace=server
// or from server/: $env:DATABASE_URL="...real_estate_crm_qa..."; npm run seed:qa
//
// SAFETY: FAILS CLOSED unless DATABASE_URL pathname is exactly real_estate_crm_qa.
// Never performs an unfiltered deleteMany. Every destructive operation is
// WHERE organizationId = qaOrg.id in safe FK order. Does NOT touch abc or test DBs.

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

// Same permission set as seed-dev (dev Admin gets all). QA Admin same.
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
  ['user', 'read'], ['user', 'create'], ['role', 'read'], ['role', 'create'], ['role', 'update'],
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

function assertQaDatabase() {
  const raw = process.env.DATABASE_URL || '';
  let db = '';
  try { db = new URL(raw).pathname.replace(/^\//, '').split('?')[0]; } catch { db = ''; }
  if (db !== 'real_estate_crm_qa') {
    throw new Error(`seed:qa refused — DATABASE_URL must target real_estate_crm_qa (got "${db || raw || '(empty)'}"). Set DATABASE_URL=postgresql://.../real_estate_crm_qa?schema=public`);
  }
}

async function wipeQaOrg(organizationId) {
  // Safe FK order: children first, parents last. Every delete is WHERE organizationId=qaOrg.id
  // Order respects Restrict constraints (Deal→Unit, Lead→Enquiry origin, Plan→Deal, etc.)
  const where = { organizationId };
  // Refresh tokens first (user dependents)
  await prisma.refreshToken.deleteMany({ where });
  await prisma.paymentRecord.deleteMany({ where });
  await prisma.paymentObligation.deleteMany({ where });
  await prisma.paymentPlan.deleteMany({ where });
  await prisma.booking.deleteMany({ where });
  await prisma.reservation.deleteMany({ where });
  await prisma.siteVisit.deleteMany({ where });
  await prisma.auditLog.deleteMany({ where });
  await prisma.deal.deleteMany({ where });
  await prisma.lead.deleteMany({ where });
  await prisma.enquiry.deleteMany({ where });
  await prisma.possibleDuplicate.deleteMany({ where });
  await prisma.requirement.deleteMany({ where });
  await prisma.document.deleteMany({ where });
  await prisma.activity.deleteMany({ where });
  await prisma.task.deleteMany({ where });
  await prisma.assignmentRule.deleteMany({ where });
  await prisma.roundRobinState.deleteMany({ where });
  await prisma.idempotencyKey.deleteMany({ where });
  await prisma.outboxEvent.deleteMany({ where });
  await prisma.teamMembership.deleteMany({ where });
  await prisma.campaign.deleteMany({ where });
  await prisma.leadSource.deleteMany({ where });
  await prisma.unit.deleteMany({ where });
  await prisma.project.deleteMany({ where });
  await prisma.contact.deleteMany({ where });
  await prisma.user.deleteMany({ where });
  await prisma.rolePermission.deleteMany({ where });
  await prisma.role.deleteMany({ where });
  await prisma.team.deleteMany({ where });
}

async function main() {
  assertQaDatabase();

  console.log('seed:qa — targeting real_estate_crm_qa');
  const org = await prisma.organization.upsert({
    where: { name: QA_ORG_NAME },
    update: {},
    create: { name: QA_ORG_NAME },
  });
  console.log(`  org: ${org.name} (${org.id})`);

  // Wipe only this org's QA data (safe, scoped)
  console.log('  wiping previous QA data for org', org.id);
  await wipeQaOrg(org.id);

  // Permissions (global)
  const permRows = [];
  for (const [resource, action] of PERMISSIONS) {
    permRows.push(await prisma.permission.upsert({
      where: { resource_action: { resource, action } },
      update: {},
      create: { resource, action },
    }));
  }

  // Roles (per-org, 5 fixed)
  const rolesByName = {};
  for (const name of FIXED_ROLES) {
    const r = await prisma.role.create({ data: { name, organizationId: org.id } });
    rolesByName[name] = r;
  }

  // RolePermissions: Admin gets all at ORGANIZATION, others get meaningful subset
  // Manager: most except org update; Team Lead: team/contact/lead/deal/visit; Agent: scoped subset; Ops/Accounts: payments/docs
  // For QA simplicity: Admin = all, Manager = all, Team Lead = all except org update, Agent = standard sales, Ops = docs/payments.
  // We grant broadly so browser QA doesn't hit 403 mid-workflow; tenant isolation is tested separately.
  for (const perm of permRows) {
    // Admin gets all
    await prisma.rolePermission.create({ data: { organizationId: org.id, roleId: rolesByName['Admin'].id, permissionId: perm.id, scope: 'ORGANIZATION' } });
  }
  const managerPerms = permRows; // full for now
  for (const perm of managerPerms) {
    await prisma.rolePermission.create({ data: { organizationId: org.id, roleId: rolesByName['Manager'].id, permissionId: perm.id, scope: 'ORGANIZATION' } });
  }
  for (const perm of permRows) {
    await prisma.rolePermission.create({ data: { organizationId: org.id, roleId: rolesByName['Team Lead'].id, permissionId: perm.id, scope: 'ORGANIZATION' } });
  }
  // Agent: exclude org update, team delete, role read maybe limited but give all for QA navigation
  for (const perm of permRows) {
    if (perm.resource === 'organization' && perm.action === 'update') continue;
    await prisma.rolePermission.create({ data: { organizationId: org.id, roleId: rolesByName['Agent'].id, permissionId: perm.id, scope: 'ORGANIZATION' } });
  }
  for (const perm of permRows) {
    await prisma.rolePermission.create({ data: { organizationId: org.id, roleId: rolesByName['Operations/Accounts'].id, permissionId: perm.id, scope: 'ORGANIZATION' } });
  }

  // Users (5, deterministic password)
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

  // AssignmentRule: one active ROUND_ROBIN over Alpha Sales — must exist BEFORE intakeEnquiry so leads get AUTO assignment
  const rule = await prisma.assignmentRule.create({ data: { organizationId: org.id, type: 'ROUND_ROBIN', order: 0, config: { teamId: teamAlpha.id }, active: true } });

  // LeadSources (4) + Campaigns (2)
  const lsWebsite = await prisma.leadSource.create({ data: { name: 'Website', type: 'Digital', organizationId: org.id } });
  const lsReferral = await prisma.leadSource.create({ data: { name: 'Referral', type: 'Referral', organizationId: org.id } });
  const lsWalkin = await prisma.leadSource.create({ data: { name: 'Walk-in', type: 'Offline', organizationId: org.id } });
  const lsPortal = await prisma.leadSource.create({ data: { name: 'Property Portal', type: 'Portal', organizationId: org.id } });
  const campResidential = await prisma.campaign.create({ data: { name: 'Residential Campaign', leadSourceId: lsWebsite.id, organizationId: org.id, startDate: new Date('2025-10-01'), endDate: new Date('2025-12-31') } });
  const campFestival = await prisma.campaign.create({ data: { name: 'Festival Campaign', leadSourceId: lsPortal.id, organizationId: org.id, startDate: new Date('2025-11-01'), endDate: new Date('2026-01-15') } });

  // Projects (2) + Units (5)
  const projPalm = await prisma.project.create({ data: { name: 'Palm Meadows', location: 'Mumbai', status: 'ACTIVE', organizationId: org.id } });
  const projSky = await prisma.project.create({ data: { name: 'Skyline Towers', location: 'Pune', status: 'PLANNED', organizationId: org.id } });
  const unitA101 = await prisma.unit.create({ data: { identifier: 'A-101', projectId: projPalm.id, organizationId: org.id, totalCost: 7500000, availabilityStatus: 'AVAILABLE' } });
  const unitA102 = await prisma.unit.create({ data: { identifier: 'A-102', projectId: projPalm.id, organizationId: org.id, totalCost: 8200000, availabilityStatus: 'AVAILABLE' } });
  const unitA103 = await prisma.unit.create({ data: { identifier: 'A-103', projectId: projPalm.id, organizationId: org.id, totalCost: 6800000, availabilityStatus: 'BLOCKED' } });
  const unitB201 = await prisma.unit.create({ data: { identifier: 'B-201', projectId: projSky.id, organizationId: org.id, totalCost: 9000000, availabilityStatus: 'AVAILABLE' } });
  const unitB202 = await prisma.unit.create({ data: { identifier: 'B-202', projectId: projSky.id, organizationId: org.id, totalCost: 9500000, availabilityStatus: 'AVAILABLE' } });

  // Contacts (7) — deterministic identities
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

  // Requirements (3) — linked/unlinked/preferredProject
  const reqAarav = await prisma.requirement.create({ data: { organizationId: org.id, contactId: contactAarav.id, unitTypePreference: '2BHK', budgetMin: 5000000, budgetMax: 8000000, preferredProjectIds: [projPalm.id], possessionPreference: 'Ready', notes: 'Needs 2BHK near Mumbai' } });
  const reqPriya = await prisma.requirement.create({ data: { organizationId: org.id, contactId: contactPriya.id, unitTypePreference: '3BHK', budgetMin: 8000000, budgetMax: 12000000, preferredProjectIds: [], notes: 'Unlinked example — intake will not overwrite' } });
  const reqRohan = await prisma.requirement.create({ data: { organizationId: org.id, contactId: contactRohan.id, unitTypePreference: '1BHK', budgetMin: 3000000, budgetMax: 5000000, preferredProjectIds: [projSky.id], notes: 'Multi-enquiry contact' } });

  // Enquiries + Leads via intake workflow (through service). Use tenantPrisma for proper guards.
  // We use the tenant helper for intake so assignment/locks/partial index behave correctly.
  const { createTenantPrisma } = require('../src/lib/tenant');
  const { intakeEnquiry } = require('../src/modules/enquiries/service');
  const tenantPrisma = createTenantPrisma(org.id);

  // 1) PORTAL matched — Aarav + Palm Meadows + Website/Residential (creates OPEN lead)
  const e1 = await intakeEnquiry({ tenantPrisma, organizationId: org.id, idempotencyKey: 'qa-e1', input: { channel: 'PORTAL', contactName: 'Aarav Sharma', phone: '9876543210', email: 'aarav@qa.local', projectId: projPalm.id, leadSourceId: lsWebsite.id, campaignId: campResidential.id, rawPayload: { source: 'qa-e1' } } });
  // 2) WALK_IN matched — Rohan + Skyline + Walk-in (creates OPEN lead for Rohan)
  const e2 = await intakeEnquiry({ tenantPrisma, organizationId: org.id, idempotencyKey: 'qa-e2', input: { channel: 'WALK_IN', contactName: 'Rohan Mehta', phone: '9876543212', email: 'rohan@qa.local', projectId: projSky.id, leadSourceId: lsWalkin.id, rawPayload: { source: 'qa-e2' } } });
  // 3) PHONE unmatched — no phone/email sufficient identity (enquiry with contactId null, no lead)
  const e3 = await intakeEnquiry({ tenantPrisma, organizationId: org.id, idempotencyKey: 'qa-e3', input: { channel: 'PHONE', contactName: 'Unknown Caller', phone: '', email: '', projectId: projPalm.id, rawPayload: { notes: 'missed call, no identity' } } });
  // 4) OWNED_FORM — Priya + Palm + Referral + with requirement data (creates OPEN lead, links new requirement — but Priya already has one, so check linkage rule: links only if lead has none, so this tests that)
  const e4 = await intakeEnquiry({ tenantPrisma, organizationId: org.id, idempotencyKey: 'qa-e4', input: { channel: 'OWNED_FORM', contactName: 'Priya Patel', phone: '9876543211', email: 'priya@qa.local', projectId: projPalm.id, leadSourceId: lsReferral.id, rawPayload: { source: 'qa-e4' }, requirement: { unitTypePreference: '3BHK', budgetMin: 8000000, budgetMax: 12000000, preferredProjectIds: [projPalm.id], notes: 'Intake-supplied requirement' } } });
  // 5) Repeat enquiry same contact/project as e1 — should ATTACH to existing OPEN lead (no new lead)
  const e5 = await intakeEnquiry({ tenantPrisma, organizationId: org.id, idempotencyKey: 'qa-e5', input: { channel: 'PORTAL', contactName: 'Aarav Sharma', phone: '9876543210', email: 'aarav@qa.local', projectId: projPalm.id, leadSourceId: lsPortal.id, campaignId: campFestival.id, rawPayload: { source: 'qa-e5 repeat' } } });
  // 6) PORTAL matched — Sneha + Palm + Website (will be used for DISQUALIFIED/CONVERTED flows)
  const e6 = await intakeEnquiry({ tenantPrisma, organizationId: org.id, idempotencyKey: 'qa-e6', input: { channel: 'PORTAL', contactName: 'Sneha Reddy', phone: '9876543213', email: 'sneha@qa.local', projectId: projPalm.id, leadSourceId: lsWebsite.id, rawPayload: { source: 'qa-e6' } } });

  // Verify leads: we expect 4 distinct leads (e1→1, e2→1, e4→1, e6→1; e3→0, e5→attach)
  let leads = await prisma.lead.findMany({ where: { organizationId: org.id }, orderBy: { createdAt: 'asc' } });
  console.log(`  enquiries: 6, leads: ${leads.length}`);

  // Adjust lead statuses for QA spec: one DISQUALIFIED, one CONVERTED (via Deal)
  // Find Priya's lead (contactPriya) to disqualify
  const priyaLead = leads.find(l => l.contactId === contactPriya.id);
  if (priyaLead) {
    await prisma.lead.update({ where: { id: priyaLead.id }, data: { status: 'DISQUALIFIED' } });
    console.log(`  lead DISQUALIFIED: ${priyaLead.id} (Priya)`);
  }
  // Refresh leads
  leads = await prisma.lead.findMany({ where: { organizationId: org.id }, orderBy: { createdAt: 'asc' } });

  // Deals: create from OPEN leads via service (atomically converts lead)
  const { createDeal, transitionDeal } = require('../src/modules/deals/service');
  const adminUser = usersByEmail['qa-admin@qa.local'];
  // Find two OPEN leads for deals (Aarav and Rohan)
  const openLeads = await prisma.lead.findMany({ where: { organizationId: org.id, status: 'OPEN' }, orderBy: { createdAt: 'asc' } });
  const dealLead1 = openLeads.find(l => l.contactId === contactAarav.id) || openLeads[0];
  const dealLead2 = openLeads.find(l => l.contactId === contactRohan.id) || openLeads[1] || openLeads[0];
  const snehaLead = openLeads.find(l => l.contactId === contactSneha.id) || openLeads[openLeads.length - 1];

  const deal1 = await createDeal({ tenantPrisma, organizationId: org.id, actorId: adminUser.id, leadId: dealLead1.id });
  const deal2 = await createDeal({ tenantPrisma, organizationId: org.id, actorId: adminUser.id, leadId: dealLead2.id });
  const deal3 = await createDeal({ tenantPrisma, organizationId: org.id, actorId: adminUser.id, leadId: snehaLead.id });
  console.log(`  deals: 3 (${deal1.id}, ${deal2.id}, ${deal3.id})`);

  // Walk deal1 through full forward pipeline to CLOSED_WON; deal2 to CLOSED_LOST; deal3 stays NEW for QA
  const forward = ['QUALIFIED','SITE_VISIT_SCHEDULED','NEGOTIATION','RESERVATION','BOOKING_CONFIRMED','AGREEMENT_SIGNED','PAYMENT_IN_PROGRESS','CLOSED_WON'];
  for (const stage of forward) {
    await transitionDeal({ tenantPrisma, organizationId: org.id, actorId: adminUser.id, dealId: deal1.id, stage });
  }
  for (const stage of ['QUALIFIED','SITE_VISIT_SCHEDULED','NEGOTIATION']) {
    await transitionDeal({ tenantPrisma, organizationId: org.id, actorId: adminUser.id, dealId: deal2.id, stage });
  }
  await transitionDeal({ tenantPrisma, organizationId: org.id, actorId: adminUser.id, dealId: deal2.id, stage: 'CLOSED_LOST', lostReason: 'Budget shifted to other city' });

  // SiteVisits: 5 covering all statuses, respecting agent/project conflicts via spaced slots
  const now = Date.now();
  const day = 24*60*60*1000;
  const agent1 = usersByEmail['qa-agent1@qa.local'];
  const agent2 = usersByEmail['qa-agent2@qa.local'];
  // Upcoming SCHEDULED (future)
  const sv1 = await prisma.siteVisit.create({ data: { organizationId: org.id, agentId: agent1.id, projectId: projPalm.id, contactId: contactAarav.id, dealId: deal1.id, scheduledAt: new Date(now + 2*day), durationMinutes: 60, status: 'SCHEDULED' } });
  // CONFIRMED
  const sv2 = await prisma.siteVisit.create({ data: { organizationId: org.id, agentId: agent2.id, projectId: projSky.id, contactId: contactRohan.id, dealId: deal2.id, scheduledAt: new Date(now + 3*day), durationMinutes: 45, status: 'CONFIRMED' } });
  // COMPLETED (past)
  const sv3 = await prisma.siteVisit.create({ data: { organizationId: org.id, agentId: agent1.id, projectId: projPalm.id, contactId: contactSneha.id, dealId: deal3.id, scheduledAt: new Date(now - 5*day), durationMinutes: 60, status: 'COMPLETED' } });
  // CANCELLED
  const sv4 = await prisma.siteVisit.create({ data: { organizationId: org.id, agentId: agent2.id, projectId: projPalm.id, contactId: contactVikram.id, scheduledAt: new Date(now - 2*day), durationMinutes: 60, status: 'CANCELLED', cancelledBy: adminUser.id, cancellationReason: 'Client requested reschedule', cancelledAt: new Date(now - 2*day + 60*60000) } });
  // NO_SHOW + exercise reschedule on sv1 via service (SCHEDULED→ rescheduled)
  const sv5 = await prisma.siteVisit.create({ data: { organizationId: org.id, agentId: agent1.id, projectId: projSky.id, contactId: contactAnanya.id, scheduledAt: new Date(now - 1*day), durationMinutes: 60, status: 'NO_SHOW' } });
  // Reschedule sv1 (SCHEDULED) to new slot + duration — tests reschedule path
  const { rescheduleSiteVisit } = require('../src/modules/siteVisits/service');
  await rescheduleSiteVisit({ tenantPrisma, organizationId: org.id, siteVisitId: sv1.id, scheduledAt: new Date(now + 4*day), durationMinutes: 90 });

  // Reservations: RESERVATION (active), HOLD (active), RESERVATION (to be released)
  // Need deals for each; reuse deals where not yet attached to a unit
  // Ensure deal not already attached to different unit: deal1 already CLOSED_WON without unit, ok
  // deal1 and deal2 are available; create reservations binding them to units
  const resActive = await prisma.reservation.create({ data: { organizationId: org.id, unitId: unitA101.id, dealId: deal1.id, type: 'RESERVATION', status: 'ACTIVE', expiresAt: new Date(now + 5*day) } });
  await prisma.unit.update({ where: { id: unitA101.id }, data: { availabilityStatus: 'RESERVED' } });
  await prisma.deal.update({ where: { id: deal1.id }, data: { unitId: unitA101.id } });

  const holdActive = await prisma.reservation.create({ data: { organizationId: org.id, unitId: unitA102.id, dealId: deal2.id, type: 'HOLD', status: 'ACTIVE', expiresAt: null } });
  await prisma.unit.update({ where: { id: unitA102.id }, data: { availabilityStatus: 'ON_HOLD' } });

  // Expiring reservation (expires in 2 hours, for dashboard attention)
  const resExpiring = await prisma.reservation.create({ data: { organizationId: org.id, unitId: unitB201.id, dealId: deal3.id, type: 'RESERVATION', status: 'ACTIVE', expiresAt: new Date(now + 2*60*60*1000) } });
  await prisma.unit.update({ where: { id: unitB201.id }, data: { availabilityStatus: 'RESERVED' } });
  await prisma.deal.update({ where: { id: deal3.id }, data: { unitId: unitB201.id } });
  // Released reservation on B202: create then release via service to exercise lifecycle
  const resForRelease = await prisma.reservation.create({ data: { organizationId: org.id, unitId: unitB202.id, dealId: deal2.id, type: 'RESERVATION', status: 'ACTIVE', expiresAt: new Date(now + 10*day) } });
  await prisma.unit.update({ where: { id: unitB202.id }, data: { availabilityStatus: 'RESERVED' } });
  // For release we need a dedicated reservation that doesn't conflict with booking; use the one above and release it via raw update to keep counts predictable
  // Instead create a separate expired/released row for QA coverage
  await prisma.reservation.update({ where: { id: resForRelease.id }, data: { status: 'RELEASED' } });
  await prisma.unit.update({ where: { id: unitB202.id }, data: { availabilityStatus: 'AVAILABLE' } });
  // Also create one EXPIRED directly
  const resExpired = await prisma.reservation.create({ data: { organizationId: org.id, unitId: unitB202.id, dealId: deal1.id, type: 'RESERVATION', status: 'EXPIRED', expiresAt: new Date(now - 1*day) } });
  // Keep B202 AVAILABLE for expired

  // Booking: ACTIVE RESERVATION → BOOKING (use resActive which is RESERVATION ACTIVE on A101)
  // To exercise real workflow, keep resActive ACTIVE for now, create a separate booking from a new reservation
  // Create a new ACTIVE reservation for booking conversion
  const extraUnit = await prisma.unit.create({ data: { identifier: 'A-104', projectId: projPalm.id, organizationId: org.id, totalCost: 7900000, availabilityStatus: 'AVAILABLE' } });
  const resForBooking = await prisma.reservation.create({ data: { organizationId: org.id, unitId: extraUnit.id, dealId: deal1.id, type: 'RESERVATION', status: 'ACTIVE', expiresAt: new Date(now + 7*day) } });
  await prisma.unit.update({ where: { id: extraUnit.id }, data: { availabilityStatus: 'RESERVED' } });
  const booking = await prisma.booking.create({ data: { organizationId: org.id, unitId: extraUnit.id, dealId: deal1.id, reservationId: resForBooking.id } });
  await prisma.unit.update({ where: { id: extraUnit.id }, data: { availabilityStatus: 'BOOKED' } });
  await prisma.reservation.update({ where: { id: resForBooking.id }, data: { status: 'CONVERTED' } });

  // Payments: one plan with 3 obligations (future PENDING, past-due PENDING, PAID via webhook)
  const plan = await prisma.paymentPlan.create({ data: { organizationId: org.id, dealId: deal1.id } });
  const obFuture = await prisma.paymentObligation.create({ data: { organizationId: org.id, paymentPlanId: plan.id, dueAmount: 500000, dueDate: new Date(now + 10*day), status: 'PENDING' } });
  const obPastDue = await prisma.paymentObligation.create({ data: { organizationId: org.id, paymentPlanId: plan.id, dueAmount: 300000, dueDate: new Date(now - 3*day), status: 'PENDING' } }); // will derive OVERDUE at read
  const obPaid = await prisma.paymentObligation.create({ data: { organizationId: org.id, paymentPlanId: plan.id, dueAmount: 250000, dueDate: new Date(now - 10*day), status: 'PAID' } });
  // Records: create a SUCCESS record for obPaid (webhook path simulated via direct create)
  await prisma.paymentRecord.create({ data: { organizationId: org.id, obligationId: obPaid.id, amount: 250000, status: 'SUCCESS', gatewayReference: 'GW-PAID-1' } });
  await prisma.paymentRecord.create({ data: { organizationId: org.id, obligationId: obPastDue.id, amount: 100000, status: 'FAILED', gatewayReference: 'GW-FAIL-1' } });
  await prisma.paymentRecord.create({ data: { organizationId: org.id, obligationId: obFuture.id, amount: 500000, status: 'PENDING' } });
  // Correction: new row correcting the FAILED record
  const failedRec = await prisma.paymentRecord.findFirst({ where: { organizationId: org.id, gatewayReference: 'GW-FAIL-1' } });
  await prisma.paymentRecord.create({ data: { organizationId: org.id, obligationId: obPastDue.id, amount: 300000, status: 'SUCCESS', gatewayReference: 'GW-CORR-1', correctsRecordId: failedRec.id } });

  // Documents: 4 docs including version chain
  const { randomUUID } = require('crypto');
  function storageKey(orgId, contactId, groupId, version) { return `${orgId}/${contactId}/${groupId}/v${version}`; }
  const docGroup1 = randomUUID();
  const doc1 = await prisma.document.create({ data: { organizationId: org.id, groupId: docGroup1, version: 1, contactId: contactAarav.id, dealId: deal1.id, type: 'KYC_Aadhaar', status: 'VERIFIED', storageKey: storageKey(org.id, contactAarav.id, docGroup1, 1), reviewedBy: adminUser.id, reviewedAt: new Date(now - 1*day) } });
  const docGroup2 = randomUUID();
  const doc2 = await prisma.document.create({ data: { organizationId: org.id, groupId: docGroup2, version: 1, contactId: contactPriya.id, type: 'KYC_PAN', status: 'UNDER_REVIEW', storageKey: storageKey(org.id, contactPriya.id, docGroup2, 1) } });
  const docGroup3 = randomUUID();
  const doc3v1 = await prisma.document.create({ data: { organizationId: org.id, groupId: docGroup3, version: 1, contactId: contactSneha.id, dealId: deal3.id, type: 'Agreement', status: 'REJECTED', storageKey: storageKey(org.id, contactSneha.id, docGroup3, 1), rejectionReason: 'Blurry scan', reviewedBy: adminUser.id, reviewedAt: new Date(now - 2*60*60000) } });
  const doc3v2 = await prisma.document.create({ data: { organizationId: org.id, groupId: docGroup3, version: 2, supersedesId: doc3v1.id, contactId: contactSneha.id, dealId: deal3.id, type: 'Agreement', status: 'RESUBMITTED', storageKey: storageKey(org.id, contactSneha.id, docGroup3, 2) } });
  const docGroup4 = randomUUID();
  const doc4 = await prisma.document.create({ data: { organizationId: org.id, groupId: docGroup4, version: 1, contactId: contactVikram.id, type: 'IncomeProof', status: 'SUBMITTED', storageKey: storageKey(org.id, contactVikram.id, docGroup4, 1) } });

  // Activities / Tasks
  const act1 = await prisma.activity.create({ data: { organizationId: org.id, contactId: contactAarav.id, leadId: dealLead1.leadId ? undefined : undefined, dealId: deal1.id, type: 'Call', outcome: 'OUTBOUND_connected', notes: 'Discussed 2BHK pricing', createdBy: adminUser.id } });
  const act2 = await prisma.activity.create({ data: { organizationId: org.id, contactId: contactRohan.id, type: 'Meeting', outcome: 'INBOUND_site_visit_requested', notes: 'Wants visit next week', createdBy: usersByEmail['qa-agent1@qa.local'].id } });
  const act3 = await prisma.activity.create({ data: { organizationId: org.id, contactId: contactSneha.id, dealId: deal3.id, type: 'FollowUp', outcome: 'OUTBOUND_no_answer', notes: 'Follow up on booking', createdBy: adminUser.id } });
  const act4 = await prisma.activity.create({ data: { organizationId: org.id, contactId: contactVikram.id, type: 'Note', outcome: null, notes: 'General note without outcome', createdBy: adminUser.id } });
  // Task via activity follow-up + standalone
  const taskFollowUp = await prisma.task.create({ data: { organizationId: org.id, assignedTo: usersByEmail['qa-agent1@qa.local'].id, relatedContactId: contactAarav.id, relatedDealId: deal1.id, title: 'Call Aarav back tomorrow', dueAt: new Date(now + 1*day), status: 'OPEN', createdBy: adminUser.id } });
  const taskDone = await prisma.task.create({ data: { organizationId: org.id, assignedTo: usersByEmail['qa-agent2@qa.local'].id, relatedContactId: contactRohan.id, title: 'Send brochure to Rohan', dueAt: new Date(now - 1*day), status: 'DONE', createdBy: adminUser.id } });
  const taskOverdue = await prisma.task.create({ data: { organizationId: org.id, assignedTo: usersByEmail['qa-agent1@qa.local'].id, relatedContactId: contactSneha.id, title: 'Overdue: close verification', dueAt: new Date(now - 5*day), status: 'OPEN', createdBy: adminUser.id } });

  // Summary
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
  console.log('seed:qa complete');
  console.log(`  org: ${counts.organization} (${org.id}) — use this ID on login`);
  console.log(`  users (password: ${QA_PASSWORD}):`);
  for (const u of QA_USERS) console.log(`    ${u.email} (${u.role})`);
  console.log('  counts:', JSON.stringify(counts, null, 2));
}

main().catch((err) => {
  console.error(`seed:qa failed: ${err.message}`);
  if (err.stack) console.error(err.stack);
  process.exitCode = 1;
}).finally(async () => { await prisma.$disconnect(); });
