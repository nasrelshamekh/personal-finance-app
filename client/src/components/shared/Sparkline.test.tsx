import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Sparkline } from './Sparkline';

/**
 * Hand-rolled SVG rather than recharts: a 64×18 decoration drawn three times in a band
 * that is always on screen, where a charting library would cost far more than the polyline
 * it draws.
 *
 * Nothing here carries meaning on its own — the rate and its age sit beside it as text —
 * so the tests are about the two ways a tiny generated path goes wrong: dividing by zero,
 * and two instances sharing one gradient id.
 */

const svg = (container: HTMLElement) => container.querySelector('svg');
const line = (container: HTMLElement) => container.querySelectorAll('path')[1];

describe('too little data to draw', () => {
  /** One rate is not a trend, and a flat line would imply a stability we cannot show. */
  it('draws nothing from a single point', () => {
    const { container } = render(<Sparkline points={[49.8]} />);

    expect(svg(container)).toBeNull();
  });

  it('draws nothing from no points at all', () => {
    const { container } = render(<Sparkline points={[]} />);

    expect(svg(container)).toBeNull();
  });

  /**
   * It still occupies its space. The strip lays the pills out in a row, and a sparkline
   * that collapses to nothing would shift every figure beside it the moment a second rate
   * is recorded.
   */
  it('holds its place so the row does not jump when data arrives', () => {
    const { container } = render(<Sparkline points={[49.8]} />);

    const placeholder = container.firstElementChild as HTMLElement;
    expect(placeholder.style.width).toBe('64px');
    expect(placeholder.style.height).toBe('18px');
    expect(placeholder).toHaveAttribute('aria-hidden');
  });
});

describe('the path', () => {
  it('spans the full width and puts the highest point at the top', () => {
    const { container } = render(<Sparkline points={[1, 2, 3]} />);

    // Rising series: y falls as value climbs, and the last point sits at the padding.
    expect(line(container)).toHaveAttribute('d', 'M0.00,16.50 L32.00,9.00 L64.00,1.50');
  });

  it('reads a falling series the other way up', () => {
    const { container } = render(<Sparkline points={[3, 1]} />);

    expect(line(container)).toHaveAttribute('d', 'M0.00,1.50 L64.00,16.50');
  });

  /**
   * The guard that matters: an unchanged rate makes `max - min` zero, and dividing by it
   * would put `NaN` in every coordinate — an invisible line rather than a visible bug.
   */
  it('centres a flat series instead of dividing by zero', () => {
    const { container } = render(<Sparkline points={[49.8, 49.8, 49.8]} />);

    const d = line(container)?.getAttribute('d') ?? '';
    expect(d).not.toContain('NaN');
    expect(d).toBe('M0.00,9.00 L32.00,9.00 L64.00,9.00');
  });

  it('takes its geometry from the size it was given', () => {
    const { container } = render(<Sparkline points={[1, 2]} width={100} height={40} />);

    expect(svg(container)).toHaveAttribute('viewBox', '0 0 100 40');
    expect(line(container)).toHaveAttribute('d', 'M0.00,38.50 L100.00,1.50');
  });
});

describe('the gradient', () => {
  /**
   * `useId` per instance, and it has to be: three pills render three sparklines into one
   * document, and a shared id would make all of them fill from whichever `<defs>` the
   * browser resolved last.
   */
  it('gives every instance its own, so three in a row do not collide', () => {
    const { container } = render(
      <>
        <Sparkline points={[1, 2]} />
        <Sparkline points={[2, 1]} />
        <Sparkline points={[1, 3]} />
      </>,
    );

    const ids = [...container.querySelectorAll('linearGradient')].map((g) => g.id);

    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  it('points each fill at its own gradient', () => {
    const { container } = render(
      <>
        <Sparkline points={[1, 2]} />
        <Sparkline points={[2, 1]} />
      </>,
    );

    for (const chart of container.querySelectorAll('svg')) {
      const id = chart.querySelector('linearGradient')?.id;
      const area = chart.querySelectorAll('path')[0];
      expect(area).toHaveAttribute('fill', `url(#${id})`);
    }
  });
});

describe('accessibility', () => {
  it('is decoration, because the figure and its age are already text', () => {
    const { container } = render(<Sparkline points={[1, 2]} />);

    expect(svg(container)).toHaveAttribute('aria-hidden', 'true');
    expect(svg(container)).toHaveAttribute('focusable', 'false');
  });
});
