import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, ArchiveRestore, Pencil, Plus, Wallet } from 'lucide-react';
import { formatAmount, type AccountDto } from '@ledger/shared';
import { cn } from '@/lib/cn';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { Money } from '@/components/shared/Money';
import { Skeleton } from '@/components/ui/skeleton';
import { AccountSheet } from './AccountSheet';
import { useAccounts, useDeleteAccount, useUpdateAccount } from './queries';

/**
 * Balances per account, native currency first.
 *
 * Archiving rather than deleting is the only option offered for an account with history:
 * removing it would either orphan those rows or take them with it, and both rewrite past
 * figures (SPEC §5).
 */
export function AccountsPage() {
  const [showArchived, setShowArchived] = useState(false);
  const { data: accounts, isPending } = useAccounts(showArchived);
  const update = useUpdateAccount();
  const remove = useDeleteAccount();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<AccountDto | undefined>(undefined);

  function openNew() {
    setEditing(undefined);
    setSheetOpen(true);
  }

  function openEdit(account: AccountDto) {
    setEditing(account);
    setSheetOpen(true);
  }

  return (
    <>
      <PageHeader
        title="Accounts"
        description="Each account holds one currency. Moving between currencies is a transfer."
        actions={
          <button
            type="button"
            onClick={openNew}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Plus className="size-4" aria-hidden />
            New account
          </button>
        }
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
          action={
            <button
              type="button"
              onClick={openNew}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Plus className="size-4" aria-hidden />
              Add your first account
            </button>
          }
        />
      )}

      {accounts !== undefined && accounts.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((account) => (
            <article
              key={account.id}
              className={cn(
                'rounded-lg border border-border bg-card/40 p-4',
                account.isArchived && 'opacity-60',
              )}
            >
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
                  {account.isArchived ? 'archived' : account.type.replace('_', ' ').toLowerCase()}
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

              <div className="mt-3 flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  <Link
                    to={`/transactions?accountId=${account.id}`}
                    className="underline underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {account.transactionCount}{' '}
                    {account.transactionCount === 1 ? 'transaction' : 'transactions'}
                  </Link>
                </p>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openEdit(account)}
                    aria-label={`Edit ${account.name}`}
                    className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Pencil className="size-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      // The server decides what "archive" means: an account with history is
                      // archived, an empty one is removed. Deleting a used account would
                      // either orphan its rows or take them with it (SPEC §5).
                      if (account.isArchived) {
                        update.mutate({ id: account.id, body: { isArchived: false } });
                      } else {
                        remove.mutate(account.id);
                      }
                    }}
                    aria-label={
                      account.isArchived ? `Restore ${account.name}` : `Archive ${account.name}`
                    }
                    className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {account.isArchived ? (
                      <ArchiveRestore className="size-3.5" aria-hidden />
                    ) : (
                      <Archive className="size-3.5" aria-hidden />
                    )}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {accounts !== undefined && (
        <label
          htmlFor="show-archived-accounts"
          className="mt-4 inline-flex items-center gap-2 text-xs text-muted-foreground"
        >
          <input
            id="show-archived-accounts"
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
            className="size-3.5 accent-[var(--primary)]"
          />
          Show archived accounts
        </label>
      )}

      <AccountSheet open={sheetOpen} onOpenChange={setSheetOpen} editing={editing} />
    </>
  );
}
