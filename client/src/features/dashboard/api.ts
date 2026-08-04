import type { DashboardDto } from '@ledger/shared';
import { api } from '@/lib/api';

export const dashboardApi = {
  get: (month?: string) =>
    api.get<DashboardDto>('/dashboard', month === undefined ? {} : { month }),
};
