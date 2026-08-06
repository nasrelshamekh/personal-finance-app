import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma';

/**
 * Runs a test body inside a transaction that is always rolled back.
 *
 * Rate resolution is mostly *ordering* — D1's "newest wins, manual breaks ties" is a SQL
 * ORDER BY, and a fake repository would test a reimplementation of it rather than the
 * thing that actually runs. So these tests hit real Postgres, and roll back so the
 * developer's own data is never touched.
 */
const ROLLBACK = Symbol('rollback');

export async function withRollback(
  body: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<void> {
  try {
    await prisma.$transaction(
      async (tx) => {
        await body(tx);
        throw ROLLBACK;
      },
      { timeout: 20_000 },
    );
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
}

/** Clears rates inside the transaction so each test starts from a known board. */
export async function clearRates(tx: Prisma.TransactionClient): Promise<void> {
  await tx.exchangeRate.deleteMany({});
}

/**
 * Clears categories, and first everything that would hold them down.
 *
 * `Transaction.categoryId` is `onDelete: Restrict`, so any real categorised row in the
 * developer's own database blocks the wipe — which is why this clears transactions too
 * rather than leaving each caller to remember. Budgets cascade, so they need no statement
 * of their own. It is all inside the caller's rolled-back transaction; nothing survives.
 *
 * `Category.parentId` is `Restrict` as well and Postgres checks it immediately, so a
 * single `deleteMany({})` can trip the constraint when a parent happens to be removed
 * before its child. Children first, and the order is no longer luck.
 */
export async function clearCategories(tx: Prisma.TransactionClient): Promise<void> {
  await tx.transaction.deleteMany({});
  await tx.category.deleteMany({ where: { parentId: { not: null } } });
  await tx.category.deleteMany({});
}
