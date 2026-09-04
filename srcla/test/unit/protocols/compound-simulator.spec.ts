/**
 * Compound V3 Simulator Unit Tests
 *
 * Tests for the kinked linear rate model implementation per Compound III Comet governance.
 */

import { calculateRateFromUtilization } from '../../../src/protocols/simulation/compound-simulator.js';
import { DEFAULT_COMPOUND_CONFIG } from '../../../src/protocols/simulation/types.js';
import { WAD, RAY } from '../../../src/protocols/math.js';

describe('CompoundV3Simulator', () => {
  describe('calculateRateFromUtilization', () => {
    it('should return base rate at 0% utilization', () => {
      const config = { ...DEFAULT_COMPOUND_CONFIG, baseRate: 3n * WAD / 100n }; // 3% APY
      const rate = calculateRateFromUtilization(0n, config);
      // rate per second = 0.03 / 31557600
      const expectedPerSec = (3n * WAD / 100n) / 31557600n;
      expect(rate).toBeLessThanOrEqual(expectedPerSec + 1000n); // allow tiny rounding
    });

    it('should follow kinked linear model below kink', () => {
      // Below kink, rate = baseRate + slopeLow * util
      const config = { ...DEFAULT_COMPOUND_CONFIG };
      const util50 = 50n * RAY / 100n; // 50% utilization
      const rate = calculateRateFromUtilization(util50, config);
      const basePerSec = config.baseRate / 31557600n;
      const slopePerSec = config.slopeLow / 31557600n;
      const expected = basePerSec + (slopePerSec * util50) / RAY;
      expect(Number(rate - expected)).toBeLessThan(1000n);
    });

    it('should use slopeHigh above kink', () => {
      // Above kink, rate = baseRate + slopeLow * kink + slopeHigh * (util - kink)
      const config = { ...DEFAULT_COMPOUND_CONFIG };
      const kink = config.kink;
      const util90 = 90n * RAY / 100n; // 90% utilization (above 80% kink)
      const rate = calculateRateFromUtilization(util90, config);
      const basePerSec = config.baseRate / 31557600n;
      const slopeLowPerSec = config.slopeLow / 31557600n;
      const slopeHighPerSec = config.slopeHigh / 31557600n;
      const expected = basePerSec
        + (slopeLowPerSec * kink) / RAY
        + (slopeHighPerSec * (util90 - kink)) / RAY;
      expect(Number(rate - expected)).toBeLessThan(1000n);
    });

    it('should return 0 rate at 0% utilization', () => {
      const config = { ...DEFAULT_COMPOUND_CONFIG, baseRate: 0n };
      const rate = calculateRateFromUtilization(0n, config);
      expect(rate).toBe(0n);
    });
  });
});
