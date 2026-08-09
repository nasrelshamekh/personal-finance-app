import {
  BASE_CURRENCY,
  Decimal,
  FOREIGN_CURRENCIES,
  type AccountSummaryDto,
  type AutoRefreshOutcome,
  type CategorySpendDto,
  type DailySpendDto,
  type DashboardDto,
  type DebtDueDto,
  type MonthTotalsDto,
  type NetWorthDto,
  type SavingsProgressDto,
} from '@ledger/shared';
import { abs, add, div, mul, sub, sum, toStorageString } from '../../lib/money';
import { getRatesToBase, type Db } from '../../lib/fx';
import { ensureFreshRates } from '../fx/service';
import { transactionInclude, transactionsToDtos } from '../transactions/service';

/** Half-open range `[start, end)`, so a transaction at 23:59:59.999 is never lost. */
interface MonthRange {
  key: string;
  start: Date;
  end: Date;
}

export function monthRange(month: string): MonthRange {
  const [yearPart, monthPart] = month.split('-');
  const year = Number(yearPart);
  const index = Number(monthPart) - 1;

  return {
    key: month,
    start: new Date(Date.UTC(year, index, 1)),
    end: new Date(Date.UTC(year, index + 1, 1)),
  };
}

export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Net worth at a moment, from frozen figures only (D5):
 *
 *   Σ accounts [ openingBalanceEgp + Σ amountEgp WHERE date <= at ]
 *
 * Accounts opened after `at` are excluded, so a historical figure describes the accounts
 * that actually existed then. Every term was frozen when it was written, which is what
 * makes "delta vs last month" a real comparison rather than two views of today's rate.
 */
async function netWorthAt(db: Db, at: Date): Promise<Decimal> {
  const [openings, movements] = await Promise.all([
    db.account.aggregate({
      where: { openingDate: { lt: at } },
      _sum: { openingBalanceEgp: true },
    }),
    db.transaction.aggregate({
      where: { date: { lt: at } },
      _sum: { amountEgp: true },
    }),
  ]);

  return add(
    openings._sum.openingBalanceEgp?.toString() ?? '0',
    movements._sum.amountEgp?.toString() ?? '0',
  );
}

async function buildNetWorth(db: Db, range: MonthRange): Promise<NetWorthDto> {
  const [egp, previousEgp] = await Promise.all([
    netWorthAt(db, range.end),
    netWorthAt(db, range.start),
  ]);

  const deltaEgp = sub(egp, previousEgp);

  // A percentage change is only meaningful from a positive baseline. Against zero it does
  // not exist, and against a negative one it is actively misleading — going from -100 to
  // +50 is not "150% growth", and a figure like -2911% on a dashboard is noise pretending
  // to be a measurement. Null, and the UI shows the absolute delta instead.
  const hasMeaningfulBaseline = previousEgp.greaterThan(0);

  return {
    egp: toStorageString(egp),
    previousEgp: toStorageString(previousEgp),
    deltaEgp: toStorageString(deltaEgp),
    deltaPct: hasMeaningfulBaseline
      ? toStorageString(mul(div(deltaEgp, previousEgp), '100'))
      : null,
  };
}

/**
 * What converting cost this month (D2).
 *
 * Computed per group rather than as one aggregate: summing every TRANSFER row would also
 * sweep in a same-currency transfer whose two sides were edited to differ, and that is a
 * correction, not a conversion cost.
 */
async function conversionCost(db: Db, range: MonthRange): Promise<Decimal> {
  const rows = await db.transaction.findMany({
    where: { type: 'TRANSFER', date: { gte: range.start, lt: range.end } },
    select: { transferGroupId: true, currency: true, amountEgp: true },
  });

  const groups = new Map<string, Array<{ currency: string; amountEgp: string }>>();
  for (const row of rows) {
    if (row.transferGroupId === null) continue;
    const members = groups.get(row.transferGroupId) ?? [];
    members.push({ currency: row.currency, amountEgp: row.amountEgp.toString() });
    groups.set(row.transferGroupId, members);
  }

  let total = new Decimal(0);
  for (const members of groups.values()) {
    const [first, second] = members;
    if (members.length !== 2 || !first || !second) continue;
    if (first.currency === second.currency) continue;

    const outflow = first.amountEgp.startsWith('-') ? first : second;
    const inflow = outflow === first ? second : first;
    total = total.plus(sub(abs(outflow.amountEgp), inflow.amountEgp));
  }

  return total;
}

async function buildTotals(db: Db, range: MonthRange): Promise<MonthTotalsDto> {
  const window = { date: { gte: range.start, lt: range.end } };

  // TRANSFER rows are excluded from every income/expense aggregate (D2) — they move money
  // between accounts without earning or spending any of it.
  const [income, expense, cost] = await Promise.all([
    db.transaction.aggregate({ where: { ...window, type: 'INCOME' }, _sum: { amountEgp: true } }),
    db.transaction.aggregate({ where: { ...window, type: 'EXPENSE' }, _sum: { amountEgp: true } }),
    conversionCost(db, range),
  ]);

  const incomeEgp = add(income._sum.amountEgp?.toString() ?? '0', '0');
  // Expenses are stored negative; display wants the magnitude beside income.
  const expensesEgp = abs(expense._sum.amountEgp?.toString() ?? '0');

  return {
    incomeEgp: toStorageString(incomeEgp),
    expensesEgp: toStorageString(expensesEgp),
    netEgp: toStorageString(sub(incomeEgp, expensesEgp)),
    conversionCostEgp: toStorageString(cost),
  };
}

async function buildSpendByCategory(db: Db, range: MonthRange): Promise<CategorySpendDto[]> {
  const grouped = await db.transaction.groupBy({
    by: ['categoryId'],
    where: { type: 'EXPENSE', date: { gte: range.start, lt: range.end } },
    _sum: { amountEgp: true },
  });

  const ids = grouped.map((row) => row.categoryId).filter((id): id is string => id !== null);

  const categories = await db.category.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, color: true },
  });
  const byId = new Map(categories.map((category) => [category.id, category]));

  const entries = grouped.map((row) => {
    const category = row.categoryId === null ? undefined : byId.get(row.categoryId);
    return {
      categoryId: row.categoryId,
      name: category?.name ?? 'Uncategorised',
      color: category?.color ?? '#6f6f6f',
      spent: abs(row._sum.amountEgp?.toString() ?? '0'),
    };
  });

  const total = sum(entries.map((entry) => entry.spent));

  return entries
    .sort((a, b) => b.spent.comparedTo(a.spent))
    .map((entry) => ({
      categoryId: entry.categoryId,
      name: entry.name,
      color: entry.color,
      spentEgp: toStorageString(entry.spent),
      sharePct: total.isZero() ? '0.0000' : toStorageString(mul(div(entry.spent, total), '100')),
    }));
}

/** Every day in the month, including the empty ones, so the bar chart has no gaps. */
async function buildDaily(db: Db, range: MonthRange): Promise<DailySpendDto[]> {
  const rows = await db.transaction.findMany({
    where: {
      type: { in: ['INCOME', 'EXPENSE'] },
      date: { gte: range.start, lt: range.end },
    },
    select: { date: true, amountEgp: true, type: true },
  });

  const byDay = new Map<string, { spent: Decimal; income: Decimal }>();
  for (const row of rows) {
    const key = row.date.toISOString().slice(0, 10);
    const bucket = byDay.get(key) ?? { spent: new Decimal(0), income: new Decimal(0) };
    if (row.type === 'EXPENSE') {
      bucket.spent = bucket.spent.plus(abs(row.amountEgp.toString()));
    } else {
      bucket.income = bucket.income.plus(row.amountEgp.toString());
    }
    byDay.set(key, bucket);
  }

  const days: DailySpendDto[] = [];
  for (
    let cursor = new Date(range.start);
    cursor < range.end;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    const key = cursor.toISOString().slice(0, 10);
    const bucket = byDay.get(key);
    days.push({
      date: key,
      spentEgp: toStorageString(bucket?.spent ?? '0'),
      incomeEgp: toStorageString(bucket?.income ?? '0'),
    });
  }

  return days;
}

/**
 * The accounts as they stood at the end of the month being read, not as they stand now.
 *
 * Deliberately the same two terms as `netWorthAt`, and in the same order: an account that
 * did not exist yet is excluded, and every movement after the month is ignored. That is
 * what makes the panel add up to the net-worth figure printed above it. Reading July and
 * being shown today's balances next to a net worth of zero was the bug — three panels
 * describing three different moments, each of them individually correct.
 */
async function buildAccounts(db: Db, range: MonthRange): Promise<AccountSummaryDto[]> {
  const accounts = await db.account.findMany({
    where: { isArchived: false, openingDate: { lt: range.end } },
    orderBy: { createdAt: 'asc' },
  });

  if (accounts.length === 0) return [];

  const movements = await db.transaction.groupBy({
    by: ['accountId'],
    where: { accountId: { in: accounts.map((account) => account.id) }, date: { lt: range.end } },
    _sum: { amount: true, amountEgp: true },
  });

  const byAccount = new Map(
    movements.map((row) => [
      row.accountId,
      {
        amount: row._sum.amount?.toString() ?? '0',
        amountEgp: row._sum.amountEgp?.toString() ?? '0',
      },
    ]),
  );

  return accounts.map((account) => {
    const moved = byAccount.get(account.id) ?? { amount: '0', amountEgp: '0' };

    return {
      id: account.id,
      name: account.name,
      currency: account.currency,
      color: account.color,
      icon: account.icon,
      // A plain sum: amounts carry their own sign (SPEC §4.7).
      balance: toStorageString(add(account.openingBalance.toString(), moved.amount)),
      balanceEgp: toStorageString(add(account.openingBalanceEgp.toString(), moved.amountEgp)),
    };
  });
}

async function buildDebtsDueSoon(db: Db, now: Date): Promise<DebtDueDto[]> {
  const horizon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const debts = await db.debt.findMany({
    where: { status: 'ACTIVE', dueDate: { not: null, lte: horizon } },
    include: { payments: { select: { amountInDebtCurrency: true } } },
    orderBy: { dueDate: 'asc' },
  });

  return debts.map((debt) => {
    // Remaining lives in the debt's own currency (D4) — never a current-rate principal
    // less historical-rate payments.
    const paid = sum(debt.payments.map((payment) => payment.amountInDebtCurrency.toString()));

    return {
      id: debt.id,
      counterparty: debt.counterparty,
      direction: debt.direction,
      currency: debt.currency,
      remaining: toStorageString(sub(debt.principal.toString(), paid)),
      dueDate: debt.dueDate?.toISOString() ?? null,
      daysUntilDue:
        debt.dueDate === null
          ? null
          : Math.ceil((debt.dueDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
    };
  });
}

async function buildSavings(db: Db): Promise<SavingsProgressDto[]> {
  const goals = await db.savingsGoal.findMany({
    where: { isArchived: false },
    include: { contributions: { select: { amountInGoalCurrency: true } } },
    orderBy: { createdAt: 'asc' },
  });

  return goals.map((goal) => {
    // Progress is computed in the goal's currency (D4b), never by dividing
    // historical-rate contributions by a current-rate target.
    const saved = sum(goal.contributions.map((c) => c.amountInGoalCurrency.toString()));
    const target = new Decimal(goal.targetAmount.toString());

    return {
      id: goal.id,
      name: goal.name,
      currency: goal.currency,
      color: goal.color,
      saved: toStorageString(saved),
      target: toStorageString(target),
      progressPct: target.isZero() ? '0.0000' : toStorageString(mul(div(saved, target), '100')),
      deadline: goal.deadline?.toISOString() ?? null,
    };
  });
}

/** Everything the dashboard needs, in one call (SPEC §7). */
export async function getDashboard(
  db: Db,
  month: string | undefined,
  now: Date = new Date(),
): Promise<DashboardDto> {
  const range = monthRange(month ?? currentMonthKey(now));

  // Tops rates up before reading, so opening the dashboard is enough to keep the FX
  // strip and every conversion current without a button press (D12).
  const autoRefresh: AutoRefreshOutcome = await ensureFreshRates(db, now);

  const [netWorth, totals, spendByCategory, daily, accounts, debtsDueSoon, savingsGoals, rates] =
    await Promise.all([
      buildNetWorth(db, range),
      buildTotals(db, range),
      buildSpendByCategory(db, range),
      buildDaily(db, range),
      buildAccounts(db, range),
      buildDebtsDueSoon(db, now),
      buildSavings(db),
      getRatesToBase(db, FOREIGN_CURRENCIES, now),
    ]);

  // Scoped to the month like everything else on the screen. Unscoped, reading July listed
  // August's rows under a July heading — and "recent" under a month picker can only
  // sensibly mean recent *in that month*.
  const recentRows = await db.transaction.findMany({
    where: { date: { gte: range.start, lt: range.end } },
    include: transactionInclude,
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    take: 6,
  });

  return {
    month: range.key,
    netWorth,
    totals,
    spendByCategory,
    daily,
    recentTransactions: await transactionsToDtos(db, recentRows),
    accounts,
    debtsDueSoon,
    savingsGoals,
    rates: rates.map((rate) => ({
      base: rate.base,
      quote: rate.quote,
      rate: rate.rate,
      asOf: rate.asOf.toISOString(),
      nextUpdateAt: rate.nextUpdateAt?.toISOString() ?? null,
      source: rate.source,
      derivation: rate.derivation,
      stale: rate.stale,
      staleReason: rate.staleReason,
      ageMs: rate.ageMs,
    })),
    autoRefresh,
  };
}

export { BASE_CURRENCY };
