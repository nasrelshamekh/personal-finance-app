import { Decimal } from './decimal';
import type { Currency } from './currency';

/**
 * Display-only money formatting, shared so the client and the server render a figure
 * identically. All arithmetic lives in `server/src/lib/money.ts` — nothing here mutates
 * a value beyond rounding it for presentation.
 *
 * SPEC §4.5: store 4 decimal places, display 2, round half-up.
 */

/** Decimal places persisted to Postgres (`Decimal(18,4)`). */
export const STORAGE_DP = 4;
/** Decimal places shown to a human. */
export const DISPLAY_DP = 2;
/** Decimal places on an exchange rate (`Decimal(18,8)`). */
export const RATE_DP = 8;

export const DEFAULT_LOCALE = 'en-US';

/**
 * decimal.js's ROUND_HALF_UP rounds to the nearest neighbour and, when equidistant, away
 * from zero — which is what "half-up" means for money, in both directions.
 */
export const ROUNDING = Decimal.ROUND_HALF_UP;

/** Anything that can stand in for a money value on the wire or in the DB. */
export type MoneyInput = string | number | Decimal;

export interface FormatOptions {
  /** Defaults to 2. */
  dp?: number;
  locale?: string;
  /** `auto` shows a minus only; `always` forces +/-; `never` yields the magnitude. */
  signDisplay?: 'auto' | 'always' | 'never';
  /** Thousands separators. Defaults to true. */
  grouping?: boolean;
}

function toDisplayDecimal(value: MoneyInput, dp: number): Decimal {
  return new Decimal(value).toDecimalPlaces(dp, ROUNDING);
}

/**
 * `Decimal.toFixed()` always yields a plain numeric string, but TypeScript models
 * `Intl.StringNumericLiteral` as a template literal type (`${number}` | 'Infinity' | …)
 * that no computed string can ever satisfy. The assertion is correct by construction and
 * is deliberately confined to this one helper rather than repeated at each call site.
 */
function asNumericLiteral(value: string): Intl.StringNumericLiteral {
  return value as Intl.StringNumericLiteral;
}

/**
 * Formats the bare figure — no currency code. SPEC §10 sets the figure and its code at
 * different sizes and weights, so they are always rendered as separate nodes.
 */
export function formatAmount(value: MoneyInput, options: FormatOptions = {}): string {
  const {
    dp = DISPLAY_DP,
    locale = DEFAULT_LOCALE,
    signDisplay = 'auto',
    grouping = true,
  } = options;

  const rounded = toDisplayDecimal(value, dp);
  const forDisplay = signDisplay === 'never' ? rounded.abs() : rounded;

  // Intl.NumberFormat accepts a decimal *string* and formats it exactly, so a large
  // figure never round-trips through a float on its way to the screen.
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
    useGrouping: grouping,
    signDisplay: signDisplay === 'always' ? 'always' : 'auto',
  }).format(asNumericLiteral(forDisplay.toFixed(dp)));
}

export interface MoneyParts {
  /** The formatted figure, e.g. `12,480.00`. */
  amount: string;
  /** The currency code, e.g. `EGP`. */
  currency: Currency;
  /** `-1`, `0` or `1` — drives the direction glyph without re-parsing the string. */
  direction: -1 | 0 | 1;
  isNegative: boolean;
}

/**
 * Splits a figure into the pieces the UI styles separately. Callers pair `direction` with
 * a glyph so meaning never rests on colour alone (SPEC §10).
 */
export function formatMoneyParts(
  value: MoneyInput,
  currency: Currency,
  options: FormatOptions = {},
): MoneyParts {
  const dp = options.dp ?? DISPLAY_DP;
  const rounded = toDisplayDecimal(value, dp);
  const sign = rounded.isZero() ? 0 : rounded.isNegative() ? -1 : 1;

  return {
    amount: formatAmount(value, options),
    currency,
    direction: sign,
    isNegative: sign === -1,
  };
}

/** Formats a figure with its currency code appended, for plain-text contexts. */
export function format(value: MoneyInput, currency: Currency, options: FormatOptions = {}): string {
  return `${formatAmount(value, options)} ${currency}`;
}

/** The same, always in the base currency. */
export function formatEgp(value: MoneyInput, options: FormatOptions = {}): string {
  return format(value, 'EGP', options);
}

/**
 * Formats an exchange rate. Rates carry more precision than money and trailing zeros are
 * noise here, so they are trimmed rather than padded to a fixed width.
 */
export function formatRate(value: MoneyInput, locale: string = DEFAULT_LOCALE): string {
  const rounded = new Decimal(value).toDecimalPlaces(RATE_DP, ROUNDING);
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: RATE_DP,
  }).format(asNumericLiteral(rounded.toFixed(RATE_DP)));
}
