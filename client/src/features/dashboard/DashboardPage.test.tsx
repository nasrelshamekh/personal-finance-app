import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { DashboardDto } from '@ledger/shared';
import { stubApi, type ApiStub } from '@/test/http';
import { account, dashboard, netWorth, transaction } from '@/test/fixtures';
import { DashboardPage } from './DashboardPage';

/**
 * The dashboard reads rather than writes, so these tests are about what it *says* — that
 * the month it asks for is the month you chose, that a figure is shown with its sign and
 * direction rather than by colour alone (SPEC §10), and that the panel naming your biggest
 * outgoing links somewhere you can act on it.
 */

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="search">{location.search}</output>;
}

function Harness({ initialUrl = '/' }: { initialUrl?: string }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );

  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialUrl]}>
        <DashboardPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

let api: ApiStub;

function arrange(data: DashboardDto) {
  api?.restore();
  api = stubApi({ 'GET /dashboard': data });
}

const monthsAsked = () => api.requestsFor('GET /dashboard').map((r) => r.query.get('month'));

/** The current month, in the same UTC terms the page uses. */
function thisMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function previousMonth(): string {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

afterEach(() => {
  api.restore();
});

describe('an empty ledger', () => {
  it('says what to do rather than showing a wall of zeroes', async () => {
    arrange(dashboard());
    render(<Harness />);

    expect(await screen.findByText('Nothing to summarise yet')).toBeInTheDocument();
    expect(screen.queryByText('In your accounts')).toBeNull();
  });

  it('counts a non-zero net worth as something, even with no transactions', async () => {
    arrange(
      dashboard({
        netWorth: netWorth({
          egp: '7386.0000',
          previousEgp: '0.0000',
          deltaEgp: '7386.0000',
          deltaPct: null,
        }),
      }),
    );
    render(<Harness />);

    expect(await screen.findByText('In your accounts')).toBeInTheDocument();
    expect(screen.queryByText('Nothing to summarise yet')).toBeNull();
  });
});

describe('the month picker', () => {
  it('asks for the current month first', async () => {
    arrange(dashboard());
    render(<Harness />);

    await waitFor(() => expect(monthsAsked()).toContain(thisMonth()));
  });

  it('steps back a month and asks again', async () => {
    const user = userEvent.setup();
    arrange(dashboard());
    render(<Harness />);
    await waitFor(() => expect(monthsAsked().length).toBeGreaterThan(0));

    await user.click(screen.getByRole('button', { name: 'Previous month' }));

    await waitFor(() => expect(monthsAsked()).toContain(previousMonth()));
  });

  it('will not step into the future', async () => {
    arrange(dashboard());
    render(<Harness />);
    await screen.findByRole('button', { name: 'Next month' });

    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();
  });

  it('re-enables forward once you have gone back', async () => {
    const user = userEvent.setup();
    arrange(dashboard());
    render(<Harness />);
    await screen.findByRole('button', { name: 'Previous month' });

    await user.click(screen.getByRole('button', { name: 'Previous month' }));

    expect(screen.getByRole('button', { name: 'Next month' })).toBeEnabled();
  });
});

describe('the figures', () => {
  const withMoney = dashboard({
    netWorth: netWorth({
      egp: '5436.1600',
      previousEgp: '4000.0000',
      deltaEgp: '1436.1600',
      deltaPct: '35.9040',
    }),
    totals: {
      incomeEgp: '14860.0000',
      expensesEgp: '9423.8400',
      netEgp: '5436.1600',
      conversionCostEgp: '0.0000',
    },
    accounts: [
      {
        id: 'acc-egp',
        name: 'Cash (EGP)',
        currency: 'EGP',
        color: '#2f8f5b',
        icon: 'wallet',
        balance: '7386.0000',
        balanceEgp: '7386.0000',
        isArchived: false,
      },
      {
        id: 'acc-usd',
        name: 'Bank (USD)',
        currency: 'USD',
        color: '#4a6f9f',
        icon: 'landmark',
        balance: '-38.1400',
        balanceEgp: '-1949.8400',
        isArchived: false,
      },
    ],
  });

  it('shows the month percentage beside the change', async () => {
    arrange(withMoney);
    render(<Harness />);

    expect(await screen.findByText('(+35.9%)')).toBeInTheDocument();
  });

  it('says nothing about a percentage when there is no baseline to compare against', async () => {
    arrange(
      dashboard({
        netWorth: netWorth({
          egp: '100.0000',
          previousEgp: '0.0000',
          deltaEgp: '100.0000',
          deltaPct: null,
        }),
      }),
    );
    render(<Harness />);

    await screen.findByText('In your accounts');
    expect(screen.queryByText(/%\)/)).toBeNull();
  });

  it('explains a zero conversion cost instead of leaving it bare', async () => {
    arrange(withMoney);
    render(<Harness />);

    expect(await screen.findByText('No cross-currency transfers this month.')).toBeInTheDocument();
  });

  it('names what a non-zero conversion cost is', async () => {
    arrange(
      dashboard({
        totals: { ...withMoney.totals, conversionCostEgp: '120.5000' },
        accounts: withMoney.accounts,
      }),
    );
    render(<Harness />);

    expect(
      await screen.findByText('The gap between what left and what arrived.'),
    ).toBeInTheDocument();
  });

  it('shows a foreign balance in its own currency with the pound figure underneath', async () => {
    arrange(withMoney);
    render(<Harness />);

    await screen.findByText('Bank (USD)');
    // The native figure is the hero; EGP is the secondary line (SPEC §9).
    expect(screen.getByText('-1,949.84 EGP')).toBeInTheDocument();
  });

  /**
   * Same claim the accounts page makes per card, made once for the panel: every pound
   * figure here is a sum of historical conversions, not what the balance is worth today.
   * Repeating it down a list of five would be noise.
   */
  it('says the pound figures are historical, once for the panel', async () => {
    arrange(withMoney);
    render(<Harness />);

    await screen.findByText('Bank (USD)');
    expect(
      screen.getByText('Pound figures are at the rates when each row was recorded.'),
    ).toBeInTheDocument();
  });

  it('says nothing about rates when every account is already in pounds', async () => {
    arrange(
      dashboard({
        netWorth: netWorth({ egp: '7386.0000', deltaEgp: '7386.0000' }),
        accounts: [
          {
            ...account({ id: 'acc-egp', name: 'Cash (EGP)' }),
            balance: '7386.0000',
            balanceEgp: '7386.0000',
          },
        ],
      }),
    );
    render(<Harness />);

    await screen.findByText('Cash (EGP)');
    expect(screen.queryByText(/at the rates when each row was recorded/)).toBeNull();
  });

  it('totals every account in pounds', async () => {
    arrange(withMoney);
    render(<Harness />);

    // "Accounts" is both a stat label and the panel heading, so the hint identifies the card.
    const hint = await screen.findByText('Across every currency, in pounds.');
    const card = hint.closest('article');
    expect(card).not.toBeNull();

    // 7386.00 + (−1949.84), summed across currencies from the frozen EGP figures.
    expect(within(card as HTMLElement).getByText(/5,436\.16/)).toBeInTheDocument();
  });

  /**
   * The total is a sum of money, so it is a `Decimal` sum. It used to be
   * `reduce((sum, a) => sum + Number.parseFloat(a.balanceEgp), 0)` — floating point, on a
   * screen whose entire promise is not lying about money (SPEC §4).
   *
   * The figures below are deliberately past 2^53, because that is where the difference
   * survives rounding to four places: at everyday balances a float is wrong by about a
   * hundred-billionth of a pound and no assertion could ever see it. The rule is what is
   * being pinned, not the magnitude.
   */
  it('adds the balances as decimals, not as floats', async () => {
    arrange(
      dashboard({
        netWorth: netWorth({
          egp: '9007199254740992.4500',
          previousEgp: '0.0000',
          deltaEgp: '9007199254740992.4500',
          deltaPct: null,
        }),
        accounts: [
          { ...account({ id: 'a', name: 'One' }), balanceEgp: '9007199254740992.0000' },
          { ...account({ id: 'b', name: 'Two' }), balanceEgp: '0.4500' },
        ],
      }),
    );
    render(<Harness />);

    const hint = await screen.findByText('Across every currency, in pounds.');
    const card = hint.closest('article') as HTMLElement;

    expect(within(card).getByText('9,007,199,254,740,992.45')).toBeInTheDocument();
  });
});

/**
 * What the accounts hold and what you are worth are different claims. The card used to
 * report the first and call it net worth, so a ledger with 5,436 in the bank and a 4,000
 * debt read as 5,436. Both figures now, because collapsing them hides one of the answers.
 */
describe('after debts', () => {
  const owing = dashboard({
    netWorth: netWorth({
      egp: '5436.0000',
      previousEgp: '5436.0000',
      deltaEgp: '0.0000',
      owedByYouEgp: '4000.0000',
      afterDebtsEgp: '1436.0000',
    }),
  });

  it('shows the accounts figure under a label that says what it is', async () => {
    arrange(owing);
    render(<Harness />);

    expect(await screen.findByText('In your accounts')).toBeInTheDocument();
    expect(screen.queryByText('Net worth')).toBeNull();
  });

  it('shows the debt-adjusted figure beside it, and what was taken off', async () => {
    arrange(owing);
    render(<Harness />);

    expect(await screen.findByText('After debts')).toBeInTheDocument();
    expect(screen.getByText('1,436.00')).toBeInTheDocument();
    expect(screen.getByText(/You owe/)).toBeInTheDocument();
    expect(screen.getByText('4,000.00')).toBeInTheDocument();
  });

  it('counts what is owed to you as well', async () => {
    arrange(
      dashboard({
        netWorth: netWorth({
          egp: '1000.0000',
          owedToYouEgp: '250.0000',
          afterDebtsEgp: '1250.0000',
        }),
      }),
    );
    render(<Harness />);

    expect(await screen.findByText(/Owed to you/)).toBeInTheDocument();
    expect(screen.getByText('1,250.00')).toBeInTheDocument();
  });

  /** A second figure that always equals the first is noise, not information. */
  it('says nothing about debts when there are none', async () => {
    arrange(
      dashboard({
        netWorth: netWorth({ egp: '5436.0000', deltaEgp: '5436.0000' }),
      }),
    );
    render(<Harness />);

    await screen.findByText('In your accounts');
    expect(screen.queryByText('After debts')).toBeNull();
  });

  /**
   * A debt lives in its own currency (D4), so converting one puts today's rate inside an
   * otherwise frozen figure. Said out loud rather than quietly folded in.
   */
  it('admits when a foreign debt was converted at today’s rate', async () => {
    arrange(
      dashboard({
        netWorth: netWorth({
          egp: '10000.0000',
          owedByYouEgp: '5000.0000',
          afterDebtsEgp: '5000.0000',
          debtsConverted: true,
        }),
      }),
    );
    render(<Harness />);

    expect(await screen.findByText(/converted at today’s rate/)).toBeInTheDocument();
  });

  it('claims nothing about conversion when every debt is already in pounds', async () => {
    arrange(owing);
    render(<Harness />);

    await screen.findByText('After debts');
    expect(screen.queryByText(/converted at today’s rate/)).toBeNull();
  });
});

describe('an archived account that still holds money', () => {
  /** Net worth counts it either way, so hiding it would stop the panel adding up. */
  it('is listed, and marked as archived', async () => {
    arrange(
      dashboard({
        netWorth: netWorth({ egp: '900.0000', deltaEgp: '900.0000' }),
        accounts: [
          {
            ...account({ id: 'acc-old', name: 'Old wallet' }),
            balance: '900.0000',
            balanceEgp: '900.0000',
            isArchived: true,
          },
        ],
      }),
    );
    render(<Harness />);

    expect(await screen.findByText('Old wallet')).toBeInTheDocument();
    expect(screen.getByText('Archived')).toBeInTheDocument();
  });

  it('marks nothing when the account is live', async () => {
    arrange(
      dashboard({
        netWorth: netWorth({ egp: '900.0000', deltaEgp: '900.0000' }),
        accounts: [
          {
            ...account({ id: 'acc-cash', name: 'Cash' }),
            balance: '900.0000',
            balanceEgp: '900.0000',
            isArchived: false,
          },
        ],
      }),
    );
    render(<Harness />);

    await screen.findByText('Cash');
    expect(screen.queryByText('Archived')).toBeNull();
  });
});

describe('where it went', () => {
  const spending = dashboard({
    netWorth: netWorth({
      egp: '100.0000',
      previousEgp: '0.0000',
      deltaEgp: '100.0000',
      deltaPct: null,
    }),
    spendByCategory: [
      {
        categoryId: null,
        name: 'Uncategorised',
        color: '#6f6f6f',
        spentEgp: '9323.8400',
        sharePct: '98.9384',
      },
      {
        categoryId: 'cat-transport',
        name: 'Transport',
        color: '#4a6f9f',
        spentEgp: '100.0000',
        sharePct: '1.0616',
      },
    ],
  });

  it('links each slice into the transactions behind it', async () => {
    arrange(spending);
    render(<Harness />);

    const transport = await screen.findByRole('link', { name: /Transport/ });
    const href = transport.getAttribute('href') ?? '';

    expect(href).toContain('/transactions');
    expect(href).toContain('categoryId=cat-transport');
    expect(href).toContain('type=EXPENSE');
  });

  /** Uncategorised has no id, so it needs the sentinel to be reachable at all. */
  it('links the uncategorised bucket through the `none` sentinel', async () => {
    arrange(spending);
    render(<Harness />);

    const uncategorised = await screen.findByRole('link', { name: /Uncategorised/ });

    expect(uncategorised.getAttribute('href')).toContain('categoryId=none');
  });

  it('scopes the link to the month being looked at', async () => {
    arrange(spending);
    render(<Harness />);

    const link = await screen.findByRole('link', { name: /Transport/ });
    const href = link.getAttribute('href') ?? '';

    expect(href).toContain(`from=${thisMonth()}-01`);
    expect(href).toContain('to=');
  });

  it('says so plainly when nothing was spent', async () => {
    arrange(
      dashboard({
        netWorth: netWorth({
          egp: '10.0000',
          previousEgp: '0.0000',
          deltaEgp: '10.0000',
          deltaPct: null,
        }),
      }),
    );
    render(<Harness />);

    expect(await screen.findByText('Nothing spent this month.')).toBeInTheDocument();
  });
});

describe('the recent list', () => {
  it('labels a transfer as a transfer rather than as a category', async () => {
    arrange(
      dashboard({
        netWorth: netWorth({
          egp: '10.0000',
          previousEgp: '0.0000',
          deltaEgp: '10.0000',
          deltaPct: null,
        }),
        recentTransactions: [
          transaction({ id: 'tx-1', type: 'TRANSFER', amount: '-500.0000' }),
          transaction({ id: 'tx-2', type: 'EXPENSE', amount: '-100.0000' }),
        ],
      }),
    );
    render(<Harness />);

    const recent = (await screen.findByText('Recent')).closest('article');
    expect(recent).not.toBeNull();
    expect(within(recent as HTMLElement).getByText('Transfer')).toBeInTheDocument();
    // An expense with no category is named, not left blank.
    expect(within(recent as HTMLElement).getByText('Uncategorised')).toBeInTheDocument();
  });
});

describe('debts and savings', () => {
  const base = dashboard({
    netWorth: netWorth({
      egp: '10.0000',
      previousEgp: '0.0000',
      deltaEgp: '10.0000',
      deltaPct: null,
    }),
  });

  it('counts an overdue debt in days rather than showing a negative', async () => {
    arrange({
      ...base,
      debtsDueSoon: [
        {
          id: 'debt-1',
          counterparty: 'Omar',
          direction: 'I_OWE',
          currency: 'EGP',
          remaining: '1500.0000',
          dueDate: '2026-08-01T00:00:00.000Z',
          daysUntilDue: -6,
        },
      ],
    });
    render(<Harness />);

    expect(await screen.findByText('6 days overdue')).toBeInTheDocument();
  });

  it('counts one still to come forwards', async () => {
    arrange({
      ...base,
      debtsDueSoon: [
        {
          id: 'debt-1',
          counterparty: 'Omar',
          direction: 'I_OWE',
          currency: 'EGP',
          remaining: '1500.0000',
          dueDate: '2026-09-01T00:00:00.000Z',
          daysUntilDue: 12,
        },
      ],
    });
    render(<Harness />);

    expect(await screen.findByText('in 12 days')).toBeInTheDocument();
  });

  it('hides both panels when there is nothing due and nothing saved', async () => {
    arrange(base);
    render(<Harness />);

    await screen.findByText('In your accounts');
    expect(screen.queryByText('Due in the next 30 days')).toBeNull();
    expect(screen.queryByText('Savings')).toBeNull();
  });

  it('caps a savings bar at full rather than overflowing it', async () => {
    arrange({
      ...base,
      savingsGoals: [
        {
          id: 'goal-1',
          name: 'New laptop',
          currency: 'EGP',
          color: '#2f8f5b',
          saved: '90000.0000',
          target: '60000.0000',
          progressPct: '150.0000',
          deadline: null,
        },
      ],
    });
    const { container } = render(<Harness />);

    expect(await screen.findByText('New laptop')).toBeInTheDocument();
    expect(screen.getByText('150%')).toBeInTheDocument();

    const bar = container.querySelector('.bg-primary.h-full, .h-full.rounded-full.bg-primary');
    expect((bar as HTMLElement | null)?.style.width).toBe('100%');
  });
});

/**
 * The month is state that changes what the whole screen says, so it belongs in the URL —
 * the same rule the transaction filters follow. Held in `useState` it was invisible from
 * outside: `?month=2026-07` did nothing, a reload snapped back to today, and following a
 * category link out and pressing Back returned to the current month rather than the one
 * being read.
 */
describe('the month in the address', () => {
  it('opens on the month it was asked for', async () => {
    arrange(dashboard({ month: '2026-03' }));
    render(<Harness initialUrl="/?month=2026-03" />);

    await waitFor(() => expect(monthsAsked()).toContain('2026-03'));
    expect(screen.getByText('March 2026')).toBeInTheDocument();
  });

  it('writes the month back, so the screen can be linked to and reloaded', async () => {
    const user = userEvent.setup();
    arrange(dashboard());
    render(<Harness />);

    await screen.findByText(/\d{4}/);
    await user.click(screen.getByRole('button', { name: 'Previous month' }));

    await waitFor(() =>
      expect(screen.getByTestId('search')).toHaveTextContent(`month=${previousMonth()}`),
    );
  });

  /**
   * The current month is the default *and* a moving one. Pinning it into the address would
   * make a bookmarked dashboard quietly show the wrong month from the first of next month.
   */
  it('leaves the current month out of the address rather than pinning it', async () => {
    const user = userEvent.setup();
    arrange(dashboard());
    render(<Harness />);

    await screen.findByText(/\d{4}/);
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent('month='));

    await user.click(screen.getByRole('button', { name: 'Next month' }));

    await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent(''));
    expect(monthsAsked().at(-1)).toBe(thisMonth());
  });

  /** A stale or hand-typed month should not be forwarded to the API to 400 on. */
  it('ignores a month that is not a month', async () => {
    arrange(dashboard());
    render(<Harness initialUrl="/?month=last-tuesday" />);

    await waitFor(() => expect(monthsAsked()).toEqual([thisMonth()]));
  });
});

/**
 * A month with nothing in it is two different situations, and only one of them is a
 * to-do list. Once the payload was scoped to the month, a past month started returning
 * no accounts and no rows — and the ledger-is-empty copy would have told someone with two
 * accounts to go and add an account.
 */
describe('a month with nothing in it', () => {
  it('names the month rather than claiming the ledger is empty', async () => {
    arrange(dashboard({ month: previousMonth() }));
    render(<Harness initialUrl={`/?month=${previousMonth()}`} />);

    expect(await screen.findByText(/^Nothing in /)).toBeInTheDocument();
    expect(screen.queryByText('Nothing to summarise yet')).toBeNull();
  });

  it('still says how to start when it is the current month and there is nothing', async () => {
    arrange(dashboard());
    render(<Harness />);

    expect(await screen.findByText('Nothing to summarise yet')).toBeInTheDocument();
  });
});

describe('the recent panel', () => {
  it('scopes its link out to the month being read', async () => {
    arrange(
      dashboard({
        month: '2026-03',
        netWorth: netWorth({
          egp: '100.0000',
          previousEgp: '0.0000',
          deltaEgp: '100.0000',
          deltaPct: null,
        }),
      }),
    );
    render(<Harness initialUrl="/?month=2026-03" />);

    const link = await screen.findByRole('link', { name: 'All transactions' });
    expect(link).toHaveAttribute('href', '/transactions?from=2026-03-01&to=2026-03-31');
  });

  it('says the month is empty rather than that nothing was ever recorded', async () => {
    arrange(
      dashboard({
        netWorth: netWorth({
          egp: '100.0000',
          previousEgp: '0.0000',
          deltaEgp: '100.0000',
          deltaPct: null,
        }),
        recentTransactions: [],
      }),
    );
    render(<Harness />);

    expect(await screen.findByText('Nothing recorded this month.')).toBeInTheDocument();
  });
});

describe('when the API is down', () => {
  it('says which thing is not running, not just that something failed', async () => {
    api?.restore();
    api = stubApi({
      'GET /dashboard': { status: 500, body: { error: { code: 'X', message: 'nope' } } },
    });
    render(<Harness />);

    expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument();
    expect(screen.getByText('npm run dev')).toBeInTheDocument();
  });
});
