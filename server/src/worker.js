// Dedicated worker entry point (Checkpoint 15). Run as a separate process
// alongside the HTTP server:
//
//   node src/worker.js        (prod)
//   nodemon src/worker.js     (dev, via npm run dev:worker)
//
// Initializes only Prisma + the named-job scheduler — never the Express app.
// Graceful shutdown: stop accepting ticks, settle in-flight work, disconnect.
const { prisma } = require('./lib/prisma');
const { startScheduler, stopScheduler } = require('./worker/scheduler');

async function main() {
  await prisma.$queryRaw`SELECT 1`;
  console.log(JSON.stringify({ worker: true, event: 'start' }));
  const state = startScheduler();

  const shutdown = async (signal) => {
    console.log(JSON.stringify({ worker: true, event: 'shutdown', signal }));
    await stopScheduler(state);
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error(JSON.stringify({ worker: true, event: 'fatal', error: (err && err.message) || String(err) }));
    try {
      await prisma.$disconnect();
    } finally {
      process.exit(1);
    }
  });
}

module.exports = { main };
