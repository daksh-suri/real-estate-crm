const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { authorize } = require('../authorization/guard');
const controller = require('./controller');

const router = express.Router();

router.use(authenticate);

// Single intake endpoint for all channels (portal adapter, walk-in form,
// phone form, owned form). Channel travels in the body; downstream is
// channel-agnostic. Enquiries are append-only: no update/delete endpoints.
router.post('/', authorize('enquiry', 'create'), controller.intake);
router.get('/', authorize('enquiry', 'read'), controller.list);
router.get('/:enquiryId', authorize('enquiry', 'read'), controller.getOne);

module.exports = router;
