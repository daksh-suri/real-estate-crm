const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { authorize } = require('../authorization/guard');
const controller = require('./controller');

const router = express.Router();

// Organization user directory + employee provisioning (Checkpoint 18).
// Mounted at /users alongside userTeamsRoutes (GET /users/:userId/teams) —
// shapes do not overlap: this router owns POST /, GET / and GET /:userId.
router.use(authenticate);

router.post('/', authorize('user', 'create'), controller.create);
router.get('/', authorize('user', 'read'), controller.list);
router.get('/:userId', authorize('user', 'read'), controller.getOne);

module.exports = router;
