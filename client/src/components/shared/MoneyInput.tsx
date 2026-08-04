import { forwardRef, useId, useState, type KeyboardEvent } from 'react';
import { evaluateExpression, isExpression, type Currency } from '@ledger/shared';
import { cn } from '@/lib/cn';
import { Input } from '@/components/ui/input';

/**
 * An amount field that accepts arithmetic (SPEC §8A).
 *
 * Type `1200*3+450` and a live preview appears underneath; blur or Enter resolves it to
 * `4050.00`; `Esc` puts the expression back so a typo in a long sum does not mean
 * retyping it. Invalid input gets a quiet inline message under the field, never a toast —
 * the problem is with what you typed, so that is where the message belongs.
 *
 * The raw text is what leaves this component. The server runs the same shared parser, so
 * an expression can be submitted as-is and the two sides can never disagree about what
 * `10/3` means.
 */

export interface MoneyInputProps {
  value: string;
  onChange: (value: string) => void;
  currency?: Currency;
  id?: string;
  /** A server-side error for this field, shown the same way a parse error is. */
  error?: string | undefined;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  'aria-label'?: string;
}

export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { value, onChange, currency, id, error, placeholder = '0.00', autoFocus, className, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = `${inputId}-message`;

  /** The expression as typed, kept so Esc can restore it after it has been resolved. */
  const [rawExpression, setRawExpression] = useState<string | null>(null);

  const trimmed = value.trim();
  const parsed = trimmed === '' ? null : evaluateExpression(trimmed);
  const showsArithmetic = trimmed !== '' && isExpression(trimmed);

  const parseError =
    parsed !== null && !parsed.ok && parsed.error.code !== 'EmptyExpression'
      ? parsed.error.message
      : undefined;
  const message = error ?? parseError;

  function resolve() {
    if (!showsArithmetic || parsed === null || !parsed.ok) return;
    setRawExpression(trimmed);
    // Two decimals: what a resolved amount reads as everywhere else (SPEC §4.5).
    onChange(parsed.value.toFixed(2));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      // Resolve in place rather than submitting, so Enter means "work that out" first.
      if (showsArithmetic && parsed?.ok === true) {
        event.preventDefault();
        resolve();
      }
      return;
    }

    if (event.key === 'Escape' && rawExpression !== null) {
      event.preventDefault();
      event.stopPropagation();
      onChange(rawExpression);
      setRawExpression(null);
    }
  }

  return (
    <div className={cn('space-y-1', className)}>
      <Input
        {...rest}
        ref={ref}
        id={inputId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={resolve}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        // Not type="number": that would reject `1200*3` outright and, on mobile, strip
        // the operators. `decimal` brings up the numeric keypad without the restriction.
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={message !== undefined}
        aria-describedby={message !== undefined || showsArithmetic ? messageId : undefined}
        className="font-numeric tabular-nums"
      />

      <div id={messageId} className="min-h-4 text-xs" aria-live="polite">
        {message !== undefined ? (
          <span className="text-money-negative">{message}</span>
        ) : showsArithmetic && parsed?.ok === true ? (
          <span className="font-numeric tabular-nums text-muted-foreground">
            = {parsed.value.toFixed(2)}
            {currency !== undefined && <span className="ml-1">{currency}</span>}
            {rawExpression === null && <span className="ml-2 opacity-70">Enter to resolve</span>}
          </span>
        ) : rawExpression !== null ? (
          <span className="text-muted-foreground opacity-70">Esc to restore {rawExpression}</span>
        ) : null}
      </div>
    </div>
  );
});
