import { RateSource } from '@prisma/client';
import {
  BASE_CURRENCY,
  FOREIGN_CURRENCIES,
  RATE_ATTRIBUTION,
  type AutoRefreshOutcome,
  type Currency,
  type FxConvertResponse,
  type FxManualRateInput,
  type FxRatesResponse,
  type FxRefreshResponse,
  type RateChangeDto,
  type RateRefreshFailureDto,
  type ResolvedRateDto,
  type StoredRateDto,
} from '@ledger/shared';
import { env } from '../../env';
import { logger } from '../../logger';
import { AppError } from '../../lib/errors';
import { parseAmount } from '../../lib/amount';
import { getSettings, SETTINGS_ID } from '../../lib/settings';
import { convert, div, mul, sub, toRateString, toStorageString } from '../../lib/money';
import {
  ApiRateProvider,
  FX_AUTO_FETCH_TIMEOUT_MS,
  FX_FETCH_TIMEOUT_MS,
  FX_RETRY_AFTER_FAILURE_MS,
  FX_STAMPEDE_WINDOW_MS,
  FxProviderError,
  getRate,
  getRatesToBase,
  type Db,
  type ResolvedRate,
} from '../../lib/fx';

/**
 * All FX business logic. No `req`, no `res` — the router validates and calls in here
 * (SPEC §3).
 */

function toDto(resolved: ResolvedRate): ResolvedRateDto {
  return {
    base: resolved.base,
    quote: resolved.quote,
    rate: resolved.rate,
    asOf: resolved.asOf.toISOString(),
    nextUpdateAt: resolved.nextUpdateAt?.toISOString() ?? null,
    source: resolved.source,
    derivation: resolved.derivation,
    stale: resolved.stale,
    staleReason: resolved.staleReason,
    ageMs: resolved.ageMs,
  };
}

export async function listRates(
  db: Db,
  at: Date = new Date(),
  autoRefresh: AutoRefreshOutcome = 'DISABLED',
): Promise<FxRatesResponse> {
  const [settings, rates] = await Promise.all([
    getSettings(db),
    getRatesToBase(db, FOREIGN_CURRENCIES, at),
  ]);

  return {
    rates: rates.map(toDto),
    autoRefresh,
    apiEnabled: settings.ratesApiEnabled,
    apiEolAt: settings.ratesApiEolAt?.toISOString() ?? null,
    // Attribution is a licence condition of the free endpoint, shown whenever the API is
    // in play (D10). Null when it isn't, because then we are using nobody's data.
    attribution: settings.ratesApiEnabled ? { ...RATE_ATTRIBUTION } : null,
  };
}

/**
 * Every rate leaves the server at a fixed 8dp. Prisma's own `toString()` drops trailing
 * zeros, so `53.25` and `53.25000000` would otherwise be the same rate in two shapes
 * depending on which endpoint you asked — the client should never have to normalise.
 */
function storedToDto(row: {
  id: string;
  base: Currency;
  quote: Currency;
  rate: { toString(): string };
  asOf: Date;
  nextUpdateAt: Date | null;
  source: RateSource;
}): StoredRateDto {
  return {
    id: row.id,
    base: row.base,
    quote: row.quote,
    rate: toRateString(row.rate.toString()),
    asOf: row.asOf.toISOString(),
    nextUpdateAt: row.nextUpdateAt?.toISOString() ?? null,
    source: row.source,
  };
}

/** The raw stored rows behind the resolved figures — the rate table on /currency. */
export async function listStoredRates(db: Db, limit = 50): Promise<StoredRateDto[]> {
  const rows = await db.exchangeRate.findMany({
    orderBy: [{ asOf: 'desc' }, { source: 'asc' }],
    take: limit,
  });

  return rows.map(storedToDto);
}

/**
 * Records a manual rate. Manual rates are intent, not a guess — they win ties against API
 * rates at the same instant, and the parallel-market spread in Egypt is exactly why the
 * override has to exist (SPEC §6).
 */
export async function setManualRate(db: Db, input: FxManualRateInput): Promise<StoredRateDto> {
  const asOf = input.asOf ?? new Date();

  const row = await db.exchangeRate.upsert({
    where: {
      base_quote_source_asOf: {
        base: input.base,
        quote: input.quote,
        source: RateSource.MANUAL,
        asOf,
      },
    },
    create: {
      base: input.base,
      quote: input.quote,
      rate: toRateString(input.rate),
      asOf,
      // A typed rate has no provider timetable, so staleness falls back to the 30h
      // window rather than pretending to know when it expires.
      nextUpdateAt: null,
      source: RateSource.MANUAL,
    },
    update: { rate: toRateString(input.rate) },
  });

  return storedToDto(row);
}

export async function convertAmount(
  db: Db,
  input: { amount: string; from: Currency; to: Currency; date?: Date },
): Promise<FxConvertResponse> {
  // The same parser the client previews with, so `1200*3` works here too (SPEC §8).
  const amount = parseAmount(input.amount, 'amount');

  const at = input.date ?? new Date();
  const rate = await getRate(db, input.from, input.to, at);

  return {
    amount: toStorageString(amount),
    from: input.from,
    to: input.to,
    result: toStorageString(convert(amount, rate.rate)),
    rate: toDto(rate),
  };
}

/** Signed percentage change, 4dp. Null when there is nothing to compare against. */
function deltaPct(previous: string | null, next: string): string | null {
  if (previous === null) return null;
  if (Number.parseFloat(previous) === 0) return null;
  return toStorageString(mul(div(sub(next, previous), previous), '100'));
}

/**
 * Pulls fresh rates on demand (SPEC §6 — no cron, no background jobs).
 *
 * Rates are stored in one canonical direction, foreign → EGP, matching the seed. Storing
 * whichever direction the provider happened to be asked for would let a stale manual
 * `USD→EGP` row shadow a fresh API `EGP→USD` one, because resolution prefers a direct
 * match over an inverted one. One direction, no shadowing.
 */
export async function refreshRates(
  db: Db,
  options: { timeoutMs?: number } = {},
): Promise<FxRefreshResponse> {
  const settings = await getSettings(db);

  if (!settings.ratesApiEnabled) {
    throw AppError.unprocessable(
      'Automatic rates are switched off. Turn them on in Settings, or set the rate by hand on this page.',
      { setting: 'ratesApiEnabled' },
    );
  }

  const provider = new ApiRateProvider(
    env.FX_API_BASE_URL,
    options.timeoutMs ?? FX_FETCH_TIMEOUT_MS,
  );
  const at = new Date();

  // Rates before the refresh, so the button can report what actually moved.
  const before = new Map<Currency, ResolvedRate>();
  for (const quote of FOREIGN_CURRENCIES) {
    before.set(quote, await getRate(db, quote, BASE_CURRENCY, at));
  }

  // One request per foreign currency, so each rate is stored exactly as the provider
  // gave it rather than inverted from a single EGP-based call.
  const results = await Promise.allSettled(
    FOREIGN_CURRENCIES.map(async (quote) => ({
      quote,
      result: await provider.fetchLatest(quote, [BASE_CURRENCY]),
    })),
  );

  const changes: RateChangeDto[] = [];
  const failures: RateRefreshFailureDto[] = [];
  let eolAt: Date | null = null;

  for (const [index, settled] of results.entries()) {
    const quote = FOREIGN_CURRENCIES[index];
    if (quote === undefined) continue;

    if (settled.status === 'rejected') {
      const reason = settled.reason;
      const message =
        reason instanceof FxProviderError
          ? reason.message
          : 'The rates provider could not be reached.';
      // A provider failure is logged and reported, never thrown past this point —
      // it must not be able to break anything else (SPEC §6).
      logger.warn({ quote, err: reason }, 'FX refresh failed for pair');
      failures.push({ quote, message });
      continue;
    }

    const { rates, eolAt: providerEol } = settled.value.result;
    if (providerEol !== null) eolAt = providerEol;

    for (const rate of rates) {
      await db.exchangeRate.upsert({
        where: {
          base_quote_source_asOf: {
            base: rate.base,
            quote: rate.quote,
            source: RateSource.API,
            asOf: rate.asOf,
          },
        },
        create: {
          base: rate.base,
          quote: rate.quote,
          rate: rate.rate,
          asOf: rate.asOf,
          nextUpdateAt: rate.nextUpdateAt,
          source: RateSource.API,
        },
        update: { rate: rate.rate, nextUpdateAt: rate.nextUpdateAt },
      });

      const previous = before.get(rate.base);
      // Only compare against a rate that was really stored; an emergency default is not
      // a previous value, it is the absence of one.
      const previousRate =
        previous && previous.derivation !== 'EMERGENCY_DEFAULT' ? previous.rate : null;

      changes.push({
        base: rate.base,
        quote: rate.quote,
        previousRate,
        newRate: rate.rate,
        deltaPct: deltaPct(previousRate, rate.rate),
      });
    }
  }

  if (changes.length === 0 && failures.length > 0) {
    throw AppError.unprocessable(
      'Could not reach the rates provider. Your existing rates are unchanged — set one by hand if you need it now.',
      { failures },
    );
  }

  // D10: watch the provider's announced end of life so it can be replaced before it
  // dies rather than after.
  if (eolAt?.getTime() !== settings.ratesApiEolAt?.getTime()) {
    await db.setting.update({
      where: { id: SETTINGS_ID },
      data: { ratesApiEolAt: eolAt },
    });
    if (eolAt !== null) {
      logger.warn({ eolAt }, 'Rates provider has announced an end-of-life date');
    }
  }

  return {
    refreshedAt: at.toISOString(),
    changes,
    failures,
    apiEolAt: eolAt?.toISOString() ?? null,
  };
}

/**
 * Automatic rate fetching (D12).
 *
 * You should never have to type a rate to record a foreign transaction. This tops rates
 * up on its own when they have gone stale, so that by the time a figure is converted the
 * stored rate is today's.
 *
 * Three properties matter more than freshness does:
 *
 * 1. **It never throws.** A provider outage degrades to stored rates, exactly as when
 *    the network is off entirely. Resolution itself still touches no network.
 * 2. **It gives up quickly** — a 3s provider timeout rather than 10s, because this runs
 *    while you are trying to do something else.
 * 3. **It backs off.** After a failure it stays quiet for five minutes, so a machine with
 *    no connection doesn't attempt a doomed fetch on every single request.
 *
 * The two timestamps below are module state, which is sound here: this is a single-user,
 * single-process, self-hosted app. If it ever runs more than one process, they become a
 * per-process hint rather than a global lock — which costs an occasional duplicate fetch
 * and nothing else, because the upsert is idempotent.
 */
let lastFailureAt = 0;
let refreshStartedAt = 0;

/** Test seam: the module state above would otherwise leak between test cases. */
export function resetAutoRefreshState(): void {
  lastFailureAt = 0;
  refreshStartedAt = 0;
}

export async function ensureFreshRates(db: Db, at: Date = new Date()): Promise<AutoRefreshOutcome> {
  const settings = await getSettings(db);
  if (!settings.ratesApiEnabled) return 'DISABLED';

  const rates = await getRatesToBase(db, FOREIGN_CURRENCIES, at);
  if (rates.every((rate) => !rate.stale)) return 'FRESH';

  const now = Date.now();
  if (now - refreshStartedAt < FX_STAMPEDE_WINDOW_MS) return 'PENDING';
  if (now - lastFailureAt < FX_RETRY_AFTER_FAILURE_MS) return 'THROTTLED';

  refreshStartedAt = now;
  try {
    await refreshRates(db, { timeoutMs: FX_AUTO_FETCH_TIMEOUT_MS });
    return 'REFRESHED';
  } catch (error) {
    // Deliberately swallowed: an automatic refresh is best-effort, and the caller has
    // perfectly usable stored rates. The outcome is reported, not thrown.
    lastFailureAt = Date.now();
    logger.warn({ err: error }, 'Automatic rate refresh failed; using stored rates');
    return 'FAILED';
  } finally {
    refreshStartedAt = 0;
  }
}
