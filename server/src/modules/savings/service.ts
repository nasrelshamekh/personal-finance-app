import type { Prisma, SavingsContribution, SavingsGoal, Transaction } from '@prisma/client';
import {
  BASE_CURRENCY,
  Decimal,
  isRateApproximate,
  type CreateContributionInput,
  type CreateSavingsGoalInput,
  type SavingsContributionDto,
  type SavingsGoalDto,
  type UpdateSavingsGoalInput,
} from '@ledger/shared';
import { AppError } from '../../lib/errors';
import { parsePositiveAmount } from '../../lib/amount';
import { div, mul, sub, sum, toRateString, toStorageString } from '../../lib/money';
import { getRate, type Db } from '../../lib/fx';
import { freezeInto } from '../../lib/freeze';
import { inTransaction } from '../../lib/tx';
import { requireActiveAccount } from '../accounts/service';

const goalInclude = {
  contributions: {
    orderBy: { date: 'desc' },
    include: { transaction: { select: { id: true } } },
  },
} satisfies Prisma.SavingsGoalInclude;

type GoalRow = SavingsGoal & {
  contributions: Array<SavingsContribution & { transaction: Pick<Transaction, 'id'> | null }>;
};

function contributionToDto(
  contribution: SavingsContribution & { transaction: Pick<Transaction, 'id'> | null },
): SavingsContributionDto {
  return {
    id: contribution.id,
    amount: toStorageString(contribution.amount.toString()),
    currency: contribution.currency,
    rateToGoalCurrency: toRateString(contribution.rateToGoalCurrency.toString()),
    amountInGoalCurrency: toStorageString(contribution.amountInGoalCurrency.toString()),
    rateToEgp: toRateString(contribution.rateToEgp.toString()),
    amountEgp: toStorageString(contribution.amountEgp.toString()),
    rateAsOf: contribution.rateAsOf.toISOString(),
    rateIsApproximate: isRateApproximate(contribution.rateAsOf, contribution.date),
    date: contribution.date.toISOString(),
    transactionId: contribution.transaction?.id ?? null,
  };
}

/**
 * Whole months from `now` to the deadline, floored at zero.
 *
 * Counted in calendar months rather than days-over-30: "you need X a month" is a claim
 * about how many more times you will put money aside, and that happens per month.
 */
function monthsUntil(deadline: Date, now: Date): number {
  const months =
    (deadline.getUTCFullYear() - now.getUTCFullYear()) * 12 +
    (deadline.getUTCMonth() - now.getUTCMonth());
  return Math.max(0, months);
}

async function toDto(db: Db, goal: GoalRow, now: Date): Promise<SavingsGoalDto> {
  const target = new Decimal(goal.targetAmount.toString());
  // Progress in the goal's own currency (D4b), from frozen per-contribution figures.
  const saved = sum(goal.contributions.map((c) => c.amountInGoalCurrency.toString()));
  const remaining = sub(target, saved);
  const isComplete = remaining.lessThanOrEqualTo(0);

  const rate = await getRate(db, goal.currency, BASE_CURRENCY, now);

  let monthsRemaining: number | null = null;
  let monthlyNeeded: string | null = null;

  if (goal.deadline !== null) {
    monthsRemaining = monthsUntil(goal.deadline, now);
    if (isComplete) {
      monthlyNeeded = '0.0000';
    } else if (monthsRemaining === 0) {
      // The deadline is this month or already gone: the whole remainder is due now,
      // rather than a division by zero or a reassuring blank.
      monthlyNeeded = toStorageString(remaining);
    } else {
      monthlyNeeded = toStorageString(div(remaining, monthsRemaining));
    }
  }

  return {
    id: goal.id,
    name: goal.name,
    targetAmount: toStorageString(target),
    currency: goal.currency,
    deadline: goal.deadline?.toISOString() ?? null,
    color: goal.color,
    icon: goal.icon,
    isArchived: goal.isArchived,

    saved: toStorageString(saved),
    remaining: toStorageString(remaining.lessThan(0) ? new Decimal(0) : remaining),
    progressPct: target.isZero() ? '0.0000' : toStorageString(mul(div(saved, target), '100')),

    savedEgp: toStorageString(mul(saved, rate.rate)),

    monthlyNeeded,
    monthsRemaining,
    isComplete,

    contributions: goal.contributions.map(contributionToDto),
    createdAt: goal.createdAt.toISOString(),
  };
}

export async function listGoals(
  db: Db,
  includeArchived: boolean,
  now: Date = new Date(),
): Promise<SavingsGoalDto[]> {
  const goals = await db.savingsGoal.findMany({
    where: includeArchived ? {} : { isArchived: false },
    include: goalInclude,
    orderBy: [
      { isArchived: 'asc' },
      { deadline: { sort: 'asc', nulls: 'last' } },
      { createdAt: 'asc' },
    ],
  });

  return Promise.all(goals.map((goal) => toDto(db, goal, now)));
}

export async function getGoal(db: Db, id: string, now: Date = new Date()): Promise<SavingsGoalDto> {
  const goal = await db.savingsGoal.findUnique({ where: { id }, include: goalInclude });
  if (!goal) throw AppError.notFound('That savings goal does not exist.');

  return toDto(db, goal, now);
}

export async function createGoal(db: Db, input: CreateSavingsGoalInput): Promise<SavingsGoalDto> {
  const target = parsePositiveAmount(input.targetAmount, 'targetAmount');

  const goal = await db.savingsGoal.create({
    data: {
      name: input.name,
      targetAmount: toStorageString(target),
      currency: input.currency,
      deadline: input.deadline,
      color: input.color,
      icon: input.icon,
    },
  });

  return getGoal(db, goal.id);
}

export async function updateGoal(
  db: Db,
  id: string,
  input: UpdateSavingsGoalInput,
): Promise<SavingsGoalDto> {
  const existing = await db.savingsGoal.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound('That savings goal does not exist.');

  const target =
    input.targetAmount === undefined
      ? undefined
      : parsePositiveAmount(input.targetAmount, 'targetAmount');

  await db.savingsGoal.update({
    where: { id },
    data: {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(target === undefined ? {} : { targetAmount: toStorageString(target) }),
      ...(input.deadline === undefined ? {} : { deadline: input.deadline }),
      ...(input.color === undefined ? {} : { color: input.color }),
      ...(input.icon === undefined ? {} : { icon: input.icon }),
      ...(input.isArchived === undefined ? {} : { isArchived: input.isArchived }),
    },
  });

  return getGoal(db, id);
}

/**
 * Deletes a goal, its contributions, and the transactions they wrote.
 *
 * Same reasoning as deleting a debt: contributions cascade, but the transactions link
 * with `SetNull` and would otherwise survive as orphans holding money out of an account
 * for a goal that no longer exists.
 */
export async function deleteGoal(db: Db, id: string): Promise<{ id: string }> {
  const existing = await db.savingsGoal.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound('That savings goal does not exist.');

  await inTransaction(db, async (tx) => {
    const contributions = await tx.savingsContribution.findMany({
      where: { goalId: id },
      select: { id: true },
    });

    await tx.transaction.deleteMany({
      where: { savingsContributionId: { in: contributions.map((c) => c.id) } },
    });
    await tx.savingsGoal.delete({ where: { id } });
  });

  return { id };
}

/**
 * Records a contribution, and optionally the money leaving an account to fund it.
 *
 * Same shape as a debt payment: written together in one transaction, because a
 * contribution without the balance change is a figure that never happened.
 */
export async function addContribution(
  db: Db,
  goalId: string,
  input: CreateContributionInput,
): Promise<SavingsGoalDto> {
  const goal = await db.savingsGoal.findUnique({ where: { id: goalId } });
  if (!goal) throw AppError.notFound('That savings goal does not exist.');

  const amount = parsePositiveAmount(input.amount, 'amount');

  const account =
    input.accountId === null ? null : await requireActiveAccount(db, input.accountId, 'accountId');

  const currency = account?.currency ?? input.currency ?? goal.currency;

  if (account !== null && input.currency !== undefined && input.currency !== account.currency) {
    throw AppError.unprocessable(
      `${account.name} is a ${account.currency} account, so the contribution must be in ${account.currency}.`,
      { field: 'currency', accountCurrency: account.currency },
    );
  }

  const frozen = await freezeInto(db, amount, currency, goal.currency, input.date);

  await inTransaction(db, async (tx) => {
    const contribution = await tx.savingsContribution.create({
      data: {
        goalId,
        amount: toStorageString(amount),
        currency,
        rateToGoalCurrency: frozen.rateToTarget,
        amountInGoalCurrency: frozen.amountInTarget,
        rateToEgp: frozen.rateToEgp,
        amountEgp: frozen.amountEgp,
        rateAsOf: frozen.rateAsOf,
        date: input.date,
      },
    });

    if (account !== null) {
      // Putting money aside is money leaving the account it came from.
      await tx.transaction.create({
        data: {
          type: 'EXPENSE',
          amount: toStorageString(amount.negated()),
          currency: account.currency,
          rateToEgp: frozen.rateToEgp,
          amountEgp: toStorageString(new Decimal(frozen.amountEgp).negated()),
          rateAsOf: frozen.rateAsOf,
          date: input.date,
          note: `Saved towards ${goal.name}`,
          accountId: account.id,
          categoryId: null,
          savingsContributionId: contribution.id,
        },
      });
    }
  });

  return getGoal(db, goalId);
}

export async function deleteContribution(
  db: Db,
  goalId: string,
  contributionId: string,
): Promise<SavingsGoalDto> {
  const contribution = await db.savingsContribution.findUnique({ where: { id: contributionId } });
  if (!contribution || contribution.goalId !== goalId) {
    throw AppError.notFound('That contribution does not exist.');
  }

  await inTransaction(db, async (tx) => {
    await tx.transaction.deleteMany({ where: { savingsContributionId: contributionId } });
    await tx.savingsContribution.delete({ where: { id: contributionId } });
  });

  return getGoal(db, goalId);
}
