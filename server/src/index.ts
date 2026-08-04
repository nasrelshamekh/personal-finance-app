import { createApp } from './app';
import { env } from './env';
import { logger } from './logger';
import { prisma } from './prisma';

const app = createApp({ corsOrigins: env.CORS_ORIGINS });

const server = app.listen(env.API_PORT, () => {
  logger.info(
    { port: env.API_PORT, corsOrigins: env.CORS_ORIGINS, nodeEnv: env.NODE_ENV },
    'Ledger EG API listening',
  );
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info({ signal }, 'Shutting down');
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });
  });
}
