import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdateAccountInput } from '@ledger/shared';
import { dashboardKeys, transactionKeys } from '@/features/transactions/queries';
import { accountsApi, type CreateAccountBody } from './api';

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

function useInvalidate() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: accountKeys.all });
    void queryClient.invalidateQueries({ queryKey: transactionKeys.all });
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
  };
}

export function useCreateAccount() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: CreateAccountBody) => accountsApi.create(body),
    onSuccess: invalidate,
  });
}

export function useUpdateAccount() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateAccountInput }) =>
      accountsApi.update(id, body),
    onSuccess: invalidate,
  });
}

export function useDeleteAccount() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => accountsApi.remove(id),
    onSuccess: invalidate,
  });
}
