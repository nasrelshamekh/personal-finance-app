import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { format, isToday, isYesterday, parseISO } from 'date-fns';
import { Plus, Receipt, Trash2, TriangleAlert } from 'lucide-react';
import type { TransactionDto } from '@ledger/shared';
import { cn } from '@/lib/cn';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { Money } from '@/components/shared/Money';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCategories } from '@/features/categories/queries';
import type { TransactionFilters as Filters } from './api';
import { TransactionFilters } from './TransactionFilters';
import { TransactionSheet } from './TransactionSheet';
import { useDeleteTransaction, useTransactions, useUpdateTransaction } from './queries';

const PAGE_SIZE = 25;

function dayLabel(iso: string): string {
  const date = parseISO(iso);
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'EEEE d MMMM');
}

function egpSecondary(amountEgp: string): string {
  return Number.parseFloat(amountEgp).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** The amber marker for a row converted with a rate from after the fact (D12). */
function ApproximateMark({ transaction }: { transaction: TransactionDto }) {
  if (!transaction.rateIsApproximate) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <TriangleAlert className="size-3 text-money-stale" aria-hidden />
          <span className="sr-only">Converted with an approximate rate</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-64">
        <p className="font-medium">Approximate conversion</p>
        <p className="mt-1 text-xs opacity-90">
          Dated {format(parseISO(transaction.date), 'd MMM yyyy')}, but the rate used is from{' '}
          {format(parseISO(transaction.rateAsOf), 'd MMM yyyy')}. No rate was recorded that far
          back.
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

function Description({ transaction }: { transaction: TransactionDto }) {
  if (transaction.type !== 'TRANSFER') {
    return (
      <span className="text-sm text-foreground">
        {transaction.category?.name ?? <span className="text-muted-foreground">Uncategorised</span>}
      </span>
    );
  }

  return (
    <span className="text-sm text-muted-foreground">
      Transfer
      {transaction.transferCounterpart && (
        <>
          {' '}
          {Number.parseFloat(transaction.amount) < 0 ? 'to' : 'from'}{' '}
          <span className="text-foreground">{transaction.transferCounterpart.accountName}</span>
        </>
      )}
    </span>
  );
}

/** Original amount is the hero; the pound equivalent sits under it (SPEC §9). */
function AmountCell({ transaction }: { transaction: TransactionDto }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <ApproximateMark transaction={transaction} />
      <div className="text-right">
        <Money value={transaction.amount} currency={transaction.currency} size="sm" />
        {transaction.currency !== 'EGP' && (
          <div className="font-numeric text-[11px] tabular-nums text-muted-foreground">
            {egpSecondary(transaction.amountEgp)} EGP
          </div>
        )}
      </div>
    </div>
  );
}

export function TransactionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState<Filters>({ page: 1, pageSize: PAGE_SIZE });
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<TransactionDto | undefined>(undefined);

  const { data, isPending } = useTransactions(filters);
  const { data: categories = [] } = useCategories();
  const remove = useDeleteTransaction();
  const update = useUpdateTransaction();

  // `?new=1` is what the mobile FAB and the `n` shortcut both set, so there is one way in.
  const sheetOpen = searchParams.get('new') === '1' || editing !== undefined;

  const setSheetOpen = useCallback(
    (open: boolean) => {
      if (open) {
        setSearchParams((params) => {
          params.set('new', '1');
          return params;
        });
        return;
      }
      setEditing(undefined);
      setSearchParams((params) => {
        params.delete('new');
        params.delete('amount');
        return params;
      });
    },
    [setSearchParams],
  );

  /** Set by the calculator's "use this value" (SPEC §8B). */
  const initialAmount = searchParams.get('amount') ?? undefined;

  // `n` opens the add sheet (SPEC §9) — but not while you are typing in a field.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'n' || event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
          target.closest('[role="dialog"]') !== null)
      ) {
        return;
      }

      event.preventDefault();
      setSheetOpen(true);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setSheetOpen]);

  const rows = useMemo(() => data?.data ?? [], [data]);
  const meta = data?.meta;

  const grouped = useMemo(() => {
    const map = new Map<string, TransactionDto[]>();
    for (const row of rows) {
      const key = row.date.slice(0, 10);
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return [...map.entries()];
  }, [rows]);

  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.id)));
  }

  function toggleOne(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkDelete() {
    // Sequential rather than parallel: deleting one side of a transfer removes both, so
    // firing them together would produce avoidable 404s on the partner row.
    for (const id of selected) {
      try {
        await remove.mutateAsync(id);
      } catch {
        // Already gone — most likely the other half of a transfer in the same selection.
      }
    }
    setSelected(new Set());
  }

  async function bulkRecategorise(categoryId: string) {
    for (const id of selected) {
      const row = rows.find((candidate) => candidate.id === id);
      if (row === undefined || row.type === 'TRANSFER') continue;
      try {
        await update.mutateAsync({ id, body: { categoryId } });
      } catch {
        // Kind mismatch — an expense cannot take an income category.
      }
    }
    setSelected(new Set());
  }

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Everything that moved, newest first."
        actions={
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className={cn(
              'inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium',
              'text-primary-foreground transition-opacity hover:opacity-90',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            )}
          >
            <Plus className="size-4" aria-hidden />
            Add
            <kbd className="ml-1 hidden rounded border border-primary-foreground/30 px-1 font-numeric text-[10px] md:inline">
              n
            </kbd>
          </button>
        }
      />

      <TransactionFilters
        filters={filters}
        onChange={setFilters}
        expanded={filtersExpanded}
        onExpandedChange={setFiltersExpanded}
      />

      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-accent/40 px-3 py-2">
          <span className="text-sm font-medium">{selected.size} selected</span>

          <Select onValueChange={bulkRecategorise}>
            <SelectTrigger className="h-8 w-48" aria-label="Recategorise selected">
              <SelectValue placeholder="Recategorise…" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.depth > 0 ? `↳ ${category.name}` : category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <button
            type="button"
            onClick={bulkDelete}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-money-negative/40 px-2.5 text-sm text-money-negative transition-colors hover:bg-money-negative/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Trash2 className="size-3.5" aria-hidden />
            Delete
          </button>

          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Clear
          </button>
        </div>
      )}

      {isPending && (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton key={index} className="h-14 w-full" />
          ))}
        </div>
      )}

      {!isPending && rows.length === 0 && (
        <EmptyState
          icon={Receipt}
          title="No transactions here"
          description="Either nothing has been recorded yet, or no row matches these filters. Press n to add one."
        />
      )}

      {!isPending && rows.length > 0 && (
        <>
          {/* Desktop: a dense table. */}
          <div className="hidden overflow-hidden rounded-lg border border-border md:block">
            <table className="w-full">
              <caption className="sr-only">Transactions, newest first</caption>
              <thead>
                <tr className="border-b border-border bg-card/50 text-left">
                  <th scope="col" className="w-10 px-3 py-2.5">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={toggleAll}
                      aria-label="Select all rows on this page"
                    />
                  </th>
                  {['Date', 'Description', 'Account'].map((heading) => (
                    <th
                      key={heading}
                      scope="col"
                      className="px-3 py-2.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
                    >
                      {heading}
                    </th>
                  ))}
                  <th
                    scope="col"
                    className="px-3 py-2.5 text-right text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
                  >
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={cn(
                      'border-b border-border transition-colors last:border-0 hover:bg-accent/40',
                      selected.has(row.id) && 'bg-accent/30',
                    )}
                  >
                    <td className="px-3 py-2.5">
                      <Checkbox
                        checked={selected.has(row.id)}
                        onCheckedChange={() => toggleOne(row.id)}
                        aria-label={`Select transaction on ${format(parseISO(row.date), 'd MMM yyyy')}`}
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 font-numeric text-sm tabular-nums text-muted-foreground">
                      {format(parseISO(row.date), 'd MMM')}
                    </td>
                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => setEditing(row)}
                        className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Description transaction={row} />
                        {row.note !== null && row.note !== '' && (
                          <span className="block text-xs text-muted-foreground">{row.note}</span>
                        )}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-sm text-muted-foreground">
                      {row.account.name}
                    </td>
                    <td className="px-3 py-2.5">
                      <AmountCell transaction={row} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: grouped by day, never a sideways-scrolling table (SPEC §10). */}
          <div className="space-y-4 md:hidden">
            {grouped.map(([day, dayRows]) => (
              <section key={day}>
                <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  {dayLabel(day)}
                </h3>
                <div className="overflow-hidden rounded-lg border border-border">
                  {dayRows.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => setEditing(row)}
                      className="flex w-full items-center gap-3 border-b border-border px-3 py-3 text-left last:border-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="min-w-0 flex-1">
                        <Description transaction={row} />
                        <p className="truncate text-xs text-muted-foreground">
                          {row.account.name}
                          {row.note !== null && row.note !== '' && <> · {row.note}</>}
                        </p>
                      </div>
                      <AmountCell transaction={row} />
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>

          {meta !== undefined && meta.totalPages > 1 && (
            <nav className="mt-4 flex items-center justify-between" aria-label="Pagination">
              <p className="text-xs text-muted-foreground">
                Page <span className="font-numeric tabular-nums">{meta.page}</span> of{' '}
                <span className="font-numeric tabular-nums">{meta.totalPages}</span> ·{' '}
                <span className="font-numeric tabular-nums">{meta.total}</span> in total
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={meta.page <= 1}
                  onClick={() =>
                    setFilters((current) => ({ ...current, page: (current.page ?? 1) - 1 }))
                  }
                  className="rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={meta.page >= meta.totalPages}
                  onClick={() =>
                    setFilters((current) => ({ ...current, page: (current.page ?? 1) + 1 }))
                  }
                  className="rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Next
                </button>
              </div>
            </nav>
          )}
        </>
      )}

      <TransactionSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        editing={editing}
        initialAmount={initialAmount}
      />
    </>
  );
}
