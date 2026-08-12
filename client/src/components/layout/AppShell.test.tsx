import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { stubApi, type ApiStub } from '@/test/http';
import { fxRates } from '@/test/fixtures';
import { ThemeProvider } from '@/providers/ThemeProvider';
import { reportProblem, dismissFailure, getFailures } from '@/lib/action-feedback';
import { AppShell } from './AppShell';

/**
 * The frame every screen sits in. Its job is to stay out of the way, so most of these are
 * about the things you only notice when they are missing: a way past the navigation, an
 * announcement when the address changes, and a place for a failure to appear.
 */

const SIDEBAR_KEY = 'ledger.sidebar.collapsed';

function Harness({ initialUrl = '/' }: { initialUrl?: string }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[initialUrl]}>
          <Routes>
            <Route path="/" element={<AppShell />}>
              <Route index element={<p>Dashboard screen</p>} />
              <Route path="transactions" element={<p>Transactions screen</p>} />
              {/* Mirrors the real router: an unknown address still renders inside the shell. */}
              <Route path="*" element={<p>Nothing here</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

let api: ApiStub;

/**
 * The sidebar and the mobile bar both label their nav "Main", and each is `display: none`
 * at the other's breakpoint — so a real browser exposes exactly one. jsdom applies no CSS
 * and sees both, so nav queries name which one they mean.
 */
const sidebarNav = () => within(screen.getByRole('complementary'));
const goTo = (label: RegExp) => sidebarNav().getByRole('link', { name: label });

beforeEach(() => {
  localStorage.clear();
  document.title = '';
  api = stubApi({
    'GET /fx/rates': fxRates(),
    'GET /fx/rates/stored': { data: [] },
  });
});

afterEach(() => {
  api.restore();
  localStorage.clear();
  for (const failure of getFailures()) dismissFailure(failure.id);
});

describe('getting to the content', () => {
  /** Otherwise reaching the page by keyboard means tabbing past eight nav links, every time. */
  it('offers a skip link as the very first stop', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.tab();

    expect(document.activeElement).toHaveTextContent('Skip to content');
    expect(document.activeElement).toHaveAttribute('href', '#main');
  });

  /**
   * jsdom does not implement fragment navigation, so activating the link cannot be made to
   * move focus here — that was checked in a real browser. What *is* testable is the pair of
   * things the browser needs: a matching target that is programmatically focusable.
   * Without `tabIndex`, the page scrolls but focus stays put and the next Tab goes back to
   * the navigation, which makes the link achieve nothing.
   */
  it('points at a target that can actually take focus', async () => {
    render(<Harness />);

    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main');
    expect(main).toHaveAttribute('tabindex', '-1');
    expect(screen.getByText('Skip to content')).toHaveAttribute('href', `#${main.id}`);
  });

  it('keeps the skip link out of the way until it is focused', async () => {
    render(<Harness />);

    expect(screen.getByText('Skip to content')).toHaveClass('sr-only');
  });
});

describe('announcing where you are', () => {
  it('names the screen in the tab title', async () => {
    render(<Harness />);

    await waitFor(() => expect(document.title).toBe('Dashboard · Ledger EG'));
  });

  it('updates the title on navigation', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await waitFor(() => expect(document.title).toBe('Dashboard · Ledger EG'));

    await user.click(goTo(/Transactions/));

    await waitFor(() => expect(document.title).toBe('Transactions · Ledger EG'));
  });

  /**
   * A client-side navigation fires no page load, so without this a screen reader is given
   * nothing to say when you activate a nav link.
   */
  it('announces the destination into a live region', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);

    const region = container.querySelector('[aria-live="polite"]');
    expect(region).not.toBeNull();

    // Silent on arrival: the page load already announced itself, and repeating it would be
    // noise before anyone has done anything. The announcement is scheduled 100ms out, so
    // this has to outlast that timer to prove nothing was said rather than just not yet.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(region).toHaveTextContent('');

    await user.click(goTo(/Transactions/));

    await waitFor(() => expect(region).toHaveTextContent('Transactions page'));
  });

  it('says "not found" for an address that matches no screen', async () => {
    render(<Harness initialUrl="/nowhere" />);

    // The route does not resolve, but the title still says something truthful.
    await waitFor(() => expect(document.title).toBe('Not found · Ledger EG'));
  });
});

describe('the sidebar', () => {
  it('starts expanded and names its own state', async () => {
    render(<Harness />);

    const toggle = await screen.findByRole('button', { name: 'Collapse sidebar' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('collapses, and says so', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Collapse sidebar' }));

    const toggle = screen.getByRole('button', { name: 'Expand sidebar' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('remembers the choice across a reload', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Collapse sidebar' }));
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe('true');
    unmount();

    render(<Harness />);
    expect(await screen.findByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
  });

  /** Collapsed to icons, the labels still have to reach a screen reader. */
  it('keeps every destination named when collapsed', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(await screen.findByRole('button', { name: 'Collapse sidebar' }));

    for (const label of ['Dashboard', 'Transactions', 'Accounts', 'Settings']) {
      expect(goTo(new RegExp(label))).toBeInTheDocument();
    }
  });

  it('marks the current page for a screen reader, not only by colour', async () => {
    render(<Harness />);

    expect(goTo(/Dashboard.*current page/)).toBeInTheDocument();
  });

  /**
   * Collapsed, each link becomes a `TooltipTrigger asChild`, and Radix's `Slot` merges
   * `className` by joining strings. Handed `NavLink`'s render-prop form it stringified the
   * function, so the class attribute became `({ isActive }) => cn(\n  "flex items-center …`
   * and the browser kept whichever tokens inside it happened to be valid class names —
   * `items-center` survived, `"flex` did not. Collapsing quietly threw the layout away.
   */
  it('keeps a real class list on the links when collapsed', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(await screen.findByRole('button', { name: 'Collapse sidebar' }));

    const link = goTo(/Dashboard/);
    expect(link.className).not.toContain('=>');
    expect(link.className).toContain('justify-center');
  });

  /** Still marked as current when collapsed — the render-prop `isActive` went with it. */
  it('still marks the current page when collapsed', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(await screen.findByRole('button', { name: 'Collapse sidebar' }));

    expect(goTo(/Dashboard.*current page/)).toBeInTheDocument();
  });
});

describe('the mobile bar', () => {
  it('puts adding a transaction under the thumb, as an action rather than a destination', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Add a transaction' }));

    // One way in, the same URL the `n` shortcut and the calculator both use.
    expect(await screen.findByText('Transactions screen')).toBeInTheDocument();
  });

  it('puts everything that does not fit behind More, rather than squeezing it in', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: /More/ }));

    expect(await screen.findByText('Everything else')).toBeInTheDocument();
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByRole('link', { name: /Savings/ })).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: /Budgets/ })).toBeInTheDocument();
  });
});

describe('the failure region', () => {
  it('is mounted before anything is reported, so an insertion counts as a change', async () => {
    const { container } = render(<Harness />);

    expect(container.querySelector('[aria-live="assertive"]')).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a failure reported from anywhere in the app', async () => {
    render(<Harness />);

    reportProblem('Something could not be saved.');

    expect(await screen.findByRole('alert')).toHaveTextContent('Something could not be saved.');
  });
});

describe('the frame itself', () => {
  it('gives the page one main landmark and one banner', async () => {
    render(<Harness />);

    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('keeps the shell mounted across navigation rather than remounting it', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const main = screen.getByRole('main');
    await user.click(goTo(/Transactions/));

    await screen.findByText('Transactions screen');
    // Same node: the sidebar, topbar and FX strip persist rather than being rebuilt.
    expect(screen.getByRole('main')).toBe(main);
  });

  it('carries the FX strip, so the rates are visible from every screen', async () => {
    render(<Harness />);

    expect(
      await screen.findByLabelText('Exchange rates against the Egyptian pound'),
    ).toBeInTheDocument();
  });
});
