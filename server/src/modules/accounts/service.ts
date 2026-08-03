import type { Account, Prisma } from '@prisma/client';
import {
  BASE_CURRENCY,
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

function toDto(account: Account, totals: AccountTotals | undefined): AccountDto {
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
  };
}

export async function listAccounts(db: Db, includeArchived: boolean): Promise<AccountDto[]> {
  const where: Prisma.AccountWhereInput = includeArchived ? {} : { isArchived: false };

  const accounts = await db.account.findMany({
    where,
    orderBy: [{ isArchived: 'asc' }, { createdAt: 'asc' }],
  });

  const totals = await totalsByAccount(
    db,
    accounts.map((account) => account.id),
  );

  return accounts.map((account) => toDto(account, totals.get(account.id)));
}

export async function getAccount(db: Db, id: string): Promise<AccountDto> {
  const account = await db.account.findUnique({ where: { id } });
  if (!account) throw AppError.notFound('That account does not exist.');

  const totals = await totalsByAccount(db, [id]);
  return toDto(account, totals.get(id));
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

  return toDto(account, undefined);
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
  return { outcome: 'deleted', account: toDto(account, undefined) };
}

async function withTotals(db: Db, account: Account): Promise<AccountDto> {
  const totals = await totalsByAccount(db, [account.id]);
  return toDto(account, totals.get(account.id));
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
