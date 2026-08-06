import { useLocation } from 'react-router-dom';
import { NAV_ITEMS } from './navigation';
import { ThemeModeToggle } from './ThemeModeToggle';
import { CalculatorButton } from '@/features/calculator/CalculatorButton';

/**
 * Deliberately quiet: on an instrument panel the chrome recedes so the numbers can be the
 * hero (SPEC §10). Page title, and the controls that belong everywhere.
 *
 * The calculator button lands here in Phase 7.
 */
export function Topbar() {
  const { pathname } = useLocation();

  const current =
    NAV_ITEMS.find((item) => item.to !== '/' && pathname.startsWith(item.to)) ??
    NAV_ITEMS.find((item) => item.to === '/');

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur-sm">
      <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center gap-3 px-4 sm:px-6">
        {/* The app name only appears here on mobile, where the sidebar is hidden. */}
        <span className="text-sm font-semibold tracking-tight text-foreground md:hidden">
          Ledger EG
        </span>

        <h1 className="hidden text-sm font-medium text-foreground md:block">
          {current?.label ?? 'Ledger EG'}
        </h1>

        <div className="ml-auto flex items-center gap-1">
          <CalculatorButton />
          <ThemeModeToggle />
        </div>
      </div>
    </header>
  );
}
