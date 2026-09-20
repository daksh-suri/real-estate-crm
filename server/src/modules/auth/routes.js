const express = require('express');
const controller = require('./controller');
const { authenticate } = require('../../middleware/authenticate');
const { loginLimiter, refreshLimiter } = require('../../middleware/rateLimiter');

const router = express.Router();

router.post('/login', loginLimiter, controller.login);
router.post('/refresh', refreshLimiter, controller.refresh);
// Logout performs an unauthenticated DB write; the generous refresh bucket
// (60/15m) stops write-spam without affecting legitimate use.
router.post('/logout', refreshLimiter, controller.logout);
router.get('/me', authenticate, controller.me);

module.exports = router;
