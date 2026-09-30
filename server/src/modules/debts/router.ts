import { Router } from 'express';
import type { CreateDebtInput, CreateDebtPaymentInput, UpdateDebtInput } from '@ledger/shared';
import type { DebtDirection, DebtStatus } from '@prisma/client';
import { prisma } from '../../prisma';
import { pathId, validate } from '../../middleware/validate';
import { AppError } from '../../lib/errors';
import {
  createDebtPaymentSchema,
  createDebtSchema,
  idAndPaymentIdParamSchema,
  idParamSchema,
  listDebtsQuerySchema,
  updateDebtSchema,
} from './schema';
import {
  addDebtPayment,
  createDebt,
  deleteDebt,
  deleteDebtPayment,
  getDebt,
  listDebts,
  updateDebt,
} from './service';

export const debtsRouter: Router = Router();

debtsRouter.get('/', validate({ query: listDebtsQuerySchema }), async (req, res) => {
  const query = req.query as unknown as { direction?: DebtDirection; status?: DebtStatus };
  res.json({
    data: await listDebts(prisma, {
      ...(query.direction === undefined ? {} : { direction: query.direction }),
      ...(query.status === undefined ? {} : { status: query.status }),
    }),
  });
});

debtsRouter.post('/', validate({ body: createDebtSchema }), async (req, res) => {
  res.status(201).json(await createDebt(prisma, req.body as CreateDebtInput));
});

debtsRouter.get('/:id', validate({ params: idParamSchema }), async (req, res) => {
  res.json(await getDebt(prisma, pathId(req)));
});

debtsRouter.patch(
  '/:id',
  validate({ params: idParamSchema, body: updateDebtSchema }),
  async (req, res) => {
    res.json(await updateDebt(prisma, pathId(req), req.body as UpdateDebtInput));
  },
);

debtsRouter.delete('/:id', validate({ params: idParamSchema }), async (req, res) => {
  res.json(await deleteDebt(prisma, pathId(req)));
});

/** Optionally writes the matching transaction too, atomically (SPEC §7). */
debtsRouter.post(
  '/:id/payments',
  validate({ params: idParamSchema, body: createDebtPaymentSchema }),
  async (req, res) => {
    res
      .status(201)
      .json(await addDebtPayment(prisma, pathId(req), req.body as CreateDebtPaymentInput));
  },
);

debtsRouter.delete(
  '/:id/payments/:paymentId',
  validate({ params: idAndPaymentIdParamSchema }),
  async (req, res) => {
    const paymentId = req.params['paymentId'];
    if (typeof paymentId !== 'string') {
      throw AppError.badRequest('This route needs a payment id in the path.');
    }
    res.json(await deleteDebtPayment(prisma, pathId(req), paymentId));
  },
);
