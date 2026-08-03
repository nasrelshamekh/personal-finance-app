import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';

const startedAt = Date.now();

export interface CreateAppOptions {
  corsOrigins: string[];
}

/**
 * Builds the Express app without binding a port, so tests can drive it through supertest.
 *
 * Express 5 note (SPEC §7): async handlers propagate rejections to the error middleware
 * automatically. Do not wrap handlers in an asyncHandler helper.
 */
export function createApp({ corsOrigins }: CreateAppOptions): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: corsOrigins, credentials: false }));
  app.use(express.json({ limit: '8mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      uptimeSeconds: (Date.now() - startedAt) / 1000,
      timestamp: new Date().toISOString(),
    });
  });

  return app;
}
