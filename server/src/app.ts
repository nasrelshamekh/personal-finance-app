import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { logger } from './logger';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { fxRouter } from './modules/fx/router';
import { accountsRouter } from './modules/accounts/router';
import { categoriesRouter } from './modules/categories/router';
import { transactionsRouter } from './modules/transactions/router';
import { dashboardRouter } from './modules/dashboard/router';
import { settingsRouter } from './modules/settings/router';
import { debtsRouter } from './modules/debts/router';
import { savingsRouter } from './modules/savings/router';
import { budgetsRouter } from './modules/budgets/router';
import { backupRouter } from './modules/backup/router';

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

  app.use('/api/fx', fxRouter);
  app.use('/api/accounts', accountsRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/transactions', transactionsRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/debts', debtsRouter);
  app.use('/api/savings-goals', savingsRouter);
  app.use('/api/budgets', budgetsRouter);
  // Mounted at the root of /api because SPEC §7 puts export, import and reset there
  // rather than under a resource of their own — they act on the whole database.
  app.use('/api', backupRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
