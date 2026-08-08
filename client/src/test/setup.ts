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

/**
 * jsdom's `Blob` has no `text()`, so `await file.text()` throws rather than resolving.
 * The import flow reads a chosen backup that way, and without this every upload lands in
 * the "that file is not JSON" branch — a green-looking test asserting the wrong thing.
 * `FileReader` does exist, so the polyfill is a real read rather than a stub.
 */
if (typeof Blob.prototype.text !== 'function') {
  Blob.prototype.text = function readAsText(this: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => resolve(String(reader.result)));
      reader.addEventListener('error', () => reject(reader.error));
      reader.readAsText(this);
    });
  };
}

/**
 * Radix's Select drives its listbox with pointer capture and scrolls the active option
 * into view. jsdom implements none of these — without them, opening a `<Select>` throws
 * `target.hasPointerCapture is not a function` before the options ever render.
 */
Object.defineProperty(Element.prototype, 'hasPointerCapture', {
  writable: true,
  value: () => false,
});
Object.defineProperty(Element.prototype, 'setPointerCapture', { writable: true, value: () => {} });
Object.defineProperty(Element.prototype, 'releasePointerCapture', {
  writable: true,
  value: () => {},
});
Object.defineProperty(Element.prototype, 'scrollIntoView', { writable: true, value: () => {} });
