import { useState, type FormEvent } from 'react';
import { Archive, ArchiveRestore, Check, Pencil, Plus, X } from 'lucide-react';
import type { CategoryDto, CategoryKind } from '@ledger/shared';
import { cn } from '@/lib/cn';
import { ApiError } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useCategoryTree,
  useCreateCategory,
  useDeleteCategory,
  useUpdateCategory,
} from './queries';

const SWATCHES = ['#2f8f5b', '#b4553f', '#4a6f9f', '#8f7a3f', '#7f5f8f', '#6f6f6f'];

/**
 * Category management (SPEC §9).
 *
 * Deleting is offered, but the server decides what it means: a category nothing
 * references is removed, one with history is archived instead. The button therefore says
 * "archive" — promising a deletion the server will refuse is worse than naming the
 * outcome up front.
 */
export function CategoryManager() {
  const [showArchived, setShowArchived] = useState(false);
  const { data: tree, isPending } = useCategoryTree(showArchived);

  const create = useCreateCategory();
  const update = useUpdateCategory();
  const remove = useDeleteCategory();

  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<CategoryKind>('EXPENSE');
  const [newParentId, setNewParentId] = useState('');
  const [newColor, setNewColor] = useState(SWATCHES[0] ?? '#2f8f5b');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const roots = tree ?? [];
  // Only a root can be a parent — one level of nesting (SPEC §5).
  const parentOptions = roots.filter((node) => node.kind === newKind && !node.isArchived);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const parent = roots.find((node) => node.id === newParentId);

    try {
      await create.mutateAsync({
        name: newName.trim(),
        /*
         * A child must share its parent's kind. `parentOptions` already filters to the
         * selected kind, so these two are always equal in practice — reading the parent's
         * is belt-and-braces against that filter changing, not a live branch, and no test
         * can reach the fallback while the filter stands.
         */
        kind: parent?.kind ?? newKind,
        color: newColor,
        icon: 'tag',
        parentId: newParentId === '' ? null : newParentId,
      });
      setNewName('');
      setNewParentId('');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That could not be saved.');
    }
  }

  async function saveRename(id: string) {
    const name = editingName.trim();
    if (name === '') return;

    setError(null);
    try {
      await update.mutateAsync({ id, body: { name } });
      setEditingId(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That could not be renamed.');
    }
  }

  async function toggleArchived(category: CategoryDto) {
    setError(null);
    try {
      if (category.isArchived) {
        await update.mutateAsync({ id: category.id, body: { isArchived: false } });
      } else {
        // Removes it outright when nothing references it, archives it when something does.
        await remove.mutateAsync(category.id);
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That could not be changed.');
    }
  }

  function renderRow(category: CategoryDto, depth: number) {
    const isEditing = editingId === category.id;

    return (
      <li key={category.id}>
        <div
          className={cn(
            'flex items-center gap-2 rounded-md px-2 py-1.5',
            depth === 1 && 'ml-5',
            category.isArchived && 'opacity-55',
          )}
        >
          <span
            className="size-2.5 shrink-0 rounded-sm"
            style={{ background: category.color }}
            aria-hidden
          />

          {isEditing ? (
            <>
              <Input
                value={editingName}
                onChange={(event) => setEditingName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void saveRename(category.id);
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    setEditingId(null);
                  }
                }}
                aria-label={`Rename ${category.name}`}
                autoFocus
                className="h-7 flex-1 text-sm"
              />
              <button
                type="button"
                onClick={() => void saveRename(category.id)}
                aria-label="Save the new name"
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Check className="size-3.5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => setEditingId(null)}
                aria-label="Stop renaming"
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </>
          ) : (
            <>
              <span className="flex-1 truncate text-sm text-foreground">{category.name}</span>

              <span className="shrink-0 font-numeric text-[10px] text-muted-foreground">
                {category.transactionCount > 0 && `${category.transactionCount} used`}
                {category.isArchived && category.transactionCount === 0 && 'archived'}
              </span>

              <button
                type="button"
                onClick={() => {
                  setEditingId(category.id);
                  setEditingName(category.name);
                }}
                aria-label={`Rename ${category.name}`}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Pencil className="size-3.5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => void toggleArchived(category)}
                aria-label={
                  category.isArchived ? `Restore ${category.name}` : `Archive ${category.name}`
                }
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {category.isArchived ? (
                  <ArchiveRestore className="size-3.5" aria-hidden />
                ) : (
                  <Archive className="size-3.5" aria-hidden />
                )}
              </button>
            </>
          )}
        </div>

        {category.children.length > 0 && (
          <ul>{category.children.map((child) => renderRow(child, 1))}</ul>
        )}
      </li>
    );
  }

  const income = roots.filter((node) => node.kind === 'INCOME');
  const expense = roots.filter((node) => node.kind === 'EXPENSE');

  return (
    <div className="rounded-lg border border-border p-4">
      <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-2">
        <div className="min-w-40 flex-1 space-y-1.5">
          <Label htmlFor="new-category">Add a category</Label>
          <Input
            id="new-category"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="What you want to track"
            maxLength={60}
            className="h-9"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="new-category-kind">Kind</Label>
          <select
            id="new-category-kind"
            value={newKind}
            onChange={(event) => {
              setNewKind(event.target.value as CategoryKind);
              setNewParentId('');
            }}
            disabled={newParentId !== ''}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <option value="EXPENSE">Expense</option>
            <option value="INCOME">Income</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="new-category-parent">Under</Label>
          <select
            id="new-category-parent"
            value={newParentId}
            onChange={(event) => setNewParentId(event.target.value)}
            className="h-9 max-w-40 rounded-md border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Nothing — a top-level category</option>
            {parentOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5 pb-1">
          {SWATCHES.map((swatch) => (
            <button
              key={swatch}
              type="button"
              onClick={() => setNewColor(swatch)}
              aria-label={`Use colour ${swatch}`}
              aria-pressed={newColor === swatch}
              className={cn(
                'size-6 rounded ring-offset-2 ring-offset-background transition-shadow',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                newColor === swatch && 'ring-2 ring-foreground/50',
              )}
              style={{ background: swatch }}
            />
          ))}
        </div>

        <button
          type="submit"
          disabled={newName.trim() === '' || create.isPending}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Plus className="size-4" aria-hidden />
          Add
        </button>
      </form>

      {error !== null && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-money-negative/40 bg-money-negative/5 px-3 py-2 text-sm text-money-negative"
        >
          {error}
        </p>
      )}

      <div className="mt-5 grid gap-6 sm:grid-cols-2">
        {isPending ? (
          <>
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </>
        ) : (
          <>
            <section aria-labelledby="expense-categories">
              <h4
                id="expense-categories"
                className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
              >
                Expense
              </h4>
              {expense.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  None yet. Rent, groceries, transport — whatever you want to see totals for.
                </p>
              ) : (
                <ul>{expense.map((node) => renderRow(node, 0))}</ul>
              )}
            </section>

            <section aria-labelledby="income-categories">
              <h4
                id="income-categories"
                className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
              >
                Income
              </h4>
              {income.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  None yet. Salary and anything else that arrives.
                </p>
              ) : (
                <ul>{income.map((node) => renderRow(node, 0))}</ul>
              )}
            </section>
          </>
        )}
      </div>

      <label
        htmlFor="show-archived-categories"
        className="mt-4 inline-flex items-center gap-2 text-xs text-muted-foreground"
      >
        <input
          id="show-archived-categories"
          type="checkbox"
          checked={showArchived}
          onChange={(event) => setShowArchived(event.target.checked)}
          className="size-3.5 accent-[var(--primary)]"
        />
        Show archived categories
      </label>
    </div>
  );
}
