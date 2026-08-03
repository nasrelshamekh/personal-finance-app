import { Router } from 'express';
import type { DashboardQuery } from '@ledger/shared';
import { prisma } from '../../prisma';
import { validate } from '../../middleware/validate';
import { dashboardQuerySchema } from './schema';
import { getDashboard } from './service';

export const dashboardRouter: Router = Router();

dashboardRouter.get('/', validate({ query: dashboardQuerySchema }), async (req, res) => {
  const query = req.query as unknown as DashboardQuery;
  res.json(await getDashboard(prisma, query.month));
});
