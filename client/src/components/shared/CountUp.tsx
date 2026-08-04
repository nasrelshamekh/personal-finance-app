import { useEffect, useRef, useState } from 'react';
import { formatAmount, type Currency } from '@ledger/shared';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { Money } from './Money';

/**
 * Counts a figure up on first load only (SPEC §10) — never on a refetch, because a number
 * that re-animates every time the cache updates is noise, not delight.
 *
 * Honours `prefers-reduced-motion` by rendering the final figure immediately.
 */
export function CountUp({
  value,
  currency,
  durationMs = 550,
  ...moneyProps
}: {
  value: string;
  currency: Currency;
  durationMs?: number;
} & Omit<Parameters<typeof Money>[0], 'value' | 'currency'>) {
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const target = Number.parseFloat(value);
  const hasAnimated = useRef(false);
  const [display, setDisplay] = useState(() => (reduceMotion ? target : 0));

  useEffect(() => {
    if (hasAnimated.current || reduceMotion || !Number.isFinite(target)) {
      setDisplay(target);
      return;
    }
    hasAnimated.current = true;

    const start = performance.now();
    let frame = 0;

    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      // Ease-out: fast to begin with, settling on the real figure.
      setDisplay(target * (1 - (1 - progress) ** 3));
      if (progress < 1) frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs, reduceMotion]);

  // Once settled, hand the real string to Money so the displayed figure is exact rather
  // than a float that happens to be close.
  const settled = !Number.isFinite(target) || display === target;

  return (
    <Money
      {...moneyProps}
      currency={currency}
      value={settled ? value : formatAmount(display, { dp: 2, grouping: false })}
    />
  );
}
