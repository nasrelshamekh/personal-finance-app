import { useEffect, useState } from 'react';
import type { DebtDto } from '@ledger/shared';
import { cn } from '@/lib/cn';
import { todayIso } from '@/lib/dates';
import { ApiError } from '@/lib/api';
import { notifySuccess } from '@/lib/toast';
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
import { Money } from '@/components/shared/Money';
import { useAccountList } from '@/features/accounts/queries';
import { useAddDebtPayment } from './queries';

const NO_ACCOUNT = 'none';

interface PaymentSheetProps {
  debt: DebtDto | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Logging a payment (SPEC §12 acceptance).
 *
 * Choosing an account also writes the matching transaction, so the balance moves with the
 * debt. Leaving it as "don't record" logs the payment alone — for a debt settled in cash
 * you never tracked.
 */
export function PaymentSheet({ debt, open, onOpenChange }: PaymentSheetProps) {
  const isDesktop = useIsDesktop();
  const accounts = useAccountList();
  const addPayment = useAddDebtPayment();

  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIso());
  const [accountId, setAccountId] = useState<string>(NO_ACCOUNT);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open || debt === undefined) return;
    setError(null);
    setFieldErrors({});
    // Pre-fill the whole remaining balance: settling in full is the common case.
    setAmount(String(Number.parseFloat(debt.remaining)));
    setDate(todayIso());
    setNote('');
    // Default to an account in the debt's currency, if there is one.
    const match = accounts.find((account) => account.currency === debt.currency);
    setAccountId(match?.id ?? NO_ACCOUNT);
  }, [open, debt, accounts]);

  if (debt === undefined) return null;

  const selectedAccount = accounts.find((account) => account.id === accountId);
  const isIncoming = debt.direction === 'OWED_TO_ME';

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (debt === undefined) return;
    setError(null);
    setFieldErrors({});

    try {
      await addPayment.mutateAsync({
        id: debt.id,
        body: {
          amount,
          date,
          note: note === '' ? null : note,
          accountId: accountId === NO_ACCOUNT ? null : accountId,
        },
      });
      notifySuccess(`Payment logged for ${debt.counterparty}.`);
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
        setError(caught.message);
        return;
      }
      setError('That payment could not be recorded.');
    }
  }

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
          <SheetTitle>Log a payment</SheetTitle>
          <SheetDescription>
            {isIncoming ? 'Money coming back from' : 'Money going to'} {debt.counterparty}.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-4 px-4 pb-4">
          <div className="glass rounded-lg p-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Still outstanding
            </p>
            <div className="mt-1">
              <Money value={debt.remaining} currency={debt.currency} size="lg" tone="plain" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="payment-amount">
              Amount
              <span className="ml-1.5 font-numeric text-xs text-muted-foreground">
                {selectedAccount?.currency ?? debt.currency}
              </span>
            </Label>
            <MoneyInput
              id="payment-amount"
              value={amount}
              onChange={setAmount}
              currency={selectedAccount?.currency ?? debt.currency}
              autoFocus
              error={fieldErrors['amount']}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="payment-account">Paid from</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger id="payment-account">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_ACCOUNT}>Don&apos;t record a transaction</SelectItem>
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
            <p className="text-xs text-muted-foreground">
              {accountId === NO_ACCOUNT
                ? 'The debt balance updates, but no account balance changes.'
                : `A matching ${isIncoming ? 'income' : 'expense'} will be recorded against this account.`}
            </p>
            {fieldErrors['accountId'] !== undefined && (
              <p className="text-xs text-money-negative">{fieldErrors['accountId']}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="payment-date">Date</Label>
            <Input
              id="payment-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="font-numeric"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="payment-note">Note</Label>
            <Input
              id="payment-note"
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
              disabled={amount.trim() === '' || addPayment.isPending}
              className="flex-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {addPayment.isPending ? 'Saving…' : 'Log payment'}
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
