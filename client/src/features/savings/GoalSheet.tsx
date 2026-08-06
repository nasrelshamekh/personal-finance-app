import { useEffect, useState } from 'react';
import { CURRENCIES, type Currency, type SavingsGoalDto } from '@ledger/shared';
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
import { useCreateGoal, useUpdateGoal } from './queries';

const SWATCHES = ['#2f8f5b', '#4a6f9f', '#b06a3f', '#7f5f8f', '#3f8f7a', '#9f5f8f'];

interface GoalSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: SavingsGoalDto | undefined;
}

export function GoalSheet({ open, onOpenChange, editing }: GoalSheetProps) {
  const isDesktop = useIsDesktop();
  const create = useCreateGoal();
  const update = useUpdateGoal();
  const isEditing = editing !== undefined;

  const [name, setName] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [currency, setCurrency] = useState<Currency>('EGP');
  const [deadline, setDeadline] = useState('');
  const [color, setColor] = useState(SWATCHES[0] ?? '#2f8f5b');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setError(null);
    setFieldErrors({});

    if (editing) {
      setName(editing.name);
      setTargetAmount(String(Number.parseFloat(editing.targetAmount)));
      setCurrency(editing.currency);
      setDeadline(editing.deadline?.slice(0, 10) ?? '');
      setColor(editing.color);
      return;
    }

    setName('');
    setTargetAmount('');
    setCurrency('EGP');
    setDeadline('');
    setColor(SWATCHES[0] ?? '#2f8f5b');
  }, [open, editing]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    const body = {
      name,
      targetAmount,
      currency,
      deadline: deadline === '' ? null : deadline,
      color,
      icon: 'piggy-bank',
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
          <SheetTitle>{isEditing ? 'Edit goal' : 'New savings goal'}</SheetTitle>
          <SheetDescription>
            Set a target and a deadline, and this works out what you need to put aside each month.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-4 px-4 pb-4">
          <div className="space-y-1.5">
            <Label htmlFor="goal-name">Name</Label>
            <Input
              id="goal-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="What you are saving for"
              autoFocus
              maxLength={80}
            />
            {fieldErrors['name'] !== undefined && (
              <p className="text-xs text-money-negative">{fieldErrors['name']}</p>
            )}
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="goal-target">Target</Label>
              <MoneyInput
                id="goal-target"
                value={targetAmount}
                onChange={setTargetAmount}
                currency={currency}
                error={fieldErrors['targetAmount']}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="goal-currency">Currency</Label>
              <CurrencyPicker
                id="goal-currency"
                value={currency}
                onChange={setCurrency}
                only={CURRENCIES}
                disabled={isEditing}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="goal-deadline">Deadline</Label>
            <Input
              id="goal-deadline"
              type="date"
              value={deadline}
              onChange={(event) => setDeadline(event.target.value)}
              className="font-numeric"
            />
            <p className="text-xs text-muted-foreground">
              Optional. Without one, there is nothing to work a monthly figure out against.
            </p>
          </div>

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
            <p className="rounded-md border border-money-negative/40 bg-money-negative/5 px-3 py-2 text-sm text-money-negative">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={name.trim() === '' || targetAmount.trim() === '' || isPending}
              className="flex-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {isPending ? 'Saving…' : isEditing ? 'Save changes' : 'Create goal'}
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
