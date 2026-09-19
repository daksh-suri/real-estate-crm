const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { authorize } = require('../authorization/guard');
const controller = require('./controller');

function authed() {
  const router = express.Router();
  router.use(authenticate);
  return router;
}

const planRouter = authed();
const obligationRouter = authed();
const recordRouter = authed();
const webhookRouter = express.Router();

// No generic PATCH/DELETE: plans/obligations never mutate in place (PAID
// only via webhook); records are correction-only (new row + correctsRecordId).
planRouter.post('/', authorize('paymentPlan', 'create'), controller.createPlan);
planRouter.get('/', authorize('paymentPlan', 'read'), controller.listPlans);
planRouter.get('/:planId', authorize('paymentPlan', 'read'), controller.getPlan);
obligationRouter.get('/:obligationId', authorize('paymentObligation', 'read'), controller.getObligation);
recordRouter.get('/:recordId', authorize('paymentRecord', 'read'), controller.getRecord);

// External gateway boundary: unauthenticated by necessity (no gateway or
// secret exists in V1). Tenant is derived from the obligation row, the
// gateway eventId is the dedup identity. Signing deferred (see DEC-029).
webhookRouter.post('/payment-gateway', controller.webhook);

module.exports = { planRouter, obligationRouter, recordRouter, webhookRouter };
