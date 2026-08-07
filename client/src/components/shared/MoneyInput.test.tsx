import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MoneyInput } from './MoneyInput';

/**
 * `MoneyInput` is controlled, so the test drives it through a real parent rather than
 * asserting on a value it also supplied. `latest` is what the parent would have stored.
 */
function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <MoneyInput value={value} onChange={setValue} currency="EGP" aria-label="Amount" />
      <output data-testid="stored">{value}</output>
    </>
  );
}

const field = () => screen.getByLabelText('Amount');
const stored = () => screen.getByTestId('stored').textContent;

describe('arithmetic in an amount field (SPEC §8A)', () => {
  it('previews the result while the expression is still being typed', () => {
    render(<Harness />);
    fireEvent.change(field(), { target: { value: '1200*3+450' } });

    expect(screen.getByText(/= 4050\.00/)).toBeInTheDocument();
    // The raw text is what leaves the component until it is resolved.
    expect(stored()).toBe('1200*3+450');
  });

  it('resolves on Enter to two decimals', () => {
    render(<Harness />);
    fireEvent.change(field(), { target: { value: '1200*3+450' } });
    fireEvent.keyDown(field(), { key: 'Enter' });

    expect(stored()).toBe('4050.00');
  });

  it('resolves on blur, so tabbing away does not lose the sum', () => {
    render(<Harness />);
    fireEvent.change(field(), { target: { value: '10+5' } });
    fireEvent.blur(field());

    expect(stored()).toBe('15.00');
  });

  it('puts the expression back on Escape, so a typo is not a retype', () => {
    render(<Harness />);
    fireEvent.change(field(), { target: { value: '1200*3+450' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(stored()).toBe('4050.00');

    fireEvent.keyDown(field(), { key: 'Escape' });

    expect(stored()).toBe('1200*3+450');
  });

  it('divides the way the server does — the same parser runs on both sides', () => {
    render(<Harness />);
    fireEvent.change(field(), { target: { value: '10/3' } });
    fireEvent.keyDown(field(), { key: 'Enter' });

    expect(stored()).toBe('3.33');
  });

  it('leaves a plain amount alone rather than treating it as a sum', () => {
    render(<Harness initial="250.50" />);

    expect(screen.queryByText(/Enter to resolve/)).toBeNull();
    expect(stored()).toBe('250.50');
  });
});

describe('invalid input', () => {
  it('explains itself inline and marks the field, rather than raising a toast', () => {
    render(<Harness />);
    fireEvent.change(field(), { target: { value: '10+' } });

    expect(field()).toHaveAttribute('aria-invalid', 'true');
    expect(field()).toHaveAccessibleDescription();
  });

  it('refuses to resolve a broken expression', () => {
    render(<Harness />);
    fireEvent.change(field(), { target: { value: '(10+5' } });
    fireEvent.keyDown(field(), { key: 'Enter' });

    expect(stored()).toBe('(10+5');
  });

  it('says so when a division by zero is typed', () => {
    render(<Harness />);
    fireEvent.change(field(), { target: { value: '10/0' } });

    expect(field()).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows a server-side error for the field the same way a parse error is shown', () => {
    render(
      <MoneyInput
        value="100"
        onChange={() => {}}
        currency="EGP"
        aria-label="Amount"
        error="That is more than the remaining balance."
      />,
    );

    expect(screen.getByText('That is more than the remaining balance.')).toBeInTheDocument();
    expect(screen.getByLabelText('Amount')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('the input element itself', () => {
  /**
   * `type="number"` would reject `1200*3` outright and strip the operators on mobile,
   * which would quietly undo the whole feature.
   */
  it('is not a number input, and asks for the numeric keypad instead', () => {
    render(<Harness />);

    expect(field()).not.toHaveAttribute('type', 'number');
    expect(field()).toHaveAttribute('inputmode', 'decimal');
  });
});
