import { useId } from 'react';
import { cn } from '@/lib/cn';

interface SparklineProps {
  points: number[];
  width?: number;
  height?: number;
  className?: string;
}

/**
 * A micro-sparkline for the FX strip. Hand-rolled SVG rather than recharts: this is a
 * 64×18 decoration rendered three times in a always-visible band, and a charting library
 * per pair would cost far more than the polyline it draws.
 *
 * Renders nothing below two points. One rate is not a trend, and a flat line would imply
 * a stability we have no evidence for.
 */
export function Sparkline({ points, width = 64, height = 18, className }: SparklineProps) {
  const gradientId = useId();

  if (points.length < 2) {
    return <span className={cn('inline-block', className)} style={{ width, height }} aria-hidden />;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min;
  const padding = 1.5;
  const usableHeight = height - padding * 2;

  const coords = points.map((value, index) => {
    const x = (index / (points.length - 1)) * width;
    // A perfectly flat series would divide by zero; centre it instead.
    const y =
      span === 0 ? height / 2 : padding + usableHeight - ((value - min) / span) * usableHeight;
    return [x, y] as const;
  });

  const line = coords
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;

  const first = points[0] ?? 0;
  const last = points[points.length - 1] ?? 0;
  const rising = last >= first;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('overflow-visible', className)}
      // Decoration: the figure and its age carry the meaning, and both are text.
      aria-hidden
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={coords[coords.length - 1]?.[0] ?? 0}
        cy={coords[coords.length - 1]?.[1] ?? 0}
        r="1.75"
        fill="currentColor"
        opacity={rising ? 1 : 0.7}
      />
    </svg>
  );
}
