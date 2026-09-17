const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { authorize } = require('../authorization/guard');
const controller = require('./controller');
const reqController = require('../requirements/controller');

const router = express.Router();

router.use(authenticate);

router.post('/', authorize('contact', 'create'), controller.create);
router.get('/', authorize('contact', 'read'), controller.list);
router.get('/:contactId', authorize('contact', 'read'), controller.getOne);
router.patch('/:contactId', authorize('contact', 'update'), controller.update);
router.delete('/:contactId', authorize('contact', 'delete'), controller.remove);
router.post('/:contactId/merge', authorize('contact', 'update'), controller.merge);
router.get('/:contactId/possible-duplicates', authorize('contact', 'read'), controller.listPossibleDuplicates);

// Nested requirements
router.post('/:contactId/requirements', authorize('requirement', 'create'), reqController.createForContact);
router.get('/:contactId/requirements', authorize('requirement', 'read'), reqController.listForContact);

module.exports = router;
