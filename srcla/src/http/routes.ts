import { FastifyInstance } from 'fastify';
import { PrismaClient, PlanAction } from '@prisma/client';
import { serializeMarket, serializeDecision, serializePlan, serializeHarvest } from './serializers.js';

const prisma = new PrismaClient();

// Type for ExecutionPlan with included actions
type ExecutionPlanWithActions = {
  id: string;
  planId: string;
  decisionHash: string;
  status: string;
  createdAt: Date;
  expiresAt: Date;
  actions: PlanAction[];
};

export async function registerRoutes(server: FastifyInstance): Promise<void> {
  // GET /v1/health - Service health
  server.get('/v1/health', async () => {
    const lastSnapshot = await prisma.marketSnapshot.findFirst({
      orderBy: { timestamp: 'desc' },
    });

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      lastSnapshot: lastSnapshot?.timestamp.toISOString() ?? null,
    };
  });

  // GET /v1/markets - All markets
  server.get('/v1/markets', async () => {
    const markets = await prisma.marketSnapshot.findMany({
      distinct: ['marketId'],
      orderBy: { timestamp: 'desc' },
    });

    return { data: markets.map(serializeMarket), meta: { count: markets.length } };
  });

  // GET /v1/markets/:marketId - Single market
  server.get('/v1/markets/:marketId', async (request, reply) => {
    const { marketId } = request.params as { marketId: string };

    const snapshot = await prisma.marketSnapshot.findFirst({
      where: { marketId },
      orderBy: { timestamp: 'desc' },
    });

    if (!snapshot) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Market not found' },
      });
    }

    return { data: serializeMarket(snapshot), meta: { timestamp: new Date().toISOString() } };
  });

  // GET /v1/decisions - Decision history
  server.get('/v1/decisions', async (request) => {
    const { cursor, limit = '20' } = request.query as { cursor?: string; limit?: string };

    const decisions = await prisma.decision.findMany({
      take: Math.min(parseInt(limit, 10), 100),
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { timestamp: 'desc' },
    });

    return {
      data: decisions.map(serializeDecision),
      meta: {
        count: decisions.length,
        nextCursor: decisions[decisions.length - 1]?.id,
      },
    };
  });

  // GET /v1/decisions/:hash - Single decision
  server.get('/v1/decisions/:hash', async (request, reply) => {
    const { hash } = request.params as { hash: string };

    const decision = await prisma.decision.findUnique({
      where: { decisionHash: hash },
    });

    if (!decision) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Decision not found' },
      });
    }

    return { data: serializeDecision(decision), meta: { timestamp: new Date().toISOString() } };
  });

  // GET /v1/plans - Plan history
  server.get('/v1/plans', async (request) => {
    const { status, limit = '20' } = request.query as { status?: string; limit?: string };

    const plans = await (status
      ? prisma.executionPlan.findMany({
          where: { status },
          take: Math.min(parseInt(limit, 10), 100),
          orderBy: { createdAt: 'desc' },
          include: { actions: { orderBy: { actionIndex: 'asc' } } },
        })
      : prisma.executionPlan.findMany({
          take: Math.min(parseInt(limit, 10), 100),
          orderBy: { createdAt: 'desc' },
          include: { actions: { orderBy: { actionIndex: 'asc' } } },
        }));

    return {
      data: (plans as ExecutionPlanWithActions[]).map(serializePlan),
      meta: { count: plans.length },
    };
  });

  // GET /v1/harvests - Harvest history
  server.get('/v1/harvests', async (request) => {
    const { adapter, cursor, limit = '20' } = request.query as {
      adapter?: string;
      cursor?: string;
      limit?: string;
    };

    const harvests = await (adapter
      ? prisma.harvestRecord.findMany({
          where: { adapter },
          take: Math.min(parseInt(limit, 10), 100),
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          orderBy: { timestamp: 'desc' },
        })
      : prisma.harvestRecord.findMany({
          take: Math.min(parseInt(limit, 10), 100),
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          orderBy: { timestamp: 'desc' },
        }));

    return {
      data: harvests.map(serializeHarvest),
      meta: {
        count: harvests.length,
        nextCursor: harvests[harvests.length - 1]?.id,
      },
    };
  });

  // GET /v1/evaluations - Evaluation runs
  server.get('/v1/evaluations', async (request) => {
    const { status, limit = '10' } = request.query as { status?: string; limit?: string };

    const runs = await (status
      ? prisma.evaluationRun.findMany({
          where: { status },
          take: Math.min(parseInt(limit, 10), 50),
          orderBy: { startedAt: 'desc' },
        })
      : prisma.evaluationRun.findMany({
          take: Math.min(parseInt(limit, 10), 50),
          orderBy: { startedAt: 'desc' },
        }));

    return {
      data: runs,
      meta: { count: runs.length },
    };
  });
}
