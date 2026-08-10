import { z } from 'zod';
import type { Currency } from '../currency';
import { monthString } from './common';
import type { ResolvedRateDto, AutoRefreshOutcome } from './fx';
import type { TransactionDto } from './transactions';

export const dashboardQuerySchema = z.object({
  /** Defaults to the current month. */
  month: monthString.optional(),
});

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

export interface NetWorthDto {
  /** What the accounts held at the end of the selected month, from frozen figures (D5). */
  egp: string;
  /** The same figure at the end of the previous month. */
  previousEgp: string;
  /** Signed difference. */
  deltaEgp: string;
  /** Signed, 4dp. Null when the previous month was zero — no percentage exists. */
  deltaPct: string | null;

  /**
   * What was still owed at the end of the month, both ways, and the figure that results.
   *
   * `egp` above is what your accounts held, which is not the same claim as what you are
   * worth: a ledger with 5,436 in the bank and a 4,000 debt is not a ledger with 5,436.
   * Both are reported rather than one replacing the other, because they answer different
   * questions and collapsing them into a single number hides one of the answers.
   */
  owedByYouEgp: string;
  owedToYouEgp: string;
  /** `egp - owedByYouEgp + owedToYouEgp`. */
  afterDebtsEgp: string;
  /**
   * True when a debt in another currency had to be converted to reach these figures.
   *
   * A debt lives in its own currency (D4) and its remaining balance has no frozen EGP
   * figure, so converting one uses *today's* rate — which means `afterDebtsEgp` mixes a
   * live rate into an otherwise frozen figure. Flagged rather than hidden; false when
   * every debt is already in pounds, and then the figure is exact.
   */
  debtsConverted: boolean;
}

export interface MonthTotalsDto {
  /** Positive. Transfers are excluded from all three (D2). */
  incomeEgp: string;
  /** Positive magnitude, for display alongside income. */
  expensesEgp: string;
  /** Signed: income minus expenses. */
  netEgp: string;
  /**
   * What converting between currencies cost this month — the gap between what left an
   * account and what arrived in another (D2). Positive means it cost money.
   */
  conversionCostEgp: string;
}

export interface CategorySpendDto {
  categoryId: string | null;
  /** "Uncategorised" when categoryId is null. */
  name: string;
  color: string;
  /** Positive magnitude, EGP. */
  spentEgp: string;
  /** Share of the month's spending, 4dp. */
  sharePct: string;
}

export interface DailySpendDto {
  /** `YYYY-MM-DD`. Every day in the month is present, including zero days. */
  date: string;
  spentEgp: string;
  incomeEgp: string;
}

export interface AccountSummaryDto {
  id: string;
  name: string;
  currency: Currency;
  color: string;
  icon: string;
  balance: string;
  balanceEgp: string;
  /**
   * Archived accounts appear here only while they still hold money.
   *
   * Net worth counts every account — archiving is a decision about a list, not about
   * whose money it is — so hiding one that still holds a balance would make the panel
   * stop adding up to the figure printed above it. An archived account at zero is left
   * out, which keeps the panel clean without changing the total.
   */
  isArchived: boolean;
}

export interface DebtDueDto {
  id: string;
  counterparty: string;
  direction: 'I_OWE' | 'OWED_TO_ME';
  currency: Currency;
  /** In the debt's own currency (D4). */
  remaining: string;
  dueDate: string | null;
  /** Negative when overdue. */
  daysUntilDue: number | null;
}

export interface SavingsProgressDto {
  id: string;
  name: string;
  currency: Currency;
  color: string;
  /** Both in the goal's own currency (D4b). */
  saved: string;
  target: string;
  progressPct: string;
  deadline: string | null;
}

/** Everything the dashboard needs, in one call (SPEC §7). */
export interface DashboardDto {
  /** `YYYY-MM`, echoed back so the client can confirm what it is looking at. */
  month: string;
  netWorth: NetWorthDto;
  totals: MonthTotalsDto;
  spendByCategory: CategorySpendDto[];
  daily: DailySpendDto[];
  recentTransactions: TransactionDto[];
  accounts: AccountSummaryDto[];
  debtsDueSoon: DebtDueDto[];
  savingsGoals: SavingsProgressDto[];
  /** The FX strip, resolved with the same staleness the figures carry. */
  rates: ResolvedRateDto[];
  autoRefresh: AutoRefreshOutcome;
}
