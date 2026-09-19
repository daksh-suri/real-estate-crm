const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { authorize } = require('../authorization/guard');
const controller = require('./controller');

const router = express.Router();

router.use(authenticate);

// Conversion-only resource: create from an ACTIVE Reservation, read, cancel.
// No generic PATCH/DELETE — a finalized Booking never mutates in place.
router.post('/', authorize('booking', 'create'), controller.create);
router.get('/', authorize('booking', 'read'), controller.list);
router.get('/:bookingId', authorize('booking', 'read'), controller.getOne);
router.post('/:bookingId/cancel', authorize('booking', 'cancel'), controller.cancel);

module.exports = router;
