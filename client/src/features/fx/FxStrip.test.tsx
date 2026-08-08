import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FxRatesResponse, StoredRateDto } from '@ledger/shared';
import { stubApi, type ApiStub } from '@/test/http';
import { fxRates, resolvedRate, storedRate } from '@/test/fixtures';
import { TooltipProvider } from '@/components/ui/tooltip';
import { dismissFailure, getFailures } from '@/lib/action-feedback';
import { FxStrip } from './FxStrip';

/**
 * The strip is always on screen, so its job is to be honest at a glance: the figure, how
 * old it is, and an amber dot when that age matters (SPEC §4.6).
 *
 * Staleness is never signalled by colour alone — the dot is always paired with text, and
 * the tooltip says *why* rather than just that it is stale.
 */

function Harness() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <FxStrip />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

let api: ApiStub;

function arrange(rates: FxRatesResponse, stored: StoredRateDto[] = []) {
  api?.restore();
  api = stubApi({
    'GET /fx/rates': rates,
    'GET /fx/rates/stored': { data: stored },
    'POST /fx/refresh': {
      refreshedAt: '2026-08-06T00:00:00.000Z',
      changes: [],
      failures: [],
      apiEolAt: null,
    },
  });
}

beforeEach(() => {
  arrange(fxRates());
});

afterEach(() => {
  api.restore();
  for (const failure of getFailures()) dismissFailure(failure.id);
});

describe('the figures', () => {
  it('names the pair and rounds the rate to two places for a glance', async () => {
    arrange(
      fxRates({
        rates: [
          resolvedRate({ base: 'USD', rate: '49.80290000' }),
          resolvedRate({ base: 'EUR', rate: '57.51330000' }),
          resolvedRate({ base: 'GBP', rate: '67.06890000' }),
        ],
      }),
    );
    render(<Harness />);

    expect(await screen.findByText('49.80')).toBeInTheDocument();
    expect(screen.getByText('57.51')).toBeInTheDocument();
    expect(screen.getByText('67.07')).toBeInTheDocument();
    // Every figure is against the pound, so the quote is stated once per pill.
    expect(screen.getAllByText('EGP')).toHaveLength(3);
  });

  it('labels the band for a screen reader', async () => {
    arrange(fxRates());
    render(<Harness />);

    expect(
      await screen.findByLabelText('Exchange rates against the Egyptian pound'),
    ).toBeInTheDocument();
  });
});

describe('staleness', () => {
  it('says how old a fresh rate is, in words', async () => {
    arrange(fxRates({ rates: [resolvedRate({ ageMs: 24 * 60 * 60 * 1000 })] }));
    render(<Harness />);

    expect(await screen.findByText(/1 day ago/)).toBeInTheDocument();
  });

  /** Never colour alone (SPEC §10): the amber dot always comes with readable text. */
  it('pairs a stale rate with text, not just an amber dot', async () => {
    arrange(
      fxRates({
        rates: [
          resolvedRate({
            stale: true,
            staleReason: 'OLDER_THAN_30H',
            ageMs: 40 * 60 * 60 * 1000,
            asOf: new Date(Date.now() - 40 * 60 * 60 * 1000).toISOString(),
          }),
        ],
      }),
    );
    render(<Harness />);

    expect(await screen.findByText(/2 days ago|40 hours ago/)).toBeInTheDocument();
  });

  it('explains why it is stale rather than only that it is', async () => {
    const user = userEvent.setup();
    arrange(
      fxRates({
        rates: [resolvedRate({ stale: true, staleReason: 'PAST_NEXT_UPDATE' })],
      }),
    );
    render(<Harness />);

    // Stale rates get a focusable tooltip trigger; a fresh direct one does not.
    await screen.findByText('49.80');
    await user.tab();

    expect(
      await screen.findByText('The provider said it would have updated by now.'),
    ).toBeInTheDocument();
  });

  /**
   * `ageMs` goes negative when a backdated lookup fell back to a newer rate (D11/D12).
   * "In 6 months" would be nonsense, so the date is named instead.
   */
  it('names the date rather than saying "in six months" for a negative age', async () => {
    arrange(
      fxRates({
        rates: [
          resolvedRate({
            ageMs: -1000 * 60 * 60 * 24 * 30,
            asOf: '2026-08-03T00:00:00.000Z',
            stale: true,
            staleReason: 'NO_RATE_AT_OR_BEFORE_DATE',
          }),
        ],
      }),
    );
    render(<Harness />);

    expect(await screen.findByText(/^from /)).toBeInTheDocument();
    expect(screen.queryByText(/ago/)).toBeNull();
  });

  it('says a derived rate is derived, so it is never passed off as recorded', async () => {
    const user = userEvent.setup();
    arrange(fxRates({ rates: [resolvedRate({ derivation: 'INVERTED' })] }));
    render(<Harness />);

    await screen.findByText('49.80');
    await user.tab();

    expect(await screen.findByText('Derived rate')).toBeInTheDocument();
    expect(screen.getByText('Calculated by inverting the opposite pair.')).toBeInTheDocument();
  });
});

describe('the sparkline', () => {
  /** Its own viewBox — the lucide icons on this strip are svgs too. */
  const sparkline = (container: HTMLElement) => container.querySelector('svg[viewBox="0 0 64 18"]');

  /** One point is not a trend, and a flat line would imply a stability we cannot show. */
  it('draws nothing with fewer than two stored rates', async () => {
    arrange(fxRates(), [storedRate({ id: 'r1' })]);
    const { container } = render(<Harness />);

    await screen.findByText('49.80');
    await waitFor(() => expect(api.requestsFor('GET /fx/rates/stored').length).toBeGreaterThan(0));

    expect(sparkline(container)).toBeNull();
  });

  it('draws once there is a trend to draw', async () => {
    arrange(fxRates(), [
      storedRate({ id: 'r1', rate: '48.00000000', asOf: '2026-08-04T00:00:00.000Z' }),
      storedRate({ id: 'r2', rate: '49.00000000', asOf: '2026-08-05T00:00:00.000Z' }),
      storedRate({ id: 'r3', rate: '49.80290000', asOf: '2026-08-06T00:00:00.000Z' }),
    ]);
    const { container } = render(<Harness />);

    await screen.findByText('49.80');
    await waitFor(() => expect(sparkline(container)).not.toBeNull());
  });

  it('is hidden from assistive tech, because the figure and its age carry the meaning', async () => {
    arrange(fxRates(), [
      storedRate({ id: 'r1', rate: '48.00000000', asOf: '2026-08-04T00:00:00.000Z' }),
      storedRate({ id: 'r2', rate: '49.80290000', asOf: '2026-08-06T00:00:00.000Z' }),
    ]);
    const { container } = render(<Harness />);

    await waitFor(() => expect(sparkline(container)).not.toBeNull());
    expect(sparkline(container)).toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps each pair to its own series', async () => {
    arrange(
      fxRates({
        rates: [resolvedRate({ base: 'USD' }), resolvedRate({ base: 'EUR', rate: '57.51330000' })],
      }),
      [
        storedRate({ id: 'u1', base: 'USD', rate: '48.0', asOf: '2026-08-04T00:00:00.000Z' }),
        storedRate({ id: 'u2', base: 'USD', rate: '49.8', asOf: '2026-08-06T00:00:00.000Z' }),
        // EUR has only one point, so its pill draws nothing while USD draws.
        storedRate({ id: 'e1', base: 'EUR', rate: '57.5', asOf: '2026-08-06T00:00:00.000Z' }),
      ],
    );
    const { container } = render(<Harness />);

    await waitFor(() =>
      expect(container.querySelectorAll('svg[viewBox="0 0 64 18"]')).toHaveLength(1),
    );
  });
});

describe('refreshing', () => {
  it('offers the button only when the provider may be used at all', async () => {
    arrange(fxRates({ apiEnabled: false }));
    render(<Harness />);

    await screen.findByText('49.80');
    expect(screen.queryByRole('button', { name: 'Refresh exchange rates' })).toBeNull();
  });

  it('asks the server to refresh when it is available', async () => {
    const user = userEvent.setup();
    arrange(fxRates());
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Refresh exchange rates' }));

    await waitFor(() => expect(api.requestsFor('POST /fx/refresh')).toHaveLength(1));
  });

  it('says the refresh failed rather than going quiet', async () => {
    const user = userEvent.setup();
    arrange(fxRates());
    api.setRoute('POST /fx/refresh', {
      status: 503,
      body: { error: { code: 'X', message: 'The provider could not be reached.' } },
    });
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Refresh exchange rates' }));

    await waitFor(() => expect(getFailures()).toHaveLength(1));
    expect(getFailures()[0]).toMatchObject({
      headline: 'The rates could not be refreshed.',
      detail: 'The provider could not be reached.',
    });
  });
});

describe('when rates cannot be loaded', () => {
  /** Resolution never touches the network, so a failed fetch does not stop conversions. */
  it('says conversions still work from what is stored', async () => {
    api?.restore();
    api = stubApi({
      'GET /fx/rates': { status: 500, body: { error: { code: 'X', message: 'nope' } } },
      'GET /fx/rates/stored': { data: [] },
    });
    render(<Harness />);

    const strip = await screen.findByLabelText('Exchange rates against the Egyptian pound');
    expect(
      await within(strip).findByText(/Stored rates are still being used for conversions/),
    ).toBeInTheDocument();
  });
});
