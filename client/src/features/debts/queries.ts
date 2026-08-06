import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { accountKeys } from '@/features/accounts/queries';
import { dashboardKeys, transactionKeys } from '@/features/transactions/queries';
import { debtsApi, type CreateDebtBody, type CreatePaymentBody } from './api';

export const debtKeys = {
  all: ['debts'] as const,
  list: () => [...debtKeys.all, 'list'] as const,
};

export function useDebts() {
  return useQuery({
    queryKey: debtKeys.list(),
    queryFn: debtsApi.list,
    select: ({ data }) => data,
  });
}

/**
 * A debt payment can write a transaction too, which moves a balance and the dashboard.
 * Invalidating all four together keeps every screen honest after one action.
 */
function useInvalidate() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: debtKeys.all });
    void queryClient.invalidateQueries({ queryKey: accountKeys.all });
    void queryClient.invalidateQueries({ queryKey: transactionKeys.all });
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
  };
}

export function useCreateDebt() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: CreateDebtBody) => debtsApi.create(body),
    onSuccess: invalidate,
  });
}

export function useUpdateDebt() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: Partial<CreateDebtBody> & { status?: string };
    }) => debtsApi.update(id, body),
    onSuccess: invalidate,
  });
}

export function useDeleteDebt() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => debtsApi.remove(id), onSuccess: invalidate });
}

export function useAddDebtPayment() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CreatePaymentBody }) =>
      debtsApi.addPayment(id, body),
    onSuccess: invalidate,
  });
}

export function useDeleteDebtPayment() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, paymentId }: { id: string; paymentId: string }) =>
      debtsApi.removePayment(id, paymentId),
    onSuccess: invalidate,
  });
}
