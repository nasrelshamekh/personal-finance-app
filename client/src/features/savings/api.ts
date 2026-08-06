import type { SavingsGoalDto } from '@ledger/shared';
import { api } from '@/lib/api';

export interface CreateGoalBody {
  name: string;
  targetAmount: string;
  currency: string;
  deadline: string | null;
  color: string;
  icon: string;
}

export interface CreateContributionBody {
  amount: string;
  date: string;
  accountId: string | null;
}

export const savingsApi = {
  list: () => api.get<{ data: SavingsGoalDto[] }>('/savings-goals'),
  create: (body: CreateGoalBody) => api.post<SavingsGoalDto>('/savings-goals', body),
  update: (id: string, body: Partial<CreateGoalBody> & { isArchived?: boolean }) =>
    api.patch<SavingsGoalDto>(`/savings-goals/${id}`, body),
  remove: (id: string) => api.delete<{ id: string }>(`/savings-goals/${id}`),
  addContribution: (id: string, body: CreateContributionBody) =>
    api.post<SavingsGoalDto>(`/savings-goals/${id}/contributions`, body),
  removeContribution: (id: string, contributionId: string) =>
    api.delete<SavingsGoalDto>(`/savings-goals/${id}/contributions/${contributionId}`),
};
