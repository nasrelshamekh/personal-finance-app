import type { Account, Prisma } from '@prisma/client';
import {
  BASE_CURRENCY,
  Decimal,
  type AccountDto,
  type CreateAccountInput,
  type DeleteAccountResponse,
  type UpdateAccountInput,
} from '@ledger/shared';
import { AppError } from '../../lib/errors';
import { parseAmount } from '../../lib/amount';
import { add, convert, toRateString, toStorageString } from '../../lib/money';
import { getRate, type Db } from '../../lib/fx';

/** Signed sums per account, so a balance is a plain addition (SPEC §4.7). */
interface AccountTotals {
  amount: string;
  amountEgp: string;
  count: number;
}

async function totalsByAccount(db: Db, accountIds: string[]): Promise<Map<string, AccountTotals>> {
  if (accountIds.length === 0) return new Map();

  const grouped = await db.transaction.groupBy({
    by: ['accountId'],
    where: { accountId: { in: accountIds } },
    _sum: { amount: true, amountEgp: true },
    _count: { _all: true },
  });

  return new Map(
    grouped.map((row) => [
      row.accountId,
      {
        // Prisma Decimals are stringified the instant they leave Prisma (SPEC §2).
        amount: row._sum.amount?.toString() ?? '0',
        amountEgp: row._sum.amountEgp?.toString() ?? '0',
        count: row._count._all,
      },
    ]),
  );
}

/** How many days the accounts screen's sparkline covers (SPEC §9). */
const HISTORY_DAYS = 30;

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Closing balance per day for the last 30 days, per account, in the account's own currency.
 *
 * Built from two reads rather than thirty: the balance carried into the window, then every
 * row inside it bucketed by day and accumulated forward. The series starts at the account's
 * opening date when that falls inside the window, so a young account reports the days it
 * actually existed instead of a flat run of invented ones — which is also what stops the
 * sparkline drawing a straight line implying a fortnight of stability that never happened.
 */
async function historyByAccount(
  db: Db,
  accounts: Account[],
  now: Date,
): Promise<Map<string, string[]>> {
  const history = new Map<string, string[]>();
  if (accounts.length === 0) return history;

  const today = startOfUtcDay(now);
  const windowStart = new Date(today.getTime() - (HISTORY_DAYS - 1) * 24 * 60 * 60 * 1000);
  const ids = accounts.map((account) => account.id);

  const [carried, inWindow] = await Promise.all([
    db.transaction.groupBy({
      by: ['accountId'],
      where: { accountId: { in: ids }, date: { lt: windowStart } },
      _sum: { amount: true },
    }),
    db.transaction.findMany({
      where: { accountId: { in: ids }, date: { gte: windowStart } },
      select: { accountId: true, date: true, amount: true },
    }),
  ]);

  const before = new Map(carried.map((row) => [row.accountId, row._sum.amount?.toString() ?? '0']));

  const movementsByDay = new Map<string, Decimal>();
  for (const row of inWindow) {
    const key = `${row.accountId}:${startOfUtcDay(row.date).toISOString()}`;
    movementsByDay.set(key, add(movementsByDay.get(key) ?? '0', row.amount.toString()));
  }

  for (const account of accounts) {
    const opened = startOfUtcDay(account.openingDate);
    const from = opened > windowStart ? opened : windowStart;

    let running = add(account.openingBalance.toString(), before.get(account.id) ?? '0');
    const points: string[] = [];

    for (let day = new Date(windowStart); day <= today; day.setUTCDate(day.getUTCDate() + 1)) {
      running = add(running, movementsByDay.get(`${account.id}:${day.toISOString()}`) ?? '0');
      // Days before the account existed are skipped, not zeroed: it had no balance then,
      // and a zero would draw a cliff on the first day it was opened.
      if (day >= from) points.push(toStorageString(running));
    }

    history.set(account.id, points);
  }

  return history;
}

function toDto(
  account: Account,
  totals: AccountTotals | undefined,
  balanceHistory: string[],
): AccountDto {
  const summed = totals ?? { amount: '0', amountEgp: '0', count: 0 };

  return {
    id: account.id,
    name: account.name,
    type: account.type,
    currency: account.currency,
    openingBalance: toStorageString(account.openingBalance.toString()),
    openingDate: account.openingDate.toISOString(),
    openingRateToEgp: toRateString(account.openingRateToEgp.toString()),
    openingBalanceEgp: toStorageString(account.openingBalanceEgp.toString()),
    color: account.color,
    icon: account.icon,
    isArchived: account.isArchived,
    createdAt: account.createdAt.toISOString(),
    // Derived, never stored — and a plain sum, because amounts carry their own sign.
    balance: toStorageString(add(account.openingBalance.toString(), summed.amount)),
    balanceEgp: toStorageString(add(account.openingBalanceEgp.toString(), summed.amountEgp)),
    transactionCount: summed.count,
    balanceHistory,
  };
}

export async function listAccounts(
  db: Db,
  includeArchived: boolean,
  now: Date = new Date(),
): Promise<AccountDto[]> {
  const where: Prisma.AccountWhereInput = includeArchived ? {} : { isArchived: false };

  const accounts = await db.account.findMany({
    where,
    orderBy: [{ isArchived: 'asc' }, { createdAt: 'asc' }],
  });

  const ids = accounts.map((account) => account.id);
  const [totals, history] = await Promise.all([
    totalsByAccount(db, ids),
    historyByAccount(db, accounts, now),
  ]);

  return accounts.map((account) =>
    toDto(account, totals.get(account.id), history.get(account.id) ?? []),
  );
}

export async function getAccount(db: Db, id: string, now: Date = new Date()): Promise<AccountDto> {
  const account = await db.account.findUnique({ where: { id } });
  if (!account) throw AppError.notFound('That account does not exist.');

  const [totals, history] = await Promise.all([
    totalsByAccount(db, [id]),
    historyByAccount(db, [account], now),
  ]);

  return toDto(account, totals.get(id), history.get(id) ?? []);
}

/**
 * The opening rate is resolved once, at the opening date, and frozen (D5). That is what
 * makes `netWorthEgp(at)` a comparison of historical figures rather than two snapshots of
 * today's rate wearing different hats.
 */
export async function createAccount(db: Db, input: CreateAccountInput): Promise<AccountDto> {
  const openingDate = input.openingDate ?? new Date();
  const openingBalance = parseAmount(input.openingBalance, 'openingBalance');

  const rate = await getRate(db, input.currency, BASE_CURRENCY, openingDate);

  const account = await db.account.create({
    data: {
      name: input.name,
      type: input.type,
      currency: input.currency,
      openingBalance: toStorageString(openingBalance),
      openingDate,
      openingRateToEgp: toRateString(rate.rate),
      openingBalanceEgp: toStorageString(convert(openingBalance, rate.rate)),
      color: input.color,
      icon: input.icon,
    },
  });

  return toDto(account, undefined, [toStorageString(account.openingBalance.toString())]);
}

export async function updateAccount(
  db: Db,
  id: string,
  input: UpdateAccountInput,
): Promise<AccountDto> {
  const existing = await db.account.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound('That account does not exist.');

  // Built by spreading rather than passed through: `exactOptionalPropertyTypes` treats an
  // explicit `undefined` as a value, and Prisma would read it as "set this to undefined".
  await db.account.update({
    where: { id },
    data: {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.type === undefined ? {} : { type: input.type }),
      ...(input.color === undefined ? {} : { color: input.color }),
      ...(input.icon === undefined ? {} : { icon: input.icon }),
      ...(input.isArchived === undefined ? {} : { isArchived: input.isArchived }),
    },
  });
  return getAccount(db, id);
}

/**
 * Deleting an account that holds transactions archives it instead (SPEC §7).
 *
 * Removing it outright would either orphan its history or take the history with it, and
 * both of those change past figures. An empty account has no history to protect, so it is
 * genuinely deleted.
 */
export async function deleteAccount(db: Db, id: string): Promise<DeleteAccountResponse> {
  const account = await db.account.findUnique({ where: { id } });
  if (!account) throw AppError.notFound('That account does not exist.');

  const transactionCount = await db.transaction.count({ where: { accountId: id } });

  if (transactionCount > 0) {
    const archived = await db.account.update({ where: { id }, data: { isArchived: true } });
    return { outcome: 'archived', account: await withTotals(db, archived) };
  }

  await db.account.delete({ where: { id } });
  return { outcome: 'deleted', account: toDto(account, undefined, []) };
}

async function withTotals(db: Db, account: Account): Promise<AccountDto> {
  const [totals, history] = await Promise.all([
    totalsByAccount(db, [account.id]),
    historyByAccount(db, [account], new Date()),
  ]);
  return toDto(account, totals.get(account.id), history.get(account.id) ?? []);
}

/** Shared by the transaction service, which must check currency and archive state. */
export async function requireActiveAccount(db: Db, id: string, field: string): Promise<Account> {
  const account = await db.account.findUnique({ where: { id } });
  if (!account) {
    throw AppError.unprocessable('That account does not exist.', { field });
  }
  if (account.isArchived) {
    throw AppError.unprocessable(
      `${account.name} is archived. Restore it before adding transactions to it.`,
      { field },
    );
  }
  return account;
}
