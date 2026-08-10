import { useRef, useState } from 'react';
import { AlertTriangle, Download, Trash2, Upload } from 'lucide-react';
import {
  backupSchema,
  RESET_CONFIRMATION,
  type BackupDto,
  type ImportReportDto,
  type ResetReportDto,
} from '@ledger/shared';
import { cn } from '@/lib/cn';
import { ApiError } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useExportBackup, useImportBackup, useResetData } from '@/features/backup/queries';

const TABLE_LABELS: Record<string, string> = {
  accounts: 'Accounts',
  categories: 'Categories',
  debts: 'Debts',
  debtPayments: 'Debt payments',
  savingsGoals: 'Savings goals',
  savingsContributions: 'Contributions',
  transactions: 'Transactions',
  budgets: 'Budgets',
  exchangeRates: 'Exchange rates',
};

function ExportCard() {
  const exportBackup = useExportBackup();

  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-sm font-medium text-foreground">Export everything</p>
      <p className="mt-1 max-w-prose text-xs text-muted-foreground">
        One JSON file holding every account, transaction, debt, goal, budget and rate — with each
        figure exactly as it was frozen, not reconverted. Keep it somewhere that is not this
        machine.
      </p>

      <button
        type="button"
        onClick={() => exportBackup.mutate()}
        disabled={exportBackup.isPending}
        className="mt-3 inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Download className="size-3.5" aria-hidden />
        {exportBackup.isPending ? 'Preparing…' : 'Download backup'}
      </button>

      {exportBackup.isSuccess && (
        <p role="status" className="mt-2 text-xs text-money-positive">
          Saved {exportBackup.data.filename} (
          {Math.max(1, Math.round(exportBackup.data.bytes / 1024))} KB).
        </p>
      )}
      {exportBackup.isError && (
        <p role="alert" className="mt-2 text-xs text-money-negative">
          The export failed. Nothing was changed.
        </p>
      )}
    </div>
  );
}

function ImportReport({ report }: { report: ImportReportDto }) {
  const moved = report.changes.filter(
    (change) => change.existing !== change.incoming || change.incoming > 0,
  );

  return (
    <div className="mt-3 rounded-md border border-border bg-card/40 p-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {report.applied ? 'What was restored' : 'What this would do'}
      </p>

      {report.problems.length > 0 ? (
        <div className="mt-2">
          <p className="text-xs text-money-negative">
            This backup cannot be restored — nothing has been changed.
          </p>
          <ul className="mt-1.5 space-y-1">
            {report.problems.slice(0, 8).map((problem) => (
              <li key={problem} className="text-xs text-muted-foreground">
                · {problem}
              </li>
            ))}
            {report.problems.length > 8 && (
              <li className="text-xs text-muted-foreground">
                · and {report.problems.length - 8} more.
              </li>
            )}
          </ul>
        </div>
      ) : (
        <>
          <table className="mt-2 w-full text-xs">
            <caption className="sr-only">Rows this backup would replace</caption>
            <thead>
              <tr className="text-left text-muted-foreground">
                <th scope="col" className="pb-1 font-medium">
                  Table
                </th>
                <th scope="col" className="pb-1 text-right font-medium">
                  Now
                </th>
                <th scope="col" className="pb-1 text-right font-medium">
                  After
                </th>
              </tr>
            </thead>
            <tbody>
              {moved.map((change) => (
                <tr key={change.table}>
                  <td className="py-0.5 text-foreground">
                    {TABLE_LABELS[change.table] ?? change.table}
                  </td>
                  <td className="py-0.5 text-right font-numeric tabular-nums text-muted-foreground">
                    {change.existing}
                  </td>
                  <td className="py-0.5 text-right font-numeric tabular-nums text-foreground">
                    {change.incoming}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="mt-2 text-xs text-muted-foreground">
            {report.totalExisting} rows here now, {report.totalIncoming} in the backup. A restore
            replaces — anything not in the file is gone afterwards.
          </p>

          {report.approximateRows.length > 0 && (
            <p className="mt-2 text-xs text-money-stale">
              {report.approximateRows.length}{' '}
              {report.approximateRows.length === 1 ? 'row was' : 'rows were'} converted at a rate
              that post-dates them, so those pound figures are approximate. They import as they are
              — flagged, not silently corrected.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function ImportCard() {
  const importBackup = useImportBackup();
  const fileRef = useRef<HTMLInputElement>(null);

  const [backup, setBackup] = useState<BackupDto | null>(null);
  const [filename, setFilename] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReportDto | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setFileError(null);
    setReport(null);
    setApplyError(null);
    setBackup(null);
    setFilename(file.name);

    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setFileError('That file is not JSON.');
      return;
    }

    // Validated here as well as on the server: a mistyped file should say so instantly
    // rather than after a round trip, and the schema is the same one either side (D7).
    const result = backupSchema.safeParse(parsed);
    if (!result.success) {
      setFileError(
        'That file is not a Ledger EG backup, or it is damaged. Nothing has been changed.',
      );
      return;
    }

    setBackup(result.data);
    try {
      setReport(await importBackup.mutateAsync({ backup: result.data, dryRun: true }));
    } catch (caught) {
      setFileError(caught instanceof ApiError ? caught.message : 'That backup could not be read.');
    }
  }

  async function apply() {
    if (backup === null) return;
    setApplyError(null);
    try {
      setReport(await importBackup.mutateAsync({ backup, dryRun: false }));
      setBackup(null);
    } catch (caught) {
      setApplyError(
        caught instanceof ApiError ? caught.message : 'The restore failed. Nothing was changed.',
      );
    }
  }

  const canApply = backup !== null && report !== null && report.problems.length === 0;

  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-sm font-medium text-foreground">Restore from a backup</p>
      <p className="mt-1 max-w-prose text-xs text-muted-foreground">
        Pick a file and you get a summary of what would change. Nothing is written until you
        confirm, and a restore replaces everything rather than merging — so what is here now is
        saved to disk first, in case the file turns out to be the wrong one.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          aria-label="Choose a backup file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
            // Cleared so choosing the same file twice fires change again.
            event.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Upload className="size-3.5" aria-hidden />
          Choose a file
        </button>
        {filename !== '' && (
          <span className="truncate font-numeric text-xs text-muted-foreground">{filename}</span>
        )}
      </div>

      {fileError !== null && (
        <p role="alert" className="mt-2 text-xs text-money-negative">
          {fileError}
        </p>
      )}

      {report !== null && <ImportReport report={report} />}

      {canApply && (
        <button
          type="button"
          onClick={() => void apply()}
          disabled={importBackup.isPending}
          className="mt-3 inline-flex items-center gap-2 rounded-md bg-money-negative px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {importBackup.isPending ? 'Restoring…' : 'Replace everything with this backup'}
        </button>
      )}

      {report?.applied === true && (
        <div role="status" className="mt-2 space-y-1">
          <p className="text-xs text-money-positive">
            Restored. Every screen is now reading the backup.
          </p>
          {/* The way back from restoring the wrong file, named rather than promised. */}
          {report.backupPath !== null && (
            <p className="text-xs text-muted-foreground">
              What was here before was saved to{' '}
              <span className="break-all font-numeric text-foreground">{report.backupPath}</span>.
            </p>
          )}
        </div>
      )}

      {applyError !== null && (
        <p role="alert" className="mt-2 text-xs text-money-negative">
          {applyError}
        </p>
      )}
    </div>
  );
}

function ResetCard() {
  const reset = useResetData();
  const [confirmation, setConfirmation] = useState('');
  const [restoreStarterData, setRestoreStarterData] = useState(true);
  const [report, setReport] = useState<ResetReportDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const matches = confirmation === RESET_CONFIRMATION;

  async function handleReset() {
    if (!matches) return;
    setError(null);
    try {
      setReport(await reset.mutateAsync({ confirmation, restoreStarterData }));
      setConfirmation('');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The reset failed.');
    }
  }

  return (
    <div className="rounded-lg border border-money-negative/40 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-money-negative" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">Erase all data</p>
          <p className="mt-1 max-w-prose text-xs text-muted-foreground">
            Deletes every account, transaction, debt, goal, budget and rate. A full copy is written
            to disk first and its location shown here, so this is recoverable — but only from that
            file, and only on this machine.
          </p>

          <label
            htmlFor="reset-restore-starter"
            className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"
          >
            <input
              id="reset-restore-starter"
              type="checkbox"
              checked={restoreStarterData}
              onChange={(event) => setRestoreStarterData(event.target.checked)}
              className="size-3.5 accent-[var(--primary)]"
            />
            Put the starter categories and rates back, so the app is usable straight away
          </label>

          <div className="mt-3 max-w-xs space-y-1.5">
            <Label htmlFor="reset-confirmation">
              Type <span className="font-numeric text-foreground">{RESET_CONFIRMATION}</span> to
              confirm
            </Label>
            <Input
              id="reset-confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder={RESET_CONFIRMATION}
              className="font-numeric"
            />
          </div>

          <button
            type="button"
            onClick={() => void handleReset()}
            disabled={!matches || reset.isPending}
            className={cn(
              'mt-3 inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium',
              'bg-money-negative text-white transition-opacity hover:opacity-90',
              'disabled:cursor-not-allowed disabled:opacity-40',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            )}
          >
            <Trash2 className="size-3.5" aria-hidden />
            {reset.isPending ? 'Erasing…' : 'Erase everything'}
          </button>

          {report !== null && (
            <div role="status" className="mt-2 space-y-1">
              <p className="text-xs text-money-positive">
                Erased {report.totalDeleted} {report.totalDeleted === 1 ? 'row' : 'rows'}.
                {report.restoredStarterData && ' The starter categories and rates are back.'}
              </p>
              {/*
                Named, not merely promised. A copy you cannot find is not a copy, and this
                is the one moment someone needs to know exactly where it went.
              */}
              {report.backupPath !== null && (
                <p className="text-xs text-muted-foreground">
                  A copy was saved first, at{' '}
                  <span className="break-all font-numeric text-foreground">
                    {report.backupPath}
                  </span>
                  . Restore it above with “Choose a file”.
                </p>
              )}
            </div>
          )}
          {error !== null && (
            <p role="alert" className="mt-2 text-xs text-money-negative">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function DataSection() {
  return (
    <div className="space-y-4">
      <ExportCard />
      <ImportCard />
      <ResetCard />
    </div>
  );
}
