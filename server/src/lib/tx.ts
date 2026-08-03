import type { Prisma, PrismaClient } from '@prisma/client';
import type { Db } from './fx/types';

/**
 * Runs `body` atomically.
 *
 * When handed the client, it opens a transaction. When handed a transaction client it
 * runs inline, because Postgres has no nested transactions and the work is already
 * atomic. That is what lets a service be called both from a router and from inside a
 * test's rolled-back transaction without changing its guarantees.
 */
export async function inTransaction<T>(
  db: Db,
  body: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if ('$transaction' in db && typeof db.$transaction === 'function') {
    return (db as PrismaClient).$transaction((tx) => body(tx));
  }
  return body(db as Prisma.TransactionClient);
}
