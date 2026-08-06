import type {
  AccountDto,
  CreateAccountInput,
  DeleteAccountResponse,
  UpdateAccountInput,
} from '@ledger/shared';
import { api } from '@/lib/api';

/**
 * `createAccountSchema` transforms `openingDate` into a Date, so the inferred input type
 * is not what crosses the wire. The body type restates it as the ISO string the client
 * actually sends.
 */
export type CreateAccountBody = Omit<CreateAccountInput, 'openingDate'> & {
  openingDate?: string;
};

export const accountsApi = {
  list: (includeArchived = false) =>
    api.get<{ data: AccountDto[] }>('/accounts', { includeArchived: String(includeArchived) }),
  get: (id: string) => api.get<AccountDto>(`/accounts/${id}`),
  create: (body: CreateAccountBody) => api.post<AccountDto>('/accounts', body),
  update: (id: string, body: UpdateAccountInput) => api.patch<AccountDto>(`/accounts/${id}`, body),
  remove: (id: string) => api.delete<DeleteAccountResponse>(`/accounts/${id}`),
};
