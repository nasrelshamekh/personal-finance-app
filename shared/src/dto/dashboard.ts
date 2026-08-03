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
  /** Net worth at the end of the selected month, from frozen figures only (D5). */
  egp: string;
  /** The same figure at the end of the previous month. */
  previousEgp: string;
  /** Signed difference. */
  deltaEgp: string;
  /** Signed, 4dp. Null when the previous month was zero — no percentage exists. */
  deltaPct: string | null;
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
