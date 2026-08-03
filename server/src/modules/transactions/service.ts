import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import {
  BASE_CURRENCY,
  Decimal,
  TX_SIGN,
  isRateApproximate,
  type Currency,
  type CreateTransactionInput,
  type DeleteTransactionResponse,
  type ListTransactionsQuery,
  type Paginated,
  type TransactionDto,
  type TransferGroupDto,
  type UpdateTransactionInput,
} from '@ledger/shared';
import { AppError } from '../../lib/errors';
import { parsePositiveAmount } from '../../lib/amount';
import { abs, convert, sub, toRateString, toStorageString } from '../../lib/money';
import { getRate, type Db } from '../../lib/fx';
import { inTransaction } from '../../lib/tx';
import { requireActiveAccount } from '../accounts/service';
import { requireUsableCategory } from '../categories/service';

const transactionInclude = {
  account: { select: { id: true, name: true, currency: true, color: true, icon: true } },
  category: { select: { id: true, name: true, color: true, icon: true } },
} satisfies Prisma.TransactionInclude;

type TransactionRow = Prisma.TransactionGetPayload<{ include: typeof transactionInclude }>;

/**
 * The frozen trio, resolved once at write time and never recomputed on read (SPEC §4.4).
 * `rateAsOf` records which rate was actually used, so a backdated row can be recognised
 * as approximate later without guessing (D12).
 */
interface FrozenMoney {
  rateToEgp: string;
  amountEgp: string;
  rateAsOf: Date;
}

async function freeze(
  db: Db,
  signedAmount: Decimal,
  currency: Currency,
  date: Date,
): Promise<FrozenMoney> {
  const rate = await getRate(db, currency, BASE_CURRENCY, date);

  return {
    rateToEgp: toRateString(rate.rate),
    // Sign is carried through: amountEgp always matches the sign of amount (SPEC §4.7).
    amountEgp: toStorageString(convert(signedAmount, rate.rate)),
    rateAsOf: rate.asOf,
  };
}

function toDto(row: TransactionRow, counterpart: TransactionRow | undefined): TransactionDto {
  return {
    id: row.id,
    type: row.type,
    amount: toStorageString(row.amount.toString()),
    currency: row.currency,
    rateToEgp: toRateString(row.rateToEgp.toString()),
    amountEgp: toStorageString(row.amountEgp.toString()),
    rateAsOf: row.rateAsOf.toISOString(),
    // Derived, not stored: a second boolean could drift out of step with the dates (D12).
    rateIsApproximate: isRateApproximate(row.rateAsOf, row.date),
    date: row.date.toISOString(),
    note: row.note,
    accountId: row.accountId,
    account: row.account,
    categoryId: row.categoryId,
    category: row.category,
    transferGroupId: row.transferGroupId,
    transferCounterpart:
      counterpart === undefined
        ? null
        : {
            id: counterpart.id,
            accountId: counterpart.accountId,
            accountName: counterpart.account.name,
            amount: toStorageString(counterpart.amount.toString()),
            currency: counterpart.currency,
          },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Fills in the other half of each transfer in one extra query, rather than one per row.
 */
async function toDtos(db: Db, rows: TransactionRow[]): Promise<TransactionDto[]> {
  const groupIds = [
    ...new Set(rows.map((row) => row.transferGroupId).filter((id): id is string => id !== null)),
  ];

  if (groupIds.length === 0) {
    return rows.map((row) => toDto(row, undefined));
  }

  const siblings = await db.transaction.findMany({
    where: { transferGroupId: { in: groupIds } },
    include: transactionInclude,
  });

  return rows.map((row) =>
    toDto(
      row,
      row.transferGroupId === null
        ? undefined
        : siblings.find(
            (sibling) => sibling.transferGroupId === row.transferGroupId && sibling.id !== row.id,
          ),
    ),
  );
}

function buildWhere(query: ListTransactionsQuery): Prisma.TransactionWhereInput {
  const and: Prisma.TransactionWhereInput[] = [];

  if (query.from !== undefined) and.push({ date: { gte: query.from } });
  if (query.to !== undefined) and.push({ date: { lte: query.to } });
  if (query.type !== undefined) and.push({ type: query.type });
  if (query.accountId !== undefined) and.push({ accountId: query.accountId });
  if (query.categoryId !== undefined) and.push({ categoryId: query.categoryId });
  if (query.currency !== undefined) and.push({ currency: query.currency });
  if (query.q !== undefined) and.push({ note: { contains: query.q, mode: 'insensitive' } });

  // Amount filters compare *magnitudes* of amountEgp, so one threshold means the same
  // thing for income and expense and across currencies. Postgres has no abs() in a
  // Prisma filter, so the two-sided form is written out.
  if (query.minAmount !== undefined) {
    const min = toStorageString(query.minAmount);
    and.push({ OR: [{ amountEgp: { gte: min } }, { amountEgp: { lte: `-${min}` } }] });
  }
  if (query.maxAmount !== undefined) {
    const max = toStorageString(query.maxAmount);
    and.push({ amountEgp: { lte: max, gte: `-${max}` } });
  }

  return and.length === 0 ? {} : { AND: and };
}

export async function listTransactions(
  db: Db,
  query: ListTransactionsQuery,
): Promise<Paginated<TransactionDto>> {
  const where = buildWhere(query);

  const [total, rows] = await Promise.all([
    db.transaction.count({ where }),
    db.transaction.findMany({
      where,
      include: transactionInclude,
      // createdAt breaks ties so paging is stable when several rows share a date.
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    data: await toDtos(db, rows),
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  };
}

export async function getTransaction(db: Db, id: string): Promise<TransactionDto> {
  const row = await db.transaction.findUnique({ where: { id }, include: transactionInclude });
  if (!row) throw AppError.notFound('That transaction does not exist.');

  const [dto] = await toDtos(db, [row]);
  if (!dto) throw AppError.notFound('That transaction does not exist.');
  return dto;
}

async function createEntry(
  db: Db,
  input: Extract<CreateTransactionInput, { type: 'INCOME' | 'EXPENSE' }>,
): Promise<TransactionDto> {
  const account = await requireActiveAccount(db, input.accountId, 'accountId');

  // Accounts are single-currency (D3): reject a mismatch rather than converting silently.
  if (input.currency !== undefined && input.currency !== account.currency) {
    throw AppError.unprocessable(
      `${account.name} is a ${account.currency} account, so it cannot hold a ${input.currency} transaction. Use a transfer to move money between currencies.`,
      { field: 'currency', accountCurrency: account.currency },
    );
  }

  if (input.categoryId !== null) {
    await requireUsableCategory(db, input.categoryId, input.type);
  }

  const magnitude = parsePositiveAmount(input.amount, 'amount');
  const signed = magnitude.times(TX_SIGN[input.type]);
  const frozen = await freeze(db, signed, account.currency, input.date);

  const created = await db.transaction.create({
    data: {
      type: input.type,
      amount: toStorageString(signed),
      currency: account.currency,
      rateToEgp: frozen.rateToEgp,
      amountEgp: frozen.amountEgp,
      rateAsOf: frozen.rateAsOf,
      date: input.date,
      note: input.note,
      accountId: account.id,
      categoryId: input.categoryId,
    },
    include: transactionInclude,
  });

  return toDto(created, undefined);
}

/**
 * A transfer is two rows written together (D2), sharing a `transferGroupId`: an outflow on
 * the source in the source's currency, and an inflow on the destination in the
 * destination's currency. Each side freezes its own rate, exactly like any other row.
 */
async function createTransfer(
  db: Db,
  input: Extract<CreateTransactionInput, { type: 'TRANSFER' }>,
): Promise<TransferGroupDto> {
  const [fromAccount, toAccount] = await Promise.all([
    requireActiveAccount(db, input.fromAccountId, 'fromAccountId'),
    requireActiveAccount(db, input.toAccountId, 'toAccountId'),
  ]);

  const fromMagnitude = parsePositiveAmount(input.fromAmount, 'fromAmount');

  let toMagnitude: Decimal;
  if (input.toAmount !== undefined) {
    toMagnitude = parsePositiveAmount(input.toAmount, 'toAmount');
  } else if (fromAccount.currency === toAccount.currency) {
    toMagnitude = fromMagnitude;
  } else {
    // Pre-fill only. Send toAmount to record what actually landed — the bank's spread is
    // not the mid-market rate, and this is the figure that makes the balance right (D2).
    const crossRate = await getRate(db, fromAccount.currency, toAccount.currency, input.date);
    toMagnitude = convert(fromMagnitude, crossRate.rate);
  }

  const outflow = fromMagnitude.negated();
  const [outFrozen, inFrozen] = await Promise.all([
    freeze(db, outflow, fromAccount.currency, input.date),
    freeze(db, toMagnitude, toAccount.currency, input.date),
  ]);

  const transferGroupId = randomUUID();

  const rows = await inTransaction(db, async (tx) => {
    await tx.transaction.create({
      data: {
        type: 'TRANSFER',
        amount: toStorageString(outflow),
        currency: fromAccount.currency,
        rateToEgp: outFrozen.rateToEgp,
        amountEgp: outFrozen.amountEgp,
        rateAsOf: outFrozen.rateAsOf,
        date: input.date,
        note: input.note,
        accountId: fromAccount.id,
        categoryId: null,
        transferGroupId,
      },
    });
    await tx.transaction.create({
      data: {
        type: 'TRANSFER',
        amount: toStorageString(toMagnitude),
        currency: toAccount.currency,
        rateToEgp: inFrozen.rateToEgp,
        amountEgp: inFrozen.amountEgp,
        rateAsOf: inFrozen.rateAsOf,
        date: input.date,
        note: input.note,
        accountId: toAccount.id,
        categoryId: null,
        transferGroupId,
      },
    });

    return tx.transaction.findMany({
      where: { transferGroupId },
      include: transactionInclude,
    });
  });

  return buildTransferGroup(rows);
}

function buildTransferGroup(rows: TransactionRow[]): TransferGroupDto {
  const from = rows.find((row) => row.amount.isNegative());
  const to = rows.find((row) => !row.amount.isNegative());

  if (!from || !to) {
    throw new Error('A transfer group must have exactly one outflow and one inflow');
  }

  const isCrossCurrency = from.currency !== to.currency;

  return {
    transferGroupId: from.transferGroupId ?? '',
    from: toDto(from, to),
    to: toDto(to, from),
    isCrossCurrency,
    // What the spread actually took: what left, less what arrived, both at their own
    // frozen rates (D2). The outflow is stored negative, so its magnitude is what left.
    // Positive means the conversion cost money.
    conversionCostEgp: isCrossCurrency
      ? toStorageString(sub(abs(from.amountEgp.toString()), to.amountEgp.toString()))
      : null,
  };
}

export async function createTransaction(
  db: Db,
  input: CreateTransactionInput,
): Promise<TransactionDto | TransferGroupDto> {
  if (input.type === 'TRANSFER') {
    return createTransfer(db, input);
  }
  return createEntry(db, input);
}

function rejectUnknownFields(
  input: UpdateTransactionInput,
  fields: Array<keyof UpdateTransactionInput>,
  message: string,
): void {
  for (const field of fields) {
    if (input[field] !== undefined) {
      throw AppError.unprocessable(message, { field });
    }
  }
}

export async function updateTransaction(
  db: Db,
  id: string,
  input: UpdateTransactionInput,
): Promise<TransactionDto | TransferGroupDto> {
  const existing = await db.transaction.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound('That transaction does not exist.');

  if (existing.type === 'TRANSFER') {
    return updateTransfer(db, existing.transferGroupId, input);
  }

  rejectUnknownFields(
    input,
    ['fromAmount', 'toAmount'],
    'Only a transfer has two sides. Use `amount` on this transaction.',
  );

  const date = input.date ?? existing.date;
  const signed =
    input.amount === undefined
      ? new Decimal(existing.amount.toString())
      : parsePositiveAmount(input.amount, 'amount').times(TX_SIGN[existing.type]);

  if (input.categoryId !== undefined && input.categoryId !== null) {
    await requireUsableCategory(db, input.categoryId, existing.type);
  }

  // Re-freeze only when the amount or date moved (SPEC §4.4). Editing a note or a
  // category must never change what the transaction was worth.
  const needsRefreeze = input.amount !== undefined || input.date !== undefined;
  const frozen = needsRefreeze
    ? await freeze(db, signed, existing.currency, date)
    : {
        rateToEgp: existing.rateToEgp.toString(),
        amountEgp: existing.amountEgp.toString(),
        rateAsOf: existing.rateAsOf,
      };

  await db.transaction.update({
    where: { id },
    data: {
      ...(input.amount === undefined ? {} : { amount: toStorageString(signed) }),
      ...(input.date === undefined ? {} : { date }),
      ...(input.note === undefined ? {} : { note: input.note }),
      ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
      ...(needsRefreeze
        ? {
            rateToEgp: frozen.rateToEgp,
            amountEgp: frozen.amountEgp,
            rateAsOf: frozen.rateAsOf,
          }
        : {}),
    },
  });

  return getTransaction(db, id);
}

async function updateTransfer(
  db: Db,
  transferGroupId: string | null,
  input: UpdateTransactionInput,
): Promise<TransferGroupDto> {
  if (transferGroupId === null) {
    throw new Error('A TRANSFER row is missing its transferGroupId');
  }

  rejectUnknownFields(
    input,
    ['amount'],
    'A transfer has two sides. Use `fromAmount` and `toAmount`.',
  );
  rejectUnknownFields(
    input,
    ['categoryId'],
    'Transfers are excluded from category aggregates, so they carry no category.',
  );

  const rows = await db.transaction.findMany({
    where: { transferGroupId },
    include: transactionInclude,
  });
  const outflow = rows.find((row) => row.amount.isNegative());
  const inflow = rows.find((row) => !row.amount.isNegative());
  if (!outflow || !inflow) throw AppError.notFound('That transfer is incomplete.');

  const date = input.date ?? outflow.date;

  const updated = await inTransaction(db, async (tx) => {
    for (const [row, amountInput] of [
      [outflow, input.fromAmount],
      [inflow, input.toAmount],
    ] as const) {
      const isOutflow = row.amount.isNegative();
      const magnitude =
        amountInput === undefined
          ? row.amount.abs().toString()
          : toStorageString(
              parsePositiveAmount(amountInput, isOutflow ? 'fromAmount' : 'toAmount'),
            );

      const signed = isOutflow ? new Decimal(magnitude).negated() : new Decimal(magnitude);
      const needsRefreeze = amountInput !== undefined || input.date !== undefined;
      const frozen = needsRefreeze ? await freeze(tx, signed, row.currency, date) : null;

      await tx.transaction.update({
        where: { id: row.id },
        data: {
          ...(amountInput === undefined ? {} : { amount: toStorageString(signed) }),
          ...(input.date === undefined ? {} : { date }),
          ...(input.note === undefined ? {} : { note: input.note }),
          ...(frozen === null
            ? {}
            : {
                rateToEgp: frozen.rateToEgp,
                amountEgp: frozen.amountEgp,
                rateAsOf: frozen.rateAsOf,
              }),
        },
      });
    }

    return tx.transaction.findMany({ where: { transferGroupId }, include: transactionInclude });
  });

  return buildTransferGroup(updated);
}

/**
 * Deleting either row of a transfer removes both — they are one movement of money, and
 * leaving half behind would put both account balances permanently wrong.
 */
export async function deleteTransaction(db: Db, id: string): Promise<DeleteTransactionResponse> {
  const existing = await db.transaction.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound('That transaction does not exist.');

  if (existing.transferGroupId !== null) {
    const groupId = existing.transferGroupId;
    return inTransaction(db, async (tx) => {
      const rows = await tx.transaction.findMany({
        where: { transferGroupId: groupId },
        select: { id: true },
      });
      await tx.transaction.deleteMany({ where: { transferGroupId: groupId } });
      return { deletedIds: rows.map((row) => row.id) };
    });
  }

  await db.transaction.delete({ where: { id } });
  return { deletedIds: [id] };
}

export async function getTransferGroup(db: Db, transferGroupId: string): Promise<TransferGroupDto> {
  const rows = await db.transaction.findMany({
    where: { transferGroupId },
    include: transactionInclude,
  });
  if (rows.length === 0) throw AppError.notFound('That transfer does not exist.');

  return buildTransferGroup(rows);
}

/** Shared with the dashboard, which lists recent transactions in the same shape. */
export { transactionInclude, toDtos as transactionsToDtos };
