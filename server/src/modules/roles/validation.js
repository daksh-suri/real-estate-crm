const { validate } = require('../../lib/validate');

// Read-only in V1 (Checkpoint 18, DEC-039): roles list + permission
// catalogue have no params or body to validate. This module exists to keep
// the {routes,controller,service,validation} shape uniform.

module.exports = { validate };
