import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { TAPE_STORAGE_KEY } from './calculator-context';
import { CalculatorProvider } from './CalculatorProvider';
import { CalculatorButton } from './CalculatorButton';

/**
 * A popover on desktop, a sheet on mobile — the pad inside is identical either way, and
 * `CalculatorPad.test.tsx` covers it. What is left is the container: which one you get,
 * that the trigger says what it does, and that the pad is remounted per open so it never
 * reappears holding the last sum.
 */

/**
 * The setup file stubs `matchMedia` to match nothing, which is the mobile case. Desktop
 * needs it to answer `(min-width: 768px)` truthfully.
 */
function setViewport(desktop: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: desktop && query === '(min-width: 768px)',
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function Harness({ children }: { children?: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );

  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CalculatorProvider>
          <CalculatorButton />
          {children}
        </CalculatorProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const box = () => screen.getByLabelText('Calculation');

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('on a phone', () => {
  beforeEach(() => setViewport(false));

  it('opens as a sheet, which a popover anchored to a topbar button cannot be', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Calculator' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('data-slot', 'sheet-content');
    expect(within(dialog).getByText('Calculator')).toBeInTheDocument();
  });

  it('says what arithmetic is for, since amounts accept it everywhere', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Calculator' }));

    expect(
      await screen.findByText(/Amounts accept arithmetic anywhere in the app/),
    ).toBeInTheDocument();
  });
});

describe('on a desktop', () => {
  beforeEach(() => setViewport(true));

  it('opens as a popover, anchored to the button', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Calculator (press c)' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).not.toHaveAttribute('data-slot', 'sheet-content');
    expect(within(dialog).getByLabelText('Calculation')).toBeInTheDocument();
  });

  /** The shortcut is worth advertising: it is the fastest way in and easy to miss. */
  it('names the shortcut on the trigger', async () => {
    setViewport(true);
    render(<Harness />);

    const trigger = screen.getByRole('button', { name: 'Calculator (press c)' });
    expect(trigger).toHaveAttribute('title', 'Calculator (c)');
  });
});

describe('opening and closing', () => {
  beforeEach(() => setViewport(false));

  it('is closed until asked for', () => {
    render(<Harness />);

    expect(screen.queryByLabelText('Calculation')).toBeNull();
  });

  it('opens from `c` as well as from the button', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.keyboard('c');

    await waitFor(() => expect(box()).toBeInTheDocument());
  });

  /**
   * The pad is unmounted on close, so it never reopens holding the last sum; the tape
   * survives because it lives in the provider rather than the pad.
   *
   * `CalculatorButton` writes `{open && <CalculatorPad />}`, but Radix already unmounts
   * closed content — removing that guard changes nothing, and this test cannot tell the
   * difference. It pins the behaviour, not the mechanism.
   */
  it('starts on a clean expression each time, but keeps the tape', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.keyboard('c');
    await waitFor(() => expect(box()).toBeInTheDocument());
    await user.keyboard('12*2{Enter}');
    expect(box()).toHaveValue('24.00');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByLabelText('Calculation')).toBeNull());

    await user.keyboard('c');
    await waitFor(() => expect(box()).toBeInTheDocument());

    expect(box()).toHaveValue('');
    expect(screen.getByRole('button', { name: /Reuse this calculation/ })).toHaveTextContent(
      '12*2',
    );
  });

  it('does not open while a dialog already has your attention', async () => {
    const user = userEvent.setup();
    render(
      <Harness>
        <div role="dialog">
          <button type="button">Something else</button>
        </div>
      </Harness>,
    );

    await user.click(screen.getByRole('button', { name: 'Something else' }));
    await user.keyboard('c');

    expect(screen.queryByLabelText('Calculation')).toBeNull();
  });

  it('ignores `c` when it is part of a shortcut', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    // Ctrl+C is a copy, not a request for a calculator.
    await user.keyboard('{Control>}c{/Control}');

    expect(screen.queryByLabelText('Calculation')).toBeNull();
  });
});

describe('the tape across sessions', () => {
  beforeEach(() => setViewport(false));

  it('is read back from storage on a fresh mount', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      TAPE_STORAGE_KEY,
      JSON.stringify([{ id: 'a', expression: '5*5', result: '25.00', at: Date.now() }]),
    );
    render(<Harness />);

    await user.keyboard('c');
    await waitFor(() => expect(box()).toBeInTheDocument());

    expect(screen.getByRole('button', { name: /Reuse this calculation/ })).toHaveTextContent('5*5');
  });

  /** Corrupt storage is not worth failing over — a blank tape beats a blank screen. */
  it('starts empty rather than throwing when storage is unreadable', async () => {
    const user = userEvent.setup();
    localStorage.setItem(TAPE_STORAGE_KEY, 'not json');
    render(<Harness />);

    await user.keyboard('c');
    await waitFor(() => expect(box()).toBeInTheDocument());

    expect(screen.getByText(/Sums you work out appear here/)).toBeInTheDocument();
  });

  it('discards entries that are not the shape it expects', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      TAPE_STORAGE_KEY,
      JSON.stringify([{ nonsense: true }, { id: 'b', expression: '2+2', result: '4.00', at: 1 }]),
    );
    render(<Harness />);

    await user.keyboard('c');
    await waitFor(() => expect(box()).toBeInTheDocument());

    const entries = screen.getAllByRole('button', { name: /Reuse this calculation/ });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toHaveTextContent('2+2');
  });
});
