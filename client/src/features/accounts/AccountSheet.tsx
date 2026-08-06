import { useEffect, useState, type FormEvent } from 'react';
import {
  ACCOUNT_TYPES,
  CURRENCIES,
  type AccountDto,
  type AccountType,
  type Currency,
} from '@ledger/shared';
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
import { useCreateAccount, useUpdateAccount } from './queries';

const SWATCHES = ['#2f8f5b', '#4a6f9f', '#b06a3f', '#7f5f8f', '#3f8f7a', '#6f6f6f'];

const TYPE_LABELS: Record<AccountType, string> = {
  CASH: 'Cash',
  BANK: 'Bank',
  WALLET: 'Wallet',
  SAVINGS: 'Savings',
  CREDIT_CARD: 'Credit card',
};

interface AccountSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: AccountDto | undefined;
}

/**
 * Creating and renaming accounts (SPEC §9).
 *
 * The opening figures are creation-only. `openingBalance`, `openingDate` and the rate
 * frozen from them are a historical fact, and letting them move afterwards would silently
 * rewrite every past net-worth figure (D5) — so on an edit they are shown, read-only,
 * rather than hidden, because they are still the thing that explains the balance.
 */
export function AccountSheet({ open, onOpenChange, editing }: AccountSheetProps) {
  const isDesktop = useIsDesktop();
  const create = useCreateAccount();
  const update = useUpdateAccount();
  const isEditing = editing !== undefined;

  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('CASH');
  const [currency, setCurrency] = useState<Currency>('EGP');
  const [openingBalance, setOpeningBalance] = useState('0');
  const [openingDate, setOpeningDate] = useState('');
  const [color, setColor] = useState(SWATCHES[0] ?? '#2f8f5b');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setError(null);
    setFieldErrors({});

    if (editing) {
      setName(editing.name);
      setType(editing.type);
      setCurrency(editing.currency);
      setOpeningBalance(editing.openingBalance);
      setOpeningDate(editing.openingDate.slice(0, 10));
      setColor(editing.color);
      return;
    }

    setName('');
    setType('CASH');
    setCurrency('EGP');
    setOpeningBalance('0');
    setOpeningDate(new Date().toISOString().slice(0, 10));
    setColor(SWATCHES[0] ?? '#2f8f5b');
  }, [open, editing]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    try {
      if (isEditing && editing) {
        await update.mutateAsync({
          id: editing.id,
          body: { name, type, color, icon: editing.icon },
        });
      } else {
        await create.mutateAsync({
          name,
          type,
          currency,
          openingBalance: openingBalance.trim() === '' ? '0' : openingBalance,
          ...(openingDate === '' ? {} : { openingDate }),
          color,
          icon: 'wallet',
        });
      }
      onOpenChange(false);
    } catch (caught) {
      if (caught instanceof ApiError) {
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
          <SheetTitle>{isEditing ? 'Edit account' : 'New account'}</SheetTitle>
          <SheetDescription>
            One account per place you keep money. An account holds a single currency — dollars in
            cash means a separate dollar account, which is what keeps every balance exact.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-4 px-4 pb-4">
          <div className="space-y-1.5">
            <Label htmlFor="account-name">Name</Label>
            <Input
              id="account-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Cash, Bank, Instapay…"
              autoFocus
              maxLength={80}
              aria-describedby={
                fieldErrors['name'] === undefined ? undefined : 'account-name-error'
              }
              aria-invalid={fieldErrors['name'] !== undefined}
            />
            {fieldErrors['name'] !== undefined && (
              <p id="account-name-error" className="text-xs text-money-negative">
                {fieldErrors['name']}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="account-type">Type</Label>
              <select
                id="account-type"
                value={type}
                onChange={(event) => setType(event.target.value as AccountType)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {ACCOUNT_TYPES.map((option) => (
                  <option key={option} value={option}>
                    {TYPE_LABELS[option]}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="account-currency">Currency</Label>
              <CurrencyPicker
                id="account-currency"
                value={currency}
                onChange={setCurrency}
                only={CURRENCIES}
                disabled={isEditing}
              />
              {isEditing && (
                <p className="text-xs text-muted-foreground">
                  Fixed — every row on this account is in {currency}.
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="account-opening">Opening balance</Label>
              {isEditing ? (
                <Input
                  id="account-opening"
                  value={openingBalance}
                  readOnly
                  disabled
                  className="font-numeric tabular-nums"
                />
              ) : (
                <MoneyInput
                  id="account-opening"
                  value={openingBalance}
                  onChange={setOpeningBalance}
                  currency={currency}
                  error={fieldErrors['openingBalance']}
                />
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="account-opening-date">As of</Label>
              <Input
                id="account-opening-date"
                type="date"
                value={openingDate}
                onChange={(event) => setOpeningDate(event.target.value)}
                readOnly={isEditing}
                disabled={isEditing}
                className="font-numeric"
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            {isEditing
              ? 'The opening figures are frozen. Changing them would rewrite every past net-worth figure, so a correction belongs in a transaction instead.'
              : 'The rate on this date is frozen into the account, which is what makes historical net worth a comparison of fixed figures rather than a guess at today’s rate.'}
          </p>

          <div className="space-y-1.5">
            <span className="text-sm font-medium">Colour</span>
            <div className="flex gap-2">
              {SWATCHES.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  onClick={() => setColor(swatch)}
                  aria-label={`Use colour ${swatch}`}
                  aria-pressed={color === swatch}
                  className={cn(
                    'size-7 rounded-md ring-offset-2 ring-offset-background transition-shadow',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    color === swatch && 'ring-2 ring-foreground/50',
                  )}
                  style={{ background: swatch }}
                />
              ))}
            </div>
          </div>

          {error !== null && (
            <p
              role="alert"
              className="rounded-md border border-money-negative/40 bg-money-negative/5 px-3 py-2 text-sm text-money-negative"
            >
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={name.trim() === '' || isPending}
              className="flex-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {isPending ? 'Saving…' : isEditing ? 'Save changes' : 'Create account'}
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
