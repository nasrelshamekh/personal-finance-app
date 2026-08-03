import { Router } from 'express';
import type {
  CreateAccountInput,
  UpdateAccountInput,
  listAccountsQuerySchema as ListQuery,
} from '@ledger/shared';
import type { z } from 'zod';
import { prisma } from '../../prisma';
import { pathId, validate } from '../../middleware/validate';
import {
  createAccountSchema,
  idParamSchema,
  listAccountsQuerySchema,
  updateAccountSchema,
} from './schema';
import { createAccount, deleteAccount, getAccount, listAccounts, updateAccount } from './service';

export const accountsRouter: Router = Router();

accountsRouter.get('/', validate({ query: listAccountsQuerySchema }), async (req, res) => {
  const query = req.query as unknown as z.infer<typeof ListQuery>;
  res.json({ data: await listAccounts(prisma, query.includeArchived) });
});

accountsRouter.post('/', validate({ body: createAccountSchema }), async (req, res) => {
  const body = req.body as CreateAccountInput;
  res.status(201).json(await createAccount(prisma, body));
});

accountsRouter.get('/:id', validate({ params: idParamSchema }), async (req, res) => {
  res.json(await getAccount(prisma, pathId(req)));
});

accountsRouter.patch(
  '/:id',
  validate({ params: idParamSchema, body: updateAccountSchema }),
  async (req, res) => {
    const body = req.body as UpdateAccountInput;
    res.json(await updateAccount(prisma, pathId(req), body));
  },
);

/** Archives instead of deleting when the account holds transactions (SPEC §7). */
accountsRouter.delete('/:id', validate({ params: idParamSchema }), async (req, res) => {
  res.json(await deleteAccount(prisma, pathId(req)));
});
