import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { BudgetMonthDto } from '@ledger/shared';
import { stubApi, type ApiStub } from '@/test/http';
import { budgetMonth, budgetRow } from '@/test/fixtures';
import { BudgetsPage } from './BudgetsPage';

/**
 * The page is a bulk editor, so most of these are about the PUT: every category goes in
 * one request, and a cleared limit goes as `null` rather than `"0"` — "no budget" and
 * "budget of nothing" are different statements and the schema says so.
 *
 * The limits being edited are held as drafts, separate from the server figures, so that a
 * refetch mid-edit cannot overwrite what is half-typed. Several tests below only make
 * sense because of that split.
 */

/**
 * A `<span>`, not an `<output>`: this page already has a live region reporting what a copy
 * did, and an `<output>` would be a second `role="status"` for `getByRole` to trip over.
 */
function LocationProbe() {
  const location = useLocation();
  return <span data-testid="search">{location.search}</span>;
}

function Harness({ initialUrl = '/budgets' }: { initialUrl?: string }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialUrl]}>
        <BudgetsPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const RENT = budgetRow({ categoryId: 'cat-rent', categoryName: 'Rent' });
const FOOD = budgetRow({ categoryId: 'cat-food', categoryName: 'Groceries' });

let api: ApiStub;

function arrange(month: BudgetMonthDto) {
  api?.restore();
  api = stubApi({
    'GET /budgets': month,
    'PUT /budgets': month,
    'POST /budgets/copy': { copied: 2, skipped: 1, month },
  });
}

const saved = () => api.requestsFor('PUT /budgets')[0]?.body;

/** Async: the rows only exist once the month query has landed. */
const findLimitFor = (name: string) =>
  screen.findByLabelText(`Monthly limit for ${name}, in pounds`);
const limitFor = (name: string) => screen.getByLabelText(`Monthly limit for ${name}, in pounds`);

afterEach(() => {
  api.restore();
});

describe('with no expense categories', () => {
  it('points at where categories are made rather than showing an empty grid', async () => {
    arrange(budgetMonth());
    render(<Harness />);

    expect(await screen.findByText('No expense categories')).toBeInTheDocument();
    expect(screen.getByText(/Add one in Settings/)).toBeInTheDocument();
  });
});

describe('with nothing budgeted yet', () => {
  it('explains what to do, including that clearing removes rather than zeroes', async () => {
    arrange(budgetMonth({ rows: [RENT, FOOD] }));
    render(<Harness />);

    expect(
      await screen.findByText(/Clearing a limit removes the budget rather than setting it to zero/),
    ).toBeInTheDocument();
  });

  it('leaves every limit field empty, not filled with a zero', async () => {
    arrange(budgetMonth({ rows: [RENT, FOOD] }));
    render(<Harness />);

    expect(await findLimitFor('Rent')).toHaveValue('');
    expect(limitFor('Groceries')).toHaveValue('');
  });

  it('has nothing to save until something is typed', async () => {
    arrange(budgetMonth({ rows: [RENT] }));
    render(<Harness />);

    expect(await screen.findByRole('button', { name: 'Saved' })).toBeDisabled();
  });
});

describe('saving limits', () => {
  it('sends every category in one request, not one call per row', async () => {
    const user = userEvent.setup();
    arrange(budgetMonth({ rows: [RENT, FOOD] }));
    render(<Harness />);

    await user.type(await findLimitFor('Rent'), '9000');
    await user.click(screen.getByRole('button', { name: 'Save limits' }));

    await waitFor(() => expect(saved()).toBeDefined());
    expect(api.requestsFor('PUT /budgets')).toHaveLength(1);
    expect(saved()).toEqual({
      month: expect.any(String),
      budgets: [
        { categoryId: 'cat-rent', limitEgp: '9000' },
        // Untouched categories are still sent, as nulls — the PUT describes the month.
        { categoryId: 'cat-food', limitEgp: null },
      ],
    });
  });

  it('clears a limit as null rather than as a zero', async () => {
    const user = userEvent.setup();
    arrange(
      budgetMonth({
        rows: [
          budgetRow({
            categoryId: 'cat-rent',
            categoryName: 'Rent',
            limitEgp: '9000.0000',
            remainingEgp: '9000.0000',
            usagePct: '0.0000',
          }),
        ],
      }),
    );
    render(<Harness />);

    await user.clear(await findLimitFor('Rent'));
    await user.click(screen.getByRole('button', { name: 'Save limits' }));

    await waitFor(() => expect(saved()).toBeDefined());
    expect(saved()).toMatchObject({ budgets: [{ categoryId: 'cat-rent', limitEgp: null }] });
  });

  it('trims what was typed rather than sending the whitespace', async () => {
    const user = userEvent.setup();
    arrange(budgetMonth({ rows: [RENT] }));
    render(<Harness />);

    await user.type(await findLimitFor('Rent'), '  500  ');
    await user.click(screen.getByRole('button', { name: 'Save limits' }));

    await waitFor(() => expect(saved()).toBeDefined());
    expect(saved()).toMatchObject({ budgets: [{ categoryId: 'cat-rent', limitEgp: '500' }] });
  });

  it('only offers to save once something has actually changed', async () => {
    const user = userEvent.setup();
    arrange(budgetMonth({ rows: [RENT] }));
    render(<Harness />);

    expect(await screen.findByRole('button', { name: 'Saved' })).toBeDisabled();

    await user.type(limitFor('Rent'), '1');
    expect(screen.getByRole('button', { name: 'Save limits' })).toBeEnabled();
  });

  /** A stored `9000.0000` and a typed `9000` are the same limit, and must not read as dirty. */
  it('does not call a stored limit dirty just because it is written with fewer zeroes', async () => {
    arrange(
      budgetMonth({
        rows: [
          budgetRow({
            categoryId: 'cat-rent',
            categoryName: 'Rent',
            limitEgp: '9000.0000',
            remainingEgp: '9000.0000',
            usagePct: '0.0000',
          }),
        ],
      }),
    );
    render(<Harness />);

    expect(await findLimitFor('Rent')).toHaveValue('9000');
    expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled();
  });
});

describe('a category that is over its limit', () => {
  const over = budgetMonth({
    rows: [
      budgetRow({
        categoryId: 'cat-food',
        categoryName: 'Groceries',
        limitEgp: '2000.0000',
        spentEgp: '2500.0000',
        remainingEgp: '-500.0000',
        usagePct: '125.0000',
        isOverBudget: true,
      }),
    ],
    totalLimitEgp: '2000.0000',
    totalSpentEgp: '2500.0000',
    totalRemainingEgp: '-500.0000',
  });

  it('says "over" in words, not only in colour (SPEC §10)', async () => {
    arrange(over);
    render(<Harness />);

    expect(await screen.findByText('Over')).toBeInTheDocument();
  });

  it('states the overspend as a positive figure labelled "over"', async () => {
    arrange(over);
    render(<Harness />);

    // Stored signed as −500; read back as "500.00 over" rather than "−500.00 left".
    expect(await screen.findByText(/500\.00 over/)).toBeInTheDocument();
    expect(screen.queryByText(/-500\.00 left/)).toBeNull();
  });

  it('describes the bar for a screen reader in percentage terms', async () => {
    arrange(over);
    render(<Harness />);

    expect(await screen.findByLabelText('Groceries: 125% of budget used')).toBeInTheDocument();
  });

  it('reads "left" the other way round when under', async () => {
    arrange(
      budgetMonth({
        rows: [
          budgetRow({
            categoryId: 'cat-food',
            categoryName: 'Groceries',
            limitEgp: '2000.0000',
            spentEgp: '500.0000',
            remainingEgp: '1500.0000',
            usagePct: '25.0000',
          }),
        ],
      }),
    );
    render(<Harness />);

    expect(await screen.findByText(/1,500\.00 left/)).toBeInTheDocument();
    expect(screen.queryByText('Over')).toBeNull();
  });
});

describe('copying last month', () => {
  it('asks for the previous month and refuses to overwrite what is already set', async () => {
    const user = userEvent.setup();
    arrange(budgetMonth({ rows: [RENT] }));
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: "Copy last month's" }));

    await waitFor(() => expect(api.requestsFor('POST /budgets/copy')).toHaveLength(1));
    const body = api.requestsFor('POST /budgets/copy')[0]?.body as {
      fromMonth: string;
      toMonth: string;
      overwrite: boolean;
    };

    expect(body.overwrite).toBe(false);
    expect(body.fromMonth).not.toBe(body.toMonth);
  });

  it('reports what it did, including what it left alone', async () => {
    const user = userEvent.setup();
    arrange(budgetMonth({ rows: [RENT] }));
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: "Copy last month's" }));

    expect(await screen.findByRole('status')).toHaveTextContent('Copied 2, left 1 already set.');
  });
});

describe('the month picker', () => {
  it('asks the API for the month it moved to', async () => {
    const user = userEvent.setup();
    arrange(budgetMonth({ rows: [RENT] }));
    render(<Harness />);
    await waitFor(() => expect(api.requestsFor('GET /budgets').length).toBeGreaterThan(0));

    const first = api.requestsFor('GET /budgets')[0]?.query.get('month');
    await user.click(screen.getByRole('button', { name: 'Previous month' }));

    await waitFor(() => {
      const months = api.requestsFor('GET /budgets').map((r) => r.query.get('month'));
      expect(months.filter((month) => month !== first).length).toBeGreaterThan(0);
    });
  });

  /** Unlike the dashboard, a future month is a legitimate thing to budget for. */
  it('lets you budget forwards', async () => {
    arrange(budgetMonth({ rows: [RENT] }));
    render(<Harness />);

    expect(await screen.findByRole('button', { name: 'Next month' })).toBeEnabled();
  });

  /** The month belongs in the URL, for the same reasons the transaction filters do. */
  it('opens on the month it was asked for', async () => {
    arrange(budgetMonth({ rows: [RENT], month: '2026-03' }));
    render(<Harness initialUrl="/budgets?month=2026-03" />);

    await waitFor(() =>
      expect(api.requestsFor('GET /budgets')[0]?.query.get('month')).toBe('2026-03'),
    );
    expect(screen.getByText('March 2026')).toBeInTheDocument();
  });

  it('writes the month back so the screen can be linked to', async () => {
    const user = userEvent.setup();
    arrange(budgetMonth({ rows: [RENT] }));
    render(<Harness />);

    await findLimitFor('Rent');
    await user.click(screen.getByRole('button', { name: 'Previous month' }));

    await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent('month='));
  });
});

/**
 * The three totals describe the *budgets*, not the month. On a real ledger those are
 * different numbers by an order of magnitude — "spent 100, 1,700 left" while nine thousand
 * pounds went out uncategorised — and a screen that only reports the flattering half is
 * worse than one that reports nothing.
 */
describe('spending the budgets cannot see', () => {
  const withUnbudgeted = budgetMonth({
    rows: [RENT],
    totalLimitEgp: '1800.0000',
    totalSpentEgp: '100.0000',
    totalRemainingEgp: '1700.0000',
    unbudgetedSpentEgp: '9323.8400',
    uncategorisedSpentEgp: '9323.8400',
  });

  it('states what went out beyond the budgeted categories', async () => {
    arrange(withUnbudgeted);
    render(<Harness />);

    expect(await screen.findByText(/9,323\.84 EGP/)).toBeInTheDocument();
    expect(screen.getByText(/outside these budgets/)).toBeInTheDocument();
  });

  it('names the uncategorised part, which is the part you can act on', async () => {
    arrange(withUnbudgeted);
    render(<Harness />);

    await screen.findByText(/outside these budgets/);
    expect(screen.getByText(/with no category at all/)).toBeInTheDocument();
  });

  it('links straight to those transactions, scoped to the month', async () => {
    arrange(budgetMonth({ ...withUnbudgeted, month: '2026-03' }));
    render(<Harness initialUrl="/budgets?month=2026-03" />);

    const link = await screen.findByRole('link', { name: 'Give those a category' });
    expect(link).toHaveAttribute(
      'href',
      '/transactions?type=EXPENSE&categoryId=none&from=2026-03-01&to=2026-03-31',
    );
  });

  /** Nothing to report is not a figure worth a line of its own. */
  it('says nothing when every pound spent is inside a budget', async () => {
    arrange(
      budgetMonth({
        rows: [RENT],
        totalLimitEgp: '1800.0000',
        totalSpentEgp: '100.0000',
        totalRemainingEgp: '1700.0000',
      }),
    );
    render(<Harness />);

    await findLimitFor('Rent');
    expect(screen.queryByText(/outside these budgets/)).toBeNull();
  });

  /**
   * Unbudgeted is not the same as uncategorised: spending in a category with no limit is
   * already labelled, so there is nothing to go and fix and no link to offer.
   */
  it('drops the link when the spending already has categories', async () => {
    arrange(
      budgetMonth({
        rows: [RENT],
        totalLimitEgp: '1800.0000',
        totalSpentEgp: '100.0000',
        totalRemainingEgp: '1700.0000',
        unbudgetedSpentEgp: '2500.0000',
        uncategorisedSpentEgp: '0.0000',
      }),
    );
    render(<Harness />);

    expect(await screen.findByText(/2,500\.00 EGP/)).toBeInTheDocument();
    expect(screen.queryByText(/with no category at all/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Give those a category' })).toBeNull();
  });
});

describe('the totals', () => {
  it('shows budgeted, spent and left across the month', async () => {
    arrange(
      budgetMonth({
        rows: [RENT],
        totalLimitEgp: '9000.0000',
        totalSpentEgp: '2500.0000',
        totalRemainingEgp: '6500.0000',
      }),
    );
    render(<Harness />);

    const budgeted = (await screen.findByText('Budgeted')).closest('article');
    const spent = screen.getByText('Spent').closest('article');
    const left = screen.getByText('Left').closest('article');

    expect(within(budgeted as HTMLElement).getByText(/9,000\.00/)).toBeInTheDocument();
    expect(within(spent as HTMLElement).getByText(/2,500\.00/)).toBeInTheDocument();
    expect(within(left as HTMLElement).getByText(/6,500\.00/)).toBeInTheDocument();
  });
});
