import { describe, expect, it } from 'vitest';
import { withRollback } from '../../test/db';
import { makeAccount, makeStandardRates } from '../../test/factories';
import { createTransaction } from '../transactions/service';
import { createAccount, deleteAccount, getAccount, listAccounts, updateAccount } from './service';

const DATE = new Date('2026-08-03T09:00:00.000Z');

describe('createAccount', () => {
  it('freezes the opening rate at the opening date (D5)', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);

      const account = await createAccount(tx, {
        name: 'Bank USD',
        type: 'BANK',
        currency: 'USD',
        openingBalance: '1000',
        color: '#4a6f9f',
        icon: 'landmark',
      });

      expect(account.openingRateToEgp).toBe('50.00000000');
      expect(account.openingBalanceEgp).toBe('50000.0000');
      expect(account.balance).toBe('1000.0000');
      expect(account.balanceEgp).toBe('50000.0000');
    });
  });

  it('uses exactly 1 for an EGP account', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);

      const account = await createAccount(tx, {
        name: 'Cash',
        type: 'CASH',
        currency: 'EGP',
        openingBalance: '2500.50',
        color: '#2f8f5b',
        icon: 'wallet',
      });

      expect(account.openingRateToEgp).toBe('1.00000000');
      expect(account.openingBalanceEgp).toBe('2500.5000');
    });
  });

  it('accepts a negative opening balance — a credit card can open in the red', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);

      const account = await createAccount(tx, {
        name: 'Card',
        type: 'CREDIT_CARD',
        currency: 'EGP',
        openingBalance: '-4000',
        color: '#b4553f',
        icon: 'credit-card',
      });

      expect(account.balance).toBe('-4000.0000');
    });
  });
});

describe('balances', () => {
  it('is openingBalance plus a plain sum of signed amounts', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const account = await makeAccount(tx, {
        currency: 'EGP',
        openingBalance: '1000.0000',
        openingRateToEgp: '1',
      });

      await createTransaction(tx, {
        type: 'INCOME',
        amount: '5000',
        accountId: account.id,
        categoryId: null,
        date: DATE,
        note: null,
      });
      await createTransaction(tx, {
        type: 'EXPENSE',
        amount: '1250.50',
        accountId: account.id,
        categoryId: null,
        date: DATE,
        note: null,
      });

      const fetched = await getAccount(tx, account.id);

      expect(fetched.balance).toBe('4749.5000');
      expect(fetched.balanceEgp).toBe('4749.5000');
      expect(fetched.transactionCount).toBe(2);
    });
  });

  it('keeps balanceEgp on frozen figures even when the rate later moves', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const usd = await makeAccount(tx, {
        currency: 'USD',
        openingBalance: '0.0000',
        openingRateToEgp: '50',
      });

      await createTransaction(tx, {
        type: 'INCOME',
        amount: '100',
        accountId: usd.id,
        categoryId: null,
        date: DATE,
        note: null,
      });

      // The rate moves after the fact; the stored figure must not.
      await tx.exchangeRate.create({
        data: {
          base: 'USD',
          quote: 'EGP',
          rate: '90',
          asOf: new Date('2026-08-03T23:00:00.000Z'),
          source: 'MANUAL',
        },
      });

      const fetched = await getAccount(tx, usd.id);
      expect(fetched.balanceEgp).toBe('5000.0000');
    });
  });
});

describe('archiving', () => {
  it('archives instead of deleting when the account holds transactions', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const account = await makeAccount(tx, { currency: 'EGP' });

      await createTransaction(tx, {
        type: 'EXPENSE',
        amount: '100',
        accountId: account.id,
        categoryId: null,
        date: DATE,
        note: null,
      });

      const result = await deleteAccount(tx, account.id);

      expect(result.outcome).toBe('archived');
      expect(result.account.isArchived).toBe(true);
      // The history is still there — that is the whole point of archiving.
      expect(await tx.transaction.count({ where: { accountId: account.id } })).toBe(1);
      expect(await tx.account.count({ where: { id: account.id } })).toBe(1);
    });
  });

  it('deletes an account that has no transactions to protect', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const account = await makeAccount(tx, { currency: 'EGP' });

      const result = await deleteAccount(tx, account.id);

      expect(result.outcome).toBe('deleted');
      expect(await tx.account.count({ where: { id: account.id } })).toBe(0);
    });
  });

  it('hides archived accounts from the list unless asked', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      // Transactions first: accounts are Restrict-protected, and the developer's real
      // rows reference them. Both come back when the transaction rolls back.
      await tx.transaction.deleteMany({});
      await tx.account.deleteMany({});
      await makeAccount(tx, { currency: 'EGP', name: 'Active' });
      await makeAccount(tx, { currency: 'USD', name: 'Old', isArchived: true });

      expect(await listAccounts(tx, false)).toHaveLength(1);
      expect(await listAccounts(tx, true)).toHaveLength(2);
    });
  });

  it('can be un-archived', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const account = await makeAccount(tx, { currency: 'EGP', isArchived: true });

      const restored = await updateAccount(tx, account.id, { isArchived: false });
      expect(restored.isArchived).toBe(false);
    });
  });

  it('404s an account that does not exist', async () => {
    await withRollback(async (tx) => {
      await expect(getAccount(tx, '00000000-0000-0000-0000-000000000000')).rejects.toMatchObject({
        status: 404,
      });
    });
  });
});

/**
 * The 30-day series behind the accounts screen's sparkline (SPEC §9).
 *
 * These fix `now` rather than using the wall clock, so the window is a known 30 days and
 * an assertion about its length cannot drift into next month.
 */
describe('balance history', () => {
  const NOW = new Date('2026-08-30T12:00:00.000Z');

  it('reports one closing balance per day of the window', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const made = await makeAccount(tx, {
        currency: 'EGP',
        openingBalance: '1000.0000',
        openingRateToEgp: '1',
        openingDate: new Date('2026-01-01T00:00:00.000Z'),
      });

      const all = await listAccounts(tx, false, NOW);
      const dto = all.find((row) => row.id === made.id);
      expect(dto?.balanceHistory).toHaveLength(30);
    });
  });

  it('carries the balance forward and steps on the day a row lands', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const account = await makeAccount(tx, {
        currency: 'EGP',
        openingBalance: '1000.0000',
        openingRateToEgp: '1',
        openingDate: new Date('2026-01-01T00:00:00.000Z'),
      });

      await createTransaction(tx, {
        type: 'EXPENSE',
        amount: '250',
        accountId: account.id,
        categoryId: null,
        date: new Date('2026-08-29T09:00:00.000Z'),
        note: null,
      });

      const dto = (await listAccounts(tx, false, NOW)).find((row) => row.id === account.id);
      const history = dto?.balanceHistory ?? [];

      // Flat at 1,000 until the 29th, then 750 for the 29th and the 30th.
      expect(history[0]).toBe('1000.0000');
      expect(history.at(-2)).toBe('750.0000');
      expect(history.at(-1)).toBe('750.0000');
    });
  });

  /** Rows from before the window are in the opening figure, not lost. */
  it('includes everything that happened before the window in the first point', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const account = await makeAccount(tx, {
        currency: 'EGP',
        openingBalance: '1000.0000',
        openingRateToEgp: '1',
        openingDate: new Date('2026-01-01T00:00:00.000Z'),
      });

      await createTransaction(tx, {
        type: 'INCOME',
        amount: '400',
        accountId: account.id,
        categoryId: null,
        date: new Date('2026-03-15T09:00:00.000Z'),
        note: null,
      });

      const dto = (await listAccounts(tx, false, NOW)).find((row) => row.id === account.id);
      expect(dto?.balanceHistory[0]).toBe('1400.0000');
    });
  });

  /**
   * A young account reports the days it actually existed. Padding backwards would draw a
   * fortnight of flat history that never happened, which is the one thing a trend line
   * must not do.
   */
  it('starts at the opening date for an account younger than the window', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const made = await makeAccount(tx, {
        currency: 'EGP',
        openingBalance: '500.0000',
        openingRateToEgp: '1',
        openingDate: new Date('2026-08-28T00:00:00.000Z'),
      });

      const all = await listAccounts(tx, false, NOW);
      const dto = all.find((row) => row.id === made.id);

      // 28th, 29th, 30th.
      expect(dto?.balanceHistory).toHaveLength(3);
      expect(dto?.balanceHistory[0]).toBe('500.0000');
    });
  });

  /** One point is not a trend, and the sparkline declines to draw it. */
  it('gives an account opened today a single point', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const made = await makeAccount(tx, {
        currency: 'EGP',
        openingBalance: '500.0000',
        openingRateToEgp: '1',
        openingDate: new Date('2026-08-30T08:00:00.000Z'),
      });

      const all = await listAccounts(tx, false, NOW);
      const dto = all.find((row) => row.id === made.id);
      expect(dto?.balanceHistory).toHaveLength(1);
    });
  });

  /** The card's hero figure is the native balance, so the series has to match it. */
  it('is in the account’s own currency, not pounds', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const made = await makeAccount(tx, {
        currency: 'USD',
        openingBalance: '100.0000',
        openingRateToEgp: '50',
        openingDate: new Date('2026-01-01T00:00:00.000Z'),
      });

      const all = await listAccounts(tx, false, NOW);
      const dto = all.find((row) => row.id === made.id);
      expect(dto?.balanceHistory.at(-1)).toBe('100.0000');
    });
  });

  it('ends on the balance the card prints', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const account = await makeAccount(tx, {
        currency: 'EGP',
        openingBalance: '1000.0000',
        openingRateToEgp: '1',
        openingDate: new Date('2026-01-01T00:00:00.000Z'),
      });

      await createTransaction(tx, {
        type: 'EXPENSE',
        amount: '125.50',
        accountId: account.id,
        categoryId: null,
        date: new Date('2026-08-20T09:00:00.000Z'),
        note: null,
      });

      const dto = (await listAccounts(tx, false, NOW)).find((row) => row.id === account.id);
      expect(dto?.balanceHistory.at(-1)).toBe(dto?.balance);
    });
  });
});
