import { describe, expect, it } from 'vitest';
import { clearCategories, withRollback } from '../../test/db';
import { makeAccount, makeCategory, makeStandardRates } from '../../test/factories';
import { createTransaction } from '../transactions/service';
import { copyBudgets, getBudgetMonth, putBudgets } from './service';

const IN_AUGUST = new Date('2026-08-10T09:00:00.000Z');

async function setup(tx: Parameters<Parameters<typeof withRollback>[0]>[0]) {
  await makeStandardRates(tx);
  await tx.transaction.deleteMany({});
  await clearCategories(tx);

  const account = await makeAccount(tx, { currency: 'EGP', openingRateToEgp: '1' });
  const rent = await makeCategory(tx, { kind: 'EXPENSE', name: 'Rent' });
  const food = await makeCategory(tx, { kind: 'EXPENSE', name: 'Food' });
  await makeCategory(tx, { kind: 'INCOME', name: 'Salary' });

  return { account, rent, food };
}

describe('the month view', () => {
  it('lists every expense category, budgeted or not', async () => {
    await withRollback(async (tx) => {
      await setup(tx);

      const month = await getBudgetMonth(tx, '2026-08');

      // Income categories are not budgeted — you do not budget your salary.
      expect(month.rows.map((row) => row.categoryName).sort()).toEqual(['Food', 'Rent']);
      expect(month.rows.every((row) => row.limitEgp === null)).toBe(true);
    });
  });

  it('reports spending as a positive figure against the limit', async () => {
    await withRollback(async (tx) => {
      const { account, rent } = await setup(tx);

      await createTransaction(tx, {
        type: 'EXPENSE',
        amount: '12500',
        accountId: account.id,
        categoryId: rent.id,
        date: IN_AUGUST,
        note: null,
      });
      await putBudgets(tx, '2026-08', [{ categoryId: rent.id, limitEgp: '15000' }]);

      const month = await getBudgetMonth(tx, '2026-08');
      const row = month.rows.find((candidate) => candidate.categoryId === rent.id);

      expect(row?.spentEgp).toBe('12500.0000');
      expect(row?.limitEgp).toBe('15000.0000');
      expect(row?.remainingEgp).toBe('2500.0000');
      expect(row?.usagePct).toBe('83.3333');
      expect(row?.isOverBudget).toBe(false);
    });
  });

  it('marks a category that has gone over', async () => {
    await withRollback(async (tx) => {
      const { account, food } = await setup(tx);

      await createTransaction(tx, {
        type: 'EXPENSE',
        amount: '6000',
        accountId: account.id,
        categoryId: food.id,
        date: IN_AUGUST,
        note: null,
      });
      await putBudgets(tx, '2026-08', [{ categoryId: food.id, limitEgp: '4000' }]);

      const month = await getBudgetMonth(tx, '2026-08');
      const row = month.rows.find((candidate) => candidate.categoryId === food.id);

      expect(row?.isOverBudget).toBe(true);
      expect(row?.remainingEgp).toBe('-2000.0000');
      expect(row?.usagePct).toBe('150.0000');
    });
  });

  it('totals only the categories that have a limit', async () => {
    await withRollback(async (tx) => {
      const { account, rent, food } = await setup(tx);

      await createTransaction(tx, {
        type: 'EXPENSE',
        amount: '1000',
        accountId: account.id,
        categoryId: rent.id,
        date: IN_AUGUST,
        note: null,
      });
      // Spending in an unbudgeted category must not appear in the totals.
      await createTransaction(tx, {
        type: 'EXPENSE',
        amount: '9999',
        accountId: account.id,
        categoryId: food.id,
        date: IN_AUGUST,
        note: null,
      });
      await putBudgets(tx, '2026-08', [{ categoryId: rent.id, limitEgp: '5000' }]);

      const month = await getBudgetMonth(tx, '2026-08');
      expect(month.totalLimitEgp).toBe('5000.0000');
      expect(month.totalSpentEgp).toBe('1000.0000');
      expect(month.totalRemainingEgp).toBe('4000.0000');
    });
  });

  it('does not count a transfer against a budget (D2)', async () => {
    await withRollback(async (tx) => {
      const { account, rent } = await setup(tx);
      const other = await makeAccount(tx, {
        currency: 'EGP',
        name: 'Other',
        openingRateToEgp: '1',
      });

      await createTransaction(tx, {
        type: 'TRANSFER',
        fromAccountId: account.id,
        toAccountId: other.id,
        fromAmount: '3000',
        date: IN_AUGUST,
        note: null,
      });
      await putBudgets(tx, '2026-08', [{ categoryId: rent.id, limitEgp: '5000' }]);

      const month = await getBudgetMonth(tx, '2026-08');
      expect(month.totalSpentEgp).toBe('0.0000');
    });
  });
});

describe('setting limits', () => {
  it('clears a budget rather than storing zero', async () => {
    await withRollback(async (tx) => {
      const { rent } = await setup(tx);

      await putBudgets(tx, '2026-08', [{ categoryId: rent.id, limitEgp: '5000' }]);
      expect(
        (await getBudgetMonth(tx, '2026-08')).rows.find((r) => r.categoryId === rent.id)?.limitEgp,
      ).toBe('5000.0000');

      await putBudgets(tx, '2026-08', [{ categoryId: rent.id, limitEgp: null }]);

      const row = (await getBudgetMonth(tx, '2026-08')).rows.find((r) => r.categoryId === rent.id);
      // Null, not "0.0000" — otherwise the first pound spent would show as over budget.
      expect(row?.limitEgp).toBeNull();
      expect(row?.isOverBudget).toBe(false);
    });
  });

  it('refuses to budget an income category', async () => {
    await withRollback(async (tx) => {
      await setup(tx);
      const salary = await tx.category.findFirstOrThrow({ where: { kind: 'INCOME' } });

      await expect(
        putBudgets(tx, '2026-08', [{ categoryId: salary.id, limitEgp: '100' }]),
      ).rejects.toMatchObject({ status: 422 });
    });
  });

  it('refuses a negative limit', async () => {
    await withRollback(async (tx) => {
      const { rent } = await setup(tx);

      await expect(
        putBudgets(tx, '2026-08', [{ categoryId: rent.id, limitEgp: '-100' }]),
      ).rejects.toMatchObject({ status: 422 });
    });
  });
});

describe('copying a month', () => {
  it('copies limits forward and leaves existing ones alone', async () => {
    await withRollback(async (tx) => {
      const { rent, food } = await setup(tx);

      await putBudgets(tx, '2026-07', [
        { categoryId: rent.id, limitEgp: '12000' },
        { categoryId: food.id, limitEgp: '4000' },
      ]);
      // August already has its own view on rent.
      await putBudgets(tx, '2026-08', [{ categoryId: rent.id, limitEgp: '13000' }]);

      const result = await copyBudgets(tx, '2026-07', '2026-08', false);

      expect(result.copied).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.month.rows.find((r) => r.categoryId === rent.id)?.limitEgp).toBe('13000.0000');
      expect(result.month.rows.find((r) => r.categoryId === food.id)?.limitEgp).toBe('4000.0000');
    });
  });

  it('overwrites when asked to', async () => {
    await withRollback(async (tx) => {
      const { rent } = await setup(tx);

      await putBudgets(tx, '2026-07', [{ categoryId: rent.id, limitEgp: '12000' }]);
      await putBudgets(tx, '2026-08', [{ categoryId: rent.id, limitEgp: '13000' }]);

      const result = await copyBudgets(tx, '2026-07', '2026-08', true);

      expect(result.copied).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.month.rows.find((r) => r.categoryId === rent.id)?.limitEgp).toBe('12000.0000');
    });
  });

  it('refuses to copy a month onto itself', async () => {
    await withRollback(async (tx) => {
      await setup(tx);
      await expect(copyBudgets(tx, '2026-08', '2026-08', false)).rejects.toMatchObject({
        status: 422,
      });
    });
  });
});
