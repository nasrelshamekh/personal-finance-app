import { Router } from 'express';
import type { CopyBudgetsInput, PutBudgetsInput } from '@ledger/shared';
import { prisma } from '../../prisma';
import { validate } from '../../middleware/validate';
import { budgetMonthQuerySchema, copyBudgetsSchema, putBudgetsSchema } from './schema';
import { copyBudgets, getBudgetMonth, putBudgets } from './service';

export const budgetsRouter: Router = Router();

budgetsRouter.get('/', validate({ query: budgetMonthQuerySchema }), async (req, res) => {
  const query = req.query as unknown as { month?: string };
  res.json(await getBudgetMonth(prisma, query.month));
});

/** A bulk upsert of the whole month, not a single row (SPEC §7). */
budgetsRouter.put('/', validate({ body: putBudgetsSchema }), async (req, res) => {
  const body = req.body as PutBudgetsInput;
  res.json(await putBudgets(prisma, body.month, body.budgets));
});

budgetsRouter.post('/copy', validate({ body: copyBudgetsSchema }), async (req, res) => {
  const body = req.body as CopyBudgetsInput;
  res.json(await copyBudgets(prisma, body.fromMonth, body.toMonth, body.overwrite));
});
