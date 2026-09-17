const bcrypt = require('bcrypt');
const config = require('../config');

async function hashPassword(plain) {
  return bcrypt.hash(plain, config.bcrypt.cost);
}

async function verifyPassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

module.exports = { hashPassword, verifyPassword };
