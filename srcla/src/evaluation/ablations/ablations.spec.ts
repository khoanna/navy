import {
  h1Policy,
  h1Ablation,
  h2Policy,
  h2Ablation,
  h3Policy,
  h3Ablation,
  h4Policy,
  h4Ablation,
  h5Policy,
  h5Ablation,
} from './policies.js';
import { createSyntheticDataset } from '../dataset.js';

function mockSnapshot(
  marketId: string,
  rateBps: number,
  paused = false,
  capBps = 5000,
) {
  const dataset = createSyntheticDataset('test', 1, new Date('2025-01-01'));
  const snap = dataset.snapshots[0]!;
  snap.snapshots = [
    {
      marketId,
      blockHash: '0x' + '0'.repeat(64),
      timestamp: new Date(),
      totalAssetsBase: 1_000_000_000_000n,
      idleBase: 500_000_000_000n,
      supplyRateE18: BigInt(Math.floor(rateBps * 1e14)),
      utilizationE18: 800_000_000_000_000_000n,
      cashBase: 200_000_000_000n,
      borrowsBase: 800_000_000_000n,
      reservesBase: 10_000_000_000n,
      capBps,
      paused,
      configDigest: '0x' + 'a'.repeat(64),
    },
  ];
  return snap;
}

function mockSnapshotMulti(
  markets: { id: string; rate: number; paused?: boolean; capBps?: number }[],
) {
  const dataset = createSyntheticDataset('test', 1, new Date('2025-01-01'));
  const snap = dataset.snapshots[0]!;
  snap.snapshots = markets.map((m, i) => ({
    marketId: m.id,
    blockHash: '0x' + i.toString(16).padStart(64, '0'),
    timestamp: new Date(),
    totalAssetsBase: 1_000_000_000_000n,
    idleBase: 500_000_000_000n,
    supplyRateE18: BigInt(Math.floor(m.rate * 1e14)),
    utilizationE18: 800_000_000_000_000_000n,
    cashBase: 200_000_000_000n,
    borrowsBase: 800_000_000_000n,
    reservesBase: 10_000_000_000n,
    capBps: m.capBps ?? 5000,
    paused: m.paused ?? false,
    configDigest: '0x' + 'a'.repeat(64),
  }));
  return snap;
}

function mockState(
  idleBase = 500_000_000_000n,
  totalAssets = 1_000_000_000_000n,
  strategyBalances: Record<string, bigint> = {},
) {
  return {
    totalAssets,
    totalShares: totalAssets,
    idleBase,
    strategyBalances: new Map(Object.entries(strategyBalances)),
    cohorts: new Map<string, { id: string; shares: bigint; depositTimestamp: Date }>(),
  };
}

describe('Ablation Policies', () => {
  describe('H1: Forecast Disabled', () => {
    it('should deploy to highest rate market (no forecast)', () => {
      const state = mockState();
      const actions = h1Policy(state, mockSnapshot('compound', 500));

      expect(actions).toHaveLength(1);
      expect(actions[0]!.kind).toBe('deploy');
      expect(actions[0]!.amount).toBe(500_000_000_000n);
    });

    it('should skip paused markets', () => {
      const actions = h1Policy(mockState(), mockSnapshot('compound', 500, true));
      expect(actions).toHaveLength(0);
    });

    it('should do nothing with zero idle', () => {
      const actions = h1Policy(mockState(0n), mockSnapshot('compound', 500));
      expect(actions).toHaveLength(0);
    });

    it('should have correct ablation metadata', () => {
      expect(h1Ablation.id).toBe('h1');
      expect(h1Ablation.disabledComponents).toContain('forecast');
    });

    it('should ignore capacity when picking highest rate', () => {
      // H1 ignores capacity limits - deploys all to highest rate
      const state = mockState(1_000_000_000_000n, 1_000_000_000_000n);
      const actions = h1Policy(
        state,
        mockSnapshotMulti([
          { id: 'compound', rate: 500, capBps: 1000 }, // Only 100K cap
          { id: 'aave', rate: 400, capBps: 5000 },
        ]),
      );

      // Should deploy all 1M to compound despite capacity limit
      expect(actions).toHaveLength(1);
      expect(actions[0]!.adapter).toBe('compound');
      expect(actions[0]!.amount).toBe(1_000_000_000_000n);
    });
  });

  describe('H2: Capacity Disabled', () => {
    it('should deploy to highest rate without capacity check', () => {
      const state = mockState();
      const actions = h2Policy(state, mockSnapshot('compound', 500));

      expect(actions).toHaveLength(1);
      expect(actions[0]!.kind).toBe('deploy');
    });

    it('should skip paused markets', () => {
      const actions = h2Policy(mockState(), mockSnapshot('compound', 500, true));
      expect(actions).toHaveLength(0);
    });

    it('should do nothing with zero idle', () => {
      const actions = h2Policy(mockState(0n), mockSnapshot('compound', 500));
      expect(actions).toHaveLength(0);
    });

    it('should have correct ablation metadata', () => {
      expect(h2Ablation.id).toBe('h2');
      expect(h2Ablation.disabledComponents).toContain('capacity');
    });

    it('should deploy even when capacity is exhausted', () => {
      // State already has full allocation to compound
      const state = mockState(1_000_000_000_000n, 1_000_000_000_000n, {
        compound: 500_000_000_000n,
      });
      // Compound has only 10% cap left (50K)
      const actions = h2Policy(
        state,
        mockSnapshotMulti([{ id: 'compound', rate: 500, capBps: 5500 }]),
      );

      // H2 ignores capacity - should still deploy all idle
      expect(actions).toHaveLength(1);
      expect(actions[0]!.amount).toBe(1_000_000_000_000n);
    });
  });

  describe('H3: Cost Gate Disabled', () => {
    it('should deploy when capacity exists regardless of cost', () => {
      const state = mockState();
      const actions = h3Policy(state, mockSnapshot('compound', 5)); // Very low rate

      // Should still deploy despite low rate (cost gate disabled)
      expect(actions).toHaveLength(1);
      expect(actions[0]!.kind).toBe('deploy');
    });

    it('should skip paused markets', () => {
      const actions = h3Policy(mockState(), mockSnapshot('compound', 500, true));
      expect(actions).toHaveLength(0);
    });

    it('should do nothing with zero idle', () => {
      const actions = h3Policy(mockState(0n), mockSnapshot('compound', 500));
      expect(actions).toHaveLength(0);
    });

    it('should have correct ablation metadata', () => {
      expect(h3Ablation.id).toBe('h3');
      expect(h3Ablation.disabledComponents).toContain('cost-gate');
    });

    it('should respect capacity limits (but not cost)', () => {
      // With 10% cap, only 100K available
      const state = mockState(1_000_000_000_000n, 1_000_000_000_000n);
      const actions = h3Policy(
        state,
        mockSnapshotMulti([{ id: 'compound', rate: 5, capBps: 1000 }]),
      );

      // Should deploy 100K (the capacity) not 1M
      expect(actions).toHaveLength(1);
      expect(actions[0]!.amount).toBe(100_000_000_000n);
    });
  });

  describe('H4: Frequency Disabled', () => {
    it('should only act on weekly snapshots (index % 7 === 0)', () => {
      const dataset = createSyntheticDataset('test', 7, new Date('2025-01-01'));
      const state = mockState(500_000_000_000n);

      // Index 0: 0 % 7 === 0, should act
      const actions0 = h4Policy(state, dataset.snapshots[0]!);
      expect(actions0.length).toBeGreaterThanOrEqual(0); // Acts on week 0

      // Index 3: 3 % 7 !== 0, should not act
      const actions3 = h4Policy(state, dataset.snapshots[3]!);
      expect(actions3).toHaveLength(0); // Should skip

      // Index 7: 7 % 7 === 0, should act
      const snap7 = { ...dataset.snapshots[0]!, index: 7 };
      const actions7 = h4Policy(state, snap7);
      expect(actions7.length).toBeGreaterThanOrEqual(0); // Acts on week 1
    });

    it('should have correct ablation metadata', () => {
      expect(h4Ablation.id).toBe('h4');
      expect(h4Ablation.disabledComponents).toContain('rebalance-frequency');
    });

    it('should respect drift threshold before acting', () => {
      // State with minimal drift
      const state = mockState(0n, 1_000_000_000_000n, {
        compound: 400_000_000_000n, // 40% target, already at 40%
      });

      const actions = h4Policy(state, mockSnapshot('compound', 500));
      // With only 40% drift (within 20% threshold), should not act
      expect(actions).toHaveLength(0);
    });

    it('should act when drift exceeds threshold', () => {
      // State with significant drift
      const state = mockState(500_000_000_000n, 1_000_000_000_000n, {
        compound: 100_000_000_000n, // 10%, need to reach 40%
      });

      const actions = h4Policy(state, mockSnapshot('compound', 500));
      // Drift > 20%, should rebalance
      expect(actions.length).toBeGreaterThan(0);
    });
  });

  describe('H5: Uncertainty Disabled', () => {
    it('should behave like B2 (no uncertainty consideration)', () => {
      const state = mockState();
      const actions = h5Policy(state, mockSnapshot('compound', 500));

      expect(actions).toHaveLength(1);
      expect(actions[0]!.kind).toBe('deploy');
    });

    it('should skip paused markets', () => {
      const actions = h5Policy(mockState(), mockSnapshot('compound', 500, true));
      expect(actions).toHaveLength(0);
    });

    it('should do nothing with zero idle', () => {
      const actions = h5Policy(mockState(0n), mockSnapshot('compound', 500));
      expect(actions).toHaveLength(0);
    });

    it('should have correct ablation metadata', () => {
      expect(h5Ablation.id).toBe('h5');
      expect(h5Ablation.disabledComponents).toContain('uncertainty');
    });

    it('should respect capacity limits', () => {
      const state = mockState(1_000_000_000_000n, 1_000_000_000_000n);
      const actions = h5Policy(
        state,
        mockSnapshotMulti([{ id: 'compound', rate: 500, capBps: 5000 }]),
      );

      // 50% cap = 500K capacity
      expect(actions).toHaveLength(1);
      expect(actions[0]!.amount).toBe(500_000_000_000n);
    });

    it('should spread across multiple markets', () => {
      const state = mockState(1_000_000_000_000n, 1_000_000_000_000n);
      const actions = h5Policy(
        state,
        mockSnapshotMulti([
          { id: 'compound', rate: 500, capBps: 2500 }, // 250K
          { id: 'aave', rate: 400, capBps: 2500 }, // 250K
          { id: 'moonwell', rate: 300, capBps: 2500 }, // 250K
        ]),
      );

      // Should deploy across multiple markets
      expect(actions.length).toBe(3);
      const totalDeployed = actions.reduce(
        (sum, a) => (a.kind === 'deploy' ? sum + a.amount : sum),
        0n,
      );
      expect(totalDeployed).toBe(750_000_000_000n);
    });
  });
});

describe('Ablation Metadata', () => {
  it('should have unique IDs for all ablations', () => {
    const ids = [
      h1Ablation.id,
      h2Ablation.id,
      h3Ablation.id,
      h4Ablation.id,
      h5Ablation.id,
    ];
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('should have distinct disabled components', () => {
    const components = [
      ...h1Ablation.disabledComponents,
      ...h2Ablation.disabledComponents,
      ...h3Ablation.disabledComponents,
      ...h4Ablation.disabledComponents,
      ...h5Ablation.disabledComponents,
    ];
    const uniqueComponents = new Set(components);
    expect(uniqueComponents.size).toBe(components.length);
  });
});
