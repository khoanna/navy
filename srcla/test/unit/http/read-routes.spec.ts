process.env.LOG_LEVEL = 'silent';

import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../../src/http/server.js';

/**
 * The four read routes §10.2 names that `srcla` previously lacked:
 * GET /v1/sync, /v1/policy, /v1/reserve, /v1/emergencies.
 *
 * Each must answer from stored evidence or return an EXPLICIT empty result.
 * The empty-case assertions below are the point of this file: a route that
 * invents a plausible shape when it has no data looks implemented in every
 * report and audit, and these tests fail if one starts doing that.
 *
 * Driven through `server.inject()` against a stub Prisma client, so no port is
 * bound and no database is touched.
 */

type QueryLog = Array<{ model: string; op: string; args: unknown }>;

interface StubRows {
  chainBlock?: unknown;
  marketSnapshot?: unknown[];
  decision?: unknown;
  policyVersionUnique?: unknown;
  policyVersionFirst?: unknown;
  stressCalculation?: unknown[];
  incident?: unknown[];
  planAction?: unknown[];
}

function stubPrisma(rows: StubRows, log: QueryLog = []): PrismaClient {
  const record = <T>(model: string, op: string, value: T) => async (args?: unknown) => {
    log.push({ model, op, args });
    return value;
  };
  return {
    chainBlock: { findFirst: record('chainBlock', 'findFirst', rows.chainBlock ?? null) },
    marketSnapshot: { findMany: record('marketSnapshot', 'findMany', rows.marketSnapshot ?? []) },
    decision: { findFirst: record('decision', 'findFirst', rows.decision ?? null) },
    policyVersion: {
      findUnique: record('policyVersion', 'findUnique', rows.policyVersionUnique ?? null),
      findFirst: record('policyVersion', 'findFirst', rows.policyVersionFirst ?? null),
    },
    stressCalculation: {
      findMany: record('stressCalculation', 'findMany', rows.stressCalculation ?? []),
    },
    incident: { findMany: record('incident', 'findMany', rows.incident ?? []) },
    planAction: { findMany: record('planAction', 'findMany', rows.planAction ?? []) },
  } as unknown as PrismaClient;
}

async function get(rows: StubRows, url: string, log: QueryLog = []) {
  const server: FastifyInstance = await buildServer(
    { host: '0.0.0.0', port: 0 },
    stubPrisma(rows, log)
  );
  try {
    const res = await server.inject({ method: 'GET', url });
    return { status: res.statusCode, body: res.json() as Record<string, never> };
  } finally {
    await server.close();
  }
}

describe('GET /v1/sync', () => {
  it('reports the collector head and per-market freshness', async () => {
    const res = await get(
      {
        chainBlock: {
          chainId: 8453,
          blockNumber: 34_000_001n,
          blockHash: '0xblock',
          timestamp: new Date('2026-09-08T09:00:00.000Z'),
        },
        marketSnapshot: [
          { marketId: '0xaave', blockHash: '0xblock', timestamp: new Date('2026-09-08T09:00:00.000Z') },
          { marketId: '0xcomet', blockHash: '0xolder', timestamp: new Date('2026-09-08T08:00:00.000Z') },
        ],
      },
      '/v1/sync'
    );

    expect(res.status).toBe(200);
    // blockNumber is a Prisma BigInt: it must be serialised to a string or the
    // response throws at encode time.
    expect(res.body.data).toMatchObject({
      latestBlock: {
        chainId: 8453,
        blockNumber: '34000001',
        blockHash: '0xblock',
        timestamp: '2026-09-08T09:00:00.000Z',
      },
    });
    const markets = (res.body.data as never as { markets: Array<{ marketId: string }> }).markets;
    expect(markets.map((m) => m.marketId)).toEqual(['0xaave', '0xcomet']);
    expect(res.body.meta).toMatchObject({ marketCount: 2 });
  });

  it('says "nothing collected yet" explicitly rather than inventing a head block', async () => {
    const res = await get({}, '/v1/sync');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ latestBlock: null, markets: [] });
    expect(res.body.meta).toMatchObject({ marketCount: 0 });
  });
});

describe('GET /v1/policy', () => {
  it('returns the artifact the latest decision was produced under', async () => {
    const log: QueryLog = [];
    const res = await get(
      {
        decision: { policyVersion: 'v-42', timestamp: new Date('2026-09-08T07:00:00.000Z') },
        policyVersionUnique: {
          version: 'v-42',
          artifactHash: '5ed517d128bab909',
          payload: { method: 'walk-forward' },
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
          activatedAt: null,
          deactivatedAt: null,
        },
      },
      '/v1/policy',
      log
    );

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      version: 'v-42',
      artifactHash: '5ed517d128bab909',
      payload: { method: 'walk-forward' },
      createdAt: '2026-09-01T00:00:00.000Z',
      // Carried through verbatim: persistDecisionOutput never sets these, and
      // the route must not fill them in with something plausible.
      activatedAt: null,
      deactivatedAt: null,
      decidingSince: '2026-09-08T07:00:00.000Z',
    });
    expect(res.body.meta).toMatchObject({ source: 'LATEST_DECISION' });

    // It looked up THAT decision's version, not just any row.
    const lookup = log.find((q) => q.model === 'policyVersion' && q.op === 'findUnique');
    expect(lookup?.args).toEqual({ where: { version: 'v-42' } });
  });

  it('falls back to the most recent recorded version when nothing has decided yet', async () => {
    const res = await get(
      {
        policyVersionFirst: {
          version: 'v-1',
          artifactHash: 'aaaa',
          payload: {},
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
          activatedAt: null,
          deactivatedAt: null,
        },
      },
      '/v1/policy'
    );

    expect(res.body.meta).toMatchObject({ source: 'LATEST_RECORDED_VERSION' });
    expect(res.body.data).toMatchObject({ version: 'v-1', decidingSince: null });
  });

  it('returns an explicit null with a reason when no policy has ever been recorded', async () => {
    const res = await get({}, '/v1/policy');

    expect(res.body.data).toBeNull();
    expect(res.body.meta).toMatchObject({ reason: 'NO_POLICY_VERSION_RECORDED' });
  });
});

describe('GET /v1/reserve', () => {
  it('returns the latest decision reserve with its per-scenario stress rows', async () => {
    const log: QueryLog = [];
    const res = await get(
      {
        decision: {
          decisionHash: '0xdec',
          timestamp: new Date('2026-09-08T07:00:00.000Z'),
          reserveBase: '123456789',
        },
        stressCalculation: [
          {
            scenario: 'p95_24h',
            demandBase: '100',
            exitsBase: '90',
            shortfallBase: '10',
            feasible: false,
          },
        ],
      },
      '/v1/reserve',
      log
    );

    expect(res.body.data).toEqual({
      decisionHash: '0xdec',
      timestamp: '2026-09-08T07:00:00.000Z',
      requiredReserveBase: '123456789',
      stress: [
        {
          scenario: 'p95_24h',
          demandBase: '100',
          exitsBase: '90',
          shortfallBase: '10',
          feasible: false,
        },
      ],
    });
    expect(res.body.meta).toMatchObject({ stressCount: 1 });

    // The stress rows belong to that decision, not to the newest rows overall.
    const stressQuery = log.find((q) => q.model === 'stressCalculation');
    expect(stressQuery?.args).toMatchObject({ where: { decisionHash: '0xdec' } });
  });

  it('reports an empty stress list rather than padding it with zero scenarios', async () => {
    const res = await get(
      {
        decision: {
          decisionHash: '0xdec',
          timestamp: new Date('2026-09-08T07:00:00.000Z'),
          reserveBase: '0',
        },
      },
      '/v1/reserve'
    );

    expect(res.body.data).toMatchObject({ requiredReserveBase: '0', stress: [] });
    expect(res.body.meta).toMatchObject({ stressCount: 0 });
  });

  it('returns an explicit null with a reason when no decision has been recorded', async () => {
    const res = await get({}, '/v1/reserve');

    expect(res.body.data).toBeNull();
    expect(res.body.meta).toMatchObject({ reason: 'NO_DECISION_RECORDED' });
  });
});

describe('GET /v1/emergencies', () => {
  it('returns recorded incidents and emergency exit actions', async () => {
    const log: QueryLog = [];
    const res = await get(
      {
        incident: [
          {
            id: 'i1',
            kind: 'oracle_stale',
            marketId: '0xaave',
            detail: 'feed older than 24h',
            detectedAt: new Date('2026-09-08T06:00:00.000Z'),
          },
        ],
        planAction: [
          {
            planId: 'p1',
            actionIndex: 3,
            adapter: '0xcomet',
            amountBase: '5000000',
            status: 'confirmed',
            txHash: '0xtx',
            error: null,
          },
        ],
      },
      '/v1/emergencies',
      log
    );

    expect(res.body.data).toEqual({
      incidents: [
        {
          id: 'i1',
          kind: 'oracle_stale',
          marketId: '0xaave',
          detail: 'feed older than 24h',
          detectedAt: '2026-09-08T06:00:00.000Z',
        },
      ],
      emergencyExits: [
        {
          planId: 'p1',
          actionIndex: 3,
          adapter: '0xcomet',
          amountBase: '5000000',
          status: 'confirmed',
          txHash: '0xtx',
          error: null,
        },
      ],
    });
    expect(res.body.meta).toMatchObject({ incidentCount: 1, emergencyExitCount: 1 });

    // Only emergency-kind actions -- otherwise this route would report every
    // deploy and divest as an emergency exit.
    const actionQuery = log.find((q) => q.model === 'planAction');
    expect(actionQuery?.args).toMatchObject({ where: { kind: 'emergency' } });
  });

  it('returns empty lists, not a synthetic incident, when nothing has been recorded', async () => {
    const res = await get({}, '/v1/emergencies');

    expect(res.body.data).toEqual({ incidents: [], emergencyExits: [] });
    expect(res.body.meta).toMatchObject({ incidentCount: 0, emergencyExitCount: 0 });
  });
});
