import {
  createAccountSchema,
  idParamSchema,
  listAccountsQuerySchema,
  updateAccountSchema,
} from '@ledger/shared';

/** Wire contract from `shared/src/dto/accounts.ts` (D7); nothing server-only to add yet. */
export { createAccountSchema, updateAccountSchema, listAccountsQuerySchema, idParamSchema };

export type { CreateAccountInput, UpdateAccountInput } from '@ledger/shared';
