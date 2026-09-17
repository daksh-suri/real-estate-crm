const rateLimit = require('express-rate-limit');
const config = require('../config');

// Login rate limiter — brute-force protection
const loginLimiter = rateLimit({
  windowMs: config.rateLimit.loginWindowMs,
  max: config.rateLimit.loginMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many login attempts, please try again later', status: 429 } },
  // Key by IP + email if present to avoid locking out shared IPs
  keyGenerator: (req) => {
    const email = (req.body && req.body.email) ? req.body.email.toLowerCase().trim() : '';
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    return `${ip}:${email}`;
  },
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

module.exports = { loginLimiter, refreshLimiter };
