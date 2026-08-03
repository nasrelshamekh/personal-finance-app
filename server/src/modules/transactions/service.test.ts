import { describe, expect, it } from 'vitest';
import type { TransactionDto, TransferGroupDto } from '@ledger/shared';
import { withRollback } from '../../test/db';
import { makeAccount, makeCategory, makeStandardRates, TEST_NOW } from '../../test/factories';
import { getAccount } from '../accounts/service';
import {
  createTransaction,
  deleteTransaction,
  getTransferGroup,
  listTransactions,
  updateTransaction,
} from './service';

const DATE = new Date('2026-08-03T09:00:00.000Z');

function asEntry(result: TransactionDto | TransferGroupDto): TransactionDto {
  if ('transferGroupId' in result && 'from' in result) {
    throw new Error('Expected a single transaction, got a transfer group');
  }
  return result as TransactionDto;
}

function asTransfer(result: TransactionDto | TransferGroupDto): TransferGroupDto {
  if (!('from' in result)) throw new Error('Expected a transfer group');
  return result;
}

const listDefaults = { page: 1, pageSize: 25 } as const;

describe('signed storage (SPEC §4.7)', () => {
  it('stores income positive and expense negative', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const account = await makeAccount(tx, { currency: 'EGP' });
      const income = await makeCategory(tx, { kind: 'INCOME' });
      const expense = await makeCategory(tx, { kind: 'EXPENSE' });

      const earned = asEntry(
        await createTransaction(tx, {
          type: 'INCOME',
          amount: '5000',
          accountId: account.id,
          categoryId: income.id,
          date: DATE,
          note: null,
        }),
      );
      const spent = asEntry(
        await createTransaction(tx, {
          type: 'EXPENSE',
          amount: '1250.50',
          accountId: account.id,
          categoryId: expense.id,
          date: DATE,
          note: null,
        }),
      );

      expect(earned.amount).toBe('5000.0000');
      expect(earned.amountEgp).toBe('5000.0000');
      expect(spent.amount).toBe('-1250.5000');
      // amountEgp always carries the same sign as amount.
      expect(spent.amountEgp).toBe('-1250.5000');
    });
  });

  it('accepts an arithmetic expression as the amount (SPEC §8)', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const account = await makeAccount(tx, { currency: 'EGP' });

      const row = asEntry(
        await createTransaction(tx, {
          type: 'EXPENSE',
          amount: '1200*3+450',
          accountId: account.id,
          categoryId: null,
          date: DATE,
          note: null,
        }),
      );

      expect(row.amount).toBe('-4050.0000');
    });
  });

  it('refuses a negative amount rather than silently flipping the type', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const account = await makeAccount(tx, { currency: 'EGP' });

      await expect(
        createTransaction(tx, {
          type: 'EXPENSE',
          amount: '-100',
          accountId: account.id,
          categoryId: null,
          date: DATE,
          note: null,
        }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });
});

describe('frozen rate (SPEC §4.4, D12)', () => {
  it('freezes rateToEgp, amountEgp and rateAsOf at write time', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const usd = await makeAccount(tx, { currency: 'USD' });

      const row = asEntry(
        await createTransaction(tx, {
          type: 'INCOME',
          amount: '500',
          accountId: usd.id,
          categoryId: null,
          date: DATE,
          note: null,
        }),
      );

      expect(row.rateToEgp).toBe('50.00000000');
      expect(row.amountEgp).toBe('25000.0000');
      expect(row.rateIsApproximate).toBe(false);
    });
  });

  it('flags a backdated row whose rate post-dates it (D12)', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const usd = await makeAccount(tx, { currency: 'USD' });

      // Six months before any stored rate: resolution falls back to a newer one.
      const row = asEntry(
        await createTransaction(tx, {
          type: 'EXPENSE',
          amount: '100',
          accountId: usd.id,
          categoryId: null,
          date: new Date('2026-02-01T00:00:00.000Z'),
          note: null,
        }),
      );

      expect(row.rateIsApproximate).toBe(true);
      // Saved regardless — a backdated entry is never blocked (D12).
      expect(row.amountEgp).toBe('-5000.0000');
    });
  });

  it('uses exactly 1 for an EGP account', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const account = await makeAccount(tx, { currency: 'EGP' });

      const row = asEntry(
        await createTransaction(tx, {
          type: 'INCOME',
          amount: '1000',
          accountId: account.id,
          categoryId: null,
          date: DATE,
          note: null,
        }),
      );

      expect(row.rateToEgp).toBe('1.00000000');
      expect(row.rateIsApproximate).toBe(false);
    });
  });

  it('re-freezes when the amount changes, but not when only the note does', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const usd = await makeAccount(tx, { currency: 'USD' });

      const created = asEntry(
        await createTransaction(tx, {
          type: 'INCOME',
          amount: '500',
          accountId: usd.id,
          categoryId: null,
          date: DATE,
          note: null,
        }),
      );

      const renamed = asEntry(await updateTransaction(tx, created.id, { note: 'salary' }));
      expect(renamed.amountEgp).toBe('25000.0000');

      const rerated = asEntry(await updateTransaction(tx, created.id, { amount: '600' }));
      expect(rerated.amount).toBe('600.0000');
      expect(rerated.amountEgp).toBe('30000.0000');
    });
  });
});

describe('accounts are single-currency (D3)', () => {
  it('refuses a transaction whose currency differs from its account', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const egp = await makeAccount(tx, { currency: 'EGP' });

      await expect(
        createTransaction(tx, {
          type: 'EXPENSE',
          amount: '100',
          currency: 'USD',
          accountId: egp.id,
          categoryId: null,
          date: DATE,
          note: null,
        }),
      ).rejects.toMatchObject({ status: 422 });
    });
  });

  it('refuses an expense filed under an income category', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const account = await makeAccount(tx, { currency: 'EGP' });
      const income = await makeCategory(tx, { kind: 'INCOME' });

      await expect(
        createTransaction(tx, {
          type: 'EXPENSE',
          amount: '100',
          accountId: account.id,
          categoryId: income.id,
          date: DATE,
          note: null,
        }),
      ).rejects.toMatchObject({ status: 422 });
    });
  });
});

describe('transfers (D2)', () => {
  it('writes two linked rows and leaves both balances right', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const from = await makeAccount(tx, {
        currency: 'EGP',
        name: 'Cash',
        openingBalance: '10000.0000',
        openingRateToEgp: '1',
      });
      const to = await makeAccount(tx, {
        currency: 'EGP',
        name: 'Bank',
        openingBalance: '0.0000',
        openingRateToEgp: '1',
      });

      const group = asTransfer(
        await createTransaction(tx, {
          type: 'TRANSFER',
          fromAccountId: from.id,
          toAccountId: to.id,
          fromAmount: '2500',
          date: DATE,
          note: null,
        }),
      );

      expect(group.from.amount).toBe('-2500.0000');
      expect(group.to.amount).toBe('2500.0000');
      expect(group.from.transferGroupId).toBe(group.to.transferGroupId);
      expect(group.isCrossCurrency).toBe(false);
      expect(group.conversionCostEgp).toBeNull();

      // Balances are plain sums, because amounts carry their own sign.
      expect((await getAccount(tx, from.id)).balance).toBe('7500.0000');
      expect((await getAccount(tx, to.id)).balance).toBe('2500.0000');
    });
  });

  it('keeps each side in its own currency and reports the conversion cost', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const usd = await makeAccount(tx, {
        currency: 'USD',
        name: 'Bank USD',
        openingBalance: '1000.0000',
        openingRateToEgp: '50',
      });
      const egp = await makeAccount(tx, { currency: 'EGP', name: 'Cash EGP' });

      // $500 left, but only 24,000 EGP arrived — the bank's spread, not the mid rate.
      const group = asTransfer(
        await createTransaction(tx, {
          type: 'TRANSFER',
          fromAccountId: usd.id,
          toAccountId: egp.id,
          fromAmount: '500',
          toAmount: '24000',
          date: DATE,
          note: null,
        }),
      );

      expect(group.from.amount).toBe('-500.0000');
      expect(group.from.currency).toBe('USD');
      expect(group.from.amountEgp).toBe('-25000.0000');
      expect(group.to.amount).toBe('24000.0000');
      expect(group.to.currency).toBe('EGP');
      expect(group.to.amountEgp).toBe('24000.0000');

      expect(group.isCrossCurrency).toBe(true);
      // 25,000 left the ledger, 24,000 arrived: the spread took 1,000.
      expect(group.conversionCostEgp).toBe('1000.0000');

      expect((await getAccount(tx, usd.id)).balance).toBe('500.0000');
      expect((await getAccount(tx, egp.id)).balance).toBe('24000.0000');
    });
  });

  it('pre-fills the destination at the current rate when it is not given', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const usd = await makeAccount(tx, { currency: 'USD', name: 'USD' });
      const egp = await makeAccount(tx, { currency: 'EGP', name: 'EGP' });

      const group = asTransfer(
        await createTransaction(tx, {
          type: 'TRANSFER',
          fromAccountId: usd.id,
          toAccountId: egp.id,
          fromAmount: '500',
          date: DATE,
          note: null,
        }),
      );

      expect(group.to.amount).toBe('25000.0000');
      expect(group.conversionCostEgp).toBe('0.0000');
    });
  });

  it('refuses a transfer to the same account', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const account = await makeAccount(tx, { currency: 'EGP' });

      // Caught by the schema before it reaches the service.
      const { createTransactionSchema } = await import('@ledger/shared');
      const parsed = createTransactionSchema.safeParse({
        type: 'TRANSFER',
        fromAccountId: account.id,
        toAccountId: account.id,
        fromAmount: '100',
        date: DATE.toISOString(),
      });

      expect(parsed.success).toBe(false);
    });
  });

  it('deletes both rows together — half a transfer would break both balances', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const from = await makeAccount(tx, { currency: 'EGP', name: 'A' });
      const to = await makeAccount(tx, { currency: 'EGP', name: 'B' });

      const group = asTransfer(
        await createTransaction(tx, {
          type: 'TRANSFER',
          fromAccountId: from.id,
          toAccountId: to.id,
          fromAmount: '1000',
          date: DATE,
          note: null,
        }),
      );

      const result = await deleteTransaction(tx, group.from.id);

      expect(result.deletedIds).toHaveLength(2);
      expect(await tx.transaction.count()).toBe(0);
      expect((await getAccount(tx, from.id)).balance).toBe('0.0000');
      expect((await getAccount(tx, to.id)).balance).toBe('0.0000');
    });
  });

  it('edits both sides of a cross-currency transfer independently', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const usd = await makeAccount(tx, { currency: 'USD', name: 'USD' });
      const egp = await makeAccount(tx, { currency: 'EGP', name: 'EGP' });

      const group = asTransfer(
        await createTransaction(tx, {
          type: 'TRANSFER',
          fromAccountId: usd.id,
          toAccountId: egp.id,
          fromAmount: '500',
          toAmount: '24000',
          date: DATE,
          note: null,
        }),
      );

      const updated = asTransfer(await updateTransaction(tx, group.to.id, { toAmount: '24500' }));

      expect(updated.from.amount).toBe('-500.0000');
      expect(updated.to.amount).toBe('24500.0000');
      expect(updated.conversionCostEgp).toBe('500.0000');
    });
  });

  it('rejects `amount` on a transfer, pointing at the right fields', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const from = await makeAccount(tx, { currency: 'EGP', name: 'A' });
      const to = await makeAccount(tx, { currency: 'EGP', name: 'B' });

      const group = asTransfer(
        await createTransaction(tx, {
          type: 'TRANSFER',
          fromAccountId: from.id,
          toAccountId: to.id,
          fromAmount: '100',
          date: DATE,
          note: null,
        }),
      );

      await expect(updateTransaction(tx, group.from.id, { amount: '200' })).rejects.toMatchObject({
        status: 422,
      });
    });
  });

  it('exposes the group by its transferGroupId', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const from = await makeAccount(tx, { currency: 'EGP', name: 'A' });
      const to = await makeAccount(tx, { currency: 'EGP', name: 'B' });

      const group = asTransfer(
        await createTransaction(tx, {
          type: 'TRANSFER',
          fromAccountId: from.id,
          toAccountId: to.id,
          fromAmount: '100',
          date: DATE,
          note: null,
        }),
      );

      const fetched = await getTransferGroup(tx, group.transferGroupId);
      expect(fetched.from.id).toBe(group.from.id);
      expect(fetched.to.id).toBe(group.to.id);
    });
  });
});

describe('listing', () => {
  async function seedFive(tx: Parameters<Parameters<typeof withRollback>[0]>[0]) {
    await makeStandardRates(tx);
    const account = await makeAccount(tx, { currency: 'EGP' });
    const groceries = await makeCategory(tx, { kind: 'EXPENSE', name: 'Groceries' });

    for (const [index, amount] of ['100', '500', '2000', '7000', '25000'].entries()) {
      await createTransaction(tx, {
        type: 'EXPENSE',
        amount,
        accountId: account.id,
        categoryId: groceries.id,
        date: new Date(Date.UTC(2026, 7, index + 1)),
        note: index === 0 ? 'coffee at Gianaclis' : `row ${index}`,
      });
    }
    return { account, groceries };
  }

  it('paginates newest first', async () => {
    await withRollback(async (tx) => {
      await seedFive(tx);

      const page1 = await listTransactions(tx, { ...listDefaults, pageSize: 2 });

      expect(page1.data).toHaveLength(2);
      expect(page1.meta).toMatchObject({ page: 1, pageSize: 2, total: 5, totalPages: 3 });
      expect(page1.data[0]?.date.startsWith('2026-08-05')).toBe(true);
    });
  });

  it('filters by note, case-insensitively', async () => {
    await withRollback(async (tx) => {
      await seedFive(tx);

      const found = await listTransactions(tx, { ...listDefaults, q: 'GIANACLIS' });

      expect(found.data).toHaveLength(1);
      expect(found.data[0]?.note).toContain('Gianaclis');
    });
  });

  it('filters on the magnitude of amountEgp, not the signed value', async () => {
    await withRollback(async (tx) => {
      await seedFive(tx);

      // Expenses are stored negative; a "1000 and above" filter must still find them.
      const large = await listTransactions(tx, { ...listDefaults, minAmount: '1000' });
      expect(large.data.map((row) => row.amount).sort()).toEqual([
        '-2000.0000',
        '-25000.0000',
        '-7000.0000',
      ]);

      const small = await listTransactions(tx, { ...listDefaults, maxAmount: '500' });
      expect(small.data).toHaveLength(2);
    });
  });

  it('filters by date range', async () => {
    await withRollback(async (tx) => {
      await seedFive(tx);

      const window = await listTransactions(tx, {
        ...listDefaults,
        from: new Date(Date.UTC(2026, 7, 2)),
        to: new Date(Date.UTC(2026, 7, 4)),
      });

      expect(window.data).toHaveLength(3);
    });
  });

  it('attaches the counterpart to each side of a transfer', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const from = await makeAccount(tx, { currency: 'EGP', name: 'Cash' });
      const to = await makeAccount(tx, { currency: 'EGP', name: 'Bank' });

      await createTransaction(tx, {
        type: 'TRANSFER',
        fromAccountId: from.id,
        toAccountId: to.id,
        fromAmount: '300',
        date: DATE,
        note: null,
      });

      const listed = await listTransactions(tx, { ...listDefaults, type: 'TRANSFER' });

      expect(listed.data).toHaveLength(2);
      for (const row of listed.data) {
        expect(row.transferCounterpart).not.toBeNull();
        expect(row.transferCounterpart?.accountName).toBe(
          row.accountId === from.id ? 'Bank' : 'Cash',
        );
      }
    });
  });
});

describe('archived accounts', () => {
  it('refuses new transactions on an archived account', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const account = await makeAccount(tx, { currency: 'EGP', isArchived: true });

      await expect(
        createTransaction(tx, {
          type: 'EXPENSE',
          amount: '100',
          accountId: account.id,
          categoryId: null,
          date: TEST_NOW,
          note: null,
        }),
      ).rejects.toMatchObject({ status: 422 });
    });
  });
});
