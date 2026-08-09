import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Minus, Plus } from 'lucide-react';
import type { TransactionDto } from '@ledger/shared';
import { cn } from '@/lib/cn';
import { todayIso } from '@/lib/dates';
import { ApiError } from '@/lib/api';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MoneyInput } from '@/components/shared/MoneyInput';
import { useAccountList } from '@/features/accounts/queries';
import { useCategories } from '@/features/categories/queries';
import { useCreateTransaction, useUpdateTransaction } from './queries';

type Mode = 'INCOME' | 'EXPENSE' | 'TRANSFER';

const MODE_META: Record<Mode, { label: string; icon: typeof Plus }> = {
  EXPENSE: { label: 'Expense', icon: Minus },
  INCOME: { label: 'Income', icon: Plus },
  TRANSFER: { label: 'Transfer', icon: ArrowLeftRight },
};

/** More than 48h back is where a rate stops being today's (D12). */
function isBackdated(dateIso: string): boolean {
  const chosen = new Date(`${dateIso}T00:00:00.000Z`).getTime();
  return Number.isFinite(chosen) && Date.now() - chosen > 48 * 60 * 60 * 1000;
}

interface TransactionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing; absent when adding. */
  editing?: TransactionDto | undefined;
  /** Prefills the amount — how the calculator hands a result over (SPEC §8B). */
  initialAmount?: string | undefined;
}

/**
 * Add or edit a transaction.
 *
 * Optimised for the thing this app exists to do quickly: the amount is focused on open,
 * the date defaults to today and the account to the first one you have, so a typical
 * entry is amount → category → save.
 */
export function TransactionSheet({
  open,
  onOpenChange,
  editing,
  initialAmount,
}: TransactionSheetProps) {
  const isDesktop = useIsDesktop();
  // Stable while the query is pending — see `useAccountList`. This is in the reset
  // effect's dependency list, so an unstable default spins the sheet.
  const accounts = useAccountList();
  const create = useCreateTransaction();
  const update = useUpdateTransaction();

  const isEditing = editing !== undefined;
  const editingTransfer = editing?.type === 'TRANSFER';

  const [mode, setMode] = useState<Mode>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const categoryKind = mode === 'INCOME' ? 'INCOME' : 'EXPENSE';
  const { data: categories = [] } = useCategories(mode === 'TRANSFER' ? undefined : categoryKind);

  const selectedAccount = accounts.find((a) => a.id === accountId);
  const destinationAccount = accounts.find((a) => a.id === toAccountId);
  const isCrossCurrency =
    mode === 'TRANSFER' &&
    selectedAccount !== undefined &&
    destinationAccount !== undefined &&
    selectedAccount.currency !== destinationAccount.currency;

  // Reset to a usable starting point each time it opens.
  useEffect(() => {
    if (!open) return;

    setFormError(null);
    setFieldErrors({});

    if (editing) {
      setMode(editing.type);
      setAmount(String(Math.abs(Number.parseFloat(editing.amount))));
      setAccountId(editing.accountId);
      setCategoryId(editing.categoryId ?? '');
      setDate(editing.date.slice(0, 10));
      setNote(editing.note ?? '');
      if (editing.transferCounterpart) {
        setToAccountId(editing.transferCounterpart.accountId);
        setToAmount(String(Math.abs(Number.parseFloat(editing.transferCounterpart.amount))));
      }
      return;
    }

    setMode('EXPENSE');
    setAmount(initialAmount ?? '');
    setToAmount('');
    setCategoryId('');
    setDate(todayIso());
    setNote('');
    setAccountId(accounts[0]?.id ?? '');
    setToAccountId(accounts[1]?.id ?? '');
  }, [open, editing, accounts, initialAmount]);

  const backdated = useMemo(() => isBackdated(date), [date]);
  const isPending = create.isPending || update.isPending;

  function applyError(error: unknown) {
    if (error instanceof ApiError) {
      const fields = error.fieldErrors;
      const detail = error.details;
      // A service-level rejection names one field; a ZodError names several.
      if (
        typeof detail === 'object' &&
        detail !== null &&
        'field' in detail &&
        typeof detail.field === 'string'
      ) {
        setFieldErrors({ [detail.field]: error.message });
        setFormError(null);
        return;
      }
      if (Object.keys(fields).length > 0) {
        setFieldErrors(fields);
        setFormError(null);
        return;
      }
      setFormError(error.message);
      return;
    }
    setFormError('That could not be saved. Check the fields and try again.');
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    try {
      if (isEditing && editing) {
        await update.mutateAsync({
          id: editing.id,
          body: editingTransfer
            ? {
                fromAmount: amount,
                ...(toAmount === '' ? {} : { toAmount }),
                date,
                note: note === '' ? null : note,
              }
            : {
                amount,
                categoryId: categoryId === '' ? null : categoryId,
                date,
                note: note === '' ? null : note,
              },
        });
      } else if (mode === 'TRANSFER') {
        await create.mutateAsync({
          type: 'TRANSFER',
          fromAccountId: accountId,
          toAccountId,
          fromAmount: amount,
          ...(toAmount === '' ? {} : { toAmount }),
          date,
          note: note === '' ? null : note,
        });
      } else {
        await create.mutateAsync({
          type: mode,
          amount,
          accountId,
          categoryId: categoryId === '' ? null : categoryId,
          date,
          note: note === '' ? null : note,
        });
      }
      onOpenChange(false);
    } catch (error) {
      applyError(error);
    }
  }

  const canSubmit =
    amount.trim() !== '' &&
    accountId !== '' &&
    (mode !== 'TRANSFER' || (toAccountId !== '' && toAccountId !== accountId));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isDesktop ? 'right' : 'bottom'}
        className={cn(
          'overflow-y-auto',
          isDesktop
            ? 'w-full sm:max-w-md'
            : 'max-h-[92svh] pb-[calc(env(safe-area-inset-bottom)+1rem)]',
        )}
      >
        <SheetHeader className="text-left">
          <SheetTitle>{isEditing ? 'Edit transaction' : 'Add a transaction'}</SheetTitle>
          <SheetDescription>
            {isEditing
              ? 'Changing the amount or date works the conversion out again.'
              : 'Amounts accept arithmetic — type 1200*3+450 and press Enter.'}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-4 px-4 pb-4">
          {!isEditing && (
            <div className="inline-flex w-full rounded-lg border border-border p-1">
              {(Object.keys(MODE_META) as Mode[]).map((option) => {
                const { label, icon: Icon } = MODE_META[option];
                const active = mode === option;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setMode(option)}
                    aria-pressed={active}
                    className={cn(
                      'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      active
                        ? 'bg-accent font-medium text-accent-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Icon className="size-3.5" aria-hidden />
                    {label}
                  </button>
                );
              })}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="tx-amount">
              {mode === 'TRANSFER' ? 'Amount leaving' : 'Amount'}
              {selectedAccount && (
                <span className="ml-1.5 font-numeric text-xs text-muted-foreground">
                  {selectedAccount.currency}
                </span>
              )}
            </Label>
            <MoneyInput
              id="tx-amount"
              value={amount}
              onChange={setAmount}
              autoFocus
              {...(selectedAccount ? { currency: selectedAccount.currency } : {})}
              error={fieldErrors['amount'] ?? fieldErrors['fromAmount']}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tx-account">{mode === 'TRANSFER' ? 'From account' : 'Account'}</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger id="tx-account">
                <SelectValue placeholder="Choose an account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}
                    <span className="ml-2 font-numeric text-xs text-muted-foreground">
                      {account.currency}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldErrors['accountId'] !== undefined && (
              <p className="text-xs text-money-negative">{fieldErrors['accountId']}</p>
            )}
          </div>

          {mode === 'TRANSFER' && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="tx-to-account">To account</Label>
                <Select value={toAccountId} onValueChange={setToAccountId}>
                  <SelectTrigger id="tx-to-account">
                    <SelectValue placeholder="Choose an account" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts
                      .filter((account) => account.id !== accountId)
                      .map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.name}
                          <span className="ml-2 font-numeric text-xs text-muted-foreground">
                            {account.currency}
                          </span>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              {isCrossCurrency && (
                <div className="space-y-1.5">
                  <Label htmlFor="tx-to-amount">
                    Amount arriving
                    <span className="ml-1.5 font-numeric text-xs text-muted-foreground">
                      {destinationAccount?.currency}
                    </span>
                  </Label>
                  <MoneyInput
                    id="tx-to-amount"
                    value={toAmount}
                    onChange={setToAmount}
                    placeholder="Filled from today's rate"
                    {...(destinationAccount ? { currency: destinationAccount.currency } : {})}
                    error={fieldErrors['toAmount']}
                  />
                  <p className="text-xs text-muted-foreground">
                    Leave blank to use today's rate. Enter what actually landed to record the bank's
                    spread.
                  </p>
                </div>
              )}
            </>
          )}

          {mode !== 'TRANSFER' && (
            <div className="space-y-1.5">
              <Label htmlFor="tx-category">Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger id="tx-category">
                  <SelectValue placeholder="Uncategorised" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      <span className={cn(category.depth > 0 && 'pl-3 text-muted-foreground')}>
                        {category.depth > 0 ? `↳ ${category.name}` : category.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="tx-date">Date</Label>
            <Input
              id="tx-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="font-numeric"
            />
            {backdated && (
              // Informative, never blocking (D12). The row is flagged, not rejected.
              <p className="text-xs text-money-stale">
                No rate was recorded that far back, so the pound figure will use the closest one
                available and be marked as approximate.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tx-note">Note</Label>
            <Input
              id="tx-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Optional"
              maxLength={500}
            />
          </div>

          {formError !== null && (
            <p className="rounded-md border border-money-negative/40 bg-money-negative/5 px-3 py-2 text-sm text-money-negative">
              {formError}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={!canSubmit || isPending}
              className={cn(
                'flex-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground',
                'transition-opacity hover:opacity-90 disabled:opacity-50',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              )}
            >
              {isPending ? 'Saving…' : isEditing ? 'Save changes' : 'Add transaction'}
            </button>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Cancel
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
