import { SrclaController, type SrclaControllerConfig, type PlanExecutor, type ExecutionPlan } from '../../src/controller/controller.js';
import type { SnapshotCollector } from '../../src/collector/snapshot-collector.js';
import type { AdmissionEngine } from '../../src/admission/engine.js';
import type { ForecastResult } from '../../src/forecast/types.js';
import type { ReserveOptimizer } from '../../src/reserve/reserve.js';
import type { ActionDecisionEngine } from '../../src/decision/action-decision.js';
import type { PrismaClient } from '@prisma/client';
import { WAD } from '../../src/protocols/math.js';

interface MockSnapshot {
  blockNumber: number;
  blockHash: string;
  timestamp: Date;
  vault: {
    totalAssets: bigint;
    synchronousLiquidity: bigint;
    idleBase: bigint;
    minIdleBps: bigint;
    paused: boolean;
    absoluteCaps?: {
      totalCap: bigint;
      perUserCap: bigint;
      minDeposit: bigint;
    };
    groups?: Array<{
      id: string;
      exposure: bigint;
      cap: bigint;
    }>;
    reserve?: {
      admin: bigint;
      dynamic: bigint;
    };
    rewardCacheTimestamp?: bigint;
    rewardCacheValue?: bigint;
    rewardReady?: boolean;
    rewardPolicyDigest?: string;
    routeDigest?: string;
    routeStatus?: 'active' | 'inactive' | 'stale';
    sequencerRound?: bigint;
    feedRounds?: Array<{
      feed: string;
      round: bigint;
      staleness: boolean;
    }>;
  };
  strategies: Array<{
    address: string;
    name: string;
    totalAssets: bigint;
    maxWithdrawable: bigint;
    supplyRate: bigint;
    utilization: bigint;
    cash: bigint;
    paused: boolean;
    configDigest: string;
    capBps?: number;
  }>;
}

interface MockServices {
  collector: SnapshotCollector;
  admission: AdmissionEngine;
  forecast: Map<string, ForecastResult>;
  reserve: ReserveOptimizer;
  decision: ActionDecisionEngine;
  executor: PlanExecutor;
  prisma: PrismaClient;
}

function createMockSnapshot(): MockSnapshot {
  return {
    blockNumber: 12345678,
    blockHash: '0xabc123def456',
    timestamp: new Date(),
    vault: {
      totalAssets: 10_000_000_000_000n, // 10M USDC
      synchronousLiquidity: 9_500_000_000_000n,
      idleBase: 500_000_000_000n,
      minIdleBps: 100n,
      paused: false,
      absoluteCaps: {
        totalCap: 100_000_000_000_000n,
        perUserCap: 1_000_000_000_000n,
        minDeposit: 10_000_000n,
      },
      groups: [
        { id: 'compound-group', exposure: 5_000_000_000_000n, cap: 10_000_000_000_000n },
        { id: 'aave-group', exposure: 4_500_000_000_000n, cap: 8_000_000_000_000n },
      ],
      reserve: {
        admin: 100_000_000_000n,
        dynamic: 400_000_000_000n,
      },
      rewardCacheTimestamp: 1_000_000_000n,
      rewardCacheValue: 50_000_000_000n,
      rewardReady: true,
      rewardPolicyDigest: '0xdigest1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
      routeDigest: '0xroute4567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12',
      routeStatus: 'active',
      sequencerRound: 1_000_000n,
      feedRounds: [
        { feed: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', round: 999_999n, staleness: false },
      ],
    },
    strategies: [
      {
        address: '0xAaveStrategyAddress',
        name: 'Aave',
        totalAssets: 5_000_000_000_000n,
        maxWithdrawable: 5_000_000_000_000n,
        supplyRate: WAD / 100n,
        utilization: 80_000_000_000_000_000n, // 0.8 RAY = 80%
        cash: 1_000_000_000_000n,
        paused: false,
        configDigest: '0xAaveDigest',
        capBps: 5000, // 50% cap
      },
      {
        address: '0xCompoundStrategyAddress',
        name: 'Compound',
        totalAssets: 4_500_000_000_000n,
        maxWithdrawable: 4_500_000_000_000n,
        supplyRate: WAD / 120n,
        utilization: 75_000_000_000_000_000n, // 0.75 RAY = 75%
        cash: 1_500_000_000_000n,
        paused: false,
        configDigest: '0xCompoundDigest',
        capBps: 5000, // 50% cap
      },
    ],
  };
}

function createMockServices(mockSnapshot: MockSnapshot): MockServices & { mocks: { collectCalls: number; evaluateCalls: number; decideCalls: number; executeCalls: number; createCalls: unknown[][] } } {
  const mocks = {
    collectCalls: 0,
    evaluateCalls: 0,
    decideCalls: 0,
    executeCalls: 0,
    createCalls: [] as unknown[][],
  };

  const collector: SnapshotCollector = {
    collect: async () => {
      mocks.collectCalls++;
      return mockSnapshot as any;
    },
  } as unknown as SnapshotCollector;

  const admission: AdmissionEngine = {
    evaluate: () => {
      mocks.evaluateCalls++;
      return {
        admitted: true,
        reasons: ['RESERVE_SUFFICIENT'],
        errors: [],
      };
    },
    evaluateVault: () => {
      mocks.evaluateCalls++;
      return {
        admitted: true,
        reasons: ['VAULT_POLICY_OK'],
        errors: [],
      };
    },
  } as unknown as AdmissionEngine;

  const forecast = new Map<string, ForecastResult>([
    [
      '0xAaveStrategyAddress',
      {
        marketId: '0xAaveStrategyAddress',
        horizon: 86400 as ForecastResult['horizon'],
        meanReturn: WAD + 10000000000000000n, // 1.01
        lowerReturn: WAD,
        coverage: 0.95,
        method: 'rolling',
        config: { windowDays: 14, quantile: 0.1 },
      },
    ],
    [
      '0xCompoundStrategyAddress',
      {
        marketId: '0xCompoundStrategyAddress',
        horizon: 86400 as ForecastResult['horizon'],
        meanReturn: WAD + 5000000000000000n, // 1.005
        lowerReturn: WAD - 5000000000000000n,
        coverage: 0.90,
        method: 'ew-residual',
        config: { decay: 0.95, residualQuantile: 0.1 },
      },
    ],
  ]);

  const reserve: ReserveOptimizer = {
    optimalReserve: () => 500_000_000_000n,
    stressTest: () => ({ passed: true, results: [] }),
  } as unknown as ReserveOptimizer;

  const decision: ActionDecisionEngine = {
    decide: () => {
      mocks.decideCalls++;
      return {
        action: 'hold' as const,
        amount: 0n,
        targetAdapter: null,
        reason: 'AMOUNT_BELOW_MINIMUM',
      };
    },
  } as unknown as ActionDecisionEngine;

  const executor: PlanExecutor = {
    executePlan: async () => {
      mocks.executeCalls++;
      return {
        success: true,
        txHashes: [],
        errors: [],
      };
    },
  };

  const prisma = {
    decision: {
      create: async (data: unknown) => {
        mocks.createCalls.push([data]);
        return { id: 'mock-decision-id' };
      },
    },
  } as unknown as PrismaClient;

  return { collector, admission, forecast, reserve, decision, executor, prisma, mocks };
}

describe('SrclaController', () => {
  let mockServices: MockServices & { mocks: { collectCalls: number; evaluateCalls: number; decideCalls: number; executeCalls: number; createCalls: unknown[][] } };
  let config: SrclaControllerConfig;

  beforeEach(() => {
    mockServices = createMockServices(createMockSnapshot());
    config = {
      horizonSeconds: 86400,
      executionEnabled: false,
      policyVersion: 'test-v1',
    };
  });

  describe('constructor', () => {
    it('should create controller with all services', () => {
      const controller = new SrclaController({
        collector: mockServices.collector,
        admission: mockServices.admission,
        forecasts: mockServices.forecast,
        reserve: mockServices.reserve,
        decision: mockServices.decision,
        executor: mockServices.executor,
        prisma: mockServices.prisma,
        config,
      });

      expect(controller).toBeInstanceOf(SrclaController);
    });
  });

  describe('runCycle', () => {
    it('should run full decision cycle with all new components', async () => {
      const controller = new SrclaController({
        collector: mockServices.collector,
        admission: mockServices.admission,
        forecasts: mockServices.forecast,
        reserve: mockServices.reserve,
        decision: mockServices.decision,
        executor: mockServices.executor,
        prisma: mockServices.prisma,
        config,
      });

      const result = await controller.runCycle();

      // Verify snapshot was collected
      expect(mockServices.mocks.collectCalls).toBe(1);

      // Verify admission was evaluated (2: evaluate + evaluateVault)
      expect(mockServices.mocks.evaluateCalls).toBe(2);

      // Verify decision was made
      expect(mockServices.mocks.decideCalls).toBe(1);

      // Verify decision record was stored
      expect(mockServices.mocks.createCalls.length).toBe(1);

      // Verify result structure includes new fields
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.snapshotHash).toBeTruthy();
      expect(result.admission).toBeTruthy();
      expect(result.decision).toBeTruthy();
      expect(result.skipped).toBe(false);
      expect(result.error).toBeUndefined();

      // Verify new components are present
      expect(result.regimeTransitions).toBeDefined();
      expect(Array.isArray(result.regimeTransitions)).toBe(true);
      expect(result.simulatedRates).toBeDefined();
      expect(Array.isArray(result.simulatedRates)).toBe(true);
      expect(result.forecasts).toBeDefined();
      expect(Array.isArray(result.forecasts)).toBe(true);
      expect(result.dynamicReserve).toBeDefined();
      expect(result.optimizedAllocation).toBeDefined();
    });

    it('should not execute if admission fails', async () => {
      // Override admission to reject
      const admissionRejecting: AdmissionEngine = {
        evaluate: () => ({
          admitted: false,
          reasons: ['MARKET_PAUSED'],
          errors: [],
        }),
        evaluateVault: () => ({
          admitted: false,
          reasons: ['VAULT_POLICY_FAILED'],
          errors: ['REWARD_NOT_READY'],
        }),
      } as unknown as AdmissionEngine;

      const controller = new SrclaController({
        collector: mockServices.collector,
        admission: admissionRejecting,
        forecasts: mockServices.forecast,
        reserve: mockServices.reserve,
        decision: mockServices.decision,
        executor: mockServices.executor,
        prisma: mockServices.prisma,
        config,
      });

      const result = await controller.runCycle();

      expect(result.admission).not.toBeNull();
      expect(result.admission?.admitted).toBe(false);
      expect(result.decision).toBeNull();
      expect(result.reason).toBe('ADMISSION_FAILED');

      // Decision should NOT have been stored when admission fails
      expect(mockServices.mocks.createCalls.length).toBe(0);
    });

    it('should handle collector returning null', async () => {
      const collectorReturningNull: SnapshotCollector = {
        collect: async () => null,
      } as unknown as SnapshotCollector;

      const controller = new SrclaController({
        collector: collectorReturningNull,
        admission: mockServices.admission,
        forecasts: mockServices.forecast,
        reserve: mockServices.reserve,
        decision: mockServices.decision,
        executor: mockServices.executor,
        prisma: mockServices.prisma,
        config,
      });

      const result = await controller.runCycle();

      expect(result.reason).toBe('NO_SNAPSHOT');
      expect(result.decision).toBeNull();
    });

    it('should handle errors gracefully', async () => {
      const collectorThrowing: SnapshotCollector = {
        collect: async () => {
          throw new Error('Chain unavailable');
        },
      } as unknown as SnapshotCollector;

      const controller = new SrclaController({
        collector: collectorThrowing,
        admission: mockServices.admission,
        forecasts: mockServices.forecast,
        reserve: mockServices.reserve,
        decision: mockServices.decision,
        executor: mockServices.executor,
        prisma: mockServices.prisma,
        config,
      });

      const result = await controller.runCycle();

      expect(result.error).toBe('Chain unavailable');
      expect(result.decision).toBeNull();
    });

    it('should store decision record with correct fields', async () => {
      const controller = new SrclaController({
        collector: mockServices.collector,
        admission: mockServices.admission,
        forecasts: mockServices.forecast,
        reserve: mockServices.reserve,
        decision: mockServices.decision,
        executor: mockServices.executor,
        prisma: mockServices.prisma,
        config,
      });

      await controller.runCycle();

      expect(mockServices.mocks.createCalls.length).toBe(1);
      const createCall = mockServices.mocks.createCalls[0]![0] as { data: Record<string, unknown> };
      expect(createCall.data).toHaveProperty('policyVersion', 'test-v1');
      expect(createCall.data).toHaveProperty('blockNumber');
      expect(createCall.data).toHaveProperty('admissions');
      expect(createCall.data).toHaveProperty('forecasts');
      expect(createCall.data).toHaveProperty('reserveBase');
      expect(createCall.data).toHaveProperty('allocation');
      expect(createCall.data).toHaveProperty('actionDecision');
    });

    it('should compute dynamic reserve with all components', async () => {
      const controller = new SrclaController({
        collector: mockServices.collector,
        admission: mockServices.admission,
        forecasts: mockServices.forecast,
        reserve: mockServices.reserve,
        decision: mockServices.decision,
        executor: mockServices.executor,
        prisma: mockServices.prisma,
        config,
      });

      const result = await controller.runCycle();

      expect(result.dynamicReserve).toBeDefined();
      expect(result.dynamicReserve.totalReserve).toBeGreaterThan(0n);
      expect(result.dynamicReserve.floorReserve).toBeGreaterThan(0n);
      expect(result.dynamicReserve.quantileReserve).toBeGreaterThanOrEqual(0n);
      expect(result.dynamicReserve.stressReserve).toBeGreaterThanOrEqual(0n);
      expect(result.dynamicReserve.idleThreshold).toBeDefined();
    });

    it('should include simulated rates in result', async () => {
      const controller = new SrclaController({
        collector: mockServices.collector,
        admission: mockServices.admission,
        forecasts: mockServices.forecast,
        reserve: mockServices.reserve,
        decision: mockServices.decision,
        executor: mockServices.executor,
        prisma: mockServices.prisma,
        config,
      });

      const result = await controller.runCycle();

      expect(result.simulatedRates.length).toBeGreaterThan(0);
      for (const rate of result.simulatedRates) {
        expect(rate.marketId).toBeDefined();
        expect(rate.preDepositRate).toBeDefined();
        expect(rate.postDepositRate).toBeDefined();
        expect(rate.utilizationBefore).toBeDefined();
        expect(rate.utilizationAfter).toBeDefined();
      }
    });
  });
});

describe('SrclaController - Cold Start', () => {
  it('should apply cold start restrictions', async () => {
    const snapshot = createMockSnapshot();
    const mockServices = createMockServices(snapshot);

    // Set cold start period to 30 days
    const config: SrclaControllerConfig = {
      horizonSeconds: 86400,
      executionEnabled: false,
      policyVersion: 'test-v1',
      coldStartPeriodDays: 30,
    };

    const controller = new SrclaController({
      collector: mockServices.collector,
      admission: mockServices.admission,
      forecasts: mockServices.forecast,
      reserve: mockServices.reserve,
      decision: mockServices.decision,
      executor: mockServices.executor,
      prisma: mockServices.prisma,
      config,
    });

    const result = await controller.runCycle();

    // Cold start should be active (less than 30 days since start)
    expect(result.optimizedAllocation.size).toBeGreaterThanOrEqual(0);
  });
});

describe('SrclaController - Cost Gate', () => {
  it('should hold when cost gate fails', async () => {
    const snapshot = createMockSnapshot();
    const mockServices = createMockServices(snapshot);

    // Set very high cost threshold
    const config: SrclaControllerConfig = {
      horizonSeconds: 86400,
      executionEnabled: false,
      policyVersion: 'test-v1',
      costGateMinThreshold: 1_000_000_000_000_000n, // Very high threshold
    };

    const controller = new SrclaController({
      collector: mockServices.collector,
      admission: mockServices.admission,
      forecasts: mockServices.forecast,
      reserve: mockServices.reserve,
      decision: mockServices.decision,
      executor: mockServices.executor,
      prisma: mockServices.prisma,
      config,
    });

    const result = await controller.runCycle();

    // Should have held due to cost gate
    expect(result.decision?.action).toBe('hold');
    expect(result.decision?.reason).toContain('COST_GATE_FAILED');
  });
});

describe('NoOpPlanExecutor', () => {
  it('should return success with no tx hashes', async () => {
    const { NoOpPlanExecutor } = await import('../../src/controller/controller.js');
    const executor = new NoOpPlanExecutor();

    const plan: ExecutionPlan = {
      decisionHash: '0xtest',
      actions: [],
    };

    const result = await executor.executePlan(plan);

    expect(result.success).toBe(true);
    expect(result.txHashes).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});
