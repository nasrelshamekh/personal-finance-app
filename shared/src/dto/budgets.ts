import { z } from 'zod';
import { decimalString, monthString } from './common';

/**
 * One row per expense category for the selected month, whether or not a limit is set —
 * a category you have not budgeted is exactly the thing you want to notice.
 */
export interface BudgetRowDto {
  categoryId: string;
  categoryName: string;
  color: string;
  icon: string;
  /** Null when no limit has been set for this category this month. */
  limitEgp: string | null;
  /** Positive magnitude of what was spent, EGP. Transfers excluded (D2). */
  spentEgp: string;
  /** Signed: negative once you are over. Null without a limit. */
  remainingEgp: string | null;
  /** Null without a limit. Can exceed 100. */
  usagePct: string | null;
  isOverBudget: boolean;
}

export interface BudgetMonthDto {
  /** `YYYY-MM`. */
  month: string;
  rows: BudgetRowDto[];
  /** Totals across every category that has a limit. */
  totalLimitEgp: string;
  totalSpentEgp: string;
  totalRemainingEgp: string;
  /**
   * What the totals above cannot see: spending in the month that falls outside every
   * budgeted category, either because its category has no limit or because it has no
   * category at all.
   *
   * Without it the screen is quietly reassuring on a real ledger — "spent 100, 1,700
   * left" is true of the budgets and false of the month, and early on the uncategorised
   * pile is usually the larger figure by an order of magnitude.
   */
  unbudgetedSpentEgp: string;
  /** The part of `unbudgetedSpentEgp` with no category at all, and the actionable part. */
  uncategorisedSpentEgp: string;
}

export const budgetMonthQuerySchema = z.object({
  month: monthString.optional(),
});

/**
 * A bulk upsert of the whole month (SPEC §7). A row with a null limit clears that
 * category's budget rather than storing a zero, because "no budget" and "budget of
 * nothing" are different statements.
 */
export const putBudgetsSchema = z.object({
  month: monthString,
  budgets: z
    .array(
      z.object({
        categoryId: z.string().uuid(),
        limitEgp: decimalString.nullable(),
      }),
    )
    .max(200),
});

export type PutBudgetsInput = z.infer<typeof putBudgetsSchema>;

export const copyBudgetsSchema = z.object({
  fromMonth: monthString,
  toMonth: monthString,
  /** When false, categories that already have a limit in `toMonth` are left alone. */
  overwrite: z.boolean().default(false),
});

export type CopyBudgetsInput = z.infer<typeof copyBudgetsSchema>;

export interface CopyBudgetsResponse {
  copied: number;
  skipped: number;
  month: BudgetMonthDto;
}
