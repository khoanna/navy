import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { PrismaClient } from '@prisma/client';
import { registerRoutes } from './routes.js';
import { registerOperatorRoutes } from './operator-routes.js';
import type { Scheduler } from '../runtime/scheduler.js';

export interface ServerConfig {
  host: string;
  port: number;
}

export interface OperatorServerConfig {
  port: number;
}

/** One row of a Fastify instance's registered route table. */
export interface RouteRecord {
  method: string;
  url: string;
}

/**
 * The only HTTP methods the PUBLIC read listener may expose.
 *
 * GET is the surface itself; HEAD is registered automatically by Fastify
 * alongside every GET; OPTIONS is the CORS preflight route added by
 * `@fastify/cors`. Anything else is a mutation and belongs on the operator
 * listener.
 */
export const PUBLIC_ALLOWED_METHODS: readonly string[] = ['GET', 'HEAD', 'OPTIONS'];

/**
 * Fastify log level, read at build time rather than module-load time:
 * `LOG_LEVEL=silent` keeps the in-process `server.inject()` tests from
 * drowning the run in request logs, and ESM hoists imports above a spec's
 * `process.env` assignment, so a module-level constant would be read too
 * early. Production leaves the var unset.
 */
function logLevel(): string {
  return process.env.LOG_LEVEL ?? 'info';
}

/** The operator listener is bound here and nowhere else. Not configurable. */
export const OPERATOR_HTTP_HOST = '127.0.0.1';

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Every route registered on this instance, one row per method. Populated by
     * an `onRoute` hook installed before any route, so it is complete for
     * anything registered through the instance — including routes added by
     * plugins.
     */
    srclaRouteTable: RouteRecord[];
  }
}

function installRouteTable(server: FastifyInstance, guard?: (route: RouteRecord) => void): void {
  const table: RouteRecord[] = [];
  server.decorate('srclaRouteTable', table);
  server.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      const record: RouteRecord = { method, url: route.url };
      table.push(record);
      guard?.(record);
    }
  });
}

/**
 * The PUBLIC read API (paper §10.2: *"It has no mutation or transaction
 * endpoint."*).
 *
 * The §10.2 invariant is enforced here rather than merely documented: the
 * `onRoute` guard throws while the route is being registered, so adding a
 * `POST`/`PUT`/`PATCH`/`DELETE` to this listener makes the service fail to
 * boot instead of silently reopening a mutation surface. Mutations go to
 * `buildOperatorServer`.
 */
export async function buildServer(
  _config: ServerConfig,
  prisma?: PrismaClient
): Promise<FastifyInstance> {
  const server = Fastify({
    logger: { level: logLevel() },
  });

  installRouteTable(server, (route) => {
    if (!PUBLIC_ALLOWED_METHODS.includes(route.method)) {
      throw new Error(
        `SRCLA public read API (paper §10.2) has no mutation or transaction endpoint: ` +
          `refusing to register ${route.method} ${route.url}. ` +
          `Register it on the operator listener (src/http/operator-routes.ts) instead.`
      );
    }
  });

  // CORS. Read methods only — the public listener answers nothing else.
  await server.register(cors, {
    origin: true,
    methods: ['GET', 'HEAD', 'OPTIONS'],
  });

  await registerRoutes(server, prisma);

  // Health check at root
  server.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  return server;
}

/**
 * The OPERATOR listener: the three mutation routes, on their own Fastify
 * instance. `startOperatorServer` binds it to {@link OPERATOR_HTTP_HOST} only.
 * No CORS is registered — nothing browser-originated should reach it.
 */
export async function buildOperatorServer(
  _config: OperatorServerConfig,
  scheduler?: Scheduler,
  prisma?: PrismaClient
): Promise<FastifyInstance> {
  const server = Fastify({
    logger: { level: logLevel() },
  });

  installRouteTable(server);

  await registerOperatorRoutes(server, scheduler, prisma);

  server.get('/health', async () => {
    return { status: 'ok', role: 'operator', timestamp: new Date().toISOString() };
  });

  return server;
}

export async function startServer(server: FastifyInstance, config: ServerConfig): Promise<void> {
  try {
    await server.listen({ host: config.host, port: config.port });
    console.log(`SRCLA read API listening on ${config.host}:${config.port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

export async function startOperatorServer(
  server: FastifyInstance,
  config: OperatorServerConfig
): Promise<void> {
  try {
    // Host is the OPERATOR_HTTP_HOST constant, never a config value: there is
    // no env var an operator could set that would expose the mutation routes
    // off-box.
    await server.listen({ host: OPERATOR_HTTP_HOST, port: config.port });
    console.log(`SRCLA operator API listening on ${OPERATOR_HTTP_HOST}:${config.port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}
