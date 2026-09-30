import {
  createDebtPaymentSchema,
  createDebtSchema,
  idAndPaymentIdParamSchema,
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
  idAndPaymentIdParamSchema,
};

export type { CreateDebtInput, UpdateDebtInput, CreateDebtPaymentInput } from '@ledger/shared';
