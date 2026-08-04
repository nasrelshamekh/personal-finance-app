import { formatMoneyParts, type Currency, type MoneyInput } from '@ledger/shared';
import { cn } from '@/lib/cn';

/**
 * The one way a monetary figure reaches the screen (SPEC §10).
 *
 * The figure is large and tabular; its currency code is smaller and muted, never the same
 * weight. Direction is carried by a glyph and a sign as well as colour, so the meaning
 * survives for anyone who cannot distinguish the two — colour alone is never the signal.
 */

type Size = 'sm' | 'md' | 'lg' | 'xl';

const SIZE_CLASS: Record<Size, { figure: string; code: string }> = {
  sm: { figure: 'text-sm', code: 'text-[10px]' },
  md: { figure: 'text-base', code: 'text-[11px]' },
  lg: { figure: 'text-2xl', code: 'text-xs' },
  // Dashboard hero figures are genuinely big (SPEC §10).
  xl: { figure: 'text-[2.5rem] leading-none sm:text-5xl', code: 'text-sm' },
};

export interface MoneyProps {
  value: MoneyInput;
  currency: Currency;
  size?: Size;
  /** `signed` colours and glyphs by direction; `plain` renders it as a neutral figure. */
  tone?: 'signed' | 'plain' | 'muted';
  /** Show a bare magnitude — for columns where the direction is already obvious. */
  magnitude?: boolean;
  /** Hide the currency code, e.g. when a whole column is one currency. */
  hideCurrency?: boolean;
  dp?: number;
  className?: string;
}

const GLYPH = { 1: '↑', '-1': '↓', 0: '—' } as const;

export function Money({
  value,
  currency,
  size = 'md',
  tone = 'signed',
  magnitude = false,
  hideCurrency = false,
  dp,
  className,
}: MoneyProps) {
  const parts = formatMoneyParts(value, currency, {
    ...(dp === undefined ? {} : { dp }),
    ...(magnitude ? { signDisplay: 'never' as const } : {}),
  });

  const toneClass =
    tone === 'plain'
      ? 'text-foreground'
      : tone === 'muted'
        ? 'text-muted-foreground'
        : parts.direction === 1
          ? 'text-money-positive'
          : parts.direction === -1
            ? 'text-money-negative'
            : 'text-money-neutral';

  return (
    <span className={cn('inline-flex items-baseline gap-1', className)}>
      {tone === 'signed' && (
        <span aria-hidden className={cn('font-numeric text-[0.75em]', toneClass)}>
          {GLYPH[parts.direction]}
        </span>
      )}
      <span
        className={cn(
          'font-numeric font-semibold tabular-nums',
          SIZE_CLASS[size].figure,
          toneClass,
        )}
      >
        {parts.amount}
      </span>
      {!hideCurrency && (
        <span className={cn('font-medium text-muted-foreground', SIZE_CLASS[size].code)}>
          {parts.currency}
        </span>
      )}
      {/* Spoken direction, so the glyph is not the only non-visual cue. */}
      {tone === 'signed' && (
        <span className="sr-only">
          {parts.direction === 1 ? 'in' : parts.direction === -1 ? 'out' : 'no change'}
        </span>
      )}
    </span>
  );
}
