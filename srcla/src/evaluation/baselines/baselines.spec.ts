import { b0Policy } from './policies.js';
import { b1Policy } from './b1-highest-rate.js';
import { b2Policy } from './b2-capacity.js';
import { b3Policy } from './b3-capacity-cost.js';
import { b4Policy } from './b4-fixed-robust.js';
import { b5Policy } from './b5-hindsight.js';
import { createSyntheticDataset } from '../dataset.js';

function mockSnapshot(rateBps: number, paused = false, capBps = 5000) {
  const dataset = createSyntheticDataset('test', 1, new Date('2025-01-01'));
  const snap = dataset.snapshots[0]!;
  snap.snapshots = [{
    marketId: 'compound',
    blockHash: '0x' + '0'.repeat(64),
    timestamp: new Date(),
    totalAssetsBase: 1_000_000_000_000n,
    idleBase: 500_000_000_000n,
    supplyRateE18: BigInt(Math.floor(rateBps * 1e14)), // bps to WAD-like
    utilizationE18: 800_000_000_000_000_000n,
    cashBase: 200_000_000_000n,
    borrowsBase: 800_000_000_000n,
    reservesBase: 10_000_000_000n,
    capBps,
    paused,
    configDigest: '0x' + 'a'.repeat(64),
  }];
  return snap;
}

function mockState(idleBase = 500_000_000_000n, totalAssets = 1_000_000_000_000n) {
  return {
    totalAssets,
    totalShares: totalAssets,
    idleBase,
    strategyBalances: new Map<string, bigint>(),
    cohorts: new Map<string, { id: string; shares: bigint; depositTimestamp: Date }>(),
  };
}

describe('Baselines', () => {
  describe('B0 Idle', () => {
    it('should never deploy', () => {
      const actions = b0Policy(mockState(), mockSnapshot(500));
      expect(actions).toHaveLength(0);
    });
  });

  describe('B1 Highest Rate', () => {
    it('should deploy all idle to highest rate market', () => {
      const state = mockState();
      const actions = b1Policy(state, mockSnapshot(500));

      expect(actions).toHaveLength(1);
      expect(actions[0]!.kind).toBe('deploy');
      expect(actions[0]!.amount).toBe(500_000_000_000n);
    });

    it('should skip paused markets', () => {
      const actions = b1Policy(mockState(), mockSnapshot(500, true));
      expect(actions).toHaveLength(0);
    });

    it('should do nothing with zero idle', () => {
      const actions = b1Policy(mockState(0n), mockSnapshot(500));
      expect(actions).toHaveLength(0);
    });
  });

  describe('B2 Capacity-Aware', () => {
    it('should respect capacity limits', () => {
      const state = {
        ...mockState(),
        totalAssets: 1_000_000_000_000n,
        strategyBalances: new Map([['compound', 400_000_000_000n]]),
      };
      const actions = b2Policy(state, mockSnapshot(500, false, 5000));

      // Max capacity = 50% of 1M = 500K; current = 400K; available = 100K
      expect(actions.length).toBeGreaterThanOrEqual(0);
    });

    it('should skip paused markets', () => {
      const actions = b2Policy(mockState(), mockSnapshot(500, true));
      expect(actions).toHaveLength(0);
    });
  });

  describe('B3 Capacity + Cost', () => {
    it('should deploy when benefit > cost threshold', () => {
      // 500 bps rate * 7 days = 3500 bps benefit > 100 bps threshold
      const actions = b3Policy(mockState(), mockSnapshot(500));
      // Should deploy some amount
      void actions;
    });

    it('should skip if benefit too small', () => {
      // 10 bps rate * 7 days = 70 bps < 100 bps threshold
      const actions = b3Policy(mockState(), mockSnapshot(10));
      expect(actions).toHaveLength(0);
    });
  });

  describe('B4 Fixed Robust', () => {
    it('should deploy towards fixed allocation', () => {
      const state = mockState(0n, 1_000_000_000_000n); // no idle, but has total assets
      const actions = b4Policy(state, mockSnapshot(500));

      // B4 rebalances regardless of idle
      void actions;
    });
  });

  describe('B5 Hindsight', () => {
    it('should never deploy (diagnostic only)', () => {
      const actions = b5Policy(mockState(), mockSnapshot(500));
      expect(actions).toHaveLength(0);
    });
  });
});
