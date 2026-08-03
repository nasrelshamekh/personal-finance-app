import { RateSource } from '@prisma/client';
import type { Currency } from '@ledger/shared';
import type { Db, Rate, RateProvider } from './types';

/**
 * The default provider (SPEC §6). "Fetching" a manual rate means reading back the rates
 * that were typed into Settings — there is no remote call, which is what makes the app
 * fully functional with zero internet access.
 *
 * Parallel-market rates in Egypt drift from the official one, so a typed rate is treated
 * as intent, not as a guess to be improved on.
 */
export class ManualRateProvider implements RateProvider {
  readonly name = RateSource.MANUAL;

  constructor(private readonly db: Db) {}

  async fetchRates(base: Currency, quotes: Currency[]): Promise<Rate[]> {
    const rows = await Promise.all(
      quotes
        .filter((quote) => quote !== base)
        .map((quote) =>
          this.db.exchangeRate.findFirst({
            where: { base, quote, source: RateSource.MANUAL },
            orderBy: { asOf: 'desc' },
          }),
        ),
    );

    return rows
      .filter((row) => row !== null)
      .map((row) => ({
        base: row.base,
        quote: row.quote,
        rate: row.rate.toString(),
        asOf: row.asOf,
        nextUpdateAt: row.nextUpdateAt,
        source: RateSource.MANUAL,
      }));
  }
}
