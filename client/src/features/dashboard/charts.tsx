import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { format, parseISO } from 'date-fns';
import { formatAmount, type CategorySpendDto, type DailySpendDto } from '@ledger/shared';

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
export function CategoryLegend({ data }: { data: CategorySpendDto[] }) {
  return (
    <ul className="space-y-2">
      {data.slice(0, 6).map((entry) => (
        <li key={entry.categoryId ?? 'uncategorised'} className="flex items-center gap-2 text-sm">
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
        </li>
      ))}
    </ul>
  );
}
