import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { BackupDto } from '@ledger/shared';
import { backupApi } from './api';

/**
 * An import or a reset rewrites the whole database, so nothing cached is still true
 * afterwards. `clear()` rather than `invalidateQueries()`: invalidation refetches what is
 * currently mounted and leaves everything else stale, which is how you end up looking at
 * a dashboard from before the restore.
 */
function useResetCaches() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.clear();
  };
}

export function useExportBackup() {
  return useMutation({ mutationFn: backupApi.download });
}

export function useImportBackup() {
  const resetCaches = useResetCaches();

  return useMutation({
    mutationFn: ({ backup, dryRun }: { backup: BackupDto; dryRun: boolean }) =>
      backupApi.import(backup, dryRun),
    onSuccess: (report) => {
      if (report.applied) resetCaches();
    },
  });
}

export function useResetData() {
  const resetCaches = useResetCaches();

  return useMutation({
    mutationFn: ({
      confirmation,
      restoreStarterData,
    }: {
      confirmation: string;
      restoreStarterData: boolean;
    }) => backupApi.reset(confirmation, restoreStarterData),
    onSuccess: resetCaches,
  });
}
