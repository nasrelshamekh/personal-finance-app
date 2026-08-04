import { CURRENCIES, CURRENCY_LABEL, type Currency } from '@ledger/shared';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/cn';

interface CurrencyPickerProps {
  value: Currency;
  onChange: (currency: Currency) => void;
  /** Restricts the list — a transaction can only be in its account's currency (D3). */
  only?: readonly Currency[];
  disabled?: boolean;
  id?: string;
  className?: string;
  'aria-label'?: string;
}

export function CurrencyPicker({
  value,
  onChange,
  only,
  disabled = false,
  id,
  className,
  ...rest
}: CurrencyPickerProps) {
  const options = only ?? CURRENCIES;

  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as Currency)}
      disabled={disabled || options.length <= 1}
    >
      <SelectTrigger id={id} className={cn('font-numeric', className)} {...rest}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((currency) => (
          <SelectItem key={currency} value={currency}>
            <span className="font-numeric">{currency}</span>
            <span className="ml-2 text-xs text-muted-foreground">{CURRENCY_LABEL[currency]}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
