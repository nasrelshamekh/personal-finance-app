import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { RouteError } from '@/components/shared/RouteError';
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
 */
export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'transactions', element: <TransactionsPage /> },
      { path: 'accounts', element: <AccountsPage /> },
      { path: 'debts', element: <DebtsPage /> },
      { path: 'savings', element: <SavingsPage /> },
      { path: 'budgets', element: <BudgetsPage /> },
      { path: 'currency', element: <CurrencyPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <RouteError /> },
    ],
  },
]);
