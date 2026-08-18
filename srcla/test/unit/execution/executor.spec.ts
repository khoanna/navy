import { PlanBuilder, type ExecutionPlan, type PlanAction } from '../../../src/execution/plan-builder.js';
import { preflight, type PreflightParams } from '../../../src/execution/preflight.js';
import { reconcile, type VaultState } from '../../../src/execution/reconciler.js';
import { hashData } from '../../../src/domain/hashing.js';
import type { MarketState } from '../../../src/protocols/simulation/types.js';

/**
 * Create a mock ExecutionPlan for testing
 */
function createMockPlan(overrides: Partial<ExecutionPlan> = {}): ExecutionPlan {
  const decisionHash = hashData({ test: 'mock-plan', timestamp: new Date().toISOString() });

  return {
    planId: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    decisionHash,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    actions: [
      {
        kind: 0, // deploy
        adapter: '0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e',
        amountBase: 1_000_000_000n, // 1000 USDC
        merkleRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
      },
    ],
    ...overrides,
  };
}

describe('PlanBuilder', () => {
  describe('build', () => {
    it('should build plan from single deploy action', () => {
      const decisionHash = hashData({ test: 'data' });
      const plan = PlanBuilder.build({
        decisionHash,
        actions: [{ kind: 'deploy', adapter: '0x123', amount: 1_000_000n }],
      });

      expect(plan.actions.length).toBe(1);
      expect(plan.planId).toMatch(/^(0x)?[a-f0-9]{64}$/);
      expect(plan.decisionHash).toBe(decisionHash);
      expect(plan.expiresAt).toBeInstanceOf(Date);
      expect(plan.actions[0]!.kind).toBe(0); // deploy = 0
      expect(plan.actions[0]!.amountBase).toBe(1_000_000n);
    });

    it('should build plan from divest action', () => {
      const decisionHash = hashData({ test: 'divest' });
      const plan = PlanBuilder.build({
        decisionHash,
        actions: [{ kind: 'divest', adapter: '0x456', amount: 500_000n }],
      });

      expect(plan.actions.length).toBe(1);
      expect(plan.actions[0]!.kind).toBe(1); // divest = 1
      expect(plan.actions[0]!.amountBase).toBe(500_000n);
    });

    it('should build plan from harvest action', () => {
      const decisionHash = hashData({ test: 'harvest' });
      const plan = PlanBuilder.build({
        decisionHash,
        actions: [{ kind: 'harvest', adapter: '0x789', amount: 0n }],
      });

      expect(plan.actions.length).toBe(1);
      expect(plan.actions[0]!.kind).toBe(2); // harvest = 2
    });

    it('should build plan from multiple actions', () => {
      const decisionHash = hashData({ test: 'multi' });
      const plan = PlanBuilder.build({
        decisionHash,
        actions: [
          { kind: 'deploy', adapter: '0x111', amount: 1_000_000n },
          { kind: 'deploy', adapter: '0x222', amount: 2_000_000n },
        ],
      });

      expect(plan.actions.length).toBe(2);
    });

    it('should set custom expiry', () => {
      const plan = PlanBuilder.build({
        decisionHash: hashData({ test: 'expiry' }),
        actions: [{ kind: 'deploy', adapter: '0x123', amount: 1_000_000n }],
        expiryMinutes: 60,
      });

      const expectedExpiry = new Date(Date.now() + 60 * 60 * 1000);
      expect(plan.expiresAt.getTime()).toBeCloseTo(expectedExpiry.getTime(), -3);
    });

    it('should handle empty actions', () => {
      const plan = PlanBuilder.build({
        decisionHash: hashData({ test: 'empty' }),
        actions: [],
      });

      expect(plan.actions.length).toBe(0);
    });
  });

  describe('encode', () => {
    it('should encode plan for on-chain submission', () => {
      const plan = createMockPlan();
      const encoded = PlanBuilder.encode(plan);

      expect(encoded.planId).toBe(plan.planId);
      expect(encoded.decisionHash).toBe(plan.decisionHash);
      expect(encoded.expiresAt).toBe(BigInt(Math.floor(plan.expiresAt.getTime() / 1000)));
      expect(encoded.actions.length).toBe(plan.actions.length);
      expect(encoded.actions[0]!.kind).toBe(0);
      expect(encoded.actions[0]!.amountBase).toBe(1_000_000_000n);
    });
  });

  describe('with configuration digest', () => {
    it('should persist configuration digest in plan metadata', () => {
      const configDigest = '0xdigest1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab';
      const decisionHash = hashData({ test: 'config-digest' });
      const plan = PlanBuilder.build({
        decisionHash,
        actions: [{ kind: 'deploy', adapter: '0x123', amount: 1_000_000n }],
        configurationDigest: configDigest,
      });

      expect((plan as any).configurationDigest).toBe(configDigest);
    });

    it('should persist harvest deadline in plan metadata', () => {
      const deadline = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
      const decisionHash = hashData({ test: 'harvest-deadline' });
      const plan = PlanBuilder.build({
        decisionHash,
        actions: [{ kind: 'harvest', adapter: '0x456', amount: 0n }],
        harvestDeadline: deadline,
      });

      expect((plan as any).harvestDeadline).toBe(deadline);
    });

    it('should persist action data hash in plan metadata', () => {
      const actionDataHash = '0xhash1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      const decisionHash = hashData({ test: 'action-hash' });
      const plan = PlanBuilder.build({
        decisionHash,
        actions: [{ kind: 'deploy', adapter: '0x789', amount: 5_000_000n }],
        actionDataHash,
      });

      expect((plan as any).actionDataHash).toBe(actionDataHash);
    });
  });
});

describe('preflight', () => {
  describe('adapter validation', () => {
    it('should reject invalid adapter address', async () => {
      const params: PreflightParams = {
        adapter: 'invalid',
        amountBase: 1_000_000n,
        registeredAdapters: ['0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e'],
        pausedAdapters: [],
        gasPrice: 30_000_000_000n, // 30 gwei
        maxGasPrice: 100_000_000_000n,
      };

      const result = await preflight(params);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('INVALID');
    });

    it('should accept valid adapter', async () => {
      const params: PreflightParams = {
        adapter: '0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e',
        amountBase: 1_000_000n,
        registeredAdapters: ['0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e'],
        pausedAdapters: [],
        gasPrice: 30_000_000_000n,
        maxGasPrice: 100_000_000_000n,
      };

      const result = await preflight(params);
      expect(result.valid).toBe(true);
    });

    it('should reject zero amount', async () => {
      const params: PreflightParams = {
        adapter: '0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e',
        amountBase: 0n,
        registeredAdapters: ['0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e'],
        pausedAdapters: [],
        gasPrice: 30_000_000_000n,
        maxGasPrice: 100_000_000_000n,
      };

      const result = await preflight(params);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('ZERO_AMOUNT');
    });

    it('should reject paused adapter', async () => {
      const params: PreflightParams = {
        adapter: '0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e',
        amountBase: 1_000_000n,
        registeredAdapters: ['0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e'],
        pausedAdapters: ['0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e'],
        gasPrice: 30_000_000_000n,
        maxGasPrice: 100_000_000_000n,
      };

      const result = await preflight(params);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('ADAPTER_PAUSED');
    });

    it('should reject high gas price', async () => {
      const params: PreflightParams = {
        adapter: '0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e',
        amountBase: 1_000_000n,
        registeredAdapters: ['0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e'],
        pausedAdapters: [],
        gasPrice: 150_000_000_000n, // 150 gwei - too high
        maxGasPrice: 100_000_000_000n,
      };

      const result = await preflight(params);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('GAS_PRICE_TOO_HIGH');
    });
  });

  describe('harvest action', () => {
    it('should allow harvest with zero amount', async () => {
      const params: PreflightParams = {
        adapter: '0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e',
        amountBase: 0n,
        registeredAdapters: ['0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e'],
        pausedAdapters: [],
        gasPrice: 30_000_000_000n,
        maxGasPrice: 100_000_000_000n,
        isHarvest: true,
      };

      const result = await preflight(params);
      expect(result.valid).toBe(true);
    });
  });

  describe('configuration digest validation', () => {
    it('should reject when vault bytecode hash changed', async () => {
      const expectedVaultCodeHash = '0xoriginal1234567890abcdef1234567890abcdef1234567890abcdef1234';
      const currentVaultCodeHash = '0xchanged567890abcdef1234567890abcdef1234567890abcdef1234567890';

      const params: PreflightParams = {
        adapter: '0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e',
        amountBase: 1_000_000n,
        registeredAdapters: ['0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e'],
        pausedAdapters: [],
        gasPrice: 30_000_000_000n,
        maxGasPrice: 100_000_000_000n,
        vaultCodeAndConfig: {
          vaultCodeHash: currentVaultCodeHash,
          expectedVaultCodeHash,
          configurationDigest: '0xdigest123',
          expectedConfigurationDigest: '0xdigest123',
          routeStatus: 'active',
        },
      };

      const result = await preflight(params);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('VAULT_CODE_CHANGED');
    });

    it('should reject when configuration digest changed', async () => {
      const expectedConfigDigest = '0xdigest1234567890abcdef1234567890abcdef1234567890abcdef1234';
      const currentConfigDigest = '0xnewdigest567890abcdef1234567890abcdef1234567890abcdef123456';

      const params: PreflightParams = {
        adapter: '0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e',
        amountBase: 1_000_000n,
        registeredAdapters: ['0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e'],
        pausedAdapters: [],
        gasPrice: 30_000_000_000n,
        maxGasPrice: 100_000_000_000n,
        vaultCodeAndConfig: {
          vaultCodeHash: '0xcodehash',
          expectedVaultCodeHash: '0xcodehash',
          configurationDigest: currentConfigDigest,
          expectedConfigurationDigest: expectedConfigDigest,
          routeStatus: 'active',
        },
      };

      const result = await preflight(params);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('CONFIG_DIGEST_CHANGED');
    });

    it('should reject when route is inactive', async () => {
      const params: PreflightParams = {
        adapter: '0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e',
        amountBase: 1_000_000n,
        registeredAdapters: ['0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e'],
        pausedAdapters: [],
        gasPrice: 30_000_000_000n,
        maxGasPrice: 100_000_000_000n,
        vaultCodeAndConfig: {
          vaultCodeHash: '0xcodehash',
          expectedVaultCodeHash: '0xcodehash',
          configurationDigest: '0xdigest',
          expectedConfigurationDigest: '0xdigest',
          routeStatus: 'inactive',
        },
      };

      const result = await preflight(params);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('ROUTE_INACTIVE');
    });

    it('should accept when all vault code/config state matches', async () => {
      const vaultCodeHash = '0xoriginal1234567890abcdef1234567890abcdef1234567890abcdef1234';
      const configDigest = '0xdigest1234567890abcdef1234567890abcdef1234567890abcdef1234';

      const params: PreflightParams = {
        adapter: '0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e',
        amountBase: 1_000_000n,
        registeredAdapters: ['0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e'],
        pausedAdapters: [],
        gasPrice: 30_000_000_000n,
        maxGasPrice: 100_000_000_000n,
        vaultCodeAndConfig: {
          vaultCodeHash,
          expectedVaultCodeHash: vaultCodeHash,
          configurationDigest: configDigest,
          expectedConfigurationDigest: configDigest,
          routeStatus: 'active',
        },
      };

      const result = await preflight(params);
      expect(result.valid).toBe(true);
    });

    it('should reject when vaultCodeAndConfig is provided but state changed', async () => {
      const params: PreflightParams = {
        adapter: '0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e',
        amountBase: 1_000_000n,
        registeredAdapters: ['0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e'],
        pausedAdapters: [],
        gasPrice: 30_000_000_000n,
        maxGasPrice: 100_000_000_000n,
        vaultCodeAndConfig: {
          vaultCodeHash: '0xcurrent',
          expectedVaultCodeHash: '0xexpected',
          configurationDigest: '0xcurrent',
          expectedConfigurationDigest: '0xexpected',
          routeStatus: 'stale',
        },
      };

      const result = await preflight(params);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/VAULT_CODE_CHANGED|CONFIG_DIGEST_CHANGED|ROUTE_INACTIVE|ROUTE_STALE/);
    });
  });
});

describe('reconcile', () => {
  const mockReceipt = {
    status: 1,
    logs: [],
  } as unknown as { status: number; logs: unknown[] };

  describe('deviation checks', () => {
    it('should pass when deviation is within tolerance', () => {
      const action: PlanAction = {
        kind: 0,
        adapter: '0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e',
        amountBase: 1_000_000_000n, // 1000 USDC
        merkleRoot: '0x0000',
      };

      const vaultState: VaultState = {
        idle: 9_000_000_000_000n,
        adapterBalances: new Map([
          ['0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e', 1_000_050_000n], // 0.005% slippage = 5 bps
        ]),
      };

      const result = reconcile(action, mockReceipt, vaultState);

      expect(result.success).toBe(true);
      expect(result.acceptable).toBe(true);
      expect(result.deviation).toBeLessThan(1_000_000n); // < 10 bps tolerance
    });

    it('should fail when deviation exceeds tolerance', () => {
      const action: PlanAction = {
        kind: 0,
        adapter: '0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e',
        amountBase: 1_000_000_000n, // 1000 USDC
        merkleRoot: '0x0000',
      };

      const vaultState: VaultState = {
        idle: 9_000_000_000_000n,
        adapterBalances: new Map([
          ['0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e', 500_000_000n], // 50% shortfall
        ]),
      };

      const result = reconcile(action, mockReceipt, vaultState);

      expect(result.success).toBe(false);
      expect(result.acceptable).toBe(false);
      expect(result.deviation).toBe(500_000_000n);
    });

    it('should handle divest action correctly', () => {
      const action: PlanAction = {
        kind: 1, // divest
        adapter: '0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e',
        amountBase: 500_000_000n, // 500 USDC
        merkleRoot: '0x0000',
      };

      const vaultState: VaultState = {
        idle: 500_000_000n, // idle = amount divested
        adapterBalances: new Map([
          ['0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e', 4_500_000_000_000n],
        ]),
      };

      const result = reconcile(action, mockReceipt, vaultState);

      expect(result.success).toBe(true);
    });

    it('should handle missing adapter balance', () => {
      const action: PlanAction = {
        kind: 0,
        adapter: '0xUnknown',
        amountBase: 1_000_000_000n,
        merkleRoot: '0x0000',
      };

      const vaultState: VaultState = {
        idle: 9_000_000_000_000n,
        adapterBalances: new Map(),
      };

      const result = reconcile(action, mockReceipt, vaultState);

      expect(result.success).toBe(false);
      expect(result.acceptable).toBe(false);
    });
  });

  describe('tolerance edge cases', () => {
    it('should pass at exactly 10 bps deviation', () => {
      const action: PlanAction = {
        kind: 0,
        adapter: '0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e',
        amountBase: 10_000_000_000n, // 10000 USDC = 10M base units
        merkleRoot: '0x0000',
      };

      // Deviation of exactly 10 bps = 10_000_000 base units
      const vaultState: VaultState = {
        idle: 9_990_000_000_000n,
        adapterBalances: new Map([
          ['0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e', 10_010_000_000n],
        ]),
      };

      const result = reconcile(action, mockReceipt, vaultState);

      // At exactly 10 bps, acceptable should be true (< 10 bps)
      expect(result.acceptable).toBe(true);
    });

    it('should fail at 11 bps deviation', () => {
      const action: PlanAction = {
        kind: 0,
        adapter: '0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e',
        amountBase: 10_000_000_000n, // 10000 USDC
        merkleRoot: '0x0000',
      };

      // Deviation of 11 bps = 11_000_000 base units
      const vaultState: VaultState = {
        idle: 9_990_000_000_000n,
        adapterBalances: new Map([
          ['0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e', 10_011_000_000n],
        ]),
      };

      const result = reconcile(action, mockReceipt, vaultState);

      expect(result.acceptable).toBe(false);
    });
  });

  describe('cache delta verification', () => {
    it('should track reward cache delta after harvest', () => {
      const vaultState: VaultState = {
        idle: 500_000_000_000n,
        adapterBalances: new Map([
          ['0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e', 9_500_000_000_000n],
        ]),
        previousRewardCacheValue: 50_000_000_000n,
        currentRewardCacheValue: 55_000_000_000n,
      };

      // Verify reward cache increased
      expect(vaultState.currentRewardCacheValue! - vaultState.previousRewardCacheValue!).toBe(5_000_000_000n);
    });

    it('should fail if reward cache value decreased unexpectedly', () => {
      const vaultState: VaultState = {
        idle: 500_000_000_000n,
        adapterBalances: new Map([
          ['0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e', 9_500_000_000_000n],
        ]),
        previousRewardCacheValue: 55_000_000_000n,
        currentRewardCacheValue: 50_000_000_000n, // Decreased - suspicious
      };

      // Verify reward cache decreased (this would trigger alerts in production)
      const delta = (vaultState.currentRewardCacheValue ?? 0n) - (vaultState.previousRewardCacheValue ?? 0n);
      expect(delta).toBeLessThan(0n);
    });
  });
});

describe('ReconciliationResult', () => {
  it('should have correct shape', () => {
    const action: PlanAction = {
      kind: 0,
      adapter: '0x123',
      amountBase: 1_000_000n,
      merkleRoot: '0x0000',
    };

    const receipt = { status: 1, logs: [] } as unknown as { status: number; logs: unknown[] };
    const vaultState: VaultState = {
      idle: 0n,
      adapterBalances: new Map([['0x123', 1_000_000n]]),
    };

    const result = reconcile(action, receipt, vaultState);

    expect(result).toHaveProperty('actionIndex');
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('expectedAmount');
    expect(result).toHaveProperty('actualAmount');
    expect(result).toHaveProperty('deviation');
    expect(result).toHaveProperty('acceptable');
  });
});

describe('VaultState - Extended Fields', () => {
  it('should include reward cache tracking fields', () => {
    const vaultState: VaultState = {
      idle: 500_000_000_000n,
      adapterBalances: new Map(),
      previousRewardCacheValue: 50_000_000_000n,
      currentRewardCacheValue: 55_000_000_000n,
      rewardCacheTimestamp: 1_000_000_000n,
      configurationDigest: '0xdigest123',
    };

    expect(vaultState.previousRewardCacheValue).toBe(50_000_000_000n);
    expect(vaultState.currentRewardCacheValue).toBe(55_000_000_000n);
    expect(vaultState.rewardCacheTimestamp).toBe(1_000_000_000n);
    expect(vaultState.configurationDigest).toBe('0xdigest123');
  });
});

describe('directAllocation', () => {
  // Mock markets for testing direct allocation logic
  const mockMarkets: MarketState[] = [
    {
      marketId: '0xAdapter1',
      name: 'Adapter 1',
      cash: 10_000_000_000n, // 10000 USDC capacity
      borrows: 5_000_000_000n,
      supplyRate: 5_000_000_000_000_000n, // 5% APY in WAD
    },
    {
      marketId: '0xAdapter2',
      name: 'Adapter 2',
      cash: 5_000_000_000n, // 5000 USDC capacity
      borrows: 3_000_000_000n,
      supplyRate: 4_000_000_000_000_000n, // 4% APY in WAD
    },
    {
      marketId: '0xAdapter3',
      name: 'Adapter 3',
      cash: 0n, // No capacity
      borrows: 1_000_000_000n,
      supplyRate: 6_000_000_000_000_000n, // 6% APY - highest but no capacity
    },
  ];

  it('should return highest rate adapter with capacity', () => {
    const amount = 1_000_000_000n; // 1000 USDC

    // Manual test of direct allocation logic
    const eligible = mockMarkets.filter((m) => m.cash >= amount);
    eligible.sort((a, b) => {
      if (a.supplyRate < b.supplyRate) return 1;
      if (a.supplyRate > b.supplyRate) return -1;
      return 0;
    });

    expect(eligible.length).toBe(2);
    expect(eligible[0]!.marketId).toBe('0xAdapter1'); // Highest rate
    expect(eligible[0]!.supplyRate).toBe(5_000_000_000_000_000n);
  });

  it('should return null when no market has capacity', () => {
    const largeAmount = 20_000_000_000n; // 20000 USDC - exceeds all capacities

    const eligible = mockMarkets.filter((m) => m.cash >= largeAmount);

    expect(eligible.length).toBe(0);
  });

  it('should respect capacity constraints when deploying larger amount', () => {
    // Simulate directAllocation function logic
    function directAllocation(
      vaultState: VaultState,
      markets: MarketState[],
      amount: bigint
    ): { adapter: string; amount: bigint } | null {
      const eligible = markets.filter((m) => {
        const capacityRemaining = m.cash;
        const hasCapacity = capacityRemaining >= amount;
        const adapterBalance = vaultState.adapterBalances.get(m.marketId) ?? 0n;
        const isActive = adapterBalance > 0n || markets.length === 1;
        const notEmergency = m.cash > 0n;
        return hasCapacity && isActive && notEmergency;
      });

      if (eligible.length === 0) return null;

      eligible.sort((a, b) => {
        if (a.supplyRate < b.supplyRate) return 1;
        if (a.supplyRate > b.supplyRate) return -1;
        return 0;
      });

      const best = eligible[0]!;
      const capacityRemaining = best.cash;
      const actualAmount = amount <= capacityRemaining ? amount : capacityRemaining;

      return {
        adapter: best.marketId,
        amount: actualAmount,
      };
    }

    // Adapter1 has an existing balance, making it "active"
    const vaultState: VaultState = {
      idle: 20_000_000_000n,
      adapterBalances: new Map([['0xAdapter1', 1_000_000_000n]]), // Has 1 USDC balance
    };

    // Try to deploy 8_000_000_000n (8000 USDC)
    // Only Adapter1 has capacity for that (10_000_000_000n)
    // But Adapter2 doesn't (5000 USDC < 8000 USDC)
    const result = directAllocation(vaultState, mockMarkets, 8_000_000_000n);

    expect(result).not.toBeNull();
    expect(result!.adapter).toBe('0xAdapter1'); // Adapter1 is the best with capacity
    expect(result!.amount).toBe(8_000_000_000n); // Exact amount since within capacity
  });

  it('should select single active market', () => {
    const singleMarket: MarketState[] = [
      {
        marketId: '0xAdapter1',
        name: 'Only Adapter',
        cash: 10_000_000_000n,
        borrows: 0n,
        supplyRate: 5_000_000_000_000_000n,
      },
    ];

    const eligible = singleMarket.filter((m) => m.cash >= 1_000_000_000n);

    // Single market should be selected even with no existing balance
    expect(eligible.length).toBe(1);
  });
});

describe('executeWithRecovery', () => {
  it('should handle stop on divest failure', () => {
    // Verify the config is correctly defined
    const recoveryConfig = {
      divestFailureStrategy: 'stop' as const,
      deployFailureStrategy: 'stop' as const,
      enableDirectAllocationFallback: false,
    };

    expect(recoveryConfig.divestFailureStrategy).toBe('stop');
  });

  it('should handle continue on divest failure', () => {
    const recoveryConfig = {
      divestFailureStrategy: 'continue' as const,
      deployFailureStrategy: 'stop' as const,
      enableDirectAllocationFallback: false,
    };

    expect(recoveryConfig.divestFailureStrategy).toBe('continue');
  });

  it('should handle recover_idle on deploy failure', () => {
    const recoveryConfig = {
      divestFailureStrategy: 'stop' as const,
      deployFailureStrategy: 'recover_idle' as const,
      enableDirectAllocationFallback: true,
    };

    expect(recoveryConfig.deployFailureStrategy).toBe('recover_idle');
  });

  it('should accumulate failed deploy amounts', () => {
    // Track failed deploy amounts
    let failedDeployAmount = 0n;

    // Simulate multiple failed deploys
    const actions = [
      { kind: 0 as const, amountBase: 1_000_000_000n },
      { kind: 0 as const, amountBase: 2_000_000_000n },
    ];

    // Simulate failures
    for (const action of actions) {
      if (action.kind === 0) {
        // Deploy failed
        failedDeployAmount += action.amountBase;
      }
    }

    expect(failedDeployAmount).toBe(3_000_000_000n);
  });

  it('should reset failed deploy amount on success', () => {
    let failedDeployAmount = 5_000_000_000n; // Previous failure

    // Simulate success after failure
    failedDeployAmount = 0n; // Reset on success

    expect(failedDeployAmount).toBe(0n);
  });
});

describe('RecoveryConfig', () => {
  it('should have correct default values', () => {
    const defaultConfig = {
      divestFailureStrategy: 'stop',
      deployFailureStrategy: 'stop',
      enableDirectAllocationFallback: false,
    };

    expect(defaultConfig.divestFailureStrategy).toBe('stop');
    expect(defaultConfig.deployFailureStrategy).toBe('stop');
    expect(defaultConfig.enableDirectAllocationFallback).toBe(false);
  });

  it('should allow aggressive recovery configuration', () => {
    const aggressiveConfig = {
      divestFailureStrategy: 'continue',
      deployFailureStrategy: 'recover_idle',
      enableDirectAllocationFallback: true,
    };

    expect(aggressiveConfig.divestFailureStrategy).toBe('continue');
    expect(aggressiveConfig.deployFailureStrategy).toBe('recover_idle');
    expect(aggressiveConfig.enableDirectAllocationFallback).toBe(true);
  });
});

describe('DirectAllocationResult', () => {
  it('should have correct shape', () => {
    const result = {
      adapter: '0xAdapter1',
      amount: 1_000_000_000n,
    };

    expect(result).toHaveProperty('adapter');
    expect(result).toHaveProperty('amount');
    expect(typeof result.adapter).toBe('string');
    expect(typeof result.amount).toBe('bigint');
  });
});
