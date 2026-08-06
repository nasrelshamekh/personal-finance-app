import {
  Decimal,
  type BudgetMonthDto,
  type BudgetRowDto,
  type CopyBudgetsResponse,
} from '@ledger/shared';
import { AppError } from '../../lib/errors';
import { abs, div, mul, sub, sum, toStorageString } from '../../lib/money';
import type { Db } from '../../lib/fx';
import { inTransaction } from '../../lib/tx';
import { currentMonthKey, monthRange } from '../dashboard/service';

/**
 * Budgets are EGP-only by design (SPEC §5): budgets control spending, and spending
 * happens in pounds. A multi-currency budget would need a rate policy that adds nothing.
 */

/** The first instant of the month, which is how a Budget row is keyed. */
function monthStart(month: string): Date {
  return monthRange(month).start;
}

export async function getBudgetMonth(db: Db, month?: string): Promise<BudgetMonthDto> {
  const key = month ?? currentMonthKey();
  const range = monthRange(key);

  const [categories, budgets, spendRows] = await Promise.all([
    // Only expense categories: you do not budget your salary.
    db.category.findMany({
      where: { kind: 'EXPENSE', isArchived: false },
      orderBy: [{ parentId: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }],
    }),
    db.budget.findMany({ where: { month: range.start } }),
    db.transaction.groupBy({
      by: ['categoryId'],
      where: { type: 'EXPENSE', date: { gte: range.start, lt: range.end } },
      _sum: { amountEgp: true },
    }),
  ]);

  const limitByCategory = new Map(budgets.map((b) => [b.categoryId, b.limitEgp.toString()]));
  const spentByCategory = new Map(
    spendRows
      .filter((row): row is typeof row & { categoryId: string } => row.categoryId !== null)
      // Expenses are stored negative; a budget is spoken about as a positive amount.
      .map((row) => [row.categoryId, abs(row._sum.amountEgp?.toString() ?? '0')]),
  );

  const rows: BudgetRowDto[] = categories.map((category) => {
    const limitRaw = limitByCategory.get(category.id);
    const spent = spentByCategory.get(category.id) ?? new Decimal(0);

    if (limitRaw === undefined) {
      return {
        categoryId: category.id,
        categoryName: category.name,
        color: category.color,
        icon: category.icon,
        limitEgp: null,
        spentEgp: toStorageString(spent),
        remainingEgp: null,
        usagePct: null,
        isOverBudget: false,
      };
    }

    const limit = new Decimal(limitRaw);
    const remaining = sub(limit, spent);

    return {
      categoryId: category.id,
      categoryName: category.name,
      color: category.color,
      icon: category.icon,
      limitEgp: toStorageString(limit),
      spentEgp: toStorageString(spent),
      remainingEgp: toStorageString(remaining),
      usagePct: limit.isZero() ? '0.0000' : toStorageString(mul(div(spent, limit), '100')),
      isOverBudget: remaining.isNegative(),
    };
  });

  const budgeted = rows.filter((row) => row.limitEgp !== null);
  const totalLimit = sum(budgeted.map((row) => row.limitEgp ?? '0'));
  const totalSpent = sum(budgeted.map((row) => row.spentEgp));

  return {
    month: key,
    rows,
    totalLimitEgp: toStorageString(totalLimit),
    totalSpentEgp: toStorageString(totalSpent),
    totalRemainingEgp: toStorageString(sub(totalLimit, totalSpent)),
  };
}

/**
 * Bulk upsert of a whole month (SPEC §7).
 *
 * A null limit **deletes** the row rather than storing zero: "no budget for this
 * category" and "a budget of nothing" are different statements, and only one of them
 * should paint a category red the moment you spend a pound.
 */
export async function putBudgets(
  db: Db,
  month: string,
  budgets: Array<{ categoryId: string; limitEgp: string | null }>,
): Promise<BudgetMonthDto> {
  const start = monthStart(month);
  const categoryIds = budgets.map((budget) => budget.categoryId);

  const known = await db.category.findMany({
    where: { id: { in: categoryIds } },
    select: { id: true, kind: true },
  });
  const knownById = new Map(known.map((category) => [category.id, category]));

  for (const budget of budgets) {
    const category = knownById.get(budget.categoryId);
    if (category === undefined) {
      throw AppError.unprocessable('That category does not exist.', {
        field: 'categoryId',
        categoryId: budget.categoryId,
      });
    }
    if (category.kind !== 'EXPENSE') {
      throw AppError.unprocessable('Only expense categories can be budgeted.', {
        field: 'categoryId',
        categoryId: budget.categoryId,
      });
    }
    if (budget.limitEgp !== null && new Decimal(budget.limitEgp).isNegative()) {
      throw AppError.unprocessable('A budget cannot be negative.', {
        field: 'limitEgp',
        categoryId: budget.categoryId,
      });
    }
  }

  await inTransaction(db, async (tx) => {
    for (const budget of budgets) {
      if (budget.limitEgp === null) {
        await tx.budget.deleteMany({ where: { categoryId: budget.categoryId, month: start } });
        continue;
      }

      await tx.budget.upsert({
        where: { categoryId_month: { categoryId: budget.categoryId, month: start } },
        create: {
          categoryId: budget.categoryId,
          month: start,
          limitEgp: toStorageString(budget.limitEgp),
        },
        update: { limitEgp: toStorageString(budget.limitEgp) },
      });
    }
  });

  return getBudgetMonth(db, month);
}

/** "Copy last month's budgets in one click" (SPEC §9). */
export async function copyBudgets(
  db: Db,
  fromMonth: string,
  toMonth: string,
  overwrite: boolean,
): Promise<CopyBudgetsResponse> {
  if (fromMonth === toMonth) {
    throw AppError.unprocessable('Choose two different months.', { field: 'toMonth' });
  }

  const fromStart = monthStart(fromMonth);
  const toStart = monthStart(toMonth);

  const [source, existing] = await Promise.all([
    db.budget.findMany({ where: { month: fromStart } }),
    db.budget.findMany({ where: { month: toStart }, select: { categoryId: true } }),
  ]);

  const alreadySet = new Set(existing.map((budget) => budget.categoryId));
  let copied = 0;
  let skipped = 0;

  await inTransaction(db, async (tx) => {
    for (const budget of source) {
      if (!overwrite && alreadySet.has(budget.categoryId)) {
        skipped += 1;
        continue;
      }

      await tx.budget.upsert({
        where: { categoryId_month: { categoryId: budget.categoryId, month: toStart } },
        create: {
          categoryId: budget.categoryId,
          month: toStart,
          limitEgp: budget.limitEgp.toString(),
        },
        update: { limitEgp: budget.limitEgp.toString() },
      });
      copied += 1;
    }
  });

  return { copied, skipped, month: await getBudgetMonth(db, toMonth) };
}
