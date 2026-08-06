import { z } from 'zod';
import { currencySchema } from '../currency';
import {
  accountTypeSchema,
  categoryKindSchema,
  debtDirectionSchema,
  debtStatusSchema,
  rateSourceSchema,
  txTypeSchema,
} from '../enums';
import { decimalString, positiveDecimalString } from './common';

/**
 * The backup wire format (SPEC §7 `/export`, `/import`).
 *
 * Two rules make this file what it is:
 *
 * 1. **Ids are preserved.** A restore reproduces the database, it does not create a
 *    parallel copy of it. That is what lets a transfer pair, a debt payment and its
 *    mirrored transaction survive the round trip still pointing at each other.
 * 2. **Frozen figures are restored verbatim.** `amountEgp`, `rateToEgp` and `rateAsOf`
 *    are written back exactly as exported — never recomputed. Re-freezing on import would
 *    quietly restate last year's history at today's rate, which is precisely the failure
 *    SPEC §4.4 exists to prevent. It also means an import cannot depend on the network.
 */

export const BACKUP_FORMAT = 'ledger-eg.backup';
export const BACKUP_VERSION = 1;

/** An ISO timestamp. Not transformed to a Date — the server writes it back as given. */
const isoTimestamp = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Must be a valid ISO timestamp.');

const uuid = z.string().uuid();

export const backupAccountSchema = z.object({
  id: uuid,
  name: z.string().min(1).max(60),
  type: accountTypeSchema,
  currency: currencySchema,
  openingBalance: decimalString,
  openingDate: isoTimestamp,
  openingRateToEgp: positiveDecimalString,
  openingBalanceEgp: decimalString,
  color: z.string(),
  icon: z.string(),
  isArchived: z.boolean(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});

export const backupCategorySchema = z.object({
  id: uuid,
  name: z.string().min(1).max(60),
  kind: categoryKindSchema,
  color: z.string(),
  icon: z.string(),
  parentId: uuid.nullable(),
  isArchived: z.boolean(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});

export const backupTransactionSchema = z.object({
  id: uuid,
  type: txTypeSchema,
  amount: decimalString,
  currency: currencySchema,
  rateToEgp: positiveDecimalString,
  amountEgp: decimalString,
  rateAsOf: isoTimestamp,
  date: isoTimestamp,
  note: z.string().nullable(),
  accountId: uuid,
  categoryId: uuid.nullable(),
  transferGroupId: uuid.nullable(),
  debtPaymentId: uuid.nullable(),
  savingsContributionId: uuid.nullable(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});

export const backupDebtSchema = z.object({
  id: uuid,
  counterparty: z.string().min(1).max(80),
  direction: debtDirectionSchema,
  principal: decimalString,
  currency: currencySchema,
  startDate: isoTimestamp,
  dueDate: isoTimestamp.nullable(),
  status: debtStatusSchema,
  note: z.string().nullable(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});

export const backupDebtPaymentSchema = z.object({
  id: uuid,
  debtId: uuid,
  amount: decimalString,
  currency: currencySchema,
  rateToDebtCurrency: positiveDecimalString,
  amountInDebtCurrency: decimalString,
  rateToEgp: positiveDecimalString,
  amountEgp: decimalString,
  rateAsOf: isoTimestamp,
  date: isoTimestamp,
  note: z.string().nullable(),
  createdAt: isoTimestamp,
});

export const backupSavingsGoalSchema = z.object({
  id: uuid,
  name: z.string().min(1).max(60),
  targetAmount: positiveDecimalString,
  currency: currencySchema,
  deadline: isoTimestamp.nullable(),
  color: z.string(),
  icon: z.string(),
  isArchived: z.boolean(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});

export const backupSavingsContributionSchema = z.object({
  id: uuid,
  goalId: uuid,
  amount: decimalString,
  currency: currencySchema,
  rateToGoalCurrency: positiveDecimalString,
  amountInGoalCurrency: decimalString,
  rateToEgp: positiveDecimalString,
  amountEgp: decimalString,
  rateAsOf: isoTimestamp,
  date: isoTimestamp,
  createdAt: isoTimestamp,
});

export const backupBudgetSchema = z.object({
  id: uuid,
  categoryId: uuid,
  month: isoTimestamp,
  limitEgp: decimalString,
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});

export const backupExchangeRateSchema = z.object({
  id: uuid,
  base: currencySchema,
  quote: currencySchema,
  rate: positiveDecimalString,
  asOf: isoTimestamp,
  nextUpdateAt: isoTimestamp.nullable(),
  source: rateSourceSchema,
  createdAt: isoTimestamp,
});

export const backupSettingsSchema = z.object({
  baseCurrency: currencySchema,
  locale: z.string(),
  rateSource: rateSourceSchema,
  ratesApiEnabled: z.boolean(),
  ratesApiEolAt: isoTimestamp.nullable(),
  themePreset: z.string(),
  themeMode: z.string(),
});

/** The tables, in an order that never violates a foreign key when written front to back. */
export const BACKUP_TABLES = [
  'accounts',
  'categories',
  'debts',
  'debtPayments',
  'savingsGoals',
  'savingsContributions',
  'transactions',
  'budgets',
  'exchangeRates',
] as const;

export type BackupTable = (typeof BACKUP_TABLES)[number];

export const backupDataSchema = z.object({
  accounts: z.array(backupAccountSchema),
  categories: z.array(backupCategorySchema),
  debts: z.array(backupDebtSchema),
  debtPayments: z.array(backupDebtPaymentSchema),
  savingsGoals: z.array(backupSavingsGoalSchema),
  savingsContributions: z.array(backupSavingsContributionSchema),
  transactions: z.array(backupTransactionSchema),
  budgets: z.array(backupBudgetSchema),
  exchangeRates: z.array(backupExchangeRateSchema),
  settings: backupSettingsSchema,
});

export const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.number().int().positive(),
  exportedAt: isoTimestamp,
  data: backupDataSchema,
});

export type BackupDto = z.infer<typeof backupSchema>;
export type BackupData = z.infer<typeof backupDataSchema>;

export const importRequestSchema = z.object({
  /**
   * When true nothing is written and the same report comes back. The UI always runs this
   * first: an import replaces everything, and a diff you can read beforehand is the
   * difference between a restore and an accident.
   */
  dryRun: z.boolean().default(false),
  backup: backupSchema,
});

export type ImportRequest = z.infer<typeof importRequestSchema>;

/** One table's before/after, so the diff names rows rather than just "some data". */
export interface ImportTableChange {
  table: BackupTable;
  /** Rows currently in the database, all of which an import replaces. */
  existing: number;
  /** Rows the backup would write. */
  incoming: number;
}

/**
 * A row whose rate post-dates it, so its EGP figure was an approximation when it was
 * written (SPEC §6). Surfaced here rather than silently imported — the dump may well
 * have been built from a machine that was offline for a week.
 */
export interface ImportApproximateRow {
  table: BackupTable;
  id: string;
  date: string;
  rateAsOf: string;
}

export interface ImportReportDto {
  dryRun: boolean;
  /** False only on a dry run that found blocking problems. */
  applied: boolean;
  exportedAt: string;
  changes: ImportTableChange[];
  totalExisting: number;
  totalIncoming: number;
  approximateRows: ImportApproximateRow[];
  /**
   * Referential problems found before writing — a transaction pointing at an account the
   * backup does not contain, and the like. Non-empty means nothing was written.
   */
  problems: string[];
}

/** The typed confirmation guarding a wipe (SPEC §9). Compared exactly, case included. */
export const RESET_CONFIRMATION = 'ERASE EVERYTHING';

export const resetRequestSchema = z.object({
  confirmation: z.literal(RESET_CONFIRMATION, {
    errorMap: () => ({ message: `Type ${RESET_CONFIRMATION} to confirm.` }),
  }),
  /**
   * Restores the starter categories and rates afterwards. On by default because a ledger
   * with no categories cannot record an expense, so a bare wipe leaves the app unusable
   * rather than fresh (SPEC §5).
   */
  restoreStarterData: z.boolean().default(true),
});

export type ResetRequest = z.infer<typeof resetRequestSchema>;

export interface ResetReportDto {
  deleted: Record<BackupTable, number>;
  totalDeleted: number;
  restoredStarterData: boolean;
}
