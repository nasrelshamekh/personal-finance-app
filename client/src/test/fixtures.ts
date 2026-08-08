import type {
  AccountDto,
  BudgetMonthDto,
  BudgetRowDto,
  CategoryDto,
  DashboardDto,
  DebtDto,
  DebtPaymentDto,
  FxRatesResponse,
  ResolvedRateDto,
  StoredRateDto,
  SavingsContributionDto,
  SavingsGoalDto,
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

export function debtPayment(overrides: Partial<DebtPaymentDto> & { id: string }): DebtPaymentDto {
  return {
    amount: '500.0000',
    currency: 'EGP',
    rateToDebtCurrency: '1.00000000',
    amountInDebtCurrency: '500.0000',
    rateToEgp: '1.00000000',
    amountEgp: '500.0000',
    rateAsOf: '2026-08-06T00:00:00.000Z',
    rateIsApproximate: false,
    date: '2026-08-06T00:00:00.000Z',
    note: null,
    transactionId: null,
    ...overrides,
  };
}

export function debt(overrides: Partial<DebtDto> & { id: string; counterparty: string }): DebtDto {
  return {
    direction: 'I_OWE',
    principal: '5000.0000',
    currency: 'EGP',
    startDate: '2026-08-01T00:00:00.000Z',
    dueDate: null,
    status: 'ACTIVE',
    note: null,
    paid: '0.0000',
    remaining: '5000.0000',
    progressPct: '0.0000',
    remainingEgp: '5000.0000',
    remainingEgpStale: false,
    daysUntilDue: null,
    isOverdue: false,
    payments: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

export function contribution(
  overrides: Partial<SavingsContributionDto> & { id: string },
): SavingsContributionDto {
  return {
    amount: '1000.0000',
    currency: 'EGP',
    rateToGoalCurrency: '1.00000000',
    amountInGoalCurrency: '1000.0000',
    rateToEgp: '1.00000000',
    amountEgp: '1000.0000',
    rateAsOf: '2026-08-06T00:00:00.000Z',
    rateIsApproximate: false,
    date: '2026-08-06T00:00:00.000Z',
    transactionId: null,
    ...overrides,
  };
}

export function savingsGoal(
  overrides: Partial<SavingsGoalDto> & { id: string; name: string },
): SavingsGoalDto {
  return {
    targetAmount: '60000.0000',
    currency: 'EGP',
    deadline: null,
    color: '#2f8f5b',
    icon: 'piggy-bank',
    isArchived: false,
    saved: '0.0000',
    remaining: '60000.0000',
    progressPct: '0.0000',
    savedEgp: '0.0000',
    isComplete: false,
    monthlyNeeded: null,
    monthsRemaining: null,
    contributions: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * A resolved rate: fresh, direct, one day old. Every field the UI branches on — `stale`,
 * `staleReason`, `derivation`, a negative `ageMs` — is an override away.
 */
export function resolvedRate(overrides: Partial<ResolvedRateDto> = {}): ResolvedRateDto {
  return {
    base: 'USD',
    quote: 'EGP',
    rate: '49.80290000',
    asOf: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    nextUpdateAt: null,
    source: 'API',
    derivation: 'DIRECT',
    stale: false,
    staleReason: null,
    ageMs: 24 * 60 * 60 * 1000,
    ...overrides,
  };
}

export function fxRates(overrides: Partial<FxRatesResponse> = {}): FxRatesResponse {
  return {
    rates: [resolvedRate()],
    autoRefresh: 'FRESH',
    apiEnabled: true,
    apiEolAt: null,
    attribution: { label: 'Exchange Rate API', url: 'https://www.exchangerate-api.com' },
    ...overrides,
  };
}

export function storedRate(overrides: Partial<StoredRateDto> & { id: string }): StoredRateDto {
  return {
    base: 'USD',
    quote: 'EGP',
    rate: '49.80290000',
    asOf: '2026-08-06T00:00:00.000Z',
    nextUpdateAt: null,
    source: 'API',
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
