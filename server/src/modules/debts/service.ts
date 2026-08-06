import type { Debt, DebtPayment, Prisma, Transaction } from '@prisma/client';
import {
  BASE_CURRENCY,
  Decimal,
  isRateApproximate,
  type CreateDebtInput,
  type CreateDebtPaymentInput,
  type DebtDirection,
  type DebtDto,
  type DebtPaymentDto,
  type DebtStatus,
  type UpdateDebtInput,
} from '@ledger/shared';
import { AppError } from '../../lib/errors';
import { parsePositiveAmount } from '../../lib/amount';
import { div, mul, sub, sum, toRateString, toStorageString } from '../../lib/money';
import { getRate, type Db } from '../../lib/fx';
import { freezeInto } from '../../lib/freeze';
import { inTransaction } from '../../lib/tx';
import { requireActiveAccount } from '../accounts/service';

const debtInclude = {
  payments: {
    orderBy: { date: 'desc' },
    include: { transaction: { select: { id: true } } },
  },
} satisfies Prisma.DebtInclude;

type DebtRow = Debt & {
  payments: Array<DebtPayment & { transaction: Pick<Transaction, 'id'> | null }>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function paymentToDto(
  payment: DebtPayment & { transaction: Pick<Transaction, 'id'> | null },
): DebtPaymentDto {
  return {
    id: payment.id,
    amount: toStorageString(payment.amount.toString()),
    currency: payment.currency,
    rateToDebtCurrency: toRateString(payment.rateToDebtCurrency.toString()),
    amountInDebtCurrency: toStorageString(payment.amountInDebtCurrency.toString()),
    rateToEgp: toRateString(payment.rateToEgp.toString()),
    amountEgp: toStorageString(payment.amountEgp.toString()),
    rateAsOf: payment.rateAsOf.toISOString(),
    rateIsApproximate: isRateApproximate(payment.rateAsOf, payment.date),
    date: payment.date.toISOString(),
    note: payment.note,
    transactionId: payment.transaction?.id ?? null,
  };
}

/**
 * Everything derived about a debt.
 *
 * `remaining` is computed wholly in the debt's own currency (D4): principal less the sum
 * of each payment's frozen `amountInDebtCurrency`. `remainingEgp` is a live conversion of
 * that figure and is labelled as such — it is never mixed back into the balance.
 */
async function toDto(db: Db, debt: DebtRow, now: Date): Promise<DebtDto> {
  const principal = new Decimal(debt.principal.toString());
  const paid = sum(debt.payments.map((payment) => payment.amountInDebtCurrency.toString()));
  const remaining = sub(principal, paid);

  const rate = await getRate(db, debt.currency, BASE_CURRENCY, now);

  const daysUntilDue =
    debt.dueDate === null ? null : Math.ceil((debt.dueDate.getTime() - now.getTime()) / DAY_MS);

  return {
    id: debt.id,
    counterparty: debt.counterparty,
    direction: debt.direction,
    principal: toStorageString(principal),
    currency: debt.currency,
    startDate: debt.startDate.toISOString(),
    dueDate: debt.dueDate?.toISOString() ?? null,
    status: debt.status,
    note: debt.note,

    paid: toStorageString(paid),
    remaining: toStorageString(remaining),
    progressPct: principal.isZero() ? '0.0000' : toStorageString(mul(div(paid, principal), '100')),

    remainingEgp: toStorageString(mul(remaining, rate.rate)),
    remainingEgpStale: rate.stale,

    daysUntilDue,
    // Settled debts are never overdue, however far past the date they are.
    isOverdue: debt.status === 'ACTIVE' && daysUntilDue !== null && daysUntilDue < 0,

    payments: debt.payments.map(paymentToDto),
    createdAt: debt.createdAt.toISOString(),
  };
}

export async function listDebts(
  db: Db,
  options: { direction?: DebtDirection; status?: DebtStatus },
  now: Date = new Date(),
): Promise<DebtDto[]> {
  const where: Prisma.DebtWhereInput = {
    ...(options.direction === undefined ? {} : { direction: options.direction }),
    ...(options.status === undefined ? {} : { status: options.status }),
  };

  const debts = await db.debt.findMany({
    where,
    include: debtInclude,
    // Soonest due first; debts with no date sit at the end rather than jumping the queue.
    orderBy: [{ status: 'asc' }, { dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
  });

  return Promise.all(debts.map((debt) => toDto(db, debt, now)));
}

export async function getDebt(db: Db, id: string, now: Date = new Date()): Promise<DebtDto> {
  const debt = await db.debt.findUnique({ where: { id }, include: debtInclude });
  if (!debt) throw AppError.notFound('That debt does not exist.');

  return toDto(db, debt, now);
}

export async function createDebt(db: Db, input: CreateDebtInput): Promise<DebtDto> {
  const principal = parsePositiveAmount(input.principal, 'principal');

  if (input.dueDate !== null && input.dueDate < input.startDate) {
    throw AppError.unprocessable('The due date cannot be before the start date.', {
      field: 'dueDate',
    });
  }

  const debt = await db.debt.create({
    data: {
      counterparty: input.counterparty,
      direction: input.direction,
      principal: toStorageString(principal),
      currency: input.currency,
      startDate: input.startDate,
      dueDate: input.dueDate,
      note: input.note,
    },
  });

  return getDebt(db, debt.id);
}

export async function updateDebt(db: Db, id: string, input: UpdateDebtInput): Promise<DebtDto> {
  const existing = await db.debt.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound('That debt does not exist.');

  const principal =
    input.principal === undefined ? undefined : parsePositiveAmount(input.principal, 'principal');

  await db.debt.update({
    where: { id },
    data: {
      ...(input.counterparty === undefined ? {} : { counterparty: input.counterparty }),
      ...(principal === undefined ? {} : { principal: toStorageString(principal) }),
      ...(input.startDate === undefined ? {} : { startDate: input.startDate }),
      ...(input.dueDate === undefined ? {} : { dueDate: input.dueDate }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.note === undefined ? {} : { note: input.note }),
    },
  });

  return getDebt(db, id);
}

/**
 * Deletes a debt, its payments, and the transactions those payments wrote.
 *
 * Prisma cascades the payments, but `Transaction.debtPaymentId` is `SetNull` — so
 * without this the transactions would survive as orphans, leaving account balances
 * reduced by payments toward a debt that no longer exists. Deleting a single payment
 * already removes its transaction; deleting the whole debt must not behave differently.
 */
export async function deleteDebt(db: Db, id: string): Promise<{ id: string }> {
  const existing = await db.debt.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound('That debt does not exist.');

  await inTransaction(db, async (tx) => {
    const payments = await tx.debtPayment.findMany({
      where: { debtId: id },
      select: { id: true },
    });

    await tx.transaction.deleteMany({
      where: { debtPaymentId: { in: payments.map((payment) => payment.id) } },
    });
    await tx.debt.delete({ where: { id } });
  });

  return { id };
}

/**
 * Logs a payment, and optionally the money movement behind it (SPEC §7).
 *
 * When `accountId` is given the two are written together in one transaction: a payment
 * recorded without the matching balance change, or a balance change without the payment,
 * would each be a lie about a different figure.
 *
 * The transaction's direction follows the debt's: settling something you owe is money
 * leaving, being repaid is money arriving.
 */
export async function addDebtPayment(
  db: Db,
  debtId: string,
  input: CreateDebtPaymentInput,
): Promise<DebtDto> {
  const debt = await db.debt.findUnique({ where: { id: debtId } });
  if (!debt) throw AppError.notFound('That debt does not exist.');

  const amount = parsePositiveAmount(input.amount, 'amount');

  const account =
    input.accountId === null ? null : await requireActiveAccount(db, input.accountId, 'accountId');

  // Accounts are single-currency (D3), so a payment that moves an account's money must be
  // in that account's currency. Without an account, any currency is fine.
  const currency = account?.currency ?? input.currency ?? debt.currency;

  if (account !== null && input.currency !== undefined && input.currency !== account.currency) {
    throw AppError.unprocessable(
      `${account.name} is a ${account.currency} account, so the payment must be in ${account.currency}.`,
      { field: 'currency', accountCurrency: account.currency },
    );
  }

  const frozen = await freezeInto(db, amount, currency, debt.currency, input.date);

  await inTransaction(db, async (tx) => {
    const payment = await tx.debtPayment.create({
      data: {
        debtId,
        amount: toStorageString(amount),
        currency,
        rateToDebtCurrency: frozen.rateToTarget,
        amountInDebtCurrency: frozen.amountInTarget,
        rateToEgp: frozen.rateToEgp,
        amountEgp: frozen.amountEgp,
        rateAsOf: frozen.rateAsOf,
        date: input.date,
        note: input.note,
      },
    });

    if (account !== null) {
      const isOutgoing = debt.direction === 'I_OWE';
      const signed = isOutgoing ? amount.negated() : amount;

      await tx.transaction.create({
        data: {
          type: isOutgoing ? 'EXPENSE' : 'INCOME',
          amount: toStorageString(signed),
          currency: account.currency,
          rateToEgp: frozen.rateToEgp,
          // Re-signed: the payment row is a magnitude, the transaction is signed (§4.7).
          amountEgp: toStorageString(
            isOutgoing ? new Decimal(frozen.amountEgp).negated() : new Decimal(frozen.amountEgp),
          ),
          rateAsOf: frozen.rateAsOf,
          date: input.date,
          note:
            input.note ?? `${isOutgoing ? 'Payment to' : 'Repayment from'} ${debt.counterparty}`,
          accountId: account.id,
          categoryId: null,
          debtPaymentId: payment.id,
        },
      });
    }
  });

  return getDebt(db, debtId);
}

/** Removing a payment removes the transaction it created — they are one event. */
export async function deleteDebtPayment(
  db: Db,
  debtId: string,
  paymentId: string,
): Promise<DebtDto> {
  const payment = await db.debtPayment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.debtId !== debtId) {
    throw AppError.notFound('That payment does not exist.');
  }

  await inTransaction(db, async (tx) => {
    await tx.transaction.deleteMany({ where: { debtPaymentId: paymentId } });
    await tx.debtPayment.delete({ where: { id: paymentId } });
  });

  return getDebt(db, debtId);
}
