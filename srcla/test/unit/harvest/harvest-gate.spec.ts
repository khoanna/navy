import { describe, it, expect } from '@jest/globals';
import {
  evaluateHarvest,
  HarvestTrigger,
  HarvestGateConfig,
  DEFAULT_HARVEST_CONFIG,
} from '../../../src/harvest/harvest-gate.js';

describe('evaluateHarvest', () => {
  const defaultConfig = DEFAULT_HARVEST_CONFIG;

  // Standard gas and price parameters for testing
  // Using realistic Base values: ~10 gwei L2, $2,000 ETH
  const l2GasPrice = 10_000_000_000n;      // 10 gwei (Base typical)
  const l1GasPrice = 1_000_000_000n;       // 1 gwei L1
  const ethPriceUsdc = 2_000_000_000n;     // $2000 ETH (8 decimals)
  const poolLiquidity = 10_000_000_000_000n; // 10M liquidity (6 decimals)

  describe('should harvest when profitable', () => {
    it('should harvest when net gain exceeds minimum threshold', () => {
      // L2 cost = (150k * 10e9 * 2e9) / 1e18 = ~$3 USDC
      // With 100 USDC rewards, net gain is ~$97 - clearly profitable
      const result = evaluateHarvest(
        100_000_000n,  // 100 USDC rewards
        100_000n,      // claim gas
        50_000n,       // swap gas
        l2GasPrice,
        l1GasPrice,
        ethPriceUsdc,
        poolLiquidity,
        [HarvestTrigger.THRESHOLD],
        defaultConfig
      );

      expect(result.shouldHarvest).toBe(true);
      expect(result.netGain).toBeGreaterThan(0n);
      expect(result.reason).toBe('PROFITABLE');
      expect(result.claimableValue).toBe(100_000_000n);
    });

    it('should calculate correct net gain', () => {
      const result = evaluateHarvest(
        1_000_000n,   // 1 USDC rewards - below $1 min
        100_000n,
        50_000n,
        l2GasPrice,
        l1GasPrice,
        ethPriceUsdc,
        poolLiquidity,
        [],
        defaultConfig
      );

      expect(result.shouldHarvest).toBe(false); // Not above $1 min
      expect(result.totalCost).toBeGreaterThan(0n);
      expect(result.netGain).toBe(0n);
    });
  });

  describe('should not harvest when unprofitable', () => {
    it('should not harvest when rewards below minimum', () => {
      const result = evaluateHarvest(
        100_000n,    // 0.1 USDC rewards (below $1 min)
        200_000n,
        150_000n,
        l2GasPrice,
        l1GasPrice,
        ethPriceUsdc,
        poolLiquidity,
        [],
        defaultConfig
      );

      expect(result.shouldHarvest).toBe(false);
      expect(result.reason).toBe('NOT_PROFITABLE');
      expect(result.netGain).toBe(0n);
    });

    it('should not harvest when costs exceed rewards', () => {
      const result = evaluateHarvest(
        500_000n,    // 0.5 USDC
        500_000n,    // Very high claim gas
        500_000n,    // Very high swap gas
        l2GasPrice,
        l1GasPrice,
        ethPriceUsdc,
        poolLiquidity,
        [],
        defaultConfig
      );

      expect(result.shouldHarvest).toBe(false);
      expect(result.reason).toBe('NOT_PROFITABLE');
    });
  });

  describe('trigger handling', () => {
    it('should trigger on EXPIRY even if marginally profitable', () => {
      // With EXPIRY trigger, harvest if rewards > totalCost / 2
      // Use higher gas so netGain < minHarvestValue but rewards > half costs
      const result = evaluateHarvest(
        1_500_000n, // 1.5 USDC - low enough that netGain < minHarvestValue
        50_000n,     // Low claim gas
        30_000n,     // Low swap gas
        l2GasPrice,
        l1GasPrice,
        ethPriceUsdc,
        poolLiquidity,
        [HarvestTrigger.EXPIRY],
        defaultConfig
      );

      // EXPIRY trigger fires if rewards > half costs
      expect(result.shouldHarvest).toBe(true);
      expect(result.triggers).toContain(HarvestTrigger.EXPIRY);
      expect(result.reason).toBe('TRIGGERED_EXPIRY');
    });

    it('should trigger on EMISSION when rewards cover costs', () => {
      // EMISSION triggers if rewards > total cost
      // Use higher rewards so it's covers costs but not PROFITABLE (netGain < min)
      const result = evaluateHarvest(
        2_000_000n, // 2 USDC - covers costs but netGain < minHarvestValue
        50_000n,      // Low gas
        30_000n,      // Low gas
        l2GasPrice,
        l1GasPrice,
        ethPriceUsdc,
        poolLiquidity,
        [HarvestTrigger.EMISSION],
        defaultConfig
      );

      expect(result.shouldHarvest).toBe(true);
      expect(result.triggers).toContain(HarvestTrigger.EMISSION);
      expect(result.reason).toBe('TRIGGERED_EMISSION');
    });

    it('should trigger on ROUTE for better swap paths', () => {
      const result = evaluateHarvest(
        10_000_000n, // 10 USDC
        50_000n,
        30_000n,
        l2GasPrice,
        l1GasPrice,
        ethPriceUsdc,
        poolLiquidity,
        [HarvestTrigger.ROUTE],
        defaultConfig
      );

      // ROUTE trigger alone doesn't guarantee harvest without profitability
      expect(result.triggers).toContain(HarvestTrigger.ROUTE);
    });

    it('should handle multiple triggers', () => {
      // Low gas costs so any reasonable amount triggers
      const result = evaluateHarvest(
        10_000_000n, // 10 USDC
        50_000n,
        30_000n,
        l2GasPrice,
        l1GasPrice,
        ethPriceUsdc,
        poolLiquidity,
        [HarvestTrigger.EXPIRY, HarvestTrigger.EMISSION],
        defaultConfig
      );

      expect(result.shouldHarvest).toBe(true);
      expect(result.triggers).toContain(HarvestTrigger.EXPIRY);
      expect(result.triggers).toContain(HarvestTrigger.EMISSION);
    });
  });

  describe('cost calculations', () => {
    it('should calculate L2 gas cost correctly', () => {
      const result = evaluateHarvest(
        100_000_000n, // 100 USDC
        200_000n,     // claim gas
        150_000n,     // swap gas
        l2GasPrice,
        l1GasPrice,
        ethPriceUsdc,
        poolLiquidity,
        [],
        defaultConfig
      );

      expect(result.totalCost).toBeGreaterThan(0n);
      // L2 cost = (350k * 10e9 * 2e9) / 1e18 = $7 USDC
      expect(result.totalCost).toBeLessThan(10_000_000n); // Less than $10
    });

    it('should include L1 data cost for L2 rollups', () => {
      // With high L1 gas price
      const result1 = evaluateHarvest(
        100_000_000n,
        200_000n,
        150_000n,
        l2GasPrice,
        50_000_000_000n, // 50 gwei L1
        ethPriceUsdc,
        poolLiquidity,
        [],
        defaultConfig
      );

      const result2 = evaluateHarvest(
        100_000_000n,
        200_000n,
        150_000n,
        l2GasPrice,
        1_000_000_000n, // 1 gwei L1 (cheaper)
        ethPriceUsdc,
        poolLiquidity,
        [],
        defaultConfig
      );

      // Higher L1 price should result in higher total cost
      expect(result1.totalCost).toBeGreaterThan(result2.totalCost);
    });

    it('should include market impact cost', () => {
      // Small pool = high impact
      const smallPool = 1_000_000n; // 1 USDC pool

      const result = evaluateHarvest(
        100_000_000n, // 100 USDC - large relative to pool
        100_000n,
        50_000n,
        l2GasPrice,
        l1GasPrice,
        ethPriceUsdc,
        smallPool,
        [],
        defaultConfig
      );

      // Impact should be significant for small pool
      expect(result.totalCost).toBeGreaterThan(0n);
    });

    it('should have minimal market impact on large pools', () => {
      const hugePool = 1_000_000_000_000_000n; // 1B pool

      const result = evaluateHarvest(
        100_000_000n, // 100 USDC
        100_000n,
        50_000n,
        l2GasPrice,
        l1GasPrice,
        ethPriceUsdc,
        hugePool,
        [],
        defaultConfig
      );

      // Impact cost should be minimal on huge pool
      // But gas costs still exist
      expect(result.totalCost).toBeGreaterThan(0n);
    });
  });

  describe('config customization', () => {
    it('should use custom minHarvestValue', () => {
      const customConfig: HarvestGateConfig = {
        ...defaultConfig,
        minHarvestValue: 10_000_000n, // $10 minimum
      };

      // $5 rewards - below $10 custom min
      const result = evaluateHarvest(
        5_000_000n,
        100_000n,
        50_000n,
        l2GasPrice,
        l1GasPrice,
        ethPriceUsdc,
        poolLiquidity,
        [],
        customConfig
      );

      expect(result.shouldHarvest).toBe(false);
    });

    it('should respect zero cooldown (for testing)', () => {
      const fastConfig: HarvestGateConfig = {
        ...defaultConfig,
        harvestCooldownSeconds: 0,
      };

      // This mainly affects the config structure, actual cooldown logic
      // would be in a HarvestManager class
      expect(fastConfig.harvestCooldownSeconds).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle zero rewards', () => {
      const result = evaluateHarvest(
        0n,
        200_000n,
        150_000n,
        l2GasPrice,
        l1GasPrice,
        ethPriceUsdc,
        poolLiquidity,
        [],
        defaultConfig
      );

      expect(result.shouldHarvest).toBe(false);
      expect(result.netGain).toBe(0n);
    });

    it('should handle zero pool liquidity', () => {
      const result = evaluateHarvest(
        100_000_000n, // 100 USDC
        200_000n,
        150_000n,
        l2GasPrice,
        l1GasPrice,
        ethPriceUsdc,
        0n, // No pool liquidity
        [],
        defaultConfig
      );

      // Should use 1% default impact
      expect(result.totalCost).toBeGreaterThan(0n);
    });

    it('should handle large reward amounts', () => {
      const result = evaluateHarvest(
        1_000_000_000_000n, // 1M USDC
        200_000n,
        150_000n,
        l2GasPrice,
        l1GasPrice,
        ethPriceUsdc,
        poolLiquidity,
        [HarvestTrigger.THRESHOLD],
        defaultConfig
      );

      expect(result.shouldHarvest).toBe(true);
      expect(result.netGain).toBeGreaterThan(result.claimableValue / 2n);
    });
  });
});

describe('DEFAULT_HARVEST_CONFIG', () => {
  it('should have sensible defaults', () => {
    expect(DEFAULT_HARVEST_CONFIG.minHarvestValue).toBe(1_000_000n); // $1
    expect(DEFAULT_HARVEST_CONFIG.harvestCooldownSeconds).toBe(3600); // 1 hour
    expect(DEFAULT_HARVEST_CONFIG.claimableThresholdBps).toBe(100); // 1%
  });
});

describe('HarvestTrigger enum', () => {
  it('should have all required triggers', () => {
    expect(HarvestTrigger.EXPIRY).toBe('expiry');
    expect(HarvestTrigger.EMISSION).toBe('emission');
    expect(HarvestTrigger.ROUTE).toBe('route');
    expect(HarvestTrigger.THRESHOLD).toBe('threshold');
  });
});
