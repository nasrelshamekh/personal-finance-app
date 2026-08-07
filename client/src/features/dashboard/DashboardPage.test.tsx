import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { DashboardDto } from '@ledger/shared';
import { stubApi, type ApiStub } from '@/test/http';
import { dashboard, transaction } from '@/test/fixtures';
import { DashboardPage } from './DashboardPage';

/**
 * The dashboard reads rather than writes, so these tests are about what it *says* — that
 * the month it asks for is the month you chose, that a figure is shown with its sign and
 * direction rather than by colour alone (SPEC §10), and that the panel naming your biggest
 * outgoing links somewhere you can act on it.
 */

function Harness() {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );

  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DashboardPage />
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
    expect(screen.queryByText('Net worth')).toBeNull();
  });

  it('counts a non-zero net worth as something, even with no transactions', async () => {
    arrange(
      dashboard({
        netWorth: {
          egp: '7386.0000',
          previousEgp: '0.0000',
          deltaEgp: '7386.0000',
          deltaPct: null,
        },
      }),
    );
    render(<Harness />);

    expect(await screen.findByText('Net worth')).toBeInTheDocument();
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
    netWorth: {
      egp: '5436.1600',
      previousEgp: '4000.0000',
      deltaEgp: '1436.1600',
      deltaPct: '35.9040',
    },
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
      },
      {
        id: 'acc-usd',
        name: 'Bank (USD)',
        currency: 'USD',
        color: '#4a6f9f',
        icon: 'landmark',
        balance: '-38.1400',
        balanceEgp: '-1949.8400',
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
        netWorth: { egp: '100.0000', previousEgp: '0.0000', deltaEgp: '100.0000', deltaPct: null },
      }),
    );
    render(<Harness />);

    await screen.findByText('Net worth');
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
});

describe('where it went', () => {
  const spending = dashboard({
    netWorth: { egp: '100.0000', previousEgp: '0.0000', deltaEgp: '100.0000', deltaPct: null },
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
        netWorth: { egp: '10.0000', previousEgp: '0.0000', deltaEgp: '10.0000', deltaPct: null },
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
        netWorth: { egp: '10.0000', previousEgp: '0.0000', deltaEgp: '10.0000', deltaPct: null },
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
    netWorth: { egp: '10.0000', previousEgp: '0.0000', deltaEgp: '10.0000', deltaPct: null },
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

    await screen.findByText('Net worth');
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
