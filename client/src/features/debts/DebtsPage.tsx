import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { CreditCard, Pencil, Plus, Trash2 } from 'lucide-react';
import { formatAmount, type DebtDirection, type DebtDto } from '@ledger/shared';
import { cn } from '@/lib/cn';
import { reportFailure } from '@/lib/action-feedback';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { Money } from '@/components/shared/Money';
import { ProgressBar } from '@/components/shared/Progress';
import { Skeleton } from '@/components/ui/skeleton';
import { DebtSheet } from './DebtSheet';
import { PaymentSheet } from './PaymentSheet';
import { useDebts, useDeleteDebt, useUpdateDebt } from './queries';

const TABS: ReadonlyArray<{ id: DebtDirection; label: string }> = [
  { id: 'I_OWE', label: 'I owe' },
  { id: 'OWED_TO_ME', label: 'Owed to me' },
];

/**
 * Overdue is marked without being alarmist (SPEC §9): a quiet amber label rather than a
 * red card. The debt is late, not on fire.
 */
function DueLabel({ debt }: { debt: DebtDto }) {
  if (debt.status === 'SETTLED') {
    return <span className="text-xs text-money-positive">Settled</span>;
  }
  if (debt.dueDate === null) {
    return <span className="text-xs text-muted-foreground">No due date</span>;
  }

  const due = format(parseISO(debt.dueDate), 'd MMM yyyy');

  if (debt.isOverdue) {
    return (
      <span className="text-xs text-money-stale">
        {Math.abs(debt.daysUntilDue ?? 0)} days overdue · {due}
      </span>
    );
  }

  return (
    <span className="text-xs text-muted-foreground">
      Due in {debt.daysUntilDue} days · {due}
    </span>
  );
}

function DebtCard({
  debt,
  onLogPayment,
  onEdit,
}: {
  debt: DebtDto;
  onLogPayment: () => void;
  onEdit: () => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const remove = useDeleteDebt();
  const update = useUpdateDebt();
  const settled = debt.status === 'SETTLED';

  return (
    <article
      className={cn(
        'rounded-lg border p-4',
        debt.isOverdue ? 'border-money-stale/40 bg-money-stale/5' : 'border-border bg-card/40',
        settled && 'opacity-70',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-foreground">{debt.counterparty}</h3>
          <DueLabel debt={debt} />
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Edit debt with ${debt.counterparty}`}
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Delete the debt with ${debt.counterparty} and its payments?`)) {
                remove.mutate(debt.id, {
                  onError: reportFailure(
                    `The debt with ${debt.counterparty} could not be deleted.`,
                  ),
                });
              }
            }}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-money-negative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Delete debt with ${debt.counterparty}`}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Remaining
          </p>
          <Money value={debt.remaining} currency={debt.currency} size="lg" tone="plain" />
          {debt.currency !== 'EGP' && (
            <p className="mt-0.5 font-numeric text-xs tabular-nums text-muted-foreground">
              {formatAmount(debt.remainingEgp)} EGP
              {debt.remainingEgpStale && <span className="ml-1 text-money-stale">· approx</span>}
            </p>
          )}
        </div>
        <p className="text-right text-xs text-muted-foreground">
          <span className="font-numeric tabular-nums">{formatAmount(debt.paid)}</span> of{' '}
          <span className="font-numeric tabular-nums">{formatAmount(debt.principal)}</span> paid
        </p>
      </div>

      <ProgressBar
        pct={Number.parseFloat(debt.progressPct)}
        className="mt-3"
        label={`${formatAmount(debt.progressPct, { dp: 0 })}% repaid`}
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!settled && (
          <button
            type="button"
            onClick={onLogPayment}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Plus className="size-3" aria-hidden />
            Log a payment
          </button>
        )}

        <button
          type="button"
          onClick={() =>
            update.mutate(
              { id: debt.id, body: { status: settled ? 'ACTIVE' : 'SETTLED' } },
              {
                onError: reportFailure(
                  settled
                    ? `The debt with ${debt.counterparty} could not be reopened.`
                    : `The debt with ${debt.counterparty} could not be marked settled.`,
                ),
              },
            )
          }
          className="rounded-md border border-border px-2.5 py-1.5 text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {settled ? 'Reopen' : 'Mark settled'}
        </button>

        {debt.payments.length > 0 && (
          <button
            type="button"
            onClick={() => setShowHistory((previous) => !previous)}
            aria-expanded={showHistory}
            className="ml-auto text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {debt.payments.length} {debt.payments.length === 1 ? 'payment' : 'payments'}
          </button>
        )}
      </div>

      {showHistory && debt.payments.length > 0 && (
        <ul className="mt-3 divide-y divide-border border-t border-border pt-1">
          {debt.payments.map((payment) => (
            <li key={payment.id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="font-numeric text-xs tabular-nums text-muted-foreground">
                  {format(parseISO(payment.date), 'd MMM yyyy')}
                </p>
                {payment.note !== null && (
                  <p className="truncate text-xs text-muted-foreground">{payment.note}</p>
                )}
              </div>
              <div className="text-right">
                <Money value={payment.amount} currency={payment.currency} size="sm" tone="plain" />
                {payment.currency !== debt.currency && (
                  <p className="font-numeric text-[11px] tabular-nums text-muted-foreground">
                    {formatAmount(payment.amountInDebtCurrency)} {debt.currency}
                  </p>
                )}
              </div>
              {payment.transactionId !== null && (
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

export function DebtsPage() {
  const [tab, setTab] = useState<DebtDirection>('I_OWE');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<DebtDto | undefined>(undefined);
  const [payingFor, setPayingFor] = useState<DebtDto | undefined>(undefined);

  const { data: debts, isPending } = useDebts();

  const shown = useMemo(() => (debts ?? []).filter((debt) => debt.direction === tab), [debts, tab]);

  const counts = useMemo(
    () => ({
      I_OWE: (debts ?? []).filter((d) => d.direction === 'I_OWE' && d.status === 'ACTIVE').length,
      OWED_TO_ME: (debts ?? []).filter((d) => d.direction === 'OWED_TO_ME' && d.status === 'ACTIVE')
        .length,
    }),
    [debts],
  );

  return (
    <>
      <PageHeader
        title="Debts"
        description="What you owe, and what is owed to you."
        actions={
          <button
            type="button"
            onClick={() => {
              setEditing(undefined);
              setSheetOpen(true);
            }}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Plus className="size-4" aria-hidden />
            Record a debt
          </button>
        }
      />

      <div className="mb-4 inline-flex rounded-lg border border-border p-1" role="tablist">
        {TABS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={tab === option.id}
            onClick={() => setTab(option.id)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              tab === option.id
                ? 'bg-accent font-medium text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
            {counts[option.id] > 0 && (
              <span className="ml-2 font-numeric text-xs text-muted-foreground">
                {counts[option.id]}
              </span>
            )}
          </button>
        ))}
      </div>

      {isPending && (
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1].map((index) => (
            <Skeleton key={index} className="h-44" />
          ))}
        </div>
      )}

      {debts !== undefined && shown.length === 0 && (
        <EmptyState
          icon={CreditCard}
          title={tab === 'I_OWE' ? 'You owe nothing' : 'Nobody owes you'}
          description="Record money lent or borrowed and log payments against it. Balances stay in the debt's own currency, so nothing drifts with the exchange rate."
        />
      )}

      {shown.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {shown.map((debt) => (
            <DebtCard
              key={debt.id}
              debt={debt}
              onLogPayment={() => setPayingFor(debt)}
              onEdit={() => {
                setEditing(debt);
                setSheetOpen(true);
              }}
            />
          ))}
        </div>
      )}

      <DebtSheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) setEditing(undefined);
        }}
        editing={editing}
        defaultDirection={tab}
      />

      <PaymentSheet
        debt={payingFor}
        open={payingFor !== undefined}
        onOpenChange={(open) => {
          if (!open) setPayingFor(undefined);
        }}
      />
    </>
  );
}
