const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { authorize } = require('../authorization/guard');
const controller = require('./controller');

const router = express.Router();

// All team routes require authentication
router.use(authenticate);

router.post('/', authorize('team', 'create'), controller.create);
router.get('/', authorize('team', 'read'), controller.list);
router.get('/:teamId', authorize('team', 'read'), controller.getOne);
router.patch('/:teamId', authorize('team', 'update'), controller.update);
router.delete('/:teamId', authorize('team', 'delete'), controller.remove);

router.post('/:teamId/members', authorize('team', 'manage_members'), controller.addMember);
router.delete('/:teamId/members/:userId', authorize('team', 'manage_members'), controller.removeMember);
router.get('/:teamId/members', authorize('team', 'read'), controller.listMembers);

module.exports = router;
