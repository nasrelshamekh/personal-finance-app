import { useState } from 'react';
import { ArrowRight, ArrowLeftRight } from 'lucide-react';
import { CURRENCIES, formatAmount, type Currency } from '@ledger/shared';
import { cn } from '@/lib/cn';
import { MoneyInput } from '@/components/shared/MoneyInput';
import { CurrencyPicker } from '@/components/shared/CurrencyPicker';
import { RateAge } from '@/components/shared/RateAge';
import { Label } from '@/components/ui/label';
import { useConvert } from '@/features/fx/queries';

const DERIVATION_NOTE: Record<string, string> = {
  INVERTED: 'Worked out by inverting the opposite pair.',
  TRIANGULATED: 'Worked out through Egyptian pounds from two rates.',
  EMERGENCY_DEFAULT: 'A built-in fallback — no rate has ever been recorded for this pair.',
};

/**
 * The converter (SPEC §9). The amount field is the same expression-capable input the
 * transaction form uses, and the conversion goes through the API so it agrees exactly
 * with what a transaction would be frozen at.
 */
export function Converter() {
  const [amount, setAmount] = useState('100');
  const [from, setFrom] = useState<Currency>('USD');
  const [to, setTo] = useState<Currency>('EGP');

  const conversion = useConvert(amount, from, to);

  function swap() {
    setFrom(to);
    setTo(from);
  }

  return (
    <section className="rounded-lg border border-border p-4" aria-labelledby="converter-heading">
      <h3
        id="converter-heading"
        className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
      >
        Convert
      </h3>

      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-start">
        <div className="space-y-1.5">
          <Label htmlFor="convert-amount">Amount</Label>
          <MoneyInput
            id="convert-amount"
            value={amount}
            onChange={setAmount}
            currency={from}
            placeholder="0.00"
          />
          <CurrencyPicker
            value={from}
            onChange={setFrom}
            only={CURRENCIES}
            aria-label="Convert from"
          />
        </div>

        <button
          type="button"
          onClick={swap}
          className={cn(
            'mt-7 self-start justify-self-center rounded-md border border-border p-2',
            'text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
          aria-label="Swap the two currencies"
        >
          <ArrowLeftRight className="size-4" />
        </button>

        <div className="space-y-1.5">
          <Label htmlFor="convert-result">Result</Label>
          <div
            id="convert-result"
            className="flex h-9 items-center rounded-md border border-input bg-muted/40 px-3"
            aria-live="polite"
          >
            {conversion.isPending && amount.trim() !== '' ? (
              <span className="text-sm text-muted-foreground">Converting…</span>
            ) : conversion.data !== undefined ? (
              <span className="font-numeric text-sm tabular-nums text-foreground">
                {formatAmount(conversion.data.result)}
              </span>
            ) : conversion.isError ? (
              <span className="text-sm text-money-negative">Check the amount.</span>
            ) : (
              <span className="text-sm text-muted-foreground">—</span>
            )}
          </div>
          <CurrencyPicker value={to} onChange={setTo} only={CURRENCIES} aria-label="Convert to" />
        </div>
      </div>

      {conversion.data !== undefined && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
          <span className="font-numeric tabular-nums">
            1 {from} <ArrowRight className="inline size-3" aria-hidden />{' '}
            {formatAmount(conversion.data.rate.rate, { dp: 4 })} {to}
          </span>
          <RateAge rate={conversion.data.rate} />
          {DERIVATION_NOTE[conversion.data.rate.derivation] !== undefined && (
            <span>{DERIVATION_NOTE[conversion.data.rate.derivation]}</span>
          )}
        </div>
      )}
    </section>
  );
}
