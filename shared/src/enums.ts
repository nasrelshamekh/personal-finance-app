import { z } from 'zod';

/**
 * The Prisma enums, mirrored as zod so `shared/` can validate without importing Prisma
 * (SPEC §3). `server/src/types/prisma-parity.ts` asserts at compile time that every list
 * here matches its Prisma counterpart — if you add a member, both must change.
 */

export const ACCOUNT_TYPES = ['CASH', 'BANK', 'WALLET', 'SAVINGS', 'CREDIT_CARD'] as const;
export const accountTypeSchema = z.enum(ACCOUNT_TYPES);
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const CATEGORY_KINDS = ['INCOME', 'EXPENSE'] as const;
export const categoryKindSchema = z.enum(CATEGORY_KINDS);
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export const TX_TYPES = ['INCOME', 'EXPENSE', 'TRANSFER'] as const;
export const txTypeSchema = z.enum(TX_TYPES);
export type TxType = (typeof TX_TYPES)[number];

export const DEBT_DIRECTIONS = ['I_OWE', 'OWED_TO_ME'] as const;
export const debtDirectionSchema = z.enum(DEBT_DIRECTIONS);
export type DebtDirection = (typeof DEBT_DIRECTIONS)[number];

export const DEBT_STATUSES = ['ACTIVE', 'SETTLED'] as const;
export const debtStatusSchema = z.enum(DEBT_STATUSES);
export type DebtStatus = (typeof DEBT_STATUSES)[number];

export const RATE_SOURCES = ['MANUAL', 'API'] as const;
export const rateSourceSchema = z.enum(RATE_SOURCES);
export type RateSource = (typeof RATE_SOURCES)[number];

/** Only these two are enterable directly; a TRANSFER is created as a pair (D2). */
export const ENTRY_TX_TYPES = ['INCOME', 'EXPENSE'] as const;
export type EntryTxType = (typeof ENTRY_TX_TYPES)[number];

/**
 * Storage sign for a directly entered transaction (SPEC §4.7). Income adds, expense
 * subtracts, so a balance is a plain sum with no branching on `type`.
 */
export const TX_SIGN: Record<EntryTxType, 1 | -1> = {
  INCOME: 1,
  EXPENSE: -1,
};
