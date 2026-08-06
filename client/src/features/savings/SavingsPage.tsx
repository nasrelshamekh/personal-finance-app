import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Check, Pencil, PiggyBank, Plus, Trash2 } from 'lucide-react';
import { formatAmount, type SavingsGoalDto } from '@ledger/shared';
import { cn } from '@/lib/cn';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { Money } from '@/components/shared/Money';
import { ProgressRing } from '@/components/shared/Progress';
import { Skeleton } from '@/components/ui/skeleton';
import { GoalSheet } from './GoalSheet';
import { ContributionSheet } from './ContributionSheet';
import { useDeleteGoal, useSavingsGoals } from './queries';

/** "You need X a month to hit this" (SPEC §9), or why there is no such figure. */
function MonthlyNeeded({ goal }: { goal: SavingsGoalDto }) {
  if (goal.isComplete) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-money-positive">
        <Check className="size-3" aria-hidden />
        Target reached
      </p>
    );
  }

  if (goal.monthlyNeeded === null) {
    return (
      <p className="text-xs text-muted-foreground">
        No deadline, so there is no monthly figure to hit.
      </p>
    );
  }

  if (goal.monthsRemaining === 0) {
    return (
      <p className="text-xs text-money-stale">
        Due this month — the whole{' '}
        <span className="font-numeric tabular-nums">{formatAmount(goal.monthlyNeeded)}</span>{' '}
        {goal.currency} is outstanding.
      </p>
    );
  }

  return (
    <p className="text-xs text-muted-foreground">
      <span className="font-numeric tabular-nums text-foreground">
        {formatAmount(goal.monthlyNeeded)} {goal.currency}
      </span>{' '}
      a month for {goal.monthsRemaining} more {goal.monthsRemaining === 1 ? 'month' : 'months'}
    </p>
  );
}

function GoalCard({
  goal,
  onContribute,
  onEdit,
}: {
  goal: SavingsGoalDto;
  onContribute: () => void;
  onEdit: () => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const remove = useDeleteGoal();

  return (
    <article className="rounded-lg border border-border bg-card/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="size-2.5 shrink-0 rounded-sm"
            style={{ background: goal.color }}
            aria-hidden
          />
          <h3 className="truncate text-sm font-medium text-foreground">{goal.name}</h3>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Edit ${goal.name}`}
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Delete ${goal.name} and its contributions?`)) {
                remove.mutate(goal.id);
              }
            }}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-money-negative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Delete ${goal.name}`}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-4">
        <ProgressRing pct={Number.parseFloat(goal.progressPct)}>
          <span className="font-numeric text-sm font-semibold tabular-nums text-foreground">
            {formatAmount(goal.progressPct, { dp: 0 })}%
          </span>
        </ProgressRing>

        <div className="min-w-0 flex-1 space-y-1">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Still to go
            </p>
            <Money value={goal.remaining} currency={goal.currency} size="lg" tone="plain" />
          </div>
          <p className="font-numeric text-xs tabular-nums text-muted-foreground">
            {formatAmount(goal.saved)} of {formatAmount(goal.targetAmount)} {goal.currency}
          </p>
          {goal.deadline !== null && (
            <p className="text-xs text-muted-foreground">
              By {format(parseISO(goal.deadline), 'd MMM yyyy')}
            </p>
          )}
        </div>
      </div>

      <div className="mt-3">
        <MonthlyNeeded goal={goal} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onContribute}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Plus className="size-3" aria-hidden />
          Put money aside
        </button>

        {goal.contributions.length > 0 && (
          <button
            type="button"
            onClick={() => setShowHistory((previous) => !previous)}
            aria-expanded={showHistory}
            className="ml-auto text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {goal.contributions.length}{' '}
            {goal.contributions.length === 1 ? 'contribution' : 'contributions'}
          </button>
        )}
      </div>

      {showHistory && goal.contributions.length > 0 && (
        <ul className="mt-3 divide-y divide-border border-t border-border pt-1">
          {goal.contributions.map((contribution) => (
            <li key={contribution.id} className="flex items-center gap-3 py-2">
              <p className="min-w-0 flex-1 font-numeric text-xs tabular-nums text-muted-foreground">
                {format(parseISO(contribution.date), 'd MMM yyyy')}
              </p>
              <div className="text-right">
                <Money
                  value={contribution.amount}
                  currency={contribution.currency}
                  size="sm"
                  tone="plain"
                />
                {contribution.currency !== goal.currency && (
                  <p className="font-numeric text-[11px] tabular-nums text-muted-foreground">
                    {formatAmount(contribution.amountInGoalCurrency)} {goal.currency}
                  </p>
                )}
              </div>
              {contribution.transactionId !== null && (
                <span
                  className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
                  title="A matching transaction was recorded"
                >
                  linked
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export function SavingsPage() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<SavingsGoalDto | undefined>(undefined);
  const [contributingTo, setContributingTo] = useState<SavingsGoalDto | undefined>(undefined);

  const { data: goals, isPending } = useSavingsGoals();

  return (
    <>
      <PageHeader
        title="Savings"
        description="Goals, what you have put aside, and what is left to go."
        actions={
          <button
            type="button"
            onClick={() => {
              setEditing(undefined);
              setSheetOpen(true);
            }}
            className={cn(
              'inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium',
              'text-primary-foreground transition-opacity hover:opacity-90',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            )}
          >
            <Plus className="size-4" aria-hidden />
            New goal
          </button>
        }
      />

      {isPending && (
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1].map((index) => (
            <Skeleton key={index} className="h-56" />
          ))}
        </div>
      )}

      {goals !== undefined && goals.length === 0 && (
        <EmptyState
          icon={PiggyBank}
          title="No goals yet"
          description="Set a target and a deadline, and this works out what you need to put aside each month to reach it."
        />
      )}

      {goals !== undefined && goals.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              onContribute={() => setContributingTo(goal)}
              onEdit={() => {
                setEditing(goal);
                setSheetOpen(true);
              }}
            />
          ))}
        </div>
      )}

      <GoalSheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) setEditing(undefined);
        }}
        editing={editing}
      />

      <ContributionSheet
        goal={contributingTo}
        open={contributingTo !== undefined}
        onOpenChange={(open) => {
          if (!open) setContributingTo(undefined);
        }}
      />
    </>
  );
}
