import type {
  DeleteTransactionResponse,
  Paginated,
  TransactionDto,
  TransferGroupDto,
} from '@ledger/shared';
import { api } from '@/lib/api';

/**
 * The filter set the transactions screen exposes (SPEC §7).
 *
 * Every field is `?: T | undefined` rather than just `?: T`. Under
 * `exactOptionalPropertyTypes` those differ: the first lets a filter be *cleared* by
 * assigning undefined, which is exactly what "any account" means here. `buildUrl` drops
 * undefined keys, so a cleared filter never reaches the query string.
 */
export interface TransactionFilters {
  page?: number | undefined;
  pageSize?: number | undefined;
  from?: string | undefined;
  to?: string | undefined;
  type?: string | undefined;
  accountId?: string | undefined;
  categoryId?: string | undefined;
  currency?: string | undefined;
  q?: string | undefined;
  minAmount?: string | undefined;
  maxAmount?: string | undefined;
}

export interface CreateEntryBody {
  type: 'INCOME' | 'EXPENSE';
  amount: string;
  accountId: string;
  categoryId: string | null;
  date: string;
  note: string | null;
}

export interface CreateTransferBody {
  type: 'TRANSFER';
  fromAccountId: string;
  toAccountId: string;
  fromAmount: string;
  toAmount?: string;
  date: string;
  note: string | null;
}

export interface UpdateBody {
  amount?: string;
  fromAmount?: string;
  toAmount?: string;
  categoryId?: string | null;
  date?: string;
  note?: string | null;
}

export const transactionsApi = {
  list: (filters: TransactionFilters) =>
    api.get<Paginated<TransactionDto>>('/transactions', { ...filters }),

  create: (body: CreateEntryBody | CreateTransferBody) =>
    api.post<TransactionDto | TransferGroupDto>('/transactions', body),

  update: (id: string, body: UpdateBody) =>
    api.patch<TransactionDto | TransferGroupDto>(`/transactions/${id}`, body),

  remove: (id: string) => api.delete<DeleteTransactionResponse>(`/transactions/${id}`),
};
