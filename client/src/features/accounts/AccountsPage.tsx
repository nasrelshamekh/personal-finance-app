import { Wallet } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';

export function AccountsPage() {
  return (
    <>
      <PageHeader
        title="Accounts"
        description="Each account holds one currency. Moving between currencies is a transfer."
      />
      <EmptyState
        icon={Wallet}
        title="No accounts yet"
        description="Add one per place you keep money — cash, a bank account, a wallet. Spending in dollars means a separate dollar account, which is what keeps every balance exact."
      />
    </>
  );
}
