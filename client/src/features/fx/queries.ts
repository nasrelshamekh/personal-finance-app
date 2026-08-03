import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Currency, StoredRateDto } from '@ledger/shared';
import { fxApi } from './api';

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
