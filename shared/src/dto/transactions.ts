import { z } from 'zod';
import { currencySchema, type Currency } from '../currency';
import { txTypeSchema, type TxType } from '../enums';
import { amountInput, decimalString, isoDate, paginationQuerySchema } from './common';

export interface TransactionAccountRef {
  id: string;
  name: string;
  currency: Currency;
  color: string;
  icon: string;
}

export interface TransactionCategoryRef {
  id: string;
  name: string;
  color: string;
  icon: string;
}

export interface TransactionDto {
  id: string;
  type: TxType;

  /**
   * **Signed**, exactly as stored (SPEC §4.7): income positive, expense negative, a
   * transfer's outflow negative and its inflow positive. Display may show a magnitude;
   * this never does.
   */
  amount: string;
  currency: Currency;
  rateToEgp: string;
  /** Signed, and frozen at write time — never recomputed on read (SPEC §4.4). */
  amountEgp: string;
  /** The `asOf` of the rate actually used (D12). */
  rateAsOf: string;
  /**
   * True when `rateAsOf` is later than `date` — the rate post-dates the transaction, so
   * the EGP figure is an approximation. Derived, never stored (D12).
   */
  rateIsApproximate: boolean;

  date: string;
  note: string | null;

  accountId: string;
  account: TransactionAccountRef;
  categoryId: string | null;
  category: TransactionCategoryRef | null;

  /** Shared by the two rows of a transfer; null for everything else. */
  transferGroupId: string | null;
  /** The other side of the transfer, when this row is part of one. */
  transferCounterpart: {
    id: string;
    accountId: string;
    accountName: string;
    amount: string;
    currency: Currency;
  } | null;

  createdAt: string;
  updatedAt: string;
}

const entryShape = {
  amount: amountInput,
  /**
   * Optional. An account is single-currency (D3), so this is derived from the account
   * when omitted — and rejected when supplied and different, which catches a client that
   * has drifted out of step with the account it is posting to.
   */
  currency: currencySchema.optional(),
  accountId: z.string().uuid(),
  categoryId: z.string().uuid().nullable().default(null),
  date: isoDate,
  note: z.string().max(500).nullable().default(null),
};

const createIncomeSchema = z.object({ type: z.literal('INCOME'), ...entryShape });
const createExpenseSchema = z.object({ type: z.literal('EXPENSE'), ...entryShape });

/**
 * A transfer is two rows written together (D2). Both sides are entered because the amount
 * that actually arrives reflects the bank's spread, not the mid-market rate — forcing the
 * app's rate onto the destination would make the balance wrong.
 */
const createTransferSchema = z
  .object({
    type: z.literal('TRANSFER'),
    fromAccountId: z.string().uuid(),
    toAccountId: z.string().uuid(),
    fromAmount: amountInput,
    /**
     * Optional only as a convenience: same-currency transfers mirror `fromAmount`, and a
     * cross-currency one is pre-filled at the current rate. Send it to record what
     * actually landed.
     */
    toAmount: amountInput.optional(),
    date: isoDate,
    note: z.string().max(500).nullable().default(null),
  })
  .refine((value) => value.fromAccountId !== value.toAccountId, {
    message: 'A transfer needs two different accounts.',
    path: ['toAccountId'],
  });

export const createTransactionSchema = z.union([
  createIncomeSchema,
  createExpenseSchema,
  createTransferSchema,
]);

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
export type CreateTransferInput = z.infer<typeof createTransferSchema>;

/**
 * Partial by design, and shared across all three types — which fields are meaningful
 * depends on the row being edited, so the service resolves that once it knows the type.
 *
 * Editing `amount`, `currency` or `date` re-freezes `rateToEgp`, `amountEgp` and
 * `rateAsOf`. Editing a note or category does not (SPEC §4.4).
 */
export const updateTransactionSchema = z
  .object({
    amount: amountInput,
    categoryId: z.string().uuid().nullable(),
    date: isoDate,
    note: z.string().max(500).nullable(),
    /** Transfers only: adjusts the matching side of the pair. */
    fromAmount: amountInput,
    toAmount: amountInput,
  })
  .partial();

export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;

export const listTransactionsQuerySchema = paginationQuerySchema.extend({
  from: isoDate.optional(),
  to: isoDate.optional(),
  type: txTypeSchema.optional(),
  accountId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  currency: currencySchema.optional(),
  /** Case-insensitive substring of the note. Deliberately note-only. */
  q: z.string().min(1).max(200).optional(),
  /**
   * Compared against the **magnitude of `amountEgp`**, so one threshold means the same
   * thing across currencies and across income and expense.
   */
  minAmount: decimalString.optional(),
  maxAmount: decimalString.optional(),
});

export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>;

/**
 * A transfer, seen as one thing. `conversionCostEgp` is what the spread actually took:
 * the difference between what left and what arrived, both at their own frozen rates (D2).
 */
export interface TransferGroupDto {
  transferGroupId: string;
  from: TransactionDto;
  to: TransactionDto;
  isCrossCurrency: boolean;
  /** Positive means the conversion cost money. Null for same-currency transfers. */
  conversionCostEgp: string | null;
}

export interface DeleteTransactionResponse {
  /** Deleting either row of a transfer removes both — they are one movement. */
  deletedIds: string[];
}
