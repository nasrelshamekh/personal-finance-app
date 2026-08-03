import { useEffect, useState } from 'react';
import { BASE_CURRENCY, CURRENCIES } from '@ledger/shared';

type HealthState =
  | { status: 'loading' }
  | { status: 'ok'; uptimeSeconds: number }
  | { status: 'error'; message: string };

/**
 * Phase 0 landing page. It exists to prove three things at a glance: Tailwind v4 is
 * compiling from CSS-first config, the fonts and money tokens are wired, and the client
 * can reach the API through the Vite proxy. Phase 4 replaces it with the real shell.
 */
export function App() {
  const [health, setHealth] = useState<HealthState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    fetch('/api/health')
      .then(async (res) => {
        if (!res.ok) throw new Error(`API responded ${res.status}`);
        return (await res.json()) as { status: string; uptimeSeconds: number };
      })
      .then((body) => {
        if (!cancelled) setHealth({ status: 'ok', uptimeSeconds: body.uptimeSeconds });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setHealth({
            status: 'error',
            message: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-[1400px] flex-col justify-center gap-10 px-6 py-16">
      <header className="space-y-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Ledger EG · Phase 0
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Foundation is up.
        </h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Workspaces, Tailwind v4 via CSS-first config, and the API proxy. No data layer yet — that
          lands in Phase 1.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <article className="rounded-lg border border-border bg-card p-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Net worth
          </p>
          <p className="mt-2 flex items-baseline gap-1.5">
            <span className="font-numeric text-4xl font-semibold tabular-nums text-foreground">
              0.00
            </span>
            <span className="text-xs font-medium text-muted-foreground">{BASE_CURRENCY}</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Awaiting the data model.</p>
        </article>

        <article className="rounded-lg border border-border bg-card p-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Money tokens
          </p>
          <div className="mt-3 space-y-1.5 font-numeric text-sm tabular-nums">
            <p className="text-money-positive">↑ +12,480.00</p>
            <p className="text-money-negative">↓ −3,205.50</p>
            <p className="text-money-neutral">— 0.00</p>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Sign and glyph, never colour alone.</p>
        </article>

        <article className="rounded-lg border border-border bg-card p-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            API health
          </p>
          <p className="mt-2 text-sm">
            {health.status === 'loading' && (
              <span className="text-muted-foreground">Checking…</span>
            )}
            {health.status === 'ok' && (
              <span className="text-money-positive">
                200 OK ·{' '}
                <span className="font-numeric tabular-nums">
                  {health.uptimeSeconds.toFixed(0)}s
                </span>{' '}
                uptime
              </span>
            )}
            {health.status === 'error' && (
              <span className="text-money-negative">{health.message}</span>
            )}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {health.status === 'error'
              ? 'Start the API with npm run dev:server.'
              : 'Proxied from the Vite dev server to :4000.'}
          </p>
        </article>
      </section>

      <footer className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Currencies:</span>
        {CURRENCIES.map((c) => (
          <span
            key={c}
            className="rounded border border-border bg-secondary px-1.5 py-0.5 font-numeric text-secondary-foreground"
          >
            {c}
          </span>
        ))}
      </footer>
    </main>
  );
}
