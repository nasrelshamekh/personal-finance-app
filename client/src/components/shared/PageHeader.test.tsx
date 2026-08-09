import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageHeader } from './PageHeader';

/**
 * Every screen opens with one of these, so it is the top of the heading outline a screen
 * reader navigates by — `h2`, under the app's single `h1`.
 */

describe('the title', () => {
  it('is the page heading', () => {
    render(<PageHeader title="Transactions" />);

    expect(screen.getByRole('heading', { level: 2, name: 'Transactions' })).toBeInTheDocument();
  });

  it('is set in the display size from the type scale', () => {
    render(<PageHeader title="Transactions" />);

    expect(screen.getByRole('heading', { level: 2 })).toHaveClass('text-2xl');
  });
});

describe('the description', () => {
  it('renders when there is something worth saying', () => {
    render(
      <PageHeader
        title="Budgets"
        description="A limit per category, per month. Only categories you have set a limit for are counted."
      />,
    );

    expect(screen.getByText(/A limit per category, per month/)).toBeInTheDocument();
  });

  /** Optional, and absent means absent — not an empty paragraph holding vertical space. */
  it('leaves nothing behind when omitted', () => {
    const { container } = render(<PageHeader title="Budgets" />);

    expect(container.querySelectorAll('p')).toHaveLength(0);
  });
});

describe('the actions', () => {
  it('renders the controls it is handed', () => {
    render(
      <PageHeader
        title="Accounts"
        actions={
          <>
            <button type="button">Add account</button>
            <button type="button">Show archived</button>
          </>
        }
      />,
    );

    expect(screen.getByRole('button', { name: 'Add account' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show archived' })).toBeInTheDocument();
  });

  /**
   * The heading comes first in the DOM whatever the layout puts on the right, so tabbing
   * into a page does not land on its buttons before its title has been read.
   */
  it('comes after the title in reading order', () => {
    render(
      <PageHeader title="Accounts" actions={<button type="button">Add account</button>} />,
    );

    const heading = screen.getByRole('heading', { level: 2 });
    const action = screen.getByRole('button');

    expect(heading.compareDocumentPosition(action)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('leaves nothing behind when omitted', () => {
    render(<PageHeader title="Accounts" />);

    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('the landmark', () => {
  /** A `<header>` inside `<main>` is a banner only at the top level, so this is generic. */
  it('is a header element rather than a bare div', () => {
    const { container } = render(<PageHeader title="Accounts" />);

    expect(container.querySelector('header')).not.toBeNull();
  });
});
