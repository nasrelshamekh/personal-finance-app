import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AccountDto, DebtDto } from '@ledger/shared';
import { stubApi, type ApiStub } from '@/test/http';
import { account, debt } from '@/test/fixtures';
import { PaymentSheet } from './PaymentSheet';

/**
 * Logging a payment — the SPEC §12 Phase 6 acceptance check, driven directly.
 *
 * The decision the sheet exists to make is whether the payment also moves an account. Both
 * answers are legitimate: a repayment out of your bank should show up as an expense, and a
 * debt you settled in cash you never tracked should not invent a transaction to explain it.
 * So "don't record" is a real option rather than an escape hatch, and the sheet says which
 * of the two you are choosing before you choose it.
 */

const CASH = account({ id: 'acc-egp', name: 'Cash', currency: 'EGP' });
const BANK = account({ id: 'acc-usd', name: 'Bank', currency: 'USD' });

const I_OWE = debt({
  id: 'debt-1',
  counterparty: 'Mostafa',
  direction: 'I_OWE',
  currency: 'EGP',
  principal: '5000.0000',
  remaining: '3200.0000',
});

const OWED_TO_ME = debt({
  id: 'debt-2',
  counterparty: 'Omar',
  direction: 'OWED_TO_ME',
  currency: 'USD',
  principal: '400.0000',
  remaining: '400.0000',
});

function Harness({ target }: { target: DebtDto | undefined }) {
  const [open, setOpen] = useState(true);
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <PaymentSheet debt={target} open={open} onOpenChange={setOpen} />
      <output data-testid="open">{String(open)}</output>
    </QueryClientProvider>
  );
}

let api: ApiStub;

function arrange(accounts: AccountDto[] = [CASH, BANK]) {
  api?.restore();
  api = stubApi({
    'GET /accounts': { data: accounts },
    'POST /debts/debt-1/payments': { status: 201, body: I_OWE },
    'POST /debts/debt-2/payments': { status: 201, body: OWED_TO_ME },
  });
}

/**
 * Waits for the accounts to be *applied*, not merely fetched — so the expected account is
 * named rather than checked for "some text".
 *
 * Waiting for any text was a real flake: the trigger reads "Don't record a transaction"
 * from the first paint, which satisfies a loose check, so a test could assert while the
 * default account was still being chosen. It only failed under full-suite load.
 */
async function ready(expectedAccount = 'Cash') {
  await waitFor(() => expect(api.requestsFor('GET /accounts').length).toBeGreaterThan(0));
  await waitFor(() => expect(screen.getByLabelText('Paid from')).toHaveTextContent(expectedAccount));
}

beforeEach(() => {
  arrange();
});

afterEach(() => {
  api.restore();
});

const logged = (id = 'debt-1') =>
  api.requestsFor(`POST /debts/${id}/payments`)[0]?.body as Record<string, unknown>;

describe('what it opens with', () => {
  it('renders nothing at all without a debt to pay', () => {
    render(<Harness target={undefined} />);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Log a payment')).toBeNull();
  });

  it('shows what is still outstanding', async () => {
    render(<Harness target={I_OWE} />);
    await ready();

    expect(screen.getByText('Still outstanding')).toBeInTheDocument();
    expect(screen.getByText('3,200.00')).toBeInTheDocument();
  });

  /** Settling in full is the common case, so it is the one you do not have to type. */
  it('pre-fills the whole remaining balance', async () => {
    render(<Harness target={I_OWE} />);
    await ready();

    expect(screen.getByLabelText(/^Amount/)).toHaveValue('3200');
  });

  /**
   * Defaulting to an account in the debt's own currency keeps the common payment
   * single-currency — no conversion, so no rate to argue with later.
   */
  it('defaults to an account in the debt’s currency', async () => {
    render(<Harness target={OWED_TO_ME} />);
    await ready('Bank');

    expect(screen.getByLabelText('Paid from')).toHaveTextContent('Bank');
  });

  /**
   * The dropdown is opened rather than waited on: "don't record" is also what the trigger
   * reads before the accounts arrive, so seeing it proves nothing on its own. Finding Bank
   * in the list proves they *have* arrived — and that it was offered and simply not chosen.
   */
  it('falls back to recording nothing when no account matches', async () => {
    const user = userEvent.setup();
    arrange([BANK]);
    render(<Harness target={I_OWE} />);

    await user.click(screen.getByLabelText('Paid from'));
    expect(await screen.findByRole('option', { name: /^Bank/ })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    expect(screen.getByLabelText('Paid from')).toHaveTextContent("Don't record a transaction");
  });

  it('names who the money is going to', async () => {
    render(<Harness target={I_OWE} />);
    await ready();

    expect(screen.getByText('Money going to Mostafa.')).toBeInTheDocument();
  });

  it('names who the money is coming back from', async () => {
    render(<Harness target={OWED_TO_ME} />);
    await ready('Bank');

    expect(screen.getByText('Money coming back from Omar.')).toBeInTheDocument();
  });
});

describe('recording the matching transaction', () => {
  it('sends the account it will be recorded against', async () => {
    const user = userEvent.setup();
    render(<Harness target={I_OWE} />);
    await ready();

    await user.click(screen.getByRole('button', { name: 'Log payment' }));

    await waitFor(() => expect(api.requestsFor('POST /debts/debt-1/payments')).toHaveLength(1));
    expect(logged()).toMatchObject({ amount: '3200', accountId: 'acc-egp', note: null });
    expect(logged()['date']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  /** Explicitly `null`, not omitted — the server is being told not to write one. */
  it('sends null when you choose not to record one', async () => {
    const user = userEvent.setup();
    render(<Harness target={I_OWE} />);
    await ready();

    await user.click(screen.getByLabelText('Paid from'));
    await user.click(screen.getByRole('option', { name: "Don't record a transaction" }));
    await user.click(screen.getByRole('button', { name: 'Log payment' }));

    await waitFor(() => expect(api.requestsFor('POST /debts/debt-1/payments')).toHaveLength(1));
    expect(logged()['accountId']).toBeNull();
  });

  /** Said before you commit, not discovered afterwards in the transactions list. */
  it('says what will happen to the account balance, either way', async () => {
    const user = userEvent.setup();
    render(<Harness target={I_OWE} />);
    await ready();

    expect(
      screen.getByText('A matching expense will be recorded against this account.'),
    ).toBeInTheDocument();

    await user.click(screen.getByLabelText('Paid from'));
    await user.click(screen.getByRole('option', { name: "Don't record a transaction" }));

    expect(
      screen.getByText('The debt balance updates, but no account balance changes.'),
    ).toBeInTheDocument();
  });

  /** Money coming back is income, not a negative expense. */
  it('calls it an income when the debt is owed to you', async () => {
    render(<Harness target={OWED_TO_ME} />);
    await ready('Bank');

    expect(
      screen.getByText('A matching income will be recorded against this account.'),
    ).toBeInTheDocument();
  });
});

describe('paying in a different currency', () => {
  /**
   * The amount is in the *account's* currency, not the debt's — you can settle a dollar
   * debt out of an EGP account. Saying which currency the box is in is the difference
   * between a 400 that means $400 and a 400 that means E£400.
   */
  it('labels the amount with the account’s currency, not the debt’s', async () => {
    const user = userEvent.setup();
    render(<Harness target={OWED_TO_ME} />);
    await ready('Bank');

    expect(screen.getByLabelText(/^Amount/)).toHaveAccessibleName('Amount USD');

    await user.click(screen.getByLabelText('Paid from'));
    await user.click(screen.getByRole('option', { name: /^Cash/ }));

    expect(screen.getByLabelText(/^Amount/)).toHaveAccessibleName('Amount EGP');
  });
});

describe('the rest of the form', () => {
  it('sends a note when there is one', async () => {
    const user = userEvent.setup();
    render(<Harness target={I_OWE} />);
    await ready();

    await user.type(screen.getByLabelText('Note'), 'First instalment');
    await user.click(screen.getByRole('button', { name: 'Log payment' }));

    await waitFor(() => expect(api.requestsFor('POST /debts/debt-1/payments')).toHaveLength(1));
    expect(logged()['note']).toBe('First instalment');
  });

  it('will not log a payment of nothing', async () => {
    const user = userEvent.setup();
    render(<Harness target={I_OWE} />);
    await ready();

    await user.clear(screen.getByLabelText(/^Amount/));

    expect(screen.getByRole('button', { name: 'Log payment' })).toBeDisabled();
  });

  it('closes once the payment is in', async () => {
    const user = userEvent.setup();
    render(<Harness target={I_OWE} />);
    await ready();

    await user.click(screen.getByRole('button', { name: 'Log payment' }));

    await waitFor(() => expect(screen.getByTestId('open')).toHaveTextContent('false'));
  });
});

describe('when the server refuses', () => {
  /** Overpaying is the failure this sheet actually meets, and it names the amount field. */
  it('puts the message on the field the server names', async () => {
    const user = userEvent.setup();
    api.setRoute('POST /debts/debt-1/payments', {
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'That is more than is still outstanding.',
          details: { field: 'amount' },
        },
      },
    });
    render(<Harness target={I_OWE} />);
    await ready();

    await user.click(screen.getByRole('button', { name: 'Log payment' }));

    expect(await screen.findByText('That is more than is still outstanding.')).toBeInTheDocument();
    expect(screen.getByTestId('open')).toHaveTextContent('true');
  });

  it('states a general failure rather than closing as though it worked', async () => {
    const user = userEvent.setup();
    api.setRoute('POST /debts/debt-1/payments', {
      status: 500,
      body: { error: { code: 'INTERNAL', message: 'The database is unreachable.' } },
    });
    render(<Harness target={I_OWE} />);
    await ready();

    await user.click(screen.getByRole('button', { name: 'Log payment' }));

    expect(await screen.findByText('The database is unreachable.')).toBeInTheDocument();
    expect(screen.getByTestId('open')).toHaveTextContent('true');
  });
});
