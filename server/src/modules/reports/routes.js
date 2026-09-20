const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { authorize } = require('../authorization/guard');
const controller = require('./controller');

const router = express.Router();

router.use(authenticate);

// Read-only aggregates. Each report is guarded by its domain's existing
// read permission — no new permission, no new data-scope semantics.
router.get('/deals', authorize('deal', 'read'), controller.deals);
router.get('/leads', authorize('lead', 'read'), controller.leads);
router.get('/visits', authorize('siteVisit', 'read'), controller.visits);
router.get('/bookings', authorize('booking', 'read'), controller.bookings);
router.get('/payments', authorize('paymentObligation', 'read'), controller.payments);
router.get('/tasks', authorize('task', 'read'), controller.tasks);
router.get('/activities', authorize('activity', 'read'), controller.activities);
router.get('/inventory', authorize('unit', 'read'), controller.inventory);
router.get('/documents', authorize('document', 'read'), controller.documents);
router.get('/contacts', authorize('contact', 'read'), controller.contacts);

module.exports = router;
