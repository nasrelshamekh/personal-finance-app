import { afterEach, describe, expect, it, vi } from 'vitest';
import { RateSource, type Prisma } from '@prisma/client';
import type { Currency } from '@ledger/shared';
import { clearRates, withRollback } from '../../test/db';
import { getRate } from './resolve';

/**
 * Integration tests against real Postgres, each inside a rolled-back transaction.
 *
 * D1's resolution order is an ORDER BY; testing it against a fake repository would be
 * testing a second implementation of the rule rather than the one that runs.
 */

const AT = new Date('2026-08-03T12:00:00.000Z');
const daysBefore = (d: number) => new Date(AT.getTime() - d * 24 * 60 * 60 * 1000);

async function insertRate(
  tx: Prisma.TransactionClient,
  values: {
    base: Currency;
    quote: Currency;
    rate: string;
    asOf: Date;
    source: RateSource;
    nextUpdateAt?: Date | null;
  },
): Promise<void> {
  await tx.exchangeRate.create({
    data: {
      base: values.base,
      quote: values.quote,
      rate: values.rate,
      asOf: values.asOf,
      source: values.source,
      nextUpdateAt: values.nextUpdateAt ?? null,
    },
  });
}

/** Compares a derived rate to an independently computed value, not to itself. */
function expectClose(actual: string, expected: number): void {
  expect(Math.abs(Number.parseFloat(actual) - expected)).toBeLessThan(1e-7);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('identity', () => {
  it('resolves a currency against itself as exactly 1, never stale', async () => {
    await withRollback(async (tx) => {
      const result = await getRate(tx, 'EGP', 'EGP', AT);

      expect(result.rate).toBe('1.00000000');
      expect(result.derivation).toBe('IDENTITY');
      expect(result.source).toBe('IDENTITY');
      expect(result.stale).toBe(false);
    });
  });
});

describe('rule 1 — newest at or before the date', () => {
  it('takes the newest rate that is not in the future', async () => {
    await withRollback(async (tx) => {
      await clearRates(tx);
      await insertRate(tx, {
        base: 'USD',
        quote: 'EGP',
        rate: '48.0',
        asOf: daysBefore(10),
        source: RateSource.MANUAL,
      });
      await insertRate(tx, {
        base: 'USD',
        quote: 'EGP',
        rate: '51.1232',
        asOf: daysBefore(1),
        source: RateSource.MANUAL,
      });
      // Dated after the moment we are asking about — must be ignored.
      await insertRate(tx, {
        base: 'USD',
        quote: 'EGP',
        rate: '99.0',
        asOf: new Date(AT.getTime() + 60_000),
        source: RateSource.MANUAL,
      });

      const result = await getRate(tx, 'USD', 'EGP', AT);

      expect(result.rate).toBe('51.12320000');
      expect(result.derivation).toBe('DIRECT');
      expect(result.staleReason).toBeNull();
    });
  });

  it('resolves a historical date to the rate that applied then', async () => {
    await withRollback(async (tx) => {
      await clearRates(tx);
      await insertRate(tx, {
        base: 'USD',
        quote: 'EGP',
        rate: '48.0',
        asOf: daysBefore(10),
        source: RateSource.MANUAL,
      });
      await insertRate(tx, {
        base: 'USD',
        quote: 'EGP',
        rate: '51.1232',
        asOf: daysBefore(1),
        source: RateSource.MANUAL,
      });

      const result = await getRate(tx, 'USD', 'EGP', daysBefore(5));

      expect(result.rate).toBe('48.00000000');
    });
  });

  it('does not age a historical rate against today', async () => {
    await withRollback(async (tx) => {
      await clearRates(tx);
      await insertRate(tx, {
        base: 'USD',
        quote: 'EGP',
        rate: '48.0',
        asOf: daysBefore(200),
        source: RateSource.MANUAL,
      });

      // Staleness is measured against the date being asked about, not against now —
      // otherwise every figure in last year's history would wear an amber dot.
      const result = await getRate(tx, 'USD', 'EGP', daysBefore(200));

      expect(result.stale).toBe(false);
    });
  });

  it('still flags a rate that was already old on the date asked about', async () => {
    await withRollback(async (tx) => {
      await clearRates(tx);
      await insertRate(tx, {
        base: 'USD',
        quote: 'EGP',
        rate: '48.0',
        asOf: daysBefore(10),
        source: RateSource.MANUAL,
      });

      // The best rate for day-5 is five days older than day-5. That is a poor estimate
      // for that date, and saying so is the point of D11's backdating notice.
      const result = await getRate(tx, 'USD', 'EGP', daysBefore(5));

      expect(result.stale).toBe(true);
      expect(result.staleReason).toBe('OLDER_THAN_30H');
    });
  });
});

describe('manual override wins', () => {
  it('beats an API rate at the identical asOf (D1)', async () => {
    await withRollback(async (tx) => {
      await clearRates(tx);
      const sameMoment = daysBefore(1);

      await insertRate(tx, {
        base: 'USD',
        quote: 'EGP',
        rate: '49.0',
        asOf: sameMoment,
        source: RateSource.API,
      });
      await insertRate(tx, {
        base: 'USD',
        quote: 'EGP',
        rate: '51.1232',
        asOf: sameMoment,
        source: RateSource.MANUAL,
      });

      const result = await getRate(tx, 'USD', 'EGP', AT);

      expect(result.rate).toBe('51.12320000');
      expect(result.source).toBe(RateSource.MANUAL);
    });
  });

  it('both rows coexist — the constraint allows one per source (D1)', async () => {
    await withRollback(async (tx) => {
      await clearRates(tx);
      const sameMoment = daysBefore(1);

      await insertRate(tx, {
        base: 'USD',
        quote: 'EGP',
        rate: '49.0',
        asOf: sameMoment,
        source: RateSource.API,
      });
      await insertRate(tx, {
        base: 'USD',
        quote: 'EGP',
        rate: '51.1232',
        asOf: sameMoment,
        source: RateSource.MANUAL,
      });

      expect(await tx.exchangeRate.count({ where: { asOf: sameMoment } })).toBe(2);
    });
  });

  it('does not beat a *newer* API rate — newest wins, manual only breaks ties', async () => {
    await withRollback(async (tx) => {
      await clearRates(tx);
      await insertRate(tx, {
        base: 'USD',
        quote: 'EGP',
        rate: '51.1232',
        asOf: daysBefore(3),
        source: RateSource.MANUAL,
      });
      await insertRate(tx, {
        base: 'USD',
        quote: 'EGP',
        rate: '52.5',
        asOf: daysBefore(1),
        source: RateSource.API,
      });

      const result = await getRate(tx, 'USD', 'EGP', AT);

      expect(result.rate).toBe('52.50000000');
      expect(result.source).toBe(RateSource.API);
    });
  });
});

describe('rule 2 — nothing at or before the date', () => {
  it('falls back to the newest rate and says so', async () => {
    await withRollback(async (tx) => {
      await clearRates(tx);
      await insertRate(tx, {
        base: 'USD',
        quote: 'EGP',
        rate: '51.1232',
        asOf: AT,
        source: RateSource.MANUAL,
      });

      // Six months before any rate exists — the backdating case from D11.
      const result = await getRate(tx, 'USD', 'EGP', daysBefore(180));

      expect(result.rate).toBe('51.12320000');
      expect(result.stale).toBe(true);
      expect(result.staleReason).toBe('NO_RATE_AT_OR_BEFORE_DATE');
      // The date the suggested rate is really from — what the D11 notice reports.
      expect(result.asOf.toISOString()).toBe(AT.toISOString());
    });
  });
});

describe('rule 3 — no rate at all', () => {
  it('uses the hardcoded emergency default, flagged stale', async () => {
    await withRollback(async (tx) => {
      await clearRates(tx);

      const result = await getRate(tx, 'USD', 'EGP', AT);

      expect(result.rate).toBe('51.12320000');
      expect(result.derivation).toBe('EMERGENCY_DEFAULT');
      expect(result.stale).toBe(true);
      expect(result.staleReason).toBe('NO_RATE_AT_ALL');
    });
  });

  it('produces an emergency rate in the reverse direction too', async () => {
    await withRollback(async (tx) => {
      await clearRates(tx);

      const result = await getRate(tx, 'EGP', 'USD', AT);

      expectClose(result.rate, 1 / 51.1232);
      expect(result.derivation).toBe('EMERGENCY_DEFAULT');
    });
  });
});

describe('inversion', () => {
  it('derives EGP→USD from a stored USD→EGP by division', async () => {
    await withRollback(async (tx) => {
      await clearRates(tx);
      await insertRate(tx, {
        base: 'USD',
        quote: 'EGP',
        rate: '51.1232',
        asOf: daysBefore(1),
        source: RateSource.MANUAL,
      });

      const result = await getRate(tx, 'EGP', 'USD', AT);

      expectClose(result.rate, 1 / 51.1232);
      expect(result.derivation).toBe('INVERTED');
      expect(result.stale).toBe(false);
    });
  });

  it('prefers a stored direct rate over inverting the reverse pair', async () => {
    await withRollback(async (tx) => {
      await clearRates(tx);
      await insertRate(tx, {
        base: 'USD',
        quote: 'EGP',
        rate: '51.1232',
        asOf: daysBefore(1),
        source: RateSource.MANUAL,
      });
      await insertRate(tx, {
        base: 'EGP',
        quote: 'USD',
        rate: '0.02',
        asOf: daysBefore(1),
        source: RateSource.MANUAL,
      });

      const result = await getRate(tx, 'EGP', 'USD', AT);

      expect(result.rate).toBe('0.02000000');
      expect(result.derivation).toBe('DIRECT');
    });
  });
});

describe('triangulation', () => {
  it('crosses two legs through EGP for a pair with no EGP side', async () => {
    await withRollback(async (tx) => {
      await clearRates(tx);
      await insertRate(tx, {
        base: 'EUR',
        quote: 'EGP',
        rate: '58.86',
        asOf: daysBefore(1),
        source: RateSource.MANUAL,
      });
      await insertRate(tx, {
        base: 'USD',
        quote: 'EGP',
        rate: '51.1232',
        asOf: daysBefore(1),
        source: RateSource.MANUAL,
      });

      const result = await getRate(tx, 'EUR', 'USD', AT);

      expectClose(result.rate, 58.86 / 51.1232);
      expect(result.derivation).toBe('TRIANGULATED');
      expect(result.stale).toBe(false);
    });
  });

  it('carries staleness across from the worse leg', async () => {
    await withRollback(async (tx) => {
      await clearRates(tx);
      await insertRate(tx, {
        base: 'EUR',
        quote: 'EGP',
        rate: '58.86',
        asOf: daysBefore(1),
        source: RateSource.MANUAL,
      });
      // Five days old with no timetable — past the 30h window.
      await insertRate(tx, {
        base: 'USD',
        quote: 'EGP',
        rate: '51.1232',
        asOf: daysBefore(5),
        source: RateSource.MANUAL,
      });

      const result = await getRate(tx, 'EUR', 'USD', AT);

      expect(result.stale).toBe(true);
      expect(result.staleReason).toBe('OLDER_THAN_30H');
      // The older leg is what describes how out of date the answer really is.
      expect(result.asOf.toISOString()).toBe(daysBefore(5).toISOString());
    });
  });
});

describe('staleness on a resolved rate', () => {
  it('honours the provider timetable', async () => {
    await withRollback(async (tx) => {
      await clearRates(tx);
      await insertRate(tx, {
        base: 'USD',
        quote: 'EGP',
        rate: '51.1232',
        asOf: daysBefore(2),
        source: RateSource.API,
        nextUpdateAt: new Date(AT.getTime() + 3_600_000),
      });

      const result = await getRate(tx, 'USD', 'EGP', AT);

      expect(result.stale).toBe(false);
      expect(result.nextUpdateAt?.toISOString()).toBe(
        new Date(AT.getTime() + 3_600_000).toISOString(),
      );
    });
  });

  it('marks a rate past its next update as stale', async () => {
    await withRollback(async (tx) => {
      await clearRates(tx);
      await insertRate(tx, {
        base: 'USD',
        quote: 'EGP',
        rate: '51.1232',
        asOf: daysBefore(2),
        source: RateSource.API,
        nextUpdateAt: daysBefore(1),
      });

      const result = await getRate(tx, 'USD', 'EGP', AT);

      expect(result.stale).toBe(true);
      expect(result.staleReason).toBe('PAST_NEXT_UPDATE');
    });
  });

  it('marks an untimetabled rate older than 30h as stale', async () => {
    await withRollback(async (tx) => {
      await clearRates(tx);
      await insertRate(tx, {
        base: 'USD',
        quote: 'EGP',
        rate: '51.1232',
        asOf: daysBefore(2),
        source: RateSource.MANUAL,
      });

      const result = await getRate(tx, 'USD', 'EGP', AT);

      expect(result.stale).toBe(true);
      expect(result.staleReason).toBe('OLDER_THAN_30H');
    });
  });
});

describe('offline', () => {
  it('resolves every pair with the network disabled', async () => {
    // Resolution reads only what is already stored — this is why a provider outage can
    // never break a write (SPEC §6).
    const fetchSpy = vi.fn(() => {
      throw new Error('network is disabled');
    });
    vi.stubGlobal('fetch', fetchSpy);

    await withRollback(async (tx) => {
      await clearRates(tx);
      await insertRate(tx, {
        base: 'USD',
        quote: 'EGP',
        rate: '51.1232',
        asOf: daysBefore(1),
        source: RateSource.MANUAL,
      });
      await insertRate(tx, {
        base: 'EUR',
        quote: 'EGP',
        rate: '58.86',
        asOf: daysBefore(1),
        source: RateSource.MANUAL,
      });

      expect((await getRate(tx, 'USD', 'EGP', AT)).rate).toBe('51.12320000');
      expect((await getRate(tx, 'EGP', 'USD', AT)).derivation).toBe('INVERTED');
      expect((await getRate(tx, 'EUR', 'USD', AT)).derivation).toBe('TRIANGULATED');
      expect((await getRate(tx, 'GBP', 'EGP', AT)).derivation).toBe('EMERGENCY_DEFAULT');
      expect((await getRate(tx, 'EGP', 'EGP', AT)).rate).toBe('1.00000000');
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
