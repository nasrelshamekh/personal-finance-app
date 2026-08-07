import { RefreshCw } from 'lucide-react';
import { formatAmount, type Currency, type ResolvedRateDto } from '@ledger/shared';
import { cn } from '@/lib/cn';
import { reportFailure } from '@/lib/action-feedback';
import { Skeleton } from '@/components/ui/skeleton';
import { Sparkline } from '@/components/shared/Sparkline';
import { RateAge } from '@/components/shared/RateAge';
import { useRateHistory, useRates, useRefreshRates } from './queries';

/**
 * The FX strip (SPEC §10) — a thin, always-visible band showing the three foreign
 * currencies against EGP with their age and a micro-sparkline.
 *
 * It sits under the topbar on desktop and becomes a horizontally scrollable row on
 * mobile. It is the one element that makes this app look like it belongs to someone who
 * gets paid in dollars and pays rent in pounds, so it gets real craft: tabular figures,
 * a sparkline that declines to draw when there is no trend, and staleness stated rather
 * than implied.
 */

function RatePill({ rate, history }: { rate: ResolvedRateDto; history: number[] }) {
  return (
    <div
      className={cn(
        'flex min-w-max items-center gap-3 rounded-md px-2.5 py-1.5',
        'transition-colors hover:bg-accent/60',
      )}
    >
      <span className="font-numeric text-[11px] font-medium tracking-wide text-muted-foreground">
        {rate.base}
      </span>

      <span className="flex items-baseline gap-1">
        <span className="font-numeric text-sm font-semibold tabular-nums text-foreground">
          {formatAmount(rate.rate, { dp: 2 })}
        </span>
        <span className="text-[10px] font-medium text-muted-foreground">EGP</span>
      </span>

      <Sparkline points={history} className="text-primary" />

      <RateAge rate={rate} />
    </div>
  );
}

function StripSkeleton() {
  return (
    <div className="flex items-center gap-6">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-3 w-8" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

export function FxStrip() {
  const { data, isPending, isError } = useRates();
  const { data: history } = useRateHistory();
  const refresh = useRefreshRates();

  return (
    <div
      className="border-b border-border bg-card/50"
      aria-label="Exchange rates against the Egyptian pound"
    >
      <div className="mx-auto flex h-11 w-full max-w-[1400px] items-center gap-2 px-4 sm:px-6">
        {/*
          Scrolls horizontally on mobile rather than wrapping or shrinking: three rates at
          375px do not fit, and a squeezed figure is worse than one you swipe to.
        */}
        <div className="-mx-1 flex flex-1 items-center gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {isPending && <StripSkeleton />}

          {isError && (
            <p className="text-xs text-muted-foreground">
              Rates unavailable. Stored rates are still being used for conversions.
            </p>
          )}

          {data?.rates.map((rate) => (
            <RatePill
              key={`${rate.base}-${rate.quote}`}
              rate={rate}
              history={history?.get(rate.base as Currency) ?? []}
            />
          ))}
        </div>

        {data?.apiEnabled === true && (
          <button
            type="button"
            onClick={() =>
              refresh.mutate(undefined, {
                // Says "rates" rather than "nothing changed": a refresh can update some
                // pairs and fail on others, and the Currency page is where you can see which.
                onError: reportFailure('The rates could not be refreshed.'),
              })
            }
            disabled={refresh.isPending}
            className={cn(
              'shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors',
              'hover:bg-accent hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'disabled:opacity-50',
            )}
            aria-label="Refresh exchange rates"
          >
            <RefreshCw className={cn('size-3.5', refresh.isPending && 'animate-spin')} />
          </button>
        )}
      </div>
    </div>
  );
}
