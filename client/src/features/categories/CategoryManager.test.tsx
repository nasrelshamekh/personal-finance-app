import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CategoryDto } from '@ledger/shared';
import { stubApi, type ApiStub } from '@/test/http';
import { category } from '@/test/fixtures';
import { CategoryManager } from './CategoryManager';

/**
 * Categories nest exactly one level (SPEC §5), and a category with history is archived
 * rather than deleted — so the destructive button says "archive" and sends DELETE, letting
 * the server pick which of the two it means. Promising a deletion the server will refuse
 * would be worse than naming the outcome up front.
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
      <CategoryManager />
    </QueryClientProvider>
  );
}

const RENT = category({ id: 'cat-rent', name: 'Rent' });
const SALARY = category({ id: 'cat-salary', name: 'Salary', kind: 'INCOME' });
const FOOD = category({
  id: 'cat-food',
  name: 'Food',
  children: [category({ id: 'cat-groceries', name: 'Groceries', parentId: 'cat-food' })],
});

let api: ApiStub;

function arrange(categories: CategoryDto[]) {
  api?.restore();
  api = stubApi({
    'GET /categories': { data: categories },
    'POST /categories': { status: 201, body: categories[0] ?? {} },
    'PATCH /categories/cat-rent': categories[0] ?? {},
    'DELETE /categories/cat-rent': { outcome: 'archived', category: categories[0] ?? {} },
  });
}

const createdBody = () => api.requestsFor('POST /categories')[0]?.body;

/**
 * Category names appear twice — once as a row, once as an option in the "Under" select —
 * so anything looking for a row has to say so. These helpers keep that explicit.
 */
const sectionFor = (kind: 'Expense' | 'Income') =>
  screen.getByRole('heading', { name: kind }).closest('section') as HTMLElement;

const parentOptions = () =>
  within(screen.getByLabelText('Under'))
    .getAllByRole('option')
    .map((option) => option.textContent);

/** Waits for the tree to arrive; the selects and headings render before it does. */
const ready = () =>
  waitFor(() => expect(api.requestsFor('GET /categories').length).toBeGreaterThan(0));

beforeEach(() => {
  arrange([RENT, SALARY]);
});

afterEach(() => {
  api.restore();
});

describe('the two kinds', () => {
  it('lists income and expense separately, because they never mix in a tree', async () => {
    arrange([RENT, SALARY]);
    render(<Harness />);

    // "Expense" is also an option in the Kind select, so ask for the heading.
    await screen.findByRole('button', { name: 'Rename Rent' });

    expect(within(sectionFor('Expense')).getByText('Rent')).toBeInTheDocument();
    expect(within(sectionFor('Income')).getByText('Salary')).toBeInTheDocument();
  });

  it('says what belongs in each when it is empty', async () => {
    arrange([]);
    render(<Harness />);

    expect(await screen.findByText(/Rent, groceries, transport/)).toBeInTheDocument();
    expect(screen.getByText(/Salary and anything else that arrives/)).toBeInTheDocument();
  });
});

describe('adding one', () => {
  it('sends the name, kind and colour, with no parent by default', async () => {
    const user = userEvent.setup();
    arrange([RENT, SALARY]);
    render(<Harness />);

    await user.type(await screen.findByLabelText('Add a category'), 'Transport');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(createdBody()).toBeDefined());
    expect(createdBody()).toEqual({
      name: 'Transport',
      kind: 'EXPENSE',
      color: expect.any(String),
      icon: 'tag',
      parentId: null,
    });
  });

  it('trims the name rather than storing the spaces', async () => {
    const user = userEvent.setup();
    arrange([RENT]);
    render(<Harness />);

    await user.type(await screen.findByLabelText('Add a category'), '  Transport  ');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(createdBody()).toBeDefined());
    expect(createdBody()).toMatchObject({ name: 'Transport' });
  });

  it('clears the field afterwards, so the next one can be typed straight away', async () => {
    const user = userEvent.setup();
    arrange([RENT]);
    render(<Harness />);

    const field = await screen.findByLabelText('Add a category');
    await user.type(field, 'Transport');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(field).toHaveValue(''));
  });

  it('will not add a category with no name', async () => {
    arrange([RENT]);
    render(<Harness />);

    expect(await screen.findByRole('button', { name: 'Add' })).toBeDisabled();
  });

  it('nests under a parent of the same kind', async () => {
    const user = userEvent.setup();
    arrange([RENT, SALARY]);
    render(<Harness />);
    await ready();

    await user.selectOptions(screen.getByLabelText('Kind'), 'INCOME');
    await user.type(screen.getByLabelText('Add a category'), 'Bonus');
    await user.selectOptions(screen.getByLabelText('Under'), 'cat-salary');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(createdBody()).toBeDefined());
    expect(createdBody()).toMatchObject({ kind: 'INCOME', parentId: 'cat-salary' });
  });

  it('locks the kind selector while a parent is chosen', async () => {
    const user = userEvent.setup();
    arrange([RENT, SALARY]);
    render(<Harness />);
    await waitFor(() => expect(parentOptions()).toContain('Rent'));

    expect(screen.getByLabelText('Kind')).toBeEnabled();
    await user.selectOptions(screen.getByLabelText('Under'), 'cat-rent');

    // The parent's kind now decides, so offering the choice again would be a lie.
    expect(screen.getByLabelText('Kind')).toBeDisabled();
  });

  /** One level only (SPEC §5): a child can never itself be a parent. */
  it('never offers a child as a parent', async () => {
    arrange([FOOD]);
    render(<Harness />);
    await ready();

    await waitFor(() => expect(parentOptions()).toContain('Food'));
    expect(parentOptions()).not.toContain('Groceries');
  });

  it('offers only parents of the matching kind', async () => {
    const user = userEvent.setup();
    arrange([RENT, SALARY]);
    render(<Harness />);
    await ready();

    await waitFor(() => expect(parentOptions()).toContain('Rent'));
    expect(parentOptions()).not.toContain('Salary');

    await user.selectOptions(screen.getByLabelText('Kind'), 'INCOME');

    expect(parentOptions()).toContain('Salary');
    expect(parentOptions()).not.toContain('Rent');
  });
});

describe('renaming', () => {
  it('swaps the row for a field, and saves on Enter', async () => {
    const user = userEvent.setup();
    arrange([RENT]);
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Rename Rent' }));
    const field = screen.getByRole('textbox', { name: 'Rename Rent' });
    await user.clear(field);
    await user.type(field, 'Housing{Enter}');

    await waitFor(() => expect(api.requestsFor('PATCH /categories/cat-rent')).toHaveLength(1));
    expect(api.requestsFor('PATCH /categories/cat-rent')[0]?.body).toEqual({ name: 'Housing' });
  });

  it('abandons the rename on Escape without saving', async () => {
    const user = userEvent.setup();
    arrange([RENT]);
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Rename Rent' }));
    await user.type(screen.getByRole('textbox', { name: 'Rename Rent' }), 'x{Escape}');

    // The button carries the same label as the field, so ask for the field specifically.
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Rename Rent' })).toBeNull());
    expect(api.requestsFor('PATCH /categories/cat-rent')).toHaveLength(0);
  });

  it('refuses to save an empty name', async () => {
    const user = userEvent.setup();
    arrange([RENT]);
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Rename Rent' }));
    await user.clear(screen.getByRole('textbox', { name: 'Rename Rent' }));
    await user.click(screen.getByRole('button', { name: 'Save the new name' }));

    expect(api.requestsFor('PATCH /categories/cat-rent')).toHaveLength(0);
  });
});

describe('archiving', () => {
  it('sends DELETE and lets the server archive or remove', async () => {
    const user = userEvent.setup();
    arrange([RENT]);
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Archive Rent' }));

    await waitFor(() => expect(api.requestsFor('DELETE /categories/cat-rent')).toHaveLength(1));
  });

  it('restores by clearing the flag instead', async () => {
    const user = userEvent.setup();
    arrange([{ ...RENT, isArchived: true }]);
    render(<Harness />);

    await user.click(await screen.findByLabelText('Show archived categories'));
    await user.click(await screen.findByRole('button', { name: 'Restore Rent' }));

    await waitFor(() => expect(api.requestsFor('PATCH /categories/cat-rent')).toHaveLength(1));
    expect(api.requestsFor('PATCH /categories/cat-rent')[0]?.body).toEqual({ isArchived: false });
  });

  it('reports a refusal inline rather than silently', async () => {
    const user = userEvent.setup();
    arrange([RENT]);
    api.setRoute('DELETE /categories/cat-rent', {
      status: 409,
      body: { error: { code: 'CONFLICT', message: 'That category still has children.' } },
    });
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Archive Rent' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That category still has children.');
  });
});

describe('archived categories', () => {
  it('leaves them out until asked for', async () => {
    const user = userEvent.setup();
    arrange([RENT]);
    render(<Harness />);

    await waitFor(() => expect(api.requestsFor('GET /categories').length).toBeGreaterThan(0));
    expect(api.requestsFor('GET /categories')[0]?.query.get('includeArchived')).toBe('false');

    await user.click(screen.getByLabelText('Show archived categories'));

    await waitFor(() => {
      const flags = api.requestsFor('GET /categories').map((r) => r.query.get('includeArchived'));
      expect(flags).toContain('true');
    });
  });
});

describe('nesting', () => {
  it('shows a child under its parent, each manageable in its own right', async () => {
    arrange([FOOD]);
    render(<Harness />);

    // "Food" is also a parent option, so scope to the list.
    await screen.findByRole('button', { name: 'Rename Food' });
    const expense = sectionFor('Expense');

    expect(within(expense).getByText('Food')).toBeInTheDocument();
    expect(within(expense).getByText('Groceries')).toBeInTheDocument();
    expect(within(expense).getByRole('button', { name: 'Archive Groceries' })).toBeInTheDocument();
  });

  it('shows how many transactions a category is holding', async () => {
    arrange([category({ id: 'cat-rent', name: 'Rent', transactionCount: 4 })]);
    render(<Harness />);

    expect(await screen.findByText('4 used')).toBeInTheDocument();
  });
});
