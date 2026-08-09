import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AccountDto, CategoryDto, TransactionDto } from '@ledger/shared';
import { stubApi, type ApiStub } from '@/test/http';
import { account, category } from '@/test/fixtures';
import { TransactionSheet } from './TransactionSheet';

/**
 * The sheet is where money enters this app, so these tests are mostly about the *request*
 * rather than the rendering: what shape goes over the wire, which fields are omitted
 * rather than sent empty, and that a transfer is one call describing both sides.
 *
 * `MoneyInput` sends the raw text — an expression is resolved by the same shared parser on
 * the server (SPEC §8A) — so an unresolved `1200*3` reaching the API would be correct, not
 * a bug. In practice submitting blurs the field, which resolves it first.
 *
 * These tests also stand as the regression test for the render loop in the reset effect
 * (see `NO_ACCOUNTS` in the component). No assertion states it, because none needs to:
 * with a fresh `[]` on every render the effect re-triggers itself and the whole file hangs
 * rather than failing.
 */

const CASH = account({ id: 'acc-egp', name: 'Cash (EGP)', currency: 'EGP' });
const BANK = account({ id: 'acc-usd', name: 'Bank (USD)', currency: 'USD' });
const WALLET = account({ id: 'acc-egp-2', name: 'Wallet (EGP)', currency: 'EGP' });

const GROCERIES = category({ id: 'cat-groceries', name: 'Groceries' });
const SALARY = category({ id: 'cat-salary', name: 'Salary', kind: 'INCOME' });

/** The sheet is controlled, so the harness owns `open` the way the real page does. */
function Harness({ editing, initialAmount }: { editing?: TransactionDto; initialAmount?: string }) {
  const [open, setOpen] = useState(true);
  /**
   * Created once, exactly as the real `QueryProvider` does. Building it in the render body
   * hands every child a new client on each pass, so the queries restart forever and never
   * resolve — which looks like a hung test rather than a mistake in the harness.
   */
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <TransactionSheet
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        initialAmount={initialAmount}
      />
      <output data-testid="open">{String(open)}</output>
    </QueryClientProvider>
  );
}

let api: ApiStub;

/**
 * Which accounts exist is a property of the *fixture*, not of the component — the sheet
 * reads them from the API — so it is chosen here rather than passed as a prop. Calling
 * this again mid-test replaces the stub, so the previous one is restored first.
 */
function arrange(
  accounts: AccountDto[] = [CASH, BANK],
  categories: CategoryDto[] = [GROCERIES, SALARY],
) {
  api?.restore();
  api = stubApi({
    'GET /accounts': { data: accounts },
    'GET /categories': { data: categories },
    'POST /transactions': { status: 201, body: { id: 'new-tx' } },
    'PATCH /transactions/tx-1': { body: { id: 'tx-1' } },
  });
}

/**
 * Waits for the accounts to be *applied*, not merely requested.
 *
 * Waiting on the request alone was a real flake: the amount field renders immediately, so
 * `ready()` returned while `accountId` and `toAccountId` were still empty. Switching to
 * Transfer at that moment leaves both accounts unset, so nothing is cross-currency and the
 * "Amount arriving" field never appears — which failed roughly one run in four, and only
 * when the whole suite was running.
 */
async function ready() {
  await waitFor(() => expect(api.requestsFor('GET /accounts').length).toBeGreaterThan(0));
  await screen.findByLabelText(/^Amount/);
  // "Account" when adding, "From account" when the row is a transfer. Anchored so that
  // "To account" cannot match as well and make the query ambiguous.
  await waitFor(() =>
    expect(screen.getByLabelText(/^(Account|From account)$/)).toHaveTextContent(/\w/),
  );
}

const submitted = () => api.requestsFor('POST /transactions')[0]?.body;

beforeEach(() => {
  arrange();
});

afterEach(() => {
  api.restore();
});

describe('what an expense sends', () => {
  it('posts a positive magnitude and lets the server apply the sign (SPEC §4.7)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await ready();

    await user.type(screen.getByLabelText(/^Amount/), '250.50');
    await user.click(screen.getByRole('button', { name: 'Add transaction' }));

    await waitFor(() => expect(submitted()).toBeDefined());
    expect(submitted()).toEqual({
      type: 'EXPENSE',
      amount: '250.50',
      accountId: CASH.id,
      categoryId: null,
      date: expect.any(String),
      note: null,
    });
  });

  it('sends null rather than an empty string for an omitted category and note', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await ready();

    await user.type(screen.getByLabelText(/^Amount/), '10');
    await user.click(screen.getByRole('button', { name: 'Add transaction' }));

    await waitFor(() => expect(submitted()).toBeDefined());
    expect(submitted()).toMatchObject({ categoryId: null, note: null });
  });

  /**
   * Clicking save blurs the amount field, and `MoneyInput` resolves on blur — so an
   * expression is worked out before it is sent, rather than going over as ambiguous text.
   * The server runs the same parser anyway (SPEC §8A), but it never has to here.
   */
  it('resolves a typed expression on the way out, without needing Enter first', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await ready();

    await user.type(screen.getByLabelText(/^Amount/), '1200*3+450');
    await user.click(screen.getByRole('button', { name: 'Add transaction' }));

    await waitFor(() => expect(submitted()).toBeDefined());
    expect(submitted()).toMatchObject({ amount: '4050.00' });
  });

  it('sends the resolved figure once Enter has worked it out', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await ready();

    await user.type(screen.getByLabelText(/^Amount/), '1200*3+450{Enter}');
    await user.click(screen.getByRole('button', { name: 'Add transaction' }));

    await waitFor(() => expect(submitted()).toBeDefined());
    expect(submitted()).toMatchObject({ amount: '4050.00' });
  });

  it('defaults the date to today', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await ready();

    await user.type(screen.getByLabelText(/^Amount/), '10');
    await user.click(screen.getByRole('button', { name: 'Add transaction' }));

    await waitFor(() => expect(submitted()).toBeDefined());
    const today = new Date();
    const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(submitted()).toMatchObject({ date: expected });
  });

  it('prefills the amount handed over by the calculator', async () => {
    render(<Harness initialAmount="500.00" />);
    await ready();

    expect(screen.getByLabelText(/^Amount/)).toHaveValue('500.00');
  });

  it('will not submit without an amount', async () => {
    render(<Harness />);
    await ready();

    expect(screen.getByRole('button', { name: 'Add transaction' })).toBeDisabled();
  });
});

describe('switching mode', () => {
  it('asks for income categories when the mode is income', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await ready();

    await user.click(screen.getByRole('button', { name: 'Income' }));

    await waitFor(() => {
      const kinds = api.requestsFor('GET /categories').map((request) => request.query.get('kind'));
      expect(kinds).toContain('INCOME');
    });
  });

  it('posts the chosen type', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await ready();

    await user.click(screen.getByRole('button', { name: 'Income' }));
    await user.type(screen.getByLabelText(/^Amount/), '14860');
    await user.click(screen.getByRole('button', { name: 'Add transaction' }));

    await waitFor(() => expect(submitted()).toBeDefined());
    expect(submitted()).toMatchObject({ type: 'INCOME', amount: '14860' });
  });

  it('drops the category field for a transfer — a transfer is excluded from every category total (D2)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await ready();

    expect(screen.getByLabelText('Category')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Transfer' }));

    expect(screen.queryByLabelText('Category')).toBeNull();
    expect(screen.getByLabelText('To account')).toBeInTheDocument();
  });

  it('renames the amount field so it is clear which side it is', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await ready();

    await user.click(screen.getByRole('button', { name: 'Transfer' }));

    expect(screen.getByLabelText(/^Amount leaving/)).toBeInTheDocument();
    expect(screen.getByLabelText('From account')).toBeInTheDocument();
  });
});

describe('a transfer', () => {
  it('goes as one request describing both sides', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await ready();

    await user.click(screen.getByRole('button', { name: 'Transfer' }));
    await user.type(screen.getByLabelText(/^Amount leaving/), '1000');
    await user.click(screen.getByRole('button', { name: 'Add transaction' }));

    await waitFor(() => expect(submitted()).toBeDefined());
    expect(submitted()).toEqual({
      type: 'TRANSFER',
      fromAccountId: CASH.id,
      toAccountId: BANK.id,
      fromAmount: '1000',
      date: expect.any(String),
      note: null,
    });
    // One call, not two: the pair is written atomically on the server (D2).
    expect(api.requestsFor('POST /transactions')).toHaveLength(1);
  });

  it('omits toAmount entirely rather than sending it empty', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await ready();

    await user.click(screen.getByRole('button', { name: 'Transfer' }));
    await user.type(screen.getByLabelText(/^Amount leaving/), '100');
    await user.click(screen.getByRole('button', { name: 'Add transaction' }));

    await waitFor(() => expect(submitted()).toBeDefined());
    expect(submitted()).not.toHaveProperty('toAmount');
  });

  it('asks what actually arrived when the two accounts differ in currency', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await ready();

    await user.click(screen.getByRole('button', { name: 'Transfer' }));

    // CASH is EGP, BANK is USD — so the rate cannot be assumed.
    expect(screen.getByLabelText(/^Amount arriving/)).toBeInTheDocument();
    expect(screen.getByText(/Leave blank to use today's rate/)).toBeInTheDocument();
  });

  it('does not ask when both sides hold the same currency', async () => {
    const user = userEvent.setup();
    arrange([CASH, WALLET]);
    render(<Harness />);
    await ready();

    await user.click(screen.getByRole('button', { name: 'Transfer' }));

    expect(screen.queryByLabelText(/^Amount arriving/)).toBeNull();
  });

  it('sends what actually landed when it is given, so the bank spread is recorded', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await ready();

    await user.click(screen.getByRole('button', { name: 'Transfer' }));
    await user.type(screen.getByLabelText(/^Amount leaving/), '5000');
    await user.type(screen.getByLabelText(/^Amount arriving/), '99.50');
    await user.click(screen.getByRole('button', { name: 'Add transaction' }));

    await waitFor(() => expect(submitted()).toBeDefined());
    expect(submitted()).toMatchObject({ fromAmount: '5000', toAmount: '99.50' });
  });

  it('never offers the source account as the destination', async () => {
    const user = userEvent.setup();
    arrange([CASH, BANK, WALLET]);
    render(<Harness />);
    await ready();

    await user.click(screen.getByRole('button', { name: 'Transfer' }));
    await user.click(screen.getByLabelText('To account'));

    const listbox = await screen.findByRole('listbox');
    // CASH is the source, so only the other two are offered.
    expect(within(listbox).queryByText('Cash (EGP)')).toBeNull();
    expect(within(listbox).getByText('Bank (USD)')).toBeInTheDocument();
    expect(within(listbox).getByText('Wallet (EGP)')).toBeInTheDocument();
  });

  it('cannot be submitted with only one account to choose from', async () => {
    const user = userEvent.setup();
    arrange([CASH]);
    render(<Harness />);
    await ready();

    await user.click(screen.getByRole('button', { name: 'Transfer' }));
    await user.type(screen.getByLabelText(/^Amount leaving/), '100');

    // Nothing to transfer to, so `toAccountId` never gets set.
    expect(screen.getByRole('button', { name: 'Add transaction' })).toBeDisabled();
  });
});

describe('editing', () => {
  const existing: TransactionDto = {
    id: 'tx-1',
    type: 'EXPENSE',
    // Stored signed; the field shows the magnitude (SPEC §4.7).
    amount: '-250.0000',
    currency: 'EGP',
    rateToEgp: '1.00000000',
    amountEgp: '-250.0000',
    rateAsOf: '2026-08-06T00:00:00.000Z',
    rateIsApproximate: false,
    date: '2026-08-06T00:00:00.000Z',
    note: 'Gianaclis',
    accountId: CASH.id,
    account: {
      id: CASH.id,
      name: CASH.name,
      currency: 'EGP',
      color: CASH.color,
      icon: CASH.icon,
    },
    categoryId: GROCERIES.id,
    category: { id: GROCERIES.id, name: GROCERIES.name, color: GROCERIES.color, icon: 'tag' },
    transferGroupId: null,
    transferCounterpart: null,
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:00.000Z',
  };

  it('shows the magnitude, never the stored negative', async () => {
    render(<Harness editing={existing} />);
    await ready();

    expect(screen.getByLabelText(/^Amount/)).toHaveValue('250');
    expect(screen.getByLabelText('Note')).toHaveValue('Gianaclis');
  });

  it('hides the mode switch, because a type is not editable', async () => {
    render(<Harness editing={existing} />);
    await ready();

    expect(screen.queryByRole('button', { name: 'Transfer' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });

  it('patches only the editable fields', async () => {
    const user = userEvent.setup();
    render(<Harness editing={existing} />);
    await ready();

    const amount = screen.getByLabelText(/^Amount/);
    await user.clear(amount);
    await user.type(amount, '300');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(api.requestsFor('PATCH /transactions/tx-1')).toHaveLength(1));
    expect(api.requestsFor('PATCH /transactions/tx-1')[0]?.body).toEqual({
      amount: '300',
      categoryId: GROCERIES.id,
      date: '2026-08-06',
      note: 'Gianaclis',
    });
  });

  it('sends both sides when the row being edited is a transfer', async () => {
    const user = userEvent.setup();
    const transfer: TransactionDto = {
      ...existing,
      type: 'TRANSFER',
      amount: '-1000.0000',
      categoryId: null,
      category: null,
      transferGroupId: 'grp-1',
      transferCounterpart: {
        id: 'tx-2',
        accountId: BANK.id,
        accountName: BANK.name,
        amount: '20.0000',
        currency: 'USD',
      },
    };

    render(<Harness editing={transfer} />);
    await ready();

    // Cross-currency, so both sides are shown and "Amount" alone would be ambiguous.
    expect(screen.getByLabelText(/^Amount leaving/)).toHaveValue('1000');
    expect(screen.getByLabelText(/^Amount arriving/)).toHaveValue('20');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(api.requestsFor('PATCH /transactions/tx-1')).toHaveLength(1));
    expect(api.requestsFor('PATCH /transactions/tx-1')[0]?.body).toMatchObject({
      fromAmount: '1000',
      toAmount: '20',
    });
  });
});

describe('when the server refuses', () => {
  it('puts a field-level rejection next to the field', async () => {
    const user = userEvent.setup();
    api.setRoute('POST /transactions', {
      status: 422,
      body: {
        error: {
          code: 'UNPROCESSABLE',
          message: 'A negative expense is income. Enter a positive amount.',
          details: { field: 'amount' },
        },
      },
    });

    render(<Harness />);
    await ready();

    await user.type(screen.getByLabelText(/^Amount/), '-10');
    await user.click(screen.getByRole('button', { name: 'Add transaction' }));

    expect(
      await screen.findByText('A negative expense is income. Enter a positive amount.'),
    ).toBeInTheDocument();
    // Still open, so the typed values are not lost.
    expect(screen.getByTestId('open')).toHaveTextContent('true');
  });

  it('shows a whole-form message when the rejection names no field', async () => {
    const user = userEvent.setup();
    api.setRoute('POST /transactions', {
      status: 409,
      body: { error: { code: 'CONFLICT', message: 'That account is archived.' } },
    });

    render(<Harness />);
    await ready();

    await user.type(screen.getByLabelText(/^Amount/), '10');
    await user.click(screen.getByRole('button', { name: 'Add transaction' }));

    expect(await screen.findByText('That account is archived.')).toBeInTheDocument();
  });

  it('closes only once the save has actually succeeded', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await ready();

    expect(screen.getByTestId('open')).toHaveTextContent('true');
    await user.type(screen.getByLabelText(/^Amount/), '10');
    await user.click(screen.getByRole('button', { name: 'Add transaction' }));

    await waitFor(() => expect(screen.getByTestId('open')).toHaveTextContent('false'));
  });
});

describe('backdating', () => {
  it('warns that the conversion will be approximate, without blocking it (D12)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await ready();

    const date = screen.getByLabelText('Date');
    await user.clear(date);
    await user.type(date, '2026-03-12');

    expect(screen.getByText(/marked as approximate/)).toBeInTheDocument();
    // Informative, not a blocker.
    await user.type(screen.getByLabelText(/^Amount/), '100');
    expect(screen.getByRole('button', { name: 'Add transaction' })).toBeEnabled();
  });

  it('says nothing for today', async () => {
    render(<Harness />);
    await ready();

    expect(screen.queryByText(/marked as approximate/)).toBeNull();
  });
});
