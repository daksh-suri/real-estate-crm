const config = require('../config');

// Centralized safety net: service-level handlers keep precedence (they set
// err.status/statusCode with business semantics); this maps the common raw
// Prisma codes that would otherwise surface as 500. Never leaks DB detail.
const PRISMA_CODE_FALLBACK = {
  P2002: 409, // unique-constraint violation -> Conflict
  P2025: 404, // record-not-found for write -> Not Found
};

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let statusCode = err.status || err.statusCode;
  if (!statusCode && err.code && PRISMA_CODE_FALLBACK[err.code]) {
    statusCode = PRISMA_CODE_FALLBACK[err.code];
  }
  statusCode = statusCode || 500;
  const message = err.message || 'Internal Server Error';

  const response = {
    error: {
      message,
      status: statusCode,
    },
  };

  if (!config.isProduction && err.stack) {
    response.error.stack = err.stack;
  }

  res.status(statusCode).json(response);
}

module.exports = errorHandler;
