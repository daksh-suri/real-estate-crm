const { prisma } = require('../../lib/prisma');
const { verifyPassword } = require('../../lib/bcrypt');
const { signAccessToken } = require('../../lib/jwt');
const { generateRawRefreshToken, hashRefreshToken, getRefreshExpiryDate } = require('../../lib/refreshToken');

// Generic auth failure — never reveal whether email, org, or password was wrong
function authFailure() {
  const err = new Error('Invalid credentials');
  err.statusCode = 401;
  return err;
}

function deactivatedFailure() {
  const err = new Error('Invalid credentials');
  err.statusCode = 401;
  return err;
}

function getSafeUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  void passwordHash;
  return safe;
}

async function findUserForLogin(email, organizationId) {
  const normalized = email.toLowerCase().trim();
  const user = await prisma.user.findFirst({
    where: { email: { equals: normalized, mode: 'insensitive' }, organizationId, deletedAt: null },
  });
  return user;
}

async function createRefreshTokenRecord({ userId, organizationId, raw, expiresAt, replacedById = null }) {
  const tokenHash = hashRefreshToken(raw);
  const record = await prisma.refreshToken.create({
    data: {
      userId,
      organizationId,
      tokenHash,
      expiresAt,
      replacedById,
    },
  });
  return record;
}

async function login({ email, password, organizationId }) {
  // Normalize email
  const normalizedEmail = email.toLowerCase().trim();

  // Verify organization exists (global)
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) throw authFailure();

  const user = await findUserForLogin(normalizedEmail, organizationId);
  if (!user) throw authFailure();

  // Status checks — DEACTIVATED must not be able to login
  if (user.status === 'DEACTIVATED' || user.deletedAt) {
    throw deactivatedFailure();
  }
  // ON_LEAVE is allowed per architecture — not treated as DEACTIVATED

  if (!user.passwordHash) throw authFailure();

  const passwordOk = await verifyPassword(password, user.passwordHash);
  if (!passwordOk) throw authFailure();

  // Issue tokens
  const accessToken = signAccessToken({ userId: user.id, organizationId: user.organizationId });
  const rawRefresh = generateRawRefreshToken();
  const expiresAt = getRefreshExpiryDate();

  const refreshRecord = await createRefreshTokenRecord({
    userId: user.id,
    organizationId: user.organizationId,
    raw: rawRefresh,
    expiresAt,
  });

  return {
    user: getSafeUser(user),
    accessToken,
    refreshToken: rawRefresh,
    refreshRecord,
  };
}

async function refresh({ rawRefreshToken }) {
  if (!rawRefreshToken) {
    const err = new Error('Refresh token required');
    err.statusCode = 401;
    throw err;
  }
  const tokenHash = hashRefreshToken(rawRefreshToken);

  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!stored) {
    const err = new Error('Invalid refresh token');
    err.statusCode = 401;
    throw err;
  }

  // Check revocation — single-use rotation: once replaced, old token must not be reusable
  if (stored.revokedAt) {
    const err = new Error('Refresh token revoked');
    err.statusCode = 401;
    throw err;
  }

  // Check expiration
  if (stored.expiresAt < new Date()) {
    const err = new Error('Refresh token expired');
    err.statusCode = 401;
    throw err;
  }

  // Load current user — DB is authoritative
  const user = await prisma.user.findUnique({ where: { id: stored.userId } });
  if (!user || user.deletedAt) {
    const err = new Error('Invalid refresh token');
    err.statusCode = 401;
    throw err;
  }

  // Organization must match stored
  if (user.organizationId !== stored.organizationId) {
    const err = new Error('Refresh token organization mismatch');
    err.statusCode = 401;
    throw err;
  }

  // Status check — DEACTIVATED cannot refresh
  if (user.status === 'DEACTIVATED') {
    // Revoke all tokens for deactivated user
    await revokeAllUserTokens(user.id, user.organizationId);
    const err = new Error('Account deactivated');
    err.statusCode = 401;
    throw err;
  }

  // ON_LEAVE allowed

  // Rotation: revoke old, create new, link — must be single-use under concurrency.
  // Generate replacement outside the lock to keep lock duration minimal.
  const newRaw = generateRawRefreshToken();
  const newHash = hashRefreshToken(newRaw);
  const newExpiresAt = getRefreshExpiryDate();

  // Transactional rotation with row-level lock (SELECT FOR UPDATE).
  // Two concurrent requests with same R1 will serialize on the row lock;
  // the second will see revokedAt set after the first commits and be rejected.
  const result = await prisma.$transaction(async (tx) => {
    // Acquire row lock — blocks concurrent refresh using same tokenHash until this tx commits.
    // Use raw query because Prisma findUnique does not expose FOR UPDATE.
    await tx.$queryRaw`SELECT id FROM "refresh_tokens" WHERE "tokenHash" = ${tokenHash} FOR UPDATE`;

    const fresh = await tx.refreshToken.findUnique({ where: { tokenHash } });
    if (!fresh || fresh.revokedAt || fresh.expiresAt < new Date()) {
      const err = new Error('Refresh token revoked');
      err.statusCode = 401;
      throw err;
    }

    // Re-validate user inside the lock — handles deactivation race.
    const freshUser = await tx.user.findUnique({ where: { id: fresh.userId } });
    if (!freshUser || freshUser.deletedAt || freshUser.status === 'DEACTIVATED') {
      // Revoke all on deactivation inside the same lock
      if (freshUser) {
        await tx.refreshToken.updateMany({
          where: { userId: freshUser.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      const err = new Error(freshUser && freshUser.status === 'DEACTIVATED' ? 'Account deactivated' : 'Invalid refresh token');
      err.statusCode = 401;
      throw err;
    }
    if (freshUser.organizationId !== fresh.organizationId) {
      const err = new Error('Refresh token organization mismatch');
      err.statusCode = 401;
      throw err;
    }

    const newRecord = await tx.refreshToken.create({
      data: {
        userId: freshUser.id,
        organizationId: freshUser.organizationId,
        tokenHash: newHash,
        expiresAt: newExpiresAt,
      },
    });

    await tx.refreshToken.update({
      where: { tokenHash },
      data: { revokedAt: new Date(), replacedById: newRecord.id },
    });

    return { newRecord, freshUser };
  });

  // Unpack transaction result
  const newRecord = result.newRecord;
  const freshUserForToken = result.freshUser;
  // Use the fresh user from transaction for the new access token (DB authoritative)
  const newAccessToken = signAccessToken({ userId: freshUserForToken.id, organizationId: freshUserForToken.organizationId });

  return {
    accessToken: newAccessToken,
    refreshToken: newRaw,
    refreshRecord: newRecord,
    user: getSafeUser(freshUserForToken),
  };
}

async function logout({ rawRefreshToken }) {
  if (!rawRefreshToken) {
    // No token provided — still succeed but clear cookie
    return { revoked: false };
  }
  const tokenHash = hashRefreshToken(rawRefreshToken);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!stored) {
    return { revoked: false };
  }
  if (stored.revokedAt) {
    return { revoked: false };
  }
  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
  return { revoked: true };
}

async function revokeAllUserTokens(userId, organizationId) {
  // Centralized revocation for deactivation — called by future User management module
  // Do NOT require caller to understand token internals
  const where = { userId, revokedAt: null };
  if (organizationId) where.organizationId = organizationId;
  await prisma.refreshToken.updateMany({ where, data: { revokedAt: new Date() } });
}

async function revokeAllForUser(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;
  await revokeAllUserTokens(user.id, user.organizationId);
}

module.exports = {
  login,
  refresh,
  logout,
  revokeAllUserTokens,
  revokeAllForUser,
  getSafeUser,
  authFailure,
};
