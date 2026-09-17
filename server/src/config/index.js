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
const refreshSecret = process.env.JWT_REFRESH_SECRET || process.env.JWT_ACCESS_SECRET || (isProduction ? null : 'dev-refresh-secret-change-in-production-32chars+');

if (isProduction) {
  requireInProduction('JWT_ACCESS_SECRET', accessSecret);
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '5000', 10),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  databaseUrl: process.env.DATABASE_URL || '',
  isProduction,
  isTest,

  // JWT — access token (short-lived)
  jwt: {
    accessSecret,
    // Separate secret for refresh JWT not used; refresh tokens are opaque SHA256 hashed.
    // Keep for potential future JWT refresh if needed.
    refreshSecret,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m', // 15 minutes
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d', // 7 days (for refresh_tokens.expiresAt)
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
    csrfHeader: 'x-csrf-token',
  },

  // Rate limiting (in-memory)
  rateLimit: {
    loginWindowMs: 15 * 60 * 1000,
    loginMax: isTest ? 1000 : 20, // generous for test suite
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
