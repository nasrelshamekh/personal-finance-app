import { useEffect, useState } from 'react';
import type { Currency, DebtDirection, DebtDto } from '@ledger/shared';
import { CURRENCIES } from '@ledger/shared';
import { cn } from '@/lib/cn';
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
import { MoneyInput } from '@/components/shared/MoneyInput';
import { CurrencyPicker } from '@/components/shared/CurrencyPicker';
import { useCreateDebt, useUpdateDebt } from './queries';

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

interface DebtSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: DebtDto | undefined;
  defaultDirection?: DebtDirection;
}

export function DebtSheet({
  open,
  onOpenChange,
  editing,
  defaultDirection = 'I_OWE',
}: DebtSheetProps) {
  const isDesktop = useIsDesktop();
  const create = useCreateDebt();
  const update = useUpdateDebt();
  const isEditing = editing !== undefined;

  const [direction, setDirection] = useState<DebtDirection>(defaultDirection);
  const [counterparty, setCounterparty] = useState('');
  const [principal, setPrincipal] = useState('');
  const [currency, setCurrency] = useState<Currency>('EGP');
  const [startDate, setStartDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setError(null);
    setFieldErrors({});

    if (editing) {
      setDirection(editing.direction);
      setCounterparty(editing.counterparty);
      setPrincipal(String(Number.parseFloat(editing.principal)));
      setCurrency(editing.currency);
      setStartDate(editing.startDate.slice(0, 10));
      setDueDate(editing.dueDate?.slice(0, 10) ?? '');
      setNote(editing.note ?? '');
      return;
    }

    setDirection(defaultDirection);
    setCounterparty('');
    setPrincipal('');
    setCurrency('EGP');
    setStartDate(todayIso());
    setDueDate('');
    setNote('');
  }, [open, editing, defaultDirection]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    const body = {
      counterparty,
      direction,
      principal,
      currency,
      startDate,
      dueDate: dueDate === '' ? null : dueDate,
      note: note === '' ? null : note,
    };

    try {
      if (isEditing && editing) {
        await update.mutateAsync({ id: editing.id, body });
      } else {
        await create.mutateAsync(body);
      }
      onOpenChange(false);
    } catch (caught) {
      if (caught instanceof ApiError) {
        const detail = caught.details;
        if (
          typeof detail === 'object' &&
          detail !== null &&
          'field' in detail &&
          typeof detail.field === 'string'
        ) {
          setFieldErrors({ [detail.field]: caught.message });
          return;
        }
        const fields = caught.fieldErrors;
        if (Object.keys(fields).length > 0) {
          setFieldErrors(fields);
          return;
        }
        setError(caught.message);
        return;
      }
      setError('That could not be saved.');
    }
  }

  const isPending = create.isPending || update.isPending;

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
          <SheetTitle>{isEditing ? 'Edit debt' : 'Record a debt'}</SheetTitle>
          <SheetDescription>
            Balances stay in the debt&apos;s own currency, so nothing drifts with the exchange rate.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-4 px-4 pb-4">
          {!isEditing && (
            <div className="inline-flex w-full rounded-lg border border-border p-1">
              {(
                [
                  ['I_OWE', 'I owe'],
                  ['OWED_TO_ME', 'Owed to me'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDirection(value)}
                  aria-pressed={direction === value}
                  className={cn(
                    'flex-1 rounded-md px-2 py-1.5 text-sm transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    direction === value
                      ? 'bg-accent font-medium text-accent-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="debt-counterparty">
              {direction === 'I_OWE' ? 'Who you owe' : 'Who owes you'}
            </Label>
            <Input
              id="debt-counterparty"
              value={counterparty}
              onChange={(event) => setCounterparty(event.target.value)}
              placeholder="A name"
              autoFocus
              maxLength={80}
            />
            {fieldErrors['counterparty'] !== undefined && (
              <p className="text-xs text-money-negative">{fieldErrors['counterparty']}</p>
            )}
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="debt-principal">Amount</Label>
              <MoneyInput
                id="debt-principal"
                value={principal}
                onChange={setPrincipal}
                currency={currency}
                error={fieldErrors['principal']}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="debt-currency">Currency</Label>
              <CurrencyPicker
                id="debt-currency"
                value={currency}
                onChange={setCurrency}
                only={CURRENCIES}
                disabled={isEditing}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="debt-start">Started</Label>
              <Input
                id="debt-start"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="font-numeric"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="debt-due">Due</Label>
              <Input
                id="debt-due"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                className="font-numeric"
              />
              {fieldErrors['dueDate'] !== undefined && (
                <p className="text-xs text-money-negative">{fieldErrors['dueDate']}</p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="debt-note">Note</Label>
            <Input
              id="debt-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Optional"
              maxLength={500}
            />
          </div>

          {error !== null && (
            <p className="rounded-md border border-money-negative/40 bg-money-negative/5 px-3 py-2 text-sm text-money-negative">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={counterparty.trim() === '' || principal.trim() === '' || isPending}
              className="flex-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {isPending ? 'Saving…' : isEditing ? 'Save changes' : 'Record debt'}
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
