import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { AccountDto, CategoryDto, TransactionDto } from '@ledger/shared';
import { stubApi, type ApiStub } from '@/test/http';
import { account, category, transaction } from '@/test/fixtures';
import { TooltipProvider } from '@/components/ui/tooltip';
import { dismissFailure, getFailures } from '@/lib/action-feedback';
import { TransactionsPage } from './TransactionsPage';

/**
 * The filters live in the URL, not in `useState`.
 *
 * That is the whole point of this file. They used to be component state, which meant every
 * `?accountId=…` link — the account cards, the dashboard categories — navigated here and
 * then showed everything, looking exactly like a filter that had silently failed. Most of
 * what follows is about the URL going in and coming back out.
 */

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="search">{location.search}</output>;
}

function Harness({ initialUrl = '/transactions' }: { initialUrl?: string }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[initialUrl]}>
          <TransactionsPage />
          <LocationProbe />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

const CASH = account({ id: 'acc-egp', name: 'Cash (EGP)' });
const BANK = account({ id: 'acc-usd', name: 'Bank (USD)', currency: 'USD' });
const GROCERIES = category({ id: 'cat-food', name: 'Groceries' });

const ROWS: TransactionDto[] = [
  transaction({
    id: 'tx-1',
    amount: '-1674.0000',
    amountEgp: '-1674.0000',
    date: '2026-08-06T09:00:00.000Z',
    categoryId: GROCERIES.id,
    category: { id: GROCERIES.id, name: 'Groceries', color: '#b4553f', icon: 'tag' },
    note: 'Gianaclis',
  }),
  transaction({
    id: 'tx-2',
    type: 'INCOME',
    amount: '8860.0000',
    amountEgp: '8860.0000',
    date: '2026-08-04T09:00:00.000Z',
  }),
];

let api: ApiStub;

function arrange(
  rows: TransactionDto[] = ROWS,
  meta = { page: 1, pageSize: 25, total: rows.length, totalPages: 1 },
  accounts: AccountDto[] = [CASH, BANK],
  categories: CategoryDto[] = [GROCERIES],
) {
  api?.restore();
  api = stubApi({
    'GET /transactions': { data: rows, meta },
    'GET /accounts': { data: accounts },
    'GET /categories': { data: categories },
    'DELETE /transactions/tx-1': { id: 'tx-1' },
    'DELETE /transactions/tx-2': { id: 'tx-2' },
    'PATCH /transactions/tx-1': rows[0] ?? {},
    'PATCH /transactions/tx-2': rows[1] ?? {},
  });
}

const listQueries = () => api.requestsFor('GET /transactions');
const lastQuery = () => listQueries()[listQueries().length - 1]?.query;
const search = () => screen.getByTestId('search').textContent ?? '';

/** The list renders skeletons first, so wait for a row before asserting on the table. */
const rowsShown = () => screen.findAllByText('Gianaclis');

/**
 * The page renders the desktop table *and* the mobile grouped list, hiding one with a
 * Tailwind breakpoint. jsdom resolves no media queries, so both are in the DOM and every
 * row's text is found twice — assertions about a row scope to the table.
 */
const table = () => within(screen.getByRole('table'));

beforeEach(() => {
  arrange();
});

afterEach(() => {
  api.restore();
  for (const failure of getFailures()) dismissFailure(failure.id);
});

describe('filters arriving in the URL', () => {
  it('applies an account filter it was linked with', async () => {
    arrange();
    render(<Harness initialUrl="/transactions?accountId=acc-usd" />);

    await waitFor(() => expect(listQueries().length).toBeGreaterThan(0));
    expect(listQueries()[0]?.query.get('accountId')).toBe('acc-usd');
  });

  it('applies every filter a link can carry, not just the first', async () => {
    arrange();
    render(
      <Harness initialUrl="/transactions?type=EXPENSE&categoryId=cat-food&from=2026-08-01&to=2026-08-31&currency=USD&q=tea&minAmount=10&maxAmount=500" />,
    );

    await waitFor(() => expect(listQueries().length).toBeGreaterThan(0));
    const query = listQueries()[0]?.query;

    expect(query?.get('type')).toBe('EXPENSE');
    expect(query?.get('categoryId')).toBe('cat-food');
    expect(query?.get('from')).toBe('2026-08-01');
    expect(query?.get('to')).toBe('2026-08-31');
    expect(query?.get('currency')).toBe('USD');
    expect(query?.get('q')).toBe('tea');
    expect(query?.get('minAmount')).toBe('10');
    expect(query?.get('maxAmount')).toBe('500');
  });

  it('counts what arrived, so the state is visible rather than silent', async () => {
    arrange();
    render(<Harness initialUrl="/transactions?accountId=acc-usd&type=EXPENSE" />);

    const filters = await screen.findByRole('button', { name: /Filters/ });
    expect(filters).toHaveTextContent('2');
  });

  /** `page` is bookkeeping, not something you chose, so it must not read as a filter. */
  it('does not count the page as a filter', async () => {
    arrange(ROWS, { page: 2, pageSize: 25, total: 30, totalPages: 2 });
    render(<Harness initialUrl="/transactions?page=2" />);

    const filters = await screen.findByRole('button', { name: /Filters/ });
    expect(filters).not.toHaveTextContent('1');
  });

  /**
   * `new` and `amount` belong to the add sheet. Asserted on the request rather than the
   * badge, because the open sheet is modal and hides the page behind it from role queries.
   */
  it('never sends the sheet parameters to the API as filters', async () => {
    arrange();
    render(<Harness initialUrl="/transactions?new=1&amount=500.00" />);

    await waitFor(() => expect(listQueries().length).toBeGreaterThan(0));
    const query = listQueries()[0]?.query;

    expect(query?.get('new')).toBeNull();
    expect(query?.get('amount')).toBeNull();
    // Only the pagination the page always sends.
    expect([...(query?.keys() ?? [])].sort()).toEqual(['page', 'pageSize']);
  });
});

describe('filters written back to the URL', () => {
  it('puts a typed search in the address, so the view can be shared or reloaded', async () => {
    const user = userEvent.setup();
    arrange();
    render(<Harness />);
    await rowsShown();

    await user.type(screen.getByLabelText('Search notes'), 'tea');

    await waitFor(() => expect(search()).toContain('q=tea'));
  });

  it('sends it to the API too', async () => {
    const user = userEvent.setup();
    arrange();
    render(<Harness />);
    await rowsShown();

    await user.type(screen.getByLabelText('Search notes'), 'tea');

    await waitFor(() => expect(lastQuery()?.get('q')).toBe('tea'));
  });

  it('drops a cleared filter from the URL rather than leaving it empty', async () => {
    const user = userEvent.setup();
    arrange();
    render(<Harness initialUrl="/transactions?q=tea" />);
    await rowsShown();

    await user.clear(screen.getByLabelText('Search notes'));

    await waitFor(() => expect(search()).not.toContain('q='));
  });

  it('clears everything at once, and says so only while there is something to clear', async () => {
    const user = userEvent.setup();
    arrange();
    render(<Harness initialUrl="/transactions?accountId=acc-usd&type=EXPENSE" />);
    await rowsShown();

    await user.click(screen.getByRole('button', { name: /^Clear/ }));

    await waitFor(() => expect(search()).not.toContain('accountId'));
    expect(search()).not.toContain('type=');
    expect(screen.queryByRole('button', { name: /^Clear/ })).toBeNull();
  });

  it('returns to the first page when a filter changes', async () => {
    const user = userEvent.setup();
    arrange(ROWS, { page: 2, pageSize: 25, total: 30, totalPages: 2 });
    render(<Harness initialUrl="/transactions?page=2" />);
    await rowsShown();

    await user.type(screen.getByLabelText('Search notes'), 'tea');

    // Page 2 of the old result set is meaningless against a new one.
    await waitFor(() => expect(search()).not.toContain('page=2'));
  });

  it('offers Uncategorised as a filter, since it is a real bucket with no id', async () => {
    const user = userEvent.setup();
    arrange();
    render(<Harness />);
    await rowsShown();

    await user.click(screen.getByRole('button', { name: /Filters/ }));
    await user.click(screen.getByLabelText('Category'));

    expect(await screen.findByRole('option', { name: 'Uncategorised' })).toBeInTheDocument();
  });
});

describe('the rows', () => {
  it('names a category, and says Uncategorised rather than leaving it blank', async () => {
    arrange();
    render(<Harness />);

    await rowsShown();
    expect(table().getByText('Groceries')).toBeInTheDocument();
    expect(table().getByText('Uncategorised')).toBeInTheDocument();
  });

  it('calls a transfer a transfer, and names the other side', async () => {
    arrange([
      transaction({
        id: 'tx-3',
        type: 'TRANSFER',
        amount: '-500.0000',
        note: 'Gianaclis',
        transferGroupId: 'grp-1',
        transferCounterpart: {
          id: 'tx-4',
          accountId: BANK.id,
          accountName: 'Bank (USD)',
          amount: '10.0000',
          currency: 'USD',
        },
      }),
    ]);
    render(<Harness />);

    await rowsShown();
    // Negative side, so the money went *to* the counterpart.
    expect(table().getByText(/Transfer/)).toBeInTheDocument();
    expect(table().getByText('Bank (USD)', { selector: 'span' })).toBeInTheDocument();
  });

  it('flags a row converted at a rate from after the fact (D12)', async () => {
    arrange([
      transaction({
        id: 'tx-5',
        note: 'Gianaclis',
        currency: 'USD',
        amount: '-20.0000',
        amountEgp: '-1000.0000',
        date: '2026-03-12T00:00:00.000Z',
        rateAsOf: '2026-08-03T00:00:00.000Z',
        rateIsApproximate: true,
      }),
    ]);
    render(<Harness />);

    await rowsShown();
    expect(table().getByText('Converted with an approximate rate')).toBeInTheDocument();
  });

  it('leaves an exact row unflagged', async () => {
    arrange();
    render(<Harness />);

    await rowsShown();
    expect(table().queryByText('Converted with an approximate rate')).toBeNull();
  });

  it('shows the pound equivalent only for a foreign row', async () => {
    arrange([
      transaction({
        id: 'tx-6',
        note: 'Gianaclis',
        currency: 'USD',
        amount: '-20.0000',
        amountEgp: '-1000.0000',
      }),
    ]);
    render(<Harness />);

    await rowsShown();
    expect(table().getByText('-1,000.00 EGP')).toBeInTheDocument();
  });

  it('captions the table for a screen reader', async () => {
    arrange();
    render(<Harness />);

    await rowsShown();
    expect(screen.getByText('Transactions, newest first')).toBeInTheDocument();
  });
});

describe('with nothing to show', () => {
  it('allows for both an empty ledger and an over-tight filter', async () => {
    arrange([], { page: 1, pageSize: 25, total: 0, totalPages: 0 });
    render(<Harness />);

    expect(await screen.findByText('No transactions here')).toBeInTheDocument();
    expect(screen.getByText(/no row matches these filters/)).toBeInTheDocument();
  });
});

describe('bulk actions', () => {
  it('selects every row on the page at once', async () => {
    const user = userEvent.setup();
    arrange();
    render(<Harness />);
    await rowsShown();

    await user.click(screen.getByRole('checkbox', { name: 'Select all rows on this page' }));

    expect(await screen.findByText('2 selected')).toBeInTheDocument();
  });

  it('deletes them one at a time, because a transfer takes its partner with it', async () => {
    const user = userEvent.setup();
    arrange();
    render(<Harness />);
    await rowsShown();

    await user.click(screen.getByRole('checkbox', { name: 'Select all rows on this page' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(api.requestsFor('DELETE /transactions/tx-1')).toHaveLength(1);
      expect(api.requestsFor('DELETE /transactions/tx-2')).toHaveLength(1);
    });
  });

  /** The partner row of a transfer is already gone by the time its turn comes. */
  it('treats a 404 during a bulk delete as expected, not as a failure', async () => {
    const user = userEvent.setup();
    arrange();
    api.setRoute('DELETE /transactions/tx-2', {
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: 'That record does not exist.' } },
    });
    render(<Harness />);
    await rowsShown();

    await user.click(screen.getByRole('checkbox', { name: 'Select all rows on this page' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(api.requestsFor('DELETE /transactions/tx-2')).toHaveLength(1));
    expect(getFailures()).toHaveLength(0);
  });

  it('reports a real failure with a count rather than one message per row', async () => {
    const user = userEvent.setup();
    arrange();
    api.setRoute('DELETE /transactions/tx-1', {
      status: 500,
      body: { error: { code: 'X', message: 'Database unavailable.' } },
    });
    api.setRoute('DELETE /transactions/tx-2', {
      status: 500,
      body: { error: { code: 'X', message: 'Database unavailable.' } },
    });
    render(<Harness />);
    await rowsShown();

    await user.click(screen.getByRole('checkbox', { name: 'Select all rows on this page' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(getFailures()).toHaveLength(1));
    expect(getFailures()[0]).toMatchObject({
      headline: '2 transactions could not be deleted.',
      detail: 'Database unavailable.',
    });
  });

  it('recategorises the selection', async () => {
    const user = userEvent.setup();
    arrange();
    render(<Harness />);
    await rowsShown();

    await user.click(screen.getByRole('checkbox', { name: 'Select all rows on this page' }));
    await user.click(screen.getByLabelText('Recategorise selected'));
    await user.click(await screen.findByRole('option', { name: 'Groceries' }));

    await waitFor(() => expect(api.requestsFor('PATCH /transactions/tx-1')).toHaveLength(1));
    expect(api.requestsFor('PATCH /transactions/tx-1')[0]?.body).toEqual({
      categoryId: GROCERIES.id,
    });
  });

  /** An expense cannot take an income category, so a partial result is the normal outcome. */
  it('counts the rows that kept their category rather than failing silently', async () => {
    const user = userEvent.setup();
    arrange();
    api.setRoute('PATCH /transactions/tx-2', {
      status: 422,
      body: { error: { code: 'UNPROCESSABLE', message: 'That category is for expenses.' } },
    });
    render(<Harness />);
    await rowsShown();

    await user.click(screen.getByRole('checkbox', { name: 'Select all rows on this page' }));
    await user.click(screen.getByLabelText('Recategorise selected'));
    await user.click(await screen.findByRole('option', { name: 'Groceries' }));

    await waitFor(() => expect(getFailures()).toHaveLength(1));
    expect(getFailures()[0]).toMatchObject({
      headline: 'One transaction kept its category.',
      detail: 'That category is for expenses.',
    });
  });

  it('clears the selection when asked', async () => {
    const user = userEvent.setup();
    arrange();
    render(<Harness />);
    await rowsShown();

    await user.click(screen.getByRole('checkbox', { name: 'Select all rows on this page' }));
    await user.click(await screen.findByRole('button', { name: 'Clear' }));

    expect(screen.queryByText('2 selected')).toBeNull();
  });
});

describe('the add sheet', () => {
  it('opens from `?new=1`, which is the one way in', async () => {
    arrange();
    render(<Harness initialUrl="/transactions?new=1" />);

    expect(await screen.findByText('Add a transaction')).toBeInTheDocument();
  });

  it('opens on `n` and puts it in the URL', async () => {
    const user = userEvent.setup();
    arrange();
    render(<Harness />);
    await rowsShown();

    await user.keyboard('n');

    expect(await screen.findByText('Add a transaction')).toBeInTheDocument();
    expect(search()).toContain('new=1');
  });

  it('leaves `n` alone while you are typing in a field', async () => {
    const user = userEvent.setup();
    arrange();
    render(<Harness />);
    await rowsShown();

    await user.click(screen.getByLabelText('Search notes'));
    await user.keyboard('n');

    expect(screen.getByLabelText('Search notes')).toHaveValue('n');
    expect(screen.queryByText('Add a transaction')).toBeNull();
  });

  it('takes the amount the calculator handed over', async () => {
    arrange();
    render(<Harness initialUrl="/transactions?new=1&amount=500.00" />);

    await screen.findByText('Add a transaction');
    expect(screen.getByLabelText(/^Amount/)).toHaveValue('500.00');
  });

  it('clears both parameters on close, so reopening does not reuse the amount', async () => {
    const user = userEvent.setup();
    arrange();
    render(<Harness initialUrl="/transactions?new=1&amount=500.00" />);
    await screen.findByText('Add a transaction');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(search()).not.toContain('new=1'));
    expect(search()).not.toContain('amount=');
  });
});

describe('pagination', () => {
  it('stays hidden when everything fits on one page', async () => {
    arrange();
    render(<Harness />);

    await rowsShown();
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
  });

  it('states where you are and how much there is', async () => {
    arrange(ROWS, { page: 1, pageSize: 25, total: 30, totalPages: 2 });
    render(<Harness />);

    await rowsShown();
    const nav = screen.getByRole('navigation', { name: 'Pagination' });
    expect(within(nav).getByText('30')).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'Previous' })).toBeDisabled();
  });

  it('puts the page in the URL, so a reload keeps your place', async () => {
    const user = userEvent.setup();
    arrange(ROWS, { page: 1, pageSize: 25, total: 30, totalPages: 2 });
    render(<Harness />);
    await rowsShown();

    await user.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(search()).toContain('page=2'));
  });

  it('leaves page 1 out of the URL, since it is the default', async () => {
    const user = userEvent.setup();
    arrange(ROWS, { page: 2, pageSize: 25, total: 30, totalPages: 2 });
    render(<Harness initialUrl="/transactions?page=2" />);
    await rowsShown();

    await user.click(screen.getByRole('button', { name: 'Previous' }));

    await waitFor(() => expect(search()).not.toContain('page='));
  });
});
