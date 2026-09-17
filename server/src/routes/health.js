const express = require('express');

const router = express.Router();

/**
 * GET /health
 * Basic process liveness and health endpoint.
 */
router.get('/', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    service: 'real-estate-crm-api',
  });
});

module.exports = router;
