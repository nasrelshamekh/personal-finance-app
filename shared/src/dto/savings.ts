import { z } from 'zod';
import { currencySchema, type Currency } from '../currency';
import { amountInput, hexColor, iconName, isoDate } from './common';

export interface SavingsContributionDto {
  id: string;
  amount: string;
  currency: Currency;
  /** Exactly 1 when contributed in the goal's own currency. */
  rateToGoalCurrency: string;
  amountInGoalCurrency: string;
  rateToEgp: string;
  amountEgp: string;
  rateAsOf: string;
  rateIsApproximate: boolean;
  date: string;
  transactionId: string | null;
}

export interface SavingsGoalDto {
  id: string;
  name: string;
  targetAmount: string;
  currency: Currency;
  deadline: string | null;
  color: string;
  icon: string;
  isArchived: boolean;

  /**
   * Progress lives in the **goal's own currency** (D4b) — dividing historical-rate
   * contributions by a current-rate target would be the same incoherence D4 removed
   * from debts.
   */
  saved: string;
  remaining: string;
  progressPct: string;

  /** Display-only conversion at today's rate. */
  savedEgp: string;

  /**
   * What you need to put aside each month to arrive on time, in the goal's currency.
   * Null when there is no deadline; zero once the target is reached.
   */
  monthlyNeeded: string | null;
  /** Whole months left, floored at zero. Null without a deadline. */
  monthsRemaining: number | null;
  isComplete: boolean;

  contributions: SavingsContributionDto[];
  createdAt: string;
}

export const createSavingsGoalSchema = z.object({
  name: z.string().min(1, 'Give the goal a name.').max(80),
  targetAmount: amountInput,
  currency: currencySchema,
  deadline: isoDate.nullable().default(null),
  color: hexColor,
  icon: iconName,
});

export type CreateSavingsGoalInput = z.infer<typeof createSavingsGoalSchema>;

export const updateSavingsGoalSchema = z
  .object({
    name: z.string().min(1).max(80),
    targetAmount: amountInput,
    deadline: isoDate.nullable(),
    color: hexColor,
    icon: iconName,
    isArchived: z.boolean(),
  })
  .partial();

export type UpdateSavingsGoalInput = z.infer<typeof updateSavingsGoalSchema>;

/** `accountId` also writes the matching transaction, exactly as for a debt payment. */
export const createContributionSchema = z.object({
  amount: amountInput,
  currency: currencySchema.optional(),
  date: isoDate,
  accountId: z.string().uuid().nullable().default(null),
});

export type CreateContributionInput = z.infer<typeof createContributionSchema>;

export const listSavingsQuerySchema = z.object({
  includeArchived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});
