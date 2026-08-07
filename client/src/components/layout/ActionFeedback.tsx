import { useSyncExternalStore } from 'react';
import { TriangleAlert, X } from 'lucide-react';
import { dismissFailure, getFailures, subscribe } from '@/lib/action-feedback';

/**
 * Where a failed action says so (see `lib/action-feedback.ts`).
 *
 * Sits above the mobile tab bar rather than over it, because the bar is how you leave the
 * screen and covering it to report a problem is its own problem.
 *
 * The container is always mounted. A live region added to the DOM at the same moment as
 * its content is one most screen readers never announce — the region has to be there first
 * for the insertion to count as a change.
 */
export function ActionFeedback() {
  const failures = useSyncExternalStore(subscribe, getFailures);

  return (
    <div
      aria-live="assertive"
      aria-atomic="false"
      // The bottom padding clears the mobile tab bar, so it switches at `md` — where
      // MobileNav is `md:hidden` — and not at `sm`. Getting that wrong put the message
      // on top of the bar between 640px and 768px, covering the way off the screen.
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 px-4 pb-[calc(env(safe-area-inset-bottom)+5rem)] sm:items-end sm:px-6 md:pb-6"
    >
      {failures.map((failure) => (
        <div
          key={failure.id}
          role="alert"
          className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border border-money-negative/40 bg-card p-3 shadow-lg animate-in fade-in slide-in-from-bottom-2"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-money-negative" aria-hidden />

          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">{failure.headline}</p>
            {failure.detail !== null && (
              <p className="mt-0.5 text-xs text-muted-foreground">{failure.detail}</p>
            )}
            {/*
              No blanket "nothing was changed" here. It is true of a failed archive and
              false of a bulk action that got halfway, and this component cannot tell the
              difference — so the headline carries it where it applies.
            */}
          </div>

          <button
            type="button"
            onClick={() => dismissFailure(failure.id)}
            aria-label="Dismiss this message"
            className="-m-1 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
