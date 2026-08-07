import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

/**
 * Runs before every client test file (`vitest.config.ts` → `setupFiles`).
 *
 * Testing Library only auto-cleans when vitest globals are on, and they are deliberately
 * off here — so the unmount is registered explicitly. Without it, the previous test's DOM
 * is still mounted and a `getByRole` finds two of everything.
 */
afterEach(cleanup);

/**
 * jsdom implements no media queries at all, and `window.matchMedia` is simply absent.
 * `ThemeProvider` and `useMediaQuery` both call it during render, so any component test
 * that touches the theme or the desktop/mobile split would throw before asserting
 * anything. The stub reports "no match", which is the mobile-first default.
 */
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

/**
 * Radix measures its floating elements and recharts measures its container. Neither
 * exists in jsdom, and both throw rather than degrade.
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: ResizeObserverStub,
});
