import { useRates } from './queries';

/**
 * Attribution for the rates provider (D10).
 *
 * A licence condition of the free endpoint, not decoration — it is rendered wherever
 * those rates are on show and automatic rates are enabled. It disappears when the API is
 * switched off, because then we are using nobody's data.
 */
export function RateAttribution() {
  const { data } = useRates();

  if (!data?.attribution) return null;

  return (
    <div className="mt-8 border-t border-border pt-4">
      <p className="text-xs text-muted-foreground">
        <a
          href={data.attribution.url}
          target="_blank"
          rel="noreferrer noopener"
          className="underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {data.attribution.label}
        </a>
      </p>
      {data.apiEolAt !== null && (
        <p className="mt-2 text-xs text-money-stale">
          This provider has announced it will shut down on{' '}
          {new Date(data.apiEolAt).toLocaleDateString()}. Switch to another before then.
        </p>
      )}
    </div>
  );
}
