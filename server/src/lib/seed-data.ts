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

/**
 * Starter colours, drawn from the Aurora palette's cool half (SPEC §11).
 *
 * Two competing requirements. They have to *belong* — a donut of warm earth tones on an
 * indigo-violet ground looks like data borrowed from another app — but they also have to
 * stay tellable apart, and twelve shades of the same violet is an unreadable chart. So
 * they spread across blue → teal → violet → magenta at roughly constant lightness and
 * saturation, which reads as one family without collapsing into one hue.
 *
 * The two genuine catch-alls are deliberately desaturated: "Transfer fees" and "Other"
 * should recede, not compete with the categories you actually chose.
 */
export const SEED_CATEGORIES: ReadonlyArray<{
  name: string;
  kind: CategoryKind;
  color: string;
  icon: string;
}> = [
  { name: 'Salary', kind: CategoryKind.INCOME, color: '#4f8ff5', icon: 'banknote' },
  { name: 'Freelance', kind: CategoryKind.INCOME, color: '#3fb6c9', icon: 'laptop' },
  { name: 'Rent', kind: CategoryKind.EXPENSE, color: '#7c5cf0', icon: 'house' },
  { name: 'Groceries', kind: CategoryKind.EXPENSE, color: '#a95ce8', icon: 'shopping-basket' },
  { name: 'Transport', kind: CategoryKind.EXPENSE, color: '#5c9ef0', icon: 'bus' },
  { name: 'Utilities', kind: CategoryKind.EXPENSE, color: '#c95cd8', icon: 'plug' },
  { name: 'Internet', kind: CategoryKind.EXPENSE, color: '#6fc4e8', icon: 'wifi' },
  { name: 'Eating out', kind: CategoryKind.EXPENSE, color: '#e05c9e', icon: 'utensils' },
  { name: 'Health', kind: CategoryKind.EXPENSE, color: '#e8628b', icon: 'heart-pulse' },
  { name: 'Subscriptions', kind: CategoryKind.EXPENSE, color: '#8f7cf0', icon: 'repeat' },
  { name: 'Hardware', kind: CategoryKind.EXPENSE, color: '#6e78c4', icon: 'cpu' },
  { name: 'Gifts', kind: CategoryKind.EXPENSE, color: '#d97ce8', icon: 'gift' },
  { name: 'Transfer fees', kind: CategoryKind.EXPENSE, color: '#8a86a8', icon: 'arrow-left-right' },
  { name: 'Other', kind: CategoryKind.EXPENSE, color: '#7d7796', icon: 'circle-dashed' },
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
