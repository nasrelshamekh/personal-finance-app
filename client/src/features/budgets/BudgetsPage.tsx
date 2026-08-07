import { useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ArrowLeft, ArrowRight, Coins, Copy } from 'lucide-react';
import { formatAmount, type BudgetRowDto } from '@ledger/shared';
import { cn } from '@/lib/cn';
import { reportFailure } from '@/lib/action-feedback';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { Money } from '@/components/shared/Money';
import { ProgressBar } from '@/components/shared/Progress';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useBudgetMonth, useCopyBudgets, usePutBudgets } from './queries';

function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(month: string, delta: number): string {
  const [year, index] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year ?? 2026, (index ?? 1) - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function BudgetRow({
  row,
  draft,
  onDraftChange,
}: {
  row: BudgetRowDto;
  draft: string;
  onDraftChange: (value: string) => void;
}) {
  const usage = row.usagePct === null ? 0 : Number.parseFloat(row.usagePct);

  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-border px-4 py-3 last:border-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className="size-2.5 shrink-0 rounded-sm"
            style={{ background: row.color }}
            aria-hidden
          />
          <span className="truncate text-sm text-foreground">{row.categoryName}</span>
          {row.isOverBudget && (
            <span className="shrink-0 rounded bg-money-negative/15 px-1.5 py-0.5 text-[10px] font-medium text-money-negative">
              Over
            </span>
          )}
        </div>

        <div className="mt-1.5 flex items-baseline gap-1.5">
          <span className="font-numeric text-xs tabular-nums text-muted-foreground">
            {formatAmount(row.spentEgp)} spent
          </span>
          {row.remainingEgp !== null && (
            <span
              className={cn(
                'font-numeric text-xs tabular-nums',
                row.isOverBudget ? 'text-money-negative' : 'text-muted-foreground',
              )}
            >
              ·{' '}
              {row.isOverBudget
                ? `${formatAmount(row.remainingEgp.replace('-', ''))} over`
                : `${formatAmount(row.remainingEgp)} left`}
            </span>
          )}
        </div>

        {row.limitEgp !== null && (
          <ProgressBar
            pct={usage}
            over={row.isOverBudget}
            className="mt-2 max-w-sm"
            label={`${row.categoryName}: ${formatAmount(row.usagePct ?? '0', { dp: 0 })}% of budget used`}
          />
        )}
      </div>

      <div className="w-32">
        <Input
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder="No limit"
          inputMode="decimal"
          aria-label={`Monthly limit for ${row.categoryName}, in pounds`}
          className="h-9 text-right font-numeric tabular-nums"
        />
      </div>
    </div>
  );
}

export function BudgetsPage() {
  const [month, setMonth] = useState(currentMonth);
  const { data, isPending } = useBudgetMonth(month);
  const save = usePutBudgets();
  const copy = useCopyBudgets();

  /** Limits as typed. Kept separate from the server figures so editing never fights a refetch. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (data === undefined) return;
    setDrafts(
      Object.fromEntries(
        data.rows.map((row) => [
          row.categoryId,
          row.limitEgp === null ? '' : String(Number.parseFloat(row.limitEgp)),
        ]),
      ),
    );
  }, [data]);

  const isDirty = useMemo(() => {
    if (data === undefined) return false;
    return data.rows.some((row) => {
      const stored = row.limitEgp === null ? '' : String(Number.parseFloat(row.limitEgp));
      return (drafts[row.categoryId] ?? '') !== stored;
    });
  }, [data, drafts]);

  async function handleSave() {
    if (data === undefined) return;

    const budgets = data.rows.map((row) => {
      const draft = (drafts[row.categoryId] ?? '').trim();
      return { categoryId: row.categoryId, limitEgp: draft === '' ? null : draft };
    });

    await save.mutateAsync({ month, budgets });
  }

  const label = format(parseISO(`${month}-01`), 'MMMM yyyy');
  const anyLimits = data?.rows.some((row) => row.limitEgp !== null) ?? false;

  return (
    <>
      <PageHeader
        title="Budgets"
        description="Monthly limits per category, and how much of each is left."
        actions={
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMonth(shiftMonth(month, -1))}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Previous month"
            >
              <ArrowLeft className="size-4" />
            </button>
            <span className="min-w-36 text-center text-sm font-medium text-foreground">
              {label}
            </span>
            <button
              type="button"
              onClick={() => setMonth(shiftMonth(month, 1))}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Next month"
            >
              <ArrowRight className="size-4" />
            </button>
          </div>
        }
      />

      {isPending && <Skeleton className="h-96 w-full" />}

      {data !== undefined && data.rows.length === 0 && (
        <EmptyState
          icon={Coins}
          title="No expense categories"
          description="Budgets are set per expense category. Add one in Settings and it will appear here."
        />
      )}

      {data !== undefined && data.rows.length > 0 && (
        <>
          <div className="mb-4 grid gap-4 sm:grid-cols-3">
            <article className="rounded-lg border border-border bg-card/40 p-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Budgeted
              </p>
              <div className="mt-2">
                <Money value={data.totalLimitEgp} currency="EGP" size="lg" tone="plain" />
              </div>
            </article>
            <article className="rounded-lg border border-border bg-card/40 p-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Spent
              </p>
              <div className="mt-2">
                <Money value={data.totalSpentEgp} currency="EGP" size="lg" tone="plain" />
              </div>
            </article>
            <article className="rounded-lg border border-border bg-card/40 p-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Left
              </p>
              <div className="mt-2">
                <Money value={data.totalRemainingEgp} currency="EGP" size="lg" />
              </div>
            </article>
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                copy.mutate(
                  { fromMonth: shiftMonth(month, -1), toMonth: month, overwrite: false },
                  { onError: reportFailure("Last month's budgets could not be copied.") },
                )
              }
              disabled={copy.isPending}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Copy className="size-3.5" aria-hidden />
              {copy.isPending ? 'Copying…' : "Copy last month's"}
            </button>

            {copy.data !== undefined && (
              <span className="text-xs text-muted-foreground" role="status">
                Copied {copy.data.copied}
                {copy.data.skipped > 0 && `, left ${copy.data.skipped} already set`}.
              </span>
            )}

            <button
              type="button"
              onClick={handleSave}
              disabled={!isDirty || save.isPending}
              className="ml-auto rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {save.isPending ? 'Saving…' : isDirty ? 'Save limits' : 'Saved'}
            </button>
          </div>

          {!anyLimits && !isDirty && (
            <p className="mb-3 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
              Nothing is budgeted for {label} yet. Type a limit beside a category, or copy last
              month&apos;s in one click. Clearing a limit removes the budget rather than setting it
              to zero.
            </p>
          )}

          <div className="overflow-hidden rounded-lg border border-border">
            {data.rows.map((row) => (
              <BudgetRow
                key={row.categoryId}
                row={row}
                draft={drafts[row.categoryId] ?? ''}
                onDraftChange={(value) =>
                  setDrafts((previous) => ({ ...previous, [row.categoryId]: value }))
                }
              />
            ))}
          </div>
        </>
      )}
    </>
  );
}
