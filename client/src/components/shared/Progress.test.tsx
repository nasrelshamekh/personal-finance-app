import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgressBar, ProgressRing } from './Progress';

/**
 * Both take an explicit `over` flag rather than inferring "bad" from the number: being
 * over a budget and being over a savings target mean opposite things, and neither
 * component can tell which it is looking at.
 *
 * The other rule is that the *fill* is clamped while the *value* is not — a bar cannot
 * draw 150%, but reporting 100% when you have spent half as much again would be a lie.
 */

describe('the bar', () => {
  it('reports itself as a progress bar with a value and a range', () => {
    render(<ProgressBar pct={40} />);

    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('takes a label, so a screen reader gets more than a bare percentage', () => {
    render(<ProgressBar pct={40} label="Groceries: 40% of budget used" />);

    expect(screen.getByLabelText('Groceries: 40% of budget used')).toBeInTheDocument();
  });

  it('leaves the label off rather than inventing one', () => {
    render(<ProgressBar pct={40} />);

    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-label');
  });

  it('rounds the reported value, since a screen reader does not want four decimals', () => {
    render(<ProgressBar pct={39.6} />);

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
  });

  describe('clamping', () => {
    const fill = (container: HTMLElement) =>
      container.querySelector('[role="progressbar"] > div') as HTMLElement;

    it('draws nothing at zero', () => {
      const { container } = render(<ProgressBar pct={0} />);

      expect(fill(container).style.width).toBe('0%');
    });

    it('draws the proportion it was given', () => {
      const { container } = render(<ProgressBar pct={40} />);

      expect(fill(container).style.width).toBe('40%');
    });

    /** The bar stops at full; the number does not, because 125% is the useful fact. */
    it('stops the fill at full while still reporting the real figure', () => {
      const { container } = render(<ProgressBar pct={125} />);

      expect(fill(container).style.width).toBe('100%');
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '125');
    });

    it('does not draw backwards for a negative', () => {
      const { container } = render(<ProgressBar pct={-20} />);

      expect(fill(container).style.width).toBe('0%');
    });
  });

  describe('over', () => {
    const fill = (container: HTMLElement) =>
      container.querySelector('[role="progressbar"] > div') as HTMLElement;

    /**
     * 125% of a *budget* is bad; 125% of a *savings goal* is not. The caller says which,
     * so being past 100 is never enough on its own to turn the bar red.
     */
    it('stays on the accent colour past 100 unless told otherwise', () => {
      const { container } = render(<ProgressBar pct={150} />);

      expect(fill(container)).toHaveClass('bg-primary');
      expect(fill(container)).not.toHaveClass('bg-money-negative');
    });

    it('turns negative only when the caller says it is over', () => {
      const { container } = render(<ProgressBar pct={125} over />);

      expect(fill(container)).toHaveClass('bg-money-negative');
    });
  });
});

describe('the ring', () => {
  /** The figures live inside it in text; the ring itself carries nothing on its own. */
  it('is decoration, hidden from assistive tech', () => {
    const { container } = render(<ProgressRing pct={25} />);

    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
  });

  it('renders the figures placed inside it', () => {
    render(
      <ProgressRing pct={25}>
        <span>25%</span>
      </ProgressRing>,
    );

    expect(screen.getByText('25%')).toBeInTheDocument();
  });

  describe('the arc', () => {
    /** offset === circumference means nothing drawn; offset === 0 means a full circle. */
    const arc = (container: HTMLElement) => {
      const circles = container.querySelectorAll('circle');
      const progress = circles[1] as SVGCircleElement;
      return {
        dash: Number.parseFloat(progress.getAttribute('stroke-dasharray') ?? '0'),
        offset: Number.parseFloat(progress.getAttribute('stroke-dashoffset') ?? '0'),
      };
    };

    it('draws nothing at zero', () => {
      const { container } = render(<ProgressRing pct={0} />);
      const { dash, offset } = arc(container);

      expect(offset).toBeCloseTo(dash, 5);
    });

    it('closes the circle at one hundred', () => {
      const { container } = render(<ProgressRing pct={100} />);

      expect(arc(container).offset).toBeCloseTo(0, 5);
    });

    it('draws half the circle at fifty', () => {
      const { container } = render(<ProgressRing pct={50} />);
      const { dash, offset } = arc(container);

      expect(offset).toBeCloseTo(dash / 2, 5);
    });

    /** A goal at 150% cannot draw a circle and a half. */
    it('stops at a full circle past one hundred', () => {
      const { container } = render(<ProgressRing pct={150} />);

      expect(arc(container).offset).toBeCloseTo(0, 5);
    });

    it('does not draw backwards for a negative', () => {
      const { container } = render(<ProgressRing pct={-10} />);
      const { dash, offset } = arc(container);

      expect(offset).toBeCloseTo(dash, 5);
    });
  });

  it('takes its size from the props, so it can sit in a card or a row', () => {
    const { container } = render(<ProgressRing pct={50} size={48} />);

    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '48');
    expect(svg).toHaveAttribute('height', '48');
  });
});
