const jwt = require('jsonwebtoken');
const config = require('../config');

function signAccessToken({ userId, organizationId }) {
  const payload = {
    sub: userId,
    organizationId,
  };
  return jwt.sign(payload, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpiresIn,
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, config.jwt.accessSecret, {
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  });
}

// For testing: allow custom expiry
function signAccessTokenWithExpiry({ userId, organizationId }, expiresIn) {
  const payload = { sub: userId, organizationId };
  return jwt.sign(payload, config.jwt.accessSecret, {
    expiresIn,
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  });
}

module.exports = { signAccessToken, verifyAccessToken, signAccessTokenWithExpiry };
