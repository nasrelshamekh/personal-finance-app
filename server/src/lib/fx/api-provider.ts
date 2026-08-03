import { RateSource } from '@prisma/client';
import { z } from 'zod';
import { Decimal, isCurrency, type Currency } from '@ledger/shared';
import { toRateString } from '../money';
import { FX_FETCH_TIMEOUT_MS } from './constants';
import type { Rate, RateProvider } from './types';

/**
 * open.er-api.com — free, no key, CORS enabled, includes EGP. Used only when
 * `ratesApiEnabled` is true in Settings (SPEC §6).
 *
 * Free-tier constraints that shape everything here: once-daily updates, **no historical
 * rates**, attribution required, redistribution forbidden.
 */

const successSchema = z.object({
  result: z.literal('success'),
  base_code: z.string(),
  rates: z.record(z.string(), z.number()),
  time_last_update_unix: z.number(),
  time_next_update_unix: z.number().optional(),
  /** 0 means "no end of life announced". Non-zero is a deprecation date (D10). */
  time_eol_unix: z.number().optional(),
});

const errorSchema = z.object({
  result: z.literal('error'),
  'error-type': z.string().optional(),
});

const responseSchema = z.union([successSchema, errorSchema]);

export class FxProviderError extends Error {
  constructor(message: string, cause?: unknown) {
    // Use the standard ErrorOptions channel rather than shadowing Error's own `cause`.
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'FxProviderError';
  }
}

export interface ApiFetchResult {
  rates: Rate[];
  /** The provider's announced shutdown date, or null when it reports none. */
  eolAt: Date | null;
}

function unixToDate(seconds: number): Date {
  return new Date(seconds * 1000);
}

export class ApiRateProvider implements RateProvider {
  readonly name = RateSource.API;

  constructor(private readonly baseUrl: string) {}

  /**
   * Conforms to the RateProvider interface. `fetchLatest` is the richer entry point —
   * the interface deliberately has no room for provider metadata, and the EOL date is
   * metadata we are contractually obliged to watch.
   */
  async fetchRates(base: Currency, quotes: Currency[]): Promise<Rate[]> {
    const { rates } = await this.fetchLatest(base, quotes);
    return rates;
  }

  async fetchLatest(base: Currency, quotes: Currency[]): Promise<ApiFetchResult> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/${base}`;

    let response: Response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(FX_FETCH_TIMEOUT_MS),
        headers: { accept: 'application/json' },
      });
    } catch (cause) {
      throw new FxProviderError(
        'Could not reach the rates provider. Check your connection, or set the rate by hand.',
        cause,
      );
    }

    if (!response.ok) {
      throw new FxProviderError(`The rates provider answered ${response.status}.`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      throw new FxProviderError('The rates provider sent something that is not JSON.', cause);
    }

    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new FxProviderError('The rates provider sent a response in an unexpected shape.');
    }
    if (parsed.data.result === 'error') {
      const reason = parsed.data['error-type'] ?? 'unknown';
      throw new FxProviderError(`The rates provider rejected the request (${reason}).`);
    }

    const body = parsed.data;
    const asOf = unixToDate(body.time_last_update_unix);
    const nextUpdateAt =
      body.time_next_update_unix === undefined ? null : unixToDate(body.time_next_update_unix);
    const eolAt =
      body.time_eol_unix === undefined || body.time_eol_unix === 0
        ? null
        : unixToDate(body.time_eol_unix);

    const rates: Rate[] = [];
    for (const quote of quotes) {
      if (quote === base) continue;

      const value = body.rates[quote];
      if (value === undefined) continue;

      rates.push({
        base,
        quote,
        // JSON numbers are doubles; Decimal reads the shortest round-trip form, which is
        // exactly the digits the provider sent.
        rate: toRateString(new Decimal(value)),
        asOf,
        nextUpdateAt,
        source: RateSource.API,
      });
    }

    if (!isCurrency(body.base_code) || body.base_code !== base) {
      throw new FxProviderError(
        `Asked the provider for ${base} but it answered for ${body.base_code}.`,
      );
    }

    return { rates, eolAt };
  }
}
