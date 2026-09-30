import { useCallback, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { Check } from 'lucide-react';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { FxStrip } from '@/features/fx/FxStrip';
import { CalculatorProvider } from '@/features/calculator/CalculatorProvider';
import { ActionFeedback } from './ActionFeedback';
import { MobileNav } from './MobileNav';
import { PageTransition } from './PageTransition';
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
    // `reducedMotion="user"` is framer-motion's own switch for `prefers-reduced-motion` —
    // it disables transforms and durations for every motion component under it without
    // needing a media-query check at each call site. The CSS rule in index.css handles
    // everything CSS-driven; this is the equivalent for anything framer-motion animates.
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={200}>
        {/* Inside the router, so "use this value" can navigate to the transaction form. */}
        <CalculatorProvider>
          <div className="relative flex min-h-svh bg-background">
            {/*
              Aurora's ambient field — two slowly drifting blooms of the preset's own two
              ends, behind everything. `aria-hidden` and pointer-events-none: it is
              atmosphere, not content, and must never be in the way of either a screen
              reader or a click.
            */}
            <div className="aurora-field" aria-hidden>
              <div className="aurora-blob aurora-blob-a" />
              <div className="aurora-blob aurora-blob-b" />
            </div>

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

            {/* z-10 lifts the app off the ambient field, which sits at z-0. */}
            <div className="relative z-10 flex min-w-0 flex-1 flex-col">
              <Topbar />
              <FxStrip />

              <main
                id="main"
                // Focusable only programmatically: without this the skip link scrolls the
                // page but leaves focus where it was, so the next Tab goes back to the nav.
                tabIndex={-1}
                className="mx-auto w-full max-w-[1400px] flex-1 px-4 pb-24 pt-6 outline-none sm:px-6 md:pb-10"
              >
                <PageTransition>
                  <Outlet />
                </PageTransition>
              </main>
            </div>

            <MobileNav />
            <ActionFeedback />
            {/*
              Confirmations, not failures — see `lib/toast.ts`. Top-centre and auto-dismissing,
              deliberately the opposite of `ActionFeedback`: that one sits at the bottom and
              never dismisses itself because a failure must not be missed, and putting both
              in the same place would blur which kind of message just appeared.
            */}
            <Toaster
              position="top-center"
              offset="76px"
              icons={{ success: <Check className="size-4 text-money-positive" aria-hidden /> }}
              toastOptions={{
                classNames: {
                  toast:
                    'rounded-lg! border! border-border! bg-card! text-foreground! shadow-lg! p-3!',
                  title: 'text-sm! font-medium! text-foreground!',
                },
              }}
            />
          </div>
        </CalculatorProvider>
      </TooltipProvider>
    </MotionConfig>
  );
}
