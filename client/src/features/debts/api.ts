import type { DebtDto } from '@ledger/shared';
import { api } from '@/lib/api';

export interface CreateDebtBody {
  counterparty: string;
  direction: 'I_OWE' | 'OWED_TO_ME';
  principal: string;
  currency: string;
  startDate: string;
  dueDate: string | null;
  note: string | null;
}

export interface CreatePaymentBody {
  amount: string;
  date: string;
  note: string | null;
  accountId: string | null;
}

export const debtsApi = {
  list: () => api.get<{ data: DebtDto[] }>('/debts'),
  create: (body: CreateDebtBody) => api.post<DebtDto>('/debts', body),
  update: (id: string, body: Partial<CreateDebtBody> & { status?: string }) =>
    api.patch<DebtDto>(`/debts/${id}`, body),
  remove: (id: string) => api.delete<{ id: string }>(`/debts/${id}`),
  addPayment: (id: string, body: CreatePaymentBody) =>
    api.post<DebtDto>(`/debts/${id}/payments`, body),
  removePayment: (id: string, paymentId: string) =>
    api.delete<DebtDto>(`/debts/${id}/payments/${paymentId}`),
};
