import { isRouteErrorResponse, Link, useRouteError } from 'react-router-dom';
import { Compass, RotateCcw, TriangleAlert } from 'lucide-react';

/**
 * Error copy states what happened and how to fix it, in plain language, and does not
 * apologise (SPEC §10).
 *
 * Two variants because they sit in two places. `RouteError` is the whole-app fallback for
 * an error that escaped the shell; `PageError` is the per-route one, which keeps the
 * sidebar, topbar and FX strip alive so one broken screen does not strand you — you can
 * navigate away from it, which is usually the fix.
 */

function useErrorCopy() {
  const error = useRouteError();
  const isNotFound = isRouteErrorResponse(error) && error.status === 404;

  return {
    isNotFound,
    title: isNotFound ? 'That page does not exist' : 'This screen failed to load',
    body: isNotFound
      ? 'The address does not match any screen in this app. The dashboard is a good place to restart from.'
      : 'Something in the page broke while rendering. Your data is untouched — nothing here writes on load. Reloading usually clears it; if it keeps happening the details are in the browser console.',
  };
}

export function RouteError() {
  const { isNotFound, title, body } = useErrorCopy();

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="rounded-full bg-accent/60 p-3">
        {isNotFound ? (
          <Compass className="size-5 text-muted-foreground" aria-hidden />
        ) : (
          <TriangleAlert className="size-5 text-muted-foreground" aria-hidden />
        )}
      </div>

      <div className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{body}</p>
      </div>

      <Link
        to="/"
        className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Go to the dashboard
      </Link>
    </div>
  );
}

/** The in-shell version: one screen failed, the rest of the app has not. */
export function PageError() {
  const { isNotFound, title, body } = useErrorCopy();

  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border px-6 py-16 text-center"
    >
      <div className="rounded-full bg-accent/60 p-3">
        {isNotFound ? (
          <Compass className="size-5 text-muted-foreground" aria-hidden />
        ) : (
          <TriangleAlert className="size-5 text-muted-foreground" aria-hidden />
        )}
      </div>

      <div className="space-y-1">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        <p className="max-w-sm text-sm text-muted-foreground">{body}</p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <RotateCcw className="size-3.5" aria-hidden />
          Reload
        </button>
        <Link
          to="/"
          className="rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Go to the dashboard
        </Link>
      </div>
    </div>
  );
}
