import { Controller, type ControllerConfig, type PlanExecutor, type ExecutionPlan } from './controller.js';
import type { SnapshotCollector } from '../collector/snapshot-collector.js';
import type { AdmissionEngine } from '../admission/engine.js';
import type { ForecastResult } from '../forecast/types.js';
import type { ReserveOptimizer } from '../reserve/reserve.js';
import type { ActionDecisionEngine } from '../decision/action-decision.js';
import type { PrismaClient } from '@prisma/client';
import { WAD } from '../protocols/math.js';

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
    // Extended fields from production vault
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
  }>;
}

interface MockServices {
  collector: SnapshotCollector;
  admission: AdmissionEngine;
  forecast: ForecastResult[];
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
        supplyRate: 0n,
        utilization: 0n,
        cash: 0n,
        paused: false,
        configDigest: '0xAaveDigest',
      },
      {
        address: '0xCompoundStrategyAddress',
        name: 'Compound',
        totalAssets: 4_500_000_000_000n,
        maxWithdrawable: 4_500_000_000_000n,
        supplyRate: 0n,
        utilization: 0n,
        cash: 0n,
        paused: false,
        configDigest: '0xCompoundDigest',
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

  const forecast: ForecastResult[] = [
    {
      marketId: '0xAaveStrategyAddress',
      horizon: 86400,
      meanReturn: WAD + 10000000000000000n, // 1.01
      lowerReturn: WAD,
      coverage: 0.95,
      method: 'rolling',
      config: { windowDays: 14, quantile: 0.1 },
    },
    {
      marketId: '0xCompoundStrategyAddress',
      horizon: 86400,
      meanReturn: WAD + 5000000000000000n, // 1.005
      lowerReturn: WAD - 5000000000000000n,
      coverage: 0.90,
      method: 'ew-residual',
      config: { decay: 0.95, residualQuantile: 0.1 },
    },
  ];

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

describe('Controller', () => {
  let mockServices: MockServices & { mocks: { collectCalls: number; evaluateCalls: number; decideCalls: number; executeCalls: number; createCalls: unknown[][] } };
  let config: ControllerConfig;

  beforeEach(() => {
    mockServices = createMockServices(createMockSnapshot());
    config = {
      horizonSeconds: 86400,
      executionEnabled: false, // Disabled by default for testing
      policyVersion: 'test-v1',
    };
  });

  describe('constructor', () => {
    it('should create controller with all services', () => {
      const controller = new Controller({
        collector: mockServices.collector,
        admission: mockServices.admission,
        forecast: mockServices.forecast,
        reserve: mockServices.reserve,
        decision: mockServices.decision,
        executor: mockServices.executor,
        prisma: mockServices.prisma,
        config,
      });

      expect(controller).toBeInstanceOf(Controller);
    });
  });

  describe('runCycle', () => {
    it('should run full decision cycle', async () => {
      const controller = new Controller({
        collector: mockServices.collector,
        admission: mockServices.admission,
        forecast: mockServices.forecast,
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

      // Verify result structure
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.snapshotHash).toBeTruthy();
      expect(result.admission).toBeTruthy();
      expect(result.decision).toBeTruthy();
      expect(result.skipped).toBe(false);
      expect(result.error).toBeUndefined();
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

      const controller = new Controller({
        collector: mockServices.collector,
        admission: admissionRejecting,
        forecast: mockServices.forecast,
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

    it('should not execute if execution is disabled', async () => {
      const controller = new Controller({
        collector: mockServices.collector,
        admission: mockServices.admission,
        forecast: mockServices.forecast,
        reserve: mockServices.reserve,
        decision: mockServices.decision,
        executor: mockServices.executor,
        prisma: mockServices.prisma,
        config,
      });

      const result = await controller.runCycle();

      expect(result.execution).toBeNull();
      expect(result.plan).toBeTruthy();
      // Executor should not have been called
      expect(mockServices.mocks.executeCalls).toBe(0);
    });

    it('should execute plan when action is not hold', async () => {
      // Override decision to return deploy action
      const decisionWithAction: ActionDecisionEngine = {
        decide: () => ({
          action: 'deploy' as const,
          amount: 100_000_000_000n,
          targetAdapter: '0xAaveStrategyAddress',
          reason: 'DEPLOY_TO_AaveStrategyAddress',
        }),
      } as unknown as ActionDecisionEngine;

      // Enable execution
      config.executionEnabled = true;

      const controller = new Controller({
        collector: mockServices.collector,
        admission: mockServices.admission,
        forecast: mockServices.forecast,
        reserve: mockServices.reserve,
        decision: decisionWithAction,
        executor: mockServices.executor,
        prisma: mockServices.prisma,
        config,
      });

      const result = await controller.runCycle();

      expect(result.execution).not.toBeNull();
      expect(mockServices.mocks.executeCalls).toBe(1);
    });

    it('should handle collector returning null', async () => {
      const collectorReturningNull: SnapshotCollector = {
        collect: async () => null,
      } as unknown as SnapshotCollector;

      const controller = new Controller({
        collector: collectorReturningNull,
        admission: mockServices.admission,
        forecast: mockServices.forecast,
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

      const controller = new Controller({
        collector: collectorThrowing,
        admission: mockServices.admission,
        forecast: mockServices.forecast,
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
      const controller = new Controller({
        collector: mockServices.collector,
        admission: mockServices.admission,
        forecast: mockServices.forecast,
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

    it('should build plan with actions when not hold', async () => {
      // Override decision to return deploy action
      const decisionWithAction: ActionDecisionEngine = {
        decide: () => ({
          action: 'deploy' as const,
          amount: 100_000_000_000n,
          targetAdapter: '0xAaveStrategyAddress',
          reason: 'DEPLOY_TO_AaveStrategyAddress',
        }),
      } as unknown as ActionDecisionEngine;

      const controller = new Controller({
        collector: mockServices.collector,
        admission: mockServices.admission,
        forecast: mockServices.forecast,
        reserve: mockServices.reserve,
        decision: decisionWithAction,
        executor: mockServices.executor,
        prisma: mockServices.prisma,
        config,
      });

      const result = await controller.runCycle();

      expect(result.plan).not.toBeNull();
      expect(result.plan?.actions).toHaveLength(1);
      expect(result.plan?.actions[0]).toHaveProperty('kind', 'deploy');
      expect(result.plan?.actions[0]).toHaveProperty('adapter', '0xAaveStrategyAddress');
      expect(result.plan?.actions[0]).toHaveProperty('amountBase', 100_000_000_000n);
    });
  });
});

describe('Controller - Production Vault Policy Enforcement', () => {
  let config: ControllerConfig;

  beforeEach(() => {
    config = {
      horizonSeconds: 86400,
      executionEnabled: false,
      policyVersion: 'test-v1',
    };
  });

  it('should reject when vault policy admission fails (reward not ready)', async () => {
    // Create snapshot with reward not ready
    const snapshotWithRewardNotReady: MockSnapshot = {
      ...createMockSnapshot(),
      vault: {
        ...createMockSnapshot().vault,
        rewardReady: false,
      },
    };

    const mockServicesRewardNotReady = createMockServices(snapshotWithRewardNotReady);

    // Override admission to reject vault policy
    const admissionRejectingVaultPolicy: AdmissionEngine = {
      evaluate: () => ({ admitted: true, reasons: ['RESERVE_SUFFICIENT'], errors: [] }),
      evaluateVault: () => ({
        admitted: false,
        reasons: ['VAULT_POLICY_FAILED'],
        errors: ['REWARD_NOT_READY'],
      }),
    } as unknown as AdmissionEngine;

    const controller = new Controller({
      collector: mockServicesRewardNotReady.collector,
      admission: admissionRejectingVaultPolicy,
      forecast: mockServicesRewardNotReady.forecast,
      reserve: mockServicesRewardNotReady.reserve,
      decision: mockServicesRewardNotReady.decision,
      executor: mockServicesRewardNotReady.executor,
      prisma: mockServicesRewardNotReady.prisma,
      config,
    });

    const result = await controller.runCycle();

    expect(result.reason).toBe('VAULT_POLICY_FAILED');
    expect(result.decision).toBeNull();
    expect(result.admission?.admitted).toBe(true); // Basic admission passed
  });

  it('should reject when route status is stale', async () => {
    // Create snapshot with stale route
    const snapshotWithStaleRoute: MockSnapshot = {
      ...createMockSnapshot(),
      vault: {
        ...createMockSnapshot().vault,
        routeStatus: 'stale',
      },
    };

    const mockServicesStaleRoute = createMockServices(snapshotWithStaleRoute);

    // Override admission to reject stale route
    const admissionRejectingStaleRoute: AdmissionEngine = {
      evaluate: () => ({ admitted: true, reasons: ['RESERVE_SUFFICIENT'], errors: [] }),
      evaluateVault: () => ({
        admitted: false,
        reasons: ['VAULT_POLICY_FAILED'],
        errors: ['ROUTE_STALE'],
      }),
    } as unknown as AdmissionEngine;

    const controller = new Controller({
      collector: mockServicesStaleRoute.collector,
      admission: admissionRejectingStaleRoute,
      forecast: mockServicesStaleRoute.forecast,
      reserve: mockServicesStaleRoute.reserve,
      decision: mockServicesStaleRoute.decision,
      executor: mockServicesStaleRoute.executor,
      prisma: mockServicesStaleRoute.prisma,
      config,
    });

    const result = await controller.runCycle();

    expect(result.reason).toBe('VAULT_POLICY_FAILED');
    expect(result.decision).toBeNull();
    expect(result.admission?.admitted).toBe(true); // Basic admission passed
  });

  it('should admit when all vault policy checks pass', async () => {
    // All production fields are valid
    const snapshotWithAllValid = createMockSnapshot();

    const mockServicesAllValid = createMockServices(snapshotWithAllValid);

    // Admission passes all checks
    const admissionPassingAll: AdmissionEngine = {
      evaluate: () => ({ admitted: true, reasons: ['RESERVE_SUFFICIENT'], errors: [] }),
      evaluateVault: () => ({
        admitted: true,
        reasons: ['VAULT_POLICY_OK', 'REWARD_READY', 'ROUTE_ACTIVE', 'CAPS_OK'],
        errors: [],
      }),
    } as unknown as AdmissionEngine;

    const controller = new Controller({
      collector: mockServicesAllValid.collector,
      admission: admissionPassingAll,
      forecast: mockServicesAllValid.forecast,
      reserve: mockServicesAllValid.reserve,
      decision: mockServicesAllValid.decision,
      executor: mockServicesAllValid.executor,
      prisma: mockServicesAllValid.prisma,
      config,
    });

    const result = await controller.runCycle();

    expect(result.admission?.admitted).toBe(true);
    expect(result.decision).not.toBeNull();
    expect(result.reason).toBeUndefined();
  });

  it('should include production vault fields in snapshot', async () => {
    const snapshot = createMockSnapshot();

    expect(snapshot.vault.absoluteCaps).toBeDefined();
    expect(snapshot.vault.absoluteCaps?.totalCap).toBe(100_000_000_000_000n);
    expect(snapshot.vault.groups).toHaveLength(2);
    expect(snapshot.vault.reserve).toBeDefined();
    expect(snapshot.vault.rewardCacheTimestamp).toBeDefined();
    expect(snapshot.vault.rewardReady).toBe(true);
    expect(snapshot.vault.routeStatus).toBe('active');
    expect(snapshot.vault.sequencerRound).toBeDefined();
  });
});

describe('NoOpPlanExecutor', () => {
  it('should return success with no tx hashes', async () => {
    const { NoOpPlanExecutor } = await import('./controller.js');
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
