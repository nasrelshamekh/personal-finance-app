import type {
  AccountDto,
  BudgetMonthDto,
  BudgetRowDto,
  CategoryDto,
  DashboardDto,
  TransactionDto,
} from '@ledger/shared';

/**
 * Builders for the DTOs the client reads.
 *
 * Every one takes overrides and fills the rest with something plausible, so a test states
 * only the fields it is actually about — a dashboard test asserting on net worth should
 * not have to invent forty unrelated figures to compile.
 *
 * Money is written the way the API writes it: 4dp strings for amounts, 8dp for rates.
 */

export function account(overrides: Partial<AccountDto> & { id: string; name: string }): AccountDto {
  return {
    type: 'CASH',
    currency: 'EGP',
    openingBalance: '0.0000',
    openingDate: '2026-08-01T00:00:00.000Z',
    openingRateToEgp: '1.00000000',
    openingBalanceEgp: '0.0000',
    color: '#2f8f5b',
    icon: 'wallet',
    isArchived: false,
    createdAt: '2026-08-01T00:00:00.000Z',
    balance: '0.0000',
    balanceEgp: '0.0000',
    transactionCount: 0,
    ...overrides,
  };
}

export function category(
  overrides: Partial<CategoryDto> & { id: string; name: string },
): CategoryDto {
  return {
    kind: 'EXPENSE',
    color: '#b4553f',
    icon: 'tag',
    parentId: null,
    isArchived: false,
    children: [],
    transactionCount: 0,
    ...overrides,
  };
}

export function transaction(overrides: Partial<TransactionDto> & { id: string }): TransactionDto {
  return {
    type: 'EXPENSE',
    amount: '-100.0000',
    currency: 'EGP',
    rateToEgp: '1.00000000',
    amountEgp: '-100.0000',
    rateAsOf: '2026-08-06T00:00:00.000Z',
    rateIsApproximate: false,
    date: '2026-08-06T00:00:00.000Z',
    note: null,
    accountId: 'acc-egp',
    account: {
      id: 'acc-egp',
      name: 'Cash (EGP)',
      currency: 'EGP',
      color: '#2f8f5b',
      icon: 'wallet',
    },
    categoryId: null,
    category: null,
    transferGroupId: null,
    transferCounterpart: null,
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:00.000Z',
    ...overrides,
  };
}

/** A month with nothing in it — the shape, with every figure at zero. */
export function dashboard(overrides: Partial<DashboardDto> = {}): DashboardDto {
  return {
    month: '2026-08',
    netWorth: { egp: '0.0000', previousEgp: '0.0000', deltaEgp: '0.0000', deltaPct: null },
    totals: {
      incomeEgp: '0.0000',
      expensesEgp: '0.0000',
      netEgp: '0.0000',
      conversionCostEgp: '0.0000',
    },
    spendByCategory: [],
    daily: [],
    recentTransactions: [],
    accounts: [],
    debtsDueSoon: [],
    savingsGoals: [],
    rates: [],
    autoRefresh: 'FRESH',
    ...overrides,
  };
}

export function budgetRow(
  overrides: Partial<BudgetRowDto> & { categoryId: string; categoryName: string },
): BudgetRowDto {
  return {
    color: '#b4553f',
    icon: 'tag',
    limitEgp: null,
    spentEgp: '0.0000',
    remainingEgp: null,
    usagePct: null,
    isOverBudget: false,
    ...overrides,
  };
}

export function budgetMonth(overrides: Partial<BudgetMonthDto> = {}): BudgetMonthDto {
  return {
    month: '2026-08',
    rows: [],
    totalLimitEgp: '0.0000',
    totalSpentEgp: '0.0000',
    totalRemainingEgp: '0.0000',
    ...overrides,
  };
}
