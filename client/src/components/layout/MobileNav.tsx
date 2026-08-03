import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { MoreHorizontal, Plus } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { MOBILE_PRIMARY, MOBILE_SECONDARY } from './navigation';

/**
 * Bottom tab bar with five slots (SPEC §10): Home, Transactions, **Add**, Debts, More.
 *
 * The centre slot is an action rather than a destination — adding a transaction is the
 * thing this app exists to make fast, and on a phone it belongs under the thumb.
 * Everything that does not fit goes behind "More" rather than being squeezed in.
 */
export function MobileNav() {
  const [moreOpen, setMoreOpen] = useState(false);
  const navigate = useNavigate();

  const tabClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium',
      'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      isActive ? 'text-foreground' : 'text-muted-foreground',
    );

  return (
    <nav
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur md:hidden',
        // Keeps the bar clear of the home indicator on iOS.
        'pb-[env(safe-area-inset-bottom)]',
      )}
      aria-label="Main"
    >
      <div className="flex items-stretch">
        {MOBILE_PRIMARY.slice(0, 2).map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'} className={tabClass}>
            <item.icon className="size-5" aria-hidden />
            <span>{item.label === 'Dashboard' ? 'Home' : item.label}</span>
          </NavLink>
        ))}

        <div className="flex flex-1 items-center justify-center">
          <button
            type="button"
            onClick={() => navigate('/transactions?new=1')}
            className={cn(
              'flex size-12 -translate-y-3 items-center justify-center rounded-full',
              'bg-primary text-primary-foreground shadow-lg shadow-primary/25',
              'transition-transform active:scale-95 motion-reduce:transition-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              'focus-visible:ring-offset-background',
            )}
            aria-label="Add a transaction"
          >
            <Plus className="size-6" aria-hidden />
          </button>
        </div>

        {MOBILE_PRIMARY.slice(2).map((item) => (
          <NavLink key={item.to} to={item.to} className={tabClass}>
            <item.icon className="size-5" aria-hidden />
            <span>{item.label}</span>
          </NavLink>
        ))}

        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetTrigger
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium',
              'text-muted-foreground transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            <MoreHorizontal className="size-5" aria-hidden />
            <span>More</span>
          </SheetTrigger>

          <SheetContent side="bottom" className="pb-[calc(env(safe-area-inset-bottom)+1rem)]">
            <SheetHeader className="text-left">
              <SheetTitle>Everything else</SheetTitle>
              <SheetDescription>The screens that do not fit in the bar.</SheetDescription>
            </SheetHeader>

            <div className="mt-4 grid grid-cols-2 gap-2">
              {MOBILE_SECONDARY.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMoreOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-lg border border-border px-3 py-3 text-sm',
                      'transition-colors focus-visible:outline-none focus-visible:ring-2',
                      'focus-visible:ring-ring',
                      isActive
                        ? 'bg-accent font-medium text-accent-foreground'
                        : 'text-foreground hover:bg-accent/60',
                    )
                  }
                >
                  <item.icon className="size-4 shrink-0" aria-hidden />
                  {item.label}
                </NavLink>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
