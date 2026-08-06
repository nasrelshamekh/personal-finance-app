import type { BudgetMonthDto, CopyBudgetsResponse } from '@ledger/shared';
import { api } from '@/lib/api';

export const budgetsApi = {
  month: (month: string) => api.get<BudgetMonthDto>('/budgets', { month }),
  put: (month: string, budgets: Array<{ categoryId: string; limitEgp: string | null }>) =>
    api.put<BudgetMonthDto>('/budgets', { month, budgets }),
  copy: (fromMonth: string, toMonth: string, overwrite: boolean) =>
    api.post<CopyBudgetsResponse>('/budgets/copy', { fromMonth, toMonth, overwrite }),
};
