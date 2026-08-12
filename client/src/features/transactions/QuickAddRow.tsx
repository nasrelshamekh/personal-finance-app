import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { TxType } from '@ledger/shared';
import { cn } from '@/lib/cn';
import { todayIso } from '@/lib/dates';
import { reportFailure } from '@/lib/action-feedback';
import { MoneyInput } from '@/components/shared/MoneyInput';
import { useAccountList } from '@/features/accounts/queries';
import { useCategories } from '@/features/categories/queries';
import { useCreateTransaction } from './queries';

/**
 * The inline quick-add row at the top of the table (SPEC §9).
 *
 * Deliberately not a small copy of `TransactionSheet`: it takes an amount, an account and
 * a category, dates the row today, and leaves everything else at its default. Anything
 * more and it stops being quicker than pressing `n`, which is the only reason to have it.
 *
 * There is nowhere in a table row to put an error, so a failure goes to the shared action
 * feedback region rather than trying to render inline — the same rule the list rows follow.
 */
export function QuickAddRow() {
  const accounts = useAccountList();
  const { data: categories = [] } = useCategories();
  const create = useCreateTransaction();

  const [type, setType] = useState<Exclude<TxType, 'TRANSFER'>>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');

  // The first account until you pick one; re-reading `accounts` each render rather than
  // syncing into state, so a slow load cannot leave a stale empty selection behind.
  const selectedAccountId = accountId !== '' ? accountId : (accounts[0]?.id ?? '');
  const account = accounts.find((candidate) => candidate.id === selectedAccountId);
  const canSubmit = amount.trim() !== '' && account !== undefined && !create.isPending;

  function submit() {
    if (!canSubmit || account === undefined) return;

    create.mutate(
      {
        type,
        amount,
        accountId: account.id,
        categoryId: categoryId === '' ? null : categoryId,
        date: todayIso(),
        note: null,
      },
      {
        onSuccess: () => {
          setAmount('');
          setCategoryId('');
        },
        onError: reportFailure('That transaction could not be added.'),
      },
    );
  }

  const usable = categories.filter((category) => category.kind === type);

  return (
    <tr className="border-b border-border bg-card/30">
      <td className="px-3 py-2" />

      <td className="px-3 py-2">
        {/*
          Two buttons rather than a select: the choice is binary, it decides the sign of
          everything typed to the right of it, and one click beats two.
        */}
        <div className="inline-flex rounded-md border border-border p-0.5">
          {(['EXPENSE', 'INCOME'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setType(option);
                setCategoryId('');
              }}
              aria-pressed={type === option}
              className={cn(
                'rounded px-2 py-0.5 text-xs transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                type === option
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option === 'EXPENSE' ? 'Out' : 'In'}
            </button>
          ))}
        </div>
      </td>

      <td className="px-3 py-2">
        <select
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
          aria-label="Category for the new transaction"
          className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Uncategorised</option>
          {usable.map((category) => (
            <option key={category.id} value={category.id}>
              {category.depth > 0 ? `↳ ${category.name}` : category.name}
            </option>
          ))}
        </select>
      </td>

      <td className="px-3 py-2">
        <select
          value={selectedAccountId}
          onChange={(event) => setAccountId(event.target.value)}
          aria-label="Account for the new transaction"
          className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {accounts.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </td>

      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-2">
          <div className="w-32">
            <MoneyInput
              value={amount}
              onChange={setAmount}
              currency={account?.currency ?? 'EGP'}
              aria-label="Amount for the new transaction"
              // Short enough to survive a 128px field: "Add an expense" was clipped to
              // "Add an expen", and the Out/In buttons already say which way this goes.
              placeholder="Amount"
              onEnter={submit}
              compact
            />
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            aria-label="Add this transaction"
            className="rounded-md bg-primary p-1.5 text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="size-3.5" aria-hidden />
          </button>
        </div>
      </td>
    </tr>
  );
}
