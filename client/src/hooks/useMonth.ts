import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * The month a screen is reading, held in the URL rather than in `useState`.
 *
 * Same rule as the transaction filters (see `TransactionsPage`): anything that changes
 * what a screen shows has to be linkable, or the screen quietly ignores the address it
 * was opened at. The month was the last thing still hiding in component state, and it
 * cost more than it looks — `/?month=2026-07` did nothing, a reload dropped you back to
 * today, and following a category link out to the transactions list and pressing Back
 * returned you to the current month rather than the one you had been reading.
 *
 * Written with `replace: true`, so stepping through months does not fill the history with
 * entries to walk back out of; Back leaves the screen, and returns to the month you left.
 *
 * The current month is left out of the URL entirely rather than written into it. It is the
 * default, and it is a *moving* default — pinning today's month into the address would
 * make a bookmarked dashboard silently stale next month.
 */

export function currentMonth(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [year, index] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year ?? 2026, (index ?? 1) - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The half-open day range a month covers, for links out to a filtered list. */
export function monthDayRange(month: string): { from: string; to: string } {
  const [year, index] = month.split('-').map(Number);
  const start = new Date(Date.UTC(year ?? 2026, (index ?? 1) - 1, 1));
  const end = new Date(Date.UTC(year ?? 2026, index ?? 1, 0));

  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

export function useMonth(): [string, (next: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  // A hand-typed or stale `?month=` is ignored rather than passed to the API, which would
  // answer with a 400 and turn a bad link into a broken screen.
  const raw = searchParams.get('month');
  const month = raw !== null && MONTH_PATTERN.test(raw) ? raw : currentMonth();

  const setMonth = useCallback(
    (next: string) => {
      setSearchParams(
        (previous) => {
          const params = new URLSearchParams(previous);
          if (next === currentMonth()) params.delete('month');
          else params.set('month', next);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return [month, setMonth];
}
