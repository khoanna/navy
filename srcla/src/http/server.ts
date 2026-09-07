import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { registerRoutes } from './routes.js';
import type { Scheduler } from '../runtime/scheduler.js';

export interface ServerConfig {
  host: string;
  port: number;
}

export async function buildServer(
  _config: ServerConfig,
  scheduler?: Scheduler
): Promise<FastifyInstance> {
  const server = Fastify({
    logger: {
      level: 'info',
    },
  });

  // CORS
  await server.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  });

  // Register API routes with optional scheduler for trigger endpoint
  await registerRoutes(server, scheduler);

  // Health check at root
  server.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  return server;
}

export async function startServer(server: FastifyInstance, config: ServerConfig): Promise<void> {
  try {
    await server.listen({ host: config.host, port: config.port });
    console.log(`SRCLA API listening on ${config.host}:${config.port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}
