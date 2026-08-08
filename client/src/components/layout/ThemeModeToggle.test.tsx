import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@/providers/ThemeProvider';
import { THEME_STORAGE_KEYS } from '@/providers/theme-context';
import { ThemeModeToggle } from './ThemeModeToggle';

/**
 * Mode only — the preset lives in Settings, where the swatches can show real colour.
 *
 * The one judgement worth pinning: the icon shows what is **on screen**, not what is
 * configured. With `system` selected on a light OS, a moon here would be a lie about the
 * current state, and the whole point of this app is not lying about state.
 */

function stubPrefersDark(prefersDark: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(prefers-color-scheme: dark)' ? prefersDark : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function Harness() {
  return (
    <ThemeProvider>
      <ThemeModeToggle />
    </ThemeProvider>
  );
}

const trigger = () => screen.getByRole('button', { name: /^Theme:/ });

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
  stubPrefersDark(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('what the trigger says', () => {
  it('names the configured mode, so the control is not a mystery icon', () => {
    render(<Harness />);

    expect(trigger()).toHaveAccessibleName('Theme: System. Change theme');
  });

  it('names an explicit choice once one is made', async () => {
    localStorage.setItem(THEME_STORAGE_KEYS.mode, 'dark');
    render(<Harness />);

    expect(trigger()).toHaveAccessibleName('Theme: Dark. Change theme');
  });
});

describe('what the icon shows', () => {
  /** `system` on a light OS is light, whatever the setting is called. */
  it('shows the sun when the screen is light, even on system', () => {
    stubPrefersDark(false);
    const { container } = render(<Harness />);

    expect(container.querySelector('.lucide-sun')).not.toBeNull();
    expect(container.querySelector('.lucide-moon')).toBeNull();
  });

  it('shows the moon when system resolves to dark', () => {
    stubPrefersDark(true);
    const { container } = render(<Harness />);

    expect(container.querySelector('.lucide-moon')).not.toBeNull();
    expect(container.querySelector('.lucide-sun')).toBeNull();
  });

  it('follows the chosen mode rather than the OS once one is picked', async () => {
    const user = userEvent.setup();
    stubPrefersDark(false);
    const { container } = render(<Harness />);

    await user.click(trigger());
    await user.click(await screen.findByRole('menuitem', { name: /Dark/ }));

    expect(container.querySelector('.lucide-moon')).not.toBeNull();
  });
});

describe('the menu', () => {
  it('offers all three modes', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(trigger());

    expect(await screen.findByRole('menuitem', { name: /Light/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Dark/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /System/ })).toBeInTheDocument();
  });

  it('applies the chosen mode and remembers it', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(trigger());
    await user.click(await screen.findByRole('menuitem', { name: /Light/ }));

    expect(document.documentElement).not.toHaveClass('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEYS.mode)).toBe('light');
  });

  it('goes back to following the OS when system is chosen', async () => {
    const user = userEvent.setup();
    stubPrefersDark(true);
    localStorage.setItem(THEME_STORAGE_KEYS.mode, 'light');
    render(<Harness />);
    expect(document.documentElement).not.toHaveClass('dark');

    await user.click(trigger());
    await user.click(await screen.findByRole('menuitem', { name: /System/ }));

    // The OS prefers dark, so following it means dark.
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEYS.mode)).toBe('system');
  });

  it('opens from the keyboard, since the topbar is reachable by Tab', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.tab();
    expect(trigger()).toHaveFocus();

    await user.keyboard('{Enter}');

    expect(await screen.findByRole('menuitem', { name: /Light/ })).toBeInTheDocument();
  });
});
