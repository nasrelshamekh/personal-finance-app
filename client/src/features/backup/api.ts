import type { BackupDto, ImportReportDto, ResetReportDto } from '@ledger/shared';
import { api } from '@/lib/api';

/**
 * The export is fetched rather than linked to, so a failure surfaces as an error in the
 * page instead of a browser tab showing the raw JSON of a 500. The download is then
 * triggered from the blob the app already holds.
 */
async function downloadExport(): Promise<{ filename: string; bytes: number }> {
  const response = await fetch('/api/export');
  if (!response.ok) {
    throw new Error(`The export failed (${response.status}).`);
  }

  const blob = await response.blob();
  const filename = filenameFrom(response.headers.get('content-disposition'));

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoked on the next tick: revoking synchronously can cancel the download in Safari.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);

  return { filename, bytes: blob.size };
}

function filenameFrom(header: string | null): string {
  const match = header?.match(/filename="([^"]+)"/);
  return match?.[1] ?? `ledger-eg-${new Date().toISOString().slice(0, 10)}.json`;
}

export const backupApi = {
  download: downloadExport,
  import: (backup: BackupDto, dryRun: boolean) =>
    api.post<ImportReportDto>('/import', { backup, dryRun }),
  reset: (confirmation: string, restoreStarterData: boolean) =>
    api.post<ResetReportDto>('/reset', { confirmation, restoreStarterData }),
};
