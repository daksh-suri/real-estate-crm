const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { authorize } = require('../authorization/guard');
const controller = require('./controller');

const router = express.Router();

router.use(authenticate);

// HOLD rides the Reservation row (type discriminator) — no /holds resource.
// No generic PATCH: status/type/unitId/dealId move only via the dedicated
// create + release + (Checkpoint 11) booking operations.
router.post('/', authorize('reservation', 'create'), controller.create);
router.get('/', authorize('reservation', 'read'), controller.list);
router.get('/:reservationId', authorize('reservation', 'read'), controller.getOne);
router.post('/:reservationId/release', authorize('reservation', 'release'), controller.release);

module.exports = router;
