import { createContext } from 'react';
import type { ThemeMode, ThemePreset } from '@ledger/shared';

/**
 * The theme context and its constants, kept out of ThemeProvider.tsx so that file
 * exports a component and nothing else — otherwise React Fast Refresh cannot hot-reload
 * it, and every theme tweak becomes a full page reload.
 */

export const THEME_STORAGE_KEYS = {
  mode: 'ledger.theme.mode',
  preset: 'ledger.theme.preset',
} as const;

export const DEFAULT_MODE: ThemeMode = 'system';
export const DEFAULT_PRESET: ThemePreset = 'graphite';

export interface PresetMeta {
  id: ThemePreset;
  name: string;
  /** One line on what it is for — shown under the swatch in Settings. */
  description: string;
}

/** Six presets, each a distinct temperature rather than six hues of the same blue. */
export const PRESETS: readonly PresetMeta[] = [
  { id: 'graphite', name: 'Graphite', description: 'High-contrast monochrome' },
  { id: 'harbour', name: 'Harbour', description: 'Cool and technical' },
  { id: 'papyrus', name: 'Papyrus', description: 'Warm earth and sand' },
  { id: 'meridian', name: 'Meridian', description: 'Deep teal' },
  { id: 'cinnabar', name: 'Cinnabar', description: 'Warm red' },
  { id: 'basalt', name: 'Basalt', description: 'Violet' },
];

export interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  preset: ThemePreset;
  setPreset: (preset: ThemePreset) => void;
  /** What `system` actually resolved to — what is on screen right now. */
  resolvedMode: 'light' | 'dark';
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);
