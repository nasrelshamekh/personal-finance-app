import { Link } from 'react-router-dom';
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { endOfMonth, format, parseISO } from 'date-fns';
import {
  formatAmount,
  UNCATEGORISED,
  type CategorySpendDto,
  type DailySpendDto,
} from '@ledger/shared';

/**
 * Charts are read, not explored: no gridlines, no legends competing with the figures, no
 * tooltips that need hunting for. Each one is paired with a list or an axis that states
 * the same numbers in text, so the chart is never the only way to get them.
 */

export function CategoryDonut({ data }: { data: CategorySpendDto[] }) {
  const slices = data.map((entry) => ({
    name: entry.name,
    value: Number.parseFloat(entry.spentEgp),
    color: entry.color,
  }));

  return (
    <ResponsiveContainer width="100%" height={180}>
      <PieChart>
        <Pie
          data={slices}
          dataKey="value"
          nameKey="name"
          innerRadius="62%"
          outerRadius="100%"
          paddingAngle={2}
          stroke="none"
          isAnimationActive={false}
        >
          {slices.map((slice) => (
            <Cell key={slice.name} fill={slice.color} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}

export function DailyBars({ data }: { data: DailySpendDto[] }) {
  const bars = data.map((day) => ({
    day: format(parseISO(day.date), 'd'),
    date: day.date,
    spent: Number.parseFloat(day.spentEgp),
  }));

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={bars} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <XAxis
          dataKey="day"
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
          minTickGap={16}
          tick={{ fontSize: 10, fill: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)' }}
        />
        <YAxis hide domain={[0, (max: number) => (max === 0 ? 1 : max * 1.1)]} />
        <Bar
          dataKey="spent"
          fill="var(--chart-1)"
          radius={[2, 2, 0, 0]}
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** The text half of the donut — the same figures, readable without the picture. */
export function CategoryLegend({ data, month }: { data: CategorySpendDto[]; month: string }) {
  // The month the dashboard is showing, as the range the transactions list filters on.
  const start = `${month}-01`;
  const end = format(endOfMonth(parseISO(start)), 'yyyy-MM-dd');

  return (
    <ul className="space-y-1">
      {data.slice(0, 6).map((entry) => (
        <li key={entry.categoryId ?? UNCATEGORISED}>
          {/*
            Every row is a link. This list is where you find out that one category ate the
            month — and the only useful next move is to look at what is in it, so the
            finding and the action are the same click.
          */}
          <Link
            to={{
              pathname: '/transactions',
              search: new URLSearchParams({
                type: 'EXPENSE',
                categoryId: entry.categoryId ?? UNCATEGORISED,
                from: start,
                to: end,
              }).toString(),
            }}
            className="-mx-1.5 flex items-center gap-2 rounded px-1.5 py-1 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              className="size-2.5 shrink-0 rounded-sm"
              style={{ background: entry.color }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-foreground">{entry.name}</span>
            <span className="font-numeric tabular-nums text-muted-foreground">
              {formatAmount(entry.sharePct, { dp: 0 })}%
            </span>
            <span className="w-24 text-right font-numeric tabular-nums text-foreground">
              {formatAmount(entry.spentEgp)}
            </span>
            <span className="sr-only">— show these transactions</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
