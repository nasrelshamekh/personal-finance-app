import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DebtDto } from '@ledger/shared';
import { stubApi, type ApiStub } from '@/test/http';
import { account, debt, debtPayment } from '@/test/fixtures';
import { dismissFailure, getFailures } from '@/lib/action-feedback';
import { DebtsPage } from './DebtsPage';

/**
 * Debts are kept in the debt's own currency (D4), so the assertions here are about which
 * currency a figure is shown in and what a payment sends — not about pound totals.
 *
 * The pound figure is display-only and says when it is stale; nothing on this page should
 * imply a converted balance is exact.
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
      <DebtsPage />
    </QueryClientProvider>
  );
}

const CASH = account({ id: 'acc-egp', name: 'Cash (EGP)', currency: 'EGP' });
const BANK = account({ id: 'acc-usd', name: 'Bank (USD)', currency: 'USD' });

let api: ApiStub;

function arrange(debts: DebtDto[], accounts = [CASH, BANK]) {
  api?.restore();
  api = stubApi({
    'GET /debts': { data: debts },
    'GET /accounts': { data: accounts },
    'POST /debts/debt-1/payments': debts[0] ?? {},
    'PATCH /debts/debt-1': debts[0] ?? {},
    'DELETE /debts/debt-1': { id: 'debt-1' },
  });
}

const paymentBody = () => api.requestsFor('POST /debts/debt-1/payments')[0]?.body;

afterEach(() => {
  api.restore();
  for (const failure of getFailures()) dismissFailure(failure.id);
  vi.restoreAllMocks();
});

beforeEach(() => {
  arrange([]);
});

describe('the two directions', () => {
  it('starts on what you owe and offers the other side', async () => {
    arrange([]);
    render(<Harness />);

    const owe = await screen.findByRole('tab', { name: /I owe/ });
    expect(owe).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Owed to me/ })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('shows only the direction that is selected', async () => {
    const user = userEvent.setup();
    arrange([
      debt({ id: 'debt-1', counterparty: 'Omar', direction: 'I_OWE' }),
      debt({ id: 'debt-2', counterparty: 'Salma', direction: 'OWED_TO_ME' }),
    ]);
    render(<Harness />);

    expect(await screen.findByText('Omar')).toBeInTheDocument();
    expect(screen.queryByText('Salma')).toBeNull();

    await user.click(screen.getByRole('tab', { name: /Owed to me/ }));

    expect(screen.getByText('Salma')).toBeInTheDocument();
    expect(screen.queryByText('Omar')).toBeNull();
  });

  it('counts only the active debts on each tab', async () => {
    arrange([
      debt({ id: 'debt-1', counterparty: 'Omar', direction: 'I_OWE' }),
      debt({ id: 'debt-2', counterparty: 'Hana', direction: 'I_OWE', status: 'SETTLED' }),
    ]);
    render(<Harness />);

    // The tabs render before the debts arrive, so wait for a card rather than the tab.
    await screen.findByText('Omar');

    // Two debts on this side, one of them settled, so the badge counts 1.
    expect(screen.getByRole('tab', { name: /I owe/ })).toHaveTextContent('1');
  });

  it('words the empty state for the side you are looking at', async () => {
    const user = userEvent.setup();
    arrange([]);
    render(<Harness />);

    expect(await screen.findByText('You owe nothing')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Owed to me/ }));
    expect(screen.getByText('Nobody owes you')).toBeInTheDocument();
  });
});

describe('what a card says', () => {
  it('leads with the debt currency and marks an out-of-date pound figure as approximate', async () => {
    arrange([
      debt({
        id: 'debt-1',
        counterparty: 'Omar',
        currency: 'USD',
        principal: '100.0000',
        remaining: '100.0000',
        remainingEgp: '5000.0000',
        remainingEgpStale: true,
      }),
    ]);
    render(<Harness />);

    await screen.findByText('Omar');
    // The pound figure is a conversion, and it says when it cannot be trusted.
    expect(screen.getByText('· approx')).toBeInTheDocument();
  });

  it('leaves the pound line off entirely for a debt already in pounds', async () => {
    arrange([debt({ id: 'debt-1', counterparty: 'Omar', currency: 'EGP' })]);
    render(<Harness />);

    await screen.findByText('Omar');
    expect(screen.queryByText('· approx')).toBeNull();
  });

  it('counts overdue days without showing a negative', async () => {
    arrange([
      debt({
        id: 'debt-1',
        counterparty: 'Omar',
        dueDate: '2026-08-01T00:00:00.000Z',
        daysUntilDue: -6,
        isOverdue: true,
      }),
    ]);
    render(<Harness />);

    expect(await screen.findByText(/6 days overdue/)).toBeInTheDocument();
  });

  it('says so plainly when there is no due date', async () => {
    arrange([debt({ id: 'debt-1', counterparty: 'Omar' })]);
    render(<Harness />);

    expect(await screen.findByText('No due date')).toBeInTheDocument();
  });

  it('describes repayment progress for a screen reader', async () => {
    arrange([
      debt({
        id: 'debt-1',
        counterparty: 'Omar',
        paid: '2000.0000',
        remaining: '3000.0000',
        progressPct: '40.0000',
      }),
    ]);
    render(<Harness />);

    expect(await screen.findByLabelText('40% repaid')).toBeInTheDocument();
    expect(screen.getByText(/2,000\.00/)).toBeInTheDocument();
  });

  it('hides "log a payment" once a debt is settled', async () => {
    arrange([debt({ id: 'debt-1', counterparty: 'Omar', status: 'SETTLED' })]);
    render(<Harness />);

    expect(await screen.findByText('Settled')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Log a payment/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeInTheDocument();
  });
});

describe('payment history', () => {
  const withPayments = debt({
    id: 'debt-1',
    counterparty: 'Omar',
    currency: 'EGP',
    payments: [
      debtPayment({ id: 'pay-1', amount: '500.0000', note: 'first instalment' }),
      // Paid in dollars against a pound debt: both figures are shown.
      debtPayment({
        id: 'pay-2',
        amount: '20.0000',
        currency: 'USD',
        amountInDebtCurrency: '1000.0000',
        transactionId: 'tx-9',
      }),
    ],
  });

  it('keeps the list collapsed until asked for', async () => {
    arrange([withPayments]);
    render(<Harness />);

    const toggle = await screen.findByRole('button', { name: '2 payments' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('first instalment')).toBeNull();
  });

  it('shows a foreign payment in both currencies', async () => {
    const user = userEvent.setup();
    arrange([withPayments]);
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: '2 payments' }));

    // $20 paid against an EGP debt reduces it by the frozen 1000 EGP, not by today's rate.
    expect(screen.getByText(/1,000\.00 EGP/)).toBeInTheDocument();
  });

  it('marks a payment that also moved an account balance', async () => {
    const user = userEvent.setup();
    arrange([withPayments]);
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: '2 payments' }));

    expect(screen.getByText('linked')).toBeInTheDocument();
  });

  it('says "payment" in the singular for one', async () => {
    arrange([
      debt({
        id: 'debt-1',
        counterparty: 'Omar',
        payments: [debtPayment({ id: 'pay-1' })],
      }),
    ]);
    render(<Harness />);

    expect(await screen.findByRole('button', { name: '1 payment' })).toBeInTheDocument();
  });
});

describe('logging a payment', () => {
  const omar = debt({
    id: 'debt-1',
    counterparty: 'Omar',
    currency: 'EGP',
    remaining: '3000.0000',
  });

  it('prefills the whole outstanding balance, because settling in full is the common case', async () => {
    const user = userEvent.setup();
    arrange([omar]);
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: /Log a payment/ }));

    expect(await screen.findByLabelText(/^Amount/)).toHaveValue('3000');
  });

  it('defaults to an account in the debt currency', async () => {
    const user = userEvent.setup();
    arrange([omar]);
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: /Log a payment/ }));
    await screen.findByLabelText(/^Amount/);

    // Cash is the EGP account; the USD one would make this a cross-currency payment.
    expect(screen.getByLabelText('Paid from')).toHaveTextContent('Cash (EGP)');
    expect(
      screen.getByText('A matching expense will be recorded against this account.'),
    ).toBeInTheDocument();
  });

  it('sends the account so the money actually leaves it', async () => {
    const user = userEvent.setup();
    arrange([omar]);
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: /Log a payment/ }));
    await screen.findByLabelText(/^Amount/);
    await user.click(screen.getByRole('button', { name: 'Log payment' }));

    await waitFor(() => expect(paymentBody()).toBeDefined());
    expect(paymentBody()).toEqual({
      amount: '3000',
      date: expect.any(String),
      note: null,
      accountId: CASH.id,
    });
  });

  it('sends a null account when you choose not to record a transaction', async () => {
    const user = userEvent.setup();
    arrange([omar]);
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: /Log a payment/ }));
    await screen.findByLabelText(/^Amount/);

    await user.click(screen.getByLabelText('Paid from'));
    await user.click(await screen.findByRole('option', { name: /Don't record a transaction/ }));
    // Let the Select settle before submitting; asserting the new value is what waits.
    await waitFor(() =>
      expect(screen.getByLabelText('Paid from')).toHaveTextContent("Don't record a transaction"),
    );

    await user.click(screen.getByRole('button', { name: 'Log payment' }));

    await waitFor(() => expect(paymentBody()).toBeDefined());
    expect(paymentBody()).toMatchObject({ accountId: null });
  });

  it('explains that no account balance moves in that case', async () => {
    const user = userEvent.setup();
    arrange([omar]);
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: /Log a payment/ }));
    await screen.findByLabelText(/^Amount/);

    await user.click(screen.getByLabelText('Paid from'));
    await user.click(await screen.findByRole('option', { name: /Don't record a transaction/ }));

    expect(
      screen.getByText('The debt balance updates, but no account balance changes.'),
    ).toBeInTheDocument();
  });

  it('calls it income when the money is coming back to you', async () => {
    const user = userEvent.setup();
    arrange([{ ...omar, direction: 'OWED_TO_ME' }]);
    render(<Harness />);

    await user.click(screen.getByRole('tab', { name: /Owed to me/ }));
    await user.click(await screen.findByRole('button', { name: /Log a payment/ }));
    await screen.findByLabelText(/^Amount/);

    expect(
      screen.getByText('A matching income will be recorded against this account.'),
    ).toBeInTheDocument();
  });

  it('puts a rejection on the field it names and stays open', async () => {
    const user = userEvent.setup();
    arrange([omar]);
    api.setRoute('POST /debts/debt-1/payments', {
      status: 422,
      body: {
        error: {
          code: 'UNPROCESSABLE',
          message: 'That is more than the remaining balance.',
          details: { field: 'amount' },
        },
      },
    });
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: /Log a payment/ }));
    await screen.findByLabelText(/^Amount/);
    await user.click(screen.getByRole('button', { name: 'Log payment' }));

    expect(await screen.findByText('That is more than the remaining balance.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log payment' })).toBeInTheDocument();
  });
});

describe('settling and deleting', () => {
  it('marks a debt settled without asking, since it is reversible', async () => {
    const user = userEvent.setup();
    arrange([debt({ id: 'debt-1', counterparty: 'Omar' })]);
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Mark settled' }));

    await waitFor(() => expect(api.requestsFor('PATCH /debts/debt-1')).toHaveLength(1));
    expect(api.requestsFor('PATCH /debts/debt-1')[0]?.body).toEqual({ status: 'SETTLED' });
  });

  it('asks before deleting, because the payments go with it', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    arrange([debt({ id: 'debt-1', counterparty: 'Omar' })]);
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Delete debt with Omar' }));

    expect(confirm).toHaveBeenCalledWith('Delete the debt with Omar and its payments?');
    expect(api.requestsFor('DELETE /debts/debt-1')).toHaveLength(0);
  });

  it('deletes once confirmed', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    arrange([debt({ id: 'debt-1', counterparty: 'Omar' })]);
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Delete debt with Omar' }));

    await waitFor(() => expect(api.requestsFor('DELETE /debts/debt-1')).toHaveLength(1));
  });

  it('names the debt when a delete fails, rather than failing silently', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    arrange([debt({ id: 'debt-1', counterparty: 'Omar' })]);
    api.setRoute('DELETE /debts/debt-1', {
      status: 500,
      body: { error: { code: 'X', message: 'Database unavailable.' } },
    });
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Delete debt with Omar' }));

    await waitFor(() => expect(getFailures()).toHaveLength(1));
    expect(getFailures()[0]).toMatchObject({
      headline: 'The debt with Omar could not be deleted.',
      detail: 'Database unavailable.',
    });
  });
});
