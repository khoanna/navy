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

  // GET /v1/allocation - Current allocation from latest decision
  server.get('/v1/allocation', async () => {
    const decision = await prisma.decision.findFirst({
      orderBy: { timestamp: 'desc' },
    });

    if (!decision) {
      return {
        data: { totalAssets: '0', allocations: [] }
      };
    }

    const allocation = decision.allocation as {
      totalAssets?: string;
      allocations?: Array<{adapter: string; name: string; assets: string; percentage: number}>;
    } | null;

    return {
      data: {
        totalAssets: allocation?.totalAssets ?? '0',
        allocations: allocation?.allocations ?? [],
      }
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

  // ─────────────────────────────────────────────────────────────
  // Regime Routes (§6.2)
  // ─────────────────────────────────────────────────────────────

  // GET /v1/regimes - Current regime states for all markets
  server.get('/v1/regimes', async () => {
    const regimes = await prisma.contractRegime.findMany({
      orderBy: { marketId: 'asc' },
    });

    return {
      data: regimes.map((r) => ({
        marketId: r.marketId,
        digest: r.digest,
        activatedAt: r.activatedAt.toISOString(),
      })),
      meta: { count: regimes.length },
    };
  });

  // GET /v1/regimes/:marketId - Regime history for a market
  server.get('/v1/regimes/:marketId', async (request, reply) => {
    const { marketId } = request.params as { marketId: string };

    const regimes = await prisma.contractRegime.findMany({
      where: { marketId },
      orderBy: { activatedAt: 'desc' },
      take: 100,
    });

    if (regimes.length === 0) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'No regime history for market' },
      });
    }

    return {
      data: regimes.map((r) => ({
        marketId: r.marketId,
        digest: r.digest,
        activatedAt: r.activatedAt.toISOString(),
      })),
      meta: { count: regimes.length },
    };
  });

  // ─────────────────────────────────────────────────────────────
  // Simulation Routes (§6.3-§6.5)
  // ─────────────────────────────────────────────────────────────

  // GET /v1/simulations/:marketId - Simulation history
  server.get('/v1/simulations/:marketId', async (request) => {
    const { marketId } = request.params as { marketId: string };
    const { limit = '50' } = request.query as { limit?: string };

    const snapshots = await prisma.marketSnapshot.findMany({
      where: { marketId },
      orderBy: { timestamp: 'desc' },
      take: Math.min(parseInt(limit, 10), 100),
    });

    // Simulation data is embedded in snapshots
    return {
      data: snapshots.map((s) => ({
        marketId: s.marketId,
        blockHash: s.blockHash,
        timestamp: s.timestamp.toISOString(),
        supplyRateE18: s.supplyRateE18,
        utilizationE18: s.utilizationE18,
        totalAssetsBase: s.totalAssetsBase,
        configDigest: s.configDigest,
      })),
      meta: { count: snapshots.length },
    };
  });

  // ─────────────────────────────────────────────────────────────
  // Evaluation Manifest Routes (§11)
  // ─────────────────────────────────────────────────────────────

  // GET /v1/manifests - List evaluation manifests
  server.get('/v1/manifests', async () => {
    const runs = await prisma.evaluationRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 50,
    });

    return {
      data: runs.map((r) => ({
        id: r.id,
        manifestHash: r.manifestHash,
        status: r.status,
        startedAt: r.startedAt.toISOString(),
        completedAt: r.completedAt?.toISOString() ?? null,
      })),
      meta: { count: runs.length },
    };
  });

  // GET /v1/manifests/:id - Get manifest by ID
  server.get('/v1/manifests/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const run = await prisma.evaluationRun.findUnique({
      where: { id },
    });

    if (!run) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Manifest not found' },
      });
    }

    return {
      data: {
        id: run.id,
        manifestHash: run.manifestHash,
        status: run.status,
        results: run.results,
        startedAt: run.startedAt.toISOString(),
        completedAt: run.completedAt?.toISOString() ?? null,
      },
      meta: { timestamp: new Date().toISOString() },
    };
  });

  // GET /v1/manifests/:id/verification - Get enumeration verification
  server.get('/v1/manifests/:id/verification', async (request, reply) => {
    const { id } = request.params as { id: string };

    const run = await prisma.evaluationRun.findUnique({
      where: { id },
    });

    if (!run) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Manifest not found' },
      });
    }

    // Results contain enumeration verification data
    const results = run.results as Record<string, unknown> | null;
    const enumeration = results?.enumeration as Record<string, unknown> | null;

    return {
      data: {
        manifestId: id,
        enumeration,
        passed: enumeration ? (enumeration.passed as boolean) : null,
      },
      meta: { timestamp: new Date().toISOString() },
    };
  });

  // POST /v1/manifests - Create a new manifest
  server.post('/v1/manifests', async (request, reply) => {
    const body = request.body as {
      datasetStart: string;
      datasetEnd: string;
      calibrationEnd: string;
      heldOutStart: string;
      markets: Array<{ marketId: string; protocol: string; adapterAddress: string }>;
    };

    // Validate required fields
    if (!body.datasetStart || !body.datasetEnd || !body.calibrationEnd || !body.heldOutStart) {
      return reply.status(400).send({
        error: { code: 'INVALID_INPUT', message: 'Missing required date fields' },
      });
    }

    // Create manifest hash from content
    const contentHash = require('crypto')
      .createHash('sha256')
      .update(JSON.stringify(body))
      .digest('hex');

    const run = await prisma.evaluationRun.create({
      data: {
        manifestHash: contentHash,
        status: 'running',
        results: body,
      },
    });

    return reply.status(201).send({
      data: {
        id: run.id,
        manifestHash: run.manifestHash,
        status: run.status,
        startedAt: run.startedAt.toISOString(),
      },
      meta: { timestamp: new Date().toISOString() },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Enumeration Routes (§8.2)
  // ─────────────────────────────────────────────────────────────

  // GET /v1/enumeration/:cycleId - Get enumeration result for a cycle
  server.get('/v1/enumeration/:cycleId', async (request, reply) => {
    const { cycleId } = request.params as { cycleId: string };

    // Look up decision by hash or ID
    const decision = await prisma.decision.findFirst({
      where: {
        OR: [{ decisionHash: cycleId }, { id: cycleId }],
      },
    });

    if (!decision) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Decision not found' },
      });
    }

    // Allocation data contains enumeration result
    const allocation = decision.allocation as Record<string, unknown> | null;
    const enumeration = allocation?.enumeration as Record<string, unknown> | null;

    return {
      data: {
        decisionHash: decision.decisionHash,
        timestamp: decision.timestamp.toISOString(),
        enumeration: enumeration ?? null,
        passed: enumeration ? (enumeration.passed as boolean) : null,
      },
      meta: { timestamp: new Date().toISOString() },
    };
  });
}
