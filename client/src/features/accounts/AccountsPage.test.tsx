import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { AccountDto } from '@ledger/shared';
import { stubApi, type ApiStub } from '@/test/http';
import { account } from '@/test/fixtures';
import { dismissFailure, getFailures } from '@/lib/action-feedback';
import { AccountsPage } from './AccountsPage';

/**
 * Two rules carry this screen.
 *
 * An account holding history is **archived, never deleted** (SPEC §5) — removing it would
 * either orphan its rows or take them with it. The button therefore sends DELETE and lets
 * the server decide which of the two it means.
 *
 * The opening balance, its date and the rate frozen from them are a historical fact (D5).
 * They can be set once and are read-only afterwards, because moving them would silently
 * rewrite every past net-worth figure.
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
      <MemoryRouter>
        <AccountsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const CASH = account({
  id: 'acc-egp',
  name: 'Cash (EGP)',
  currency: 'EGP',
  balance: '7386.0000',
  balanceEgp: '7386.0000',
  transactionCount: 6,
});

const BANK = account({
  id: 'acc-usd',
  name: 'Bank (USD)',
  type: 'BANK',
  currency: 'USD',
  balance: '-38.1400',
  balanceEgp: '-1949.8400',
  transactionCount: 1,
});

let api: ApiStub;

function arrange(accounts: AccountDto[]) {
  api?.restore();
  api = stubApi({
    'GET /accounts': { data: accounts },
    'POST /accounts': { status: 201, body: accounts[0] ?? {} },
    'PATCH /accounts/acc-egp': accounts[0] ?? {},
    'DELETE /accounts/acc-egp': { outcome: 'archived', account: accounts[0] ?? {} },
  });
}

const created = () => api.requestsFor('POST /accounts')[0]?.body;

beforeEach(() => {
  arrange([]);
});

afterEach(() => {
  api.restore();
  for (const failure of getFailures()) dismissFailure(failure.id);
});

describe('with no accounts', () => {
  it('explains why one account per currency, and offers to make the first', async () => {
    arrange([]);
    render(<Harness />);

    expect(await screen.findByText('No accounts yet')).toBeInTheDocument();
    expect(screen.getByText(/keeps every balance exact/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add your first account' })).toBeInTheDocument();
  });
});

describe('the cards', () => {
  it('leads with the native balance and puts pounds underneath for a foreign account', async () => {
    arrange([CASH, BANK]);
    render(<Harness />);

    await screen.findByText('Bank (USD)');
    expect(screen.getByText('-1,949.84 EGP')).toBeInTheDocument();
  });

  it('does not repeat the pound figure for an account already in pounds', async () => {
    arrange([CASH]);
    render(<Harness />);

    await screen.findByText('Cash (EGP)');
    expect(screen.queryByText(/7,386\.00 EGP/)).toBeNull();
  });

  it('links the transaction count into that account, filtered', async () => {
    arrange([CASH]);
    render(<Harness />);

    const link = await screen.findByRole('link', { name: '6 transactions' });
    expect(link).toHaveAttribute('href', '/transactions?accountId=acc-egp');
  });

  it('says "transaction" in the singular for one', async () => {
    arrange([BANK]);
    render(<Harness />);

    expect(await screen.findByRole('link', { name: '1 transaction' })).toBeInTheDocument();
  });

  it('shows the account type, and "archived" instead once it is', async () => {
    arrange([BANK, { ...CASH, isArchived: true }]);
    render(<Harness />);

    await screen.findByText('Bank (USD)');
    expect(screen.getByText('bank')).toBeInTheDocument();
    expect(screen.getByText('archived')).toBeInTheDocument();
  });
});

describe('archived accounts', () => {
  it('asks the API to leave them out by default', async () => {
    arrange([CASH]);
    render(<Harness />);

    await waitFor(() => expect(api.requestsFor('GET /accounts').length).toBeGreaterThan(0));
    expect(api.requestsFor('GET /accounts')[0]?.query.get('includeArchived')).toBe('false');
  });

  it('asks for them once the box is ticked', async () => {
    const user = userEvent.setup();
    arrange([CASH]);
    render(<Harness />);

    await user.click(await screen.findByLabelText('Show archived accounts'));

    await waitFor(() => {
      const flags = api.requestsFor('GET /accounts').map((r) => r.query.get('includeArchived'));
      expect(flags).toContain('true');
    });
  });
});

describe('archiving and restoring', () => {
  /**
   * DELETE, not a PATCH setting `isArchived` — the server archives an account with history
   * and removes an empty one, and only it knows which this is.
   */
  it('lets the server decide between archiving and removing', async () => {
    const user = userEvent.setup();
    arrange([CASH]);
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Archive Cash (EGP)' }));

    await waitFor(() => expect(api.requestsFor('DELETE /accounts/acc-egp')).toHaveLength(1));
    expect(api.requestsFor('PATCH /accounts/acc-egp')).toHaveLength(0);
  });

  it('restores by clearing the flag, which is unambiguous', async () => {
    const user = userEvent.setup();
    arrange([{ ...CASH, isArchived: true }]);
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Restore Cash (EGP)' }));

    await waitFor(() => expect(api.requestsFor('PATCH /accounts/acc-egp')).toHaveLength(1));
    expect(api.requestsFor('PATCH /accounts/acc-egp')[0]?.body).toEqual({ isArchived: false });
  });

  it('names the account when archiving fails, rather than going quiet', async () => {
    const user = userEvent.setup();
    arrange([CASH]);
    api.setRoute('DELETE /accounts/acc-egp', {
      status: 409,
      body: { error: { code: 'CONFLICT', message: 'That account still has transactions.' } },
    });
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Archive Cash (EGP)' }));

    await waitFor(() => expect(getFailures()).toHaveLength(1));
    expect(getFailures()[0]).toMatchObject({
      headline: 'Cash (EGP) could not be archived.',
      detail: 'That account still has transactions.',
    });
  });
});

describe('creating an account', () => {
  it('sends the opening figures, which are frozen from this moment on', async () => {
    const user = userEvent.setup();
    arrange([]);
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Add your first account' }));
    await user.type(await screen.findByLabelText('Name'), 'Instapay');

    const opening = screen.getByLabelText('Opening balance');
    // Prefilled with "0", so typing over it means clearing first.
    await user.clear(opening);
    await user.type(opening, '1500');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(created()).toBeDefined());
    expect(created()).toMatchObject({
      name: 'Instapay',
      type: 'CASH',
      currency: 'EGP',
      openingBalance: '1500',
      icon: 'wallet',
    });
    // The date is what the opening rate gets frozen against, so it is always sent.
    expect(created()).toHaveProperty('openingDate');
  });

  /**
   * The field is prefilled with `0`, so typing into it without clearing produces `01500`.
   * That is ugly but not wrong — it matches `decimalString` and stores as 1500.0000 — and
   * this pins that it stays harmless rather than being rejected or truncated.
   */
  it('accepts a leading zero left over from the prefill', async () => {
    const user = userEvent.setup();
    arrange([]);
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Add your first account' }));
    await user.type(await screen.findByLabelText('Name'), 'Instapay');
    await user.type(screen.getByLabelText('Opening balance'), '1500');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(created()).toBeDefined());
    expect(created()).toMatchObject({ openingBalance: '01500' });
  });

  it('defaults a blank opening balance to zero rather than sending nothing', async () => {
    const user = userEvent.setup();
    arrange([]);
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Add your first account' }));
    await user.type(await screen.findByLabelText('Name'), 'Wallet');
    await user.clear(screen.getByLabelText('Opening balance'));
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(created()).toBeDefined());
    expect(created()).toMatchObject({ openingBalance: '0' });
  });

  it('will not submit without a name', async () => {
    const user = userEvent.setup();
    arrange([]);
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Add your first account' }));
    await screen.findByLabelText('Name');

    expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled();
  });

  it('explains that the rate is frozen at the opening date', async () => {
    const user = userEvent.setup();
    arrange([]);
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Add your first account' }));

    expect(
      await screen.findByText(/The rate on this date is frozen into the account/),
    ).toBeInTheDocument();
  });

  it('puts a rejection next to the field it names', async () => {
    const user = userEvent.setup();
    arrange([]);
    api.setRoute('POST /accounts', {
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Some fields need fixing.',
          details: [{ path: 'name', message: 'That name is already taken.' }],
        },
      },
    });
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Add your first account' }));
    await user.type(await screen.findByLabelText('Name'), 'Cash (EGP)');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('That name is already taken.')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('editing an account', () => {
  it('locks the opening figures, because they are already history (D5)', async () => {
    const user = userEvent.setup();
    arrange([CASH]);
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Edit Cash (EGP)' }));
    await screen.findByLabelText('Name');

    expect(screen.getByLabelText('Opening balance')).toBeDisabled();
    expect(screen.getByLabelText('As of')).toBeDisabled();
    expect(
      screen.getByText(/Changing them would rewrite every past net-worth figure/),
    ).toBeInTheDocument();
  });

  it('locks the currency, since every row on the account is in it', async () => {
    const user = userEvent.setup();
    arrange([BANK, CASH]);
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Edit Bank (USD)' }));
    await screen.findByLabelText('Name');

    expect(screen.getByLabelText('Currency')).toBeDisabled();
    expect(screen.getByText(/Fixed — every row on this account is in USD/)).toBeInTheDocument();
  });

  it('patches only what is editable, never the opening figures', async () => {
    const user = userEvent.setup();
    arrange([CASH]);
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Edit Cash (EGP)' }));
    const name = await screen.findByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Cash on hand');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(api.requestsFor('PATCH /accounts/acc-egp')).toHaveLength(1));
    const body = api.requestsFor('PATCH /accounts/acc-egp')[0]?.body as Record<string, unknown>;

    expect(body).toEqual({
      name: 'Cash on hand',
      type: 'CASH',
      color: CASH.color,
      icon: CASH.icon,
    });
    expect(body).not.toHaveProperty('openingBalance');
    expect(body).not.toHaveProperty('currency');
  });

  it('prefills from the account being edited', async () => {
    const user = userEvent.setup();
    arrange([CASH]);
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Edit Cash (EGP)' }));

    expect(await screen.findByLabelText('Name')).toHaveValue('Cash (EGP)');
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByText('Edit account')).toBeInTheDocument();
  });
});

/**
 * SPEC §9's per-account sparkline. Decoration: the balance beside it is the fact, and the
 * shape only says which way it has been going — so it is hidden from assistive tech, and
 * the interesting cases are the ones where it declines to draw at all.
 */
describe('the sparkline', () => {
  const chart = (container: HTMLElement) => container.querySelector('svg[viewBox="0 0 64 18"]');

  it('draws the balance trend beside the figure', async () => {
    arrange([
      account({
        id: 'acc-egp',
        name: 'Cash (EGP)',
        balance: '750.0000',
        balanceHistory: ['1000.0000', '1000.0000', '750.0000'],
      }),
    ]);
    const { container } = render(<Harness />);

    await screen.findByText('Cash (EGP)');
    expect(chart(container)).not.toBeNull();
  });

  /** One balance is not a trend — a new account gets a single point and nothing is drawn. */
  it('draws nothing for an account with one day of history', async () => {
    arrange([account({ id: 'acc-new', name: 'Opened today', balanceHistory: ['500.0000'] })]);
    const { container } = render(<Harness />);

    await screen.findByText('Opened today');
    expect(chart(container)).toBeNull();
  });

  it('says nothing to a screen reader, because the balance already did', async () => {
    arrange([
      account({
        id: 'acc-egp',
        name: 'Cash (EGP)',
        balanceHistory: ['1000.0000', '750.0000'],
      }),
    ]);
    const { container } = render(<Harness />);

    await screen.findByText('Cash (EGP)');
    expect(chart(container)).toHaveAttribute('aria-hidden', 'true');
  });

  it('gives each account its own', async () => {
    arrange([
      account({ id: 'a', name: 'One', balanceHistory: ['1.0000', '2.0000'] }),
      account({ id: 'b', name: 'Two', balanceHistory: ['3.0000', '1.0000'] }),
    ]);
    const { container } = render(<Harness />);

    await screen.findByText('Two');
    expect(container.querySelectorAll('svg[viewBox="0 0 64 18"]')).toHaveLength(2);
  });
});
