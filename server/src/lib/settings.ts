import type { Setting } from '@prisma/client';
import type { Db } from './fx/types';

/**
 * Read access to the single settings row.
 *
 * The full settings module arrives in Phase 3; FX needs only two fields from it —
 * whether the API provider may be used, and where to record the provider's announced
 * end-of-life date (D10).
 */

export const SETTINGS_ID = 1;

/**
 * Returns the settings row, creating it if a database predates the seed. Settings are
 * single-row by construction, so this can never produce a second one.
 */
export async function getSettings(db: Db): Promise<Setting> {
  return db.setting.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID },
    update: {},
  });
}
