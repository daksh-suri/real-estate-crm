const app = require('./app');
const config = require('./config');

const server = app.listen(config.port, () => {
  console.log(`[Backend] Real Estate CRM API server running on port ${config.port} (env: ${config.env})`);
});

// Graceful shutdown handling
function handleShutdown(signal) {
  console.log(`[Backend] Received ${signal}. Shutting down gracefully...`);
  server.close(() => {
    console.log('[Backend] HTTP server closed.');
    process.exit(0);
  });

  // Force shutdown after timeout
  setTimeout(() => {
    console.error('[Backend] Forced shutdown after timeout.');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

module.exports = server;
