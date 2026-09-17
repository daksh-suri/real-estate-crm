const { verifyAccessToken } = require('../lib/jwt');
const { prisma } = require('../lib/prisma');
const { createTenantPrisma } = require('../lib/tenant');

async function authenticate(req, _res, next) {
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    let token = null;
    if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    }

    if (!token) {
      const err = new Error('Authentication required');
      err.statusCode = 401;
      return next(err);
    }

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch (err) {
      // jwt.verify throws TokenExpiredError, JsonWebTokenError, NotBeforeError
      const authErr = new Error(err.name === 'TokenExpiredError' ? 'Access token expired' : 'Invalid access token');
      authErr.statusCode = 401;
      // Preserve original for debugging but not leaking internals
      authErr.cause = err;
      return next(authErr);
    }

    const userId = payload.sub || payload.userId;
    const tokenOrgId = payload.organizationId;

    if (!userId || !tokenOrgId) {
      const err = new Error('Invalid access token payload');
      err.statusCode = 401;
      return next(err);
    }

    // DB is authoritative — resolve current user
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) {
      const err = new Error('Invalid credentials');
      err.statusCode = 401;
      return next(err);
    }

    // Organization membership must match token — prevents JWT tampering even if signature somehow valid
    if (user.organizationId !== tokenOrgId) {
      const err = new Error('Token organization mismatch');
      err.statusCode = 401;
      return next(err);
    }

    // Status check — DEACTIVATED must be denied immediately, even with valid JWT
    if (user.status === 'DEACTIVATED') {
      const err = new Error('Account deactivated');
      err.statusCode = 401;
      return next(err);
    }

    // ON_LEAVE is allowed — not treated as DEACTIVATED per Phase 2 #21 distinction

    // Verify organization still exists (optional, but thorough)
    const org = await prisma.organization.findUnique({ where: { id: user.organizationId } });
    if (!org) {
      const err = new Error('Organization not found');
      err.statusCode = 401;
      return next(err);
    }

    // Establish request context
    req.user = user; // full record (contains passwordHash — never return to client directly)
    req.auth = {
      userId: user.id,
      organizationId: user.organizationId,
      user,
      organization: org,
    };
    // Tenant-scoped Prisma for this request — all subsequent business logic must use this
    req.tenantPrisma = createTenantPrisma(user.organizationId);
    // Also expose safe user without passwordHash for convenience
    req.safeUser = (() => {
      const { passwordHash, ...safe } = user;
      void passwordHash;
      return safe;
    })();

    return next();
  } catch (err) {
    return next(err);
  }
}

// Optional authenticate — does not fail if no token, just attaches null
async function optionalAuthenticate(req, _res, next) {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null;
    req.auth = null;
    return next();
  }
  return authenticate(req, _res, next);
}

module.exports = { authenticate, optionalAuthenticate };
