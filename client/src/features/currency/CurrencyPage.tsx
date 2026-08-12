import { RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import { formatAmount, type RateChangeDto } from '@ledger/shared';
import { cn } from '@/lib/cn';
import { PageHeader } from '@/components/shared/PageHeader';
import { RateAge } from '@/components/shared/RateAge';
import { Skeleton } from '@/components/ui/skeleton';
import { useRates, useRefreshRates } from '@/features/fx/queries';
import { RateAttribution } from '@/features/fx/RateAttribution';
import { Converter } from './Converter';
import { ManualRateEditor } from './ManualRateEditor';

const DERIVATION_LABEL: Record<string, string> = {
  DIRECT: 'Recorded',
  INVERTED: 'Inverted',
  TRIANGULATED: 'Via EGP',
  EMERGENCY_DEFAULT: 'Fallback',
  IDENTITY: 'Exact',
};

/** What the refresh actually moved (SPEC §9) — not just that it happened. */
function ChangeRow({ change }: { change: RateChangeDto }) {
  const delta = change.deltaPct === null ? null : Number.parseFloat(change.deltaPct);
  const rose = delta !== null && delta > 0;

  return (
    <li className="flex items-baseline gap-2 text-xs">
      <span className="font-numeric text-muted-foreground">{change.base}</span>
      {change.previousRate !== null && (
        <span className="font-numeric tabular-nums text-muted-foreground line-through">
          {formatAmount(change.previousRate, { dp: 4 })}
        </span>
      )}
      <span className="font-numeric tabular-nums text-foreground">
        {formatAmount(change.newRate, { dp: 4 })}
      </span>
      {delta !== null && delta !== 0 && (
        <span
          className={cn(
            'inline-flex items-center gap-0.5 font-numeric tabular-nums',
            rose ? 'text-money-negative' : 'text-money-positive',
          )}
        >
          {rose ? (
            <TrendingUp className="size-3" aria-hidden />
          ) : (
            <TrendingDown className="size-3" aria-hidden />
          )}
          {rose ? '+' : ''}
          {formatAmount(change.deltaPct ?? '0', { dp: 2 })}%
          {/* A pound buying fewer dollars is bad news here, hence the colouring. */}
          <span className="sr-only">
            {rose ? 'the pound weakened against' : 'the pound strengthened against'} {change.base}
          </span>
        </span>
      )}
      {change.previousRate === null && (
        <span className="text-muted-foreground">first recorded rate</span>
      )}
    </li>
  );
}

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

      {refresh.data !== undefined && (
        <div className="mb-4 rounded-lg border border-border bg-card/40 p-3" role="status">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            What changed
          </p>
          {refresh.data.changes.length === 0 ? (
            <p className="mt-1.5 text-xs text-muted-foreground">Nothing moved.</p>
          ) : (
            <ul className="mt-1.5 space-y-1">
              {refresh.data.changes.map((change) => (
                <ChangeRow key={`${change.base}-${change.quote}`} change={change} />
              ))}
            </ul>
          )}
          {refresh.data.failures.length > 0 && (
            <p className="mt-2 text-xs text-money-stale">
              Could not reach the provider for{' '}
              {refresh.data.failures.map((failure) => failure.quote).join(', ')}. Those rates are
              unchanged.
            </p>
          )}
        </div>
      )}

      {refresh.isError && (
        <p className="mb-4 rounded-md border border-money-negative/40 bg-money-negative/5 px-3 py-2 text-sm text-money-negative">
          The rates provider could not be reached. Your stored rates are unchanged — set one by hand
          below if you need it now.
        </p>
      )}

      <div className="space-y-4">
        <Converter />

        <section className="overflow-hidden rounded-lg border border-border">
          {/*
            Four equal columns, every heading and every value centred in its own.
            `table-fixed` is what makes the quarters actual quarters — left to itself a
            table sizes columns by content, so "Automatic" and "9 hours ago" were pulling
            the grid out of shape.
          */}
          <table className="w-full table-fixed text-sm">
            <caption className="sr-only">Exchange rates against the Egyptian pound</caption>
            <thead>
              <tr className="border-b border-border bg-card/50">
                {/*
                  The leading column is the row's label, so it is left-aligned and the eye
                  gets a stable edge to scan down; the rest are centred in their quarter.
                  Centring "USD → EGP" as well would let the arrow wander between rows.
                */}
                {(
                  [
                    ['Pair', 'text-left'],
                    ['Rate', 'text-center'],
                    ['Source', 'text-center'],
                    ['Age', 'text-center'],
                  ] as const
                ).map(([heading, align]) => (
                  <th
                    key={heading}
                    scope="col"
                    className={cn(
                      'w-1/4 px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground',
                      align,
                    )}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isPending &&
                [0, 1, 2].map((index) => (
                  <tr key={index} className="border-b border-border last:border-0">
                    {[0, 1, 2, 3].map((cell) => (
                      <td key={cell} className="px-4 py-3">
                        <Skeleton className="mx-auto h-4 w-20" />
                      </td>
                    ))}
                  </tr>
                ))}

              {data?.rates.map((rate) => (
                <tr
                  key={`${rate.base}-${rate.quote}`}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-4 py-3 text-left">
                    <span className="font-numeric text-sm text-foreground">
                      {rate.base} <span className="text-muted-foreground">→</span> {rate.quote}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {/*
                      Genuinely centred, not a right-aligned block pretending to be. Every
                      rate renders as `NN.NNNN`, so `tabular-nums` keeps the decimals under
                      one another anyway; a rate that reached three integer digits would sit
                      half a character off, which is a fair price for a column that reads
                      straight. The transactions table is the other way round, because
                      amounts there genuinely do vary in length.
                    */}
                    <span className="font-numeric tabular-nums text-foreground">
                      {formatAmount(rate.rate, { dp: 4 })}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-xs text-muted-foreground">
                      {rate.source === 'MANUAL' ? 'Entered by hand' : 'Automatic'}
                      {rate.derivation !== 'DIRECT' && (
                        <> · {DERIVATION_LABEL[rate.derivation] ?? rate.derivation}</>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <RateAge rate={rate} dotInGutter />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <ManualRateEditor />
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
