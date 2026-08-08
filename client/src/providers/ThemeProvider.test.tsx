import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { THEME_PRESETS } from '@ledger/shared';
import { useTheme } from '@/hooks/useTheme';
import { THEME_STORAGE_KEYS } from './theme-context';
import { ThemeProvider } from './ThemeProvider';

/**
 * Two independent axes (SPEC §11): **mode** as a `.dark` class on `<html>`, and **preset**
 * as `data-theme`. Both are already applied by the blocking script in index.html before
 * React mounts — this provider adopts what it finds rather than applying a default and
 * repainting, which is what would cause the flash the script exists to prevent.
 */

/** Lets a test decide what the OS prefers, and change its mind afterwards. */
function stubMatchMedia(prefersDark: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(prefers-color-scheme: dark)' ? prefersDark : false,
    media: query,
    onchange: null,
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.add(listener),
    removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.delete(listener),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));

  return {
    /** Simulates the OS switching to dark at dusk. */
    change(matches: boolean) {
      act(() => {
        for (const listener of listeners) listener({ matches } as MediaQueryListEvent);
      });
    },
  };
}

function Probe() {
  const { mode, preset, resolvedMode, setMode, setPreset } = useTheme();

  return (
    <div>
      <output data-testid="mode">{mode}</output>
      <output data-testid="preset">{preset}</output>
      <output data-testid="resolved">{resolvedMode}</output>
      <button type="button" onClick={() => setMode('dark')}>
        Go dark
      </button>
      <button type="button" onClick={() => setMode('system')}>
        Follow the OS
      </button>
      <button type="button" onClick={() => setPreset('meridian')}>
        Use Meridian
      </button>
    </div>
  );
}

const root = () => document.documentElement;
const readout = (id: string) => screen.getByTestId(id).textContent;

beforeEach(() => {
  localStorage.clear();
  root().className = '';
  root().removeAttribute('data-theme');
  root().style.colorScheme = '';
  stubMatchMedia(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('what it starts from', () => {
  it('defaults to following the OS, on the monochrome preset', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(readout('mode')).toBe('system');
    expect(readout('preset')).toBe('graphite');
  });

  it('adopts a stored choice', () => {
    localStorage.setItem(THEME_STORAGE_KEYS.mode, 'dark');
    localStorage.setItem(THEME_STORAGE_KEYS.preset, 'cinnabar');

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(readout('mode')).toBe('dark');
    expect(readout('preset')).toBe('cinnabar');
  });

  it('ignores a stored value that is not one of the real options', () => {
    localStorage.setItem(THEME_STORAGE_KEYS.mode, 'neon');
    localStorage.setItem(THEME_STORAGE_KEYS.preset, 'chartreuse');

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(readout('mode')).toBe('system');
    expect(readout('preset')).toBe('graphite');
  });

  /** localStorage throws outright in some private-browsing modes. A default beats a blank page. */
  it('falls back to the defaults rather than throwing when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(() =>
      render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      ),
    ).not.toThrow();

    expect(readout('mode')).toBe('system');
  });
});

describe('the two axes on <html>', () => {
  it('puts the preset on as a data attribute', () => {
    localStorage.setItem(THEME_STORAGE_KEYS.preset, 'basalt');

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(root().dataset['theme']).toBe('basalt');
  });

  it('puts dark mode on as a class, and takes it off again', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(root()).not.toHaveClass('dark');

    await user.click(screen.getByRole('button', { name: 'Go dark' }));
    expect(root()).toHaveClass('dark');

    await user.click(screen.getByRole('button', { name: 'Follow the OS' }));
    expect(root()).not.toHaveClass('dark');
  });

  /** So native controls — scrollbars, form widgets — match rather than staying light. */
  it('mirrors the mode into colorScheme', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(root().style.colorScheme).toBe('light');
    await user.click(screen.getByRole('button', { name: 'Go dark' }));
    expect(root().style.colorScheme).toBe('dark');
  });

  /** The two axes are independent: a preset must never decide light or dark. */
  it('changes the preset without touching the mode', async () => {
    const user = userEvent.setup();
    localStorage.setItem(THEME_STORAGE_KEYS.mode, 'dark');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(root()).toHaveClass('dark');

    await user.click(screen.getByRole('button', { name: 'Use Meridian' }));

    expect(root().dataset['theme']).toBe('meridian');
    expect(root()).toHaveClass('dark');
  });
});

describe('following the system', () => {
  it('resolves `system` to what the OS actually prefers', () => {
    stubMatchMedia(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(readout('mode')).toBe('system');
    expect(readout('resolved')).toBe('dark');
    expect(root()).toHaveClass('dark');
  });

  /** So the app changes with the OS at dusk, without a reload. */
  it('follows the OS when it changes its mind', () => {
    const media = stubMatchMedia(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(readout('resolved')).toBe('light');

    media.change(true);

    expect(readout('resolved')).toBe('dark');
    expect(root()).toHaveClass('dark');
  });

  it('stops following once a mode is chosen explicitly', async () => {
    const user = userEvent.setup();
    const media = stubMatchMedia(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Go dark' }));
    media.change(false);

    // The OS says light; the explicit choice wins.
    expect(readout('resolved')).toBe('dark');
    expect(root()).toHaveClass('dark');
  });
});

describe('remembering', () => {
  it('writes the choice immediately, so the blocking script has it next load', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Go dark' }));
    expect(localStorage.getItem(THEME_STORAGE_KEYS.mode)).toBe('dark');

    await user.click(screen.getByRole('button', { name: 'Use Meridian' }));
    expect(localStorage.getItem(THEME_STORAGE_KEYS.preset)).toBe('meridian');
  });

  it('still applies the theme when the write fails', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    await user.click(screen.getByRole('button', { name: 'Go dark' }));

    // Not remembered, but not lost for this session either.
    expect(root()).toHaveClass('dark');
    expect(readout('mode')).toBe('dark');
  });
});

/**
 * The blocking script in index.html cannot import anything — it has to run before any
 * module loads — so it restates the preset list and the storage keys. That duplication is
 * deliberate and commented, which makes it exactly the kind of thing that drifts silently
 * when a preset is added. These read the real file.
 */
describe('the blocking script in index.html', () => {
  /**
   * Under jsdom `import.meta.url` is not a `file:` URL, so the path comes from the working
   * directory — which is the client workspace for `npm test`, and the repo root when
   * vitest is pointed at it with `--root`.
   */
  const html = ['index.html', 'client/index.html'].reduce<string | null>((found, candidate) => {
    if (found !== null) return found;
    try {
      return readFileSync(resolve(process.cwd(), candidate), 'utf8');
    } catch {
      return null;
    }
  }, null);

  it('was found, so the assertions below mean something', () => {
    expect(html).not.toBeNull();
  });

  it('lists exactly the presets the app ships', () => {
    const match = (html ?? '').match(/var PRESETS = \[([^\]]+)\]/);
    expect(match).not.toBeNull();

    const inScript = (match?.[1] ?? '')
      .split(',')
      .map((entry) => entry.trim().replace(/^'|'$/g, ''));

    expect(inScript).toEqual([...THEME_PRESETS]);
  });

  it('reads the same storage keys the provider writes', () => {
    expect(html ?? '').toContain(THEME_STORAGE_KEYS.mode);
    expect(html ?? '').toContain(THEME_STORAGE_KEYS.preset);
  });

  /** If it were deferred or a module, it would run after paint and the flash would be back. */
  it('is inline and blocking, not deferred', () => {
    const tag = (html ?? '').match(/<script(?![^>]*src)[^>]*>/)?.[0] ?? '';

    expect(tag).not.toContain('defer');
    expect(tag).not.toContain('async');
    expect(tag).not.toContain('type="module"');
  });
});
