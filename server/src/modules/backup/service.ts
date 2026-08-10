import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RateSource, type Prisma } from '@prisma/client';
import {
  BACKUP_FORMAT,
  BACKUP_TABLES,
  BACKUP_VERSION,
  type BackupData,
  type BackupDto,
  type BackupTable,
  type ImportApproximateRow,
  type ImportReportDto,
  type ImportTableChange,
  type ResetReportDto,
} from '@ledger/shared';
import { AppError } from '../../lib/errors';
import { inTransaction } from '../../lib/tx';
import { getSettings, SETTINGS_ID } from '../../lib/settings';
import { toRateString } from '../../lib/money';
import { SEED_CATEGORIES, SEED_RATES, SEED_RATES_AS_OF } from '../../lib/seed-data';
import type { Db } from '../../lib/fx';

/**
 * `server/src/modules/backup` → the repo root, so a relative `BACKUP_DIR` means the same
 * place whether the process was started from the root or from `server/`. Taken from this
 * file's own location rather than `process.cwd()`, which the caller chooses.
 */
const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');

/**
 * Export, import and reset (SPEC §7, §9).
 *
 * A `Prisma.Decimal` never escapes this file: every money column is stringified the
 * instant it leaves Prisma and handed back as a string, same as everywhere else (SPEC
 * §4.2). Nothing here converts, re-freezes or recomputes a figure — an export is a
 * transcription and an import is its inverse.
 */

const iso = (date: Date): string => date.toISOString();

/** Deletion order: children before parents, so no `Restrict` constraint is ever tripped. */
const DELETE_ORDER = [
  'transactions',
  'budgets',
  'debtPayments',
  'savingsContributions',
  'debts',
  'savingsGoals',
  'accounts',
  'categories',
  'exchangeRates',
] as const satisfies ReadonlyArray<BackupTable>;

export async function exportAll(db: Db): Promise<BackupDto> {
  const [
    accounts,
    categories,
    debts,
    debtPayments,
    savingsGoals,
    savingsContributions,
    transactions,
    budgets,
    exchangeRates,
    settings,
  ] = await Promise.all([
    db.account.findMany({ orderBy: { createdAt: 'asc' } }),
    db.category.findMany({ orderBy: { createdAt: 'asc' } }),
    db.debt.findMany({ orderBy: { createdAt: 'asc' } }),
    db.debtPayment.findMany({ orderBy: { createdAt: 'asc' } }),
    db.savingsGoal.findMany({ orderBy: { createdAt: 'asc' } }),
    db.savingsContribution.findMany({ orderBy: { createdAt: 'asc' } }),
    db.transaction.findMany({ orderBy: { createdAt: 'asc' } }),
    db.budget.findMany({ orderBy: { createdAt: 'asc' } }),
    db.exchangeRate.findMany({ orderBy: { createdAt: 'asc' } }),
    getSettings(db),
  ]);

  const data: BackupData = {
    accounts: accounts.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      currency: row.currency,
      openingBalance: row.openingBalance.toString(),
      openingDate: iso(row.openingDate),
      openingRateToEgp: row.openingRateToEgp.toString(),
      openingBalanceEgp: row.openingBalanceEgp.toString(),
      color: row.color,
      icon: row.icon,
      isArchived: row.isArchived,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    })),
    categories: categories.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      color: row.color,
      icon: row.icon,
      parentId: row.parentId,
      isArchived: row.isArchived,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    })),
    debts: debts.map((row) => ({
      id: row.id,
      counterparty: row.counterparty,
      direction: row.direction,
      principal: row.principal.toString(),
      currency: row.currency,
      startDate: iso(row.startDate),
      dueDate: row.dueDate === null ? null : iso(row.dueDate),
      status: row.status,
      note: row.note,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    })),
    debtPayments: debtPayments.map((row) => ({
      id: row.id,
      debtId: row.debtId,
      amount: row.amount.toString(),
      currency: row.currency,
      rateToDebtCurrency: row.rateToDebtCurrency.toString(),
      amountInDebtCurrency: row.amountInDebtCurrency.toString(),
      rateToEgp: row.rateToEgp.toString(),
      amountEgp: row.amountEgp.toString(),
      rateAsOf: iso(row.rateAsOf),
      date: iso(row.date),
      note: row.note,
      createdAt: iso(row.createdAt),
    })),
    savingsGoals: savingsGoals.map((row) => ({
      id: row.id,
      name: row.name,
      targetAmount: row.targetAmount.toString(),
      currency: row.currency,
      deadline: row.deadline === null ? null : iso(row.deadline),
      color: row.color,
      icon: row.icon,
      isArchived: row.isArchived,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    })),
    savingsContributions: savingsContributions.map((row) => ({
      id: row.id,
      goalId: row.goalId,
      amount: row.amount.toString(),
      currency: row.currency,
      rateToGoalCurrency: row.rateToGoalCurrency.toString(),
      amountInGoalCurrency: row.amountInGoalCurrency.toString(),
      rateToEgp: row.rateToEgp.toString(),
      amountEgp: row.amountEgp.toString(),
      rateAsOf: iso(row.rateAsOf),
      date: iso(row.date),
      createdAt: iso(row.createdAt),
    })),
    transactions: transactions.map((row) => ({
      id: row.id,
      type: row.type,
      amount: row.amount.toString(),
      currency: row.currency,
      rateToEgp: row.rateToEgp.toString(),
      amountEgp: row.amountEgp.toString(),
      rateAsOf: iso(row.rateAsOf),
      date: iso(row.date),
      note: row.note,
      accountId: row.accountId,
      categoryId: row.categoryId,
      transferGroupId: row.transferGroupId,
      debtPaymentId: row.debtPaymentId,
      savingsContributionId: row.savingsContributionId,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    })),
    budgets: budgets.map((row) => ({
      id: row.id,
      categoryId: row.categoryId,
      month: iso(row.month),
      limitEgp: row.limitEgp.toString(),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    })),
    exchangeRates: exchangeRates.map((row) => ({
      id: row.id,
      base: row.base,
      quote: row.quote,
      rate: row.rate.toString(),
      asOf: iso(row.asOf),
      nextUpdateAt: row.nextUpdateAt === null ? null : iso(row.nextUpdateAt),
      source: row.source,
      createdAt: iso(row.createdAt),
    })),
    settings: {
      baseCurrency: settings.baseCurrency,
      locale: settings.locale,
      rateSource: settings.rateSource,
      ratesApiEnabled: settings.ratesApiEnabled,
      ratesApiEolAt: settings.ratesApiEolAt === null ? null : iso(settings.ratesApiEolAt),
      themePreset: settings.themePreset,
      themeMode: settings.themeMode,
    },
  };

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data,
  };
}

function countRow(data: BackupData, table: BackupTable): number {
  return data[table].length;
}

/**
 * Everything checkable before a single row is written.
 *
 * Postgres would catch most of it anyway, but a foreign key violation surfaces as one
 * opaque constraint name after the wipe has already happened inside the transaction. A
 * dry run is only worth having if it can say *which* row is wrong.
 */
function findProblems(data: BackupData): string[] {
  const problems: string[] = [];

  const accountIds = new Set(data.accounts.map((row) => row.id));
  const categoryIds = new Set(data.categories.map((row) => row.id));
  const debtIds = new Set(data.debts.map((row) => row.id));
  const goalIds = new Set(data.savingsGoals.map((row) => row.id));
  const paymentIds = new Set(data.debtPayments.map((row) => row.id));
  const contributionIds = new Set(data.savingsContributions.map((row) => row.id));

  for (const category of data.categories) {
    if (category.parentId === null) continue;
    if (!categoryIds.has(category.parentId)) {
      problems.push(`Category "${category.name}" names a parent that is not in the backup.`);
      continue;
    }
    const parent = data.categories.find((row) => row.id === category.parentId);
    // One level of nesting only (SPEC §5) — Prisma cannot express it, so it is checked here.
    if (parent !== undefined && parent.parentId !== null) {
      problems.push(`Category "${category.name}" is nested two levels deep.`);
    }
  }

  for (const transaction of data.transactions) {
    if (!accountIds.has(transaction.accountId)) {
      problems.push(`Transaction ${transaction.id} names an account that is not in the backup.`);
    }
    if (transaction.categoryId !== null && !categoryIds.has(transaction.categoryId)) {
      problems.push(`Transaction ${transaction.id} names a category that is not in the backup.`);
    }
    if (transaction.debtPaymentId !== null && !paymentIds.has(transaction.debtPaymentId)) {
      problems.push(
        `Transaction ${transaction.id} names a debt payment that is not in the backup.`,
      );
    }
    if (
      transaction.savingsContributionId !== null &&
      !contributionIds.has(transaction.savingsContributionId)
    ) {
      problems.push(
        `Transaction ${transaction.id} names a savings contribution that is not in the backup.`,
      );
    }

    const account = data.accounts.find((row) => row.id === transaction.accountId);
    // Accounts are single-currency (D3); a mismatch here would corrupt every balance.
    if (account !== undefined && account.currency !== transaction.currency) {
      problems.push(
        `Transaction ${transaction.id} is in ${transaction.currency} but its account holds ${account.currency}.`,
      );
    }
  }

  for (const payment of data.debtPayments) {
    if (!debtIds.has(payment.debtId)) {
      problems.push(`Debt payment ${payment.id} names a debt that is not in the backup.`);
    }
  }

  for (const contribution of data.savingsContributions) {
    if (!goalIds.has(contribution.goalId)) {
      problems.push(`Contribution ${contribution.id} names a goal that is not in the backup.`);
    }
  }

  for (const budget of data.budgets) {
    if (!categoryIds.has(budget.categoryId)) {
      problems.push(`Budget ${budget.id} names a category that is not in the backup.`);
    }
  }

  return problems;
}

/**
 * Rows whose rate post-dates them (SPEC §6). Flagged in the diff rather than imported
 * silently — the figures are honest about being approximate, and the import should be too.
 */
function findApproximateRows(data: BackupData): ImportApproximateRow[] {
  const rows: ImportApproximateRow[] = [];

  const collect = (
    table: BackupTable,
    entries: ReadonlyArray<{ id: string; date: string; rateAsOf: string }>,
  ): void => {
    for (const entry of entries) {
      if (Date.parse(entry.rateAsOf) > Date.parse(entry.date)) {
        rows.push({ table, id: entry.id, date: entry.date, rateAsOf: entry.rateAsOf });
      }
    }
  };

  collect('transactions', data.transactions);
  collect('debtPayments', data.debtPayments);
  collect('savingsContributions', data.savingsContributions);

  return rows;
}

async function countExisting(tx: Prisma.TransactionClient): Promise<Record<BackupTable, number>> {
  const [
    accounts,
    categories,
    debts,
    debtPayments,
    savingsGoals,
    savingsContributions,
    transactions,
    budgets,
    exchangeRates,
  ] = await Promise.all([
    tx.account.count(),
    tx.category.count(),
    tx.debt.count(),
    tx.debtPayment.count(),
    tx.savingsGoal.count(),
    tx.savingsContribution.count(),
    tx.transaction.count(),
    tx.budget.count(),
    tx.exchangeRate.count(),
  ]);

  return {
    accounts,
    categories,
    debts,
    debtPayments,
    savingsGoals,
    savingsContributions,
    transactions,
    budgets,
    exchangeRates,
  };
}

/** Wipes every table in an order no foreign key objects to. Settings is updated, not deleted. */
async function deleteEverything(
  tx: Prisma.TransactionClient,
): Promise<Record<BackupTable, number>> {
  const before = await countExisting(tx);

  for (const table of DELETE_ORDER) {
    switch (table) {
      case 'transactions':
        await tx.transaction.deleteMany({});
        break;
      case 'budgets':
        await tx.budget.deleteMany({});
        break;
      case 'debtPayments':
        await tx.debtPayment.deleteMany({});
        break;
      case 'savingsContributions':
        await tx.savingsContribution.deleteMany({});
        break;
      case 'debts':
        await tx.debt.deleteMany({});
        break;
      case 'savingsGoals':
        await tx.savingsGoal.deleteMany({});
        break;
      case 'accounts':
        await tx.account.deleteMany({});
        break;
      case 'categories':
        // Children first: `Category.parentId` is Restrict and Postgres checks immediately.
        await tx.category.deleteMany({ where: { parentId: { not: null } } });
        await tx.category.deleteMany({});
        break;
      case 'exchangeRates':
        await tx.exchangeRate.deleteMany({});
        break;
    }
  }

  return before;
}

/** Every timestamp is rebuilt as a Date rather than left as a string, so the write is
 *  explicit about what it is storing instead of relying on Prisma's string coercion. */
const at = (value: string): Date => new Date(value);
const atOrNull = (value: string | null): Date | null => (value === null ? null : new Date(value));

async function writeBackup(tx: Prisma.TransactionClient, data: BackupData): Promise<void> {
  await tx.account.createMany({
    data: data.accounts.map((row) => ({
      ...row,
      openingDate: at(row.openingDate),
      createdAt: at(row.createdAt),
      updatedAt: at(row.updatedAt),
    })),
  });

  // Roots first, then children — the self-relation is Restrict in both directions.
  const categoryRows = data.categories.map((row) => ({
    ...row,
    createdAt: at(row.createdAt),
    updatedAt: at(row.updatedAt),
  }));
  const roots = categoryRows.filter((row) => row.parentId === null);
  const children = categoryRows.filter((row) => row.parentId !== null);
  if (roots.length > 0) await tx.category.createMany({ data: roots });
  if (children.length > 0) await tx.category.createMany({ data: children });

  await tx.debt.createMany({
    data: data.debts.map((row) => ({
      ...row,
      startDate: at(row.startDate),
      dueDate: atOrNull(row.dueDate),
      createdAt: at(row.createdAt),
      updatedAt: at(row.updatedAt),
    })),
  });

  await tx.savingsGoal.createMany({
    data: data.savingsGoals.map((row) => ({
      ...row,
      deadline: atOrNull(row.deadline),
      createdAt: at(row.createdAt),
      updatedAt: at(row.updatedAt),
    })),
  });

  await tx.debtPayment.createMany({
    data: data.debtPayments.map((row) => ({
      ...row,
      date: at(row.date),
      rateAsOf: at(row.rateAsOf),
      createdAt: at(row.createdAt),
    })),
  });

  await tx.savingsContribution.createMany({
    data: data.savingsContributions.map((row) => ({
      ...row,
      date: at(row.date),
      rateAsOf: at(row.rateAsOf),
      createdAt: at(row.createdAt),
    })),
  });

  await tx.transaction.createMany({
    data: data.transactions.map((row) => ({
      ...row,
      date: at(row.date),
      rateAsOf: at(row.rateAsOf),
      createdAt: at(row.createdAt),
      updatedAt: at(row.updatedAt),
    })),
  });

  await tx.budget.createMany({
    data: data.budgets.map((row) => ({
      ...row,
      month: at(row.month),
      createdAt: at(row.createdAt),
      updatedAt: at(row.updatedAt),
    })),
  });

  await tx.exchangeRate.createMany({
    data: data.exchangeRates.map((row) => ({
      ...row,
      asOf: at(row.asOf),
      nextUpdateAt: atOrNull(row.nextUpdateAt),
      createdAt: at(row.createdAt),
    })),
  });

  await tx.setting.update({
    where: { id: SETTINGS_ID },
    data: {
      locale: data.settings.locale,
      rateSource: data.settings.rateSource,
      ratesApiEnabled: data.settings.ratesApiEnabled,
      ratesApiEolAt: atOrNull(data.settings.ratesApiEolAt),
      themePreset: data.settings.themePreset,
      themeMode: data.settings.themeMode,
      // baseCurrency is deliberately not restored: it is locked to EGP in v1 (D6), and a
      // backup from a future version must not be able to unlock it through the back door.
    },
  });
}

/**
 * `backupDir` is required rather than defaulted to `env.BACKUP_DIR`. A default reads as a
 * convenience and behaves as a trap: a test that forgets it writes a copy of the
 * developer's real ledger into the repo, silently and with no failing assertion. Required,
 * the compiler names every call site, and the only one that reaches for the environment is
 * the router.
 */
export async function importBackup(
  db: Db,
  backup: BackupDto,
  dryRun: boolean,
  backupDir: string,
): Promise<ImportReportDto> {
  if (backup.version > BACKUP_VERSION) {
    throw AppError.unprocessable(
      `That backup was written by a newer version of this app (format ${backup.version}, this app reads ${BACKUP_VERSION}).`,
    );
  }

  const problems = findProblems(backup.data);
  const approximateRows = findApproximateRows(backup.data);

  /*
   * An import replaces rather than merges, so applying one destroys the current ledger
   * exactly as a reset does — and restoring the wrong file is an easier mistake to make
   * than typing ERASE EVERYTHING by accident. Same copy, same guarantee, same ordering.
   *
   * Decided out here rather than inside the transaction because `findProblems` reads only
   * the incoming data: a dry run and a rejected backup both write nothing, and neither is
   * worth a file.
   */
  const willApply = !dryRun && problems.length === 0;
  const backupPath = willApply ? await writeSafetyCopy(db, backupDir, 'import') : null;

  return inTransaction(db, async (tx) => {
    await getSettings(tx);
    const existing = await countExisting(tx);

    const changes: ImportTableChange[] = BACKUP_TABLES.map((table) => ({
      table,
      existing: existing[table],
      incoming: countRow(backup.data, table),
    }));

    if (willApply) {
      await deleteEverything(tx);
      await writeBackup(tx, backup.data);
    }

    return {
      dryRun,
      applied: willApply,
      exportedAt: backup.exportedAt,
      changes,
      totalExisting: changes.reduce((sum, change) => sum + change.existing, 0),
      totalIncoming: changes.reduce((sum, change) => sum + change.incoming, 0),
      approximateRows,
      problems,
      backupPath,
    };
  });
}

/**
 * Writes a full export to disk and returns where it landed, or null when the database
 * holds nothing worth copying.
 *
 * Taken *before* the transaction opens, on purpose. If the copy cannot be written the
 * destructive step must not happen at all — the guarantee is worth more than the
 * convenience, and a wipe that half-succeeded because the disk was full is the worst of
 * both. The reverse order would leave a stray backup of a database that was never
 * touched, which is harmless; this order leaves data intact, which is not.
 *
 * Both callers replace everything, so both take one. The filename says which, because
 * "the state before I restored the wrong file" and "the state before I wiped it" are
 * different regrets and you will be reading the directory in a hurry.
 */
async function writeSafetyCopy(
  db: Db,
  directory: string,
  reason: 'reset' | 'import',
): Promise<string | null> {
  const backup = await exportAll(db);
  const rows = BACKUP_TABLES.reduce((sum, table) => sum + backup.data[table].length, 0);
  if (rows === 0) return null;

  // Second precision, and the colons a timestamp normally carries are illegal in a
  // Windows filename.
  const stamp = backup.exportedAt.slice(0, 19).replace(/[:T]/g, '-');
  const target = path.resolve(REPO_ROOT, directory);

  await mkdir(target, { recursive: true });
  const file = path.join(target, `ledger-eg-before-${reason}-${stamp}.json`);
  await writeFile(file, JSON.stringify(backup, null, 2), 'utf8');

  return file;
}

export async function resetAll(
  db: Db,
  restoreStarterData: boolean,
  backupDir: string,
): Promise<ResetReportDto> {
  const backupPath = await writeSafetyCopy(db, backupDir, 'reset');

  return inTransaction(db, async (tx) => {
    await getSettings(tx);
    const deleted = await deleteEverything(tx);

    if (restoreStarterData) {
      await tx.category.createMany({ data: [...SEED_CATEGORIES] });
      await tx.exchangeRate.createMany({
        data: SEED_RATES.map((rate) => ({
          base: rate.base,
          quote: rate.quote,
          rate: toRateString(rate.rate),
          asOf: SEED_RATES_AS_OF,
          nextUpdateAt: null,
          source: RateSource.MANUAL,
        })),
      });
    }

    // Settings go back to their defaults, except the theme: which colours you like is not
    // part of "your data", and repainting the app mid-reset reads as a bug.
    await tx.setting.update({
      where: { id: SETTINGS_ID },
      data: {
        locale: 'en-US',
        rateSource: RateSource.API,
        ratesApiEnabled: true,
        ratesApiEolAt: null,
      },
    });

    return {
      deleted,
      totalDeleted: Object.values(deleted).reduce((sum, count) => sum + count, 0),
      restoredStarterData: restoreStarterData,
      backupPath,
    };
  });
}
