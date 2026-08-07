import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { TAPE_STORAGE_KEY } from './calculator-context';
import { CalculatorProvider } from './CalculatorProvider';
import { CalculatorButton } from './CalculatorButton';

/**
 * SPEC §12 Phase 7's acceptance check: *keyboard-only operation of the calculator works
 * fully*.
 *
 * This exists because the browser harness could not close it. It drives real key events
 * but does not synthesise the browser's own default behaviour, so Enter on a focused
 * `<button>` produced no click there — reachability was provable, activation was not.
 * `user-event` models that default, which is the whole reason it is a dependency.
 */

/** Shows where the calculator navigated to, so "use this value" can be asserted on. */
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function Harness({ children }: { children?: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <CalculatorProvider>
          <CalculatorButton />
          {children}
          {/* `useLocation` works anywhere inside a router — no route table needed. */}
          <LocationProbe />
        </CalculatorProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const box = () => screen.getByLabelText('Calculation');
const tapeEntries = () => screen.queryAllByRole('button', { name: /Reuse this calculation/ });
const location = () => screen.getByTestId('location').textContent;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('opening it from the keyboard', () => {
  it('opens on `c` with the input already focused', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.queryByLabelText('Calculation')).toBeNull();
    await user.keyboard('c');

    await waitFor(() => expect(box()).toHaveFocus());
  });

  it('leaves `c` alone while you are typing somewhere else', async () => {
    const user = userEvent.setup();
    render(
      <Harness>
        <input aria-label="A note" />
      </Harness>,
    );

    await user.click(screen.getByLabelText('A note'));
    await user.keyboard('c');

    expect(screen.getByLabelText('A note')).toHaveValue('c');
    expect(screen.queryByLabelText('Calculation')).toBeNull();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.keyboard('c');
    await waitFor(() => expect(box()).toHaveFocus());

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByLabelText('Calculation')).toBeNull());
  });
});

describe('working something out', () => {
  it('records the sum to the tape on Enter and leaves the result in the box', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard('c');
    await waitFor(() => expect(box()).toHaveFocus());

    await user.keyboard('1200*3+450{Enter}');

    // The result stays put so the next operator carries on from it.
    expect(box()).toHaveValue('4050.00');

    const entries = tapeEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toHaveTextContent('1200*3+450');
    expect(entries[0]).toHaveTextContent('4050.00');
  });

  it('chains, so `+50` continues from the last result', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard('c');
    await waitFor(() => expect(box()).toHaveFocus());

    await user.keyboard('1200*3+450{Enter}');
    await user.keyboard('+50{Enter}');

    // 1200*3+450 = 4050, then +50.
    expect(box()).toHaveValue('4100.00');
    expect(tapeEntries()).toHaveLength(2);
  });

  it('previews the result before Enter without recording it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard('c');
    await waitFor(() => expect(box()).toHaveFocus());

    await user.keyboard('20*5');

    expect(screen.getByText('= 100.00')).toBeInTheDocument();
    expect(tapeEntries()).toHaveLength(0);
  });

  it('refuses to record a broken expression', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard('c');
    await waitFor(() => expect(box()).toHaveFocus());

    await user.keyboard('(10+5{Enter}');

    expect(box()).toHaveValue('(10+5');
    expect(tapeEntries()).toHaveLength(0);
    expect(box()).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('the tab order', () => {
  /**
   * The twenty keypad buttons are `tabIndex={-1}`: every key is typable, and putting them
   * in the tab order would bury the two controls that actually matter.
   */
  it('skips the keypad and reaches the controls that matter', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard('c');
    await waitFor(() => expect(box()).toHaveFocus());

    // A recorded sum, so `=`, "Use this value" and "Clear" are all live. With an empty
    // box the first two are disabled and the browser rightly skips them.
    await user.keyboard('20*5{Enter}');

    const reached: string[] = [];
    for (let step = 0; step < 5; step += 1) {
      await user.tab();
      reached.push(document.activeElement?.textContent?.trim() ?? '');
    }

    expect(reached.slice(0, 4)).toEqual(['=', 'Convert', 'Use this value', 'Clear']);
    // Fifth is the tape entry itself — reusable by keyboard, not just by mouse.
    expect(reached[4]).toContain('20*5');
  });

  it('never puts a keypad key in the tab order', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard('c');
    await waitFor(() => expect(box()).toHaveFocus());
    await user.keyboard('20*5{Enter}');

    const reached: string[] = [];
    for (let step = 0; step < 8; step += 1) {
      await user.tab();
      reached.push(document.activeElement?.getAttribute('aria-label') ?? '');
    }

    // Twenty keys plus the brackets and backspace are all `tabIndex={-1}`.
    expect(reached.filter((label) => label.startsWith('Enter '))).toEqual([]);
    expect(reached).not.toContain('Delete the last character');
    expect(reached).not.toContain('Open bracket');
  });
});

describe('"use this value"', () => {
  /**
   * The gap the browser harness left open: it dispatched a real Enter keydown but the
   * browser's own "Enter activates a focused button" behaviour never ran, so no click was
   * produced and this could only be verified with a mouse.
   */
  it('is activated by Enter and lands the result in a new transaction', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard('c');
    await waitFor(() => expect(box()).toHaveFocus());

    await user.keyboard('250*2{Enter}');
    await user.tab();
    await user.tab();
    await user.tab();

    expect(document.activeElement).toHaveTextContent('Use this value');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(location()).toBe('/transactions?new=1&amount=500.00'));
  });

  it('is activated by Space as well, because it is a real button', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard('c');
    await waitFor(() => expect(box()).toHaveFocus());

    await user.keyboard('40+2{Enter}');
    await user.tab();
    await user.tab();
    await user.tab();
    await user.keyboard(' ');

    await waitFor(() => expect(location()).toBe('/transactions?new=1&amount=42.00'));
  });

  it('closes the calculator on the way out', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard('c');
    await waitFor(() => expect(box()).toHaveFocus());

    await user.keyboard('7*6{Enter}');
    await user.tab();
    await user.tab();
    await user.tab();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.queryByLabelText('Calculation')).toBeNull());
  });

  it('stays disabled until there is something to use', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard('c');
    await waitFor(() => expect(box()).toHaveFocus());

    expect(screen.getByRole('button', { name: /Use this value/ })).toBeDisabled();
  });
});

describe('the tape', () => {
  it('puts a past sum back in the box when its entry is activated', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard('c');
    await waitFor(() => expect(box()).toHaveFocus());

    await user.keyboard('1200*3+450{Enter}');
    await user.clear(box());
    expect(box()).toHaveValue('');

    const entry = tapeEntries()[0];
    expect(entry).toBeDefined();
    if (entry) await user.click(entry);

    // The expression comes back, not the result — so it can be adjusted and re-run.
    expect(box()).toHaveValue('1200*3+450');
  });

  it('empties on Clear', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard('c');
    await waitFor(() => expect(box()).toHaveFocus());

    await user.keyboard('2+2{Enter}');
    expect(tapeEntries()).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Clear' }));

    expect(tapeEntries()).toHaveLength(0);
    expect(screen.getByText(/Sums you work out appear here/)).toBeInTheDocument();
  });

  /** A running total is exactly what you do not want to lose to an accidental refresh. */
  it('survives a reload', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);
    await user.keyboard('c');
    await waitFor(() => expect(box()).toHaveFocus());
    await user.keyboard('9*9{Enter}');

    expect(JSON.parse(localStorage.getItem(TAPE_STORAGE_KEY) ?? '[]')).toHaveLength(1);
    unmount();

    render(<Harness />);
    await user.keyboard('c');
    await waitFor(() => expect(box()).toHaveFocus());

    const entries = tapeEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toHaveTextContent('9*9');
  });

  it('keeps only the last twenty', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard('c');
    await waitFor(() => expect(box()).toHaveFocus());

    for (let n = 1; n <= 22; n += 1) {
      await user.clear(box());
      await user.keyboard(`${n}+0{Enter}`);
    }

    expect(tapeEntries()).toHaveLength(20);
    // Newest first, so the two oldest are the ones that fell off.
    expect(tapeEntries()[0]).toHaveTextContent('22+0');
  });
});

describe('the keypad, for the touch case', () => {
  it('appends what it is pressed and hands focus back to the input', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard('c');
    await waitFor(() => expect(box()).toHaveFocus());

    await user.click(screen.getByRole('button', { name: 'Enter 7' }));
    await user.click(screen.getByRole('button', { name: 'Enter +' }));
    await user.click(screen.getByRole('button', { name: 'Enter 3' }));

    expect(box()).toHaveValue('7+3');
    // Focus returns so typing continues where the tap left off.
    expect(box()).toHaveFocus();
  });

  it('deletes the last character', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard('c');
    await waitFor(() => expect(box()).toHaveFocus());

    await user.keyboard('123');
    await user.click(screen.getByRole('button', { name: 'Delete the last character' }));

    expect(box()).toHaveValue('12');
  });
});

describe('within the open sheet', () => {
  it('titles itself, so the dialog is announced', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard('c');

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Calculator')).toBeInTheDocument();
  });
});
