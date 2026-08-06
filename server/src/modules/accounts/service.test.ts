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
