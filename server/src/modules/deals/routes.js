const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { authorize } = require('../authorization/guard');
const controller = require('./controller');

const router = express.Router();

router.use(authenticate);

router.post('/', authorize('deal', 'create'), controller.create);
router.get('/', authorize('deal', 'read'), controller.list);
router.get('/:dealId', authorize('deal', 'read'), controller.getOne);
router.patch('/:dealId', authorize('deal', 'update'), controller.update);
router.delete('/:dealId', authorize('deal', 'delete'), controller.remove);
// Dedicated stage-transition operation: the ONLY path that mutates stage.
// Generic PATCH can never move a stage past transition validation.
router.post('/:dealId/stage-transition', authorize('deal', 'transition'), controller.transition);

module.exports = router;
