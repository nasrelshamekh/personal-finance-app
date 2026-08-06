import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { PageError, RouteError } from '@/components/shared/RouteError';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { TransactionsPage } from '@/features/transactions/TransactionsPage';
import { AccountsPage } from '@/features/accounts/AccountsPage';
import { DebtsPage } from '@/features/debts/DebtsPage';
import { SavingsPage } from '@/features/savings/SavingsPage';
import { BudgetsPage } from '@/features/budgets/BudgetsPage';
import { CurrencyPage } from '@/features/currency/CurrencyPage';
import { SettingsPage } from '@/features/settings/SettingsPage';

/**
 * Every screen sits inside AppShell, so the sidebar, topbar and FX strip persist across
 * navigation rather than remounting. The paths match `NAV_ITEMS` in
 * `components/layout/navigation.ts` — that file is the single source of truth for what
 * the nav shows, and these are the destinations it points at.
 *
 * **Each child carries its own `errorElement`.** React Router walks up to the nearest one,
 * so a single boundary on the layout route would let one broken screen take the shell
 * down with it and leave you with no navigation — on the screen you most need to leave.
 */
const withBoundary = (path: string, element: React.ReactNode) => ({
  path,
  element,
  errorElement: <PageError />,
});

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    // Reached only when the shell itself fails, which no child error can cause.
    errorElement: <RouteError />,
    children: [
      { index: true, element: <DashboardPage />, errorElement: <PageError /> },
      withBoundary('transactions', <TransactionsPage />),
      withBoundary('accounts', <AccountsPage />),
      withBoundary('debts', <DebtsPage />),
      withBoundary('savings', <SavingsPage />),
      withBoundary('budgets', <BudgetsPage />),
      withBoundary('currency', <CurrencyPage />),
      withBoundary('settings', <SettingsPage />),
      { path: '*', element: <PageError /> },
    ],
  },
]);
