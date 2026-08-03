import { afterEach, describe, expect, it, vi } from 'vitest';
import { RateSource, type Prisma } from '@prisma/client';
import { clearRates, withRollback } from '../../test/db';
import { SETTINGS_ID } from '../../lib/settings';
import { AppError } from '../../lib/errors';
import { convertAmount, listRates, refreshRates, setManualRate } from './service';

/**
 * Refresh is the only path that touches the network, so `fetch` is stubbed here and the
 * whole thing runs inside a rolled-back transaction.
 */

const LAST_UPDATE = Math.floor(new Date('2026-08-03T00:00:02.000Z').getTime() / 1000);
const NEXT_UPDATE = Math.floor(new Date('2026-08-04T00:00:02.000Z').getTime() / 1000);

interface ProviderRates {
  USD?: number;
  EUR?: number;
  GBP?: number;
}

/**
 * Stubs the provider. `rates` maps the requested base currency to the EGP rate it should
 * answer with; a currency omitted from the map produces a network failure for that pair.
 */
function stubProvider(rates: ProviderRates, options: { eolUnix?: number } = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const base = url.split('/').pop() ?? '';
      const value = rates[base as keyof ProviderRates];

      if (value === undefined) {
        throw new TypeError('fetch failed');
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          result: 'success',
          base_code: base,
          rates: { EGP: value },
          time_last_update_unix: LAST_UPDATE,
          time_next_update_unix: NEXT_UPDATE,
          time_eol_unix: options.eolUnix ?? 0,
        }),
      } as unknown as Response;
    }),
  );
}

async function enableApi(tx: Prisma.TransactionClient): Promise<void> {
  await tx.setting.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, ratesApiEnabled: true },
    update: { ratesApiEnabled: true },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('refreshRates', () => {
  it('refuses when the API is switched off, and says how to fix it', async () => {
    await withRollback(async (tx) => {
      await tx.setting.upsert({
        where: { id: SETTINGS_ID },
        create: { id: SETTINGS_ID, ratesApiEnabled: false },
        update: { ratesApiEnabled: false },
      });

      await expect(refreshRates(tx)).rejects.toBeInstanceOf(AppError);
      await expect(refreshRates(tx)).rejects.toMatchObject({ status: 422 });
    });
  });

  it('stores every pair in the canonical foreign→EGP direction', async () => {
    await withRollback(async (tx) => {
      await clearRates(tx);
      await enableApi(tx);
      stubProvider({ USD: 52.5, EUR: 60.1, GBP: 70.2 });

      const result = await refreshRates(tx);

      expect(result.changes).toHaveLength(3);
      expect(result.failures).toHaveLength(0);

      const stored = await tx.exchangeRate.findMany({ orderBy: { base: 'asc' } });
      expect(stored).toHaveLength(3);
      // Every row is foreign→EGP, so a stale manual row can never shadow a fresh API one.
      expect(stored.every((row) => row.quote === 'EGP')).toBe(true);
      expect(stored.map((row) => row.base).sort()).toEqual(['EUR', 'GBP', 'USD']);
      expect(stored.every((row) => row.source === RateSource.API)).toBe(true);
    });
  });

  it('records the provider timetable so staleness follows it', async () => {
    await withRollback(async (tx) => {
      await clearRates(tx);
      await enableApi(tx);
      stubProvider({ USD: 52.5, EUR: 60.1, GBP: 70.2 });

      await refreshRates(tx);

      const usd = await tx.exchangeRate.findFirst({ where: { base: 'USD' } });
      expect(usd?.nextUpdateAt?.toISOString()).toBe(new Date(NEXT_UPDATE * 1000).toISOString());
      expect(usd?.asOf.toISOString()).toBe(new Date(LAST_UPDATE * 1000).toISOString());
    });
  });

  it('reports what moved, against the previously stored rate', async () => {
    await withRollback(async (tx) => {
      await clearRates(tx);
      await enableApi(tx);
      await tx.exchangeRate.create({
        data: {
          base: 'USD',
          quote: 'EGP',
          rate: '50.0',
          asOf: new Date('2026-08-01T00:00:00.000Z'),
          source: RateSource.MANUAL,
        },
      });
      stubProvider({ USD: 52.5, EUR: 60.1, GBP: 70.2 });

      const result = await refreshRates(tx);
      const usd = result.changes.find((change) => change.base === 'USD');

      expect(usd?.previousRate).toBe('50.00000000');
      expect(usd?.newRate).toBe('52.50000000');
      expect(usd?.deltaPct).toBe('5.0000');
    });
  });

  it('reports no previous rate when the fallback was an emergency default', async () => {
    await withRollback(async (tx) => {
      await clearRates(tx);
      await enableApi(tx);
      stubProvider({ USD: 52.5, EUR: 60.1, GBP: 70.2 });

      const result = await refreshRates(tx);
      const usd = result.changes.find((change) => change.base === 'USD');

      // An emergency default is the absence of a rate, not a previous value.
      expect(usd?.previousRate).toBeNull();
      expect(usd?.deltaPct).toBeNull();
    });
  });

  it('applies a partial refresh rather than discarding what it got', async () => {
    await withRollback(async (tx) => {
      await clearRates(tx);
      await enableApi(tx);
      stubProvider({ USD: 52.5, EUR: 60.1 });

      const result = await refreshRates(tx);

      expect(result.changes.map((c) => c.base).sort()).toEqual(['EUR', 'USD']);
      expect(result.failures).toEqual([
        { quote: 'GBP', message: expect.stringContaining('Could not reach') },
      ]);
      expect(await tx.exchangeRate.count()).toBe(2);
    });
  });

  it('fails loudly only when nothing at all could be fetched', async () => {
    await withRollback(async (tx) => {
      await clearRates(tx);
      await enableApi(tx);
      stubProvider({});

      await expect(refreshRates(tx)).rejects.toMatchObject({ status: 422 });
      // Existing rates are left exactly as they were.
      expect(await tx.exchangeRate.count()).toBe(0);
    });
  });

  it('persists the provider end-of-life date when one is announced (D10)', async () => {
    await withRollback(async (tx) => {
      await clearRates(tx);
      await enableApi(tx);
      const eolUnix = Math.floor(new Date('2027-01-01T00:00:00.000Z').getTime() / 1000);
      stubProvider({ USD: 52.5, EUR: 60.1, GBP: 70.2 }, { eolUnix });

      const result = await refreshRates(tx);

      expect(result.apiEolAt).toBe('2027-01-01T00:00:00.000Z');
      const settings = await tx.setting.findUnique({ where: { id: SETTINGS_ID } });
      expect(settings?.ratesApiEolAt?.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    });
  });

  it('treats time_eol_unix of 0 as no announcement', async () => {
    await withRollback(async (tx) => {
      await clearRates(tx);
      await enableApi(tx);
      stubProvider({ USD: 52.5, EUR: 60.1, GBP: 70.2 });

      const result = await refreshRates(tx);

      expect(result.apiEolAt).toBeNull();
      const settings = await tx.setting.findUnique({ where: { id: SETTINGS_ID } });
      expect(settings?.ratesApiEolAt).toBeNull();
    });
  });

  it('is idempotent — refreshing twice does not duplicate rows', async () => {
    await withRollback(async (tx) => {
      await clearRates(tx);
      await enableApi(tx);
      stubProvider({ USD: 52.5, EUR: 60.1, GBP: 70.2 });

      await refreshRates(tx);
      await refreshRates(tx);

      expect(await tx.exchangeRate.count()).toBe(3);
    });
  });
});

describe('manual rates', () => {
  it('a typed rate beats a fresher-looking API rate at the same instant', async () => {
    await withRollback(async (tx) => {
      await clearRates(tx);
      await enableApi(tx);
      stubProvider({ USD: 52.5, EUR: 60.1, GBP: 70.2 });
      await refreshRates(tx);

      const apiRow = await tx.exchangeRate.findFirstOrThrow({ where: { base: 'USD' } });

      // The parallel-market rate I actually got, entered at the same moment.
      await setManualRate(tx, {
        base: 'USD',
        quote: 'EGP',
        rate: '55.0000',
        asOf: apiRow.asOf,
      });

      const { rates } = await listRates(tx, new Date('2026-08-03T06:00:00.000Z'));
      const usd = rates.find((rate) => rate.base === 'USD');

      expect(usd?.rate).toBe('55.00000000');
      expect(usd?.source).toBe('MANUAL');
    });
  });

  it('defaults asOf to now so a typed rate takes effect immediately', async () => {
    await withRollback(async (tx) => {
      await clearRates(tx);
      const before = Date.now();

      const row = await setManualRate(tx, { base: 'USD', quote: 'EGP', rate: '53.2500' });

      expect(row.source).toBe('MANUAL');
      expect(row.rate).toBe('53.25000000');
      expect(new Date(row.asOf).getTime()).toBeGreaterThanOrEqual(before);
      expect(row.nextUpdateAt).toBeNull();
    });
  });

  it('overwrites rather than duplicating at the same instant', async () => {
    await withRollback(async (tx) => {
      await clearRates(tx);
      const asOf = new Date('2026-08-03T09:00:00.000Z');

      await setManualRate(tx, { base: 'USD', quote: 'EGP', rate: '52.0000', asOf });
      await setManualRate(tx, { base: 'USD', quote: 'EGP', rate: '54.0000', asOf });

      const rows = await tx.exchangeRate.findMany({ where: { base: 'USD' } });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.rate.toString()).toBe('54');
    });
  });
});

describe('listRates', () => {
  it('shows attribution only when the API is enabled (D10)', async () => {
    await withRollback(async (tx) => {
      await tx.setting.upsert({
        where: { id: SETTINGS_ID },
        create: { id: SETTINGS_ID, ratesApiEnabled: false },
        update: { ratesApiEnabled: false },
      });

      const off = await listRates(tx);
      expect(off.attribution).toBeNull();
      expect(off.apiEnabled).toBe(false);

      await enableApi(tx);
      const on = await listRates(tx);
      expect(on.attribution).toEqual({
        label: 'Rates by Exchange Rate API',
        url: 'https://www.exchangerate-api.com',
      });
    });
  });

  it('returns one resolved rate per foreign currency', async () => {
    await withRollback(async (tx) => {
      const { rates } = await listRates(tx);

      expect(rates.map((rate) => rate.base).sort()).toEqual(['EUR', 'GBP', 'USD']);
      expect(rates.every((rate) => rate.quote === 'EGP')).toBe(true);
    });
  });
});

describe('convertAmount', () => {
  it('converts at the resolved rate', async () => {
    await withRollback(async (tx) => {
      await clearRates(tx);
      await tx.exchangeRate.create({
        data: {
          base: 'USD',
          quote: 'EGP',
          rate: '51.1232',
          asOf: new Date('2026-08-03T00:00:00.000Z'),
          source: RateSource.MANUAL,
        },
      });

      const result = await convertAmount(tx, {
        amount: '500',
        from: 'USD',
        to: 'EGP',
        date: new Date('2026-08-03T06:00:00.000Z'),
      });

      expect(result.amount).toBe('500.0000');
      expect(result.result).toBe('25561.6000');
      expect(result.rate.rate).toBe('51.12320000');
    });
  });

  it('accepts an arithmetic expression, same parser as the client (SPEC §8)', async () => {
    await withRollback(async (tx) => {
      await clearRates(tx);
      await tx.exchangeRate.create({
        data: {
          base: 'USD',
          quote: 'EGP',
          rate: '50',
          asOf: new Date('2026-08-03T00:00:00.000Z'),
          source: RateSource.MANUAL,
        },
      });

      const result = await convertAmount(tx, {
        amount: '1200*3+450',
        from: 'USD',
        to: 'EGP',
        date: new Date('2026-08-03T06:00:00.000Z'),
      });

      expect(result.amount).toBe('4050.0000');
      expect(result.result).toBe('202500.0000');
    });
  });

  it('rejects a broken expression with the field and position', async () => {
    await withRollback(async (tx) => {
      await expect(
        convertAmount(tx, { amount: '1200*', from: 'USD', to: 'EGP' }),
      ).rejects.toMatchObject({
        status: 400,
        details: { field: 'amount', code: 'UnexpectedToken' },
      });
    });
  });

  it('converts a currency to itself without inventing a rate', async () => {
    await withRollback(async (tx) => {
      const result = await convertAmount(tx, { amount: '1250.50', from: 'EGP', to: 'EGP' });

      expect(result.result).toBe('1250.5000');
      expect(result.rate.derivation).toBe('IDENTITY');
      expect(result.rate.stale).toBe(false);
    });
  });
});
