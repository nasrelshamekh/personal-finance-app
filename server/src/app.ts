import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { logger } from './logger';
import { errorHandler, notFoundHandler } from './middleware/error-handler';

const startedAt = Date.now();

export interface CreateAppOptions {
  corsOrigins: string[];
  /** Off in tests, where per-request logs are noise. */
  requestLogging?: boolean;
}

/**
 * Builds the Express app without binding a port, so supertest can drive it directly.
 *
 * Express 5 note (SPEC §7): async handlers propagate rejections to the error middleware
 * automatically. Do not wrap handlers in an asyncHandler helper.
 */
export function createApp({ corsOrigins, requestLogging = true }: CreateAppOptions): Express {
  const app = express();

  app.disable('x-powered-by');

  if (requestLogging) {
    app.use(
      pinoHttp({
        logger,
        // Health checks are polled constantly and would drown the log.
        autoLogging: { ignore: (req) => req.url === '/api/health' },
      }),
    );
  }

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

  // Routers land here in Phase 2 and Phase 3.

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
