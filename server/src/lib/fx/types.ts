import type { Prisma, PrismaClient, RateSource } from '@prisma/client';
import type { Currency, RateDerivation, StaleReason } from '@ledger/shared';

/**
 * A rate as a provider hands it over. `rate` is a decimal *string* — the provider
 * boundary is a wire boundary, and money never crosses one as a float (SPEC §4.2).
 */
export interface Rate {
  base: Currency;
  quote: Currency;
  rate: string;
  /** The moment the rate takes effect, not the moment we asked for it. */
  asOf: Date;
  /** The provider's own next-update time, when it gives one. Drives staleness. */
  nextUpdateAt: Date | null;
  source: RateSource;
}

/** SPEC §6. Two implementations: manual (the default) and the HTTP API (opt-in). */
export interface RateProvider {
  name: RateSource;
  fetchRates(base: Currency, quotes: Currency[]): Promise<Rate[]>;
}

/**
 * The outcome of resolving a pair, carrying enough context that a caller can explain the
 * number rather than just print it. D11 depends on `asOf` and `staleReason` being here:
 * a backdated entry has to say *which date* the suggested rate actually came from.
 */
export interface ResolvedRate {
  base: Currency;
  quote: Currency;
  /** 8dp decimal string. `1 base = rate quote`. */
  rate: string;
  asOf: Date;
  nextUpdateAt: Date | null;
  source: RateSource | 'IDENTITY';
  derivation: RateDerivation;
  stale: boolean;
  staleReason: StaleReason | null;
  ageMs: number;
}

/**
 * Accepts either the client or a transaction client, so tests can resolve rates inside a
 * rolled-back transaction and leave the database exactly as they found it.
 */
export type Db = PrismaClient | Prisma.TransactionClient;
