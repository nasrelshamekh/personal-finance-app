import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  type BackupDto,
  type TransactionDto,
  type TransferGroupDto,
} from '@ledger/shared';
import { withRollback } from '../../test/db';
import { makeAccount, makeCategory, makeStandardRates } from '../../test/factories';
import { createTransaction } from '../transactions/service';
import { exportAll, importBackup, resetAll } from './service';

type Tx = Parameters<Parameters<typeof withRollback>[0]>[0];

const DATE = new Date('2026-08-10T09:00:00.000Z');

function asEntry(result: TransactionDto | TransferGroupDto): TransactionDto {
  if ('from' in result) throw new Error('Expected a single transaction, got a transfer group');
  return result;
}

function asTransfer(result: TransactionDto | TransferGroupDto): TransferGroupDto {
  if (!('from' in result)) throw new Error('Expected a transfer group');
  return result;
}

/**
 * Both a reset and an applied import write a safety copy, so every test points that at a
 * scratch directory rather than the repo's real `backups/`. Created per test and removed
 * afterwards, so a test can count the files in it and mean something by the number.
 */
let backupDir: string;

beforeEach(async () => {
  backupDir = await mkdtemp(path.join(tmpdir(), 'ledger-backup-'));
});

afterEach(async () => {
  await rm(backupDir, { recursive: true, force: true });
});

/** A ledger with one of everything the round trip has to preserve. */
async function seedLedger(tx: Tx) {
  await makeStandardRates(tx);
  const egp = await makeAccount(tx, { currency: 'EGP', name: 'Cash test' });
  const usd = await makeAccount(tx, { currency: 'USD', name: 'Bank test' });
  const category = await makeCategory(tx, { kind: 'EXPENSE', name: 'Groceries test' });

  const expense = asEntry(
    await createTransaction(tx, {
      type: 'EXPENSE',
      amount: '250',
      accountId: egp.id,
      categoryId: category.id,
      date: DATE,
      note: 'a note that must survive',
    }),
  );

  return { egp, usd, category, expense };
}

describe('export', () => {
  it('stringifies every money column and never leaks a Prisma.Decimal', async () => {
    await withRollback(async (tx) => {
      await seedLedger(tx);
      const backup = await exportAll(tx);

      expect(backup.format).toBe(BACKUP_FORMAT);
      expect(backup.version).toBe(BACKUP_VERSION);

      for (const row of backup.data.transactions) {
        expect(typeof row.amount).toBe('string');
        expect(typeof row.amountEgp).toBe('string');
        expect(typeof row.rateToEgp).toBe('string');
      }
      for (const row of backup.data.accounts) {
        expect(typeof row.openingBalance).toBe('string');
        expect(typeof row.openingRateToEgp).toBe('string');
      }
      for (const row of backup.data.exchangeRates) {
        expect(typeof row.rate).toBe('string');
      }
    });
  });

  it('survives its own schema', async () => {
    await withRollback(async (tx) => {
      await seedLedger(tx);
      const backup = await exportAll(tx);

      // The dump the app writes must be a dump the app will accept back.
      const { backupSchema } = await import('@ledger/shared');
      expect(() => backupSchema.parse(JSON.parse(JSON.stringify(backup)))).not.toThrow();
    });
  });
});

describe('import', () => {
  it('restores frozen figures verbatim rather than reconverting them (SPEC §4.4)', async () => {
    await withRollback(async (tx) => {
      const { expense } = await seedLedger(tx);
      const backup = await exportAll(tx);

      const before = backup.data.transactions.find((row) => row.id === expense.id);
      expect(before).toBeDefined();

      // Move the rate hard. A re-freezing import would restate history at this new rate.
      await tx.exchangeRate.create({
        data: {
          base: 'USD',
          quote: 'EGP',
          rate: '999',
          asOf: new Date('2026-08-20T00:00:00.000Z'),
          source: 'MANUAL',
        },
      });

      await importBackup(tx, backup, false, backupDir);

      const after = await tx.transaction.findUniqueOrThrow({ where: { id: expense.id } });
      expect(after.amountEgp.toString()).toBe(before?.amountEgp);
      expect(after.rateToEgp.toString()).toBe(before?.rateToEgp);
      expect(after.rateAsOf.toISOString()).toBe(before?.rateAsOf);
      expect(after.note).toBe('a note that must survive');
    });
  });

  it('preserves ids, so a transfer pair still points at itself', async () => {
    await withRollback(async (tx) => {
      const { egp, usd } = await seedLedger(tx);

      const transfer = asTransfer(
        await createTransaction(tx, {
          type: 'TRANSFER',
          fromAccountId: egp.id,
          toAccountId: usd.id,
          fromAmount: '100',
          date: DATE,
          note: null,
        }),
      );
      const groupId = transfer.transferGroupId;

      const backup = await exportAll(tx);
      await importBackup(tx, backup, false, backupDir);

      const rows = await tx.transaction.findMany({ where: { transferGroupId: groupId } });
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((row) => row.accountId))).toEqual(new Set([egp.id, usd.id]));
    });
  });

  it('writes nothing on a dry run but reports what it would do', async () => {
    await withRollback(async (tx) => {
      await seedLedger(tx);
      const backup = await exportAll(tx);

      // A backup of a different shape: drop the transactions.
      const trimmed: BackupDto = {
        ...backup,
        data: { ...backup.data, transactions: [] },
      };

      const countBefore = await tx.transaction.count();
      const report = await importBackup(tx, trimmed, true, backupDir);

      expect(report.dryRun).toBe(true);
      expect(report.applied).toBe(false);
      expect(await tx.transaction.count()).toBe(countBefore);

      const transactions = report.changes.find((change) => change.table === 'transactions');
      expect(transactions?.existing).toBe(countBefore);
      expect(transactions?.incoming).toBe(0);
    });
  });

  it('replaces rather than merges — a row absent from the backup is gone afterwards', async () => {
    await withRollback(async (tx) => {
      const { egp, category } = await seedLedger(tx);
      const backup = await exportAll(tx);

      const afterwards = asEntry(
        await createTransaction(tx, {
          type: 'EXPENSE',
          amount: '999',
          accountId: egp.id,
          categoryId: category.id,
          date: DATE,
          note: 'created after the backup',
        }),
      );

      await importBackup(tx, backup, false, backupDir);

      expect(await tx.transaction.count({ where: { id: afterwards.id } })).toBe(0);
    });
  });

  it('refuses a backup whose transaction names an account it does not contain', async () => {
    await withRollback(async (tx) => {
      await seedLedger(tx);
      const backup = await exportAll(tx);

      const orphaned: BackupDto = {
        ...backup,
        data: { ...backup.data, accounts: [] },
      };

      const countBefore = await tx.transaction.count();
      const report = await importBackup(tx, orphaned, false, backupDir);

      expect(report.applied).toBe(false);
      expect(report.problems.length).toBeGreaterThan(0);
      expect(report.problems.join(' ')).toContain('account');
      // Nothing was written, so the wipe never happened either.
      expect(await tx.transaction.count()).toBe(countBefore);
    });
  });

  it('refuses a transaction whose currency does not match its account (D3)', async () => {
    await withRollback(async (tx) => {
      const { expense } = await seedLedger(tx);
      const backup = await exportAll(tx);

      const mismatched: BackupDto = {
        ...backup,
        data: {
          ...backup.data,
          transactions: backup.data.transactions.map((row) =>
            row.id === expense.id ? { ...row, currency: 'USD' as const } : row,
          ),
        },
      };

      const report = await importBackup(tx, mismatched, false, backupDir);

      expect(report.applied).toBe(false);
      expect(report.problems.join(' ')).toContain('USD');
    });
  });

  it('flags a row whose rate post-dates it instead of importing it silently (SPEC §6)', async () => {
    await withRollback(async (tx) => {
      const { expense } = await seedLedger(tx);
      const backup = await exportAll(tx);

      const backdated: BackupDto = {
        ...backup,
        data: {
          ...backup.data,
          transactions: backup.data.transactions.map((row) =>
            row.id === expense.id
              ? { ...row, date: '2026-03-12T00:00:00.000Z', rateAsOf: '2026-08-03T00:00:00.000Z' }
              : row,
          ),
        },
      };

      const report = await importBackup(tx, backdated, true, backupDir);

      const flagged = report.approximateRows.find((row) => row.id === expense.id);
      expect(flagged).toBeDefined();
      expect(flagged?.table).toBe('transactions');
    });
  });

  it('rejects a backup written by a newer version', async () => {
    await withRollback(async (tx) => {
      await seedLedger(tx);
      const backup = await exportAll(tx);

      await expect(
        importBackup(tx, { ...backup, version: BACKUP_VERSION + 1 }, true, backupDir),
      ).rejects.toMatchObject({ status: 422 });
    });
  });

  it('never restores baseCurrency, which is locked to EGP (D6)', async () => {
    await withRollback(async (tx) => {
      await seedLedger(tx);
      const backup = await exportAll(tx);

      await importBackup(
        tx,
        {
          ...backup,
          data: { ...backup.data, settings: { ...backup.data.settings, locale: 'ar-EG' } },
        },
        false,
        backupDir,
      );

      const settings = await tx.setting.findUniqueOrThrow({ where: { id: 1 } });
      expect(settings.baseCurrency).toBe('EGP');
      expect(settings.locale).toBe('ar-EG');
    });
  });

  /**
   * An import replaces rather than merges, so applying one destroys the current ledger as
   * surely as a reset does — and picking the wrong file is the easier mistake of the two.
   * Same copy, same guarantee.
   */
  describe('the safety copy', () => {
    it('saves what it is about to replace, and says where', async () => {
      await withRollback(async (tx) => {
        const { expense } = await seedLedger(tx);
        const backup = await exportAll(tx);

        // A backup that would wipe the current transactions out.
        const trimmed: BackupDto = { ...backup, data: { ...backup.data, transactions: [] } };
        const report = await importBackup(tx, trimmed, false, backupDir);

        expect(report.applied).toBe(true);
        expect(await tx.transaction.count({ where: { id: expense.id } })).toBe(0);

        expect(report.backupPath).not.toBeNull();
        const saved = JSON.parse(await readFile(report.backupPath as string, 'utf8')) as BackupDto;
        expect(saved.data.transactions.some((row) => row.id === expense.id)).toBe(true);
      });
    });

    /** Names the file for what it is, because the two regrets read very differently. */
    it('marks the file as an import rather than a reset', async () => {
      await withRollback(async (tx) => {
        await seedLedger(tx);
        const backup = await exportAll(tx);

        const report = await importBackup(tx, backup, false, backupDir);

        expect(path.basename(report.backupPath as string)).toMatch(/^ledger-eg-before-import-/);
      });
    });

    it('writes nothing for a dry run, which changes nothing', async () => {
      await withRollback(async (tx) => {
        await seedLedger(tx);
        const backup = await exportAll(tx);

        const report = await importBackup(tx, backup, true, backupDir);

        expect(report.backupPath).toBeNull();
        expect(await readdir(backupDir)).toHaveLength(0);
      });
    });

    it('writes nothing when the backup is rejected', async () => {
      await withRollback(async (tx) => {
        await seedLedger(tx);
        const backup = await exportAll(tx);
        const orphaned: BackupDto = { ...backup, data: { ...backup.data, accounts: [] } };

        const report = await importBackup(tx, orphaned, false, backupDir);

        expect(report.applied).toBe(false);
        expect(report.backupPath).toBeNull();
        expect(await readdir(backupDir)).toHaveLength(0);
      });
    });

    it('refuses to replace anything when the copy cannot be written', async () => {
      await withRollback(async (tx) => {
        const { expense } = await seedLedger(tx);
        const backup = await exportAll(tx);
        const trimmed: BackupDto = { ...backup, data: { ...backup.data, transactions: [] } };

        const blocked = path.join(backupDir, 'not-a-directory');
        await writeFile(blocked, 'in the way', 'utf8');

        await expect(importBackup(tx, trimmed, false, blocked)).rejects.toThrow();
        expect(await tx.transaction.count({ where: { id: expense.id } })).toBe(1);
      });
    });
  });
});

describe('reset', () => {
  it('empties every table and reports what it removed', async () => {
    await withRollback(async (tx) => {
      await seedLedger(tx);
      const before = await tx.transaction.count();
      expect(before).toBeGreaterThan(0);

      const report = await resetAll(tx, false, backupDir);

      expect(report.deleted.transactions).toBe(before);
      expect(report.totalDeleted).toBeGreaterThan(0);
      expect(await tx.transaction.count()).toBe(0);
      expect(await tx.account.count()).toBe(0);
      expect(await tx.category.count()).toBe(0);
      expect(await tx.exchangeRate.count()).toBe(0);
    });
  });

  it('restores the starter categories and rates, so the app is usable afterwards', async () => {
    await withRollback(async (tx) => {
      await seedLedger(tx);

      const report = await resetAll(tx, true, backupDir);

      expect(report.restoredStarterData).toBe(true);
      expect(await tx.category.count()).toBeGreaterThan(0);
      expect(await tx.exchangeRate.count()).toBeGreaterThan(0);
      // Accounts are personal, not starter data — a reset does not invent them.
      expect(await tx.account.count()).toBe(0);
    });
  });

  it('keeps the settings row, restored to its defaults', async () => {
    await withRollback(async (tx) => {
      await seedLedger(tx);
      await tx.setting.update({ where: { id: 1 }, data: { ratesApiEnabled: false } });

      await resetAll(tx, false, backupDir);

      const settings = await tx.setting.findUniqueOrThrow({ where: { id: 1 } });
      expect(settings.ratesApiEnabled).toBe(true);
      expect(settings.baseCurrency).toBe('EGP');
    });
  });

  /**
   * The reset is the only action in the app that destroys data with no undo. It takes a
   * full export first, so "this cannot be undone" stops being true — and reports where the
   * copy went, because a backup you cannot find is not a backup.
   */
  describe('the safety copy', () => {
    it('writes a full export before wiping, and says where', async () => {
      await withRollback(async (tx) => {
        const { expense } = await seedLedger(tx);

        const report = await resetAll(tx, false, backupDir);

        expect(report.backupPath).not.toBeNull();
        expect(await readdir(backupDir)).toHaveLength(1);

        const written = JSON.parse(
          await readFile(report.backupPath as string, 'utf8'),
        ) as BackupDto;
        expect(written.data.transactions.some((row) => row.id === expense.id)).toBe(true);
      });
    });

    /** The copy is the ledger as it stood, so importing it puts everything back. */
    it('writes something the app will accept back', async () => {
      await withRollback(async (tx) => {
        const { expense } = await seedLedger(tx);
        const report = await resetAll(tx, true, backupDir);
        expect(await tx.transaction.count()).toBe(0);

        const written = JSON.parse(
          await readFile(report.backupPath as string, 'utf8'),
        ) as BackupDto;
        const restored = await importBackup(tx, written, false, backupDir);

        expect(restored.applied).toBe(true);
        expect(restored.problems).toEqual([]);
        expect(await tx.transaction.count({ where: { id: expense.id } })).toBe(1);
      });
    });

    /** Nothing to lose, nothing to write — an empty file is filing-cabinet noise. */
    it('writes no file when the database is already empty', async () => {
      await withRollback(async (tx) => {
        // The first one empties it, and copies whatever was there beforehand.
        await resetAll(tx, false, backupDir);
        const afterFirst = (await readdir(backupDir)).length;

        const report = await resetAll(tx, false, backupDir);

        expect(report.backupPath).toBeNull();
        expect(await readdir(backupDir)).toHaveLength(afterFirst);
      });
    });

    /**
     * The guarantee is worth more than the convenience: if the copy cannot be written, the
     * wipe must not happen. A reset that half-succeeded because the disk was full would be
     * the worst of both.
     */
    it('refuses to wipe anything when the copy cannot be written', async () => {
      await withRollback(async (tx) => {
        await seedLedger(tx);
        const before = await tx.transaction.count();

        // A file where the directory should be, so creating it fails.
        const blocked = path.join(backupDir, 'not-a-directory');
        await writeFile(blocked, 'in the way', 'utf8');

        await expect(resetAll(tx, false, blocked)).rejects.toThrow();
        expect(await tx.transaction.count()).toBe(before);
      });
    });
  });
});
