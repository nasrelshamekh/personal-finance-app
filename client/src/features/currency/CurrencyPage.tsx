import { RefreshCw } from 'lucide-react';
import { formatAmount } from '@ledger/shared';
import { cn } from '@/lib/cn';
import { PageHeader } from '@/components/shared/PageHeader';
import { RateAge } from '@/components/shared/RateAge';
import { Skeleton } from '@/components/ui/skeleton';
import { useRates, useRefreshRates } from '@/features/fx/queries';
import { RateAttribution } from '@/features/fx/RateAttribution';

const DERIVATION_LABEL: Record<string, string> = {
  DIRECT: 'Recorded',
  INVERTED: 'Inverted',
  TRIANGULATED: 'Via EGP',
  EMERGENCY_DEFAULT: 'Fallback',
  IDENTITY: 'Exact',
};

/**
 * The rate table: what each pair is worth, how old it is, and where it came from.
 *
 * The converter and manual-rate editor land in Phase 7. What is here is real, because
 * the app is already converting with these rates and you should be able to see them.
 */
export function CurrencyPage() {
  const { data, isPending } = useRates();
  const refresh = useRefreshRates();

  return (
    <>
      <PageHeader
        title="Currency"
        description="The rates every figure in this app is converted with."
        actions={
          data?.apiEnabled === true ? (
            <button
              type="button"
              onClick={() => refresh.mutate()}
              disabled={refresh.isPending}
              className={cn(
                'inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm',
                'transition-colors hover:bg-accent focus-visible:outline-none',
                'focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
              )}
            >
              <RefreshCw className={cn('size-3.5', refresh.isPending && 'animate-spin')} />
              {refresh.isPending ? 'Refreshing…' : 'Refresh now'}
            </button>
          ) : undefined
        }
      />

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <caption className="sr-only">Exchange rates against the Egyptian pound</caption>
          <thead>
            <tr className="border-b border-border bg-card/50 text-left">
              <th
                scope="col"
                className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
              >
                Pair
              </th>
              <th
                scope="col"
                className="px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
              >
                Rate
              </th>
              <th
                scope="col"
                className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
              >
                Source
              </th>
              <th
                scope="col"
                className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
              >
                Age
              </th>
            </tr>
          </thead>
          <tbody>
            {isPending &&
              [0, 1, 2].map((i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <Skeleton className="h-4 w-20" />
                  </td>
                  <td className="px-4 py-3">
                    <Skeleton className="ml-auto h-4 w-24" />
                  </td>
                  <td className="px-4 py-3">
                    <Skeleton className="h-4 w-16" />
                  </td>
                  <td className="px-4 py-3">
                    <Skeleton className="h-4 w-20" />
                  </td>
                </tr>
              ))}

            {data?.rates.map((rate) => (
              <tr
                key={`${rate.base}-${rate.quote}`}
                className="border-b border-border last:border-0"
              >
                <td className="px-4 py-3">
                  <span className="font-numeric text-sm text-foreground">
                    {rate.base} <span className="text-muted-foreground">→</span> {rate.quote}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="font-numeric tabular-nums text-foreground">
                    {formatAmount(rate.rate, { dp: 4 })}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs text-muted-foreground">
                    {rate.source === 'MANUAL' ? 'Entered by hand' : 'Automatic'}
                    {rate.derivation !== 'DIRECT' && (
                      <> · {DERIVATION_LABEL[rate.derivation] ?? rate.derivation}</>
                    )}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <RateAge rate={rate} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data?.apiEnabled === false && (
        <p className="mt-4 text-xs text-muted-foreground">
          Automatic rates are switched off, so these are the rates you entered by hand.
        </p>
      )}

      <RateAttribution />
    </>
  );
}
