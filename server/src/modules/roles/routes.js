const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { authorize } = require('../authorization/guard');
const controller = require('./controller');

const router = express.Router();

// Role permission matrix — read + write (DEC-042). Create/update are permission-gated, not role-name-gated.
router.use(authenticate);

router.get('/', authorize('role', 'read'), controller.list);
router.get('/permissions/catalogue', authorize('role', 'read'), controller.catalogue);
router.post('/', authorize('role', 'create'), controller.create);
router.put('/:roleId/permissions', authorize('role', 'update'), controller.replacePermissions);

module.exports = router;
