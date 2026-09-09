/**
 * `persistDecisionOutput` (src/runtime/decision-driver.ts) — the write half
 * of §9.1's churn state and of §8.2/§10.2's enumeration regret.
 *
 * Two audit findings meet here:
 *   NEW-19 — the signed per-venue deltas are the ONLY record of a realised
 *     exposure change anywhere in the schema. If they are not written, the
 *     next cycle's cooldown, turnover window and reversal allowance have
 *     nothing to read and silently return to their permanently-neutral
 *     behaviour.
 *   NEW-18 — `model EnumerationResult` had no writer anywhere in `src/`, so
 *     §8.2's "its approximation regret is persisted" was unmet.
 *
 * Runs against a recording fake, no database.
 */
import { persistDecisionOutput } from '../../../src/runtime/decision-driver.js';
import { loadBootstrapArtifact } from '../../../src/policy/artifact.js';
import type { PrismaClient } from '@prisma/client';
import type { DecisionInput, DecisionOutput, MarketObservation } from '../../../src/policy/types.js';

interface Recorded {
  model: string;
  op: string;
  args: Record<string, unknown>;
}

function fakePrisma(): { prisma: PrismaClient; writes: Recorded[] } {
  const writes: Recorded[] = [];
  const record = (model: string, op: string) => async (args: Record<string, unknown>) => {
    writes.push({ model, op, args });
    return {};
  };
  const prisma = {
    policyVersion: { upsert: record('policyVersion', 'upsert') },
    decision: { create: record('decision', 'create') },
    enumerationResult: { upsert: record('enumerationResult', 'upsert') },
  } as unknown as PrismaClient;
  return { prisma, writes };
}

function market(marketId: string, positionBase: bigint): MarketObservation {
  return {
    marketId,
    adapter: `0x${marketId}`,
    protocol: 'aave',
    cash: 10n ** 12n,
    borrows: 0n,
    reserves: 0n,
    supplyRateWad: 10n ** 16n,
    utilizationWad: 0n,
    positionBase,
    maxDeployableBase: 10n ** 12n,
    maxWithdrawableBase: 10n ** 12n,
    configDigest: '0xd',
    regimeId: 'r1',
    paused: false,
    capBps: 5000,
    absoluteCapBase: 10n ** 13n,
    maxLossBps: 50,
    dependencyGroupIds: [],
  };
}

function input(markets: MarketObservation[]): DecisionInput {
  return {
    origin: { blockNumber: 42, blockHash: '0xb', timestampSeconds: 1_000_000, finalized: true },
    vault: {
      totalAssetsBase: 10n ** 10n,
      idleBase: 10n ** 10n,
      sharesOutstanding: 10n ** 10n,
      adminReserveBase: 0n,
      dynamicReserveBase: 0n,
      minIdleBps: 0,
      paused: false,
      configurationDigest: '0xv',
    },
    markets,
    dependencyGroups: [],
    withdrawals: [],
    gas: {
      l2BaseFeeWei: 1n,
      l1BaseFeeWei: 1n,
      l1BlobBaseFeeWei: 1n,
      ethUsdE8: 350_000_000_000n,
      usdcUsdE8: 100_000_000n,
    },
    history: [],
    lastAction: { timestampSeconds: null, turnoverWindowBase: 0n, recentMoves: [] },
  };
}

function output(over: Partial<DecisionOutput> = {}): DecisionOutput {
  return {
    snapshotHash: 'aa',
    decisionHash: 'bb',
    admission: { eligible: [], reasons: [] },
    curves: [],
    lowerBounds: [],
    reserve: {
      requiredBase: 0n,
      floorBase: 0n,
      netDemandQuantileBase: 0n,
      stressShortfallBase: 0n,
      scenarioFeasible: [],
    },
    target: new Map(),
    enumeration: null,
    costGate: { passed: true, reason: 'X', legs: [] },
    plan: null,
    action: 'hold',
    reasons: [],
    ...over,
  };
}

const PLAN = { planId: '0xplan' } as unknown as NonNullable<DecisionOutput['plan']>;

const artifact = () => loadBootstrapArtifact();

function actionDecisionOf(writes: Recorded[]): Record<string, unknown> {
  const create = writes.find((w) => w.model === 'decision' && w.op === 'create')!;
  return (create.args['data'] as Record<string, unknown>)['actionDecision'] as Record<string, unknown>;
}

describe('persistDecisionOutput records the §9.1 churn evidence', () => {
  it('writes the signed per-venue deltas of a rebalance', async () => {
    const { prisma, writes } = fakePrisma();
    await persistDecisionOutput(
      prisma,
      artifact(),
      output({
        action: 'rebalance',
        plan: PLAN,
        target: new Map([['aave', 3_000n], ['compound', 0n]]),
      }),
      input([market('aave', 1_000n), market('compound', 500n)])
    );

    expect(actionDecisionOf(writes)['moves']).toEqual([
      { marketId: 'aave', deltaBase: '2000' },
      { marketId: 'compound', deltaBase: '-500' },
    ]);
  });

  it('writes no moves for a HOLD', async () => {
    const { prisma, writes } = fakePrisma();
    await persistDecisionOutput(
      prisma,
      artifact(),
      output({ action: 'hold', plan: null, target: new Map([['aave', 3_000n]]) }),
      input([market('aave', 1_000n)])
    );
    expect(actionDecisionOf(writes)['moves']).toEqual([]);
  });

  it('serialises deltas as strings, since Json cannot carry a BigInt', async () => {
    const { prisma, writes } = fakePrisma();
    await persistDecisionOutput(
      prisma,
      artifact(),
      output({ action: 'rebalance', plan: PLAN, target: new Map([['aave', 10n ** 13n]]) }),
      input([market('aave', 0n)])
    );
    const moves = actionDecisionOf(writes)['moves'] as Array<{ deltaBase: unknown }>;
    expect(typeof moves[0]!.deltaBase).toBe('string');
    expect(moves[0]!.deltaBase).toBe('10000000000000');
  });
});

describe('persistDecisionOutput records the §8.2 enumeration regret', () => {
  it('writes an EnumerationResult row when enumeration ran', async () => {
    const { prisma, writes } = fakePrisma();
    await persistDecisionOutput(
      prisma,
      artifact(),
      output({ enumeration: { regretBps: 37n, enumerated: 1234, passed: true } }),
      input([market('aave', 0n)])
    );
    const row = writes.find((w) => w.model === 'enumerationResult');
    expect(row).toBeDefined();
    expect(row!.args['create']).toEqual({
      decisionHash: 'bb',
      enumerated: 1234,
      regretBps: '37',
      passed: true,
    });
  });

  it('writes NOTHING when enumeration did not run', async () => {
    // A null enumeration must not be persisted as a zero regret: "not
    // checked" and "checked, zero regret" are different claims and §8.2's
    // record has to keep them apart.
    const { prisma, writes } = fakePrisma();
    await persistDecisionOutput(prisma, artifact(), output({ enumeration: null }), input([market('aave', 0n)]));
    expect(writes.find((w) => w.model === 'enumerationResult')).toBeUndefined();
  });
});
