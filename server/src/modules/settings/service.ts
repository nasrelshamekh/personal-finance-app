import type { Setting } from '@prisma/client';
import { BASE_CURRENCY, type SettingsDto, type UpdateSettingsInput } from '@ledger/shared';
import { AppError } from '../../lib/errors';
import { getSettings, SETTINGS_ID } from '../../lib/settings';
import type { Db } from '../../lib/fx';

function toDto(setting: Setting): SettingsDto {
  return {
    baseCurrency: setting.baseCurrency,
    // Always true in v1: the column exists so the schema is stable, the feature does not
    // ship, and the UI renders it disabled rather than pretending it works (D6).
    baseCurrencyLocked: true,
    locale: setting.locale,
    rateSource: setting.rateSource,
    ratesApiEnabled: setting.ratesApiEnabled,
    ratesApiEolAt: setting.ratesApiEolAt?.toISOString() ?? null,
    themePreset: setting.themePreset,
    themeMode: setting.themeMode,
    updatedAt: setting.updatedAt.toISOString(),
  };
}

export async function readSettings(db: Db): Promise<SettingsDto> {
  return toDto(await getSettings(db));
}

export async function writeSettings(db: Db, input: UpdateSettingsInput): Promise<SettingsDto> {
  // Rejected rather than silently ignored: a control that appears to work and doesn't is
  // exactly the kind of lie about money this app exists to avoid (D6).
  if (input.baseCurrency !== undefined && input.baseCurrency !== BASE_CURRENCY) {
    throw AppError.unprocessable(
      `The base currency is fixed to ${BASE_CURRENCY} in this version. Every stored figure is denominated in it.`,
      { field: 'baseCurrency' },
    );
  }

  await getSettings(db);

  const updated = await db.setting.update({
    where: { id: SETTINGS_ID },
    data: {
      ...(input.locale === undefined ? {} : { locale: input.locale }),
      ...(input.rateSource === undefined ? {} : { rateSource: input.rateSource }),
      ...(input.ratesApiEnabled === undefined ? {} : { ratesApiEnabled: input.ratesApiEnabled }),
      ...(input.themePreset === undefined ? {} : { themePreset: input.themePreset }),
      ...(input.themeMode === undefined ? {} : { themeMode: input.themeMode }),
    },
  });

  return toDto(updated);
}
