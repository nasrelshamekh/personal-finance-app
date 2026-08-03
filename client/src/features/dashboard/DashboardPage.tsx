import { LayoutDashboard } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';

/**
 * The empty state is the real one — there genuinely are no transactions yet, and this is
 * what you would see on a fresh install. The loaded view with charts arrives in Phase 5.
 */
export function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Net worth, this month's movement, and where the money went."
      />
      <EmptyState
        icon={LayoutDashboard}
        title="Nothing to summarise yet"
        description="Add an account and your first transaction, and this fills with your net worth, the month's income and spending, and what converting cost you."
      />
    </>
  );
}
