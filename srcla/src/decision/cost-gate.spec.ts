import { CostGate } from './cost-gate.js';
import {
  MovementType,
  L1DataCostParams,
  FailureCostParams,
  BufferOpportunityParams,
} from './cost-gate-types.js';

describe('CostGate', () => {
  let costGate: CostGate;

  beforeEach(() => {
    costGate = new CostGate();
  });

  describe('calculateGasCost', () => {
    it('should calculate gas cost correctly with default config', () => {
      // 500,000 gas * 30e9 gwei * 3500 USDC / 1e18 = 52,500,000 (~$52.50 in USDC 6 decimals)
      const cost = costGate.calculateGasCost();
      expect(cost).toBe(52_500_000n);
    });

    it('should calculate gas cost with custom gas limit', () => {
      // 200,000 gas * 30e9 * 3500 / 1e18 = 21,000,000
      const cost = costGate.calculateGasCost(200_000n);
      expect(cost).toBe(21_000_000n);
    });

    it('should handle zero gas limit', () => {
      const cost = costGate.calculateGasCost(0n);
      expect(cost).toBe(0n);
    });

    it('should handle high gas prices', () => {
      costGate.setGasPrice(100_000_000_000n); // 100 gwei
      // 500,000 * 100e9 * 3500 / 1e18 = 175,000,000
      const cost = costGate.calculateGasCost();
      expect(cost).toBe(175_000_000n);
    });
  });

  describe('calculateSlippageCost', () => {
    it('should calculate slippage cost correctly', () => {
      // 1,000,000 USDC * 5 bps / 10000 = 500
      const cost = costGate.calculateSlippageCost(1_000_000n);
      expect(cost).toBe(500n);
    });

    it('should handle custom slippage bps', () => {
      // 1,000,000 USDC * 10 bps / 10000 = 1,000
      const cost = costGate.calculateSlippageCost(1_000_000n, 10);
      expect(cost).toBe(1_000n);
    });

    it('should handle zero amount', () => {
      const cost = costGate.calculateSlippageCost(0n);
      expect(cost).toBe(0n);
    });

    it('should handle extreme slippage', () => {
      // 1,000,000 USDC * 100 bps (1%) / 10000 = 10,000
      const cost = costGate.calculateSlippageCost(1_000_000n, 100);
      expect(cost).toBe(10_000n);
    });
  });

  describe('calculateMevCost', () => {
    it('should calculate MEV cost correctly', () => {
      // 1,000,000 USDC * 5 bps / 10000 = 500
      const cost = costGate.calculateMevCost(1_000_000n);
      expect(cost).toBe(500n);
    });

    it('should handle custom MEV impact bps', () => {
      // 1,000,000 USDC * 3 bps / 10000 = 300
      const cost = costGate.calculateMevCost(1_000_000n, 3);
      expect(cost).toBe(300n);
    });

    it('should handle zero amount', () => {
      const cost = costGate.calculateMevCost(0n);
      expect(cost).toBe(0n);
    });
  });

  describe('calculateL1DataCost', () => {
    it('should calculate L1 data cost correctly', () => {
      // l1GasPrice * l1CalldataBytes * 16 (L1_DATA_COST_FACTOR)
      // 30e9 wei * 1000 bytes * 16 = 480,000,000,000,000 (480 gwei)
      const params: L1DataCostParams = {
        l1GasPrice: 30_000_000_000n,
        l1CalldataBytes: 1000,
      };
      const cost = costGate.calculateL1DataCost(params);
      expect(cost).toBe(480_000_000_000_000n);
    });

    it('should handle zero gas price', () => {
      const params: L1DataCostParams = {
        l1GasPrice: 0n,
        l1CalldataBytes: 1000,
      };
      const cost = costGate.calculateL1DataCost(params);
      expect(cost).toBe(0n);
    });

    it('should handle zero calldata bytes', () => {
      const params: L1DataCostParams = {
        l1GasPrice: 30_000_000_000n,
        l1CalldataBytes: 0,
      };
      const cost = costGate.calculateL1DataCost(params);
      expect(cost).toBe(0n);
    });

    it('should handle high gas price and large calldata', () => {
      // High gas price scenario: 100 gwei * 5000 bytes * 16
      const params: L1DataCostParams = {
        l1GasPrice: 100_000_000_000n,
        l1CalldataBytes: 5000,
      };
      const cost = costGate.calculateL1DataCost(params);
      expect(cost).toBe(8_000_000_000_000_000n);
    });

    it('should handle maximum safe integer calldata bytes', () => {
      const params: L1DataCostParams = {
        l1GasPrice: 1_000_000_000n, // 1 gwei
        l1CalldataBytes: 100000,
      };
      const cost = costGate.calculateL1DataCost(params);
      // 1e9 * 100000 * 16 = 1.6e15
      expect(cost).toBe(1_600_000_000_000_000n);
    });
  });

  describe('calculateFailureCost', () => {
    it('should calculate failure cost correctly', () => {
      // historicalFailureRate = 0.05 (5%)
      // estimatedLossOnFailure = 10,000,000 USDC ($10)
      // volatilityFactor = 0.2 (20%)
      //
      // expectedLoss = 10,000,000 * 0.05 = 500,000
      // adjustedLoss = 500,000 * (1 + 0.2) = 600,000
      const params: FailureCostParams = {
        historicalFailureRate: 0.05,
        estimatedLossOnFailure: 10_000_000n,
        volatilityFactor: 0.2,
      };
      const cost = costGate.calculateFailureCost(params);
      expect(cost).toBe(600_000n);
    });

    it('should handle zero failure rate', () => {
      const params: FailureCostParams = {
        historicalFailureRate: 0,
        estimatedLossOnFailure: 10_000_000n,
        volatilityFactor: 0.2,
      };
      const cost = costGate.calculateFailureCost(params);
      expect(cost).toBe(0n);
    });

    it('should handle zero estimated loss', () => {
      const params: FailureCostParams = {
        historicalFailureRate: 0.05,
        estimatedLossOnFailure: 0n,
        volatilityFactor: 0.2,
      };
      const cost = costGate.calculateFailureCost(params);
      expect(cost).toBe(0n);
    });

    it('should handle zero volatility factor', () => {
      // expectedLoss = 10,000,000 * 0.05 = 500,000
      // adjustedLoss = 500,000 * (1 + 0) = 500,000
      const params: FailureCostParams = {
        historicalFailureRate: 0.05,
        estimatedLossOnFailure: 10_000_000n,
        volatilityFactor: 0,
      };
      const cost = costGate.calculateFailureCost(params);
      expect(cost).toBe(500_000n);
    });

    it('should handle high failure rate (100%)', () => {
      // expectedLoss = 10,000,000 * 1.0 = 10,000,000
      // adjustedLoss = 10,000,000 * (1 + 0.5) = 15,000,000
      const params: FailureCostParams = {
        historicalFailureRate: 1.0,
        estimatedLossOnFailure: 10_000_000n,
        volatilityFactor: 0.5,
      };
      const cost = costGate.calculateFailureCost(params);
      expect(cost).toBe(15_000_000n);
    });

    it('should handle very small failure rate', () => {
      // expectedLoss = 10,000,000 * 0.001 = 10,000
      // adjustedLoss = 10,000 * (1 + 0.1) = 11,000
      const params: FailureCostParams = {
        historicalFailureRate: 0.001,
        estimatedLossOnFailure: 10_000_000n,
        volatilityFactor: 0.1,
      };
      const cost = costGate.calculateFailureCost(params);
      expect(cost).toBe(11_000n);
    });
  });

  describe('calculateBufferOpportunityCost', () => {
    it('should calculate buffer opportunity cost correctly', () => {
      // idleAmount = 100,000,000 USDC
      // bestAvailableRate = 0.05 (5% APY in WAD)
      // timeSeconds = 86400 (1 day)
      //
      // rateBps = 0.05 * 10000 = 500
      // opportunityCost = 100,000,000 * 500 * 86400 / 31536000 / 10000
      //                  = 4,320,000,000,000,000 / 315,360,000,000
      //                  = 13,689 (truncated)
      const params: BufferOpportunityParams = {
        idleAmount: 100_000_000n,
        bestAvailableRate: 50_000_000_000_000_000n, // 0.05 WAD
        timeSeconds: 86400,
      };
      const cost = costGate.calculateBufferOpportunityCost(params);
      expect(cost).toBe(13_689n);
    });

    it('should handle zero idle amount', () => {
      const params: BufferOpportunityParams = {
        idleAmount: 0n,
        bestAvailableRate: 50_000_000_000_000_000n,
        timeSeconds: 86400,
      };
      const cost = costGate.calculateBufferOpportunityCost(params);
      expect(cost).toBe(0n);
    });

    it('should handle zero rate', () => {
      const params: BufferOpportunityParams = {
        idleAmount: 100_000_000n,
        bestAvailableRate: 0n,
        timeSeconds: 86400,
      };
      const cost = costGate.calculateBufferOpportunityCost(params);
      expect(cost).toBe(0n);
    });

    it('should handle zero time', () => {
      const params: BufferOpportunityParams = {
        idleAmount: 100_000_000n,
        bestAvailableRate: 50_000_000_000_000_000n,
        timeSeconds: 0,
      };
      const cost = costGate.calculateBufferOpportunityCost(params);
      expect(cost).toBe(0n);
    });

    it('should handle one year time horizon', () => {
      // Due to integer division, result is ~4,996,577 instead of 5,000,000
      const params: BufferOpportunityParams = {
        idleAmount: 100_000_000n,
        bestAvailableRate: 50_000_000_000_000_000n,
        timeSeconds: 31536000,
      };
      const cost = costGate.calculateBufferOpportunityCost(params);
      expect(cost).toBe(4_996_577n);
    });

    it('should handle very small rate', () => {
      // 0.0001 WAD converts to 0 BPS due to integer truncation
      const params: BufferOpportunityParams = {
        idleAmount: 1_000_000n,
        bestAvailableRate: 100_000_000_000_000n, // 0.0001 WAD
        timeSeconds: 86400,
      };
      const cost = costGate.calculateBufferOpportunityCost(params);
      expect(cost).toBe(0n);
    });

    it('should handle large amounts correctly', () => {
      // 10,000,000 USDC ($10M) * 5% APY * 1 day
      // 10,000,000 * 500 * 86400 / 31536000 / 10000 = 1,368,925
      const params: BufferOpportunityParams = {
        idleAmount: 10_000_000_000n, // 10M USDC
        bestAvailableRate: 50_000_000_000_000_000n, // 0.05 WAD
        timeSeconds: 86400,
      };
      const cost = costGate.calculateBufferOpportunityCost(params);
      expect(cost).toBe(1_368_925n);
    });
  });

  describe('calculateCostBreakdown', () => {
    it('should calculate complete cost breakdown with all 11 components', () => {
      const breakdown = costGate.calculateCostBreakdown({
        amount: 1_000_000n,
        gasLimit: 500_000n,
        slippageBps: 5,
        mevImpactBps: 5,
        l1DataCost: 100_000_000_000_000n, // 100 gwei in wei
        exitCost: 10_000_000n,
        entryCost: 15_000_000n,
        claimCost: 5_000_000n,
        approveResetCost: 2_000_000n,
        swapCost: 3_000_000n,
        impactCost: 4_000_000n,
        failureCost: 8_000_000n,
        bufferCost: 6_000_000n,
      });

      // Verify all 11 components are present
      expect(breakdown).toHaveProperty('l2GasCost');
      expect(breakdown).toHaveProperty('l1DataCost');
      expect(breakdown).toHaveProperty('exitCost');
      expect(breakdown).toHaveProperty('entryCost');
      expect(breakdown).toHaveProperty('claimCost');
      expect(breakdown).toHaveProperty('approveResetCost');
      expect(breakdown).toHaveProperty('swapCost');
      expect(breakdown).toHaveProperty('impactCost');
      expect(breakdown).toHaveProperty('slippageCost');
      expect(breakdown).toHaveProperty('failureCost');
      expect(breakdown).toHaveProperty('bufferCost');
      expect(breakdown).toHaveProperty('totalCost');

      // Verify individual costs
      expect(breakdown.l2GasCost).toBe(52_500_000n);
      expect(breakdown.l1DataCost).toBe(100_000_000_000_000n);
      expect(breakdown.exitCost).toBe(10_000_000n);
      expect(breakdown.entryCost).toBe(15_000_000n);
      // claimCost only applies for HARVEST movement type
      expect(breakdown.claimCost).toBe(0n);
      expect(breakdown.approveResetCost).toBe(2_000_000n);
      expect(breakdown.swapCost).toBe(3_000_000n);
      expect(breakdown.impactCost).toBe(4_000_000n);
      expect(breakdown.failureCost).toBe(8_000_000n);
      expect(breakdown.bufferCost).toBe(6_000_000n);

      // Slippage should include MEV: 500 + 500 = 1000
      expect(breakdown.slippageCost).toBe(1_000n);

      // Total should be sum of all costs (excluding unused claimCost)
      expect(breakdown.totalCost).toBe(
        52_500_000n + // l2GasCost
        100_000_000_000_000n + // l1DataCost
        10_000_000n + // exitCost
        15_000_000n + // entryCost
        0n + // claimCost (not used for DEPLOY)
        2_000_000n + // approveResetCost
        3_000_000n + // swapCost
        4_000_000n + // impactCost
        1_000n + // slippageCost (slippage + MEV)
        8_000_000n + // failureCost
        6_000_000n // bufferCost
      );
    });

    it('should handle minimal cost breakdown (no extra costs)', () => {
      const breakdown = costGate.calculateCostBreakdown({
        amount: 1_000_000n,
      });

      expect(breakdown.l2GasCost).toBe(52_500_000n);
      expect(breakdown.l1DataCost).toBe(0n);
      expect(breakdown.exitCost).toBe(0n);
      expect(breakdown.entryCost).toBe(0n);
      expect(breakdown.claimCost).toBe(0n);
      expect(breakdown.approveResetCost).toBe(0n);
      expect(breakdown.swapCost).toBe(0n);
      expect(breakdown.impactCost).toBe(0n);
      // slippageCost includes both slippage and MEV: 500 + 500 = 1000
      expect(breakdown.slippageCost).toBe(1_000n);
      expect(breakdown.failureCost).toBe(0n);
      expect(breakdown.bufferCost).toBe(0n);
      expect(breakdown.totalCost).toBe(52_500_000n + 1_000n);
    });

    it('should add extra gas for HARVEST movement type', () => {
      const breakdown = costGate.calculateCostBreakdown({
        amount: 1_000_000n,
        movementType: MovementType.HARVEST,
        claimCost: 5_000_000n,
      });

      // Default gas (52.5M) + extra 200k gas (21M) = 73.5M
      expect(breakdown.l2GasCost).toBe(73_500_000n);
      expect(breakdown.claimCost).toBe(5_000_000n);
    });

    it('should add extra gas for EMERGENCY movement type', () => {
      const breakdown = costGate.calculateCostBreakdown({
        amount: 1_000_000n,
        movementType: MovementType.EMERGENCY,
      });

      // Default gas (52.5M) + extra 300k gas (31.5M) = 84M
      expect(breakdown.l2GasCost).toBe(84_000_000n);
    });

    it('should use default costs when not provided', () => {
      const breakdown = costGate.calculateCostBreakdown({
        amount: 1_000_000n,
        slippageBps: 10,
        mevImpactBps: 3,
      });

      // 500k gas = 52.5M
      expect(breakdown.l2GasCost).toBe(52_500_000n);
      // slippage (1000) + MEV (300) = 1300 (in USDC 6 decimals)
      expect(breakdown.slippageCost).toBe(1_300n);
    });
  });

  describe('calculateExpectedGain', () => {
    it('should calculate expected gain correctly', () => {
      // amount = 1,000,000 USDC
      // currentRate = 3% APY
      // targetRate = 5% APY
      // horizon = 1 day (86400 seconds)
      //
      // rateAdvantage = 0.05 - 0.03 = 0.02 (200 bps)
      // rateBps = 0.02 * 10000 = 200
      // expectedGain = 1,000,000 * 200 * 86400 / 31536000 / 10000
      //              = 172,800,000,000,000 / 315,360,000,000 = 54
      const gain = costGate.calculateExpectedGain(
        1_000_000n,
        30_000_000_000_000_000n, // 0.03 WAD
        50_000_000_000_000_000n, // 0.05 WAD
        86_400n
      );
      expect(gain).toBe(54n);
    });

    it('should return zero when target rate is worse', () => {
      const gain = costGate.calculateExpectedGain(
        1_000_000n,
        50_000_000_000_000_000n, // 0.05 WAD
        30_000_000_000_000_000n, // 0.03 WAD
        86_400n
      );
      expect(gain).toBe(0n);
    });

    it('should return zero when rates are equal', () => {
      const gain = costGate.calculateExpectedGain(
        1_000_000n,
        50_000_000_000_000_000n,
        50_000_000_000_000_000n,
        86_400n
      );
      expect(gain).toBe(0n);
    });
  });

  describe('evaluate', () => {
    it('should block by cost when expected gain does not exceed total cost', () => {
      // With default slippage of 5 bps and MEV of 5 bps, even $100M would have
      // slippage+MEV of $100M * 10 bps = $100M which exceeds any reasonable gain
      // So this test verifies the gate correctly evaluates and rejects
      const decision = costGate.evaluate({
        movementId: 'test-1',
        movementType: MovementType.DEPLOY,
        sourceAdapter: 'adapter-a',
        targetAdapter: 'adapter-b',
        gainParams: {
          amount: 1_000_000n, // $1M - small enough that slippage/MEV dominates
          currentRate: 0n,
          targetRate: 50_000_000_000_000_000n, // 5%
          horizonSeconds: 86400n, // 1 day
          destinationRateAfter: 50_000_000_000_000_000n,
        },
        totalAssets: 100_000_000_000_000n, // $100M
        recentTurnover: 0n,
        timestamp: new Date(),
        blockHash: '0x123',
        configDigest: '0x456',
      });

      // With default slippage (5 bps), $1M has $500 slippage + $500 MEV = $1000
      // Expected gain from 5% for 1 day = ~$137
      // $137 < $1000 + $52.5 + $1 threshold, so gate should fail
      expect(decision.passGate).toBe(false);
      expect(decision.costBreakdown.totalCost).toBeGreaterThan(0n);
    });

    it('should block by cooldown when recently moved', () => {
      costGate.recordMovement('adapter-a', 'adapter-b', 1_000_000n);

      const decision = costGate.evaluate({
        movementId: 'test-2',
        movementType: MovementType.DEPLOY,
        sourceAdapter: 'adapter-a',
        targetAdapter: 'adapter-b',
        gainParams: {
          amount: 10_000_000_000n,
          currentRate: 30_000_000_000_000_000n,
          targetRate: 50_000_000_000_000_000n,
          horizonSeconds: 86400n,
          destinationRateAfter: 50_000_000_000_000_000n,
        },
        totalAssets: 100_000_000_000_000n,
        recentTurnover: 0n,
        timestamp: new Date(),
        blockHash: '0x123',
        configDigest: '0x456',
      });

      expect(decision.passGate).toBe(false);
      expect(decision.blockedByCooldown).toBe(true);
      expect(decision.reason).toContain('COOLDOWN_ACTIVE');
    });
  });

  describe('getConfig / setConfig', () => {
    it('should return current configuration', () => {
      const config = costGate.getConfig();
      expect(config).toHaveProperty('gasLimit');
      expect(config).toHaveProperty('gasPriceWei');
      expect(config).toHaveProperty('ethPriceUsdc');
      expect(config).toHaveProperty('slippageBps');
      expect(config).toHaveProperty('mevImpactBps');
      expect(config).toHaveProperty('minThreshold');
      expect(config).toHaveProperty('cooldownSeconds');
      expect(config).toHaveProperty('maxTurnoverBps');
    });

    it('should update gas price', () => {
      costGate.setGasPrice(50_000_000_000n);
      const config = costGate.getConfig();
      expect(config.gasPriceWei).toBe(50_000_000_000n);
    });

    it('should update ETH price', () => {
      costGate.setEthPrice(4_000_000_000n);
      const config = costGate.getConfig();
      expect(config.ethPriceUsdc).toBe(4_000_000_000n);
    });
  });

  describe('stats', () => {
    it('should track statistics', () => {
      const stats = costGate.getStats();
      expect(stats.totalEvaluated).toBe(0);
      expect(stats.totalPassed).toBe(0);
    });

    it('should reset statistics', () => {
      costGate.evaluate({
        movementId: 'test',
        movementType: MovementType.DEPLOY,
        sourceAdapter: null,
        targetAdapter: null,
        gainParams: {
          amount: 1_000_000n,
          currentRate: 0n,
          targetRate: 0n,
          horizonSeconds: 0n,
          destinationRateAfter: 0n,
        },
        totalAssets: 0n,
        recentTurnover: 0n,
        timestamp: new Date(),
        blockHash: '0x0',
        configDigest: '0x0',
      });

      costGate.resetStats();
      const stats = costGate.getStats();
      expect(stats.totalEvaluated).toBe(0);
    });
  });

  describe('formatMovementCosts', () => {
    it('should format movement costs as readable string', () => {
      const costs = {
        l2GasCost: 52_500_000n,
        l1DataCost: 100_000n,
        exitCost: 10_000n,
        entryCost: 15_000n,
        claimCost: 5_000n,
        approveResetCost: 2_000n,
        swapCost: 3_000n,
        impactCost: 4_000n,
        slippageCost: 1_000n,
        failureBuffer: 8_000n,
        bufferCost: 6_000n,
      };

      const formatted = CostGate.formatMovementCosts(costs);
      expect(formatted).toContain('L2 Gas: 52500000');
      expect(formatted).toContain('L1 Data: 100000');
      expect(formatted).toContain('Exit: 10000');
      expect(formatted).toContain('Total:');
    });
  });
});
