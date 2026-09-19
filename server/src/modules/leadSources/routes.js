const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { authorize } = require('../authorization/guard');
const controller = require('./controller');

const router = express.Router();

router.use(authenticate);

router.post('/', authorize('leadSource', 'create'), controller.create);
router.get('/', authorize('leadSource', 'read'), controller.list);
router.get('/:leadSourceId', authorize('leadSource', 'read'), controller.getOne);
router.patch('/:leadSourceId', authorize('leadSource', 'update'), controller.update);
router.delete('/:leadSourceId', authorize('leadSource', 'delete'), controller.remove);

module.exports = router;
