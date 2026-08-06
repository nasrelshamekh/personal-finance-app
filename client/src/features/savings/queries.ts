import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { accountKeys } from '@/features/accounts/queries';
import { dashboardKeys, transactionKeys } from '@/features/transactions/queries';
import { savingsApi, type CreateContributionBody, type CreateGoalBody } from './api';

export const savingsKeys = {
  all: ['savings'] as const,
  list: () => [...savingsKeys.all, 'list'] as const,
};

export function useSavingsGoals() {
  return useQuery({
    queryKey: savingsKeys.list(),
    queryFn: savingsApi.list,
    select: ({ data }) => data,
  });
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: savingsKeys.all });
    void queryClient.invalidateQueries({ queryKey: accountKeys.all });
    void queryClient.invalidateQueries({ queryKey: transactionKeys.all });
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
  };
}

export function useCreateGoal() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: CreateGoalBody) => savingsApi.create(body),
    onSuccess: invalidate,
  });
}

export function useUpdateGoal() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: Partial<CreateGoalBody> & { isArchived?: boolean };
    }) => savingsApi.update(id, body),
    onSuccess: invalidate,
  });
}

export function useDeleteGoal() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => savingsApi.remove(id), onSuccess: invalidate });
}

export function useAddContribution() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CreateContributionBody }) =>
      savingsApi.addContribution(id, body),
    onSuccess: invalidate,
  });
}
