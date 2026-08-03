import { describe, expect, it } from 'vitest';
import { clearCategories, withRollback } from '../../test/db';
import { makeAccount, makeCategory, makeStandardRates } from '../../test/factories';
import { createTransaction } from '../transactions/service';
import { currentMonthKey, getDashboard, monthRange } from './service';

const NOW = new Date('2026-08-15T12:00:00.000Z');
const IN_AUGUST = new Date('2026-08-10T09:00:00.000Z');
const IN_JULY = new Date('2026-07-10T09:00:00.000Z');

/** Clears everything the dashboard reads, so each case starts from a known board. */
async function clean(tx: Parameters<Parameters<typeof withRollback>[0]>[0]): Promise<void> {
  await tx.transaction.deleteMany({});
  await tx.account.deleteMany({});
  await clearCategories(tx);
  await makeStandardRates(tx);
}

describe('month range', () => {
  it('is half-open, so nothing at the end of the last day is lost', () => {
    const range = monthRange('2026-08');
    expect(range.start.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('rolls over the year', () => {
    expect(monthRange('2026-12').end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('formats the current month key', () => {
    expect(currentMonthKey(new Date('2026-03-09T00:00:00.000Z'))).toBe('2026-03');
  });
});

describe('net worth (D5)', () => {
  it('sums opening balances and every movement up to the end of the month', async () => {
    await withRollback(async (tx) => {
      await clean(tx);
      const account = await makeAccount(tx, {
        currency: 'EGP',
        openingBalance: '10000.0000',
        openingRateToEgp: '1',
      });

      await createTransaction(tx, {
        type: 'INCOME',
        amount: '5000',
        accountId: account.id,
        categoryId: null,
        date: IN_JULY,
        note: null,
      });
      await createTransaction(tx, {
        type: 'EXPENSE',
        amount: '2000',
        accountId: account.id,
        categoryId: null,
        date: IN_AUGUST,
        note: null,
      });

      const dashboard = await getDashboard(tx, '2026-08', NOW);

      // 10,000 opening + 5,000 July - 2,000 August
      expect(dashboard.netWorth.egp).toBe('13000.0000');
      // At the start of August, only the opening balance and July's income counted.
      expect(dashboard.netWorth.previousEgp).toBe('15000.0000');
      expect(dashboard.netWorth.deltaEgp).toBe('-2000.0000');
    });
  });

  it('excludes accounts opened after the date being asked about', async () => {
    await withRollback(async (tx) => {
      await clean(tx);
      await tx.account.create({
        data: {
          name: 'Opened later',
          type: 'CASH',
          currency: 'EGP',
          openingBalance: '9999.0000',
          openingDate: new Date('2026-09-15T00:00:00.000Z'),
          openingRateToEgp: '1',
          openingBalanceEgp: '9999.0000',
          color: '#2f8f5b',
          icon: 'wallet',
        },
      });

      const dashboard = await getDashboard(tx, '2026-08', NOW);
      expect(dashboard.netWorth.egp).toBe('0.0000');
    });
  });

  it('reports no percentage against a negative starting point', async () => {
    await withRollback(async (tx) => {
      await clean(tx);
      const account = await makeAccount(tx, {
        currency: 'EGP',
        openingBalance: '0.0000',
        openingRateToEgp: '1',
      });

      // Net worth was negative at the start of the month.
      await createTransaction(tx, {
        type: 'EXPENSE',
        amount: '500',
        accountId: account.id,
        categoryId: null,
        date: IN_JULY,
        note: null,
      });
      await createTransaction(tx, {
        type: 'INCOME',
        amount: '2000',
        accountId: account.id,
        categoryId: null,
        date: IN_AUGUST,
        note: null,
      });

      const { netWorth } = await getDashboard(tx, '2026-08', NOW);

      expect(netWorth.previousEgp).toBe('-500.0000');
      expect(netWorth.deltaEgp).toBe('2000.0000');
      // -500 -> +1500 is not "400% growth"; a percentage from a negative base is noise.
      expect(netWorth.deltaPct).toBeNull();
    });
  });

  it('reports a percentage when the baseline is genuinely positive', async () => {
    await withRollback(async (tx) => {
      await clean(tx);
      const account = await makeAccount(tx, {
        currency: 'EGP',
        openingBalance: '10000.0000',
        openingRateToEgp: '1',
      });

      await createTransaction(tx, {
        type: 'INCOME',
        amount: '2500',
        accountId: account.id,
        categoryId: null,
        date: IN_AUGUST,
        note: null,
      });

      const { netWorth } = await getDashboard(tx, '2026-08', NOW);
      expect(netWorth.deltaPct).toBe('25.0000');
    });
  });

  it('reports no percentage against a zero starting point', async () => {
    await withRollback(async (tx) => {
      await clean(tx);
      const account = await makeAccount(tx, { currency: 'EGP', openingBalance: '0.0000' });
      await createTransaction(tx, {
        type: 'INCOME',
        amount: '100',
        accountId: account.id,
        categoryId: null,
        date: IN_AUGUST,
        note: null,
      });

      const dashboard = await getDashboard(tx, '2026-08', NOW);
      expect(dashboard.netWorth.deltaPct).toBeNull();
    });
  });
});

describe('monthly totals', () => {
  it('reports income and expenses as positive figures', async () => {
    await withRollback(async (tx) => {
      await clean(tx);
      const account = await makeAccount(tx, { currency: 'EGP' });

      await createTransaction(tx, {
        type: 'INCOME',
        amount: '8000',
        accountId: account.id,
        categoryId: null,
        date: IN_AUGUST,
        note: null,
      });
      await createTransaction(tx, {
        type: 'EXPENSE',
        amount: '3000',
        accountId: account.id,
        categoryId: null,
        date: IN_AUGUST,
        note: null,
      });

      const { totals } = await getDashboard(tx, '2026-08', NOW);

      expect(totals.incomeEgp).toBe('8000.0000');
      expect(totals.expensesEgp).toBe('3000.0000');
      expect(totals.netEgp).toBe('5000.0000');
    });
  });

  it('excludes transfers from income and expenses (D2)', async () => {
    await withRollback(async (tx) => {
      await clean(tx);
      const from = await makeAccount(tx, {
        currency: 'EGP',
        name: 'A',
        openingBalance: '10000.0000',
        openingRateToEgp: '1',
      });
      const to = await makeAccount(tx, { currency: 'EGP', name: 'B' });

      await createTransaction(tx, {
        type: 'TRANSFER',
        fromAccountId: from.id,
        toAccountId: to.id,
        fromAmount: '4000',
        date: IN_AUGUST,
        note: null,
      });

      const { totals, netWorth } = await getDashboard(tx, '2026-08', NOW);

      // Moving money between your own accounts is neither earning nor spending.
      expect(totals.incomeEgp).toBe('0.0000');
      expect(totals.expensesEgp).toBe('0.0000');
      // And it leaves net worth untouched.
      expect(netWorth.egp).toBe('10000.0000');
      expect(netWorth.deltaEgp).toBe('0.0000');
    });
  });

  it('reports what converting cost this month (D2)', async () => {
    await withRollback(async (tx) => {
      await clean(tx);
      const usd = await makeAccount(tx, {
        currency: 'USD',
        name: 'USD',
        openingBalance: '1000.0000',
        openingRateToEgp: '50',
      });
      const egp = await makeAccount(tx, { currency: 'EGP', name: 'EGP' });

      await createTransaction(tx, {
        type: 'TRANSFER',
        fromAccountId: usd.id,
        toAccountId: egp.id,
        fromAmount: '500',
        toAmount: '24000',
        date: IN_AUGUST,
        note: null,
      });

      const { totals } = await getDashboard(tx, '2026-08', NOW);
      expect(totals.conversionCostEgp).toBe('1000.0000');
    });
  });

  it('does not count a same-currency transfer as a conversion cost', async () => {
    await withRollback(async (tx) => {
      await clean(tx);
      const from = await makeAccount(tx, {
        currency: 'EGP',
        name: 'A',
        openingBalance: '5000.0000',
        openingRateToEgp: '1',
      });
      const to = await makeAccount(tx, { currency: 'EGP', name: 'B' });

      await createTransaction(tx, {
        type: 'TRANSFER',
        fromAccountId: from.id,
        toAccountId: to.id,
        fromAmount: '1000',
        date: IN_AUGUST,
        note: null,
      });

      const { totals } = await getDashboard(tx, '2026-08', NOW);
      expect(totals.conversionCostEgp).toBe('0.0000');
    });
  });
});

describe('breakdowns', () => {
  it('splits spending by category with shares that add up', async () => {
    await withRollback(async (tx) => {
      await clean(tx);
      const account = await makeAccount(tx, { currency: 'EGP' });
      const rent = await makeCategory(tx, { kind: 'EXPENSE', name: 'Rent' });
      const food = await makeCategory(tx, { kind: 'EXPENSE', name: 'Food' });

      await createTransaction(tx, {
        type: 'EXPENSE',
        amount: '7500',
        accountId: account.id,
        categoryId: rent.id,
        date: IN_AUGUST,
        note: null,
      });
      await createTransaction(tx, {
        type: 'EXPENSE',
        amount: '2500',
        accountId: account.id,
        categoryId: food.id,
        date: IN_AUGUST,
        note: null,
      });

      const { spendByCategory } = await getDashboard(tx, '2026-08', NOW);

      expect(spendByCategory[0]).toMatchObject({ name: 'Rent', spentEgp: '7500.0000' });
      expect(spendByCategory[0]?.sharePct).toBe('75.0000');
      expect(spendByCategory[1]?.sharePct).toBe('25.0000');
    });
  });

  it('labels uncategorised spending rather than dropping it', async () => {
    await withRollback(async (tx) => {
      await clean(tx);
      const account = await makeAccount(tx, { currency: 'EGP' });

      await createTransaction(tx, {
        type: 'EXPENSE',
        amount: '400',
        accountId: account.id,
        categoryId: null,
        date: IN_AUGUST,
        note: null,
      });

      const { spendByCategory } = await getDashboard(tx, '2026-08', NOW);
      expect(spendByCategory[0]).toMatchObject({ categoryId: null, name: 'Uncategorised' });
    });
  });

  it('returns every day of the month, including the empty ones', async () => {
    await withRollback(async (tx) => {
      await clean(tx);

      const { daily } = await getDashboard(tx, '2026-08', NOW);

      expect(daily).toHaveLength(31);
      expect(daily[0]?.date).toBe('2026-08-01');
      expect(daily[30]?.date).toBe('2026-08-31');
      expect(daily.every((day) => day.spentEgp === '0.0000')).toBe(true);
    });
  });

  it('defaults to the current month', async () => {
    await withRollback(async (tx) => {
      await clean(tx);
      const dashboard = await getDashboard(tx, undefined, NOW);
      expect(dashboard.month).toBe('2026-08');
    });
  });
});
