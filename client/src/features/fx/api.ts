import type { FxRatesResponse, StoredRateDto } from '@ledger/shared';
import { api } from '@/lib/api';

/** Typed calls only — components never call `fetch` directly (SPEC §3). */
export const fxApi = {
  /** Tops rates up server-side before returning them (D12). */
  rates: () => api.get<FxRatesResponse>('/fx/rates'),

  /** The stored rows behind those figures — the sparkline's raw material. */
  storedRates: () => api.get<{ data: StoredRateDto[] }>('/fx/rates/stored'),

  refresh: () => api.post<unknown>('/fx/refresh'),
};
