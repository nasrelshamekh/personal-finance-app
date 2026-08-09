import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Wallet } from 'lucide-react';
import { EmptyState } from './EmptyState';

/**
 * The screen a new ledger shows more than any other, so it has to do work rather than
 * announce a void. SPEC §10's quality floor: an empty state says what goes here and how to
 * put something in it — never just "nothing here".
 */

describe('the copy', () => {
  it('names what is missing and what to do about it', () => {
    render(
      <EmptyState
        icon={Wallet}
        title="No accounts yet"
        description="Add the cash, bank or wallet you actually keep money in, and its balances will follow."
      />,
    );

    expect(screen.getByRole('heading', { name: 'No accounts yet' })).toBeInTheDocument();
    expect(screen.getByText(/Add the cash, bank or wallet/)).toBeInTheDocument();
  });

  /**
   * Level 3, under the page's `h2` from `PageHeader`. An `h1` here would outrank the page
   * title and break the outline a screen reader navigates by.
   */
  it('sits under the page title in the heading outline', () => {
    render(<EmptyState icon={Wallet} title="No accounts yet" description="Add one." />);

    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('No accounts yet');
  });
});

describe('the icon', () => {
  /** Decoration. The title says the same thing in words, immediately below it. */
  it('is hidden from assistive tech', () => {
    const { container } = render(
      <EmptyState icon={Wallet} title="No accounts yet" description="Add one." />,
    );

    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('the action', () => {
  it('renders the control it is handed', () => {
    render(
      <EmptyState
        icon={Wallet}
        title="No accounts yet"
        description="Add one."
        action={<button type="button">Add account</button>}
      />,
    );

    expect(screen.getByRole('button', { name: 'Add account' })).toBeInTheDocument();
  });

  /** No action is a real case — a filtered list has nothing to offer but a change of filter. */
  it('leaves no empty slot behind when there is nothing to offer', () => {
    const { container } = render(
      <EmptyState icon={Wallet} title="No matches" description="Widen the date range." />,
    );

    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('.mt-5')).toBeNull();
  });
});
