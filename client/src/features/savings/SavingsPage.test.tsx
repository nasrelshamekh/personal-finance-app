import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SavingsGoalDto } from '@ledger/shared';
import { stubApi, type ApiStub } from '@/test/http';
import { account, contribution, savingsGoal } from '@/test/fixtures';
import { dismissFailure, getFailures } from '@/lib/action-feedback';
import { SavingsPage } from './SavingsPage';

/**
 * Progress lives in the goal's own currency (D4b), for the same reason debts do: dividing
 * historical-rate contributions by a current-rate target would produce a percentage that
 * moves when the exchange rate does.
 *
 * The other thing worth pinning here is the "you need X a month" line, which has four
 * genuinely different states — reached, no deadline, due this month, and on track — and
 * each says something different rather than falling back to a dash.
 */

function Harness() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <SavingsPage />
    </QueryClientProvider>
  );
}

const CASH = account({ id: 'acc-egp', name: 'Cash (EGP)', currency: 'EGP' });
const BANK = account({ id: 'acc-usd', name: 'Bank (USD)', currency: 'USD' });

let api: ApiStub;

function arrange(goals: SavingsGoalDto[], accounts = [CASH, BANK]) {
  api?.restore();
  api = stubApi({
    'GET /savings-goals': { data: goals },
    'GET /accounts': { data: accounts },
    'POST /savings-goals/goal-1/contributions': goals[0] ?? {},
    'DELETE /savings-goals/goal-1': { id: 'goal-1' },
  });
}

const contributionBody = () => api.requestsFor('POST /savings-goals/goal-1/contributions')[0]?.body;

const LAPTOP = savingsGoal({
  id: 'goal-1',
  name: 'New laptop',
  targetAmount: '60000.0000',
  saved: '15000.0000',
  remaining: '45000.0000',
  progressPct: '25.0000',
});

beforeEach(() => {
  arrange([]);
});

afterEach(() => {
  api.restore();
  for (const failure of getFailures()) dismissFailure(failure.id);
  vi.restoreAllMocks();
});

describe('with no goals', () => {
  it('explains what a goal is for rather than showing an empty grid', async () => {
    arrange([]);
    render(<Harness />);

    expect(await screen.findByText('No goals yet')).toBeInTheDocument();
    expect(screen.getByText(/works out what you need to put aside each month/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New goal' })).toBeInTheDocument();
  });
});

describe('what a card says', () => {
  it('shows progress against the target in the goal currency', async () => {
    arrange([LAPTOP]);
    render(<Harness />);

    await screen.findByText('New laptop');
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.getByText('15,000.00 of 60,000.00 EGP')).toBeInTheDocument();
  });

  it('leads with what is still to go, not with what is saved', async () => {
    arrange([LAPTOP]);
    render(<Harness />);

    expect(await screen.findByText('Still to go')).toBeInTheDocument();
    expect(screen.getByText(/45,000\.00/)).toBeInTheDocument();
  });

  it('keeps a foreign goal in its own currency', async () => {
    arrange([
      savingsGoal({
        id: 'goal-1',
        name: 'Trip',
        currency: 'USD',
        targetAmount: '2000.0000',
        saved: '500.0000',
        remaining: '1500.0000',
        progressPct: '25.0000',
      }),
    ]);
    render(<Harness />);

    await screen.findByText('Trip');
    // 25% of a dollar target, from dollar contributions — never via pounds.
    expect(screen.getByText('500.00 of 2,000.00 USD')).toBeInTheDocument();
  });
});

describe('the monthly figure', () => {
  it('says the target is reached rather than showing a zero', async () => {
    arrange([
      savingsGoal({
        id: 'goal-1',
        name: 'New laptop',
        saved: '60000.0000',
        remaining: '0.0000',
        progressPct: '100.0000',
        isComplete: true,
        monthlyNeeded: '0.0000',
      }),
    ]);
    render(<Harness />);

    expect(await screen.findByText('Target reached')).toBeInTheDocument();
  });

  it('explains why there is no figure when there is no deadline', async () => {
    arrange([LAPTOP]);
    render(<Harness />);

    expect(
      await screen.findByText('No deadline, so there is no monthly figure to hit.'),
    ).toBeInTheDocument();
  });

  it('says the whole balance is due when the deadline is this month', async () => {
    arrange([
      savingsGoal({
        ...LAPTOP,
        deadline: '2026-08-31T00:00:00.000Z',
        monthlyNeeded: '45000.0000',
        monthsRemaining: 0,
      }),
    ]);
    render(<Harness />);

    // The same figure is also the "still to go" total, so assert within the line itself.
    const line = await screen.findByText(/Due this month/);
    expect(line).toHaveTextContent('Due this month — the whole 45,000.00 EGP is outstanding.');
  });

  it('gives the per-month figure and how many months are left', async () => {
    arrange([
      savingsGoal({
        ...LAPTOP,
        deadline: '2026-11-30T00:00:00.000Z',
        monthlyNeeded: '15000.0000',
        monthsRemaining: 3,
      }),
    ]);
    render(<Harness />);

    expect(await screen.findByText(/a month for 3 more months/)).toBeInTheDocument();
  });

  it('says "month" in the singular for the last one', async () => {
    arrange([
      savingsGoal({
        ...LAPTOP,
        deadline: '2026-09-30T00:00:00.000Z',
        monthlyNeeded: '45000.0000',
        monthsRemaining: 1,
      }),
    ]);
    render(<Harness />);

    expect(await screen.findByText(/a month for 1 more month$/)).toBeInTheDocument();
  });
});

describe('contribution history', () => {
  const withHistory = savingsGoal({
    ...LAPTOP,
    contributions: [
      contribution({ id: 'con-1', amount: '10000.0000' }),
      // Contributed in dollars against a pound goal.
      contribution({
        id: 'con-2',
        amount: '100.0000',
        currency: 'USD',
        amountInGoalCurrency: '5000.0000',
        transactionId: 'tx-4',
      }),
    ],
  });

  it('stays collapsed until asked for', async () => {
    arrange([withHistory]);
    render(<Harness />);

    const toggle = await screen.findByRole('button', { name: '2 contributions' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows a foreign contribution in both currencies', async () => {
    const user = userEvent.setup();
    arrange([withHistory]);
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: '2 contributions' }));

    // $100 advanced the goal by the frozen 5,000 EGP, not by today's rate.
    expect(screen.getByText(/5,000\.00 EGP/)).toBeInTheDocument();
    expect(screen.getByText('linked')).toBeInTheDocument();
  });

  it('says "contribution" in the singular for one', async () => {
    arrange([savingsGoal({ ...LAPTOP, contributions: [contribution({ id: 'con-1' })] })]);
    render(<Harness />);

    expect(await screen.findByRole('button', { name: '1 contribution' })).toBeInTheDocument();
  });
});

describe('putting money aside', () => {
  it('prefills nothing when there is no monthly figure to suggest', async () => {
    const user = userEvent.setup();
    arrange([LAPTOP]);
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: /Put money aside/ }));

    expect(await screen.findByLabelText(/^Amount/)).toHaveValue('');
  });

  it('prefills what you would need this month when there is a deadline', async () => {
    const user = userEvent.setup();
    arrange([
      savingsGoal({
        ...LAPTOP,
        deadline: '2026-11-30T00:00:00.000Z',
        monthlyNeeded: '15000.0000',
        monthsRemaining: 3,
      }),
    ]);
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: /Put money aside/ }));

    expect(await screen.findByLabelText(/^Amount/)).toHaveValue('15000');
  });

  it('sends the amount, the date and the account it came from', async () => {
    const user = userEvent.setup();
    arrange([LAPTOP]);
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: /Put money aside/ }));
    await user.type(await screen.findByLabelText(/^Amount/), '2500');
    await user.click(screen.getByRole('button', { name: 'Add contribution' }));

    await waitFor(() => expect(contributionBody()).toBeDefined());
    expect(contributionBody()).toEqual({
      amount: '2500',
      date: expect.any(String),
      // Defaults to an account in the goal's currency.
      accountId: CASH.id,
    });
  });

  it('sends a null account when the money is not coming out of one', async () => {
    const user = userEvent.setup();
    arrange([LAPTOP]);
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: /Put money aside/ }));
    await user.type(await screen.findByLabelText(/^Amount/), '2500');

    await user.click(screen.getByLabelText('Taken from'));
    await user.click(await screen.findByRole('option', { name: /Don't record a transaction/ }));
    // Let the Select settle before submitting; asserting the new value is what waits.
    await waitFor(() =>
      expect(screen.getByLabelText('Taken from')).toHaveTextContent("Don't record a transaction"),
    );

    await user.click(screen.getByRole('button', { name: 'Add contribution' }));

    await waitFor(() => expect(contributionBody()).toBeDefined());
    expect(contributionBody()).toMatchObject({ accountId: null });
  });
});

describe('deleting a goal', () => {
  it('asks first, because the contributions go with it', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    arrange([LAPTOP]);
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Delete New laptop' }));

    expect(confirm).toHaveBeenCalledWith('Delete New laptop and its contributions?');
    expect(api.requestsFor('DELETE /savings-goals/goal-1')).toHaveLength(0);
  });

  it('names the goal when the delete fails', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    arrange([LAPTOP]);
    api.setRoute('DELETE /savings-goals/goal-1', {
      status: 500,
      body: { error: { code: 'X', message: 'Database unavailable.' } },
    });
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Delete New laptop' }));

    await waitFor(() => expect(getFailures()).toHaveLength(1));
    expect(getFailures()[0]).toMatchObject({
      headline: 'New laptop could not be deleted.',
      detail: 'Database unavailable.',
    });
  });
});
