const rateLimit = require('express-rate-limit');
const config = require('../config');

// Single-instance in-memory limiting (no Redis in V1): buckets do not span
// processes. Identity is Express req.ip ONLY — never X-Forwarded-For, which
// clients can spoof to mint fresh buckets. `trust proxy` is deliberately
// unset (direct single-instance topology); if a reverse proxy is introduced,
// set it explicitly and re-verify these keys.
function loginKeyGenerator(req) {
  const email = (req.body && req.body.email) ? req.body.email.toLowerCase().trim() : '';
  const ip = req.ip || 'unknown';
  return `${ip}:${email}`;
}

const loginLimiter = rateLimit({
  windowMs: config.rateLimit.loginWindowMs,
  max: config.rateLimit.loginMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many login attempts, please try again later', status: 429 } },
  // Key by IP + email if present to avoid locking out shared IPs
  keyGenerator: loginKeyGenerator,
  // Do not count successful logins? For V1, count all for simplicity
});

// Refresh limiter — more lenient
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many refresh attempts', status: 429 } },
});

// Upload-URL limiter — signed-URL spam protection (generous in test)
function uploadKeyGenerator(req) {
  const user = (req.auth && req.auth.userId) || '';
  const ip = req.ip || 'unknown';
  return `${ip}:${user}`;
}

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.isTest ? 1000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many upload URL requests, please try again later', status: 429 } },
  keyGenerator: uploadKeyGenerator,
});

module.exports = { loginLimiter, refreshLimiter, uploadLimiter, loginKeyGenerator, uploadKeyGenerator };
