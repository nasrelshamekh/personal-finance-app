import { Router } from 'express';
import type {
  CreateContributionInput,
  CreateSavingsGoalInput,
  UpdateSavingsGoalInput,
} from '@ledger/shared';
import { prisma } from '../../prisma';
import { pathId, validate } from '../../middleware/validate';
import { AppError } from '../../lib/errors';
import {
  createContributionSchema,
  createSavingsGoalSchema,
  idAndContributionIdParamSchema,
  idParamSchema,
  listSavingsQuerySchema,
  updateSavingsGoalSchema,
} from './schema';
import {
  addContribution,
  createGoal,
  deleteContribution,
  deleteGoal,
  getGoal,
  listGoals,
  updateGoal,
} from './service';

export const savingsRouter: Router = Router();

savingsRouter.get('/', validate({ query: listSavingsQuerySchema }), async (req, res) => {
  const query = req.query as unknown as { includeArchived: boolean };
  res.json({ data: await listGoals(prisma, query.includeArchived) });
});

savingsRouter.post('/', validate({ body: createSavingsGoalSchema }), async (req, res) => {
  res.status(201).json(await createGoal(prisma, req.body as CreateSavingsGoalInput));
});

savingsRouter.get('/:id', validate({ params: idParamSchema }), async (req, res) => {
  res.json(await getGoal(prisma, pathId(req)));
});

savingsRouter.patch(
  '/:id',
  validate({ params: idParamSchema, body: updateSavingsGoalSchema }),
  async (req, res) => {
    res.json(await updateGoal(prisma, pathId(req), req.body as UpdateSavingsGoalInput));
  },
);

savingsRouter.delete('/:id', validate({ params: idParamSchema }), async (req, res) => {
  res.json(await deleteGoal(prisma, pathId(req)));
});

savingsRouter.post(
  '/:id/contributions',
  validate({ params: idParamSchema, body: createContributionSchema }),
  async (req, res) => {
    res
      .status(201)
      .json(await addContribution(prisma, pathId(req), req.body as CreateContributionInput));
  },
);

savingsRouter.delete(
  '/:id/contributions/:contributionId',
  validate({ params: idAndContributionIdParamSchema }),
  async (req, res) => {
    const contributionId = req.params['contributionId'];
    if (typeof contributionId !== 'string') {
      throw AppError.badRequest('This route needs a contribution id in the path.');
    }
    res.json(await deleteContribution(prisma, pathId(req), contributionId));
  },
);
