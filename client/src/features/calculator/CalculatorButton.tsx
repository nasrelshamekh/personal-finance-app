import { Calculator } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { useCalculator } from '@/hooks/useCalculator';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { CalculatorPad } from './CalculatorPad';

const TRIGGER_CLASS = cn(
  'rounded-md p-2 text-muted-foreground transition-colors',
  'hover:bg-accent hover:text-foreground',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
);

/**
 * The persistent topbar button (SPEC §8B): a popover on desktop, a sheet on mobile.
 *
 * `c` opens it from anywhere. The pad inside is identical either way — only the container
 * changes, because a popover anchored to a topbar button is unusable on a phone.
 */
export function CalculatorButton() {
  const isDesktop = useIsDesktop();
  const { open, setOpen } = useCalculator();

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className={TRIGGER_CLASS}
          aria-label="Calculator (press c)"
          title="Calculator (c)"
        >
          <Calculator className="size-4" />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-3">
          {/* Remounted per open, so it always starts on a clean expression. */}
          {open && <CalculatorPad />}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={TRIGGER_CLASS}
        aria-label="Calculator"
      >
        <Calculator className="size-4" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[92svh] overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)]"
        >
          <SheetHeader className="text-left">
            <SheetTitle>Calculator</SheetTitle>
            <SheetDescription>
              Amounts accept arithmetic anywhere in the app; this is for working one out on its own.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">{open && <CalculatorPad />}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}
