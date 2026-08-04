import type { AccountDto } from '@ledger/shared';
import { api } from '@/lib/api';

export const accountsApi = {
  list: (includeArchived = false) =>
    api.get<{ data: AccountDto[] }>('/accounts', { includeArchived: String(includeArchived) }),
  get: (id: string) => api.get<AccountDto>(`/accounts/${id}`),
};
