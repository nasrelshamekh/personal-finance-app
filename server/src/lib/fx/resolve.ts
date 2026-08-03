import type { ExchangeRate } from '@prisma/client';
import type { Currency, StaleReason } from '@ledger/shared';
import { BASE_CURRENCY } from '@ledger/shared';
import { div, invertRate, toRateString } from '../money';
import { EMERGENCY_RATES_TO_EGP } from './constants';
import { assessStaleness, worstOf, type Staleness } from './staleness';
import type { Db, ResolvedRate } from './types';

/**
 * Rate resolution (SPEC §6, D1). This never touches the network — it reads only what has
 * already been stored, which is why the app is fully functional offline and why a write
 * can never be broken by a provider being down.
 *
 * `at` serves double duty: it selects which rate applies, *and* it is the moment
 * staleness is measured against. For a live conversion `at` is now, which is exactly the
 * §4.6 rule. For a historical lookup that finds a rate from that same date, the rate is
 * correct rather than merely old, and is not marked stale — measuring its age against
 * today would put an amber dot on every figure in last year's history.
 */

/** Ordering that makes D1's tie-break work without raw SQL. */
const RATE_ORDER = [{ asOf: 'desc' }, { source: 'asc' }] as const;

/** Rule 1: the newest rate at or before the date, manual winning ties. */
async function findAtOrBefore(
  db: Db,
  base: Currency,
  quote: Currency,
  at: Date,
): Promise<ExchangeRate | null> {
  return db.exchangeRate.findFirst({
    where: { base, quote, asOf: { lte: at } },
    orderBy: [...RATE_ORDER],
  });
}

/** Rule 2: nothing at or before, so fall back to the newest there is. */
async function findNewest(db: Db, base: Currency, quote: Currency): Promise<ExchangeRate | null> {
  return db.exchangeRate.findFirst({
    where: { base, quote },
    orderBy: [...RATE_ORDER],
  });
}

interface StoredMatch {
  row: ExchangeRate;
  /** Set when rule 1 missed and rule 2 supplied the row instead. */
  fallback: StaleReason | null;
}

async function findStored(
  db: Db,
  base: Currency,
  quote: Currency,
  at: Date,
): Promise<StoredMatch | null> {
  const exact = await findAtOrBefore(db, base, quote, at);
  if (exact) return { row: exact, fallback: null };

  const newest = await findNewest(db, base, quote);
  if (newest) return { row: newest, fallback: 'NO_RATE_AT_OR_BEFORE_DATE' };

  return null;
}

function stalenessOf(resolved: ResolvedRate): Staleness {
  return { stale: resolved.stale, reason: resolved.staleReason, ageMs: resolved.ageMs };
}

function fromStored(
  match: StoredMatch,
  base: Currency,
  quote: Currency,
  at: Date,
  inverted: boolean,
): ResolvedRate {
  const { row, fallback } = match;
  const natural = assessStaleness({ asOf: row.asOf, nextUpdateAt: row.nextUpdateAt, now: at });

  // A rule-2 fallback is stale regardless of age: it is the right rate for the wrong
  // date, which is precisely what D11 needs to be able to warn about.
  const stale = fallback !== null || natural.stale;
  const staleReason = fallback ?? natural.reason;

  // Prisma hands back its own Decimal class; stringify it at the boundary and never let
  // it travel further (SPEC §2).
  const stored = row.rate.toString();

  return {
    base,
    quote,
    rate: inverted ? toRateString(invertRate(stored)) : toRateString(stored),
    asOf: row.asOf,
    nextUpdateAt: row.nextUpdateAt,
    source: row.source,
    derivation: inverted ? 'INVERTED' : 'DIRECT',
    stale,
    staleReason,
    ageMs: natural.ageMs,
  };
}

function identity(base: Currency, at: Date): ResolvedRate {
  return {
    base,
    quote: base,
    rate: toRateString('1'),
    asOf: at,
    nextUpdateAt: null,
    source: 'IDENTITY',
    derivation: 'IDENTITY',
    stale: false,
    staleReason: null,
    ageMs: 0,
  };
}

function emergency(base: Currency, quote: Currency, at: Date): ResolvedRate {
  const rate = emergencyRate(base, quote);

  return {
    base,
    quote,
    rate: toRateString(rate),
    asOf: at,
    nextUpdateAt: null,
    source: 'MANUAL',
    derivation: 'EMERGENCY_DEFAULT',
    stale: true,
    staleReason: 'NO_RATE_AT_ALL',
    ageMs: 0,
  };
}

function emergencyToEgp(currency: Currency): string {
  return currency === BASE_CURRENCY ? '1' : EMERGENCY_RATES_TO_EGP[currency];
}

/** Every direction falls out of crossing the two legs, including the EGP ones. */
function emergencyRate(base: Currency, quote: Currency): string {
  if (base === quote) return '1';
  return toRateString(div(emergencyToEgp(base), emergencyToEgp(quote)));
}

/**
 * Resolves `1 base = ? quote` at a point in time.
 *
 * Order: identity → stored direct → stored reverse (inverted) → triangulated through EGP
 * → hardcoded emergency default. Every path that is not an exact stored match says so in
 * `derivation`, so a derived figure is never passed off as one that was recorded.
 */
export async function getRate(
  db: Db,
  base: Currency,
  quote: Currency,
  at: Date = new Date(),
): Promise<ResolvedRate> {
  if (base === quote) {
    return identity(base, at);
  }

  const direct = await findStored(db, base, quote, at);
  if (direct) {
    return fromStored(direct, base, quote, at, false);
  }

  const reverse = await findStored(db, quote, base, at);
  if (reverse) {
    return fromStored(reverse, base, quote, at, true);
  }

  // Only triangulate when neither side is already the base currency — otherwise the
  // "cross" would just be the same missing pair again.
  if (base !== BASE_CURRENCY && quote !== BASE_CURRENCY) {
    const baseLeg = await getRate(db, base, BASE_CURRENCY, at);
    const quoteLeg = await getRate(db, quote, BASE_CURRENCY, at);

    const combined = worstOf(stalenessOf(baseLeg), stalenessOf(quoteLeg));
    const older = baseLeg.asOf <= quoteLeg.asOf ? baseLeg : quoteLeg;

    return {
      base,
      quote,
      rate: toRateString(div(baseLeg.rate, quoteLeg.rate)),
      asOf: older.asOf,
      nextUpdateAt: older.nextUpdateAt,
      source: older.source,
      derivation: 'TRIANGULATED',
      stale: combined.stale,
      staleReason: combined.reason,
      ageMs: combined.ageMs,
    };
  }

  return emergency(base, quote, at);
}

/**
 * `getRate` for every foreign currency against EGP — the FX strip and the rate table.
 * Resolved rather than read raw, so the strip shows the same staleness the figures do.
 */
export async function getRatesToBase(
  db: Db,
  quotes: readonly Currency[],
  at: Date = new Date(),
): Promise<ResolvedRate[]> {
  return Promise.all(quotes.map((quote) => getRate(db, quote, BASE_CURRENCY, at)));
}
