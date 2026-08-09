import { Component, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { CountUp } from './CountUp';

/**
 * Counts up on first load only (SPEC §10). Two things matter beyond the animation itself:
 * it must not re-run every time the cache refetches — a figure that re-animates on each
 * update is noise rather than delight — and it must **settle on the exact string** rather
 * than on a float that happens to be close, because this is money.
 */

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)' ? reduce : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

/**
 * Frames come off a timer rather than jsdom's paint clock.
 *
 * With the real one these tests passed alone and failed in the full run: the suite runs
 * files in parallel, `requestAnimationFrame` gets starved, and a 550ms count does not
 * finish inside `waitFor`'s budget. Depending on the frame clock at all was the mistake —
 * the easing, the progress and the settle all still run for real, they are just no longer
 * racing the machine.
 */
const pendingFrames = new Set<ReturnType<typeof setTimeout>>();

function driveFramesOffTimers() {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const handle = setTimeout(() => {
      pendingFrames.delete(handle);
      callback(performance.now());
    }, 0);
    pendingFrames.add(handle);
    return handle as unknown as number;
  });

  vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
    const timer = handle as unknown as ReturnType<typeof setTimeout>;
    clearTimeout(timer);
    pendingFrames.delete(timer);
  });
}

beforeEach(() => {
  stubReducedMotion(false);
  driveFramesOffTimers();
});

afterEach(() => {
  /*
   * Every queued frame has to be dropped here, by hand.
   *
   * `unstubAllGlobals` puts the real `cancelAnimationFrame` back, and React's unmount
   * cleanup then calls *that* with a `setTimeout` handle — which cancels nothing. The
   * orphaned timer fires after the environment is torn down and dies on a missing
   * `window`, failing the run while every assertion still reports green. It showed up
   * about once in ten runs.
   */
  for (const handle of pendingFrames) clearTimeout(handle);
  pendingFrames.clear();

  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('reduced motion', () => {
  /** Not "a faster animation" — no animation, and the real figure from the first paint. */
  it('shows the final figure immediately, without a frame of zero', () => {
    stubReducedMotion(true);
    render(<CountUp value="5436.16" currency="EGP" tone="plain" />);

    expect(screen.getByText('5,436.16')).toBeInTheDocument();
    expect(screen.queryByText('0.00')).toBeNull();
  });

  it('never asks for an animation frame at all', () => {
    stubReducedMotion(true);
    const raf = vi.spyOn(window, 'requestAnimationFrame');

    render(<CountUp value="5436.16" currency="EGP" tone="plain" />);

    expect(raf).not.toHaveBeenCalled();
  });
});

/**
 * `durationMs` is a real prop, so these shorten the count to a single frame. A test that
 * waits half a second to watch an easing curve is testing the clock, not the component.
 */
describe('the animation', () => {
  it('settles on the exact stored string, not a float near it', async () => {
    render(<CountUp value="9007199254740993.45" currency="EGP" tone="plain" durationMs={1} />);

    // The final hand-off passes the original string to Money, so precision beyond what a
    // JS number holds survives the count.
    await waitFor(() => expect(screen.getByText('9,007,199,254,740,993.45')).toBeInTheDocument());
  });

  it('arrives at the figure it was given', async () => {
    render(<CountUp value="5436.16" currency="EGP" tone="plain" durationMs={1} />);

    await waitFor(() => expect(screen.getByText('5,436.16')).toBeInTheDocument());
  });

  /** Mid-count it renders a working figure, not the final one from the first frame. */
  it('starts from zero rather than showing the answer straight away', () => {
    render(<CountUp value="5436.16" currency="EGP" tone="plain" />);

    expect(screen.queryByText('5,436.16')).toBeNull();
  });

  /**
   * The guard that matters: a refetch changes the value, and the figure should move to it
   * rather than counting up from zero again.
   */
  it('does not re-animate when the value changes later', async () => {
    const { rerender } = render(<CountUp value="100" currency="EGP" tone="plain" durationMs={1} />);
    await waitFor(() => expect(screen.getByText('100.00')).toBeInTheDocument());

    const raf = vi.spyOn(window, 'requestAnimationFrame');
    rerender(<CountUp value="250" currency="EGP" tone="plain" durationMs={1} />);

    expect(screen.getByText('250.00')).toBeInTheDocument();
    expect(raf).not.toHaveBeenCalled();
  });

  it('stops cleanly when unmounted mid-count', () => {
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const { unmount } = render(<CountUp value="5436.16" currency="EGP" tone="plain" />);

    unmount();

    expect(cancel).toHaveBeenCalled();
  });
});

describe('a value that is not a figure', () => {
  class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
    override state = { failed: false };
    static getDerivedStateFromError() {
      return { failed: true };
    }
    override render() {
      return this.state.failed ? <p>Something went wrong</p> : this.props.children;
    }
  }

  /**
   * CountUp skips the animation for a non-finite target and hands the string on — and
   * `Money` then throws, because a figure it cannot parse is a programming error rather
   * than something to render. That is the same choice `toDecimal` makes on the server: a
   * NaN reaching the screen is a silent corruption, and failing loudly beats displaying a
   * number that means nothing.
   *
   * Rendered inside a boundary because that is what happens in the app — every route
   * carries a `PageError` — and because letting it escape fills the run with uncaught
   * errors that vitest rightly warns can mask real ones.
   */
  it('fails loudly rather than showing a meaningless figure', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <Boundary>
        <CountUp value="not a number" currency="EGP" tone="plain" />
      </Boundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });
});

describe('what it passes on', () => {
  it('forwards the Money props it was given', async () => {
    render(<CountUp value="8860" currency="USD" size="xl" durationMs={1} />);

    await waitFor(() => expect(screen.getByText('8,860.00')).toBeInTheDocument());
    expect(screen.getByText('USD')).toBeInTheDocument();
    // Still a signed figure, so it keeps its glyph and its spoken direction.
    expect(screen.getByText('in')).toBeInTheDocument();
    expect(screen.getByText('8,860.00')).toHaveClass('text-[2.5rem]');
  });
});
