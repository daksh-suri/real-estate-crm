// Dev-only seed: organization "abc" + full Admin + known credentials.
//
// Usage: npm run seed:dev --workspace=server  (from the repo root)
// Rerunnable and non-destructive: everything is upserted, existing CRM data
// is never deleted, and the admin password is reset to the known value.
//
// REFUSES to run when NODE_ENV=production. Dev database only.
const { prisma } = require('../src/lib/prisma');
const { hashPassword } = require('../src/lib/bcrypt');

const ORG_NAME = 'abc';
const ADMIN_NAME = 'Admin';
const ADMIN_EMAIL = '18dakshsuri@gmail.com';
const ADMIN_PASSWORD = '18dakshsuri@gmail.com';

// Every authorize(resource, action) pair in server/src (dev Admin gets all of
// them at ORGANIZATION scope). If routes gain a permission, add it here.
const PERMISSIONS = [
  ['activity', 'create'],
  ['activity', 'read'],
  ['task', 'create'],
  ['task', 'read'],
  ['task', 'complete'],
  ['assignmentRule', 'create'],
  ['assignmentRule', 'read'],
  ['assignmentRule', 'update'],
  ['assignmentRule', 'delete'],
  ['booking', 'create'],
  ['booking', 'read'],
  ['booking', 'cancel'],
  ['campaign', 'create'],
  ['campaign', 'read'],
  ['campaign', 'update'],
  ['campaign', 'delete'],
  ['contact', 'create'],
  ['contact', 'read'],
  ['contact', 'update'],
  ['contact', 'delete'],
  ['requirement', 'create'],
  ['requirement', 'read'],
  ['requirement', 'update'],
  ['requirement', 'delete'],
  ['deal', 'create'],
  ['deal', 'read'],
  ['deal', 'update'],
  ['deal', 'delete'],
  ['deal', 'transition'],
  ['team', 'create'],
  ['team', 'read'],
  ['team', 'update'],
  ['team', 'delete'],
  ['team', 'manage_members'],
  ['user', 'read'],
  ['user', 'create'],
  ['role', 'read'],
  ['role', 'create'],
  ['role', 'update'],
  ['enquiry', 'create'],
  ['enquiry', 'read'],
  ['organization', 'read'],
  ['organization', 'update'],
  ['leadSource', 'create'],
  ['leadSource', 'read'],
  ['leadSource', 'update'],
  ['leadSource', 'delete'],
  ['project', 'create'],
  ['project', 'read'],
  ['project', 'update'],
  ['project', 'delete'],
  ['unit', 'create'],
  ['unit', 'read'],
  ['unit', 'update'],
  ['unit', 'delete'],
  ['document', 'create'],
  ['document', 'read'],
  ['document', 'upload'],
  ['document', 'verify'],
  ['document', 'reject'],
  ['lead', 'create'],
  ['lead', 'read'],
  ['lead', 'update'],
  ['lead', 'delete'],
  ['lead', 'assign'],
  ['payment', 'verify'],
  ['paymentPlan', 'create'],
  ['paymentPlan', 'read'],
  ['paymentObligation', 'read'],
  ['paymentRecord', 'read'],
  ['reservation', 'create'],
  ['reservation', 'read'],
  ['reservation', 'release'],
  ['siteVisit', 'create'],
  ['siteVisit', 'read'],
  ['siteVisit', 'update'],
  ['siteVisit', 'transition'],
];

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed:dev refuses to run with NODE_ENV=production');
  }

  const org = await prisma.organization.upsert({
    where: { name: ORG_NAME },
    update: {},
    create: { name: ORG_NAME },
  });

  const permRows = [];
  for (const [resource, action] of PERMISSIONS) {
    permRows.push(
      await prisma.permission.upsert({
        where: { resource_action: { resource, action } },
        update: {},
        create: { resource, action },
      })
    );
  }

  const role = await prisma.role.upsert({
    where: { organizationId_name: { organizationId: org.id, name: ADMIN_NAME } },
    update: {},
    create: { name: ADMIN_NAME, organizationId: org.id },
  });

  for (const perm of permRows) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId_scope: { roleId: role.id, permissionId: perm.id, scope: 'ORGANIZATION' } },
      update: {},
      create: { organizationId: org.id, roleId: role.id, permissionId: perm.id, scope: 'ORGANIZATION' },
    });
  }

  const user = await prisma.user.upsert({
    where: { organizationId_email: { organizationId: org.id, email: ADMIN_EMAIL } },
    update: { passwordHash: await hashPassword(ADMIN_PASSWORD), status: 'ACTIVE', deletedAt: null, roleId: role.id },
    create: {
      name: ADMIN_NAME,
      email: ADMIN_EMAIL,
      passwordHash: await hashPassword(ADMIN_PASSWORD),
      organizationId: org.id,
      roleId: role.id,
      status: 'ACTIVE',
    },
  });

  console.log('seed:dev complete');
  console.log(`  organization : ${org.name} (${org.id})  <- paste this ID into the login page`);
  console.log(`  email        : ${user.email}`);
  console.log('  password     : (the same email address)');
  console.log('  role         : Admin with all permissions at ORGANIZATION scope');
}

main()
  .catch((err) => {
    console.error(`seed:dev failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
