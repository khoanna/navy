import { PrismaClient } from '@prisma/client';

let shared: PrismaClient | null = null;

/**
 * Lazily constructed process-wide Prisma client for the HTTP layer.
 *
 * Lazy on purpose: `registerRoutes`/`registerOperatorRoutes` take the client as
 * a parameter so tests can inject a stub, and importing the route modules must
 * not itself construct a real client (nor read `DATABASE_URL`) when no route
 * will ever touch a database.
 */
export function getSharedPrisma(): PrismaClient {
  return (shared ??= new PrismaClient());
}
