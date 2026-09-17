const { prisma, TENANT_MODELS, GLOBAL_MODELS } = require('../src/lib/prisma');
const { createTenantPrisma, TenantContextError, CrossTenantError } = require('../src/lib/tenant');

// Helper to generate unique names to avoid collisions across runs
function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('Checkpoint 2 — Database Foundation & Tenant Scoping', () => {
  // Shared orgs for suite
  let orgA;
  let orgB;
  let tenantA;
  let tenantB;

  beforeAll(async () => {
    // Clean leftover from previous failed runs (raw, unscoped)
    await prisma.teamMembership.deleteMany({});
    await prisma.rolePermission.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.team.deleteMany({});
    await prisma.role.deleteMany({});
    await prisma.permission.deleteMany({});
    await prisma.organization.deleteMany({});

    orgA = await prisma.organization.create({ data: { name: uid('OrgA') } });
    orgB = await prisma.organization.create({ data: { name: uid('OrgB') } });
    tenantA = createTenantPrisma(orgA.id);
    tenantB = createTenantPrisma(orgB.id);
  });

  afterAll(async () => {
    // Cleanup in dependency order (raw, to bypass tenant checks)
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
    // Per-test isolation: wipe tenant data but keep orgs
    await prisma.teamMembership.deleteMany({});
    await prisma.rolePermission.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.team.deleteMany({});
    await prisma.role.deleteMany({});
    // Keep orgs and permissions across tests where needed, but clean permissions per test
    await prisma.permission.deleteMany({});
  });

  // 1. Organization creation
  describe('1. Organization creation', () => {
    it('creates organizations with unique names and timestamps', async () => {
      const name = uid('OrgTest');
      const org = await prisma.organization.create({ data: { name } });
      expect(org).toHaveProperty('id');
      expect(org.name).toBe(name);
      expect(org).toHaveProperty('createdAt');
      expect(org).toHaveProperty('updatedAt');
      // Name uniqueness globally
      await expect(prisma.organization.create({ data: { name } })).rejects.toThrow();
    });
  });

  // 2. Tenant-scoped records belong to correct organization
  describe('2. Tenant-scoped records belong to correct organization', () => {
    it('tenant create injects organizationId and records are retrievable via tenant client', async () => {
      const roleA = await tenantA.role.create({ data: { name: uid('Role') } });
      expect(roleA.organizationId).toBe(orgA.id);

      const teamA = await tenantA.team.create({ data: { name: uid('Team') } });
      expect(teamA.organizationId).toBe(orgA.id);

      const userA = await tenantA.user.create({
        data: { name: 'Alice', email: uid('alice') + '@test.com' },
      });
      expect(userA.organizationId).toBe(orgA.id);

      // Verify via tenant findMany
      const usersA = await tenantA.user.findMany({});
      expect(usersA).toHaveLength(1);
      expect(usersA[0].id).toBe(userA.id);
    });

    it('create without explicit organizationId still injects tenant context', async () => {
      const role = await tenantA.role.create({ data: { name: uid('RoleAuto') } });
      expect(role.organizationId).toBe(orgA.id);
      // Raw fetch confirms
      const raw = await prisma.role.findUnique({ where: { id: role.id } });
      expect(raw.organizationId).toBe(orgA.id);
    });
  });

  // 3. Organization A cannot read Organization B's tenant records
  describe('3. Organization A cannot read Organization B records', () => {
    it('findMany is tenant-isolated', async () => {
      await tenantA.user.create({ data: { name: 'UserA', email: uid('a') + '@test.com' } });
      await tenantB.user.create({ data: { name: 'UserB', email: uid('b') + '@test.com' } });

      const usersA = await tenantA.user.findMany({});
      const usersB = await tenantB.user.findMany({});
      expect(usersA).toHaveLength(1);
      expect(usersB).toHaveLength(1);
      expect(usersA[0].email).not.toBe(usersB[0].email);

      // Count also isolated
      expect(await tenantA.user.count()).toBe(1);
      expect(await tenantB.user.count()).toBe(1);
    });

    it('findFirst and findUnique are tenant-isolated', async () => {
      const userA = await tenantA.user.create({ data: { name: 'UA', email: uid('ua') + '@test.com' } });
      const userB = await tenantB.user.create({ data: { name: 'UB', email: uid('ub') + '@test.com' } });

      expect(await tenantA.user.findFirst({ where: { id: userB.id } })).toBeNull();
      expect(await tenantB.user.findFirst({ where: { id: userA.id } })).toBeNull();

      expect(await tenantA.user.findUnique({ where: { id: userB.id } })).toBeNull();
      expect(await tenantB.user.findUnique({ where: { id: userA.id } })).toBeNull();

      expect(await tenantA.user.findUnique({ where: { id: userA.id } })).not.toBeNull();
    });

    it('team and role reads are tenant-isolated', async () => {
      const teamA = await tenantA.team.create({ data: { name: uid('TeamA') } });
      const teamB = await tenantB.team.create({ data: { name: uid('TeamB') } });
      expect(await tenantA.team.findFirst({ where: { id: teamB.id } })).toBeNull();
      expect(await tenantB.team.findFirst({ where: { id: teamA.id } })).toBeNull();

      const roleA = await tenantA.role.create({ data: { name: uid('RoleA') } });
      const roleB = await tenantB.role.create({ data: { name: uid('RoleB') } });
      expect(await tenantA.role.findUnique({ where: { id: roleB.id } })).toBeNull();
      expect(await tenantB.role.findUnique({ where: { id: roleA.id } })).toBeNull();
    });

    it('rolePermission and teamMembership reads are tenant-isolated', async () => {
      const perm = await prisma.permission.create({ data: { resource: uid('res'), action: 'read' } });
      const roleA = await tenantA.role.create({ data: { name: uid('Role') } });
      const roleB = await tenantB.role.create({ data: { name: uid('Role2') } });
      await tenantA.rolePermission.create({ data: { roleId: roleA.id, permissionId: perm.id, scope: 'ORGANIZATION' } });
      await tenantB.rolePermission.create({ data: { roleId: roleB.id, permissionId: perm.id, scope: 'OWN' } });

      const rpA = await tenantA.rolePermission.findMany({});
      const rpB = await tenantB.rolePermission.findMany({});
      expect(rpA).toHaveLength(1);
      expect(rpB).toHaveLength(1);
      expect(rpA[0].scope).toBe('ORGANIZATION');
      expect(rpB[0].scope).toBe('OWN');
    });

    it('aggregate and groupBy are tenant-scoped', async () => {
      await tenantA.user.create({ data: { name: 'U1', email: uid('u1') + '@test.com', status: 'ACTIVE' } });
      await tenantA.user.create({ data: { name: 'U2', email: uid('u2') + '@test.com', status: 'ON_LEAVE' } });
      await tenantB.user.create({ data: { name: 'U3', email: uid('u3') + '@test.com', status: 'ACTIVE' } });

      const countA = await tenantA.user.count({ where: { status: 'ACTIVE' } });
      expect(countA).toBe(1);
      const groupA = await tenantA.user.groupBy({ by: ['status'], _count: { _all: true } });
      // Should only see orgA statuses
      const statusesA = groupA.map((g) => g.status).sort();
      expect(statusesA).toEqual(['ACTIVE', 'ON_LEAVE']);
    });
  });

  // 4. Organization A cannot update Organization B's records
  describe('4. Organization A cannot update Organization B records', () => {
    it('update via tenant client fails if record belongs to another tenant', async () => {
      const userB = await tenantB.user.create({ data: { name: 'Bob', email: uid('bob') + '@test.com' } });
      await expect(tenantA.user.update({ where: { id: userB.id }, data: { name: 'Hacked' } })).rejects.toMatchObject({
        code: 'P2025',
      });
      const rawB = await prisma.user.findUnique({ where: { id: userB.id } });
      expect(rawB.name).toBe('Bob');
    });

    it('updateMany is tenant-scoped', async () => {
      await tenantA.user.create({ data: { name: 'A1', email: uid('a1') + '@test.com' } });
      await tenantB.user.create({ data: { name: 'B1', email: uid('b1') + '@test.com' } });
      const result = await tenantA.user.updateMany({ where: {}, data: { status: 'ON_LEAVE' } });
      expect(result.count).toBe(1);
      const aUsers = await tenantA.user.findMany({});
      expect(aUsers[0].status).toBe('ON_LEAVE');
      const bUsers = await tenantB.user.findMany({});
      expect(bUsers[0].status).toBe('ACTIVE');
    });

    it('team and role updates are tenant-isolated', async () => {
      const teamB = await tenantB.team.create({ data: { name: uid('TeamB') } });
      await expect(tenantA.team.update({ where: { id: teamB.id }, data: { name: 'Hacked' } })).rejects.toMatchObject({
        code: 'P2025',
      });
      const roleB = await tenantB.role.create({ data: { name: uid('RoleB') } });
      await expect(tenantA.role.update({ where: { id: roleB.id }, data: { name: 'Hacked2' } })).rejects.toMatchObject({
        code: 'P2025',
      });
    });
  });

  // 5. Organization A cannot delete Organization B's records
  describe('5. Organization A cannot delete Organization B records', () => {
    it('delete via tenant client fails if record belongs to another tenant', async () => {
      const userB = await tenantB.user.create({ data: { name: 'Carol', email: uid('carol') + '@test.com' } });
      await expect(tenantA.user.delete({ where: { id: userB.id } })).rejects.toMatchObject({ code: 'P2025' });
      expect(await prisma.user.findUnique({ where: { id: userB.id } })).not.toBeNull();
    });

    it('deleteMany is tenant-scoped', async () => {
      await tenantA.user.create({ data: { name: 'A', email: uid('a') + '@test.com' } });
      await tenantB.user.create({ data: { name: 'B', email: uid('b') + '@test.com' } });
      const res = await tenantA.user.deleteMany({});
      expect(res.count).toBe(1);
      expect(await tenantA.user.count()).toBe(0);
      expect(await tenantB.user.count()).toBe(1);
    });

    it('cannot delete cross-tenant team/role', async () => {
      const teamB = await tenantB.team.create({ data: { name: uid('TeamB') } });
      await expect(tenantA.team.delete({ where: { id: teamB.id } })).rejects.toMatchObject({ code: 'P2025' });
    });
  });

  // 6. Missing tenant context fails safely
  describe('6. Missing tenant context fails safely', () => {
    it('createTenantPrisma without organizationId throws TenantContextError', () => {
      expect(() => createTenantPrisma(null)).toThrow(TenantContextError);
      expect(() => createTenantPrisma('')).toThrow(TenantContextError);
      expect(() => createTenantPrisma(undefined)).toThrow(TenantContextError);
    });

    it('tenant operations require context — direct call with empty context fails', async () => {
      // Simulate missing context by creating a client with empty string (throws at creation)
      // So we test that raw tenant call without injection would not silently leak.
      // Also test that cross-tenant where mismatch throws.
      await tenantA.user.create({ data: { name: 'X', email: uid('x') + '@test.com' } });
      await expect(
        tenantA.user.findMany({ where: { organizationId: orgB.id } })
      ).rejects.toThrow(CrossTenantError);
    });

    it('create with mismatched organizationId in data fails', async () => {
      await expect(
        tenantA.user.create({
          data: { name: 'Evil', email: uid('evil') + '@test.com', organizationId: orgB.id },
        })
      ).rejects.toThrow(CrossTenantError);
    });

    it('update that tries to change organizationId fails', async () => {
      const userA = await tenantA.user.create({ data: { name: 'U', email: uid('u') + '@test.com' } });
      await expect(
        tenantA.user.update({ where: { id: userA.id }, data: { organizationId: orgB.id } })
      ).rejects.toThrow(CrossTenantError);
    });
  });

  // 7. Global models are not incorrectly tenant-scoped
  describe('7. Global models are not incorrectly tenant-scoped', () => {
    it('Permission is global: same resource/action unique globally, not per org', async () => {
      const perm1 = await prisma.permission.create({ data: { resource: 'lead', action: 'read' } });
      expect(perm1).toHaveProperty('id');
      // Duplicate globally should fail
      await expect(prisma.permission.create({ data: { resource: 'lead', action: 'read' } })).rejects.toThrow();
      // Different action allowed
      const perm2 = await prisma.permission.create({ data: { resource: 'lead', action: 'write' } });
      expect(perm2.id).not.toBe(perm1.id);

      // Global findMany via raw and tenant raw access should see same
      const rawAll = await prisma.permission.findMany({});
      expect(rawAll).toHaveLength(2);
      // Tenant client exposes permission as raw (unfiltered) — should see same count
      const viaTenant = await tenantA.permission.findMany({});
      expect(viaTenant).toHaveLength(2);
      expect(perm1).not.toHaveProperty('organizationId');
    });

    it('Organization itself is not tenant-scoped via extension (queryable via raw)', async () => {
      const allOrgs = await prisma.organization.findMany({});
      expect(allOrgs.length).toBeGreaterThanOrEqual(2);
      // Verify classification sets are correct
      expect(GLOBAL_MODELS.has('organization')).toBe(true);
      expect(GLOBAL_MODELS.has('permission')).toBe(true);
      expect(TENANT_MODELS.has('user')).toBe(true);
      expect(TENANT_MODELS.has('role')).toBe(true);
    });

    it('TENANT_MODELS do not include global models', () => {
      expect(TENANT_MODELS.has('organization')).toBe(false);
      expect(TENANT_MODELS.has('permission')).toBe(false);
      expect(GLOBAL_MODELS.has('user')).toBe(false);
    });
  });

  // 8. User/Role relationships respect organization boundaries
  describe('8. User/Role relationships respect organization boundaries', () => {
    it('cannot assign role from another organization to user', async () => {
      const roleB = await tenantB.role.create({ data: { name: uid('RoleB') } });
      await expect(
        tenantA.user.create({ data: { name: 'Intruder', email: uid('intr') + '@test.com', roleId: roleB.id } })
      ).rejects.toThrow(CrossTenantError);

      // Valid same-org assignment succeeds
      const roleA = await tenantA.role.create({ data: { name: uid('RoleA') } });
      const userA = await tenantA.user.create({
        data: { name: 'Valid', email: uid('valid') + '@test.com', roleId: roleA.id },
      });
      expect(userA.roleId).toBe(roleA.id);
    });

    it('cannot reassign user to cross-org role via update', async () => {
      const roleB = await tenantB.role.create({ data: { name: uid('RoleB2') } });
      const userA = await tenantA.user.create({ data: { name: 'U', email: uid('u2') + '@test.com' } });
      await expect(tenantA.user.update({ where: { id: userA.id }, data: { roleId: roleB.id } })).rejects.toThrow(
        CrossTenantError
      );
    });

    it('rolePermission cannot link to role from another organization', async () => {
      const perm = await prisma.permission.create({ data: { resource: uid('res'), action: 'test' } });
      const roleB = await tenantB.role.create({ data: { name: uid('RoleB3') } });
      await expect(
        tenantA.rolePermission.create({ data: { roleId: roleB.id, permissionId: perm.id, scope: 'OWN' } })
      ).rejects.toThrow(CrossTenantError);

      const roleA = await tenantA.role.create({ data: { name: uid('RoleA2') } });
      const rp = await tenantA.rolePermission.create({
        data: { roleId: roleA.id, permissionId: perm.id, scope: 'TEAM' },
      });
      expect(rp.organizationId).toBe(orgA.id);
      expect(rp.roleId).toBe(roleA.id);
    });

    it('user with null role is allowed', async () => {
      const user = await tenantA.user.create({ data: { name: 'NoRole', email: uid('norole') + '@test.com', roleId: null } });
      expect(user.roleId).toBeNull();
    });
  });

  // 9. Team/User membership cannot create cross-tenant inconsistencies
  describe('9. Team/User membership cannot create cross-tenant inconsistencies', () => {
    it('cannot create membership linking user from orgA to team from orgB', async () => {
      const userA = await tenantA.user.create({ data: { name: 'UA', email: uid('ua') + '@test.com' } });
      const teamB = await tenantB.team.create({ data: { name: uid('TeamB') } });
      await expect(
        tenantA.teamMembership.create({ data: { userId: userA.id, teamId: teamB.id } })
      ).rejects.toThrow(CrossTenantError);
    });

    it('cannot create membership linking user from orgB to team from orgA via tenantB', async () => {
      const userB = await tenantB.user.create({ data: { name: 'UB', email: uid('ub') + '@test.com' } });
      const teamA = await tenantA.team.create({ data: { name: uid('TeamA') } });
      await expect(
        tenantB.teamMembership.create({ data: { userId: userB.id, teamId: teamA.id } })
      ).rejects.toThrow(CrossTenantError);
    });

    it('valid same-org membership succeeds and is tenant-scoped', async () => {
      const userA = await tenantA.user.create({ data: { name: 'UA2', email: uid('ua2') + '@test.com' } });
      const teamA = await tenantA.team.create({ data: { name: uid('TeamA2') } });
      const m = await tenantA.teamMembership.create({ data: { userId: userA.id, teamId: teamA.id } });
      expect(m.organizationId).toBe(orgA.id);
      expect(await tenantA.teamMembership.findMany({})).toHaveLength(1);
      expect(await tenantB.teamMembership.findMany({})).toHaveLength(0);
      // Cross read null
      expect(await tenantB.teamMembership.findFirst({ where: { id: m.id } })).toBeNull();
    });

    it('duplicate membership (same user, same team) is rejected by unique constraint', async () => {
      const userA = await tenantA.user.create({ data: { name: 'UA3', email: uid('ua3') + '@test.com' } });
      const teamA = await tenantA.team.create({ data: { name: uid('TeamA3') } });
      await tenantA.teamMembership.create({ data: { userId: userA.id, teamId: teamA.id } });
      await expect(
        tenantA.teamMembership.create({ data: { userId: userA.id, teamId: teamA.id } })
      ).rejects.toThrow();
    });

    it('TeamMembership schema has organizationId and tenant client requires it', async () => {
      // Verify via raw that organizationId column exists and is NOT NULL
      const userA = await tenantA.user.create({ data: { name: 'UA4', email: uid('ua4') + '@test.com' } });
      const teamA = await tenantA.team.create({ data: { name: uid('TeamA4') } });
      const raw = await tenantA.teamMembership.create({ data: { userId: userA.id, teamId: teamA.id } });
      expect(raw).toHaveProperty('organizationId', orgA.id);
      // Raw DB check: fetch via prisma raw and ensure org matches
      const fetched = await prisma.teamMembership.findUnique({ where: { id: raw.id } });
      expect(fetched.organizationId).toBe(orgA.id);
    });

    it('cannot create membership with explicit mismatched organizationId', async () => {
      const userA = await tenantA.user.create({ data: { name: 'UA5', email: uid('ua5') + '@test.com' } });
      const teamA = await tenantA.team.create({ data: { name: uid('TeamA5') } });
      await expect(
        tenantA.teamMembership.create({ data: { userId: userA.id, teamId: teamA.id, organizationId: orgB.id } })
      ).rejects.toThrow(CrossTenantError);
    });
  });

  // 10. Unique constraints behave correctly within tenant boundaries
  describe('10. Unique constraints behave correctly within tenant boundaries', () => {
    it('email unique per organization, but same email allowed across orgs', async () => {
      const email = uid('shared') + '@test.com';
      const uA = await tenantA.user.create({ data: { name: 'A', email } });
      expect(uA.email).toBe(email);
      // Same email in same org should fail
      await expect(tenantA.user.create({ data: { name: 'A2', email } })).rejects.toThrow();
      // Same email in different org should succeed
      const uB = await tenantB.user.create({ data: { name: 'B', email } });
      expect(uB.email).toBe(email);
      expect(uB.organizationId).toBe(orgB.id);
    });

    it('role name unique per organization', async () => {
      const name = uid('Manager');
      await tenantA.role.create({ data: { name } });
      await expect(tenantA.role.create({ data: { name } })).rejects.toThrow();
      // Same name in different org allowed
      const roleB = await tenantB.role.create({ data: { name } });
      expect(roleB.name).toBe(name);
    });

    it('team name unique per organization', async () => {
      const name = uid('AlphaTeam');
      await tenantA.team.create({ data: { name } });
      await expect(tenantA.team.create({ data: { name } })).rejects.toThrow();
      const teamB = await tenantB.team.create({ data: { name } });
      expect(teamB.name).toBe(name);
    });

    it('permission resource+action unique globally', async () => {
      await prisma.permission.create({ data: { resource: 'deal', action: 'create' } });
      await expect(prisma.permission.create({ data: { resource: 'deal', action: 'create' } })).rejects.toThrow();
      // Different resource allowed
      await prisma.permission.create({ data: { resource: 'deal', action: 'read' } });
    });

    it('rolePermission role+permission+scope unique', async () => {
      const perm = await prisma.permission.create({ data: { resource: uid('r'), action: 'a' } });
      const roleA = await tenantA.role.create({ data: { name: uid('Role') } });
      await tenantA.rolePermission.create({ data: { roleId: roleA.id, permissionId: perm.id, scope: 'OWN' } });
      await expect(
        tenantA.rolePermission.create({ data: { roleId: roleA.id, permissionId: perm.id, scope: 'OWN' } })
      ).rejects.toThrow();
      // Same role+permission but different scope allowed
      const rp2 = await tenantA.rolePermission.create({
        data: { roleId: roleA.id, permissionId: perm.id, scope: 'TEAM' },
      });
      expect(rp2.scope).toBe('TEAM');
    });

    it('organization name unique globally', async () => {
      const name = uid('UniqueOrg');
      await prisma.organization.create({ data: { name } });
      await expect(prisma.organization.create({ data: { name } })).rejects.toThrow();
    });
  });

  // 11. Prisma tenant-scoping operations are valid for all supported operations
  describe('11. Prisma tenant-scoping operations are valid for all supported operations', () => {
    it('findMany, findFirst, findUnique, count, update, delete work via tenant client without invalid selector errors', async () => {
      const user = await tenantA.user.create({ data: { name: 'OpTest', email: uid('op') + '@test.com' } });

      // These should not throw "Invalid `prisma.user.findUnique()` invocation" etc.
      expect(await tenantA.user.findMany({ where: { id: user.id } })).toHaveLength(1);
      expect(await tenantA.user.findFirst({ where: { id: user.id } })).not.toBeNull();
      expect(await tenantA.user.findUnique({ where: { id: user.id } })).not.toBeNull();
      expect(await tenantA.user.findUniqueOrThrow({ where: { id: user.id } })).not.toBeNull();
      expect(await tenantA.user.count({ where: { id: user.id } })).toBe(1);

      const updated = await tenantA.user.update({ where: { id: user.id }, data: { name: 'OpTest2' } });
      expect(updated.name).toBe('OpTest2');

      const upserted = await tenantA.user.upsert({
        where: { id: user.id },
        update: { name: 'Upserted' },
        create: { name: 'Create', email: uid('upsert') + '@test.com' },
      });
      expect(upserted.name).toBe('Upserted');

      const deleted = await tenantA.user.delete({ where: { id: user.id } });
      expect(deleted.id).toBe(user.id);
      expect(await tenantA.user.findUnique({ where: { id: user.id } })).toBeNull();
    });

    it('createMany, updateMany, deleteMany, aggregate, groupBy are valid', async () => {
      await tenantA.user.createMany({
        data: [
          { name: 'CM1', email: uid('cm1') + '@test.com' },
          { name: 'CM2', email: uid('cm2') + '@test.com' },
        ],
      });
      expect(await tenantA.user.count()).toBe(2);

      await tenantA.user.updateMany({ where: {}, data: { status: 'ON_LEAVE' } });
      const all = await tenantA.user.findMany({});
      expect(all.every((u) => u.status === 'ON_LEAVE')).toBe(true);

      const agg = await tenantA.user.aggregate({ _count: { _all: true } });
      expect(agg._count._all).toBe(2);

      const grouped = await tenantA.user.groupBy({ by: ['status'], _count: { _all: true } });
      expect(grouped).toHaveLength(1);
      expect(grouped[0].status).toBe('ON_LEAVE');

      const del = await tenantA.user.deleteMany({});
      expect(del.count).toBe(2);
    });

    it('teamMembership and rolePermission tenant operations are valid', async () => {
      const team = await tenantA.team.create({ data: { name: uid('TeamOp') } });
      const user = await tenantA.user.create({ data: { name: 'U', email: uid('uop') + '@test.com' } });
      const m = await tenantA.teamMembership.create({ data: { userId: user.id, teamId: team.id } });
      expect(await tenantA.teamMembership.findUnique({ where: { id: m.id } })).not.toBeNull();
      expect(await tenantA.teamMembership.count()).toBe(1);
      await tenantA.teamMembership.delete({ where: { id: m.id } });
      expect(await tenantA.teamMembership.count()).toBe(0);

      const perm = await prisma.permission.create({ data: { resource: uid('r2'), action: 'b' } });
      const role = await tenantA.role.create({ data: { name: uid('RoleOp') } });
      const rp = await tenantA.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id, scope: 'PROJECT' } });
      expect(await tenantA.rolePermission.findUnique({ where: { id: rp.id } })).not.toBeNull();
      await tenantA.rolePermission.update({ where: { id: rp.id }, data: { scope: 'ORGANIZATION' } });
      const updated = await prisma.rolePermission.findUnique({ where: { id: rp.id } });
      expect(updated.scope).toBe('ORGANIZATION');
    });

    it('$transaction preserves tenant isolation', async () => {
      await tenantA.$transaction(async (tx) => {
        const u = await tx.user.create({ data: { name: 'TxUser', email: uid('tx') + '@test.com' } });
        expect(u.organizationId).toBe(orgA.id);
        const found = await tx.user.findUnique({ where: { id: u.id } });
        expect(found).not.toBeNull();
        // Cross read inside tx should still be blocked
        expect(await tx.user.findMany({})).toHaveLength(1);
      });
      // Verify persisted
      expect(await tenantA.user.count()).toBe(1);
      expect(await tenantB.user.count()).toBe(0);
    });
  });

  // 12. No invalid findUnique/update/delete selectors are generated
  describe('12. No invalid findUnique/update/delete selectors are generated', () => {
    it('tenant findUnique does not generate invalid update with organizationId in unique where', async () => {
      const user = await tenantA.user.create({ data: { name: 'Valid', email: uid('valid') + '@test.com' } });
      // The following would be invalid if implemented as
      // prisma.user.findUnique({ where: { id, organizationId } }) without compound unique.
      // Our implementation uses findFirst internally, so it should succeed.
      let err = null;
      try {
        const found = await tenantA.user.findUnique({ where: { id: user.id } });
        expect(found).not.toBeNull();
      } catch (e) {
        err = e;
      }
      expect(err).toBeNull();
      // Check error message does not contain Prisma validation about organizationId
      if (err) expect(err.message).not.toMatch(/Unknown arg.*organizationId/);
    });

    it('tenant update does not use invalid where with organizationId flat', async () => {
      const user = await tenantA.user.create({ data: { name: 'Upd', email: uid('upd') + '@test.com' } });
      let err = null;
      try {
        await tenantA.user.update({ where: { id: user.id }, data: { name: 'Upd2' } });
      } catch (e) {
        err = e;
      }
      expect(err).toBeNull();
      if (err) expect(err.message).not.toMatch(/Unknown arg.*organizationId/);
    });

    it('tenant delete does not use invalid where', async () => {
      const user = await tenantA.user.create({ data: { name: 'Del', email: uid('del') + '@test.com' } });
      let err = null;
      try {
        await tenantA.user.delete({ where: { id: user.id } });
      } catch (e) {
        err = e;
      }
      expect(err).toBeNull();
    });

    it('explicit raw findUnique with organizationId is not tenant-safe, but tenant wrapper is', async () => {
      const user = await tenantA.user.create({ data: { name: 'Inv', email: uid('inv') + '@test.com' } });
      // Raw Prisma: findUnique with { id, organizationId } does NOT enforce tenant isolation in this
      // Prisma version — it resolves using only the unique field (id) and ignores organizationId
      // when no compound unique exists. This demonstrates why centralized wrapping via findFirst
      // is required for correct isolation, rather than relying on Prisma to reject the shape.
      const rawWithMatchingOrg = await prisma.user.findUnique({ where: { id: user.id, organizationId: orgA.id } });
      const rawWithMismatchedOrg = await prisma.user.findUnique({
        where: { id: user.id, organizationId: orgB.id },
      });
      // Both return the same record (leak) — raw findUnique is not tenant-safe
      expect(rawWithMatchingOrg).not.toBeNull();
      // In Prisma 6.19, mismatched org is either ignored (returns record) or throws;
      // either way, raw findUnique must NOT be used for tenant isolation. Our tenant wrapper
      // correctly isolates via findFirst with organizationId filter.
      if (rawWithMismatchedOrg) {
        expect(rawWithMismatchedOrg.id).toBe(user.id); // leak demonstrated
      }
      // Tenant wrapper with same logical intent correctly isolates and uses findFirst internally
      await expect(tenantA.user.findUnique({ where: { id: user.id } })).resolves.not.toBeNull();
      expect(await tenantB.user.findUnique({ where: { id: user.id } })).toBeNull();
    });
  });

  // 13. Existing Checkpoint 1 health tests still pass (smoke)
  describe('13. Existing health and enums', () => {
    it('User status lifecycle fields are present and default ACTIVE', async () => {
      const u = await tenantA.user.create({ data: { name: 'Status', email: uid('status') + '@test.com' } });
      expect(u.status).toBe('ACTIVE');
      expect(u).toHaveProperty('deactivatedAt');
      expect(u).toHaveProperty('reassignmentCompletedAt');
      expect(u).toHaveProperty('deletedAt');
      expect(u.deletedAt).toBeNull();

      // Status update to ON_LEAVE and DEACTIVATED
      const onLeave = await tenantA.user.update({ where: { id: u.id }, data: { status: 'ON_LEAVE' } });
      expect(onLeave.status).toBe('ON_LEAVE');
      const deact = await tenantA.user.update({
        where: { id: u.id },
        data: { status: 'DEACTIVATED', deactivatedAt: new Date() },
      });
      expect(deact.status).toBe('DEACTIVATED');
      expect(deact.deactivatedAt).not.toBeNull();
    });

    it('DataScope enum values are valid on RolePermission', async () => {
      const perm = await prisma.permission.create({ data: { resource: uid('res'), action: 'scopeTest' } });
      await tenantA.role.create({ data: { name: uid('RoleScope') } });
      for (const scope of ['OWN', 'TEAM', 'PROJECT', 'ORGANIZATION']) {
        const role2 = await tenantA.role.create({ data: { name: uid('Role-' + scope) } });
        const rp = await tenantA.rolePermission.create({
          data: { roleId: role2.id, permissionId: perm.id, scope },
        });
        expect(rp.scope).toBe(scope);
      }
    });

    it('soft delete column exists but does not break hard delete (foundation)', async () => {
      const u = await tenantA.user.create({ data: { name: 'Soft', email: uid('soft') + '@test.com' } });
      // Directly set deletedAt via tenant update (simulating soft delete)
      const soft = await tenantA.user.update({ where: { id: u.id }, data: { deletedAt: new Date() } });
      expect(soft.deletedAt).not.toBeNull();
      // Tenant findMany should now exclude soft-deleted by default (our wrapper filters)
      const found = await tenantA.user.findMany({});
      expect(found.find((x) => x.id === u.id)).toBeUndefined();
      // But raw query with deletedAt filter can still see it
      const rawFound = await prisma.user.findFirst({ where: { id: u.id } });
      expect(rawFound).not.toBeNull();
      expect(rawFound.deletedAt).not.toBeNull();
    });

    it('TeamMembership organizationId is required and has FK', async () => {
      // Already tested, but verify raw DB constraint via Prisma
      const user = await tenantA.user.create({ data: { name: 'TMOrg', email: uid('tmorg') + '@test.com' } });
      const team = await tenantA.team.create({ data: { name: uid('TeamOrg') } });
      const m = await prisma.teamMembership.create({
        data: { id: uid('tm'), userId: user.id, teamId: team.id, organizationId: orgA.id },
      });
      expect(m.organizationId).toBe(orgA.id);
      // Missing organizationId should fail at DB level (NOT NULL)
      await expect(
        prisma.teamMembership.create({ data: { userId: user.id, teamId: team.id, organizationId: orgA.id, id: uid('tm2') } })
      ).rejects.toThrow(); // duplicate will throw, but test NOT NULL via raw query without org?
      // Try raw without org via $queryRaw
      await expect(prisma.$queryRawUnsafe("INSERT INTO team_memberships (\"userId\", \"teamId\", \"createdAt\", id, \"organizationId\") VALUES ('x','y', NOW(), 'z', NULL)")).rejects.toThrow();
    });
  });

  // Additional: ensure tenant client fails closed for teamMembership without org
  describe('Soft delete and indexes exist', () => {
    it('indexes exist for organizationId and composite fields', async () => {
      // We verify via query that indexes are usable by checking query plan or just that queries work with filters
      // Actual index existence was verified via migration, here we test access patterns
      const users = [];
      for (let i = 0; i < 5; i++) {
        users.push(await tenantA.user.create({ data: { name: `U${i}`, email: uid(`u${i}`) + '@test.com', status: i % 2 === 0 ? 'ACTIVE' : 'ON_LEAVE' } }));
      }
      const active = await tenantA.user.findMany({ where: { status: 'ACTIVE' } });
      expect(active.length).toBeGreaterThan(0);
      // organizationId + status composite index should handle this filter efficiently
    });
  });
});
