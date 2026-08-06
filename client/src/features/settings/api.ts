import type { SettingsDto, UpdateSettingsInput } from '@ledger/shared';
import { api } from '@/lib/api';

export const settingsApi = {
  get: () => api.get<SettingsDto>('/settings'),
  update: (body: UpdateSettingsInput) => api.put<SettingsDto>('/settings', body),
};
