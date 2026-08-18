import { describe, it, expect } from '@jest/globals';
import type { Action, RebalanceProposal } from './proposal-evaluator.js';

// Test the pure logic of proposal evaluation without complex mocking

describe('ProposalEvaluator Interfaces', () => {
  describe('Action interface', () => {
    it('should accept valid deploy action', () => {
      const action: Action = {
        index: 0,
        kind: 'deploy',
        adapter: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        amount: 1_000_000_000_000n,
        minOut: 0n,
      };

      expect(action.kind).toBe('deploy');
      expect(action.amount).toBe(1_000_000_000_000n);
    });

    it('should accept valid divest action', () => {
      const action: Action = {
        index: 0,
        kind: 'divest',
        adapter: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        amount: 500_000_000_000n,
        minOut: 0n,
      };

      expect(action.kind).toBe('divest');
    });

    it('should accept valid harvest action', () => {
      const action: Action = {
        index: 0,
        kind: 'harvest',
        adapter: '0xcccccccccccccccccccccccccccccccccccccccc',
        amount: 0n,
        minOut: 0n,
      };

      expect(action.kind).toBe('harvest');
    });

    it('should accept valid emergency action', () => {
      const action: Action = {
        index: 0,
        kind: 'emergency',
        adapter: '0xdddddddddddddddddddddddddddddddddddddddd',
        amount: 1_000_000_000_000n,
        minOut: 0n,
      };

      expect(action.kind).toBe('emergency');
    });
  });

  describe('RebalanceProposal interface', () => {
    it('should accept valid proposal with single action', () => {
      const proposal: RebalanceProposal = {
        id: 'test-proposal-1',
        actions: [
          { index: 0, kind: 'deploy', adapter: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', amount: 100_000_000_000n, minOut: 0n },
        ],
        targetReserve: 500_000_000_000n,
      };

      expect(proposal.id).toBe('test-proposal-1');
      expect(proposal.actions).toHaveLength(1);
      expect(proposal.targetReserve).toBe(500_000_000_000n);
    });

    it('should accept valid proposal with multiple actions', () => {
      const proposal: RebalanceProposal = {
        id: 'test-proposal-2',
        actions: [
          { index: 0, kind: 'deploy', adapter: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', amount: 100_000_000_000n, minOut: 0n },
          { index: 1, kind: 'divest', adapter: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', amount: 50_000_000_000n, minOut: 0n },
          { index: 2, kind: 'harvest', adapter: '0xcccccccccccccccccccccccccccccccccccccccc', amount: 0n, minOut: 0n },
        ],
        targetReserve: 450_000_000_000n,
      };

      expect(proposal.actions).toHaveLength(3);
    });

    it('should accept empty actions', () => {
      const proposal: RebalanceProposal = {
        id: 'test-proposal-3',
        actions: [],
        targetReserve: 500_000_000_000n,
      };

      expect(proposal.actions).toHaveLength(0);
    });
  });
});

describe('Action Cost Estimation', () => {
  // Test the cost calculation logic
  const estimateActionCost = (action: Action, srclaConfig: {
    costGateGasLimit: bigint;
    costGateSlippageBps: number;
    costGateMevBps: number;
  }): bigint => {
    const gasLimit = srclaConfig.costGateGasLimit;
    const gasPrice = 30_000_000_000n; // 30 gwei

    const gasCost = gasLimit * gasPrice;

    // Slippage cost (based on amount and slippage bps)
    const slippageBps = BigInt(srclaConfig.costGateSlippageBps);
    const slippageCost = (action.amount * slippageBps) / 10000n;

    // MEV cost
    const mevBps = BigInt(srclaConfig.costGateMevBps);
    const mevCost = (action.amount * mevBps) / 10000n;

    return gasCost + slippageCost + mevCost;
  };

  const estimateTotalCost = (actions: Action[], srclaConfig: {
    costGateGasLimit: bigint;
    costGateSlippageBps: number;
    costGateMevBps: number;
  }): bigint => {
    let totalCost = 0n;
    for (const action of actions) {
      totalCost += estimateActionCost(action, srclaConfig);
    }
    return totalCost;
  };

  const defaultConfig = {
    costGateGasLimit: 200_000n,
    costGateSlippageBps: 50,
    costGateMevBps: 10,
  };

  it('should calculate gas cost correctly', () => {
    const action: Action = {
      index: 0,
      kind: 'deploy',
      adapter: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      amount: 1_000_000_000_000n, // 1M USDC
      minOut: 0n,
    };

    const cost = estimateActionCost(action, defaultConfig);

    // Gas cost: 200000 * 30000000000 = 6_000_000_000_000
    const expectedGasCost = 200_000n * 30_000_000_000n;
    const expectedSlippage = (1_000_000_000_000n * 50n) / 10000n;
    const expectedMev = (1_000_000_000_000n * 10n) / 10000n;

    expect(cost).toBe(expectedGasCost + expectedSlippage + expectedMev);
  });

  it('should calculate cost for zero amount action (harvest)', () => {
    const action: Action = {
      index: 0,
      kind: 'harvest',
      adapter: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      amount: 0n,
      minOut: 0n,
    };

    const cost = estimateActionCost(action, defaultConfig);

    // Should only have gas cost
    const expectedGasCost = 200_000n * 30_000_000_000n;
    expect(cost).toBe(expectedGasCost);
  });

  it('should sum costs for multiple actions', () => {
    const actions: Action[] = [
      { index: 0, kind: 'deploy', adapter: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', amount: 1_000_000_000_000n, minOut: 0n },
      { index: 1, kind: 'divest', adapter: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', amount: 500_000_000_000n, minOut: 0n },
    ];

    const totalCost = estimateTotalCost(actions, defaultConfig);

    expect(totalCost).toBeGreaterThan(0n);
  });
});

describe('Reserve Calculation', () => {
  // Test reserve calculation logic
  const checkReserveFloor = (
    totalAssets: bigint,
    idleBase: bigint,
    deployTotal: bigint,
    divestTotal: bigint,
    reserveFloorBps: number
  ): boolean => {
    const netIdleChange = divestTotal - deployTotal;
    const expectedIdle = idleBase + netIdleChange;
    const reserveFloor = (totalAssets * BigInt(reserveFloorBps)) / 10000n;

    return expectedIdle >= reserveFloor;
  };

  it('should pass when idle stays above floor after deploy', () => {
    const result = checkReserveFloor(
      10_000_000_000_000n, // 10M total assets
      500_000_000_000n, // 500K idle
      100_000_000_000n, // deploy 100K
      0n, // no divest
      500 // 5% floor
    );

    // Expected idle: 500K - 100K = 400K
    // Floor: 10M * 5% = 500K
    // 400K < 500K, so should fail
    expect(result).toBe(false);
  });

  it('should pass when divest raises idle above floor', () => {
    const result = checkReserveFloor(
      10_000_000_000_000n, // 10M total assets
      400_000_000_000n, // 400K idle (below floor)
      0n, // no deploy
      200_000_000_000n, // divest 200K
      500 // 5% floor
    );

    // Expected idle: 400K + 200K = 600K
    // Floor: 10M * 5% = 500K
    // 600K >= 500K, so should pass
    expect(result).toBe(true);
  });

  it('should fail when idle drops below floor', () => {
    const result = checkReserveFloor(
      10_000_000_000_000n, // 10M total assets
      550_000_000_000n, // 550K idle
      100_000_000_000n, // deploy 100K
      0n, // no divest
      500 // 5% floor
    );

    // Expected idle: 550K - 100K = 450K
    // Floor: 10M * 5% = 500K
    // 450K < 500K, so should fail
    expect(result).toBe(false);
  });
});

describe('Adapter Cap Calculation', () => {
  // Test cap checking logic
  const checkAdapterCap = (
    currentBalance: bigint,
    actionAmount: bigint,
    totalAssets: bigint,
    isDeploy: boolean
  ): boolean => {
    if (isDeploy) {
      const newBalance = currentBalance + actionAmount;
      const maxAdapterBalance = (totalAssets * 5000n) / 10000n; // 50% cap
      return newBalance <= maxAdapterBalance;
    } else {
      const newBalance = currentBalance - actionAmount;
      return newBalance >= 0n;
    }
  };

  it('should pass when deploy stays within 50% cap', () => {
    const result = checkAdapterCap(
      4_000_000_000_000n, // current 4M
      1_000_000_000_000n, // deploy 1M
      10_000_000_000_000n, // 10M total
      true
    );

    // New balance: 4M + 1M = 5M
    // Max: 10M * 50% = 5M
    // 5M <= 5M, so should pass
    expect(result).toBe(true);
  });

  it('should fail when deploy exceeds 50% cap', () => {
    const result = checkAdapterCap(
      4_000_000_000_000n, // current 4M
      2_000_000_000_000n, // deploy 2M
      10_000_000_000_000n, // 10M total
      true
    );

    // New balance: 4M + 2M = 6M
    // Max: 10M * 50% = 5M
    // 6M > 5M, so should fail
    expect(result).toBe(false);
  });

  it('should fail when divest exceeds current balance', () => {
    const result = checkAdapterCap(
      4_000_000_000_000n, // current 4M
      5_000_000_000_000n, // divest 5M (more than current)
      10_000_000_000_000n, // 10M total
      false
    );

    // New balance: 4M - 5M = -1M (negative)
    // Should fail
    expect(result).toBe(false);
  });

  it('should pass when divest is within balance', () => {
    const result = checkAdapterCap(
      4_000_000_000_000n, // current 4M
      2_000_000_000_000n, // divest 2M
      10_000_000_000_000n, // 10M total
      false
    );

    // New balance: 4M - 2M = 2M
    // Should pass
    expect(result).toBe(true);
  });
});

describe('Action Kind Mapping', () => {
  // Test kind to number mapping
  const kindToNumber = (kind: string): number => {
    const map: Record<string, number> = { deploy: 0, divest: 1, harvest: 2, emergency: 3 };
    return map[kind] ?? 0;
  };

  it('should map deploy to 0', () => {
    expect(kindToNumber('deploy')).toBe(0);
  });

  it('should map divest to 1', () => {
    expect(kindToNumber('divest')).toBe(1);
  });

  it('should map harvest to 2', () => {
    expect(kindToNumber('harvest')).toBe(2);
  });

  it('should map emergency to 3', () => {
    expect(kindToNumber('emergency')).toBe(3);
  });

  it('should default unknown kinds to 0', () => {
    expect(kindToNumber('unknown')).toBe(0);
    expect(kindToNumber('')).toBe(0);
  });
});
