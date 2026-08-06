import { z } from 'zod';
import { currencySchema, type Currency } from '../currency';
import {
  debtDirectionSchema,
  debtStatusSchema,
  type DebtDirection,
  type DebtStatus,
} from '../enums';
import { amountInput, isoDate } from './common';

export interface DebtPaymentDto {
  id: string;
  /** As entered, in the currency it was paid in. Always positive — it reduces the debt. */
  amount: string;
  currency: Currency;
  /** Exactly 1 when the payment was made in the debt's own currency. */
  rateToDebtCurrency: string;
  amountInDebtCurrency: string;
  rateToEgp: string;
  amountEgp: string;
  rateAsOf: string;
  /** True when the rate used post-dates the payment (D12). */
  rateIsApproximate: boolean;
  date: string;
  note: string | null;
  /** Set when the payment also recorded money actually leaving or entering an account. */
  transactionId: string | null;
}

export interface DebtDto {
  id: string;
  counterparty: string;
  direction: DebtDirection;
  principal: string;
  currency: Currency;
  startDate: string;
  dueDate: string | null;
  status: DebtStatus;
  note: string | null;

  /**
   * All three in the **debt's own currency** (D4) — never a current-rate principal less
   * historical-rate payments.
   */
  paid: string;
  remaining: string;
  progressPct: string;

  /** Display-only conversion at today's rate, and stale-able like any live figure. */
  remainingEgp: string;
  /** True when the rate behind `remainingEgp` is out of date. */
  remainingEgpStale: boolean;

  /** Negative when overdue. Null when the debt has no due date. */
  daysUntilDue: number | null;
  isOverdue: boolean;

  payments: DebtPaymentDto[];
  createdAt: string;
}

export const createDebtSchema = z.object({
  counterparty: z.string().min(1, 'Who is this with?').max(80),
  direction: debtDirectionSchema,
  principal: amountInput,
  currency: currencySchema,
  startDate: isoDate,
  dueDate: isoDate.nullable().default(null),
  note: z.string().max(500).nullable().default(null),
});

export type CreateDebtInput = z.infer<typeof createDebtSchema>;

export const updateDebtSchema = z
  .object({
    counterparty: z.string().min(1).max(80),
    principal: amountInput,
    startDate: isoDate,
    dueDate: isoDate.nullable(),
    status: debtStatusSchema,
    note: z.string().max(500).nullable(),
  })
  .partial();

export type UpdateDebtInput = z.infer<typeof updateDebtSchema>;

/**
 * Logging a payment (SPEC §7).
 *
 * Supplying `accountId` also writes the matching transaction, atomically: paying down
 * something you owe is money leaving that account, and being repaid is money arriving.
 * Leave it out to record the payment without touching a balance — useful for a debt
 * settled in cash you never tracked.
 */
export const createDebtPaymentSchema = z.object({
  amount: amountInput,
  currency: currencySchema.optional(),
  date: isoDate,
  note: z.string().max(500).nullable().default(null),
  accountId: z.string().uuid().nullable().default(null),
});

export type CreateDebtPaymentInput = z.infer<typeof createDebtPaymentSchema>;

export const listDebtsQuerySchema = z.object({
  direction: debtDirectionSchema.optional(),
  status: debtStatusSchema.optional(),
});
