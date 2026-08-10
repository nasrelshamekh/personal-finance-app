import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { format, isToday, isYesterday, parseISO } from 'date-fns';
import { Plus, Receipt, Trash2, TriangleAlert } from 'lucide-react';
import { formatAmount, type CategoryKind, type TransactionDto } from '@ledger/shared';
import { cn } from '@/lib/cn';
import { ApiError } from '@/lib/api';
import { reportFailureNow } from '@/lib/action-feedback';
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

const TYPE_WORD: Record<'INCOME' | 'EXPENSE', string> = {
  INCOME: 'Income',
  EXPENSE: 'Expense',
};

/**
 * What a row calls itself, in one place so the table and the card list cannot drift.
 *
 * The note leads when there is one. It used to sit underneath the category, which read
 * fine on a tidy ledger and badly on a real one: a category is a *classification* shared
 * by dozens of rows, while the note is the only thing that says which row this is. On the
 * ledger this was found with, seven of eight rows carried neither, so the whole column
 * read "Uncategorised" eight times over.
 *
 * A row with neither still cannot be identified — nothing was recorded to identify it with,
 * and inventing something would be worse. What it can do is say what it *is* rather than
 * only what it lacks, and keep the missing category visible, because that is the thing
 * worth fixing.
 */
function describe(transaction: TransactionDto): { primary: string; secondary: string | null } {
  const note = transaction.note?.trim() ?? '';
  const category = transaction.category?.name ?? null;

  if (note !== '') return { primary: note, secondary: category ?? 'Uncategorised' };
  if (category !== null) return { primary: category, secondary: null };
  return {
    primary: TYPE_WORD[transaction.type === 'INCOME' ? 'INCOME' : 'EXPENSE'],
    secondary: 'Uncategorised',
  };
}

/** "Transfer to Bank (USD)" — the counterpart is the informative half, so it is emphasised. */
function TransferLine({ transaction }: { transaction: TransactionDto }) {
  return (
    <>
      Transfer
      {transaction.transferCounterpart && (
        <>
          {' '}
          {Number.parseFloat(transaction.amount) < 0 ? 'to' : 'from'}{' '}
          <span className="text-foreground">{transaction.transferCounterpart.accountName}</span>
        </>
      )}
    </>
  );
}

function Description({ transaction }: { transaction: TransactionDto }) {
  const note = transaction.note?.trim() ?? '';

  // A transfer has no category, so its second line is where it went rather than what it was.
  if (transaction.type === 'TRANSFER') {
    if (note === '') {
      return (
        <span className="block truncate text-sm text-muted-foreground">
          <TransferLine transaction={transaction} />
        </span>
      );
    }

    return (
      <>
        <span className="block truncate text-sm text-foreground">{note}</span>
        <span className="block truncate text-xs text-muted-foreground">
          <TransferLine transaction={transaction} />
        </span>
      </>
    );
  }

  const { primary, secondary } = describe(transaction);

  return (
    <>
      <span className="block truncate text-sm text-foreground">{primary}</span>
      {secondary !== null && (
        <span className="block truncate text-xs text-muted-foreground">{secondary}</span>
      )}
    </>
  );
}

/**
 * What a screen reader hears when it reaches a row's checkbox.
 *
 * The date alone is not a name: five rows on the same day gave five identical
 * "Select transaction on 4 Aug 2026", which is no better than none. The figure is what
 * actually tells them apart.
 */
function selectionLabel(transaction: TransactionDto): string {
  const note = transaction.note?.trim() ?? '';
  const what =
    transaction.type === 'TRANSFER'
      ? note === ''
        ? 'Transfer'
        : note
      : describe(transaction).primary;

  return `Select ${what}, ${formatAmount(transaction.amount)} ${transaction.currency}, ${
    transaction.account.name
  }, ${format(parseISO(transaction.date), 'd MMM yyyy')}`;
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

/**
 * The filters a link may arrive carrying. Anything else in the URL — `new`, `amount` —
 * belongs to the add sheet and is left alone.
 */
const URL_FILTER_KEYS = [
  'from',
  'to',
  'type',
  'accountId',
  'categoryId',
  'currency',
  'q',
  'minAmount',
  'maxAmount',
] as const;

function filtersFromUrl(params: URLSearchParams): Filters {
  const filters: Filters = { page: Number(params.get('page') ?? 1) || 1, pageSize: PAGE_SIZE };

  for (const key of URL_FILTER_KEYS) {
    const value = params.get(key);
    if (value !== null && value !== '') filters[key] = value;
  }
  return filters;
}

export function TransactionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  /**
   * The URL is the filter state, not a copy of it.
   *
   * It used to be `useState`, which meant `/transactions?accountId=…` — the link on every
   * account card and every dashboard category — navigated here and then showed everything,
   * looking exactly like a filter that had silently failed.
   */
  const filters = useMemo(() => filtersFromUrl(searchParams), [searchParams]);

  const setFilters = useCallback(
    (next: Filters) => {
      setSearchParams(
        (params) => {
          for (const key of URL_FILTER_KEYS) {
            const value = next[key];
            if (value === undefined || value === '') params.delete(key);
            else params.set(key, String(value));
          }

          if (next.page !== undefined && next.page > 1) params.set('page', String(next.page));
          else params.delete('page');

          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

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

  /**
   * Which kinds of category the selection can legally take.
   *
   * The dropdown used to list all fourteen categories alphabetically, so "Freelance" and
   * "Salary" sat between "Eating out" and "Gifts" with nothing to say which applied. The
   * server rejects an income category on an expense, so picking one for a mixed selection
   * was an offer that could only half-work. A selection spanning both kinds has no valid
   * answer at all, and saying so beats letting you find out one row at a time.
   */
  const selectionKinds = useMemo(() => {
    const kinds = new Set<CategoryKind>();
    for (const row of rows) {
      if (!selected.has(row.id) || row.type === 'TRANSFER') continue;
      kinds.add(row.type === 'INCOME' ? 'INCOME' : 'EXPENSE');
    }
    return kinds;
  }, [rows, selected]);

  const assignableCategories = useMemo(
    () =>
      selectionKinds.size === 1
        ? categories.filter((category) => selectionKinds.has(category.kind))
        : [],
    [categories, selectionKinds],
  );

  const recategoriseBlockedBecause =
    selectionKinds.size === 0
      ? 'Transfers have no category'
      : selectionKinds.size > 1
        ? 'Income and expenses need separate passes'
        : null;

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
    let failed = 0;
    let lastError: unknown = null;

    for (const id of selected) {
      try {
        await remove.mutateAsync(id);
      } catch (caught) {
        // A 404 is expected and not a failure: it is the other half of a transfer in the
        // same selection, already removed with its partner. Anything else is real.
        if (caught instanceof ApiError && caught.status === 404) continue;
        failed += 1;
        lastError = caught;
      }
    }

    setSelected(new Set());

    if (failed > 0) {
      reportFailureNow(
        failed === 1
          ? 'One transaction could not be deleted.'
          : `${failed} transactions could not be deleted.`,
        lastError,
      );
    }
  }

  async function bulkRecategorise(categoryId: string) {
    // A partial result is the normal outcome here — an expense cannot take an income
    // category — so the count is the message rather than an error on each row.
    let failed = 0;
    let lastError: unknown = null;

    for (const id of selected) {
      const row = rows.find((candidate) => candidate.id === id);
      if (row === undefined || row.type === 'TRANSFER') continue;
      try {
        await update.mutateAsync({ id, body: { categoryId } });
      } catch (caught) {
        failed += 1;
        lastError = caught;
      }
    }

    setSelected(new Set());

    if (failed > 0) {
      reportFailureNow(
        failed === 1
          ? 'One transaction kept its category.'
          : `${failed} transactions kept their categories.`,
        lastError,
      );
    }
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

          <Select onValueChange={bulkRecategorise} disabled={recategoriseBlockedBecause !== null}>
            <SelectTrigger className="h-8 w-48" aria-label="Recategorise selected">
              <SelectValue placeholder="Recategorise…" />
            </SelectTrigger>
            <SelectContent>
              {assignableCategories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.depth > 0 ? `↳ ${category.name}` : category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {recategoriseBlockedBecause !== null && (
            <span className="text-xs text-muted-foreground">{recategoriseBlockedBecause}</span>
          )}

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
                        aria-label={selectionLabel(row)}
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 font-numeric text-sm tabular-nums text-muted-foreground">
                      {format(parseISO(row.date), 'd MMM')}
                    </td>
                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => setEditing(row)}
                        className="block max-w-[28rem] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Description transaction={row} />
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
                        <p className="truncate text-xs text-muted-foreground">{row.account.name}</p>
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
                  onClick={() => setFilters({ ...filters, page: (filters.page ?? 1) - 1 })}
                  className="rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={meta.page >= meta.totalPages}
                  onClick={() => setFilters({ ...filters, page: (filters.page ?? 1) + 1 })}
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
