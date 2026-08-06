import {
  createDebtPaymentSchema,
  createDebtSchema,
  idParamSchema,
  listDebtsQuerySchema,
  updateDebtSchema,
} from '@ledger/shared';

export {
  createDebtSchema,
  updateDebtSchema,
  createDebtPaymentSchema,
  listDebtsQuerySchema,
  idParamSchema,
};

export type { CreateDebtInput, UpdateDebtInput, CreateDebtPaymentInput } from '@ledger/shared';
