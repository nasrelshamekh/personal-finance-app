import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Currency, StoredRateDto } from '@ledger/shared';
import { fxApi } from './api';

export type { Currency };

/** Query-key factory, so invalidation never depends on a string literal matching. */
export const fxKeys = {
  all: ['fx'] as const,
  rates: () => [...fxKeys.all, 'rates'] as const,
  stored: () => [...fxKeys.all, 'stored'] as const,
};

export function useRates() {
  return useQuery({
    queryKey: fxKeys.rates(),
    queryFn: fxApi.rates,
  });
}

/**
 * Stored rates grouped into a series per foreign currency, oldest first — the shape a
 * sparkline wants. A pair with fewer than two points has no trend to draw, and the
 * sparkline renders nothing rather than inventing a flat line.
 */
export function useRateHistory() {
  return useQuery({
    queryKey: fxKeys.stored(),
    queryFn: fxApi.storedRates,
    select: ({ data }): Map<Currency, number[]> => {
      const byPair = new Map<Currency, StoredRateDto[]>();

      for (const row of data) {
        if (row.quote !== 'EGP') continue;
        const series = byPair.get(row.base) ?? [];
        series.push(row);
        byPair.set(row.base, series);
      }

      const result = new Map<Currency, number[]>();
      for (const [currency, rows] of byPair) {
        const points = rows
          .slice()
          .sort((a, b) => a.asOf.localeCompare(b.asOf))
          .map((row) => Number.parseFloat(row.rate));
        result.set(currency, points);
      }
      return result;
    },
  });
}

export function useRefreshRates() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: fxApi.refresh,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: fxKeys.all });
    },
  });
}

/**
 * Converts through the API rather than multiplying client-side.
 *
 * The server owns rate resolution — inversion, triangulation, staleness, the lot — so
 * asking it means the calculator can never quietly disagree with the figure a transaction
 * was frozen at. Disabled while the amount is empty so an empty box makes no request.
 */
export function useConvert(amount: string, from: Currency, to: Currency) {
  const trimmed = amount.trim();

  return useQuery({
    queryKey: [...fxKeys.all, 'convert', trimmed, from, to] as const,
    queryFn: () => fxApi.convert(trimmed, from, to),
    enabled: trimmed !== '',
    // A conversion is a question about right now; don't serve a minute-old answer.
    staleTime: 0,
    retry: false,
    /*
     * The amount is part of the key, so every keystroke starts a new query — and without
     * this `data` went undefined in between, unmounting the rate line under the converter
     * and making the whole panel jump as you typed a second zero onto 100.
     *
     * The figure it holds on to is the *previous* amount's, so the caller is told
     * (`isPlaceholderData`) and shows it as provisional rather than passing a stale
     * conversion off as the answer to what is now in the box.
     */
    placeholderData: keepPreviousData,
  });
}

export function useSetManualRate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ base, quote, rate }: { base: Currency; quote: Currency; rate: string }) =>
      fxApi.setManualRate(base, quote, rate),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: fxKeys.all });
    },
  });
}
