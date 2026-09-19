// Named-job scheduler (Checkpoint 15). Two jobs, no framework: the
// reservation/hold expiry sweep and the outbox processor. Each tick runs at
// most once concurrently (overlap guard); a failing job logs and continues
// on its next tick. Every cycle upserts the liveness heartbeat.
const { prisma } = require('../lib/prisma');
const config = require('../config');
const { expireDueReservations } = require('../modules/reservations/service');
const { processOutboxBatch } = require('./outbox');

const HEARTBEAT_ID = 'main';

function logLine(level, job, extra = {}) {
  const line = { worker: true, job, ...extra };
  if (level === 'error') console.error(JSON.stringify(line));
  else console.log(JSON.stringify(line));
}

async function writeHeartbeat(detail = {}) {
  await prisma.workerHeartbeat.upsert({
    where: { id: HEARTBEAT_ID },
    update: { lastBeatAt: new Date(), detail },
    create: { id: HEARTBEAT_ID, lastBeatAt: new Date(), detail },
  });
}

async function runReservationExpirySweep() {
  const result = await expireDueReservations({ rawPrisma: prisma });
  logLine('info', 'reservation-expiry', result);
  return result;
}

async function runOutboxCycle() {
  const result = await processOutboxBatch({ client: prisma });
  if (result.claimed > 0) logLine('info', 'outbox-processor', result);
  return result;
}

function startScheduler({ intervals } = {}) {
  const jobs = [
    { name: 'reservation-expiry', intervalMs: intervals?.expiry ?? config.worker.expiryIntervalMs, run: runReservationExpirySweep },
    { name: 'outbox-processor', intervalMs: intervals?.outbox ?? config.worker.outboxIntervalMs, run: runOutboxCycle },
  ];
  const state = { stopped: false, running: new Set(), timers: [] };
  for (const job of jobs) {
    const tick = async () => {
      if (state.stopped || state.running.has(job.name)) return;
      state.running.add(job.name);
      try {
        const result = await job.run();
        await writeHeartbeat({ [job.name]: { at: new Date().toISOString(), ...result } });
      } catch (err) {
        logLine('error', job.name, { error: (err && err.message) || String(err) });
      } finally {
        state.running.delete(job.name);
      }
    };
    // First tick immediately so boot does useful work; then on interval.
    void tick();
    state.timers.push(setInterval(() => void tick(), job.intervalMs));
  }
  logLine('info', 'scheduler-start', { jobs: jobs.map((j) => ({ name: j.name, intervalMs: j.intervalMs })) });
  return state;
}

async function stopScheduler(state) {
  state.stopped = true;
  for (const timer of state.timers) clearInterval(timer);
  // Let in-flight ticks settle (bounded: each tick is short DB work).
  for (let i = 0; i < 100 && state.running.size > 0; i += 1) {
    await new Promise((resolve) => { setTimeout(resolve, 100); });
  }
  logLine('info', 'scheduler-stop', {});
}

module.exports = {
  HEARTBEAT_ID,
  startScheduler,
  stopScheduler,
  runReservationExpirySweep,
  runOutboxCycle,
  writeHeartbeat,
};
