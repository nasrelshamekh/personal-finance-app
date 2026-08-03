import { Router } from 'express';
import type {
  CreateTransactionInput,
  ListTransactionsQuery,
  UpdateTransactionInput,
} from '@ledger/shared';
import { prisma } from '../../prisma';
import { pathId, validate } from '../../middleware/validate';
import {
  createTransactionSchema,
  idParamSchema,
  listTransactionsQuerySchema,
  updateTransactionSchema,
} from './schema';
import {
  createTransaction,
  deleteTransaction,
  getTransaction,
  getTransferGroup,
  listTransactions,
  updateTransaction,
} from './service';

export const transactionsRouter: Router = Router();

transactionsRouter.get('/', validate({ query: listTransactionsQuerySchema }), async (req, res) => {
  const query = req.query as unknown as ListTransactionsQuery;
  res.json(await listTransactions(prisma, query));
});

/** A TRANSFER body creates the linked pair atomically and returns the group (D2). */
transactionsRouter.post('/', validate({ body: createTransactionSchema }), async (req, res) => {
  const body = req.body as CreateTransactionInput;
  res.status(201).json(await createTransaction(prisma, body));
});

transactionsRouter.get('/:id', validate({ params: idParamSchema }), async (req, res) => {
  res.json(await getTransaction(prisma, pathId(req)));
});

transactionsRouter.patch(
  '/:id',
  validate({ params: idParamSchema, body: updateTransactionSchema }),
  async (req, res) => {
    const body = req.body as UpdateTransactionInput;
    res.json(await updateTransaction(prisma, pathId(req), body));
  },
);

/** Deleting either row of a transfer removes both — it is one movement of money. */
transactionsRouter.delete('/:id', validate({ params: idParamSchema }), async (req, res) => {
  res.json(await deleteTransaction(prisma, pathId(req)));
});

/** A transfer seen as one thing, including what the conversion cost. */
transactionsRouter.get('/transfers/:id', validate({ params: idParamSchema }), async (req, res) => {
  res.json(await getTransferGroup(prisma, pathId(req)));
});
