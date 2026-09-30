import { z } from 'zod';
import { currencySchema, type Currency } from '../currency';
import { rateSourceSchema, type RateSource } from '../enums';

export interface SettingsDto {
  baseCurrency: Currency;
  /** Always true in v1 — the column exists, the feature does not (D6). */
  baseCurrencyLocked: boolean;
  locale: string;
  rateSource: RateSource;
  ratesApiEnabled: boolean;
  /** Non-null means the provider has announced a shutdown date (D10). */
  ratesApiEolAt: string | null;
  themePreset: string;
  themeMode: string;
  updatedAt: string;
}

export const THEME_MODES = ['light', 'dark', 'system'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

/**
 * The names are fixed here so both sides agree. `aurora` is the default and was added
 * after the original six — appending rather than reordering, because the stored value is
 * a plain string column and an existing row must keep meaning what it meant.
 */
export const THEME_PRESETS = [
  'aurora',
  'graphite',
  'harbour',
  'papyrus',
  'meridian',
  'cinnabar',
  'basalt',
] as const;
export type ThemePreset = (typeof THEME_PRESETS)[number];

export const updateSettingsSchema = z
  .object({
    /**
     * Accepted but locked to EGP (D6). Present so sending it is a clear 422 rather than
     * a silent no-op — a switcher that appears to work and doesn't would be exactly the
     * kind of lie about money this app is meant to avoid.
     */
    baseCurrency: currencySchema,
    locale: z.string().min(2).max(35),
    rateSource: rateSourceSchema,
    ratesApiEnabled: z.boolean(),
    themePreset: z.enum(THEME_PRESETS),
    themeMode: z.enum(THEME_MODES),
  })
  .partial();

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
