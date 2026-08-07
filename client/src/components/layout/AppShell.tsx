import { useCallback, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { FxStrip } from '@/features/fx/FxStrip';
import { CalculatorProvider } from '@/features/calculator/CalculatorProvider';
import { ActionFeedback } from './ActionFeedback';
import { MobileNav } from './MobileNav';
import { RouteAnnouncer } from './RouteAnnouncer';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

const SIDEBAR_STORAGE_KEY = 'ledger.sidebar.collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * The frame every screen sits in.
 *
 * Desktop: persistent sidebar, topbar, FX strip, content capped at 1400px.
 * Mobile: topbar, FX strip, content, bottom tab bar. No horizontal scrolling, ever —
 * the FX strip scrolls inside itself rather than making the page wide (SPEC §10).
 */
export function AppShell() {
  const [collapsed, setCollapsed] = useState(readCollapsed);

  const toggleSidebar = useCallback(() => {
    setCollapsed((previous) => {
      const next = !previous;
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      } catch {
        // Not fatal; the sidebar simply forgets between reloads.
      }
      return next;
    });
  }, []);

  return (
    <TooltipProvider delayDuration={200}>
      {/* Inside the router, so "use this value" can navigate to the transaction form. */}
      <CalculatorProvider>
        <div className="flex min-h-svh bg-background">
          {/*
            Visible only when focused. Without it, reaching the content by keyboard means
            tabbing past eight nav links and the whole topbar on every single page.
          */}
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
          >
            Skip to content
          </a>
          <RouteAnnouncer />

          <Sidebar collapsed={collapsed} onToggle={toggleSidebar} />

          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar />
            <FxStrip />

            <main
              id="main"
              // Focusable only programmatically: without this the skip link scrolls the
              // page but leaves focus where it was, so the next Tab goes back to the nav.
              tabIndex={-1}
              className="mx-auto w-full max-w-[1400px] flex-1 px-4 pb-24 pt-6 outline-none sm:px-6 md:pb-10"
            >
              <Outlet />
            </main>
          </div>

          <MobileNav />
          <ActionFeedback />
        </div>
      </CalculatorProvider>
    </TooltipProvider>
  );
}
