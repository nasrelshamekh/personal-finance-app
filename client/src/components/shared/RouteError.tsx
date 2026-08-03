import { isRouteErrorResponse, Link, useRouteError } from 'react-router-dom';
import { Compass, TriangleAlert } from 'lucide-react';

/**
 * Error copy states what happened and how to fix it, in plain language, and does not
 * apologise (SPEC §10).
 */
export function RouteError() {
  const error = useRouteError();
  const isNotFound = isRouteErrorResponse(error) && error.status === 404;

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
        <h1 className="text-lg font-semibold tracking-tight text-foreground">
          {isNotFound ? 'That page does not exist' : 'This screen failed to load'}
        </h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          {isNotFound
            ? 'The address does not match any screen in this app. The dashboard is a good place to restart from.'
            : 'Something in the page broke while rendering. Reloading usually clears it; if it keeps happening the details are in the browser console.'}
        </p>
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
