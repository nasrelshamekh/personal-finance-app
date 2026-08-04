import { useQuery } from '@tanstack/react-query';
import { accountsApi } from './api';

export const accountKeys = {
  all: ['accounts'] as const,
  list: (includeArchived: boolean) => [...accountKeys.all, 'list', includeArchived] as const,
};

export function useAccounts(includeArchived = false) {
  return useQuery({
    queryKey: accountKeys.list(includeArchived),
    queryFn: () => accountsApi.list(includeArchived),
    select: ({ data }) => data,
  });
}
