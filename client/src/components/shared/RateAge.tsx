import { formatDistanceToNowStrict } from 'date-fns';
import type { ResolvedRateDto, StaleReason } from '@ledger/shared';
import { cn } from '@/lib/cn';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * The amber dot (SPEC §4.6). Staleness is never hidden, and never signalled by colour
 * alone — the dot is paired with text giving the rate's age, and the tooltip says *why*
 * it is stale rather than just that it is.
 */

const REASON_TEXT: Record<StaleReason, string> = {
  PAST_NEXT_UPDATE: 'The provider said it would have updated by now.',
  OLDER_THAN_30H: 'No newer rate has been recorded in over 30 hours.',
  NO_RATE_AT_OR_BEFORE_DATE: 'No rate was recorded on or before this date.',
  NO_RATE_AT_ALL: 'No rate has ever been recorded for this pair.',
};

function rateAgeLabel(rate: Pick<ResolvedRateDto, 'ageMs' | 'asOf'>): string {
  // ageMs goes negative when a backdated lookup fell back to a newer rate (D12). "In 6
  // months" would be nonsense, so name the date the rate is actually from instead.
  if (rate.ageMs < 0) {
    return `from ${new Date(rate.asOf).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
    })}`;
  }
  return `${formatDistanceToNowStrict(new Date(rate.asOf))} ago`;
}

interface RateAgeProps {
  rate: ResolvedRateDto;
  className?: string;
  /** Hides the text and keeps only the dot, for tight rows. */
  compact?: boolean;
  /**
   * Hangs the dot in the padding to the left instead of letting it take a slot in the row.
   *
   * The dot is always rendered — transparent when the rate is fresh — so that a stale row
   * and a fresh one line up with each other. In a table that pushed the age text 16px
   * right of its own "Age" column heading. In the gutter it keeps the rows agreeing with
   * each other *and* the column agreeing with its header.
   */
  dotInGutter?: boolean;
}

export function RateAge({ rate, className, compact = false, dotInGutter = false }: RateAgeProps) {
  const label = rateAgeLabel(rate);
  const reason = rate.staleReason === null ? null : REASON_TEXT[rate.staleReason];

  const dot = (
    <span
      className={cn(
        'inline-block size-1.5 shrink-0 rounded-full',
        rate.stale ? 'bg-money-stale' : 'bg-transparent',
        dotInGutter && 'absolute -left-3 top-1/2 -translate-y-1/2',
      )}
    />
  );

  const content = (
    <span
      className={cn(
        'inline-flex items-center text-[11px] tabular-nums',
        // In the gutter the dot is out of flow, so there is nothing to space away from.
        dotInGutter ? 'relative' : 'gap-1.5',
        rate.stale ? 'text-money-stale' : 'text-muted-foreground',
        className,
      )}
    >
      {dot}
      {!compact && <span>{label}</span>}
    </span>
  );

  if (!rate.stale && rate.derivation === 'DIRECT') {
    return content;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {content}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-64">
        <p className="font-medium">
          {rate.stale ? 'This rate may be out of date' : 'Derived rate'}
        </p>
        {reason !== null && <p className="mt-1 text-xs opacity-90">{reason}</p>}
        {rate.derivation !== 'DIRECT' && (
          <p className="mt-1 text-xs opacity-90">
            {rate.derivation === 'INVERTED' && 'Calculated by inverting the opposite pair.'}
            {rate.derivation === 'TRIANGULATED' && 'Calculated through EGP from two rates.'}
            {rate.derivation === 'EMERGENCY_DEFAULT' && 'A built-in fallback, not a recorded rate.'}
            {rate.derivation === 'IDENTITY' && 'Same currency, so exactly 1.'}
          </p>
        )}
        <p className="mt-1 text-xs opacity-75">Recorded {new Date(rate.asOf).toLocaleString()}</p>
      </TooltipContent>
    </Tooltip>
  );
}
