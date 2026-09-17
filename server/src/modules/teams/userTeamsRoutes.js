const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { authorize } = require('../authorization/guard');
const controller = require('./controller');

const router = express.Router();

router.use(authenticate);

// GET /users/:userId/teams — list teams for a user
router.get('/:userId/teams', authorize('team', 'read'), controller.listUserTeams);

module.exports = router;
