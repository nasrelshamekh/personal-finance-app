import { describe, expect, it } from 'vitest';
import { Decimal } from '@ledger/shared';
import { clearCategories, withRollback } from '../../test/db';
import { makeAccount, makeCategory, makeDebt, makeStandardRates } from '../../test/factories';
import { createTransaction } from '../transactions/service';
import { currentMonthKey, getDashboard, monthRange } from './service';

const NOW = new Date('2026-08-15T12:00:00.000Z');
const IN_AUGUST = new Date('2026-08-10T09:00:00.000Z');
const IN_JULY = new Date('2026-07-10T09:00:00.000Z');

/**
 * Clears everything the dashboard reads, so each case starts from a known board.
 *
 * Debts included, now that net worth counts them: the developer's own database is the one
 * these run against, and a real debt sitting in it would quietly move every `afterDebtsEgp`
 * assertion below. Transactions go first because a debt payment can own one.
 */
async function clean(tx: Parameters<Parameters<typeof withRollback>[0]>[0]): Promise<void> {
  await tx.transaction.deleteMany({});
  await tx.debt.deleteMany({});
  await tx.account.deleteMany({});
  await clearCategories(tx);
  await makeStandardRates(tx);

  /*
   * `getDashboard` tops rates up before reading (D12), and the fixture rates are dated
   * well before `NOW` — so with the network up it fetched real ones mid-test and a debt
   * conversion came back at the live rate instead of the fixture's 50. Switched off here:
   * these assertions are about the dashboard's arithmetic, not the provider's, and a test
   * whose expected figure depends on today's market is not a test.
   */
  await tx.setting.update({ where: { id: 1 }, data: { ratesApiEnabled: false } });
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

/**
 * Everything on this screen sits under one month picker, so everything on it has to
 * describe the same month.
 *
 * It did not. Net worth and the totals were scoped; the accounts panel and the recent list
 * were not — so reading July showed a net worth of zero beside today's balances and a list
 * of August rows. Each panel was individually correct and the screen as a whole was a lie.
 */
describe('one month, one answer', () => {
  describe('the accounts panel', () => {
    it('shows the balance as at the end of the month, not as it stands now', async () => {
      await withRollback(async (tx) => {
        await clean(tx);
        const account = await makeAccount(tx, { currency: 'EGP', openingBalance: '1000.0000' });

        await createTransaction(tx, {
          type: 'INCOME',
          amount: '500',
          accountId: account.id,
          categoryId: null,
          date: IN_JULY,
          note: null,
        });
        await createTransaction(tx, {
          type: 'INCOME',
          amount: '9000',
          accountId: account.id,
          categoryId: null,
          date: IN_AUGUST,
          note: null,
        });

        const july = await getDashboard(tx, '2026-07', NOW);
        const august = await getDashboard(tx, '2026-08', NOW);

        expect(july.accounts[0]?.balance).toBe('1500.0000');
        expect(august.accounts[0]?.balance).toBe('10500.0000');
      });
    });

    /**
     * The invariant the fix exists for, and the one worth keeping: net worth *is* the sum
     * of these balances. If the two are ever computed from different sets of rows again,
     * this is what catches it.
     */
    it('adds up to the net worth printed above it', async () => {
      await withRollback(async (tx) => {
        await clean(tx);
        const cash = await makeAccount(tx, { currency: 'EGP', openingBalance: '2000.0000' });
        const bank = await makeAccount(tx, {
          currency: 'USD',
          openingBalance: '100.0000',
          openingRateToEgp: '50',
        });

        await createTransaction(tx, {
          type: 'EXPENSE',
          amount: '250',
          accountId: cash.id,
          categoryId: null,
          date: IN_AUGUST,
          note: null,
        });
        await createTransaction(tx, {
          type: 'EXPENSE',
          amount: '10',
          accountId: bank.id,
          categoryId: null,
          date: IN_AUGUST,
          note: null,
        });

        for (const month of ['2026-07', '2026-08']) {
          const dashboard = await getDashboard(tx, month, NOW);
          const total = dashboard.accounts.reduce(
            (running, account) => running.plus(account.balanceEgp),
            new Decimal(0),
          );

          expect(total.toFixed(4)).toBe(dashboard.netWorth.egp);
        }
      });
    });

    /** An account opened in August did not exist in July, and July should not claim it did. */
    it('leaves out an account that did not exist yet', async () => {
      await withRollback(async (tx) => {
        await clean(tx);
        await makeAccount(tx, {
          currency: 'EGP',
          openingBalance: '5000.0000',
          openingDate: new Date('2026-08-01T00:00:00.000Z'),
        });

        expect((await getDashboard(tx, '2026-07', NOW)).accounts).toHaveLength(0);
        expect((await getDashboard(tx, '2026-08', NOW)).accounts).toHaveLength(1);
      });
    });

    /**
     * Archiving is a decision about a list, not about whose money it is — net worth counts
     * every account either way. Hiding one that still holds a balance is how the panel
     * quietly stopped adding up to the figure above it.
     */
    it('keeps an archived account while it still holds money, and marks it', async () => {
      await withRollback(async (tx) => {
        await clean(tx);
        await makeAccount(tx, {
          currency: 'EGP',
          openingBalance: '900.0000',
          isArchived: true,
        });

        const dashboard = await getDashboard(tx, '2026-08', NOW);

        expect(dashboard.accounts).toHaveLength(1);
        expect(dashboard.accounts[0]).toMatchObject({ isArchived: true, balanceEgp: '900.0000' });
        expect(dashboard.netWorth.egp).toBe('900.0000');
      });
    });

    /** Nothing left in it, so nothing to add — and the panel stays free of dead accounts. */
    it('drops an archived account once it is empty', async () => {
      await withRollback(async (tx) => {
        await clean(tx);
        await makeAccount(tx, { currency: 'EGP', isArchived: true });

        expect((await getDashboard(tx, '2026-08', NOW)).accounts).toHaveLength(0);
      });
    });

    /** The invariant again, this time with the case that used to break it. */
    it('still adds up to net worth when one of the accounts is archived', async () => {
      await withRollback(async (tx) => {
        await clean(tx);
        await makeAccount(tx, { currency: 'EGP', openingBalance: '2000.0000' });
        await makeAccount(tx, {
          currency: 'EGP',
          openingBalance: '750.0000',
          isArchived: true,
        });

        const dashboard = await getDashboard(tx, '2026-08', NOW);
        const total = dashboard.accounts.reduce(
          (running, account) => running.plus(account.balanceEgp),
          new Decimal(0),
        );

        expect(total.toFixed(4)).toBe(dashboard.netWorth.egp);
      });
    });
  });

  /**
   * What the accounts hold and what you are worth are different claims. The dashboard used
   * to report only the first while calling it net worth, so a ledger with 5,436 in the bank
   * and a 4,000 debt read as 5,436.
   */
  describe('after debts', () => {
    it('subtracts what you still owe', async () => {
      await withRollback(async (tx) => {
        await clean(tx);
        await makeAccount(tx, { currency: 'EGP', openingBalance: '5436.0000' });
        await makeDebt(tx, { principal: '4000', direction: 'I_OWE' });

        const { netWorth } = await getDashboard(tx, '2026-08', NOW);

        expect(netWorth.egp).toBe('5436.0000');
        expect(netWorth.owedByYouEgp).toBe('4000.0000');
        expect(netWorth.afterDebtsEgp).toBe('1436.0000');
      });
    });

    it('adds what is owed to you', async () => {
      await withRollback(async (tx) => {
        await clean(tx);
        await makeAccount(tx, { currency: 'EGP', openingBalance: '1000.0000' });
        await makeDebt(tx, { principal: '250', direction: 'OWED_TO_ME' });

        const { netWorth } = await getDashboard(tx, '2026-08', NOW);

        expect(netWorth.owedToYouEgp).toBe('250.0000');
        expect(netWorth.afterDebtsEgp).toBe('1250.0000');
      });
    });

    /** Payments reduce it, and only the ones made by the end of the month being read. */
    it('counts what was outstanding then, not what is outstanding now', async () => {
      await withRollback(async (tx) => {
        await clean(tx);
        await makeAccount(tx, { currency: 'EGP', openingBalance: '5000.0000' });
        const debt = await makeDebt(tx, { principal: '4000' });

        await tx.debtPayment.create({
          data: {
            debtId: debt.id,
            amount: '1000',
            currency: 'EGP',
            rateToDebtCurrency: '1',
            amountInDebtCurrency: '1000',
            rateToEgp: '1',
            amountEgp: '1000',
            rateAsOf: IN_AUGUST,
            date: IN_AUGUST,
          },
        });

        // July closed before the payment, so it was still the full 4,000 then.
        expect((await getDashboard(tx, '2026-07', NOW)).netWorth.owedByYouEgp).toBe('4000.0000');
        expect((await getDashboard(tx, '2026-08', NOW)).netWorth.owedByYouEgp).toBe('3000.0000');
      });
    });

    it('leaves a settled debt out', async () => {
      await withRollback(async (tx) => {
        await clean(tx);
        await makeAccount(tx, { currency: 'EGP', openingBalance: '1000.0000' });
        await makeDebt(tx, { principal: '4000', status: 'SETTLED' });

        const { netWorth } = await getDashboard(tx, '2026-08', NOW);

        expect(netWorth.owedByYouEgp).toBe('0.0000');
        expect(netWorth.afterDebtsEgp).toBe('1000.0000');
      });
    });

    it('leaves out a debt that did not exist yet', async () => {
      await withRollback(async (tx) => {
        await clean(tx);
        await makeAccount(tx, { currency: 'EGP', openingBalance: '1000.0000' });
        await makeDebt(tx, { principal: '500', startDate: IN_AUGUST });

        expect((await getDashboard(tx, '2026-07', NOW)).netWorth.owedByYouEgp).toBe('0.0000');
        expect((await getDashboard(tx, '2026-08', NOW)).netWorth.owedByYouEgp).toBe('500.0000');
      });
    });

    /**
     * A debt lives in its own currency (D4) and its remaining balance has no frozen EGP
     * figure, so converting one uses today's rate — which puts a live rate inside an
     * otherwise frozen figure. Said out loud rather than hidden.
     */
    it('says when a figure needed converting, and when it did not', async () => {
      await withRollback(async (tx) => {
        await clean(tx);
        await makeAccount(tx, { currency: 'EGP', openingBalance: '10000.0000' });
        await makeDebt(tx, { principal: '100', currency: 'USD' });

        const converted = await getDashboard(tx, '2026-08', NOW);
        // makeStandardRates puts USD at 50.
        expect(converted.netWorth.owedByYouEgp).toBe('5000.0000');
        expect(converted.netWorth.debtsConverted).toBe(true);
      });
    });

    it('is exact, and says so, when every debt is already in pounds', async () => {
      await withRollback(async (tx) => {
        await clean(tx);
        await makeAccount(tx, { currency: 'EGP', openingBalance: '10000.0000' });
        await makeDebt(tx, { principal: '100', currency: 'EGP' });

        expect((await getDashboard(tx, '2026-08', NOW)).netWorth.debtsConverted).toBe(false);
      });
    });

    it('equals the accounts figure when there are no debts at all', async () => {
      await withRollback(async (tx) => {
        await clean(tx);
        await makeAccount(tx, { currency: 'EGP', openingBalance: '1234.0000' });

        const { netWorth } = await getDashboard(tx, '2026-08', NOW);
        expect(netWorth.afterDebtsEgp).toBe(netWorth.egp);
      });
    });
  });

  describe('the recent list', () => {
    it('shows only what happened in the month being read', async () => {
      await withRollback(async (tx) => {
        await clean(tx);
        const account = await makeAccount(tx, { currency: 'EGP' });

        await createTransaction(tx, {
          type: 'EXPENSE',
          amount: '100',
          accountId: account.id,
          categoryId: null,
          date: IN_JULY,
          note: 'july',
        });
        await createTransaction(tx, {
          type: 'EXPENSE',
          amount: '200',
          accountId: account.id,
          categoryId: null,
          date: IN_AUGUST,
          note: 'august',
        });

        const july = await getDashboard(tx, '2026-07', NOW);
        const august = await getDashboard(tx, '2026-08', NOW);

        expect(july.recentTransactions.map((row) => row.note)).toEqual(['july']);
        expect(august.recentTransactions.map((row) => row.note)).toEqual(['august']);
      });
    });

    it('is empty for a month in which nothing happened', async () => {
      await withRollback(async (tx) => {
        await clean(tx);
        const account = await makeAccount(tx, { currency: 'EGP' });
        await createTransaction(tx, {
          type: 'EXPENSE',
          amount: '100',
          accountId: account.id,
          categoryId: null,
          date: IN_AUGUST,
          note: null,
        });

        expect((await getDashboard(tx, '2026-07', NOW)).recentTransactions).toHaveLength(0);
      });
    });

    it('still stops at six', async () => {
      await withRollback(async (tx) => {
        await clean(tx);
        const account = await makeAccount(tx, { currency: 'EGP' });

        for (let index = 0; index < 8; index += 1) {
          await createTransaction(tx, {
            type: 'EXPENSE',
            amount: '10',
            accountId: account.id,
            categoryId: null,
            date: IN_AUGUST,
            note: `row ${index}`,
          });
        }

        expect((await getDashboard(tx, '2026-08', NOW)).recentTransactions).toHaveLength(6);
      });
    });
  });
});
