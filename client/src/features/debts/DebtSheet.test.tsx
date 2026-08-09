import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DebtDto } from '@ledger/shared';
import { stubApi, type ApiStub } from '@/test/http';
import { todayIso } from '@/lib/dates';
import { debt } from '@/test/fixtures';
import { DebtSheet } from './DebtSheet';

/**
 * Recording a debt. The direction is the field everything else hangs off — it decides
 * whether the counterparty is someone you owe or someone who owes you, and it is the sign
 * of every figure the debt produces — so it is chosen once, on creation, and never edited.
 *
 * Optional fields are sent as `null`, not as `''`. An empty string is a value the server
 * would have to interpret; `null` says "there isn't one".
 */

const EXISTING = debt({
  id: 'debt-1',
  counterparty: 'Omar',
  direction: 'OWED_TO_ME',
  principal: '5000.0000',
  currency: 'USD',
  startDate: '2026-03-01T00:00:00.000Z',
  dueDate: '2026-12-01T00:00:00.000Z',
  note: 'For the car',
});

function Harness({ editing }: { editing?: DebtDto }) {
  const [open, setOpen] = useState(true);
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <DebtSheet open={open} onOpenChange={setOpen} editing={editing} />
      <output data-testid="open">{String(open)}</output>
    </QueryClientProvider>
  );
}

let api: ApiStub;

beforeEach(() => {
  api = stubApi({
    'POST /debts': { status: 201, body: debt({ id: 'debt-new', counterparty: 'Omar' }) },
    'PATCH /debts/debt-1': { body: EXISTING },
  });
});

afterEach(() => {
  api.restore();
});

const created = () => api.requestsFor('POST /debts')[0]?.body as Record<string, unknown>;

describe('recording one', () => {
  it('sends everything the debt is made of', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText('Who you owe'), 'Mostafa');
    await user.type(screen.getByLabelText('Amount'), '12000');
    // Already holds today, and typing into a filled date input appends rather than replaces.
    await user.clear(screen.getByLabelText('Started'));
    await user.type(screen.getByLabelText('Started'), '2026-08-01');
    await user.type(screen.getByLabelText('Due'), '2026-11-30');
    await user.type(screen.getByLabelText('Note'), 'Rent deposit');
    await user.click(screen.getByRole('button', { name: 'Record debt' }));

    await waitFor(() => expect(api.requestsFor('POST /debts')).toHaveLength(1));
    expect(created()).toEqual({
      counterparty: 'Mostafa',
      direction: 'I_OWE',
      principal: '12000',
      currency: 'EGP',
      startDate: '2026-08-01',
      dueDate: '2026-11-30',
      note: 'Rent deposit',
    });
  });

  /** `''` would be a value the server has to interpret; `null` says there isn't one. */
  it('sends null rather than an empty string for the optional fields', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText('Who you owe'), 'Mostafa');
    await user.type(screen.getByLabelText('Amount'), '12000');
    await user.click(screen.getByRole('button', { name: 'Record debt' }));

    await waitFor(() => expect(api.requestsFor('POST /debts')).toHaveLength(1));
    expect(created()['dueDate']).toBeNull();
    expect(created()['note']).toBeNull();
  });

  /**
   * "Today" is the local date, not the UTC one. Asserting `toISOString().slice(0, 10)` here
   * passed all evening and then failed after local midnight, when UTC was still on
   * yesterday — the test was restating the rule in a different timezone rather than
   * checking it. That mismatch was real in the app too: every sheet but this one read the
   * local date, so `AccountSheet` opened an account "yesterday" for the last two hours of
   * every day. Both now go through `todayIso`.
   */
  it('defaults to a debt you owe, and starts today', async () => {
    render(<Harness />);

    expect(screen.getByRole('button', { name: 'I owe' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Started')).toHaveValue(todayIso());
  });

  /** The question changes with the direction, because "counterparty" answers neither. */
  it('renames the counterparty field when the direction flips', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByLabelText('Who you owe')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Owed to me' }));

    expect(screen.getByLabelText('Who owes you')).toBeInTheDocument();
    expect(screen.queryByLabelText('Who you owe')).toBeNull();
  });

  it('sends the flipped direction', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Owed to me' }));
    await user.type(screen.getByLabelText('Who owes you'), 'Omar');
    await user.type(screen.getByLabelText('Amount'), '500');
    await user.click(screen.getByRole('button', { name: 'Record debt' }));

    await waitFor(() => expect(api.requestsFor('POST /debts')).toHaveLength(1));
    expect(created()['direction']).toBe('OWED_TO_ME');
  });

  it('sends the currency the debt is denominated in', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText('Who you owe'), 'Mostafa');
    await user.type(screen.getByLabelText('Amount'), '300');
    await user.click(screen.getByRole('combobox', { name: /Currency/ }));
    await user.click(screen.getByRole('option', { name: /^USD/ }));
    await user.click(screen.getByRole('button', { name: 'Record debt' }));

    await waitFor(() => expect(api.requestsFor('POST /debts')).toHaveLength(1));
    expect(created()['currency']).toBe('USD');
  });

  it('needs both a name and an amount before it will save', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByRole('button', { name: 'Record debt' })).toBeDisabled();

    await user.type(screen.getByLabelText('Who you owe'), 'Mostafa');
    expect(screen.getByRole('button', { name: 'Record debt' })).toBeDisabled();

    await user.type(screen.getByLabelText('Amount'), '100');
    expect(screen.getByRole('button', { name: 'Record debt' })).not.toBeDisabled();
  });

  it('closes once it is recorded', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText('Who you owe'), 'Mostafa');
    await user.type(screen.getByLabelText('Amount'), '100');
    await user.click(screen.getByRole('button', { name: 'Record debt' }));

    await waitFor(() => expect(screen.getByTestId('open')).toHaveTextContent('false'));
  });
});

describe('editing one', () => {
  it('loads what is already there, trimming the stored precision back to a figure', () => {
    render(<Harness editing={EXISTING} />);

    expect(screen.getByLabelText('Who owes you')).toHaveValue('Omar');
    // '5000.0000' as stored, but nobody types trailing zeroes into a form.
    expect(screen.getByLabelText('Amount')).toHaveValue('5000');
    expect(screen.getByLabelText('Started')).toHaveValue('2026-03-01');
    expect(screen.getByLabelText('Due')).toHaveValue('2026-12-01');
    expect(screen.getByLabelText('Note')).toHaveValue('For the car');
  });

  /**
   * Direction is the sign of every figure this debt has produced. Flipping it on an
   * existing debt would turn money owed into money lent without touching a payment.
   */
  it('does not offer the direction toggle at all', () => {
    render(<Harness editing={EXISTING} />);

    expect(screen.queryByRole('button', { name: 'I owe' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Owed to me' })).toBeNull();
  });

  /** Payments are recorded in it, so it can no longer move. */
  it('locks the currency', () => {
    render(<Harness editing={EXISTING} />);

    expect(screen.getByRole('combobox', { name: /Currency/ })).toBeDisabled();
  });

  it('patches rather than creating a second debt', async () => {
    const user = userEvent.setup();
    render(<Harness editing={EXISTING} />);

    await user.clear(screen.getByLabelText('Note'));
    await user.type(screen.getByLabelText('Note'), 'For the car — agreed in March');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(api.requestsFor('PATCH /debts/debt-1')).toHaveLength(1));
    expect(api.requestsFor('POST /debts')).toHaveLength(0);
  });
});

describe('when the server refuses', () => {
  /** The server names the offending field in `details.field`; it belongs beside that field. */
  it('puts the message on the field it names', async () => {
    const user = userEvent.setup();
    api.setRoute('POST /debts', {
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The due date cannot be before the start date.',
          details: { field: 'dueDate' },
        },
      },
    });
    render(<Harness />);

    await user.type(screen.getByLabelText('Who you owe'), 'Mostafa');
    await user.type(screen.getByLabelText('Amount'), '100');
    await user.click(screen.getByRole('button', { name: 'Record debt' }));

    expect(
      await screen.findByText('The due date cannot be before the start date.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('open')).toHaveTextContent('true');
  });

  it('states a failure with no field to blame in the sheet', async () => {
    const user = userEvent.setup();
    api.setRoute('POST /debts', {
      status: 500,
      body: { error: { code: 'INTERNAL', message: 'The database is unreachable.' } },
    });
    render(<Harness />);

    await user.type(screen.getByLabelText('Who you owe'), 'Mostafa');
    await user.type(screen.getByLabelText('Amount'), '100');
    await user.click(screen.getByRole('button', { name: 'Record debt' }));

    expect(await screen.findByText('The database is unreachable.')).toBeInTheDocument();
  });
});
