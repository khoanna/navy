import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { registerRoutes } from './routes.js';

export interface ServerConfig {
  host: string;
  port: number;
}

export async function buildServer(_config: ServerConfig): Promise<FastifyInstance> {
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

  // Register API routes
  await registerRoutes(server);

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
