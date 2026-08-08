import http from 'node:http';
import { env } from './config';
import { createApp } from './app';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { initRealtime } from './lib/realtime';
import { startScheduler, stopScheduler } from './lib/scheduler';
import { loadSettings } from './modules/settings/settings.service';

const app = createApp();
const server = http.createServer(app);
initRealtime(server);

server.listen(env.PORT, () => {
  logger.info(`API listening on port ${env.PORT} (${env.NODE_ENV})`);
  // Prime the settings cache (company profile, maintenance flag, booking window)
  // so hot paths read persisted values without a per-request DB hit.
  void loadSettings();
  // Start the periodic maintenance jobs (hold expiry, CRS retry, rebook, dunning).
  startScheduler();
});

async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  stopScheduler();
  server.close(async () => {
    await prisma.$disconnect();
    logger.info('Shutdown complete');
    process.exit(0);
  });

  // Force-exit if graceful shutdown hangs.
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
