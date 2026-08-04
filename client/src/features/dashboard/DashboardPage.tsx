import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { ArrowLeft, ArrowRight, LayoutDashboard } from 'lucide-react';
import { formatAmount, type DashboardDto } from '@ledger/shared';
import { cn } from '@/lib/cn';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { Money } from '@/components/shared/Money';
import { CountUp } from '@/components/shared/CountUp';
import { Skeleton } from '@/components/ui/skeleton';
import { CategoryDonut, CategoryLegend, DailyBars } from './charts';
import { useDashboard } from './queries';

function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(month: string, delta: number): string {
  const [year, index] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year ?? 2026, (index ?? 1) - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function MonthPicker({ month, onChange }: { month: string; onChange: (next: string) => void }) {
  const label = format(parseISO(`${month}-01`), 'MMMM yyyy');
  const isCurrent = month === currentMonth();

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(shiftMonth(month, -1))}
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Previous month"
      >
        <ArrowLeft className="size-4" />
      </button>
      <span className="min-w-36 text-center text-sm font-medium text-foreground">{label}</span>
      <button
        type="button"
        onClick={() => onChange(shiftMonth(month, 1))}
        disabled={isCurrent}
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Next month"
      >
        <ArrowRight className="size-4" />
      </button>
    </div>
  );
}

function StatCard({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <article className="rounded-lg border border-border bg-card/40 p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <div className="mt-2">{children}</div>
      {hint !== undefined && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </article>
  );
}

function NetWorthCard({ data }: { data: DashboardDto }) {
  const { netWorth } = data;
  const delta = Number.parseFloat(netWorth.deltaEgp);

  return (
    <article className="rounded-lg border border-border bg-card/40 p-5 sm:col-span-2">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        Net worth
      </p>
      <div className="mt-2">
        <CountUp value={netWorth.egp} currency="EGP" size="xl" tone="plain" />
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Money value={netWorth.deltaEgp} currency="EGP" size="sm" hideCurrency />
        <span>vs the start of the month</span>
        {netWorth.deltaPct !== null && (
          <span className="font-numeric tabular-nums">
            ({delta >= 0 ? '+' : ''}
            {formatAmount(netWorth.deltaPct, { dp: 1 })}%)
          </span>
        )}
      </p>
    </article>
  );
}

export function DashboardPage() {
  const [month, setMonth] = useState(currentMonth);
  const { data, isPending, isError } = useDashboard(month);

  const hasAnything = useMemo(() => {
    if (data === undefined) return false;
    return (
      data.accounts.length > 0 ||
      data.recentTransactions.length > 0 ||
      Number.parseFloat(data.netWorth.egp) !== 0
    );
  }, [data]);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Net worth, this month's movement, and where the money went."
        actions={<MonthPicker month={month} onChange={setMonth} />}
      />

      {isPending && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <Skeleton key={index} className={cn('h-28', index === 0 && 'sm:col-span-2')} />
          ))}
        </div>
      )}

      {isError && (
        <p className="rounded-md border border-money-negative/40 bg-money-negative/5 px-3 py-2 text-sm text-money-negative">
          The dashboard could not be loaded. The API may not be running — start it with{' '}
          <span className="font-numeric">npm run dev</span>.
        </p>
      )}

      {data !== undefined && !hasAnything && (
        <EmptyState
          icon={LayoutDashboard}
          title="Nothing to summarise yet"
          description="Add an account and your first transaction, and this fills with your net worth, the month's income and spending, and what converting cost you."
        />
      )}

      {data !== undefined && hasAnything && (
        <div className="space-y-6">
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <NetWorthCard data={data} />

            <StatCard label="Income">
              <Money value={data.totals.incomeEgp} currency="EGP" size="lg" tone="plain" />
            </StatCard>

            <StatCard label="Spending">
              <Money value={data.totals.expensesEgp} currency="EGP" size="lg" tone="plain" />
            </StatCard>

            <StatCard label="Net this month">
              <Money value={data.totals.netEgp} currency="EGP" size="lg" />
            </StatCard>

            <StatCard
              label="Cost of converting"
              hint={
                Number.parseFloat(data.totals.conversionCostEgp) === 0
                  ? 'No cross-currency transfers this month.'
                  : 'The gap between what left and what arrived.'
              }
            >
              <Money
                value={data.totals.conversionCostEgp}
                currency="EGP"
                size="lg"
                tone="plain"
                magnitude
              />
            </StatCard>

            <StatCard label="Accounts" hint="Across every currency, in pounds.">
              <Money
                value={data.accounts
                  .reduce((sum, account) => sum + Number.parseFloat(account.balanceEgp), 0)
                  .toFixed(4)}
                currency="EGP"
                size="lg"
                tone="plain"
              />
            </StatCard>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <article className="rounded-lg border border-border p-4">
              <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Where it went
              </h3>
              {data.spendByCategory.length === 0 ? (
                <p className="mt-6 text-sm text-muted-foreground">Nothing spent this month.</p>
              ) : (
                <div className="mt-3 grid items-center gap-4 sm:grid-cols-[180px_1fr]">
                  <CategoryDonut data={data.spendByCategory} />
                  <CategoryLegend data={data.spendByCategory} />
                </div>
              )}
            </article>

            <article className="rounded-lg border border-border p-4">
              <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Daily spending
              </h3>
              <div className="mt-3">
                <DailyBars data={data.daily} />
              </div>
            </article>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <article className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Recent
                </h3>
                <Link
                  to="/transactions"
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  All transactions
                </Link>
              </div>

              {data.recentTransactions.length === 0 ? (
                <p className="mt-6 text-sm text-muted-foreground">Nothing recorded yet.</p>
              ) : (
                <ul className="mt-3 divide-y divide-border">
                  {data.recentTransactions.map((row) => (
                    <li key={row.id} className="flex items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-foreground">
                          {row.type === 'TRANSFER'
                            ? 'Transfer'
                            : (row.category?.name ?? 'Uncategorised')}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {format(parseISO(row.date), 'd MMM')} · {row.account.name}
                        </p>
                      </div>
                      <Money value={row.amount} currency={row.currency} size="sm" />
                    </li>
                  ))}
                </ul>
              )}
            </article>

            <article className="rounded-lg border border-border p-4">
              <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Accounts
              </h3>
              <ul className="mt-3 divide-y divide-border">
                {data.accounts.map((account) => (
                  <li key={account.id} className="flex items-center gap-3 py-2.5">
                    <span
                      className="size-2.5 shrink-0 rounded-sm"
                      style={{ background: account.color }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {account.name}
                    </span>
                    <div className="text-right">
                      <Money
                        value={account.balance}
                        currency={account.currency}
                        size="sm"
                        tone="plain"
                      />
                      {account.currency !== 'EGP' && (
                        <div className="font-numeric text-[11px] tabular-nums text-muted-foreground">
                          {formatAmount(account.balanceEgp)} EGP
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </article>
          </section>

          {(data.debtsDueSoon.length > 0 || data.savingsGoals.length > 0) && (
            <section className="grid gap-4 lg:grid-cols-2">
              {data.debtsDueSoon.length > 0 && (
                <article className="rounded-lg border border-border p-4">
                  <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Due in the next 30 days
                  </h3>
                  <ul className="mt-3 divide-y divide-border">
                    {data.debtsDueSoon.map((debt) => (
                      <li key={debt.id} className="flex items-center gap-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-foreground">{debt.counterparty}</p>
                          <p className="text-xs text-muted-foreground">
                            {debt.daysUntilDue !== null && debt.daysUntilDue < 0
                              ? `${Math.abs(debt.daysUntilDue)} days overdue`
                              : `in ${debt.daysUntilDue} days`}
                          </p>
                        </div>
                        <Money
                          value={debt.remaining}
                          currency={debt.currency}
                          size="sm"
                          tone="plain"
                        />
                      </li>
                    ))}
                  </ul>
                </article>
              )}

              {data.savingsGoals.length > 0 && (
                <article className="rounded-lg border border-border p-4">
                  <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Savings
                  </h3>
                  <ul className="mt-3 space-y-3">
                    {data.savingsGoals.map((goal) => (
                      <li key={goal.id}>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm text-foreground">{goal.name}</span>
                          <span className="font-numeric text-xs tabular-nums text-muted-foreground">
                            {formatAmount(goal.progressPct, { dp: 0 })}%
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{
                              width: `${Math.min(100, Number.parseFloat(goal.progressPct))}%`,
                            }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                </article>
              )}
            </section>
          )}
        </div>
      )}
    </>
  );
}
