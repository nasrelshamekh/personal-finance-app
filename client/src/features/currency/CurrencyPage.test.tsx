import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FxRatesResponse } from '@ledger/shared';
import { stubApi, type ApiStub } from '@/test/http';
import { fxRates, resolvedRate } from '@/test/fixtures';
import { TooltipProvider } from '@/components/ui/tooltip';
import { CurrencyPage } from './CurrencyPage';

/**
 * Three things carry this page.
 *
 * The converter goes through the API rather than multiplying locally, so what it shows is
 * exactly what a transaction would be frozen at — one parser, one rate table, no second
 * opinion (SPEC §9).
 *
 * A refresh reports what it *moved*, not merely that it happened, and a partial refresh
 * names the pairs it could not reach rather than discarding the ones it got.
 *
 * A rate that is not an exact stored match says so, so a derived figure is never passed
 * off as a recorded one.
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
        <CurrencyPage />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

let api: ApiStub;

function arrange(rates: FxRatesResponse = fxRates()) {
  api?.restore();
  api = stubApi({
    'GET /fx/rates': rates,
    'GET /fx/convert': {
      amount: '100.0000',
      from: 'USD',
      to: 'EGP',
      result: '4980.2900',
      rate: resolvedRate(),
    },
    'PUT /fx/manual': {
      id: 'r1',
      base: 'USD',
      quote: 'EGP',
      rate: '52.0',
      asOf: 'x',
      nextUpdateAt: null,
      source: 'MANUAL',
    },
    'POST /fx/refresh': {
      refreshedAt: '2026-08-06T00:00:00.000Z',
      changes: [],
      failures: [],
      apiEolAt: null,
    },
  });
}

const converted = () => api.requestsFor('GET /fx/convert');

/**
 * The table renders skeleton rows while the query is in flight, so `findByRole('table')`
 * resolves before there is anything in it. Waiting for a figure is what waits for data.
 */
async function tableShowing(rate: string): Promise<HTMLElement> {
  const table = await screen.findByRole('table');
  await within(table).findByText(rate);
  return table;
}

beforeEach(() => {
  arrange();
});

afterEach(() => {
  api.restore();
});

describe('the converter', () => {
  it('asks the server rather than multiplying locally', async () => {
    arrange();
    render(<Harness />);

    // It starts on 100 USD → EGP, so the first conversion happens without any input.
    await waitFor(() => expect(converted().length).toBeGreaterThan(0));
    expect(converted()[0]?.query.get('amount')).toBe('100');
    expect(converted()[0]?.query.get('from')).toBe('USD');
    expect(converted()[0]?.query.get('to')).toBe('EGP');

    expect(await screen.findByText('4,980.29')).toBeInTheDocument();
  });

  it('states the rate it used, so the figure can be checked', async () => {
    arrange();
    render(<Harness />);

    // "1 USD → …" also appears as the manual editor's label, so scope to the converter.
    const converter = (await screen.findByText('Convert')).closest('section') as HTMLElement;

    await within(converter).findByText('4,980.29');
    expect(within(converter).getByText(/49\.8029 EGP/)).toBeInTheDocument();
  });

  it('sends an expression through untouched, since the server runs the same parser', async () => {
    const user = userEvent.setup();
    arrange();
    render(<Harness />);
    await waitFor(() => expect(converted().length).toBeGreaterThan(0));

    const amount = screen.getByLabelText('Amount');
    await user.clear(amount);
    await user.type(amount, '1200*3');

    await waitFor(() => {
      expect(converted().map((r) => r.query.get('amount'))).toContain('1200*3');
    });
  });

  it('asks for nothing at all when the amount is empty', async () => {
    const user = userEvent.setup();
    arrange();
    render(<Harness />);
    await waitFor(() => expect(converted().length).toBeGreaterThan(0));

    const before = converted().length;
    await user.clear(screen.getByLabelText('Amount'));

    // A blank box is not a conversion request; it just shows a dash.
    await waitFor(() => expect(screen.getByText('—')).toBeInTheDocument());
    expect(converted().length).toBe(before);
  });

  /*
   * Not tested here: that the previous figure is *held* while a new amount converts.
   *
   * The amount is part of the query key, so every keystroke used to blank `data` and
   * unmount the rate line, which is what made the panel jump as you typed another zero
   * onto 100. `keepPreviousData` fixes it, but the difference exists only for the moment
   * the request is in flight — and the stub here resolves synchronously, so there is no
   * such moment to catch. A test that waits for it would be timing against the harness
   * rather than the behaviour. Verified in the browser instead: the rates table below held
   * a single position across four amount changes.
   *
   * What *is* tested is the regression it introduced, immediately above: a held figure
   * must not outlive the amount that produced it.
   */

  it('swaps the two currencies round', async () => {
    const user = userEvent.setup();
    arrange();
    render(<Harness />);
    await waitFor(() => expect(converted().length).toBeGreaterThan(0));

    await user.click(screen.getByRole('button', { name: 'Swap the two currencies' }));

    await waitFor(() => {
      const last = converted()[converted().length - 1];
      expect(last?.query.get('from')).toBe('EGP');
      expect(last?.query.get('to')).toBe('USD');
    });
  });

  it('explains a triangulated rate rather than presenting it as recorded', async () => {
    arrange();
    api.setRoute('GET /fx/convert', {
      amount: '100.0000',
      from: 'EUR',
      to: 'GBP',
      result: '85.0000',
      rate: resolvedRate({ base: 'EUR', quote: 'GBP', derivation: 'TRIANGULATED' }),
    });
    render(<Harness />);

    expect(
      await screen.findByText('Worked out through Egyptian pounds from two rates.'),
    ).toBeInTheDocument();
  });

  it('says to check the amount when the server rejects it', async () => {
    arrange();
    api.setRoute('GET /fx/convert', {
      status: 400,
      body: { error: { code: 'BAD_REQUEST', message: 'Unexpected token.' } },
    });
    render(<Harness />);

    expect(await screen.findByText('Check the amount.')).toBeInTheDocument();
  });
});

describe('the rate table', () => {
  it('lists each stored pair with its rate to four places', async () => {
    arrange(
      fxRates({
        rates: [
          resolvedRate({ base: 'USD', rate: '49.80290000' }),
          resolvedRate({ base: 'EUR', rate: '57.51330000' }),
        ],
      }),
    );
    render(<Harness />);

    const table = await tableShowing('49.8029');
    expect(within(table).getByText('57.5133')).toBeInTheDocument();
  });

  it('distinguishes a typed rate from a fetched one', async () => {
    arrange(
      fxRates({
        rates: [
          resolvedRate({ base: 'USD', source: 'MANUAL' }),
          resolvedRate({ base: 'EUR', rate: '57.51330000', source: 'API' }),
        ],
      }),
    );
    render(<Harness />);

    const table = await tableShowing('49.8029');
    expect(within(table).getByText(/Entered by hand/)).toBeInTheDocument();
    expect(within(table).getByText(/Automatic/)).toBeInTheDocument();
  });

  it('names the derivation when a pair was not a direct match', async () => {
    arrange(fxRates({ rates: [resolvedRate({ derivation: 'INVERTED' })] }));
    render(<Harness />);

    const table = await tableShowing('49.8029');
    expect(within(table).getByText(/Inverted/)).toBeInTheDocument();
  });

  it('captions itself for a screen reader', async () => {
    arrange();
    render(<Harness />);

    const table = await screen.findByRole('table');
    expect(
      within(table).getByText('Exchange rates against the Egyptian pound'),
    ).toBeInTheDocument();
  });
});

describe('refreshing', () => {
  it('is offered only when automatic rates are switched on', async () => {
    arrange(fxRates({ apiEnabled: false }));
    render(<Harness />);

    expect(await screen.findByText(/Automatic rates are switched off/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Refresh now/ })).toBeNull();
  });

  it('reports what moved, with the previous figure beside the new one', async () => {
    const user = userEvent.setup();
    arrange();
    api.setRoute('POST /fx/refresh', {
      refreshedAt: '2026-08-06T00:00:00.000Z',
      changes: [
        {
          base: 'USD',
          quote: 'EGP',
          previousRate: '49.0000',
          newRate: '49.8029',
          deltaPct: '1.6386',
        },
      ],
      failures: [],
      apiEolAt: null,
    });
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: /Refresh now/ }));

    // The new figure is also in the rate table, so scope to the "what changed" panel.
    const panel = (await screen.findByText('What changed')).closest('div') as HTMLElement;

    expect(within(panel).getByText('49.0000')).toBeInTheDocument();
    expect(within(panel).getByText('49.8029')).toBeInTheDocument();
    expect(within(panel).getByText(/1\.64%/)).toBeInTheDocument();
  });

  /** A pound buying fewer dollars is bad news, so the direction is spelled out in words. */
  it('says which way the pound moved, not only which colour the arrow is', async () => {
    const user = userEvent.setup();
    arrange();
    api.setRoute('POST /fx/refresh', {
      refreshedAt: '2026-08-06T00:00:00.000Z',
      changes: [
        {
          base: 'USD',
          quote: 'EGP',
          previousRate: '49.0000',
          newRate: '49.8029',
          deltaPct: '1.6386',
        },
      ],
      failures: [],
      apiEolAt: null,
    });
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: /Refresh now/ }));

    expect(await screen.findByText(/the pound weakened against/)).toBeInTheDocument();
  });

  it('marks a first-ever rate as such rather than inventing a change', async () => {
    const user = userEvent.setup();
    arrange();
    api.setRoute('POST /fx/refresh', {
      refreshedAt: '2026-08-06T00:00:00.000Z',
      changes: [
        { base: 'GBP', quote: 'EGP', previousRate: null, newRate: '67.0689', deltaPct: null },
      ],
      failures: [],
      apiEolAt: null,
    });
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: /Refresh now/ }));

    expect(await screen.findByText('first recorded rate')).toBeInTheDocument();
  });

  it('says plainly when nothing moved', async () => {
    const user = userEvent.setup();
    arrange();
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: /Refresh now/ }));

    expect(await screen.findByText('Nothing moved.')).toBeInTheDocument();
  });

  /** A partial refresh keeps what it got — one bad pair is no reason to discard two good ones. */
  it('names the pairs it could not reach, and says the rest are unchanged', async () => {
    const user = userEvent.setup();
    arrange();
    api.setRoute('POST /fx/refresh', {
      refreshedAt: '2026-08-06T00:00:00.000Z',
      changes: [
        {
          base: 'USD',
          quote: 'EGP',
          previousRate: '49.0000',
          newRate: '49.8029',
          deltaPct: '1.6386',
        },
      ],
      failures: [{ quote: 'GBP', message: 'timeout' }],
      apiEolAt: null,
    });
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: /Refresh now/ }));

    expect(await screen.findByText(/Could not reach the provider for/)).toBeInTheDocument();
    expect(screen.getByText(/Those rates are unchanged/)).toBeInTheDocument();
  });

  it('points at the manual editor when the provider is unreachable entirely', async () => {
    const user = userEvent.setup();
    arrange();
    api.setRoute('POST /fx/refresh', {
      status: 503,
      body: { error: { code: 'X', message: 'unreachable' } },
    });
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: /Refresh now/ }));

    expect(await screen.findByText(/set one by hand below if you need it now/)).toBeInTheDocument();
  });
});

describe('typing a rate by hand', () => {
  it('sends it against the pound, in the canonical direction', async () => {
    const user = userEvent.setup();
    arrange();
    render(<Harness />);

    await user.type(await screen.findByLabelText('1 USD → EGP'), '52');
    await user.click(
      within(
        screen.getByLabelText('1 USD → EGP').closest('div')?.parentElement as HTMLElement,
      ).getByRole('button', { name: 'Set' }),
    );

    await waitFor(() => expect(api.requestsFor('PUT /fx/manual')).toHaveLength(1));
    expect(api.requestsFor('PUT /fx/manual')[0]?.body).toEqual({
      base: 'USD',
      quote: 'EGP',
      rate: '52',
    });
  });

  it('explains when you would want to, rather than presenting it as the normal path', async () => {
    arrange();
    render(<Harness />);

    expect(
      await screen.findByText(/a parallel-market rate, or a bank's rate including its spread/),
    ).toBeInTheDocument();
  });

  it('will not send an empty rate', async () => {
    arrange();
    render(<Harness />);

    await screen.findByLabelText('1 USD → EGP');
    const setButtons = screen.getAllByRole('button', { name: 'Set' });

    expect(setButtons.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
  });

  it('shows the current stored figure beside each field', async () => {
    arrange(fxRates({ rates: [resolvedRate({ base: 'USD', source: 'MANUAL' })] }));
    render(<Harness />);

    // Waits for the rates, which is what fills in the "now …" line.
    expect(await screen.findByText(/entered by hand/)).toBeInTheDocument();
  });
});

describe('attribution', () => {
  /** A licence condition of the free endpoint, not decoration (D10). */
  it('credits the provider', async () => {
    arrange();
    render(<Harness />);

    const link = await screen.findByRole('link', { name: /Exchange Rate API/ });
    expect(link).toHaveAttribute('href', 'https://www.exchangerate-api.com');
  });
});
