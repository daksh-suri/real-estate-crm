const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { authorize } = require('../authorization/guard');
const controller = require('./controller');

const router = express.Router();

router.use(authenticate);

// Leads are created ONLY by the Enquiry intake pipeline (POST /enquiries) so
// Contact matching, dedup, uniqueness and assignment cannot be bypassed —
// there is deliberately no POST /leads endpoint in Checkpoint 7.
router.get('/', authorize('lead', 'read'), controller.list);
router.get('/:leadId', authorize('lead', 'read'), controller.getOne);
router.patch('/:leadId', authorize('lead', 'update'), controller.update);
router.delete('/:leadId', authorize('lead', 'delete'), controller.remove);
router.post('/:leadId/reassign', authorize('lead', 'assign'), controller.reassign);

module.exports = router;
