import { useQuery } from '@tanstack/react-query';
import { dashboardKeys } from '@/features/transactions/queries';
import { dashboardApi } from './api';

export function useDashboard(month: string | undefined) {
  return useQuery({
    queryKey: dashboardKeys.month(month),
    queryFn: () => dashboardApi.get(month),
  });
}
