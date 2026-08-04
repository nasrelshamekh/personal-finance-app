import { Link } from 'react-router-dom';
import { Wallet } from 'lucide-react';
import { formatAmount } from '@ledger/shared';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { Money } from '@/components/shared/Money';
import { Skeleton } from '@/components/ui/skeleton';
import { useAccounts } from './queries';

/**
 * Balances per account, native currency first.
 *
 * The per-account sparkline and drill-down from SPEC §9 are not built yet; what is here is
 * real, because these accounts exist and showing an empty state over them would be a lie.
 */
export function AccountsPage() {
  const { data: accounts, isPending } = useAccounts();

  return (
    <>
      <PageHeader
        title="Accounts"
        description="Each account holds one currency. Moving between currencies is a transfer."
      />

      {isPending && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-32" />
          ))}
        </div>
      )}

      {accounts !== undefined && accounts.length === 0 && (
        <EmptyState
          icon={Wallet}
          title="No accounts yet"
          description="Add one per place you keep money — cash, a bank account, a wallet. Spending in dollars means a separate dollar account, which is what keeps every balance exact."
        />
      )}

      {accounts !== undefined && accounts.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((account) => (
            <article key={account.id} className="rounded-lg border border-border bg-card/40 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="size-2.5 shrink-0 rounded-sm"
                    style={{ background: account.color }}
                    aria-hidden
                  />
                  <h3 className="truncate text-sm font-medium text-foreground">{account.name}</h3>
                </div>
                <span className="shrink-0 rounded border border-border px-1.5 py-0.5 font-numeric text-[10px] text-muted-foreground">
                  {account.type.replace('_', ' ').toLowerCase()}
                </span>
              </div>

              <div className="mt-3">
                <Money value={account.balance} currency={account.currency} size="lg" tone="plain" />
                {account.currency !== 'EGP' && (
                  <p className="mt-0.5 font-numeric text-xs tabular-nums text-muted-foreground">
                    {formatAmount(account.balanceEgp)} EGP
                  </p>
                )}
              </div>

              <p className="mt-3 text-xs text-muted-foreground">
                <Link
                  to={`/transactions?accountId=${account.id}`}
                  className="underline underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {account.transactionCount}{' '}
                  {account.transactionCount === 1 ? 'transaction' : 'transactions'}
                </Link>
              </p>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
