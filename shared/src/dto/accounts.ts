import { z } from 'zod';
import { currencySchema, type Currency } from '../currency';
import { accountTypeSchema, type AccountType } from '../enums';
import { decimalString, hexColor, iconName, isoDate } from './common';

export interface AccountDto {
  id: string;
  name: string;
  type: AccountType;
  currency: Currency;

  /** All 4dp strings. */
  openingBalance: string;
  openingDate: string;
  openingRateToEgp: string;
  openingBalanceEgp: string;

  color: string;
  icon: string;
  isArchived: boolean;
  createdAt: string;

  /** Derived, never stored: openingBalance + the signed sum of this account's rows. */
  balance: string;
  /** Derived from frozen figures: openingBalanceEgp + the signed sum of amountEgp. */
  balanceEgp: string;
  transactionCount: number;

  /**
   * Closing balance for each of the last 30 days, oldest first, in the account's own
   * currency (SPEC §9's sparkline).
   *
   * Starts at the account's opening date rather than always 30 days back, so a week-old
   * account has seven points instead of a fortnight of invented flat history. That also
   * means a brand-new one has a single point, which the sparkline declines to draw — one
   * balance is not a trend.
   */
  balanceHistory: string[];
}

export const createAccountSchema = z.object({
  name: z.string().min(1, 'Give the account a name.').max(80),
  type: accountTypeSchema,
  currency: currencySchema,
  /** Signed: a credit card can legitimately open in the red. */
  openingBalance: decimalString.default('0'),
  /**
   * Defaults to now. The rate at this moment is frozen into `openingRateToEgp`, which is
   * what makes historical net worth a comparison of frozen figures (D5).
   */
  openingDate: isoDate.optional(),
  color: hexColor,
  icon: iconName,
});

export type CreateAccountInput = z.infer<typeof createAccountSchema>;

/**
 * The opening figures are deliberately not editable. They are a frozen historical fact,
 * and letting them move would silently rewrite every past net-worth figure.
 */
export const updateAccountSchema = z
  .object({
    name: z.string().min(1).max(80),
    type: accountTypeSchema,
    color: hexColor,
    icon: iconName,
    isArchived: z.boolean(),
  })
  .partial();

export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;

export const listAccountsQuerySchema = z.object({
  /** Archived accounts are hidden by default but never deleted. */
  includeArchived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export interface DeleteAccountResponse {
  /** `archived` when the account had transactions, `deleted` when it was empty. */
  outcome: 'archived' | 'deleted';
  account: AccountDto;
}
