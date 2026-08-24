/**
 * Prisma Client Singleton
 *
 * Provides a singleton instance of the Prisma client for database access.
 * Ensures efficient connection pooling and prevents multiple instances.
 */
import { PrismaClient } from '@prisma/client';

let prisma: PrismaClient | undefined;

/**
 * Get the singleton Prisma client instance.
 * Creates a new instance if one doesn't exist.
 *
 * @returns The Prisma client instance
 */
export function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

/**
 * Close the Prisma client connection.
 * Call this when shutting down the application.
 */
export async function closePrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = undefined;
  }
}

/**
 * Check if the Prisma client is connected to the database.
 * Useful for health checks.
 */
export async function isConnected(): Promise<boolean> {
  try {
    const client = getPrisma();
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/**
 * Re-export Prisma types for convenience
 */
export type { PrismaClient } from '@prisma/client';
