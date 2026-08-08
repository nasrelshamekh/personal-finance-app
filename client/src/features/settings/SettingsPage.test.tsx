import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { BACKUP_FORMAT, BACKUP_VERSION, RESET_CONFIRMATION } from '@ledger/shared';
import type { SettingsDto } from '@ledger/shared';
import { stubApi, type ApiStub } from '@/test/http';
import { ThemeProvider } from '@/providers/ThemeProvider';
import { SettingsPage } from './SettingsPage';

/**
 * The destructive half of this page is what matters: a restore replaces everything and a
 * reset erases it, so both are guarded and neither happens on a single click.
 *
 * The theme is the opposite case — it applies from localStorage immediately and syncs
 * afterwards, so the sync failing must not undo what you just saw happen.
 */

function settings(overrides: Partial<SettingsDto> = {}): SettingsDto {
  return {
    baseCurrency: 'EGP',
    baseCurrencyLocked: true,
    locale: 'en-US',
    rateSource: 'API',
    ratesApiEnabled: true,
    ratesApiEolAt: null,
    themePreset: 'graphite',
    themeMode: 'system',
    updatedAt: '2026-08-06T00:00:00.000Z',
    ...overrides,
  };
}

function Harness() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

let api: ApiStub;

function arrange(current = settings()) {
  api?.restore();
  api = stubApi({
    'GET /settings': current,
    'PUT /settings': current,
    'GET /categories': { data: [] },
    'GET /fx/rates': { rates: [], apiEnabled: true, apiEolAt: null, autoRefresh: 'FRESH' },
    'POST /reset': { deleted: {}, totalDeleted: 12, restoredStarterData: true },
  });
}

const settingsWrites = () => api.requestsFor('PUT /settings').map((r) => r.body);

beforeEach(() => {
  localStorage.clear();
  arrange();
});

afterEach(() => {
  api.restore();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('appearance', () => {
  it('applies the mode locally and syncs it afterwards (SPEC §11)', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: /Dark/ }));

    // Local first: the class is on <html> without waiting for the round trip.
    expect(document.documentElement).toHaveClass('dark');
    await waitFor(() => expect(settingsWrites()).toContainEqual({ themeMode: 'dark' }));
  });

  it('remembers the mode, so the blocking script picks it up next load', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: /Light/ }));

    expect(localStorage.getItem('ledger.theme.mode')).toBe('light');
  });

  it('syncs a preset the same way', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: /Harbour/ }));

    await waitFor(() => expect(settingsWrites()).toContainEqual({ themePreset: 'harbour' }));
    expect(document.documentElement.dataset['theme']).toBe('harbour');
  });

  /** The choice has already taken effect; a failed sync must not visibly undo it. */
  it('keeps the applied theme even when the sync fails', async () => {
    const user = userEvent.setup();
    api.setRoute('PUT /settings', {
      status: 500,
      body: { error: { code: 'X', message: 'Database unavailable.' } },
    });
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: /Dark/ }));

    await waitFor(() => expect(settingsWrites().length).toBeGreaterThan(0));
    expect(document.documentElement).toHaveClass('dark');
  });

  it('marks the active preset for a screen reader, not only by looking different', async () => {
    render(<Harness />);

    const graphite = await screen.findByRole('button', { name: /Graphite/ });
    expect(graphite).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Harbour/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});

describe('the base currency', () => {
  it('is shown, disabled, and honest about doing nothing (D6)', async () => {
    render(<Harness />);

    const field = await screen.findByLabelText('Base currency');
    expect(field).toBeDisabled();
    expect(field).toHaveValue('EGP — fixed in this version');
    expect(screen.getByText(/does nothing until it genuinely works/)).toBeInTheDocument();
  });
});

describe('automatic rates', () => {
  it('is a switch that reports its state to assistive tech', async () => {
    render(<Harness />);

    const toggle = await screen.findByRole('switch', { name: 'Fetch rates automatically' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/Currently on/)).toBeInTheDocument();
  });

  it('turns it off, and says what that means rather than warning you off it', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(await screen.findByRole('switch', { name: 'Fetch rates automatically' }));

    await waitFor(() => expect(settingsWrites()).toContainEqual({ ratesApiEnabled: false }));
    expect(screen.getByText(/it stays fully usable with no network at all/)).toBeInTheDocument();
  });

  it('says nothing about a shutdown when the provider has not announced one', async () => {
    render(<Harness />);

    await screen.findByRole('switch', { name: 'Fetch rates automatically' });
    expect(screen.queryByText(/has announced a shutdown/)).toBeNull();
  });

  /** D10: the provider publishes an end-of-life date, and Settings must not hide it. */
  it('warns when the provider has announced one, and says nothing breaks', async () => {
    arrange(settings({ ratesApiEolAt: '2027-03-01T00:00:00.000Z' }));
    render(<Harness />);

    expect(await screen.findByText(/has announced a shutdown/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing breaks when it does/)).toBeInTheDocument();
  });
});

describe('restoring from a backup', () => {
  const validBackup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: '2026-08-06T00:00:00.000Z',
    data: {
      accounts: [],
      categories: [],
      debts: [],
      debtPayments: [],
      savingsGoals: [],
      savingsContributions: [],
      transactions: [],
      budgets: [],
      exchangeRates: [],
      settings: {
        baseCurrency: 'EGP',
        locale: 'en-US',
        rateSource: 'API',
        ratesApiEnabled: true,
        ratesApiEolAt: null,
        themePreset: 'graphite',
        themeMode: 'system',
      },
    },
  };

  function file(contents: unknown, name = 'ledger-eg-2026-08-06.json') {
    return new File([JSON.stringify(contents)], name, { type: 'application/json' });
  }

  /**
   * A truncated or half-written `.json` — the realistic corruption. A `.txt` would not
   * reach the handler at all, since the input's `accept` filters it out first.
   */
  it('rejects a damaged file without troubling the server', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = await screen.findByLabelText('Choose a backup file');
    await user.upload(
      input,
      new File(['{"format":"ledger-eg.backup",'], 'truncated.json', {
        type: 'application/json',
      }),
    );

    expect(await screen.findByText('That file is not JSON.')).toBeInTheDocument();
    expect(api.requestsFor('POST /import')).toHaveLength(0);
  });

  it('rejects a JSON file that is not a backup, locally', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = await screen.findByLabelText('Choose a backup file');
    await user.upload(input, file({ hello: 'world' }));

    // Validated with the same schema the server uses (D7), so it fails instantly.
    expect(await screen.findByText(/not a Ledger EG backup, or it is damaged/)).toBeInTheDocument();
    expect(api.requestsFor('POST /import')).toHaveLength(0);
  });

  it('runs a dry run first and writes nothing until you confirm', async () => {
    const user = userEvent.setup();
    api.setRoute('POST /import', {
      body: {
        dryRun: true,
        applied: false,
        exportedAt: '2026-08-06T00:00:00.000Z',
        changes: [{ table: 'transactions', existing: 8, incoming: 3 }],
        totalExisting: 8,
        totalIncoming: 3,
        approximateRows: [],
        problems: [],
      },
    });
    render(<Harness />);

    await user.upload(await screen.findByLabelText('Choose a backup file'), file(validBackup));

    await waitFor(() => expect(api.requestsFor('POST /import')).toHaveLength(1));
    expect(api.requestsFor('POST /import')[0]?.body).toMatchObject({ dryRun: true });

    expect(await screen.findByText('What this would do')).toBeInTheDocument();
    expect(screen.getByText(/8 rows here now, 3 in the backup/)).toBeInTheDocument();
  });

  it('only then offers the replace, and says plainly that it replaces', async () => {
    const user = userEvent.setup();
    api.setRoute('POST /import', {
      body: {
        dryRun: true,
        applied: false,
        exportedAt: '2026-08-06T00:00:00.000Z',
        changes: [],
        totalExisting: 8,
        totalIncoming: 3,
        approximateRows: [],
        problems: [],
      },
    });
    render(<Harness />);

    await user.upload(await screen.findByLabelText('Choose a backup file'), file(validBackup));

    const apply = await screen.findByRole('button', {
      name: 'Replace everything with this backup',
    });
    await user.click(apply);

    await waitFor(() => expect(api.requestsFor('POST /import')).toHaveLength(2));
    expect(api.requestsFor('POST /import')[1]?.body).toMatchObject({ dryRun: false });
  });

  it('refuses to offer the replace when the dry run found problems', async () => {
    const user = userEvent.setup();
    api.setRoute('POST /import', {
      body: {
        dryRun: true,
        applied: false,
        exportedAt: '2026-08-06T00:00:00.000Z',
        changes: [],
        totalExisting: 8,
        totalIncoming: 3,
        approximateRows: [],
        problems: ['Transaction abc names an account that is not in the backup.'],
      },
    });
    render(<Harness />);

    await user.upload(await screen.findByLabelText('Choose a backup file'), file(validBackup));

    expect(
      await screen.findByText('This backup cannot be restored — nothing has been changed.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Replace everything with this backup' }),
    ).toBeNull();
  });

  it('flags rows whose rate post-dates them rather than importing them silently', async () => {
    const user = userEvent.setup();
    api.setRoute('POST /import', {
      body: {
        dryRun: true,
        applied: false,
        exportedAt: '2026-08-06T00:00:00.000Z',
        changes: [],
        totalExisting: 0,
        totalIncoming: 2,
        approximateRows: [
          { table: 'transactions', id: 'tx-1', date: '2026-03-12', rateAsOf: '2026-08-03' },
        ],
        problems: [],
      },
    });
    render(<Harness />);

    await user.upload(await screen.findByLabelText('Choose a backup file'), file(validBackup));

    expect(await screen.findByText(/1 row was/)).toBeInTheDocument();
    expect(screen.getByText(/flagged, not silently corrected/)).toBeInTheDocument();
  });
});

describe('erasing everything', () => {
  it('stays disabled until the exact words are typed', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const erase = await screen.findByRole('button', { name: 'Erase everything' });
    expect(erase).toBeDisabled();

    await user.type(screen.getByLabelText(/Type .* to confirm/), 'erase everything');
    expect(erase).toBeDisabled();

    await user.clear(screen.getByLabelText(/Type .* to confirm/));
    await user.type(screen.getByLabelText(/Type .* to confirm/), RESET_CONFIRMATION);
    expect(erase).toBeEnabled();
  });

  it('sends the confirmation and the starter-data choice', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(await screen.findByLabelText(/Type .* to confirm/), RESET_CONFIRMATION);
    await user.click(screen.getByRole('button', { name: 'Erase everything' }));

    await waitFor(() => expect(api.requestsFor('POST /reset')).toHaveLength(1));
    expect(api.requestsFor('POST /reset')[0]?.body).toEqual({
      confirmation: RESET_CONFIRMATION,
      // On by default: a ledger with no categories cannot record an expense.
      restoreStarterData: true,
    });
  });

  it('lets you decline the starter data', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(await screen.findByLabelText(/Put the starter categories and rates back/));
    await user.type(screen.getByLabelText(/Type .* to confirm/), RESET_CONFIRMATION);
    await user.click(screen.getByRole('button', { name: 'Erase everything' }));

    await waitFor(() => expect(api.requestsFor('POST /reset')).toHaveLength(1));
    expect(api.requestsFor('POST /reset')[0]?.body).toMatchObject({ restoreStarterData: false });
  });

  it('warns that there is no copy kept', async () => {
    render(<Harness />);

    expect(
      await screen.findByText(/export first if there is any chance you want this back/i),
    ).toBeInTheDocument();
  });

  it('reports how much it removed', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(await screen.findByLabelText(/Type .* to confirm/), RESET_CONFIRMATION);
    await user.click(screen.getByRole('button', { name: 'Erase everything' }));

    expect(await screen.findByText(/Erased 12 rows/)).toBeInTheDocument();
  });
});
