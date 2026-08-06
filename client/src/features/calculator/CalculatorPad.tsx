import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowRight, Delete, Eraser, RotateCcw } from 'lucide-react';
import { CURRENCIES, evaluateExpression, type Currency } from '@ledger/shared';
import { cn } from '@/lib/cn';
import { useCalculator } from '@/hooks/useCalculator';
import { Input } from '@/components/ui/input';
import { CurrencyPicker } from '@/components/shared/CurrencyPicker';
import { RateAge } from '@/components/shared/RateAge';
import { useConvert } from '@/features/fx/queries';

/**
 * The calculator (SPEC §8B).
 *
 * There is no calculator engine here: the expression goes through the same shunting-yard
 * parser the money inputs use, so `10/3` means exactly the same thing in all three
 * places. The keypad is a convenience for touch — everything it does can be typed.
 */

const KEYS = [
  ['7', '8', '9', '/'],
  ['4', '5', '6', '*'],
  ['1', '2', '3', '-'],
  ['0', '.', '%', '+'],
] as const;

export function CalculatorPad() {
  const { tape, push, clearTape, sendToTransaction } = useCalculator();
  const inputRef = useRef<HTMLInputElement>(null);

  const [expression, setExpression] = useState('');
  const [showCurrency, setShowCurrency] = useState(false);
  const [from, setFrom] = useState<Currency>('USD');
  const [to, setTo] = useState<Currency>('EGP');

  const parsed = expression.trim() === '' ? null : evaluateExpression(expression);
  const result = parsed?.ok === true ? parsed.value.toFixed(2) : null;
  const parseError =
    parsed !== null && !parsed.ok && parsed.error.code !== 'EmptyExpression'
      ? parsed.error.message
      : null;

  // Only ask the server once the expression is actually valid.
  const convertible = showCurrency && result !== null ? result : '';
  const conversion = useConvert(convertible, from, to);

  useEffect(() => {
    // Focus on open so it is usable from the keyboard the instant it appears.
    inputRef.current?.focus();
  }, []);

  function evaluate() {
    if (parsed?.ok !== true) return;

    const value = parsed.value.toFixed(2);
    push(expression.trim(), value);
    // The result stays in the box so `+50` carries on from it.
    setExpression(value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      evaluate();
      return;
    }
    // Let Escape bubble to the sheet or popover, which closes it.
  }

  function append(token: string) {
    setExpression((previous) => previous + token);
    inputRef.current?.focus();
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Input
          ref={inputRef}
          value={expression}
          onChange={(event) => setExpression(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="0"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          aria-label="Calculation"
          aria-invalid={parseError !== null}
          aria-describedby="calc-result"
          className="h-12 font-numeric text-right text-lg tabular-nums"
        />

        <div
          id="calc-result"
          className="mt-1 flex min-h-5 items-center justify-end gap-2 text-sm"
          aria-live="polite"
        >
          {parseError !== null ? (
            <span className="text-money-negative">{parseError}</span>
          ) : result !== null ? (
            <span className="font-numeric tabular-nums text-muted-foreground">= {result}</span>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        {KEYS.flat().map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => append(key)}
            tabIndex={-1}
            className={cn(
              'h-10 rounded-md border border-border font-numeric text-sm transition-colors',
              'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              /[0-9.]/.test(key) ? 'text-foreground' : 'text-muted-foreground',
            )}
            aria-label={`Enter ${key}`}
          >
            {key}
          </button>
        ))}

        <button
          type="button"
          onClick={() => append('(')}
          tabIndex={-1}
          className="h-10 rounded-md border border-border font-numeric text-sm text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Open bracket"
        >
          (
        </button>
        <button
          type="button"
          onClick={() => append(')')}
          tabIndex={-1}
          className="h-10 rounded-md border border-border font-numeric text-sm text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Close bracket"
        >
          )
        </button>
        <button
          type="button"
          onClick={() => {
            setExpression((previous) => previous.slice(0, -1));
            inputRef.current?.focus();
          }}
          tabIndex={-1}
          className="h-10 rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Delete the last character"
        >
          <Delete className="mx-auto size-4" />
        </button>
        <button
          type="button"
          onClick={evaluate}
          disabled={parsed?.ok !== true}
          className="h-10 rounded-md bg-primary text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          =
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowCurrency((previous) => !previous)}
          aria-expanded={showCurrency}
          className="rounded-md border border-border px-2.5 py-1.5 text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {showCurrency ? 'Hide currency' : 'Convert'}
        </button>

        <button
          type="button"
          onClick={() => result !== null && sendToTransaction(result)}
          disabled={result === null}
          className={cn(
            'ml-auto inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5',
            'text-xs transition-colors hover:bg-accent disabled:opacity-40',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          Use this value
          <ArrowRight className="size-3" aria-hidden />
        </button>
      </div>

      {showCurrency && (
        <div className="space-y-2 rounded-md border border-border p-2.5">
          <div className="flex items-center gap-2">
            <CurrencyPicker
              value={from}
              onChange={setFrom}
              only={CURRENCIES}
              className="h-8 flex-1 text-xs"
              aria-label="Convert from"
            />
            <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <CurrencyPicker
              value={to}
              onChange={setTo}
              only={CURRENCIES}
              className="h-8 flex-1 text-xs"
              aria-label="Convert to"
            />
          </div>

          <div className="flex items-baseline justify-between gap-2" aria-live="polite">
            {result === null ? (
              <span className="text-xs text-muted-foreground">Work something out first.</span>
            ) : conversion.isPending ? (
              <span className="text-xs text-muted-foreground">Converting…</span>
            ) : conversion.data !== undefined ? (
              <>
                <span className="font-numeric text-base tabular-nums text-foreground">
                  {Number.parseFloat(conversion.data.result).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                  <span className="ml-1 text-[10px] text-muted-foreground">{to}</span>
                </span>
                <RateAge rate={conversion.data.rate} compact />
              </>
            ) : (
              <span className="text-xs text-money-negative">That pair could not be converted.</span>
            )}
          </div>
        </div>
      )}

      <div className="border-t border-border pt-2">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Tape
          </span>
          {tape.length > 0 && (
            <button
              type="button"
              onClick={clearTape}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Eraser className="size-3" aria-hidden />
              Clear
            </button>
          )}
        </div>

        {tape.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted-foreground">
            Sums you work out appear here. Press Enter to record one.
          </p>
        ) : (
          <ul className="max-h-40 space-y-0.5 overflow-y-auto">
            {tape.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => {
                    // Reuse: put the sum back in the box so it can be adjusted.
                    setExpression(entry.expression);
                    inputRef.current?.focus();
                  }}
                  className="flex w-full items-baseline justify-between gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="truncate font-numeric text-[11px] tabular-nums text-muted-foreground">
                    {entry.expression}
                  </span>
                  <span className="shrink-0 font-numeric text-xs tabular-nums text-foreground">
                    {entry.result}
                  </span>
                  <RotateCcw className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="sr-only">Reuse this calculation</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
