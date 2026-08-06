import { AccountType, CategoryKind } from '@prisma/client';
import type { Currency } from '@ledger/shared';

/**
 * The starter data (SPEC §5) — one definition, two callers.
 *
 * `prisma/seed.ts` writes it on a fresh database; the reset service writes it again after
 * a wipe. Keeping the tables here rather than in the seed script is what stops "reset" and
 * "seed" from drifting into two different ideas of what a fresh install looks like.
 */

/**
 * Verified against open.er-api.com on 2026-08-03. Written as MANUAL because they were
 * typed by a human, not fetched — a starting point, not a claim of accuracy, and the
 * first API refresh supersedes them.
 */
export const SEED_RATES_AS_OF = new Date('2026-08-03T00:00:00.000Z');

export const SEED_RATES: ReadonlyArray<{ base: Currency; quote: Currency; rate: string }> = [
  { base: 'USD', quote: 'EGP', rate: '51.1232' },
  { base: 'EUR', quote: 'EGP', rate: '58.86' },
  { base: 'GBP', quote: 'EGP', rate: '68.81' },
];

export const SEED_CATEGORIES: ReadonlyArray<{
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

export interface AccountSeed {
  name: string;
  type: AccountType;
  currency: Currency;
  openingBalance: string;
  openingRateToEgp: string;
  openingBalanceEgp: string;
  openingDate: Date;
  color: string;
  icon: string;
}

export const SEED_ACCOUNTS_OPENING_DATE = new Date('2026-08-01T00:00:00.000Z');

export const SEED_ACCOUNTS: ReadonlyArray<AccountSeed> = [
  // An EGP account converts at exactly 1 — its opening balance is already in EGP.
  {
    name: 'Cash (EGP)',
    type: AccountType.CASH,
    currency: 'EGP',
    openingBalance: '0',
    openingRateToEgp: '1',
    openingBalanceEgp: '0',
    openingDate: SEED_ACCOUNTS_OPENING_DATE,
    color: '#2f8f5b',
    icon: 'wallet',
  },
  // The USD account freezes its opening rate at creation, which is what makes historical
  // net worth a comparison of frozen figures rather than snapshots of today's rate (D5).
  {
    name: 'Bank (USD)',
    type: AccountType.BANK,
    currency: 'USD',
    openingBalance: '0',
    openingRateToEgp: '51.1232',
    openingBalanceEgp: '0',
    openingDate: SEED_ACCOUNTS_OPENING_DATE,
    color: '#4a6f9f',
    icon: 'landmark',
  },
];
