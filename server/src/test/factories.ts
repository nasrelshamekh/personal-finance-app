import type { Prisma } from '@prisma/client';
import { RateSource, type Account, type Category, type Debt } from '@prisma/client';
import type { Currency } from '@ledger/shared';

/**
 * Fixtures for DB-backed tests. Everything is created inside the caller's rolled-back
 * transaction, so nothing survives the test.
 */

/** A rate old enough to be current at the test dates below, but not in the future. */
export const TEST_NOW = new Date('2026-08-03T12:00:00.000Z');

export async function makeRate(
  tx: Prisma.TransactionClient,
  values: { base: Currency; quote?: Currency; rate: string; asOf?: Date; source?: RateSource },
): Promise<void> {
  await tx.exchangeRate.create({
    data: {
      base: values.base,
      quote: values.quote ?? 'EGP',
      rate: values.rate,
      asOf: values.asOf ?? new Date(TEST_NOW.getTime() - 60 * 60 * 1000),
      source: values.source ?? RateSource.MANUAL,
    },
  });
}

/** The rates the money assertions in these tests are written against. */
export async function makeStandardRates(tx: Prisma.TransactionClient): Promise<void> {
  await tx.exchangeRate.deleteMany({});
  await makeRate(tx, { base: 'USD', rate: '50' });
  await makeRate(tx, { base: 'EUR', rate: '60' });
  await makeRate(tx, { base: 'GBP', rate: '70' });
}

export async function makeAccount(
  tx: Prisma.TransactionClient,
  values: {
    name?: string;
    currency: Currency;
    openingBalance?: string;
    openingRateToEgp?: string;
    openingBalanceEgp?: string;
    /** When the account came into existence — a dashboard read before it excludes it. */
    openingDate?: Date;
    isArchived?: boolean;
  },
): Promise<Account> {
  const openingBalance = values.openingBalance ?? '0.0000';
  const openingRate = values.openingRateToEgp ?? (values.currency === 'EGP' ? '1' : '50');

  return tx.account.create({
    data: {
      name: values.name ?? `${values.currency} account`,
      type: 'CASH',
      currency: values.currency,
      openingBalance,
      openingDate: values.openingDate ?? new Date('2026-07-01T00:00:00.000Z'),
      openingRateToEgp: openingRate,
      openingBalanceEgp:
        values.openingBalanceEgp ??
        (Number.parseFloat(openingBalance) * Number.parseFloat(openingRate)).toFixed(4),
      color: '#2f8f5b',
      icon: 'wallet',
      isArchived: values.isArchived ?? false,
    },
  });
}

export async function makeCategory(
  tx: Prisma.TransactionClient,
  values: { name?: string; kind: 'INCOME' | 'EXPENSE'; parentId?: string | null },
): Promise<Category> {
  return tx.category.create({
    data: {
      name: values.name ?? `${values.kind} category`,
      kind: values.kind,
      color: '#4a6f9f',
      icon: 'tag',
      parentId: values.parentId ?? null,
    },
  });
}

/** A debt, for the dashboard's "after debts" figures. Payments are added by the caller. */
export async function makeDebt(
  tx: Prisma.TransactionClient,
  values: {
    counterparty?: string;
    direction?: 'I_OWE' | 'OWED_TO_ME';
    principal: string;
    currency?: Currency;
    startDate?: Date;
    status?: 'ACTIVE' | 'SETTLED';
  },
): Promise<Debt> {
  return tx.debt.create({
    data: {
      counterparty: values.counterparty ?? 'Someone',
      direction: values.direction ?? 'I_OWE',
      principal: values.principal,
      currency: values.currency ?? 'EGP',
      startDate: values.startDate ?? new Date('2026-07-01T00:00:00.000Z'),
      status: values.status ?? 'ACTIVE',
    },
  });
}
