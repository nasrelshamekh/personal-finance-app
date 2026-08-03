import { STALE_AFTER_MS, type StaleReason } from '@ledger/shared';

export interface StalenessInput {
  asOf: Date;
  nextUpdateAt: Date | null;
  now: Date;
}

export interface Staleness {
  stale: boolean;
  reason: StaleReason | null;
  ageMs: number;
}

/**
 * SPEC §4.6: a rate is stale once `now` is past its `nextUpdateAt`; when the provider
 * gave no timetable, once it is more than 30h old.
 *
 * Pure and separate from the database so the boundary conditions are cheap to test —
 * this is the thing that decides whether the amber dot appears.
 */
export function assessStaleness({ asOf, nextUpdateAt, now }: StalenessInput): Staleness {
  const ageMs = now.getTime() - asOf.getTime();

  if (nextUpdateAt !== null) {
    return {
      stale: now.getTime() > nextUpdateAt.getTime(),
      reason: now.getTime() > nextUpdateAt.getTime() ? 'PAST_NEXT_UPDATE' : null,
      ageMs,
    };
  }

  return {
    stale: ageMs > STALE_AFTER_MS,
    reason: ageMs > STALE_AFTER_MS ? 'OLDER_THAN_30H' : null,
    ageMs,
  };
}

/**
 * Combines the two legs of a triangulated rate. Staleness is contagious on purpose: a
 * cross rate is only as trustworthy as its worse half, and the older `asOf` is the one
 * that describes how out of date the answer really is.
 */
export function worstOf(a: Staleness, b: Staleness): Staleness {
  if (a.stale && !b.stale) return a;
  if (b.stale && !a.stale) return b;
  return a.ageMs >= b.ageMs ? a : b;
}
