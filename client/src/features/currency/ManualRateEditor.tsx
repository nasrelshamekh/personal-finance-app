import { useState } from 'react';
import { Check } from 'lucide-react';
import { FOREIGN_CURRENCIES, formatAmount, type Currency } from '@ledger/shared';
import { cn } from '@/lib/cn';
import { ApiError } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useRates, useSetManualRate } from '@/features/fx/queries';

/**
 * Typing a rate by hand (SPEC §9).
 *
 * The escape hatch, not the daily path — rates arrive on their own (D12). It exists
 * because Egypt's parallel-market rate drifts from the published one, and because the
 * rate a bank actually gave you includes its spread. A typed rate is treated as intent:
 * it wins ties against an automatic rate recorded at the same moment.
 */
export function ManualRateEditor() {
  const { data } = useRates();
  const setRate = useSetManualRate();

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Currency | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(base: Currency) {
    const value = (drafts[base] ?? '').trim();
    if (value === '') return;

    setError(null);
    try {
      await setRate.mutateAsync({ base, quote: 'EGP', rate: value });
      setDrafts((previous) => ({ ...previous, [base]: '' }));
      setSaved(base);
      window.setTimeout(() => setSaved(null), 2500);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That rate could not be saved.');
    }
  }

  return (
    <section className="glass rounded-lg p-4" aria-labelledby="manual-rate-heading">
      <h3
        id="manual-rate-heading"
        className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
      >
        Set a rate by hand
      </h3>
      <p className="mt-1 max-w-prose text-xs text-muted-foreground">
        Rates arrive automatically. Type one here when the rate you actually got differs — a
        parallel-market rate, or a bank&apos;s rate including its spread. A typed rate takes effect
        immediately.
      </p>

      <div className="mt-3 space-y-2">
        {FOREIGN_CURRENCIES.map((base) => {
          const current = data?.rates.find((rate) => rate.base === base);

          return (
            <div key={base} className="flex flex-wrap items-end gap-2">
              <div className="w-28 space-y-1.5">
                <Label htmlFor={`manual-${base}`}>
                  <span className="font-numeric">1 {base} → EGP</span>
                </Label>
                <Input
                  id={`manual-${base}`}
                  value={drafts[base] ?? ''}
                  onChange={(event) =>
                    setDrafts((previous) => ({ ...previous, [base]: event.target.value }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void save(base);
                    }
                  }}
                  placeholder={
                    current === undefined ? '0.0000' : formatAmount(current.rate, { dp: 4 })
                  }
                  inputMode="decimal"
                  className="h-9 text-left font-numeric tabular-nums"
                />
              </div>

              <button
                type="button"
                onClick={() => void save(base)}
                disabled={(drafts[base] ?? '').trim() === '' || setRate.isPending}
                className={cn(
                  'h-9 rounded-md border border-border px-3 text-sm transition-colors',
                  'hover:bg-accent disabled:opacity-40',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                Set
              </button>

              <p className="pb-2 text-xs text-muted-foreground">
                {saved === base ? (
                  <span className="inline-flex items-center gap-1 text-money-positive">
                    <Check className="size-3" aria-hidden />
                    Saved
                  </span>
                ) : current === undefined ? null : (
                  <>
                    now{' '}
                    <span className="font-numeric tabular-nums">
                      {formatAmount(current.rate, { dp: 4 })}
                    </span>{' '}
                    · {current.source === 'MANUAL' ? 'entered by hand' : 'automatic'}
                  </>
                )}
              </p>
            </div>
          );
        })}
      </div>

      {error !== null && (
        <p className="mt-3 rounded-md border border-money-negative/40 bg-money-negative/5 px-3 py-2 text-sm text-money-negative">
          {error}
        </p>
      )}
    </section>
  );
}
