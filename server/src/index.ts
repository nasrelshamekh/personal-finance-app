import { createApp } from './app';
import { logger } from './logger';

const port = Number(process.env.PORT ?? 4000);
const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const app = createApp({ corsOrigins });

const server = app.listen(port, () => {
  logger.info({ port, corsOrigins }, 'Ledger EG API listening');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info({ signal }, 'Shutting down');
    server.close(() => process.exit(0));
  });
}
