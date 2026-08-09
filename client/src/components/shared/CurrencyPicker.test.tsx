import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Currency } from '@ledger/shared';
import { CurrencyPicker } from './CurrencyPicker';

/**
 * The control that decides what a figure *is*. Its load-bearing behaviour is the `only`
 * list: an account is single-currency (D3), so a transaction on it has exactly one legal
 * currency — and offering a choice that the server will reject is worse than offering none.
 *
 * Driven through a real parent rather than asserting on a value the test supplied, so what
 * is checked is the round trip: pick, call back, re-render with the new value.
 */

function Harness({ only, initial = 'EGP' }: { only?: readonly Currency[]; initial?: Currency }) {
  const [currency, setCurrency] = useState<Currency>(initial);

  return (
    <>
      <CurrencyPicker
        value={currency}
        onChange={setCurrency}
        aria-label="Currency"
        {...(only === undefined ? {} : { only })}
      />
      <p>Chosen: {currency}</p>
    </>
  );
}

describe('choosing', () => {
  it('shows the currency it currently holds', () => {
    render(<Harness initial="USD" />);

    expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveTextContent('USD');
  });

  it('offers every currency the app knows, named as well as coded', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('combobox', { name: 'Currency' }));

    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'EGPEgyptian pound',
      'USDUS dollar',
      'EUREuro',
      'GBPPound sterling',
    ]);
  });

  it('reports the pick to its parent and shows it once handed back', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('combobox', { name: 'Currency' }));
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: /^EUR/ }));

    expect(await screen.findByText('Chosen: EUR')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveTextContent('EUR');
  });
});

describe('restricting the list', () => {
  it('offers only what it was told to', async () => {
    const user = userEvent.setup();
    render(<Harness only={['USD', 'EGP']} initial="USD" />);

    await user.click(screen.getByRole('combobox', { name: 'Currency' }));

    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.queryByRole('option', { name: /^GBP/ })).toBeNull();
  });

  /**
   * A single legal currency is the common case — every transaction on an EGP account.
   * The control shows what the currency *is* and refuses to pretend it is a decision.
   */
  it('disables itself when there is only one legal choice', () => {
    render(<Harness only={['USD']} initial="USD" />);

    const trigger = screen.getByRole('combobox', { name: 'Currency' });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveTextContent('USD');
  });

  it('cannot be opened when it is down to one', async () => {
    const user = userEvent.setup();
    render(<Harness only={['USD']} initial="USD" />);

    await user.click(screen.getByRole('combobox', { name: 'Currency' }));

    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('is disabled when the caller says so, whatever the list holds', () => {
    render(
      <CurrencyPicker value="EGP" onChange={vi.fn()} disabled aria-label="Currency" />,
    );

    expect(screen.getByRole('combobox', { name: 'Currency' })).toBeDisabled();
  });
});

describe('presentation', () => {
  /** A currency code is a figure's unit — same face as the figure so a column lines up. */
  it('renders the code in the numeric face', () => {
    render(<CurrencyPicker value="EGP" onChange={vi.fn()} aria-label="Currency" />);

    expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveClass('font-numeric');
  });

  it('takes an id so a form label can point at it', () => {
    render(<CurrencyPicker value="EGP" onChange={vi.fn()} id="tx-currency" />);

    expect(screen.getByRole('combobox')).toHaveAttribute('id', 'tx-currency');
  });
});
