import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { accountKeys } from '@/features/accounts/queries';
import { fxKeys } from '@/features/fx/queries';
import {
  transactionsApi,
  type CreateEntryBody,
  type CreateTransferBody,
  type TransactionFilters,
  type UpdateBody,
} from './api';

export const transactionKeys = {
  all: ['transactions'] as const,
  list: (filters: TransactionFilters) => [...transactionKeys.all, 'list', filters] as const,
};

export const dashboardKeys = {
  all: ['dashboard'] as const,
  month: (month: string | undefined) => [...dashboardKeys.all, month ?? 'current'] as const,
};

export function useTransactions(filters: TransactionFilters) {
  return useQuery({
    queryKey: transactionKeys.list(filters),
    queryFn: () => transactionsApi.list(filters),
  });
}

/**
 * Anything that writes a transaction moves balances and the dashboard too, so all three
 * are invalidated together. Keeping that in one place stops a screen going stale because
 * a mutation somewhere else forgot about it.
 */
function useInvalidateAfterWrite() {
  const queryClient = useQueryClient();

  return () => {
    void queryClient.invalidateQueries({ queryKey: transactionKeys.all });
    void queryClient.invalidateQueries({ queryKey: accountKeys.all });
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    // A write resolves a rate, which can be the first thing to store one for today.
    void queryClient.invalidateQueries({ queryKey: fxKeys.all });
  };
}

export function useCreateTransaction() {
  const invalidate = useInvalidateAfterWrite();

  return useMutation({
    mutationFn: (body: CreateEntryBody | CreateTransferBody) => transactionsApi.create(body),
    onSuccess: invalidate,
  });
}

export function useUpdateTransaction() {
  const invalidate = useInvalidateAfterWrite();

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateBody }) =>
      transactionsApi.update(id, body),
    onSuccess: invalidate,
  });
}

export function useDeleteTransaction() {
  const invalidate = useInvalidateAfterWrite();

  return useMutation({
    mutationFn: (id: string) => transactionsApi.remove(id),
    onSuccess: invalidate,
  });
}
