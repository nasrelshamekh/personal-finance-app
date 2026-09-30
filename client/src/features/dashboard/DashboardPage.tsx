import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, CalendarOff, LayoutDashboard } from 'lucide-react';
import { Decimal, formatAmount, type DashboardDto } from '@ledger/shared';
import { cn } from '@/lib/cn';
import { LIFT, RISE, SPRING_SNAPPY, STAGGER } from '@/lib/motion';
import { currentMonth, monthDayRange, shiftMonth, useMonth } from '@/hooks/useMonth';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { Money } from '@/components/shared/Money';
import { CountUp } from '@/components/shared/CountUp';
import { Skeleton } from '@/components/ui/skeleton';
import { CategoryDonut, CategoryLegend, DailyBars } from './charts';
import { useDashboard } from './queries';

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
    <motion.article
      variants={RISE}
      whileHover={LIFT}
      transition={SPRING_SNAPPY}
      className="glass rounded-lg p-4"
    >
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <div className="mt-2">{children}</div>
      {hint !== undefined && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </motion.article>
  );
}

function NetWorthCard({ data }: { data: DashboardDto }) {
  const { netWorth } = data;
  const delta = Number.parseFloat(netWorth.deltaEgp);

  const owedByYou = Number.parseFloat(netWorth.owedByYouEgp);
  const owedToYou = Number.parseFloat(netWorth.owedToYouEgp);
  const hasDebts = owedByYou > 0 || owedToYou > 0;

  return (
    <motion.article
      variants={RISE}
      whileHover={LIFT}
      transition={SPRING_SNAPPY}
      className="glass glass-hero relative overflow-hidden rounded-xl p-5 sm:col-span-2"
    >
      {/*
        A hairline of the preset across the top edge. The hero is the one card that should
        look addressed rather than generic, and a 1px gradient does that without putting
        colour anywhere near the figure itself.
      */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent"
      />
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        In your accounts
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

      {/*
        Two figures, not one. What the accounts hold and what you are worth are different
        claims, and a ledger with 5,436 in the bank and a 4,000 debt is not a ledger with
        5,436 — but nor is the debt-adjusted figure the one you spend from. Shown only when
        there is a debt, so an undebted ledger is not asked to read a second number that
        always equals the first.
      */}
      {hasDebts && (
        <div className="mt-3 border-t border-border pt-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              After debts
            </p>
            <Money value={netWorth.afterDebtsEgp} currency="EGP" size="lg" tone="plain" />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {owedByYou > 0 && (
              <>
                You owe{' '}
                <span className="font-numeric tabular-nums text-foreground">
                  {formatAmount(netWorth.owedByYouEgp)}
                </span>
              </>
            )}
            {owedByYou > 0 && owedToYou > 0 && ' · '}
            {owedToYou > 0 && (
              <>
                Owed to you{' '}
                <span className="font-numeric tabular-nums text-foreground">
                  {formatAmount(netWorth.owedToYouEgp)}
                </span>
              </>
            )}
            {netWorth.debtsConverted && (
              <>
                {' · '}
                <span className="text-money-stale">converted at today’s rate</span>
              </>
            )}
          </p>
        </div>
      )}
    </motion.article>
  );
}

export function DashboardPage() {
  const [month, setMonth] = useMonth();
  const { data, isPending, isError } = useDashboard(month);
  const isCurrentMonth = month === currentMonth();

  const hasAnything = useMemo(() => {
    if (data === undefined) return false;
    return (
      data.accounts.length > 0 ||
      data.recentTransactions.length > 0 ||
      Number.parseFloat(data.netWorth.egp) !== 0
    );
  }, [data]);

  const totalInAccounts = useMemo(
    () =>
      (data?.accounts ?? [])
        .reduce((running, account) => running.plus(account.balanceEgp), new Decimal(0))
        .toFixed(4),
    [data],
  );

  const range = monthDayRange(month);
  const monthLabel = format(parseISO(`${month}-01`), 'MMMM yyyy');

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

      {/*
        Two different silences. On the current month it means the ledger is empty and the
        thing to do is add an account. On a past one it usually means the ledger simply
        did not exist yet — telling someone with two accounts to "add an account" because
        they stepped back to July is how a screen loses your trust.
      */}
      {data !== undefined && !hasAnything && isCurrentMonth && (
        <EmptyState
          icon={LayoutDashboard}
          title="Nothing to summarise yet"
          description="Add an account and your first transaction, and this fills with your net worth, the month's income and spending, and what converting cost you."
        />
      )}

      {data !== undefined && !hasAnything && !isCurrentMonth && (
        <EmptyState
          icon={CalendarOff}
          title={`Nothing in ${monthLabel}`}
          description="No accounts existed and nothing moved in this month. Step forward with the arrows, or use the sidebar to see where your money is now."
        />
      )}

      {data !== undefined && hasAnything && (
        <div className="space-y-6">
          <motion.section
            variants={STAGGER}
            initial="hidden"
            animate="show"
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          >
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
              {/*
                Decimal, not a float sum. These are monetary figures and SPEC §4 does not
                make an exception for a total that is only being displayed — three accounts
                and a `+` is exactly how drift gets in.
              */}
              <Money value={totalInAccounts} currency="EGP" size="lg" tone="plain" />
            </StatCard>
          </motion.section>

          <section className="grid gap-4 lg:grid-cols-2">
            <article className="glass rounded-lg p-4">
              <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Where it went
              </h3>
              {data.spendByCategory.length === 0 ? (
                <p className="mt-6 text-sm text-muted-foreground">Nothing spent this month.</p>
              ) : (
                <div className="mt-3 grid items-center gap-4 sm:grid-cols-[180px_1fr]">
                  <CategoryDonut data={data.spendByCategory} />
                  <CategoryLegend data={data.spendByCategory} month={month} />
                </div>
              )}
            </article>

            <article className="glass rounded-lg p-4">
              <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Daily spending
              </h3>
              <div className="mt-3">
                <DailyBars data={data.daily} />
              </div>
            </article>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <article className="glass rounded-lg p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Recent
                </h3>
                {/* Carries the month, so the list opens on what is being read here. */}
                <Link
                  to={`/transactions?from=${range.from}&to=${range.to}`}
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  All transactions
                </Link>
              </div>

              {data.recentTransactions.length === 0 ? (
                <p className="mt-6 text-sm text-muted-foreground">Nothing recorded this month.</p>
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

            <article className="glass rounded-lg p-4">
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
                      {/* Still holding money, so still counted — but say why it is here. */}
                      {account.isArchived && (
                        <span className="ml-1.5 rounded bg-accent px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          Archived
                        </span>
                      )}
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

              {/*
                Once for the panel, not once per row. The same qualifier the accounts page
                carries per card — every pound figure here is a sum of historical
                conversions, not what the balance is worth today — but repeating it down a
                list of five would be noise, and only foreign accounts show one at all.
              */}
              {data.accounts.some((account) => account.currency !== 'EGP') && (
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Pound figures are at the rates when each row was recorded.
                </p>
              )}
            </article>
          </section>

          {(data.debtsDueSoon.length > 0 || data.savingsGoals.length > 0) && (
            <section className="grid gap-4 lg:grid-cols-2">
              {data.debtsDueSoon.length > 0 && (
                <article className="glass rounded-lg p-4">
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
                <article className="glass rounded-lg p-4">
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
