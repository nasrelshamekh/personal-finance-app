import { describe, expect, it } from 'vitest';
import { withRollback } from '../../test/db';
import { makeAccount, makeStandardRates } from '../../test/factories';
import { getAccount } from '../accounts/service';
import {
  addDebtPayment,
  createDebt,
  deleteDebt,
  deleteDebtPayment,
  getDebt,
  listDebts,
} from './service';

const NOW = new Date('2026-08-15T12:00:00.000Z');
const DATE = new Date('2026-08-10T09:00:00.000Z');

async function makeDebt(
  tx: Parameters<Parameters<typeof withRollback>[0]>[0],
  overrides: Partial<{
    counterparty: string;
    direction: 'I_OWE' | 'OWED_TO_ME';
    principal: string;
    currency: 'EGP' | 'USD';
    dueDate: Date | null;
  }> = {},
) {
  return createDebt(tx, {
    counterparty: overrides.counterparty ?? 'Amir',
    direction: overrides.direction ?? 'I_OWE',
    principal: overrides.principal ?? '10000',
    currency: overrides.currency ?? 'EGP',
    startDate: new Date('2026-07-01T00:00:00.000Z'),
    dueDate: overrides.dueDate === undefined ? null : overrides.dueDate,
    note: null,
  });
}

describe('remaining lives in the debt currency (D4)', () => {
  it('is principal less the sum of payments', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const debt = await makeDebt(tx, { principal: '10000' });

      await addDebtPayment(tx, debt.id, {
        amount: '2500',
        date: DATE,
        note: null,
        accountId: null,
      });

      const after = await getDebt(tx, debt.id, NOW);
      expect(after.paid).toBe('2500.0000');
      expect(after.remaining).toBe('7500.0000');
      expect(after.progressPct).toBe('25.0000');
    });
  });

  it('converts a foreign payment into the debt currency at the payment date', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      // A USD debt paid partly in pounds. USD/EGP is 50 in the fixtures.
      const debt = await makeDebt(tx, { principal: '1000', currency: 'USD' });

      await addDebtPayment(tx, debt.id, {
        amount: '10000',
        currency: 'EGP',
        date: DATE,
        note: null,
        accountId: null,
      });

      const after = await getDebt(tx, debt.id, NOW);
      const payment = after.payments[0];

      // 10,000 EGP is $200 at 50, so the debt drops by 200 of its own currency.
      expect(payment?.amountInDebtCurrency).toBe('200.0000');
      expect(payment?.rateToDebtCurrency).toBe('0.02000000');
      expect(after.remaining).toBe('800.0000');
    });
  });

  it('keeps remainingEgp as a display figure, separate from the balance', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const debt = await makeDebt(tx, { principal: '1000', currency: 'USD' });

      const after = await getDebt(tx, debt.id, NOW);
      expect(after.remaining).toBe('1000.0000');
      // 1,000 USD at 50 — a live conversion of the native balance, not part of it.
      expect(after.remainingEgp).toBe('50000.0000');
    });
  });
});

describe('logging a payment optionally writes the transaction (SPEC §12)', () => {
  it('writes nothing to any account when no account is chosen', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const account = await makeAccount(tx, { currency: 'EGP', openingBalance: '20000.0000' });
      const debt = await makeDebt(tx);

      await addDebtPayment(tx, debt.id, {
        amount: '2500',
        date: DATE,
        note: null,
        accountId: null,
      });

      // Scoped to this account: the database holds real data, and a global count would
      // both fail here and tempt someone into deleting it.
      expect(await tx.transaction.count({ where: { accountId: account.id } })).toBe(0);
      expect((await getAccount(tx, account.id)).balance).toBe('20000.0000');
      expect((await getDebt(tx, debt.id, NOW)).remaining).toBe('7500.0000');
    });
  });

  it('writes a matching expense and moves the balance when an account is chosen', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const account = await makeAccount(tx, {
        currency: 'EGP',
        openingBalance: '20000.0000',
        openingRateToEgp: '1',
      });
      const debt = await makeDebt(tx, { direction: 'I_OWE', principal: '10000' });

      const after = await addDebtPayment(tx, debt.id, {
        amount: '2500',
        date: DATE,
        note: null,
        accountId: account.id,
      });

      // The debt balance moved...
      expect(after.remaining).toBe('7500.0000');
      // ...and so did the account's.
      expect((await getAccount(tx, account.id)).balance).toBe('17500.0000');

      const written = await tx.transaction.findFirstOrThrow({
        where: { debtPaymentId: after.payments[0]?.id ?? null },
      });
      expect(written.type).toBe('EXPENSE');
      // Signed, like any other row (SPEC §4.7).
      expect(written.amount.toString()).toBe('-2500');
      expect(after.payments[0]?.transactionId).toBe(written.id);
    });
  });

  it('records income when the money is coming back to you', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const account = await makeAccount(tx, { currency: 'EGP', openingRateToEgp: '1' });
      const debt = await makeDebt(tx, { direction: 'OWED_TO_ME', principal: '4000' });

      const after = await addDebtPayment(tx, debt.id, {
        amount: '1500',
        date: DATE,
        note: null,
        accountId: account.id,
      });

      const written = await tx.transaction.findFirstOrThrow({
        where: { debtPaymentId: after.payments[0]?.id ?? null },
      });
      expect(written.type).toBe('INCOME');
      expect(written.amount.toString()).toBe('1500');
      expect((await getAccount(tx, account.id)).balance).toBe('1500.0000');
    });
  });

  it('refuses an account whose currency does not match the payment (D3)', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const usdAccount = await makeAccount(tx, { currency: 'USD' });
      const debt = await makeDebt(tx, { currency: 'EGP' });

      await expect(
        addDebtPayment(tx, debt.id, {
          amount: '100',
          currency: 'EGP',
          date: DATE,
          note: null,
          accountId: usdAccount.id,
        }),
      ).rejects.toMatchObject({ status: 422 });
    });
  });

  it('removes the linked transaction when the payment is removed', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const account = await makeAccount(tx, {
        currency: 'EGP',
        openingBalance: '20000.0000',
        openingRateToEgp: '1',
      });
      const debt = await makeDebt(tx);

      const after = await addDebtPayment(tx, debt.id, {
        amount: '2500',
        date: DATE,
        note: null,
        accountId: account.id,
      });
      const paymentId = after.payments[0]?.id ?? '';

      const reverted = await deleteDebtPayment(tx, debt.id, paymentId);

      expect(reverted.remaining).toBe('10000.0000');
      expect(await tx.transaction.count({ where: { accountId: account.id } })).toBe(0);
      expect((await getAccount(tx, account.id)).balance).toBe('20000.0000');
    });
  });

  it('deleting the debt also removes the transactions its payments wrote', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const account = await makeAccount(tx, {
        currency: 'EGP',
        openingBalance: '20000.0000',
        openingRateToEgp: '1',
      });
      const debt = await makeDebt(tx);

      await addDebtPayment(tx, debt.id, {
        amount: '2500',
        date: DATE,
        note: null,
        accountId: account.id,
      });
      expect((await getAccount(tx, account.id)).balance).toBe('17500.0000');

      await deleteDebt(tx, debt.id);

      // Prisma cascades the payment, but the transaction links with SetNull — without
      // clearing it explicitly the balance would stay reduced for a debt that is gone.
      expect(await tx.transaction.count({ where: { accountId: account.id } })).toBe(0);
      expect((await getAccount(tx, account.id)).balance).toBe('20000.0000');
    });
  });

  it('rejects a zero or negative payment', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const debt = await makeDebt(tx);

      for (const amount of ['0', '-100']) {
        await expect(
          addDebtPayment(tx, debt.id, { amount, date: DATE, note: null, accountId: null }),
        ).rejects.toMatchObject({ status: 400 });
      }
    });
  });
});

describe('due dates', () => {
  it('marks an active debt past its date as overdue', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      await tx.debt.deleteMany({});
      await makeDebt(tx, { dueDate: new Date('2026-08-01T00:00:00.000Z') });

      const [debt] = await listDebts(tx, {}, NOW);
      expect(debt?.isOverdue).toBe(true);
      expect(debt?.daysUntilDue).toBeLessThan(0);
    });
  });

  it('does not call a settled debt overdue', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      await tx.debt.deleteMany({});
      const debt = await makeDebt(tx, { dueDate: new Date('2026-08-01T00:00:00.000Z') });
      await tx.debt.update({ where: { id: debt.id }, data: { status: 'SETTLED' } });

      expect((await getDebt(tx, debt.id, NOW)).isOverdue).toBe(false);
    });
  });

  it('refuses a due date before the start date', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);

      await expect(
        createDebt(tx, {
          counterparty: 'Nadia',
          direction: 'I_OWE',
          principal: '500',
          currency: 'EGP',
          startDate: new Date('2026-08-01T00:00:00.000Z'),
          dueDate: new Date('2026-07-01T00:00:00.000Z'),
          note: null,
        }),
      ).rejects.toMatchObject({ status: 422 });
    });
  });
});
