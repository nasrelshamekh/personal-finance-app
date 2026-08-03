import { CreditCard } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';

export function DebtsPage() {
  return (
    <>
      <PageHeader title="Debts" description="What you owe, and what is owed to you." />
      <EmptyState
        icon={CreditCard}
        title="No debts tracked"
        description="Record money lent or borrowed and log payments against it. Balances stay in the debt's own currency, so nothing drifts with the exchange rate."
      />
    </>
  );
}
