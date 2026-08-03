import type { Currency } from '@ledger/shared';

/**
 * The last line of defence (D1 rule 3): used only when the database holds no rate at all
 * for a pair — a fresh install that skipped the seed, or a currency added later.
 *
 * A figure resolved from these is always flagged `stale: true` with reason
 * `NO_RATE_AT_ALL`, so it is visibly marked rather than quietly wrong. Same values as the
 * seed, verified 2026-08-03; they are a floor, not a source of truth.
 */
export const EMERGENCY_RATES_TO_EGP: Record<Exclude<Currency, 'EGP'>, string> = {
  USD: '51.1232',
  EUR: '58.86',
  GBP: '68.81',
};

/** Beyond this, an API refresh is treated as failed rather than left hanging. */
export const FX_FETCH_TIMEOUT_MS = 10_000;

/**
 * Automatic refreshes are impatient; the manual button is patient.
 *
 * An automatic refresh happens while you are trying to do something else, so it gives up
 * quickly and falls back to stored rates — being offline must never cost you three
 * seconds per screen. Pressing "refresh" is an explicit request to wait.
 */
export const FX_AUTO_FETCH_TIMEOUT_MS = 3_000;

/** After a failed automatic refresh, don't try again for this long. */
export const FX_RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000;

/** Two requests arriving together shouldn't both fetch. */
export const FX_STAMPEDE_WINDOW_MS = 5_000;
