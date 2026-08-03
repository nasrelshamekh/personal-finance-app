import { Receipt } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';

export function TransactionsPage() {
  return (
    <>
      <PageHeader title="Transactions" description="Everything that moved, newest first." />
      <EmptyState
        icon={Receipt}
        title="No transactions yet"
        description="Record what you earn and spend here. Amounts accept arithmetic, so you can type 1200*3+450 straight into the field."
      />
    </>
  );
}
