const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { authorize } = require('../authorization/guard');
const controller = require('./controller');

const router = express.Router();

router.use(authenticate);

router.post('/', authorize('campaign', 'create'), controller.create);
router.get('/', authorize('campaign', 'read'), controller.list);
router.get('/:campaignId', authorize('campaign', 'read'), controller.getOne);
router.patch('/:campaignId', authorize('campaign', 'update'), controller.update);
router.delete('/:campaignId', authorize('campaign', 'delete'), controller.remove);

module.exports = router;
