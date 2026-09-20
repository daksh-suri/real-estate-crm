const express = require('express');
const { prisma } = require('../lib/prisma');
const config = require('../config');

const router = express.Router();

/**
 * GET /health
 * Process liveness + DB connectivity + worker liveness (from the
 * worker-owned heartbeat row; 'never' before the first worker cycle).
 */
router.get('/', async (req, res) => {
  let db = 'ok';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    db = 'down';
    void err;
  }

  let worker = 'never';
  try {
    const beat = await prisma.workerHeartbeat.findUnique({ where: { id: 'main' } });
    if (beat) {
      worker = Date.now() - new Date(beat.lastBeatAt).getTime() <= config.worker.heartbeatStaleMs ? 'live' : 'stale';
    }
  } catch (err) {
    worker = 'unknown';
    void err;
  }

  const status = db === 'ok' ? 'ok' : 'degraded';
  res.status(db === 'ok' ? 200 : 503).json({
    status,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    service: 'real-estate-crm-api',
    db,
    worker,
  });
});

module.exports = router;
