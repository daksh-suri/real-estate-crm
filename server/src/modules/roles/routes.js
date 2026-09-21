const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { authorize } = require('../authorization/guard');
const controller = require('./controller');

const router = express.Router();

// Read-only role/permission matrix (Checkpoint 18, DEC-039).
router.use(authenticate);

router.get('/', authorize('role', 'read'), controller.list);
router.get('/permissions/catalogue', authorize('role', 'read'), controller.catalogue);

module.exports = router;
