import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AccountDto, SavingsGoalDto } from '@ledger/shared';
import { stubApi, type ApiStub } from '@/test/http';
import { account, savingsGoal } from '@/test/fixtures';
import { ContributionSheet } from './ContributionSheet';

/**
 * Putting money aside.
 *
 * Same shape as the debt payment sheet, and for the same reason: moving money into a goal
 * may or may not be a transaction. Saving into an account you already track is an expense
 * against it; earmarking money that has not moved anywhere is not.
 *
 * The pre-filled amount is what the goal says you need *this month* — the figure the
 * savings page computes from the target and the deadline — so the common contribution is
 * one click.
 */

const CASH = account({ id: 'acc-egp', name: 'Cash', currency: 'EGP' });
const BANK = account({ id: 'acc-usd', name: 'Bank', currency: 'USD' });

const WITH_DEADLINE = savingsGoal({
  id: 'goal-1',
  name: 'Emergency fund',
  currency: 'EGP',
  targetAmount: '60000.0000',
  remaining: '48000.0000',
  monthlyNeeded: '4000.0000',
});

const OPEN_ENDED = savingsGoal({
  id: 'goal-2',
  name: 'Someday',
  currency: 'USD',
  targetAmount: '5000.0000',
  remaining: '5000.0000',
  monthlyNeeded: null,
});

function Harness({ target }: { target: SavingsGoalDto | undefined }) {
  const [open, setOpen] = useState(true);
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <ContributionSheet goal={target} open={open} onOpenChange={setOpen} />
      <output data-testid="open">{String(open)}</output>
    </QueryClientProvider>
  );
}

let api: ApiStub;

function arrange(accounts: AccountDto[] = [CASH, BANK]) {
  api?.restore();
  api = stubApi({
    'GET /accounts': { data: accounts },
    'POST /savings-goals/goal-1/contributions': { status: 201, body: WITH_DEADLINE },
    'POST /savings-goals/goal-2/contributions': { status: 201, body: OPEN_ENDED },
  });
}

/**
 * Waits for the accounts to be *applied*, not merely fetched — so the expected account is
 * named rather than checked for "some text". The trigger reads "Don't record a transaction"
 * from the first paint, which satisfies a loose check while the default is still being
 * chosen; that is a flake that only shows up under full-suite load.
 */
async function ready(expectedAccount = 'Cash') {
  await waitFor(() => expect(api.requestsFor('GET /accounts').length).toBeGreaterThan(0));
  await waitFor(() =>
    expect(screen.getByLabelText('Taken from')).toHaveTextContent(expectedAccount),
  );
}

beforeEach(() => {
  arrange();
});

afterEach(() => {
  api.restore();
});

const added = (id = 'goal-1') =>
  api.requestsFor(`POST /savings-goals/${id}/contributions`)[0]?.body as Record<string, unknown>;

describe('what it opens with', () => {
  it('renders nothing at all without a goal', () => {
    render(<Harness target={undefined} />);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Put money aside')).toBeNull();
  });

  it('names the goal and shows what is still to go', async () => {
    render(<Harness target={WITH_DEADLINE} />);
    await ready();

    expect(screen.getByText('Towards Emergency fund.')).toBeInTheDocument();
    expect(screen.getByText('Still to go')).toBeInTheDocument();
    expect(screen.getByText('48,000.00')).toBeInTheDocument();
  });

  /** The whole point of setting a deadline: the monthly figure is the answer, pre-filled. */
  it('pre-fills what this month needs', async () => {
    render(<Harness target={WITH_DEADLINE} />);
    await ready();

    expect(screen.getByLabelText(/^Amount/)).toHaveValue('4000');
  });

  /** No deadline means no monthly figure, and a guess would be worse than an empty box. */
  it('leaves the amount empty when there is no monthly figure to suggest', async () => {
    render(<Harness target={OPEN_ENDED} />);
    await ready('Bank');

    expect(screen.getByLabelText(/^Amount/)).toHaveValue('');
  });

  it('defaults to an account in the goal’s currency', async () => {
    render(<Harness target={OPEN_ENDED} />);
    await ready('Bank');

    expect(screen.getByLabelText('Taken from')).toHaveTextContent('Bank');
  });

  /** Opened rather than waited on — finding Bank listed proves the accounts have arrived. */
  it('falls back to recording nothing when no account matches', async () => {
    const user = userEvent.setup();
    arrange([BANK]);
    render(<Harness target={WITH_DEADLINE} />);

    await user.click(screen.getByLabelText('Taken from'));
    expect(await screen.findByRole('option', { name: /^Bank/ })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    expect(screen.getByLabelText('Taken from')).toHaveTextContent("Don't record a transaction");
  });
});

describe('what it sends', () => {
  it('sends the amount, the date and the account it came from', async () => {
    const user = userEvent.setup();
    render(<Harness target={WITH_DEADLINE} />);
    await ready();

    await user.click(screen.getByRole('button', { name: 'Add contribution' }));

    await waitFor(() =>
      expect(api.requestsFor('POST /savings-goals/goal-1/contributions')).toHaveLength(1),
    );
    expect(added()).toMatchObject({ amount: '4000', accountId: 'acc-egp' });
    expect(added()['date']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('sends null when the money is not coming out of a tracked account', async () => {
    const user = userEvent.setup();
    render(<Harness target={WITH_DEADLINE} />);
    await ready();

    await user.click(screen.getByLabelText('Taken from'));
    await user.click(screen.getByRole('option', { name: "Don't record a transaction" }));
    await user.click(screen.getByRole('button', { name: 'Add contribution' }));

    await waitFor(() =>
      expect(api.requestsFor('POST /savings-goals/goal-1/contributions')).toHaveLength(1),
    );
    expect(added()['accountId']).toBeNull();
  });

  it('says which of the two will happen, before you commit', async () => {
    const user = userEvent.setup();
    render(<Harness target={WITH_DEADLINE} />);
    await ready();

    expect(
      await screen.findByText('A matching expense will be recorded against this account.'),
    ).toBeInTheDocument();

    await user.click(screen.getByLabelText('Taken from'));
    await user.click(screen.getByRole('option', { name: "Don't record a transaction" }));

    expect(
      screen.getByText('The goal updates, but no account balance changes.'),
    ).toBeInTheDocument();
  });

  /** You can fund a dollar goal out of an EGP account, so the box says which it is in. */
  it('labels the amount with the account’s currency, not the goal’s', async () => {
    const user = userEvent.setup();
    render(<Harness target={OPEN_ENDED} />);
    await ready('Bank');

    expect(screen.getByLabelText(/^Amount/)).toHaveAccessibleName('Amount USD');

    await user.click(screen.getByLabelText('Taken from'));
    await user.click(screen.getByRole('option', { name: /^Cash/ }));

    expect(screen.getByLabelText(/^Amount/)).toHaveAccessibleName('Amount EGP');
  });

  it('will not contribute nothing', async () => {
    render(<Harness target={OPEN_ENDED} />);
    await ready('Bank');

    expect(screen.getByRole('button', { name: 'Add contribution' })).toBeDisabled();
  });

  it('closes once the contribution is in', async () => {
    const user = userEvent.setup();
    render(<Harness target={WITH_DEADLINE} />);
    await ready();

    await user.click(screen.getByRole('button', { name: 'Add contribution' }));

    await waitFor(() => expect(screen.getByTestId('open')).toHaveTextContent('false'));
  });
});

describe('when the server refuses', () => {
  it('puts the message on the field the server names', async () => {
    const user = userEvent.setup();
    api.setRoute('POST /savings-goals/goal-1/contributions', {
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'That is more than the goal still needs.',
          details: { field: 'amount' },
        },
      },
    });
    render(<Harness target={WITH_DEADLINE} />);
    await ready();

    await user.click(screen.getByRole('button', { name: 'Add contribution' }));

    expect(await screen.findByText('That is more than the goal still needs.')).toBeInTheDocument();
    expect(screen.getByTestId('open')).toHaveTextContent('true');
  });

  it('states a general failure rather than closing as though it worked', async () => {
    const user = userEvent.setup();
    api.setRoute('POST /savings-goals/goal-1/contributions', {
      status: 500,
      body: { error: { code: 'INTERNAL', message: 'The database is unreachable.' } },
    });
    render(<Harness target={WITH_DEADLINE} />);
    await ready();

    await user.click(screen.getByRole('button', { name: 'Add contribution' }));

    expect(await screen.findByText('The database is unreachable.')).toBeInTheDocument();
    expect(screen.getByTestId('open')).toHaveTextContent('true');
  });
});
