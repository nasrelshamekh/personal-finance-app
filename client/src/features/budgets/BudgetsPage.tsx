import { Coins } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';

export function BudgetsPage() {
  return (
    <>
      <PageHeader
        title="Budgets"
        description="Monthly limits per category, and how much of each is left."
      />
      <EmptyState
        icon={Coins}
        title="No budgets set"
        description="Give a category a monthly limit and this tracks what you have spent against it. Budgets are in Egyptian pounds, because that is what you spend."
      />
    </>
  );
}
