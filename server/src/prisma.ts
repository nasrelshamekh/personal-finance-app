import { PrismaClient } from '@prisma/client';
import { env, isProduction } from './env';

/**
 * Singleton Prisma client.
 *
 * `tsx watch` re-imports modules on change, so the instance is stashed on globalThis to
 * avoid leaking a connection pool per reload during development.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProduction ? ['warn', 'error'] : ['warn', 'error'],
    datasources: { db: { url: env.DATABASE_URL } },
  });

if (!isProduction) {
  globalForPrisma.prisma = prisma;
}
