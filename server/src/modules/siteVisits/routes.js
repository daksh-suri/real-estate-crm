const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { authorize } = require('../authorization/guard');
const controller = require('./controller');

const router = express.Router();

router.use(authenticate);

// Scheduling is the only create path (idempotency-keyed). There is no
// generic PATCH: relationships are immutable and status/slot move only via
// the dedicated operations below, each validated against the lifecycle map.
router.post('/', authorize('siteVisit', 'create'), controller.create);
router.get('/', authorize('siteVisit', 'read'), controller.list);
router.get('/:siteVisitId', authorize('siteVisit', 'read'), controller.getOne);
router.post('/:siteVisitId/reschedule', authorize('siteVisit', 'update'), controller.reschedule);
router.post('/:siteVisitId/confirm', authorize('siteVisit', 'transition'), controller.confirm);
router.post('/:siteVisitId/cancel', authorize('siteVisit', 'transition'), controller.cancel);
router.post('/:siteVisitId/complete', authorize('siteVisit', 'transition'), controller.complete);
router.post('/:siteVisitId/no-show', authorize('siteVisit', 'transition'), controller.noShow);

module.exports = router;
