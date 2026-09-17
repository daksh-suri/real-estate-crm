const crypto = require('crypto');
const config = require('../config');

function generateRawRefreshToken() {
  return crypto.randomBytes(48).toString('hex'); // 96 hex chars
}

function hashRefreshToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function getRefreshExpiryDate() {
  return new Date(Date.now() + config.jwt.refreshExpiresMs);
}

module.exports = { generateRawRefreshToken, hashRefreshToken, getRefreshExpiryDate };
