import { cn } from '@/lib/cn';

/**
 * Progress indicators.
 *
 * Both take an explicit `over` flag rather than inferring "bad" from the number: being
 * over a budget and being over a savings target mean opposite things, and the component
 * has no way to know which it is looking at.
 */

interface ProgressBarProps {
  /** 0–100+. Clamped for the fill; the label is free to exceed it. */
  pct: number;
  over?: boolean;
  className?: string;
  label?: string;
}

export function ProgressBar({ pct, over = false, className, label }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, pct));

  return (
    <div
      className={cn('h-1.5 overflow-hidden rounded-full bg-muted', className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      {...(label === undefined ? {} : { 'aria-label': label })}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none',
          over ? 'bg-money-negative' : 'bg-primary',
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

interface ProgressRingProps {
  pct: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
  children?: React.ReactNode;
}

/** The savings goal ring (SPEC §9). Figures sit inside it, in text. */
export function ProgressRing({
  pct,
  size = 96,
  strokeWidth = 7,
  className,
  children,
}: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(100, pct));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden focusable="false">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-500 motion-reduce:transition-none"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}
