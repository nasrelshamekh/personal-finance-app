import { PrismaClient, AccountType, CategoryKind, RateSource } from '@prisma/client';
import { toRateString, toStorageString } from '../src/lib/money';

/**
 * Seeds just enough that the app is never empty on first run (SPEC §5).
 *
 * Idempotent: re-running updates rather than duplicating, so `db:seed` is safe to repeat
 * against a database that already has data.
 */
const prisma = new PrismaClient();

/**
 * Verified against open.er-api.com on 2026-08-03. Written as MANUAL because they were
 * typed into this file by a human, not fetched — a starting point, not a claim of
 * accuracy, and the first API refresh will supersede them.
 */
const SEED_RATES_AS_OF = new Date('2026-08-03T00:00:00.000Z');

const SEED_RATES = [
  { base: 'USD', quote: 'EGP', rate: '51.1232' },
  { base: 'EUR', quote: 'EGP', rate: '58.86' },
  { base: 'GBP', quote: 'EGP', rate: '68.81' },
] as const;

const CATEGORIES: ReadonlyArray<{
  name: string;
  kind: CategoryKind;
  color: string;
  icon: string;
}> = [
  { name: 'Salary', kind: CategoryKind.INCOME, color: '#2f8f5b', icon: 'banknote' },
  { name: 'Freelance', kind: CategoryKind.INCOME, color: '#3f8f7a', icon: 'laptop' },
  { name: 'Rent', kind: CategoryKind.EXPENSE, color: '#b4553f', icon: 'house' },
  { name: 'Groceries', kind: CategoryKind.EXPENSE, color: '#8f7a3f', icon: 'shopping-basket' },
  { name: 'Transport', kind: CategoryKind.EXPENSE, color: '#4a6f9f', icon: 'bus' },
  { name: 'Utilities', kind: CategoryKind.EXPENSE, color: '#6f5f9f', icon: 'plug' },
  { name: 'Internet', kind: CategoryKind.EXPENSE, color: '#3f7f9f', icon: 'wifi' },
  { name: 'Eating out', kind: CategoryKind.EXPENSE, color: '#b06a3f', icon: 'utensils' },
  { name: 'Health', kind: CategoryKind.EXPENSE, color: '#9f3f5f', icon: 'heart-pulse' },
  { name: 'Subscriptions', kind: CategoryKind.EXPENSE, color: '#7f5f8f', icon: 'repeat' },
  { name: 'Hardware', kind: CategoryKind.EXPENSE, color: '#5f6f7f', icon: 'cpu' },
  { name: 'Gifts', kind: CategoryKind.EXPENSE, color: '#9f5f8f', icon: 'gift' },
  { name: 'Transfer fees', kind: CategoryKind.EXPENSE, color: '#7f7f7f', icon: 'arrow-left-right' },
  { name: 'Other', kind: CategoryKind.EXPENSE, color: '#6f6f6f', icon: 'circle-dashed' },
];

async function seedSettings(): Promise<void> {
  await prisma.setting.upsert({
    where: { id: 1 },
    // baseCurrency stays at its EGP default and is not settable in v1 (D6).
    create: { id: 1 },
    update: {},
  });
  console.log('· settings row ready');
}

async function seedCategories(): Promise<void> {
  for (const category of CATEGORIES) {
    const existing = await prisma.category.findFirst({
      where: { name: category.name, parentId: null },
      select: { id: true },
    });

    if (existing) {
      await prisma.category.update({ where: { id: existing.id }, data: category });
    } else {
      await prisma.category.create({ data: category });
    }
  }
  console.log(`· ${CATEGORIES.length} categories ready`);
}

async function seedAccounts(): Promise<void> {
  const openingDate = new Date('2026-08-01T00:00:00.000Z');

  // An EGP account converts at exactly 1 — its opening balance is already in EGP.
  const cashOpening = '0';
  await upsertAccount({
    name: 'Cash (EGP)',
    type: AccountType.CASH,
    currency: 'EGP',
    openingBalance: cashOpening,
    openingRateToEgp: '1',
    openingBalanceEgp: cashOpening,
    openingDate,
    color: '#2f8f5b',
    icon: 'wallet',
  });

  // The USD account freezes its opening rate at creation, which is what makes historical
  // net worth a comparison of frozen figures rather than snapshots of today's rate (D5).
  await upsertAccount({
    name: 'Bank (USD)',
    type: AccountType.BANK,
    currency: 'USD',
    openingBalance: '0',
    openingRateToEgp: '51.1232',
    openingBalanceEgp: '0',
    openingDate,
    color: '#4a6f9f',
    icon: 'landmark',
  });

  console.log('· 2 accounts ready');
}

interface AccountSeed {
  name: string;
  type: AccountType;
  currency: 'EGP' | 'USD' | 'EUR' | 'GBP';
  openingBalance: string;
  openingRateToEgp: string;
  openingBalanceEgp: string;
  openingDate: Date;
  color: string;
  icon: string;
}

async function upsertAccount(account: AccountSeed): Promise<void> {
  const data = {
    ...account,
    openingBalance: toStorageString(account.openingBalance),
    openingRateToEgp: toRateString(account.openingRateToEgp),
    openingBalanceEgp: toStorageString(account.openingBalanceEgp),
  };

  const existing = await prisma.account.findFirst({
    where: { name: account.name },
    select: { id: true },
  });

  if (existing) {
    await prisma.account.update({ where: { id: existing.id }, data });
  } else {
    await prisma.account.create({ data });
  }
}

async function seedRates(): Promise<void> {
  for (const { base, quote, rate } of SEED_RATES) {
    await prisma.exchangeRate.upsert({
      where: {
        base_quote_source_asOf: {
          base,
          quote,
          source: RateSource.MANUAL,
          asOf: SEED_RATES_AS_OF,
        },
      },
      create: {
        base,
        quote,
        rate: toRateString(rate),
        asOf: SEED_RATES_AS_OF,
        source: RateSource.MANUAL,
        // Manual rates have no provider timetable, so staleness falls back to the 30h
        // window (SPEC §4.6).
        nextUpdateAt: null,
      },
      update: { rate: toRateString(rate) },
    });
  }
  console.log(`· ${SEED_RATES.length} exchange rates ready`);
}

async function main(): Promise<void> {
  console.log('Seeding Ledger EG…');
  await seedSettings();
  await seedCategories();
  await seedAccounts();
  await seedRates();
  console.log('Done.');
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
