import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Money } from './Money';

/**
 * The one way a monetary figure reaches the screen (SPEC §10).
 *
 * The rule these tests exist for: **direction is never carried by colour alone**. Every
 * signed figure gets a glyph and a spoken word alongside the tint, so the meaning survives
 * for someone who cannot distinguish red from green — and for anyone not looking at all.
 *
 * The formatting itself is `formatMoneyParts` in `shared/`, covered by the server's
 * money tests; what is asserted here is how the pieces are put on screen.
 */

const figure = (text: string) => screen.getByText(text);

describe('direction', () => {
  it('marks money coming in with an up glyph and the word "in"', () => {
    render(<Money value="8860" currency="EGP" />);

    expect(screen.getByText('↑')).toBeInTheDocument();
    expect(screen.getByText('in')).toBeInTheDocument();
    expect(figure('8,860.00')).toBeInTheDocument();
  });

  it('marks money going out with a down glyph and the word "out"', () => {
    render(<Money value="-1674" currency="EGP" />);

    expect(screen.getByText('↓')).toBeInTheDocument();
    expect(screen.getByText('out')).toBeInTheDocument();
    expect(figure('-1,674.00')).toBeInTheDocument();
  });

  it('treats zero as no change rather than as a gain', () => {
    render(<Money value="0" currency="EGP" />);

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('no change')).toBeInTheDocument();
  });

  /** The glyph is decoration; the word is what a screen reader gets. */
  it('hides the glyph from assistive tech and speaks the direction instead', () => {
    render(<Money value="100" currency="EGP" />);

    expect(screen.getByText('↑')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('in')).toHaveClass('sr-only');
  });

  it('tints by direction, so the colour reinforces rather than carries', () => {
    const { rerender } = render(<Money value="100" currency="EGP" />);
    expect(figure('100.00')).toHaveClass('text-money-positive');

    rerender(<Money value="-100" currency="EGP" />);
    expect(figure('-100.00')).toHaveClass('text-money-negative');

    rerender(<Money value="0" currency="EGP" />);
    expect(figure('0.00')).toHaveClass('text-money-neutral');
  });
});

describe('tone', () => {
  /** A balance is not a movement — an account holding 7,386 has no direction. */
  it('drops the glyph and the spoken direction when plain', () => {
    render(<Money value="7386" currency="EGP" tone="plain" />);

    expect(screen.queryByText('↑')).toBeNull();
    expect(screen.queryByText('in')).toBeNull();
    expect(figure('7,386.00')).toHaveClass('text-foreground');
  });

  it('renders muted for a secondary figure', () => {
    render(<Money value="7386" currency="EGP" tone="muted" />);

    expect(figure('7,386.00')).toHaveClass('text-muted-foreground');
    expect(screen.queryByText('↑')).toBeNull();
  });

  /** Plain must not silently keep the money colours — that is what makes it plain. */
  it('does not tint a negative figure when plain', () => {
    render(<Money value="-38.14" currency="USD" tone="plain" />);

    const shown = figure('-38.14');
    expect(shown).toHaveClass('text-foreground');
    expect(shown).not.toHaveClass('text-money-negative');
  });
});

describe('magnitude', () => {
  /** For a column where the direction is already obvious from its heading. */
  it('drops the sign but keeps the direction glyph and the word', () => {
    render(<Money value="-1674" currency="EGP" magnitude />);

    expect(figure('1,674.00')).toBeInTheDocument();
    expect(screen.queryByText('-1,674.00')).toBeNull();
    // Still signed in meaning: the glyph and the spoken word remain.
    expect(screen.getByText('↓')).toBeInTheDocument();
    expect(screen.getByText('out')).toBeInTheDocument();
  });
});

describe('the currency code', () => {
  it('sits beside the figure as its own, smaller node', () => {
    render(<Money value="100" currency="USD" size="lg" />);

    const code = screen.getByText('USD');
    expect(code).toBeInTheDocument();
    // Never the same weight or size as the figure it belongs to (SPEC §10).
    expect(code).toHaveClass('text-muted-foreground');
    expect(figure('100.00')).not.toHaveTextContent('USD');
  });

  it('can be hidden where a whole column is one currency', () => {
    render(<Money value="100" currency="EGP" hideCurrency />);

    expect(screen.queryByText('EGP')).toBeNull();
    expect(figure('100.00')).toBeInTheDocument();
  });
});

describe('typography', () => {
  /** Columns have to align and digits must not jitter as a figure updates. */
  it('always renders the figure in the numeric face with tabular figures', () => {
    render(<Money value="1234.5" currency="EGP" />);

    const shown = figure('1,234.50');
    expect(shown).toHaveClass('font-numeric');
    expect(shown).toHaveClass('tabular-nums');
  });

  it('gives a hero figure genuinely large type', () => {
    render(<Money value="5436.16" currency="EGP" size="xl" />);

    expect(figure('5,436.16')).toHaveClass('text-[2.5rem]');
  });

  it('scales down for a row without changing anything else', () => {
    render(<Money value="100" currency="EGP" size="sm" />);

    expect(figure('100.00')).toHaveClass('text-sm');
  });
});

describe('precision', () => {
  it('shows two places by default, whatever the stored precision', () => {
    render(<Money value="1674.0000" currency="EGP" tone="plain" />);

    expect(figure('1,674.00')).toBeInTheDocument();
  });

  it('takes more places when a rate needs them', () => {
    render(<Money value="49.8029" currency="EGP" tone="plain" dp={4} />);

    expect(figure('49.8029')).toBeInTheDocument();
  });

  it('rounds half-up rather than to even (SPEC §4.5)', () => {
    render(<Money value="12480.005" currency="EGP" tone="plain" />);

    expect(figure('12,480.01')).toBeInTheDocument();
  });

  /** A figure past 2^53 must not round-trip through a float on its way to the screen. */
  it('renders a figure larger than a JS number can hold, exactly', () => {
    render(<Money value="9007199254740993.45" currency="EGP" tone="plain" />);

    expect(figure('9,007,199,254,740,993.45')).toBeInTheDocument();
  });
});
