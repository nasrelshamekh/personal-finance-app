import { describe, expect, it } from 'vitest';
import { withRollback } from '../../test/db';
import { makeAccount, makeStandardRates } from '../../test/factories';
import { getAccount } from '../accounts/service';
import { addContribution, createGoal, deleteGoal, getGoal } from './service';

const NOW = new Date('2026-08-15T12:00:00.000Z');
const DATE = new Date('2026-08-10T09:00:00.000Z');

async function makeGoal(
  tx: Parameters<Parameters<typeof withRollback>[0]>[0],
  overrides: Partial<{ targetAmount: string; currency: 'EGP' | 'USD'; deadline: Date | null }> = {},
) {
  return createGoal(tx, {
    name: 'New laptop',
    targetAmount: overrides.targetAmount ?? '60000',
    currency: overrides.currency ?? 'EGP',
    deadline: overrides.deadline === undefined ? null : overrides.deadline,
    color: '#2f8f5b',
    icon: 'piggy-bank',
  });
}

describe('progress lives in the goal currency (D4b)', () => {
  it('sums contributions in the goal currency, not in pounds', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      // A USD goal funded in pounds. USD/EGP is 50 in the fixtures.
      const goal = await makeGoal(tx, { targetAmount: '1000', currency: 'USD' });

      await addContribution(tx, goal.id, {
        amount: '10000',
        currency: 'EGP',
        date: DATE,
        accountId: null,
      });

      const after = await getGoal(tx, goal.id, NOW);

      // 10,000 EGP is $200, so the goal advances by 200 of its own currency.
      expect(after.contributions[0]?.amountInGoalCurrency).toBe('200.0000');
      expect(after.saved).toBe('200.0000');
      expect(after.remaining).toBe('800.0000');
      expect(after.progressPct).toBe('20.0000');
    });
  });

  it('keeps savedEgp as a display figure only', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const goal = await makeGoal(tx, { targetAmount: '1000', currency: 'USD' });

      await addContribution(tx, goal.id, { amount: '200', date: DATE, accountId: null });

      const after = await getGoal(tx, goal.id, NOW);
      expect(after.saved).toBe('200.0000');
      expect(after.savedEgp).toBe('10000.0000');
    });
  });

  it('never reports negative remaining once the target is passed', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const goal = await makeGoal(tx, { targetAmount: '1000' });

      await addContribution(tx, goal.id, { amount: '1500', date: DATE, accountId: null });

      const after = await getGoal(tx, goal.id, NOW);
      expect(after.remaining).toBe('0.0000');
      expect(after.isComplete).toBe(true);
      expect(after.progressPct).toBe('150.0000');
    });
  });
});

describe('monthlyNeeded', () => {
  it('is null without a deadline — there is nothing to divide by', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const goal = await makeGoal(tx, { deadline: null });

      const fetched = await getGoal(tx, goal.id, NOW);
      expect(fetched.monthlyNeeded).toBeNull();
      expect(fetched.monthsRemaining).toBeNull();
    });
  });

  it('divides what is left across the whole months remaining', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      // Mid-August, deadline end of December: four whole months left.
      const goal = await makeGoal(tx, {
        targetAmount: '60000',
        deadline: new Date('2026-12-31T00:00:00.000Z'),
      });

      const fetched = await getGoal(tx, goal.id, NOW);
      expect(fetched.monthsRemaining).toBe(4);
      expect(fetched.monthlyNeeded).toBe('15000.0000');
    });
  });

  it('asks for the whole remainder when the deadline is this month', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const goal = await makeGoal(tx, {
        targetAmount: '9000',
        deadline: new Date('2026-08-31T00:00:00.000Z'),
      });

      const fetched = await getGoal(tx, goal.id, NOW);
      // Zero months left must not divide by zero, and must not read as "nothing to do".
      expect(fetched.monthsRemaining).toBe(0);
      expect(fetched.monthlyNeeded).toBe('9000.0000');
    });
  });

  it('is zero once the target is reached, whatever the deadline', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const goal = await makeGoal(tx, {
        targetAmount: '1000',
        deadline: new Date('2026-12-31T00:00:00.000Z'),
      });

      await addContribution(tx, goal.id, { amount: '1000', date: DATE, accountId: null });

      expect((await getGoal(tx, goal.id, NOW)).monthlyNeeded).toBe('0.0000');
    });
  });
});

describe('contributions and accounts', () => {
  it('records nothing against an account when none is chosen', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const account = await makeAccount(tx, {
        currency: 'EGP',
        openingBalance: '50000.0000',
        openingRateToEgp: '1',
      });
      const goal = await makeGoal(tx);

      await addContribution(tx, goal.id, { amount: '5000', date: DATE, accountId: null });

      expect(await tx.transaction.count({ where: { accountId: account.id } })).toBe(0);
      expect((await getAccount(tx, account.id)).balance).toBe('50000.0000');
    });
  });

  it('takes the money out of the account when one is chosen', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const account = await makeAccount(tx, {
        currency: 'EGP',
        openingBalance: '50000.0000',
        openingRateToEgp: '1',
      });
      const goal = await makeGoal(tx);

      const after = await addContribution(tx, goal.id, {
        amount: '5000',
        date: DATE,
        accountId: account.id,
      });

      expect(after.saved).toBe('5000.0000');
      expect((await getAccount(tx, account.id)).balance).toBe('45000.0000');

      const written = await tx.transaction.findFirstOrThrow({
        where: { savingsContributionId: after.contributions[0]?.id ?? null },
      });
      expect(written.type).toBe('EXPENSE');
      expect(written.amount.toString()).toBe('-5000');
    });
  });

  it('deleting the goal also removes the transactions its contributions wrote', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const account = await makeAccount(tx, {
        currency: 'EGP',
        openingBalance: '50000.0000',
        openingRateToEgp: '1',
      });
      const goal = await makeGoal(tx);

      await addContribution(tx, goal.id, { amount: '5000', date: DATE, accountId: account.id });
      expect((await getAccount(tx, account.id)).balance).toBe('45000.0000');

      await deleteGoal(tx, goal.id);

      expect(await tx.transaction.count({ where: { accountId: account.id } })).toBe(0);
      expect((await getAccount(tx, account.id)).balance).toBe('50000.0000');
    });
  });

  it('rejects a zero or negative contribution', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      const goal = await makeGoal(tx);

      for (const amount of ['0', '-100']) {
        await expect(
          addContribution(tx, goal.id, { amount, date: DATE, accountId: null }),
        ).rejects.toMatchObject({ status: 400 });
      }
    });
  });
});
