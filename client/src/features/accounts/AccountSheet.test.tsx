import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AccountDto } from '@ledger/shared';
import { stubApi, type ApiStub } from '@/test/http';
import { account } from '@/test/fixtures';
import { AccountSheet } from './AccountSheet';

/**
 * Creating and renaming an account.
 *
 * The rule this sheet exists to hold is D5: the opening balance, its date and the rate
 * frozen from them are a *historical fact*. Letting any of them move afterwards silently
 * restates every past net-worth figure, so on an edit they are shown read-only rather than
 * hidden — they are still what explains the balance — and the PATCH must not carry them.
 *
 * `AccountsPage.test.tsx` drives this through the page; here it is driven directly, which
 * is what makes the edit payload assertable.
 */

const USD_ACCOUNT = account({
  id: 'acc-usd',
  name: 'Bank (USD)',
  currency: 'USD',
  type: 'BANK',
  openingBalance: '1200.0000',
  openingDate: '2026-01-15T00:00:00.000Z',
  color: '#4a6f9f',
  icon: 'wallet',
});

function Harness({ editing }: { editing?: AccountDto }) {
  const [open, setOpen] = useState(true);
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <AccountSheet open={open} onOpenChange={setOpen} editing={editing} />
      <output data-testid="open">{String(open)}</output>
    </QueryClientProvider>
  );
}

let api: ApiStub;

beforeEach(() => {
  api = stubApi({
    'GET /accounts': { data: [USD_ACCOUNT] },
    'POST /accounts': { status: 201, body: account({ id: 'acc-new', name: 'Cash' }) },
    'PATCH /accounts/acc-usd': { body: USD_ACCOUNT },
  });
});

afterEach(() => {
  api.restore();
});

const created = () => api.requestsFor('POST /accounts')[0]?.body as Record<string, unknown>;
const patched = () => api.requestsFor('PATCH /accounts/acc-usd')[0]?.body as Record<string, unknown>;

describe('creating an account', () => {
  it('sends the name, type, currency and opening figures', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText('Name'), 'Instapay');
    await user.selectOptions(screen.getByLabelText('Type'), 'WALLET');
    await user.clear(screen.getByLabelText('Opening balance'));
    await user.type(screen.getByLabelText('Opening balance'), '2500');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(api.requestsFor('POST /accounts')).toHaveLength(1));
    expect(created()).toMatchObject({
      name: 'Instapay',
      type: 'WALLET',
      currency: 'EGP',
      openingBalance: '2500',
      icon: 'wallet',
    });
    expect(created()['openingDate']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  /**
   * An account opened at nothing is the normal case, and an empty string is not a figure —
   * the server would reject it. Zero is what "I have not put anything in yet" means.
   */
  it('sends zero rather than an empty string for a blank opening balance', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText('Name'), 'Cash');
    await user.clear(screen.getByLabelText('Opening balance'));
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(api.requestsFor('POST /accounts')).toHaveLength(1));
    expect(created()['openingBalance']).toBe('0');
  });

  /** Single-currency accounts (D3), so this is the one moment the currency is a choice. */
  it('lets the currency be chosen', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByRole('combobox', { name: /Currency/ })).not.toBeDisabled();

    await user.type(screen.getByLabelText('Name'), 'Bank');
    await user.click(screen.getByRole('combobox', { name: /Currency/ }));
    await user.click(screen.getByRole('option', { name: /^USD/ }));
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(api.requestsFor('POST /accounts')).toHaveLength(1));
    expect(created()['currency']).toBe('USD');
  });

  it('sends the chosen colour', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText('Name'), 'Cash');
    await user.click(screen.getByRole('button', { name: 'Use colour #7f5f8f' }));
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(api.requestsFor('POST /accounts')).toHaveLength(1));
    expect(created()['color']).toBe('#7f5f8f');
  });

  it('marks the chosen swatch as pressed rather than relying on the ring', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Use colour #b06a3f' }));

    expect(screen.getByRole('button', { name: 'Use colour #b06a3f' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('will not submit an account with no name', async () => {
    render(<Harness />);

    expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled();
  });

  it('closes once the account exists', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText('Name'), 'Cash');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(screen.getByTestId('open')).toHaveTextContent('false'));
  });
});

describe('editing an account', () => {
  it('loads what is already there', () => {
    render(<Harness editing={USD_ACCOUNT} />);

    expect(screen.getByLabelText('Name')).toHaveValue('Bank (USD)');
    expect(screen.getByLabelText('Type')).toHaveValue('BANK');
    expect(screen.getByLabelText('Opening balance')).toHaveValue('1200.0000');
    expect(screen.getByLabelText('As of')).toHaveValue('2026-01-15');
  });

  /**
   * The whole point. A PATCH carrying `openingBalance` would let a typo in a form field
   * rewrite what this account was worth in January — and every net-worth figure since.
   */
  it('sends only what may change, never the frozen figures', async () => {
    const user = userEvent.setup();
    render(<Harness editing={USD_ACCOUNT} />);

    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Bank — main');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(api.requestsFor('PATCH /accounts/acc-usd')).toHaveLength(1));
    expect(patched()).toEqual({
      name: 'Bank — main',
      type: 'BANK',
      color: '#4a6f9f',
      icon: 'wallet',
    });
    expect(patched()).not.toHaveProperty('openingBalance');
    expect(patched()).not.toHaveProperty('openingDate');
    expect(patched()).not.toHaveProperty('currency');
  });

  /** Shown, not hidden: the figures still explain the balance, they just cannot move. */
  it('shows the opening figures read-only rather than removing them', () => {
    render(<Harness editing={USD_ACCOUNT} />);

    expect(screen.getByLabelText('Opening balance')).toBeDisabled();
    expect(screen.getByLabelText('As of')).toBeDisabled();
    expect(screen.getByText(/The opening figures are frozen/)).toBeInTheDocument();
  });

  it('says why they are frozen and where a correction belongs instead', () => {
    render(<Harness editing={USD_ACCOUNT} />);

    expect(screen.getByText(/rewrite every past net-worth figure/)).toBeInTheDocument();
    expect(screen.getByText(/a correction belongs in a transaction instead/)).toBeInTheDocument();
  });

  /** Changing it would make every existing row on the account the wrong currency. */
  it('locks the currency and says it is fixed', () => {
    render(<Harness editing={USD_ACCOUNT} />);

    expect(screen.getByRole('combobox', { name: /Currency/ })).toBeDisabled();
    expect(screen.getByText(/Fixed — every row on this account is in USD/)).toBeInTheDocument();
  });
});

describe('when the server refuses', () => {
  it('attaches a field error to the field it belongs to', async () => {
    const user = userEvent.setup();
    api.setRoute('POST /accounts', {
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'That is not valid.',
          details: [{ path: 'name', message: 'An account with that name already exists.' }],
        },
      },
    });
    render(<Harness />);

    await user.type(screen.getByLabelText('Name'), 'Cash');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(
      await screen.findByText('An account with that name already exists.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
    // Still open, so the typed values are still there to correct.
    expect(screen.getByTestId('open')).toHaveTextContent('true');
  });

  it('points the field at its message for a screen reader', async () => {
    const user = userEvent.setup();
    api.setRoute('POST /accounts', {
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'That is not valid.',
          details: [{ path: 'name', message: 'Too long.' }],
        },
      },
    });
    render(<Harness />);

    await user.type(screen.getByLabelText('Name'), 'Cash');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await screen.findByText('Too long.');
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription('Too long.');
  });

  /** A failure with no field to blame still has to be said out loud, in the sheet. */
  it('states a general failure as an alert', async () => {
    const user = userEvent.setup();
    api.setRoute('POST /accounts', {
      status: 500,
      body: { error: { code: 'INTERNAL', message: 'The database is unreachable.' } },
    });
    render(<Harness />);

    await user.type(screen.getByLabelText('Name'), 'Cash');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The database is unreachable.');
  });
});
