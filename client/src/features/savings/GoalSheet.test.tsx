import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SavingsGoalDto } from '@ledger/shared';
import { stubApi, type ApiStub } from '@/test/http';
import { savingsGoal } from '@/test/fixtures';
import { GoalSheet } from './GoalSheet';

/**
 * Setting a savings target.
 *
 * The deadline is optional and stays that way: the monthly figure is derived from it, so
 * without one there is simply nothing to derive — which the sheet says, rather than
 * inventing a horizon or refusing to save the goal.
 */

const EXISTING = savingsGoal({
  id: 'goal-1',
  name: 'Emergency fund',
  targetAmount: '60000.0000',
  currency: 'USD',
  deadline: '2027-01-31T00:00:00.000Z',
  color: '#4a6f9f',
});

function Harness({ editing }: { editing?: SavingsGoalDto }) {
  const [open, setOpen] = useState(true);
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <GoalSheet open={open} onOpenChange={setOpen} editing={editing} />
      <output data-testid="open">{String(open)}</output>
    </QueryClientProvider>
  );
}

let api: ApiStub;

beforeEach(() => {
  api = stubApi({
    'POST /savings-goals': {
      status: 201,
      body: savingsGoal({ id: 'goal-new', name: 'Emergency fund' }),
    },
    'PATCH /savings-goals/goal-1': { body: EXISTING },
  });
});

afterEach(() => {
  api.restore();
});

const created = () => api.requestsFor('POST /savings-goals')[0]?.body as Record<string, unknown>;

describe('creating a goal', () => {
  it('sends the target, its currency and the deadline', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText('Name'), 'New laptop');
    await user.type(screen.getByLabelText('Target'), '45000');
    await user.type(screen.getByLabelText('Deadline'), '2027-03-31');
    await user.click(screen.getByRole('button', { name: 'Create goal' }));

    await waitFor(() => expect(api.requestsFor('POST /savings-goals')).toHaveLength(1));
    expect(created()).toEqual({
      name: 'New laptop',
      targetAmount: '45000',
      currency: 'EGP',
      deadline: '2027-03-31',
      color: '#2f8f5b',
      icon: 'piggy-bank',
    });
  });

  /** A goal with no horizon is a real goal, so `null` rather than a rejection. */
  it('sends null for a goal with no deadline', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText('Name'), 'Rainy day');
    await user.type(screen.getByLabelText('Target'), '10000');
    await user.click(screen.getByRole('button', { name: 'Create goal' }));

    await waitFor(() => expect(api.requestsFor('POST /savings-goals')).toHaveLength(1));
    expect(created()['deadline']).toBeNull();
  });

  it('says what a missing deadline costs you rather than just marking it optional', () => {
    render(<Harness />);

    expect(
      screen.getByText(/there is nothing to work a monthly figure out against/),
    ).toBeInTheDocument();
  });

  it('sends the currency the target is set in', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText('Name'), 'Trip');
    await user.type(screen.getByLabelText('Target'), '2000');
    await user.click(screen.getByRole('combobox', { name: /Currency/ }));
    await user.click(screen.getByRole('option', { name: /^EUR/ }));
    await user.click(screen.getByRole('button', { name: 'Create goal' }));

    await waitFor(() => expect(api.requestsFor('POST /savings-goals')).toHaveLength(1));
    expect(created()['currency']).toBe('EUR');
  });

  it('sends the chosen colour', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText('Name'), 'Trip');
    await user.type(screen.getByLabelText('Target'), '2000');
    await user.click(screen.getByRole('button', { name: 'Use colour #9f5f8f' }));
    await user.click(screen.getByRole('button', { name: 'Create goal' }));

    await waitFor(() => expect(api.requestsFor('POST /savings-goals')).toHaveLength(1));
    expect(created()['color']).toBe('#9f5f8f');
  });

  /** A goal with no target is not a goal — there is nothing to measure progress against. */
  it('needs both a name and a target before it will save', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByRole('button', { name: 'Create goal' })).toBeDisabled();

    await user.type(screen.getByLabelText('Name'), 'Trip');
    expect(screen.getByRole('button', { name: 'Create goal' })).toBeDisabled();

    await user.type(screen.getByLabelText('Target'), '2000');
    expect(screen.getByRole('button', { name: 'Create goal' })).not.toBeDisabled();
  });

  it('closes once the goal exists', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText('Name'), 'Trip');
    await user.type(screen.getByLabelText('Target'), '2000');
    await user.click(screen.getByRole('button', { name: 'Create goal' }));

    await waitFor(() => expect(screen.getByTestId('open')).toHaveTextContent('false'));
  });
});

describe('editing a goal', () => {
  it('loads what is already there', () => {
    render(<Harness editing={EXISTING} />);

    expect(screen.getByLabelText('Name')).toHaveValue('Emergency fund');
    expect(screen.getByLabelText('Target')).toHaveValue('60000');
    expect(screen.getByLabelText('Deadline')).toHaveValue('2027-01-31');
  });

  /** Contributions are already recorded against it, so the currency can no longer move. */
  it('locks the currency', () => {
    render(<Harness editing={EXISTING} />);

    expect(screen.getByRole('combobox', { name: /Currency/ })).toBeDisabled();
  });

  it('patches rather than creating a second goal', async () => {
    const user = userEvent.setup();
    render(<Harness editing={EXISTING} />);

    await user.clear(screen.getByLabelText('Target'));
    await user.type(screen.getByLabelText('Target'), '80000');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(api.requestsFor('PATCH /savings-goals/goal-1')).toHaveLength(1));
    expect(api.requestsFor('POST /savings-goals')).toHaveLength(0);
  });

  /** Clearing a deadline is a real edit, and has to reach the server as `null`. */
  it('can take a deadline away again', async () => {
    const user = userEvent.setup();
    render(<Harness editing={EXISTING} />);

    await user.clear(screen.getByLabelText('Deadline'));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(api.requestsFor('PATCH /savings-goals/goal-1')).toHaveLength(1));
    const body = api.requestsFor('PATCH /savings-goals/goal-1')[0]?.body as Record<string, unknown>;
    expect(body['deadline']).toBeNull();
  });
});

describe('when the server refuses', () => {
  it('puts the message on the field the server names', async () => {
    const user = userEvent.setup();
    api.setRoute('POST /savings-goals', {
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'A goal with that name already exists.',
          details: { field: 'name' },
        },
      },
    });
    render(<Harness />);

    await user.type(screen.getByLabelText('Name'), 'Trip');
    await user.type(screen.getByLabelText('Target'), '2000');
    await user.click(screen.getByRole('button', { name: 'Create goal' }));

    expect(await screen.findByText('A goal with that name already exists.')).toBeInTheDocument();
    expect(screen.getByTestId('open')).toHaveTextContent('true');
  });

  it('states a general failure in the sheet', async () => {
    const user = userEvent.setup();
    api.setRoute('POST /savings-goals', {
      status: 500,
      body: { error: { code: 'INTERNAL', message: 'The database is unreachable.' } },
    });
    render(<Harness />);

    await user.type(screen.getByLabelText('Name'), 'Trip');
    await user.type(screen.getByLabelText('Target'), '2000');
    await user.click(screen.getByRole('button', { name: 'Create goal' }));

    expect(await screen.findByText('The database is unreachable.')).toBeInTheDocument();
  });
});
