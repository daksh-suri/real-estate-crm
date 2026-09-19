const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from root .env if available, fallback to server local
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

function requireInProduction(name, value) {
  if (isProduction && (!value || value.trim() === '')) {
    throw new Error(`Missing required environment variable ${name} in production`);
  }
  return value;
}

const accessSecret = process.env.JWT_ACCESS_SECRET || (isProduction ? null : 'dev-access-secret-change-in-production-32chars+');

if (isProduction) {
  requireInProduction('JWT_ACCESS_SECRET', accessSecret);
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '5000', 10),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  isProduction,
  isTest,

  // JWT — access token (short-lived)
  jwt: {
    accessSecret,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m', // 15 minutes
    refreshExpiresMs: parseDuration(process.env.JWT_REFRESH_EXPIRES_IN || '7d'),
    issuer: process.env.JWT_ISSUER || 'real-estate-crm',
    audience: process.env.JWT_AUDIENCE || 'real-estate-crm-client',
  },

  // Bcrypt
  bcrypt: {
    cost: parseInt(process.env.BCRYPT_COST || '10', 10), // 10 for test speed, 12 for prod
  },

  // Cookies
  cookies: {
    refreshName: 'refreshToken',
    // HttpOnly, Secure in prod, SameSite
    refreshCookieOptions: {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      path: '/',
      // maxAge set per refresh token expiry; we set dynamically
    },
  },

  // Rate limiting (in-memory)
  rateLimit: {
    loginWindowMs: 15 * 60 * 1000,
    loginMax: isTest ? 1000 : 20, // generous for test suite
  },

  // Background worker (Checkpoint 15). All values overridable via env;
  // defaults are sensible, documented in DEC-032, and cheap to change.
  worker: {
    // Reservation/hold expiry sweep cadence (Phase 3: ~every minute).
    expiryIntervalMs: parseInt(process.env.WORKER_EXPIRY_INTERVAL_MS || '60000', 10),
    // Outbox poll cadence.
    outboxIntervalMs: parseInt(process.env.WORKER_OUTBOX_INTERVAL_MS || '10000', 10),
    // Max events claimed per outbox poll.
    outboxBatchSize: parseInt(process.env.WORKER_OUTBOX_BATCH || '25', 10),
    // Retries: attempts are counted from the claim; delay(attempts) =
    // min(baseDelayMs * 2^(attempts-1), maxDelayMs). attempts >= maxAttempts
    // transitions the event to FAILED (visible, never silently dropped).
    maxAttempts: parseInt(process.env.WORKER_MAX_ATTEMPTS || '10', 10),
    baseDelayMs: parseInt(process.env.WORKER_BASE_DELAY_MS || '30000', 10),
    maxDelayMs: parseInt(process.env.WORKER_MAX_DELAY_MS || '3600000', 10),
    // /health reports worker 'stale' when the heartbeat is older than this.
    heartbeatStaleMs: parseInt(process.env.WORKER_HEARTBEAT_STALE_MS || '300000', 10),
  },
};

function parseDuration(str) {
  // supports '15m', '7d', '1h', '30s' or ms number
  if (!str) return 7 * 24 * 60 * 60 * 1000;
  const match = String(str).trim().match(/^(\d+)\s*([smhd])$/i);
  if (!match) {
    const n = parseInt(str, 10);
    if (!isNaN(n)) return n;
    return 7 * 24 * 60 * 60 * 1000;
  }
  const n = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const mult = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
  return n * mult[unit];
}

module.exports = config;
