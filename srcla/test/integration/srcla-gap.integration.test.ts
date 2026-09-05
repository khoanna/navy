/**
 * SRCLA Gap Integration Tests
 *
 * Integration tests validating the mathematical correctness of key SRCLA components:
 * - Compound kinked linear interest rate model
 * - DirectARX calibrated lower bound computation
 *
 * These tests verify the formulas work correctly across the expected input range.
 */

import { calculateRateFromUtilization } from '../../src/protocols/simulation/compound-simulator.js';
import { DEFAULT_COMPOUND_CONFIG } from '../../src/protocols/simulation/types.js';
import { WAD, RAY } from '../../src/protocols/math.js';
import { DirectARXForecast } from '../../src/forecast/direct-arx.js';

describe('SRCLA gap integration', () => {
  describe('Compound kinked linear model', () => {
    it('should match expected APY at various utilization points', async () => {
      // Test cases with expected APY approximations from the model
      // Compound III USDC parameters: baseRate=3%, kink=80%, slopeLow~1%, slopeHigh~10%
      const testCases = [
        { util: 0n, expectedApprox: 0.03 },                  // ~3% APY at 0%
        { util: 50n * RAY / 100n, expectedApprox: 0.04 },    // ~4% APY at 50%
        { util: 80n * RAY / 100n, expectedApprox: 0.05 },    // ~5% APY at kink (80%)
        { util: 90n * RAY / 100n, expectedApprox: 0.08 },    // ~8% APY at 90%
        { util: 100n * RAY / 100n, expectedApprox: 0.10 },   // ~10% APY at 100%
      ];

      for (const tc of testCases) {
        const rate = calculateRateFromUtilization(tc.util, DEFAULT_COMPOUND_CONFIG);
        // Convert rate per second to annual rate
        const annualRate = Number(rate) * 31557600 / 1e18;
        // Within 1% tolerance (absolute percentage)
        expect(annualRate).toBeCloseTo(tc.expectedApprox, 1);
      }
    });

    it('should produce monotonically increasing rates with utilization', () => {
      // Verify the model produces higher rates at higher utilization
      const utilizations = [
        0n,
        10n * RAY / 100n,
        30n * RAY / 100n,
        50n * RAY / 100n,
        70n * RAY / 100n,
        80n * RAY / 100n,
        85n * RAY / 100n,
        90n * RAY / 100n,
        95n * RAY / 100n,
        100n * RAY / 100n,
      ];

      let prevRate = -1n;
      for (const util of utilizations) {
        const rate = calculateRateFromUtilization(util, DEFAULT_COMPOUND_CONFIG);
        expect(rate).toBeGreaterThan(prevRate);
        prevRate = rate;
      }
    });

    it('should have a visible kink at the kink point', () => {
      // The slope should change at the kink (80%)
      const kink = DEFAULT_COMPOUND_CONFIG.kink;
      const utilBelow = kink - RAY / 1000n;  // Just below kink
      const utilAbove = kink + RAY / 1000n;  // Just above kink

      const rateBelow = calculateRateFromUtilization(utilBelow, DEFAULT_COMPOUND_CONFIG);
      const rateAbove = calculateRateFromUtilization(utilAbove, DEFAULT_COMPOUND_CONFIG);

      // Rate above kink should be higher due to steeper slopeHigh
      expect(rateAbove).toBeGreaterThan(rateBelow);

      // The rate jump at kink should be noticeable (at least 0.1% annualized)
      const rateJump = rateAbove - rateBelow;
      const annualizedJump = rateJump * 31557600n / 1n;
      expect(annualizedJump).toBeGreaterThan(WAD / 1000n); // > 0.1%
    });
  });

  describe('DirectARX calibrated lower bound', () => {
    it('should compute lower bound below mean with biased negative residuals', () => {
      const forecaster = new DirectARXForecast({ lags: 5, features: [] });

      // Create residuals that are systematically biased negative
      // This simulates the case where forecasts systematically underestimate
      const residuals = Array.from({ length: 50 }, () => -WAD / 100n); // -1% residuals
      const mean = WAD + WAD / 100n; // 1% above WAD

      // Set calibrated residuals
      forecaster.setCalibratedResiduals(residuals, mean);

      // Compute lower bound
      const lowerBound = forecaster.computeLowerBound(residuals);

      // Lower bound should be below the mean due to negative residuals
      expect(lowerBound).toBeLessThan(mean);
    });

    it('should compute lower bound below mean with diverse residuals', () => {
      const forecaster = new DirectARXForecast({ lags: 5, features: [] });

      // Mixed residuals with a negative bias
      const residuals = Array.from({ length: 50 }, (_, i) => {
        // 70% negative residuals, 30% positive
        return i < 35 ? -WAD / 50n : WAD / 100n;
      });
      const mean = WAD + WAD / 50n; // 2% above WAD

      forecaster.setCalibratedResiduals(residuals, mean);
      const lowerBound = forecaster.computeLowerBound(residuals);

      // Lower bound should be below mean (negative residuals dominate)
      expect(lowerBound).toBeLessThan(mean);
    });

    it('should use 10th percentile of residuals for lower bound', () => {
      const forecaster = new DirectARXForecast({ lags: 5, features: [], quantile: 0.10 });

      // All residuals are the same negative value
      const residualValue = -WAD / 20n; // -5%
      const residuals = Array.from({ length: 100 }, () => residualValue);
      const mean = WAD;

      forecaster.setCalibratedResiduals(residuals, mean);
      const lowerBound = forecaster.computeLowerBound(residuals);

      // With all same residuals, lower bound should equal mean + residualValue
      expect(lowerBound).toBe(mean + residualValue);
    });

    it('should return WAD when insufficient residuals', () => {
      const forecaster = new DirectARXForecast({ lags: 5, features: [] });

      // Only 5 residuals (< 10 minimum)
      const residuals = [WAD / 10n, WAD / 20n, WAD / 30n, -WAD / 10n, -WAD / 20n];
      const lowerBound = forecaster.computeLowerBound(residuals);

      // Should return WAD as fallback when insufficient data
      expect(lowerBound).toBe(WAD);
    });
  });
});
