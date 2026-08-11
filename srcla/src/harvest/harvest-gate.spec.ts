import { describe, it, expect } from '@jest/globals';
import {
  HarvestGate,
  HarvestGateConfig,
  HarvestGateCosts,
  HarvestGateReason,
} from './harvest-gate';

const AAVE_ADAPTER = '0x0000000000000000000000000000000000000A11';
const COMPOUND_ADAPTER = '0x0000000000000000000000000000000000000C01';

function createDefaultCosts(): HarvestGateCosts {
  return {
    claimGasCost: 150_000n, // 150k gas
    swapGasCost: 200_000n, // 200k gas for swap
    l1DataCost: 0n,
    swapImpactBps: 10n, // 0.1%
    slippageBps: 5n, // 0.05%
    bufferBps: 20n, // 0.2% safety buffer
  };
}

function createDefaultConfig(): HarvestGateConfig {
  return {
    costs: createDefaultCosts(),
    minValueThreshold: 1_000_000n, // $1 minimum (1 USDC = 1_000_000 in 6-decimal)
    observationPeriod: 3600, // 1 hour
  };
}

describe('HarvestGate', () => {
  describe('shouldHarvest', () => {
    it('should not harvest below minimum value', () => {
      const config = createDefaultConfig();
      const gate = new HarvestGate(config);

      const result = gate.shouldHarvest({
        adapter: AAVE_ADAPTER,
        claimableValue: 500_000n, // $0.50 - below $1 minimum
        expectedSlippageBps: 5n,
      });

      expect(result.execute).toBe(false);
      expect(result.reason).toContain(HarvestGateReason.MINIMUM_VALUE);
    });

    it('should harvest when profitable', () => {
      const config = createDefaultConfig();
      const gate = new HarvestGate(config);

      const result = gate.shouldHarvest({
        adapter: AAVE_ADAPTER,
        claimableValue: 100_000_000n, // $100
        expectedSlippageBps: 5n,
      });

      expect(result.execute).toBe(true);
      expect(result.reason).toContain(HarvestGateReason.PROFITABLE);
      expect(result.estimatedNetValue).toBeGreaterThan(0n);
    });

    it('should not harvest when not profitable after costs', () => {
      // Make costs very high relative to claimable value
      const config: HarvestGateConfig = {
        costs: {
          claimGasCost: 10_000_000n, // 10M gas = huge
          swapGasCost: 10_000_000n,
          l1DataCost: 0n,
          swapImpactBps: 100n, // 1%
          slippageBps: 100n, // 1%
          bufferBps: 100n, // 1%
        },
        minValueThreshold: 0n, // No minimum threshold
        observationPeriod: 0,
      };
      const gate = new HarvestGate(config, 1_000_000_000n); // $10,000 ETH

      const result = gate.shouldHarvest({
        adapter: AAVE_ADAPTER,
        claimableValue: 10_000_000n, // $10
      });

      // Gas cost alone: 20M gas * 30 gwei * 10000 USDC/ETH / 1e18 = 6000 USDC
      // Plus slippage/impact/buffer: 3% of $10 = $0.30
      // Total costs >> $10, so should not harvest
      expect(result.execute).toBe(false);
      expect(result.reason).toContain(HarvestGateReason.NOT_PROFITABLE);
    });

    it('should respect observation period', () => {
      const config = createDefaultConfig();
      const gate = new HarvestGate(config);
      const now = Math.floor(Date.now() / 1000);

      // Record a harvest 30 minutes ago
      gate.recordHarvest(AAVE_ADAPTER, now - 1800);

      const result = gate.shouldHarvest({
        adapter: AAVE_ADAPTER,
        claimableValue: 100_000_000n,
      });

      expect(result.execute).toBe(false);
      expect(result.reason).toContain(HarvestGateReason.OBSERVATION_PERIOD);
    });

    it('should allow harvest after observation period', () => {
      const config = createDefaultConfig();
      const gate = new HarvestGate(config);
      const now = Math.floor(Date.now() / 1000);

      // Record a harvest 2 hours ago
      gate.recordHarvest(AAVE_ADAPTER, now - 7200);

      const result = gate.shouldHarvest({
        adapter: AAVE_ADAPTER,
        claimableValue: 100_000_000n,
      });

      expect(result.execute).toBe(true);
    });
  });

  describe('cost calculations', () => {
    it('should calculate gas cost correctly', () => {
      const config = createDefaultConfig();
      // Use a known ETH price for predictable results
      const gate = new HarvestGate(config, 2000_000000n); // $2000 ETH

      const gasCost = gate.calculateGasCost();

      // Total gas = 150k + 200k + 0 = 350k gas units
      // At 30 gwei: 350,000 * 30e9 = 10.5e15 wei
      // At $2000 ETH: (350k * 30e9 * 2000e8) / 1e18 = 21_000_000 USDC (6 decimals)
      // The result should be 21 USDC worth of gas
      expect(gasCost).toBe(21_000_000n); // $21
    });

    it('should calculate slippage cost correctly', () => {
      const config = createDefaultConfig();
      const gate = new HarvestGate(config);

      const claimableValue = 100_000_000n; // $100
      const slippageCost = gate.calculateSlippageCost(claimableValue, 10n); // 10 bps = 0.1%

      // 0.1% of $100 = $0.10
      expect(slippageCost).toBe(100_000n);
    });

    it('should calculate impact cost correctly', () => {
      const config = createDefaultConfig();
      const gate = new HarvestGate(config);

      const claimableValue = 100_000_000n; // $100
      const impactCost = gate.calculateImpactCost(claimableValue, 10n); // 10 bps = 0.1%

      expect(impactCost).toBe(100_000n);
    });

    it('should calculate buffer cost correctly', () => {
      const config = createDefaultConfig();
      const gate = new HarvestGate(config);

      const claimableValue = 100_000_000n; // $100
      const bufferCost = gate.calculateBufferCost(claimableValue);

      // bufferBps = 20, so 0.2% of $100 = $0.20
      expect(bufferCost).toBe(200_000n);
    });

    it('should calculate total costs correctly', () => {
      const config = createDefaultConfig();
      const gate = new HarvestGate(config, 2000_000000n);

      const claimableValue = 100_000_000n; // $100
      const costs = gate.calculateCosts(claimableValue, 10n);

      expect(costs.slippageCostUsdc).toBe(100_000n);
      expect(costs.impactCostUsdc).toBe(100_000n);
      expect(costs.bufferCostUsdc).toBe(200_000n);
      expect(costs.totalCostUsdc).toBeGreaterThan(0n);
    });
  });

  describe('recordHarvest', () => {
    it('should record and retrieve last harvest time', () => {
      const config = createDefaultConfig();
      const gate = new HarvestGate(config);
      const now = Math.floor(Date.now() / 1000);

      gate.recordHarvest(AAVE_ADAPTER, now);

      expect(gate.getLastHarvestTime(AAVE_ADAPTER)).toBe(now);
    });

    it('should return 0 for unknown adapter', () => {
      const config = createDefaultConfig();
      const gate = new HarvestGate(config);

      expect(gate.getLastHarvestTime(COMPOUND_ADAPTER)).toBe(0);
    });

    it('should use current time when not specified', () => {
      const config = createDefaultConfig();
      const gate = new HarvestGate(config);
      const before = Math.floor(Date.now() / 1000);

      gate.recordHarvest(AAVE_ADAPTER);

      const after = Math.floor(Date.now() / 1000);
      const recorded = gate.getLastHarvestTime(AAVE_ADAPTER);

      expect(recorded).toBeGreaterThanOrEqual(before);
      expect(recorded).toBeLessThanOrEqual(after);
    });
  });

  describe('setNativeTokenPrice', () => {
    it('should update gas cost when price changes', () => {
      const config = createDefaultConfig();
      const gate = new HarvestGate(config, 2000_000000n);

      const costAt2000 = gate.calculateGasCost();

      gate.setNativeTokenPrice(4000_000000n); // $4000 ETH

      const costAt4000 = gate.calculateGasCost();

      expect(costAt4000).toBe(costAt2000 * 2n);
    });
  });

  describe('getMinimumHarvestValue', () => {
    it('should return configured minimum when costs are low', () => {
      const config: HarvestGateConfig = {
        costs: {
          claimGasCost: 50_000n,
          swapGasCost: 50_000n,
          l1DataCost: 0n,
          swapImpactBps: 5n,
          slippageBps: 5n,
          bufferBps: 5n,
        },
        minValueThreshold: 1_000_000n,
        observationPeriod: 3600,
      };
      const gate = new HarvestGate(config, 2000_000000n);

      const minValue = gate.getMinimumHarvestValue();

      // Should return the configured minimum as it's reasonable
      expect(minValue).toBeGreaterThanOrEqual(1_000_000n);
    });
  });

  describe('decision output', () => {
    it('should include cost breakdown in decision', () => {
      const config = createDefaultConfig();
      const gate = new HarvestGate(config);

      const result = gate.shouldHarvest({
        adapter: AAVE_ADAPTER,
        claimableValue: 100_000_000n,
      });

      expect(result.costBreakdown).toBeDefined();
      expect(result.costBreakdown.totalCostUsdc).toBeGreaterThan(0n);
      expect(result.estimatedNetValue).toBeDefined();
    });
  });
});
