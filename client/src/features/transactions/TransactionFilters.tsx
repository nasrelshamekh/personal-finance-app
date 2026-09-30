import { SlidersHorizontal, X } from 'lucide-react';
import { CURRENCIES, UNCATEGORISED, type Currency } from '@ledger/shared';
import { cn } from '@/lib/cn';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CurrencyPicker } from '@/components/shared/CurrencyPicker';
import { useAccounts } from '@/features/accounts/queries';
import { useCategories } from '@/features/categories/queries';
import type { TransactionFilters as Filters } from './api';

/** `''` is the UI's "no filter"; the API simply does not receive the key. */
const ANY = '';

interface TransactionFiltersProps {
  filters: Filters;
  onChange: (next: Filters) => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}

export function TransactionFilters({
  filters,
  onChange,
  expanded,
  onExpandedChange,
}: TransactionFiltersProps) {
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();

  // `page` is bookkeeping, not something the user chose — it must not count as a filter.
  const activeCount = Object.entries(filters).filter(
    ([key, value]) => !['page', 'pageSize'].includes(key) && value !== undefined && value !== '',
  ).length;

  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch, page: 1 });

  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={filters.q ?? ''}
          onChange={(event) => set({ q: event.target.value || undefined })}
          placeholder="Search notes"
          className="h-9 w-full sm:w-64"
          aria-label="Search notes"
        />

        <Select
          value={filters.type ?? ANY}
          onValueChange={(value) => set({ type: value === ANY ? undefined : value })}
        >
          <SelectTrigger className="h-9 w-full sm:w-36" aria-label="Type">
            <SelectValue placeholder="Any type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any type</SelectItem>
            <SelectItem value="INCOME">Income</SelectItem>
            <SelectItem value="EXPENSE">Expense</SelectItem>
            <SelectItem value="TRANSFER">Transfer</SelectItem>
          </SelectContent>
        </Select>

        <button
          type="button"
          onClick={() => onExpandedChange(!expanded)}
          aria-expanded={expanded}
          className={cn(
            'inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm',
            'transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2',
            'focus-visible:ring-ring',
          )}
        >
          <SlidersHorizontal className="size-3.5" aria-hidden />
          Filters
          {activeCount > 0 && (
            <span className="rounded bg-primary px-1.5 font-numeric text-[10px] text-primary-foreground">
              {activeCount}
            </span>
          )}
        </button>

        {activeCount > 0 && (
          <button
            type="button"
            onClick={() => onChange({ page: 1, pageSize: filters.pageSize ?? 25 })}
            className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3.5" aria-hidden />
            Clear
          </button>
        )}
      </div>

      {expanded && (
        <div className="glass grid gap-3 rounded-lg p-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="filter-account">Account</Label>
            <Select
              value={filters.accountId ?? ANY}
              onValueChange={(value) => set({ accountId: value === ANY ? undefined : value })}
            >
              <SelectTrigger id="filter-account" className="h-9">
                <SelectValue placeholder="Any account" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any account</SelectItem>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="filter-category">Category</Label>
            <Select
              value={filters.categoryId ?? ANY}
              onValueChange={(value) => set({ categoryId: value === ANY ? undefined : value })}
            >
              <SelectTrigger id="filter-category" className="h-9">
                <SelectValue placeholder="Any category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any category</SelectItem>
                {/* The bucket the dashboard links into, so an arriving filter is
                    representable here rather than showing as "Any category". */}
                <SelectItem value={UNCATEGORISED}>Uncategorised</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.depth > 0 ? `↳ ${category.name}` : category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="filter-currency">Currency</Label>
            {filters.currency === undefined ? (
              <button
                type="button"
                onClick={() => set({ currency: 'EGP' })}
                id="filter-currency"
                className="flex h-9 w-full items-center rounded-md border border-input px-3 text-sm text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Any currency
              </button>
            ) : (
              <div className="flex items-center gap-1">
                <CurrencyPicker
                  id="filter-currency"
                  value={filters.currency as Currency}
                  onChange={(currency) => set({ currency })}
                  only={CURRENCIES}
                  className="h-9 flex-1"
                  aria-label="Currency"
                />
                <button
                  type="button"
                  onClick={() => set({ currency: undefined })}
                  className="rounded-md p-2 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Clear currency filter"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="filter-from">Date range</Label>
            <div className="flex items-center gap-1">
              <Input
                id="filter-from"
                type="date"
                value={filters.from ?? ''}
                onChange={(event) => set({ from: event.target.value || undefined })}
                className="h-9 font-numeric"
                aria-label="From date"
              />
              <Input
                type="date"
                value={filters.to ?? ''}
                onChange={(event) => set({ to: event.target.value || undefined })}
                className="h-9 font-numeric"
                aria-label="To date"
              />
            </div>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="filter-min">Amount, in pounds</Label>
            <div className="flex items-center gap-2">
              <Input
                id="filter-min"
                inputMode="decimal"
                value={filters.minAmount ?? ''}
                onChange={(event) => set({ minAmount: event.target.value || undefined })}
                placeholder="Min"
                className="h-9 font-numeric tabular-nums"
              />
              <Input
                inputMode="decimal"
                value={filters.maxAmount ?? ''}
                onChange={(event) => set({ maxAmount: event.target.value || undefined })}
                placeholder="Max"
                className="h-9 font-numeric tabular-nums"
                aria-label="Maximum amount"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Compared against the size of the figure, so it finds income and spending alike.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
