import { describe, expect, it } from 'vitest';
import { withRollback } from '../../test/db';
import { readSettings, writeSettings } from './service';

describe('settings', () => {
  it('reports the base currency as locked (D6)', async () => {
    await withRollback(async (tx) => {
      const settings = await readSettings(tx);

      expect(settings.baseCurrency).toBe('EGP');
      expect(settings.baseCurrencyLocked).toBe(true);
    });
  });

  it('rejects changing the base currency rather than ignoring it', async () => {
    await withRollback(async (tx) => {
      // Silently accepting this would be a control that appears to work and doesn't.
      await expect(writeSettings(tx, { baseCurrency: 'USD' })).rejects.toMatchObject({
        status: 422,
      });
    });
  });

  it('accepts EGP, since that is what it already is', async () => {
    await withRollback(async (tx) => {
      const settings = await writeSettings(tx, { baseCurrency: 'EGP' });
      expect(settings.baseCurrency).toBe('EGP');
    });
  });

  it('updates theme and locale', async () => {
    await withRollback(async (tx) => {
      const settings = await writeSettings(tx, {
        themePreset: 'harbour',
        themeMode: 'dark',
        locale: 'en-GB',
      });

      expect(settings.themePreset).toBe('harbour');
      expect(settings.themeMode).toBe('dark');
      expect(settings.locale).toBe('en-GB');
    });
  });

  it('leaves untouched fields alone', async () => {
    await withRollback(async (tx) => {
      const before = await readSettings(tx);
      const after = await writeSettings(tx, { themeMode: 'light' });

      expect(after.locale).toBe(before.locale);
      expect(after.ratesApiEnabled).toBe(before.ratesApiEnabled);
    });
  });
});
