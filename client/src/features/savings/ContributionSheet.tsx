import { useEffect, useState } from 'react';
import type { SavingsGoalDto } from '@ledger/shared';
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
import { useAddContribution } from './queries';

const NO_ACCOUNT = 'none';

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

interface ContributionSheetProps {
  goal: SavingsGoalDto | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ContributionSheet({ goal, open, onOpenChange }: ContributionSheetProps) {
  const isDesktop = useIsDesktop();
  const accounts = useAccountList();
  const addContribution = useAddContribution();

  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIso());
  const [accountId, setAccountId] = useState<string>(NO_ACCOUNT);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open || goal === undefined) return;
    setError(null);
    setFieldErrors({});
    // Pre-fill what you would need this month, if the goal has a deadline.
    setAmount(goal.monthlyNeeded === null ? '' : String(Number.parseFloat(goal.monthlyNeeded)));
    setDate(todayIso());
    const match = accounts.find((account) => account.currency === goal.currency);
    setAccountId(match?.id ?? NO_ACCOUNT);
  }, [open, goal, accounts]);

  if (goal === undefined) return null;

  const selectedAccount = accounts.find((account) => account.id === accountId);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (goal === undefined) return;
    setError(null);
    setFieldErrors({});

    try {
      await addContribution.mutateAsync({
        id: goal.id,
        body: { amount, date, accountId: accountId === NO_ACCOUNT ? null : accountId },
      });
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
      setError('That contribution could not be recorded.');
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
          <SheetTitle>Put money aside</SheetTitle>
          <SheetDescription>Towards {goal.name}.</SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-4 px-4 pb-4">
          <div className="rounded-lg border border-border bg-card/40 p-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Still to go
            </p>
            <div className="mt-1">
              <Money value={goal.remaining} currency={goal.currency} size="lg" tone="plain" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contribution-amount">
              Amount
              <span className="ml-1.5 font-numeric text-xs text-muted-foreground">
                {selectedAccount?.currency ?? goal.currency}
              </span>
            </Label>
            <MoneyInput
              id="contribution-amount"
              value={amount}
              onChange={setAmount}
              currency={selectedAccount?.currency ?? goal.currency}
              autoFocus
              error={fieldErrors['amount']}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contribution-account">Taken from</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger id="contribution-account">
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
                ? 'The goal updates, but no account balance changes.'
                : 'A matching expense will be recorded against this account.'}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contribution-date">Date</Label>
            <Input
              id="contribution-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="font-numeric"
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
              disabled={amount.trim() === '' || addContribution.isPending}
              className="flex-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {addContribution.isPending ? 'Saving…' : 'Add contribution'}
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
