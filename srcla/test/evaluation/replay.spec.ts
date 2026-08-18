import { VaultReplay } from '../../src/evaluation/replay/erc4626.js';
import { createSyntheticDataset, createEmptyDataset, splitDataset } from '../../src/evaluation/dataset.js';

function makeReplay(): VaultReplay {
  return new VaultReplay(1_000_000_000_000n); // 1M USDC (6 decimals)
}

describe('VaultReplay', () => {
  describe('initialization', () => {
    it('should start with 1:1 share price', () => {
      const replay = makeReplay();
      expect(replay.currentSharePrice()).toBe(1_000_000_000_000_000_000n); // WAD
    });

    it('should track total assets', () => {
      const replay = makeReplay();
      expect(replay.getState().totalAssets).toBe(1_000_000_000_000n);
    });
  });

  describe('deposit', () => {
    it('should mint shares 1:1 at inception', () => {
      const replay = makeReplay();
      const shares = replay.deposit(500_000_000_000n, 'cohort-1');
      expect(shares).toBe(500_000_000_000n);
      expect(replay.getState().totalAssets).toBe(1_500_000_000_000n);
    });

    it('should track cohort', () => {
      const replay = makeReplay();
      replay.deposit(100_000_000_000n, 'cohort-1');
      const cohort = replay.getCohort('cohort-1');
      expect(cohort).toBeDefined();
      expect(cohort!.shares).toBe(100_000_000_000n);
    });

    it('should update idle balance', () => {
      const replay = makeReplay();
      replay.deposit(200_000_000_000n, 'cohort-1');
      expect(replay.getState().idleBase).toBe(1_200_000_000_000n);
    });
  });

  describe('deploy/divest', () => {
    it('should deploy idle to strategy', () => {
      const replay = makeReplay();
      // idle = 1M already from constructor
      replay.deploy('compound', 500_000_000_000n);

      const state = replay.getState();
      expect(state.idleBase).toBe(500_000_000_000n);
      expect(state.strategyBalances.get('compound')).toBe(500_000_000_000n);
    });

    it('should divest from strategy', () => {
      const replay = makeReplay();
      replay.deploy('compound', 500_000_000_000n);
      const returned = replay.divest('compound', 200_000_000_000n);

      expect(returned).toBe(200_000_000_000n);
      expect(replay.getState().idleBase).toBe(700_000_000_000n);
    });

    it('should revert on insufficient idle', () => {
      const replay = makeReplay();
      // Constructor already deposited 1M as initial; idle is 1M
      // Try to deploy 1.5M — should throw
      expect(() => replay.deploy('compound', 1_500_000_000_000n)).toThrow('Insufficient idle');
    });
  });

  describe('redeem', () => {
    it('should redeem shares at current price', () => {
      const replay = makeReplay();
      replay.deposit(1_000_000_000_000n, 'cohort-1');

      // Earn 10% yield
      replay.addYield(100_000_000_000n);
      const assets = replay.redeem('cohort-1', 500_000_000_000n);

      // Should get ~550 USDC (10% gain on 500 shares)
      expect(assets).toBeGreaterThan(500_000_000_000n);
      expect(assets).toBeLessThan(600_000_000_000n);
    });

    it('should apply slippage', () => {
      const replay = makeReplay();
      replay.deposit(1_000_000_000_000n, 'cohort-1');
      replay.addYield(100_000_000_000n);

      const assetsWithSlip = replay.redeem('cohort-1', 500_000_000_000n, { slippageBps: 50n });
      const assetsNoSlip = replay.redeem('cohort-1', 500_000_000_000n);

      expect(assetsWithSlip).toBeLessThan(assetsNoSlip);
    });
  });

  describe('addYield', () => {
    it('should increase total assets', () => {
      const replay = makeReplay();
      replay.addYield(50_000_000_000n); // 5% yield
      expect(replay.getState().totalAssets).toBe(1_050_000_000_000n);
    });
  });

  describe('share price after yield', () => {
    it('should increase share price after yield', () => {
      const replay = makeReplay();
      const initialPrice = replay.currentSharePrice();

      replay.addYield(50_000_000_000n); // 5% yield
      const newPrice = replay.currentSharePrice();

      expect(newPrice).toBeGreaterThan(initialPrice);
    });
  });
});

describe('splitDataset', () => {
  it('should split at 70%', () => {
    const dataset = createSyntheticDataset('test', 10, new Date('2025-01-01'));
    const { calibration, evaluation } = splitDataset(dataset, 0.7);

    expect(calibration.snapshots.length).toBe(7);
    expect(evaluation.snapshots.length).toBe(3);
  });

  it('should handle empty dataset', () => {
    const empty = createEmptyDataset('test');
    const { calibration, evaluation } = splitDataset(empty, 0.7);

    expect(calibration.snapshots.length).toBe(0);
    expect(evaluation.snapshots.length).toBe(0);
  });
});
