import { useCallback, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { FxStrip } from '@/features/fx/FxStrip';
import { MobileNav } from './MobileNav';
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
      <div className="flex min-h-svh bg-background">
        <Sidebar collapsed={collapsed} onToggle={toggleSidebar} />

        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <FxStrip />

          <main
            id="main"
            className="mx-auto w-full max-w-[1400px] flex-1 px-4 pb-24 pt-6 sm:px-6 md:pb-10"
          >
            <Outlet />
          </main>
        </div>

        <MobileNav />
      </div>
    </TooltipProvider>
  );
}
