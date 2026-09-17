const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { authorize } = require('./guard');

const router = express.Router();

// All demo routes require authentication first
router.use(authenticate);

// Simple protected endpoints for testing authorize matrix
router.get('/lead-read', authorize('lead', 'read'), (req, res) => {
  res.json({ ok: true, userId: req.user.id, scopes: req.authorization.allowedScopes });
});

router.post('/lead-create', authorize('lead', 'create'), (req, res) => {
  res.json({ ok: true });
});

router.post('/lead-assign', authorize('lead', 'assign'), (req, res) => {
  res.json({ ok: true });
});

router.post('/payment-verify', authorize('payment', 'verify'), (req, res) => {
  res.json({ ok: true });
});

router.get('/lead-read-own', authorize('lead', 'read', { scope: 'OWN' }), (req, res) => {
  res.json({ ok: true, scope: 'OWN' });
});

router.get('/lead-read-team', authorize('lead', 'read', { scope: 'TEAM' }), (req, res) => {
  res.json({ ok: true, scope: 'TEAM' });
});

router.get('/lead-read-organization', authorize('lead', 'read', { scope: 'ORGANIZATION' }), (req, res) => {
  res.json({ ok: true, scope: 'ORGANIZATION' });
});

router.get('/lead-read-project', authorize('lead', 'read', { scope: 'PROJECT' }), (req, res) => {
  res.json({ ok: true, scope: 'PROJECT' });
});

module.exports = router;
