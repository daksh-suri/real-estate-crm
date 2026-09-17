const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { authorize } = require('../authorization/guard');
const controller = require('./controller');

const router = express.Router();

// All organization routes require authentication
router.use(authenticate);

// GET /organizations/me — read current org
router.get('/me', authorize('organization', 'read'), controller.getCurrent);

// PATCH /organizations/me — update current org
router.patch('/me', authorize('organization', 'update'), controller.updateCurrent);

// Also support GET /organizations/:id but strictly tenant-checked (only own org)
router.get('/:id', authorize('organization', 'read'), async (req, res, next) => {
  try {
    const requestedId = req.params.id;
    const currentId = req.auth.organizationId;
    if (requestedId !== currentId) {
      const err = new Error('Cross-tenant organization access denied');
      err.statusCode = 403;
      throw err;
    }
    const org = await require('./service').getCurrentOrganization(requestedId);
    return res.json(org);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
