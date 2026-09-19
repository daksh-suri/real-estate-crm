const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { authorize } = require('../authorization/guard');
const controller = require('./controller');

const router = express.Router();

router.use(authenticate);

router.post('/', authorize('assignmentRule', 'create'), controller.create);
router.get('/', authorize('assignmentRule', 'read'), controller.list);
router.get('/:assignmentRuleId', authorize('assignmentRule', 'read'), controller.getOne);
router.patch('/:assignmentRuleId', authorize('assignmentRule', 'update'), controller.update);
router.delete('/:assignmentRuleId', authorize('assignmentRule', 'delete'), controller.remove);

module.exports = router;
