import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { budgetsApi } from './api';

export const budgetKeys = {
  all: ['budgets'] as const,
  month: (month: string) => [...budgetKeys.all, month] as const,
};

export function useBudgetMonth(month: string) {
  return useQuery({ queryKey: budgetKeys.month(month), queryFn: () => budgetsApi.month(month) });
}

export function usePutBudgets() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      month,
      budgets,
    }: {
      month: string;
      budgets: Array<{ categoryId: string; limitEgp: string | null }>;
    }) => budgetsApi.put(month, budgets),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: budgetKeys.all }),
  });
}

export function useCopyBudgets() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      fromMonth,
      toMonth,
      overwrite,
    }: {
      fromMonth: string;
      toMonth: string;
      overwrite: boolean;
    }) => budgetsApi.copy(fromMonth, toMonth, overwrite),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: budgetKeys.all }),
  });
}
