import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FxRatesResponse } from '@ledger/shared';
import { stubApi, type ApiStub } from '@/test/http';
import { fxRates, resolvedRate, storedRate } from '@/test/fixtures';
import { ManualRateEditor } from './ManualRateEditor';

/**
 * Typing a rate by hand — the escape hatch, not the daily path (D12).
 *
 * It exists because the published rate is not always the rate you got: Egypt's parallel
 * market drifts from it, and a bank's rate carries its spread. So a typed rate is treated
 * as intent and takes effect immediately.
 *
 * Rates go in one canonical direction, foreign → EGP. Storing whichever way round the user
 * happened to think would let a stale manual `USD→EGP` shadow a fresh automatic `EGP→USD`,
 * because resolution prefers a direct match over an inverted one — so the quote is fixed
 * and only the base varies.
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
      <ManualRateEditor />
    </QueryClientProvider>
  );
}

let api: ApiStub;

function arrange(rates: FxRatesResponse = fxRates()) {
  api?.restore();
  api = stubApi({
    'GET /fx/rates': rates,
    'PUT /fx/manual': storedRate({ id: 'rate-1', source: 'MANUAL' }),
  });
}

const CURRENT = fxRates({
  rates: [
    resolvedRate({ base: 'USD', rate: '49.80290000', source: 'API' }),
    resolvedRate({ base: 'EUR', rate: '57.51330000', source: 'MANUAL' }),
    resolvedRate({ base: 'GBP', rate: '67.06890000', source: 'API' }),
  ],
});

const sent = () => api.requestsFor('PUT /fx/manual')[0]?.body as Record<string, unknown>;

beforeEach(() => {
  arrange(CURRENT);
});

afterEach(() => {
  api.restore();
});

describe('what it offers', () => {
  /** EGP against EGP is 1 by identity; a field for it would be a field for a constant. */
  it('gives a row to each foreign currency and none to the pound', async () => {
    render(<Harness />);

    expect(await screen.findByLabelText('1 USD → EGP')).toBeInTheDocument();
    expect(screen.getByLabelText('1 EUR → EGP')).toBeInTheDocument();
    expect(screen.getByLabelText('1 GBP → EGP')).toBeInTheDocument();
    expect(screen.queryByLabelText('1 EGP → EGP')).toBeNull();
  });

  /** The direction is stated in the label, not left for the user to infer from the box. */
  it('states the direction in every label', async () => {
    render(<Harness />);

    await screen.findByLabelText('1 USD → EGP');
    for (const label of ['1 USD → EGP', '1 EUR → EGP', '1 GBP → EGP']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  /** The current rate as a placeholder: a starting point, not a value to accidentally save. */
  it('shows the rate in force as the placeholder rather than as the value', async () => {
    render(<Harness />);

    const usd = await screen.findByLabelText('1 USD → EGP');
    // The row renders before the rates arrive, so the placeholder fills in afterwards.
    await waitFor(() => expect(usd).toHaveAttribute('placeholder', '49.8029'));
    expect(usd).toHaveValue('');
  });

  /**
   * Whether the figure in force was typed or fetched changes what you should do about it,
   * so it is stated rather than left to be guessed from how round the number looks.
   */
  it('says whether the rate in force was typed or fetched', async () => {
    render(<Harness />);

    expect(await screen.findByText('49.8029')).toBeInTheDocument();
    // Anchored: the paragraph above says "Rates arrive automatically", which a loose
    // /automatic/ matches as well — and would keep passing if a row lost its source.
    expect(screen.getByText(/· entered by hand$/)).toBeInTheDocument();
    expect(screen.getAllByText(/· automatic$/)).toHaveLength(2);
  });

  it('will not save an empty box', async () => {
    render(<Harness />);

    await screen.findByLabelText('1 USD → EGP');
    expect(screen.getAllByRole('button', { name: 'Set' })[0]).toBeDisabled();
  });
});

describe('saving a rate', () => {
  it('sends it in the canonical direction, foreign to EGP', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(await screen.findByLabelText('1 USD → EGP'), '52.5');
    await user.click(screen.getAllByRole('button', { name: 'Set' })[0] as HTMLElement);

    await waitFor(() => expect(api.requestsFor('PUT /fx/manual')).toHaveLength(1));
    expect(sent()).toEqual({ base: 'USD', quote: 'EGP', rate: '52.5' });
  });

  it('saves the row you typed in, not the first one', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(await screen.findByLabelText('1 GBP → EGP'), '70');
    await user.click(screen.getAllByRole('button', { name: 'Set' })[2] as HTMLElement);

    await waitFor(() => expect(api.requestsFor('PUT /fx/manual')).toHaveLength(1));
    expect(sent()['base']).toBe('GBP');
  });

  /** Typing a figure and pressing Enter is the whole interaction; reaching for the mouse is not. */
  it('saves on Enter without submitting anything else', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(await screen.findByLabelText('1 USD → EGP'), '52.5{Enter}');

    await waitFor(() => expect(api.requestsFor('PUT /fx/manual')).toHaveLength(1));
    expect(sent()['rate']).toBe('52.5');
  });

  it('confirms the save and clears the box, so it is not saved twice', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(await screen.findByLabelText('1 USD → EGP'), '52.5{Enter}');

    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(screen.getByLabelText('1 USD → EGP')).toHaveValue('');
  });

  it('ignores a box holding only whitespace', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(await screen.findByLabelText('1 USD → EGP'), '   {Enter}');

    expect(api.requestsFor('PUT /fx/manual')).toHaveLength(0);
  });
});

describe('when the server refuses', () => {
  /**
   * This one keeps its error inline rather than reporting to the shared action-feedback
   * region: there is a place to put it here, and a failure stated twice is worse than one
   * stated once (see CLAUDE.md).
   */
  it('says so in place', async () => {
    const user = userEvent.setup();
    api.setRoute('PUT /fx/manual', {
      status: 400,
      body: { error: { code: 'VALIDATION_ERROR', message: 'A rate must be greater than zero.' } },
    });
    render(<Harness />);

    await user.type(await screen.findByLabelText('1 USD → EGP'), '0{Enter}');

    expect(await screen.findByText('A rate must be greater than zero.')).toBeInTheDocument();
  });

  it('keeps what you typed, so it can be corrected rather than retyped', async () => {
    const user = userEvent.setup();
    api.setRoute('PUT /fx/manual', {
      status: 500,
      body: { error: { code: 'INTERNAL', message: 'The database is unreachable.' } },
    });
    render(<Harness />);

    await user.type(await screen.findByLabelText('1 USD → EGP'), '52.5{Enter}');

    await screen.findByText('The database is unreachable.');
    expect(screen.getByLabelText('1 USD → EGP')).toHaveValue('52.5');
    expect(screen.queryByText('Saved')).toBeNull();
  });
});

describe('before any rate has been fetched', () => {
  it('still offers every row, with a neutral placeholder', async () => {
    arrange(fxRates({ rates: [] }));
    render(<Harness />);

    expect(await screen.findByLabelText('1 USD → EGP')).toHaveAttribute('placeholder', '0.0000');
    expect(screen.getAllByRole('button', { name: 'Set' })).toHaveLength(3);
  });
});
