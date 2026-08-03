import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api';

/**
 * TanStack Query is the only server-state store (SPEC §2) — there is no Redux, no Zustand
 * and no bespoke cache.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Rates refresh themselves server-side (D12); the client does not need to
            // poll. A minute is long enough to avoid refetch storms while navigating.
            staleTime: 60_000,
            retry: (failureCount, error) => {
              // Retrying a 4xx just repeats the same rejection more slowly.
              if (error instanceof ApiError && error.status < 500) return false;
              return failureCount < 2;
            },
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
