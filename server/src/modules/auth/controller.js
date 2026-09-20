const { validate, loginSchema, refreshSchema, logoutSchema } = require('./validation');
const authService = require('./service');
const { prisma } = require('../../lib/prisma');
const config = require('../../config');

function setRefreshCookie(res, rawRefreshToken) {
  const maxAge = config.jwt.refreshExpiresMs;
  res.cookie(config.cookies.refreshName, rawRefreshToken, {
    ...config.cookies.refreshCookieOptions,
    maxAge,
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(config.cookies.refreshName, {
    ...config.cookies.refreshCookieOptions,
  });
}

function getRefreshTokenFromRequest(req) {
  // Prefer HttpOnly cookie, fallback to body for test/programmatic clients
  if (req.cookies && req.cookies[config.cookies.refreshName]) {
    return req.cookies[config.cookies.refreshName];
  }
  if (req.body && req.body.refreshToken) {
    return req.body.refreshToken;
  }
  return null;
}

async function login(req, res, next) {
  try {
    const { email, password, organizationId } = validate(loginSchema, req.body);
    const result = await authService.login({ email, password, organizationId });

    setRefreshCookie(res, result.refreshToken);

    // Do not return refresh token in body — HttpOnly cookie is the transport
    // For test convenience we also include it in body when in test env, but document as not for prod
    const responseBody = {
      accessToken: result.accessToken,
      user: result.user,
    };
    // In test, include refreshToken to allow agent without cookie jar to test
    if (config.isTest) {
      responseBody.refreshToken = result.refreshToken;
    }

    return res.status(200).json(responseBody);
  } catch (err) {
    return next(err);
  }
}

// Origin allowlist match for cookie-based refresh CSRF protection. Accepts
// an exact Origin or a Referer rooted at the configured CORS origin. A
// wildcard allowed-origin never matches (credentials must never ride '*').
function originMatchesAllowed(origin, allowed) {
  if (!origin || !allowed || allowed === '*') return false;
  const norm = (s) => s.replace(/\/+$/, '');
  const o = norm(origin);
  const a = norm(allowed);
  return o === a || o.startsWith(`${a}/`);
}

async function refresh(req, res, next) {
  try {
    // CSRF check for cookie-based refresh: require a present Origin/Referer
    // that matches the configured allowed origin.
    // If refresh token came from cookie, verify request origin
    const usedCookie = !!(req.cookies && req.cookies[config.cookies.refreshName]);
    const rawFromBody = req.body ? req.body.refreshToken : undefined;
    // Production transport is the HttpOnly cookie: a JS-readable body token
    // bypasses the cookie CSRF check, so it is rejected in production.
    // (Existing suites run with isProduction=false and are unaffected.)
    if (rawFromBody && config.isProduction) {
      const err = new Error('Refresh token in request body is not accepted in production');
      err.statusCode = 401;
      return next(err);
    }
    if (usedCookie && config.isProduction) {
      const origin = req.headers.origin || req.headers.referer || '';
      // In production, origin must be present and match corsOrigin or be same-site
      // For V1, we rely on SameSite=Strict plus origin check; if missing, deny
      if (!origin) {
        const err = new Error('CSRF check failed: missing Origin');
        err.statusCode = 403;
        return next(err);
      }
      if (!originMatchesAllowed(origin, config.corsOrigin)) {
        const err = new Error('CSRF check failed: origin mismatch');
        err.statusCode = 403;
        return next(err);
      }
    }

    // Allow refreshToken in body or cookie
    const rawFromCookie = req.cookies ? req.cookies[config.cookies.refreshName] : null;
    const raw = rawFromBody || rawFromCookie;

    // Validate shape if provided in body
    if (rawFromBody) {
      validate(refreshSchema, { refreshToken: rawFromBody });
    }
    if (!raw) {
      const err = new Error('Refresh token required');
      err.statusCode = 401;
      return next(err);
    }

    const result = await authService.refresh({ rawRefreshToken: raw });

    setRefreshCookie(res, result.refreshToken);

    const responseBody = { accessToken: result.accessToken };
    if (config.isTest) {
      responseBody.refreshToken = result.refreshToken;
    }
    return res.status(200).json(responseBody);
  } catch (err) {
    return next(err);
  }
}

async function logout(req, res, next) {
  try {
    const raw = getRefreshTokenFromRequest(req);
    if (raw) {
      validate(logoutSchema, { refreshToken: raw });
      await authService.logout({ rawRefreshToken: raw });
    }
    clearRefreshCookie(res);
    return res.status(200).json({ message: 'Logged out' });
  } catch (err) {
    // Even if logout fails, clear cookie
    clearRefreshCookie(res);
    return next(err);
  }
}

async function me(req, res, next) {
  try {
    // req.user is set by authenticate middleware
    const user = req.user;
    if (!user) {
      const err = new Error('Not authenticated');
      err.statusCode = 401;
      return next(err);
    }
    // Fetch fresh user and include role, organization, teams for demonstration
    const freshUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: { role: true, organization: true },
    });
    if (!freshUser) {
      const err = new Error('User not found');
      err.statusCode = 401;
      return next(err);
    }
    const { passwordHash, ...safe } = freshUser;
    void passwordHash;
    // Include team memberships
    const memberships = await prisma.teamMembership.findMany({
      where: { userId: user.id, organizationId: user.organizationId },
      select: { teamId: true },
    });

    return res.status(200).json({
      user: safe,
      organization: freshUser.organization,
      role: freshUser.role,
      teamIds: memberships.map((m) => m.teamId),
      auth: {
        organizationId: req.auth.organizationId,
        allowedScopes: req.authorization ? req.authorization.allowedScopes : undefined,
      },
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { login, refresh, logout, me, originMatchesAllowed };
