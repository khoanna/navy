/**
 * Database Module Index
 *
 * Central export point for all database-related functionality.
 */
export { getPrisma, closePrisma, isConnected } from './client.js';
export type { PrismaClient } from './client.js';
export * from './repositories/index.js';
