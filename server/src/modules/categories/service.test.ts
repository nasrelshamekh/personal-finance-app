import { describe, expect, it } from 'vitest';
import { clearCategories, withRollback } from '../../test/db';
import { makeAccount, makeCategory, makeStandardRates } from '../../test/factories';
import { createTransaction } from '../transactions/service';
import { createCategory, deleteCategory, listCategories, updateCategory } from './service';

describe('one level of nesting (SPEC §5)', () => {
  it('allows a child under a root category', async () => {
    await withRollback(async (tx) => {
      await clearCategories(tx);
      const parent = await makeCategory(tx, { kind: 'EXPENSE', name: 'Food' });

      const child = await createCategory(tx, {
        name: 'Groceries',
        kind: 'EXPENSE',
        color: '#8f7a3f',
        icon: 'basket',
        parentId: parent.id,
      });

      expect(child.parentId).toBe(parent.id);
    });
  });

  it('refuses a grandchild', async () => {
    await withRollback(async (tx) => {
      await clearCategories(tx);
      const parent = await makeCategory(tx, { kind: 'EXPENSE', name: 'Food' });
      const child = await makeCategory(tx, {
        kind: 'EXPENSE',
        name: 'Groceries',
        parentId: parent.id,
      });

      await expect(
        createCategory(tx, {
          name: 'Fruit',
          kind: 'EXPENSE',
          color: '#8f7a3f',
          icon: 'apple',
          parentId: child.id,
        }),
      ).rejects.toMatchObject({ status: 422 });
    });
  });

  it('refuses a category becoming its own parent', async () => {
    await withRollback(async (tx) => {
      await clearCategories(tx);
      const category = await makeCategory(tx, { kind: 'EXPENSE' });

      await expect(
        updateCategory(tx, category.id, { parentId: category.id }),
      ).rejects.toMatchObject({ status: 422 });
    });
  });

  it('refuses moving a category that has children of its own', async () => {
    await withRollback(async (tx) => {
      await clearCategories(tx);
      const root = await makeCategory(tx, { kind: 'EXPENSE', name: 'Food' });
      const other = await makeCategory(tx, { kind: 'EXPENSE', name: 'Home' });
      await makeCategory(tx, { kind: 'EXPENSE', name: 'Groceries', parentId: root.id });

      await expect(updateCategory(tx, root.id, { parentId: other.id })).rejects.toMatchObject({
        status: 422,
      });
    });
  });

  it('refuses mixing income and expense in one tree', async () => {
    await withRollback(async (tx) => {
      await clearCategories(tx);
      const income = await makeCategory(tx, { kind: 'INCOME', name: 'Salary' });

      await expect(
        createCategory(tx, {
          name: 'Rent',
          kind: 'EXPENSE',
          color: '#b4553f',
          icon: 'house',
          parentId: income.id,
        }),
      ).rejects.toMatchObject({ status: 422 });
    });
  });
});

describe('tree shape on GET', () => {
  it('returns roots with their children nested', async () => {
    await withRollback(async (tx) => {
      await clearCategories(tx);
      const food = await makeCategory(tx, { kind: 'EXPENSE', name: 'Food' });
      await makeCategory(tx, { kind: 'EXPENSE', name: 'Groceries', parentId: food.id });
      await makeCategory(tx, { kind: 'EXPENSE', name: 'Eating out', parentId: food.id });
      await makeCategory(tx, { kind: 'INCOME', name: 'Salary' });

      const tree = await listCategories(tx, { includeArchived: false });

      expect(tree).toHaveLength(2);
      const foodNode = tree.find((node) => node.name === 'Food');
      expect(foodNode?.children.map((child) => child.name).sort()).toEqual([
        'Eating out',
        'Groceries',
      ]);
    });
  });

  it('filters by kind', async () => {
    await withRollback(async (tx) => {
      await clearCategories(tx);
      await makeCategory(tx, { kind: 'EXPENSE', name: 'Rent' });
      await makeCategory(tx, { kind: 'INCOME', name: 'Salary' });

      const income = await listCategories(tx, { kind: 'INCOME', includeArchived: false });
      expect(income.map((node) => node.name)).toEqual(['Salary']);
    });
  });
});

describe('deleting', () => {
  it('archives a category that transactions still refer to', async () => {
    await withRollback(async (tx) => {
      await makeStandardRates(tx);
      await clearCategories(tx);
      const account = await makeAccount(tx, { currency: 'EGP' });
      const category = await makeCategory(tx, { kind: 'EXPENSE' });

      await createTransaction(tx, {
        type: 'EXPENSE',
        amount: '100',
        accountId: account.id,
        categoryId: category.id,
        date: new Date('2026-08-03T09:00:00.000Z'),
        note: null,
      });

      const result = await deleteCategory(tx, category.id);

      expect(result.outcome).toBe('archived');
      expect(await tx.category.count({ where: { id: category.id } })).toBe(1);
    });
  });

  it('archives a category that still has children', async () => {
    await withRollback(async (tx) => {
      await clearCategories(tx);
      const parent = await makeCategory(tx, { kind: 'EXPENSE', name: 'Food' });
      await makeCategory(tx, { kind: 'EXPENSE', name: 'Groceries', parentId: parent.id });

      expect((await deleteCategory(tx, parent.id)).outcome).toBe('archived');
    });
  });

  it('deletes an unused category outright', async () => {
    await withRollback(async (tx) => {
      await clearCategories(tx);
      const category = await makeCategory(tx, { kind: 'EXPENSE' });

      expect((await deleteCategory(tx, category.id)).outcome).toBe('deleted');
      expect(await tx.category.count({ where: { id: category.id } })).toBe(0);
    });
  });
});
