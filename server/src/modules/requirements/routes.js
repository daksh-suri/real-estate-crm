const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { authorize } = require('../authorization/guard');
const controller = require('./controller');

const router = express.Router();

router.use(authenticate);

// Nested under contacts: POST /contacts/:contactId/requirements
// Handled via separate mount, but also support direct /requirements

// Direct requirement routes
router.post('/', authorize('requirement', 'create'), controller.create);
router.get('/', authorize('requirement', 'read'), controller.listAll);
router.get('/:requirementId', authorize('requirement', 'read'), controller.getOne);
router.patch('/:requirementId', authorize('requirement', 'update'), controller.update);
router.delete('/:requirementId', authorize('requirement', 'delete'), controller.remove);

module.exports = router;
