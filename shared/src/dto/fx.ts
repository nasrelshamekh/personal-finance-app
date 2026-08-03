import { z } from 'zod';
import { currencySchema, type Currency } from '../currency';
import { isoDate, positiveDecimalString } from './common';

/** Where a resolved rate came from. `IDENTITY` is EGP→EGP, which is always exactly 1. */
export type RateSourceDto = 'MANUAL' | 'API';
export type ResolvedRateSource = RateSourceDto | 'IDENTITY';

/**
 * Why a figure is marked stale. The UI shows an amber dot with the reason in a tooltip
 * (SPEC §4.6) — it never hides staleness, so this is never collapsed to a bare boolean.
 */
export type StaleReason =
  /** The provider told us when it would next update, and that moment has passed. */
  | 'PAST_NEXT_UPDATE'
  /** No provider timetable, and the rate is older than the 30h window. */
  | 'OLDER_THAN_30H'
  /** D1 rule 2: nothing at or before the requested date, so a newer rate was used. */
  | 'NO_RATE_AT_OR_BEFORE_DATE'
  /** D1 rule 3: no rate for this pair at all, so a hardcoded default was used. */
  | 'NO_RATE_AT_ALL';

/** How a pair was arrived at — surfaced so a derived rate is never passed off as stored. */
export type RateDerivation =
  | 'DIRECT'
  /** Stored as the reverse pair and inverted by division (SPEC §6). */
  | 'INVERTED'
  /** Neither side is EGP, so both legs were resolved and divided through the base. */
  | 'TRIANGULATED'
  | 'IDENTITY'
  | 'EMERGENCY_DEFAULT';

export interface ResolvedRateDto {
  base: Currency;
  quote: Currency;
  /** 8dp decimal string. `1 base = rate quote`. */
  rate: string;
  /** ISO. The moment the rate takes effect, not when it was fetched. */
  asOf: string;
  nextUpdateAt: string | null;
  source: ResolvedRateSource;
  derivation: RateDerivation;
  stale: boolean;
  staleReason: StaleReason | null;
  /**
   * Age of the underlying rate at the moment asked about, in milliseconds.
   *
   * **Negative** when the rate post-dates that moment — the `NO_RATE_AT_OR_BEFORE_DATE`
   * case, where a backdated entry fell back to a newer rate. Don't feed it straight to a
   * "time ago" formatter; for that case show `asOf` instead and say which date the rate
   * is really from (D11).
   */
  ageMs: number;
}

/** A row as stored, for the rate table on /currency. */
export interface StoredRateDto {
  id: string;
  base: Currency;
  quote: Currency;
  rate: string;
  asOf: string;
  nextUpdateAt: string | null;
  source: RateSourceDto;
}

/**
 * What the automatic refresh did on this request (D12). Rates are fetched without being
 * asked for, so the UI can say which of these happened rather than leaving you to guess
 * whether a figure is current.
 */
export type AutoRefreshOutcome =
  /** Stored rates were already current; nothing was fetched. */
  | 'FRESH'
  /** Fetched and stored new rates just now. */
  | 'REFRESHED'
  /** Another request is already fetching; this one used stored rates. */
  | 'PENDING'
  /** A recent attempt failed, so we are not hammering a provider that is down. */
  | 'THROTTLED'
  /** Automatic fetching is switched off in Settings. */
  | 'DISABLED'
  /** Tried and could not reach the provider. Stored rates were used instead. */
  | 'FAILED';

export interface FxRatesResponse {
  /** One resolved rate per foreign currency against EGP, newest first per pair. */
  rates: ResolvedRateDto[];
  /** What the automatic refresh did before these rates were read (D12). */
  autoRefresh: AutoRefreshOutcome;
  /** Whether the API provider may be used at all (Settings.ratesApiEnabled). */
  apiEnabled: boolean;
  /** Non-null when the provider has announced a shutdown date (D10). */
  apiEolAt: string | null;
  /** Licence condition of the free endpoint, not decoration (D10). */
  attribution: {
    label: string;
    url: string;
  } | null;
}

export interface RateChangeDto {
  base: Currency;
  quote: Currency;
  previousRate: string | null;
  newRate: string;
  /** Signed, 4dp, null when there was nothing to compare against. */
  deltaPct: string | null;
}

export interface RateRefreshFailureDto {
  quote: Currency;
  message: string;
}

export interface FxRefreshResponse {
  refreshedAt: string;
  /** What actually moved, so the button can report it (SPEC §9). */
  changes: RateChangeDto[];
  /**
   * Pairs the provider could not supply. A partial refresh still applies what it got —
   * one currency being unavailable is no reason to discard the other two.
   */
  failures: RateRefreshFailureDto[];
  apiEolAt: string | null;
}

export const fxConvertQuerySchema = z.object({
  /**
   * A decimal string *or* an arithmetic expression — the same parser the client previews
   * with, so `1200*3` is accepted here too (SPEC §8).
   */
  amount: z.string().min(1, 'Enter an amount.'),
  from: currencySchema,
  to: currencySchema,
  date: isoDate.optional(),
});

export type FxConvertQuery = z.infer<typeof fxConvertQuerySchema>;

export interface FxConvertResponse {
  /** The input after evaluating any arithmetic, 4dp. */
  amount: string;
  from: Currency;
  to: Currency;
  /** 4dp. */
  result: string;
  rate: ResolvedRateDto;
}

export const fxManualRateSchema = z
  .object({
    base: currencySchema,
    quote: currencySchema,
    rate: positiveDecimalString,
    /** Defaults to now. Set it explicitly to backfill a rate for a past date (D11). */
    asOf: isoDate.optional(),
  })
  .refine((value) => value.base !== value.quote, {
    message: 'A currency cannot have a rate against itself.',
    path: ['quote'],
  });

export type FxManualRateInput = z.infer<typeof fxManualRateSchema>;

/**
 * A rate is stale once now is past its nextUpdateAt, or — when the provider gave no
 * timetable — once it is older than this (SPEC §4.6). 30h rather than 24h because the
 * free tier updates once daily and 24h sits exactly on the boundary, so every figure
 * would flicker amber for the hour before the refresh.
 */
export const STALE_AFTER_MS = 30 * 60 * 60 * 1000;

export const RATE_ATTRIBUTION = {
  label: 'Rates by Exchange Rate API',
  url: 'https://www.exchangerate-api.com',
} as const;
