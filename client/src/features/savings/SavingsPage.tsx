import { PiggyBank } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';

export function SavingsPage() {
  return (
    <>
      <PageHeader
        title="Savings"
        description="Goals, what you have put aside, and what is left to go."
      />
      <EmptyState
        icon={PiggyBank}
        title="No goals yet"
        description="Set a target and a deadline, and this works out what you need to put aside each month to reach it."
      />
    </>
  );
}
