const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { authorize } = require('../authorization/guard');
const { uploadLimiter } = require('../../middleware/rateLimiter');
const controller = require('./controller');

const router = express.Router();

router.use(authenticate);

// Agents upload/submit/resubmit; only verify/reject grantees (Operations /
// Accounts, Manager, Admin via role setup) can review. No generic PATCH or
// DELETE — finalized rows are history and never mutate.
router.post('/', authorize('document', 'create'), controller.create);
router.get('/', authorize('document', 'read'), controller.list);
router.get('/:documentId', authorize('document', 'read'), controller.getOne);
router.post('/:documentId/upload-url', authorize('document', 'upload'), uploadLimiter, controller.uploadUrl);
router.post('/:documentId/access-url', authorize('document', 'read'), controller.accessUrl);
router.post('/:documentId/complete', authorize('document', 'upload'), controller.complete);
router.post('/:documentId/submit', authorize('document', 'upload'), controller.submit);
router.post('/:documentId/verify', authorize('document', 'verify'), controller.verify);
router.post('/:documentId/reject', authorize('document', 'reject'), controller.reject);
router.post('/:documentId/resubmit', authorize('document', 'upload'), controller.resubmit);

module.exports = router;
