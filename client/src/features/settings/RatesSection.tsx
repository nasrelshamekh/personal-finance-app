import { TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/cn';
import { reportFailure } from '@/lib/action-feedback';
import { Skeleton } from '@/components/ui/skeleton';
import { RateAttribution } from '@/features/fx/RateAttribution';
import { useSettings, useUpdateSettings } from './queries';

/**
 * Where the numbers come from (SPEC §9, D10, D12).
 *
 * Turning the API off is a real, supported mode, not a degraded one: resolution never
 * touches the network anyway, so the app keeps working from stored and hand-typed rates.
 * The copy says that plainly rather than warning you off it.
 */
export function RatesSection() {
  const { data: settings, isPending } = useSettings();
  const update = useUpdateSettings();

  if (isPending) return <Skeleton className="h-32" />;
  if (settings === undefined) return null;

  const eol = settings.ratesApiEolAt === null ? null : new Date(settings.ratesApiEolAt);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-prose">
            <p className="text-sm font-medium text-foreground">Fetch rates automatically</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Rates top themselves up when they go stale, so a dollar transaction converts itself.
              With this off, the app uses the rates it already has and the ones you type on the
              Currency page — it stays fully usable with no network at all.
            </p>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={settings.ratesApiEnabled}
            aria-label="Fetch rates automatically"
            disabled={update.isPending}
            onClick={() =>
              update.mutate(
                { ratesApiEnabled: !settings.ratesApiEnabled },
                {
                  onError: reportFailure(
                    settings.ratesApiEnabled
                      ? 'Automatic rates could not be switched off.'
                      : 'Automatic rates could not be switched on.',
                  ),
                },
              )
            }
            className={cn(
              'relative h-6 w-11 shrink-0 rounded-full transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              'disabled:opacity-50',
              settings.ratesApiEnabled ? 'bg-primary' : 'bg-muted',
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 size-5 rounded-full bg-background shadow transition-[left]',
                settings.ratesApiEnabled ? 'left-[22px]' : 'left-0.5',
              )}
              aria-hidden
            />
          </button>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          Currently {settings.ratesApiEnabled ? 'on' : 'off'} · figures convert with{' '}
          {settings.ratesApiEnabled ? 'the latest fetched rate' : 'stored rates only'}.
        </p>
      </div>

      {eol !== null && (
        <div
          role="status"
          className="flex gap-3 rounded-lg border border-money-stale/40 bg-money-stale/5 p-4"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-money-stale" aria-hidden />
          <div>
            <p className="text-sm font-medium text-foreground">
              The rates provider has announced a shutdown
            </p>
            <p className="mt-1 max-w-prose text-xs text-muted-foreground">
              This endpoint stops working on{' '}
              <span className="font-numeric">
                {eol.toLocaleDateString(undefined, {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </span>
              . Nothing breaks when it does — conversion reads stored rates and never the network —
              but rates stop refreshing themselves, so you would be typing them by hand from then
              on.
            </p>
          </div>
        </div>
      )}

      <RateAttribution />
    </div>
  );
}
