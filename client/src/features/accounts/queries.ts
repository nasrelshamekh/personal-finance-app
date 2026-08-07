import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AccountDto, UpdateAccountInput } from '@ledger/shared';
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

/** One shared empty array, so "no accounts yet" is always the same array. */
const NO_ACCOUNTS: readonly AccountDto[] = [];

/**
 * The list on its own, never undefined.
 *
 * `const { data: accounts = [] } = useAccounts()` looks equivalent and is not: it mints a
 * fresh array on every render while the query is pending. Put that in a `useEffect`
 * dependency list — which three sheets do, to pick a default account — and the effect
 * re-runs every render, its `setFieldErrors({})` stores a new object, and the component
 * spins until the query resolves. Returning a stable reference makes that impossible
 * rather than merely fixed in the places it was noticed.
 */
export function useAccountList(includeArchived = false): readonly AccountDto[] {
  const { data } = useAccounts(includeArchived);
  return data ?? NO_ACCOUNTS;
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
