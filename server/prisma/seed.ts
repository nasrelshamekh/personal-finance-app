import { PrismaClient, RateSource } from '@prisma/client';
import { toRateString, toStorageString } from '../src/lib/money';
import {
  SEED_ACCOUNTS,
  SEED_CATEGORIES,
  SEED_RATES,
  SEED_RATES_AS_OF,
  type AccountSeed,
} from '../src/lib/seed-data';

/**
 * Seeds just enough that the app is never empty on first run (SPEC §5). The tables
 * themselves live in `src/lib/seed-data.ts`, because Settings' "reset all data" restores
 * the same starter data and the two must not drift.
 *
 * Idempotent: re-running updates rather than duplicating, so `db:seed` is safe to repeat
 * against a database that already has data.
 */
const prisma = new PrismaClient();

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
  for (const category of SEED_CATEGORIES) {
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
  console.log(`· ${SEED_CATEGORIES.length} categories ready`);
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

async function seedAccounts(): Promise<void> {
  for (const account of SEED_ACCOUNTS) {
    await upsertAccount(account);
  }
  console.log(`· ${SEED_ACCOUNTS.length} accounts ready`);
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
