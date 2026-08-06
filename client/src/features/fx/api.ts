import type {
  Currency,
  FxConvertResponse,
  FxRatesResponse,
  FxRefreshResponse,
  StoredRateDto,
} from '@ledger/shared';
import { api } from '@/lib/api';

/** Typed calls only — components never call `fetch` directly (SPEC §3). */
export const fxApi = {
  /** Tops rates up server-side before returning them (D12). */
  rates: () => api.get<FxRatesResponse>('/fx/rates'),

  /** The stored rows behind those figures — the sparkline's raw material. */
  storedRates: () => api.get<{ data: StoredRateDto[] }>('/fx/rates/stored'),

  refresh: () => api.post<FxRefreshResponse>('/fx/refresh'),

  /**
   * `amount` may be arithmetic — the server runs the same shared parser, so the
   * calculator and the converter agree with the transaction form about what `10/3` is.
   */
  convert: (amount: string, from: Currency, to: Currency) =>
    api.get<FxConvertResponse>('/fx/convert', { amount, from, to }),

  /** A typed rate — the escape hatch for a parallel-market or bank rate. */
  setManualRate: (base: Currency, quote: Currency, rate: string) =>
    api.put<StoredRateDto>('/fx/manual', { base, quote, rate }),
};
