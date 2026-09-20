const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const controller = require('./controller');

const router = express.Router();

// Operational dashboard: authenticate only.  Every CRM user sees their own
// org's overview.  No new permission created — consistent with the 17G
// reports precedent (DEC-036/DEC-037).  Data scopes (OWN/TEAM/PROJECT) are
// unenforced here exactly as on every other list endpoint.
router.use(authenticate);
router.get('/', controller.get);

module.exports = router;
