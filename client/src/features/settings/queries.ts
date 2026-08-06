import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdateSettingsInput } from '@ledger/shared';
import { fxKeys } from '@/features/fx/queries';
import { settingsApi } from './api';

export const settingsKeys = {
  all: ['settings'] as const,
};

export function useSettings() {
  return useQuery({ queryKey: settingsKeys.all, queryFn: settingsApi.get });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: UpdateSettingsInput) => settingsApi.update(body),
    onSuccess: (updated) => {
      queryClient.setQueryData(settingsKeys.all, updated);
      // Turning the rates API on or off changes what `GET /fx/rates` does on its way in.
      void queryClient.invalidateQueries({ queryKey: fxKeys.all });
    },
  });
}
