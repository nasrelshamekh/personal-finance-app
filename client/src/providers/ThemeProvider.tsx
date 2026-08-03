import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { THEME_MODES, THEME_PRESETS, type ThemeMode, type ThemePreset } from '@ledger/shared';
import {
  DEFAULT_MODE,
  DEFAULT_PRESET,
  THEME_STORAGE_KEYS,
  ThemeContext,
  type ThemeContextValue,
} from './theme-context';

/**
 * Two independent axes (SPEC §11): **mode** (light | dark | system, applied as a `.dark`
 * class) and **preset** (applied as `data-theme`).
 *
 * Both are already on `<html>` before this ever runs — the blocking script in index.html
 * puts them there before React mounts, which is the only thing preventing a flash of the
 * wrong theme. This provider therefore *adopts* what it finds rather than applying a
 * default and repainting.
 */

function isMode(value: string | null): value is ThemeMode {
  return value !== null && (THEME_MODES as readonly string[]).includes(value);
}

function isPreset(value: string | null): value is ThemePreset {
  return value !== null && (THEME_PRESETS as readonly string[]).includes(value);
}

function readStored<T extends string>(
  key: string,
  guard: (value: string | null) => value is T,
  fallback: T,
): T {
  try {
    const stored = localStorage.getItem(key);
    return guard(stored) ? stored : fallback;
  } catch {
    // localStorage throws in some private-browsing modes. A default beats a blank page.
    return fallback;
  }
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not fatal: the theme still applies for this session, it just won't be remembered.
  }
}

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() =>
    readStored(THEME_STORAGE_KEYS.mode, isMode, DEFAULT_MODE),
  );
  const [preset, setPresetState] = useState<ThemePreset>(() =>
    readStored(THEME_STORAGE_KEYS.preset, isPreset, DEFAULT_PRESET),
  );
  const [systemIsDark, setSystemIsDark] = useState(prefersDark);

  // Follow the OS while mode is `system`, so the app changes with it at dusk.
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemIsDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const resolvedMode: 'light' | 'dark' =
    mode === 'system' ? (systemIsDark ? 'dark' : 'light') : mode;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedMode === 'dark');
    // Mirrors what the blocking script set, so native controls stay in step.
    document.documentElement.style.colorScheme = resolvedMode;
  }, [resolvedMode]);

  useEffect(() => {
    document.documentElement.dataset['theme'] = preset;
  }, [preset]);

  // Persisted immediately so the blocking script reads the right value on the next load.
  // Syncing to the Setting row is the settings feature's job, not the provider's.
  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    persist(THEME_STORAGE_KEYS.mode, next);
  }, []);

  const setPreset = useCallback((next: ThemePreset) => {
    setPresetState(next);
    persist(THEME_STORAGE_KEYS.preset, next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, setMode, preset, setPreset, resolvedMode }),
    [mode, setMode, preset, setPreset, resolvedMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
