import { Decimal, ROUNDING, STORAGE_DP, RATE_DP, type MoneyInput } from '@ledger/shared';

/**
 * Money arithmetic. Every figure in this app passes through here.
 *
 * SPEC §4: never a JS `number`; strings are the only interchange format. Prisma hands
 * back a `Prisma.Decimal`, which is a *different class* from `decimal.js` — so it is
 * stringified the instant it leaves Prisma and re-entered here via `toDecimal`. Nothing
 * in this module accepts or returns a `Prisma.Decimal`.
 */

export { Decimal, STORAGE_DP, RATE_DP };
export type { MoneyInput };

/** Re-exported so the server formats figures identically to the client. */
export { format, formatEgp, formatAmount, formatRate, formatMoneyParts } from '@ledger/shared';

export const ZERO = new Decimal(0);
export const ONE = new Decimal(1);

/**
 * The one way to get a Decimal. Rejects anything that isn't a finite number, because a
 * NaN that reaches the database is a silent corruption rather than a loud failure.
 */
export function toDecimal(value: MoneyInput): Decimal {
  const d = value instanceof Decimal ? value : new Decimal(value);
  if (!d.isFinite()) {
    throw new TypeError(`Not a finite money value: ${String(value)}`);
  }
  return d;
}

export function add(a: MoneyInput, b: MoneyInput): Decimal {
  return toDecimal(a).plus(toDecimal(b));
}

export function sub(a: MoneyInput, b: MoneyInput): Decimal {
  return toDecimal(a).minus(toDecimal(b));
}

export function mul(a: MoneyInput, b: MoneyInput): Decimal {
  return toDecimal(a).times(toDecimal(b));
}

export function div(a: MoneyInput, b: MoneyInput): Decimal {
  const divisor = toDecimal(b);
  if (divisor.isZero()) {
    throw new RangeError('Division by zero');
  }
  return toDecimal(a).dividedBy(divisor);
}

export function sum(values: readonly MoneyInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(toDecimal(v)), ZERO);
}

export function negate(value: MoneyInput): Decimal {
  return toDecimal(value).negated();
}

export function abs(value: MoneyInput): Decimal {
  return toDecimal(value).abs();
}

export function isZero(value: MoneyInput): boolean {
  return toDecimal(value).isZero();
}

/** -1, 0 or 1. Amounts are stored signed (SPEC §4.7), so callers lean on this a lot. */
export function compare(a: MoneyInput, b: MoneyInput): -1 | 0 | 1 {
  return toDecimal(a).comparedTo(toDecimal(b)) as -1 | 0 | 1;
}

/**
 * Converts an amount into another currency at a given rate.
 *
 * Rounded to storage precision here and only here: `amountEgp` is frozen on write and
 * never recomputed on read (SPEC §4.4), so this is the single moment the derived figure
 * comes into existence.
 */
export function convert(amount: MoneyInput, rate: MoneyInput): Decimal {
  return roundStorage(mul(amount, rate));
}

/** Rounds to the 4dp the column actually holds, so nothing is silently truncated by PG. */
export function roundStorage(value: MoneyInput): Decimal {
  return toDecimal(value).toDecimalPlaces(STORAGE_DP, ROUNDING);
}

export function roundRate(value: MoneyInput): Decimal {
  return toDecimal(value).toDecimalPlaces(RATE_DP, ROUNDING);
}

/**
 * The canonical way a money value leaves the server — for the database *and* for JSON,
 * which are the same format by design (SPEC §2).
 */
export function toStorageString(value: MoneyInput): string {
  return roundStorage(value).toFixed(STORAGE_DP);
}

export function toRateString(value: MoneyInput): string {
  return roundRate(value).toFixed(RATE_DP);
}

/**
 * Inverts a rate. `1 base = rate quote` is the stored direction, so the reverse pair is
 * derived by division rather than stored twice and left to drift (SPEC §6).
 */
export function invertRate(rate: MoneyInput): Decimal {
  const r = toDecimal(rate);
  if (r.isZero()) {
    throw new RangeError('Cannot invert a zero exchange rate');
  }
  return roundRate(ONE.dividedBy(r));
}
