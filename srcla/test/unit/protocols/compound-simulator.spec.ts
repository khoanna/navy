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

    /* The two cases below were ported from
     * test/integration/srcla-gap.integration.test.ts, deleted in the
     * 2026-09-08 cleanup: jest's testMatch is '**\/*.spec.ts', so no
     * `.test.ts` file in this repo has ever executed. The three cases above
     * pin the rate at three individual utilizations; neither of these
     * shape properties followed from them. */

    it('is monotonically increasing in utilization across the whole 0-100% range', () => {
      const config = { ...DEFAULT_COMPOUND_CONFIG };
      const utilizations = [0n, 10n, 30n, 50n, 70n, 80n, 85n, 90n, 95n, 100n].map(
        (pct) => (pct * RAY) / 100n
      );

      let prevRate = -1n;
      for (const util of utilizations) {
        const rate = calculateRateFromUtilization(util, config);
        expect(rate).toBeGreaterThan(prevRate);
        prevRate = rate;
      }
    });

    it('is steeper above the kink than below it, over equal utilization steps', () => {
      // The defining property of the kinked model: the same 1% step in
      // utilization must buy more rate above the kink than below it.
      // Comparing two adjacent points (as the deleted test did) only
      // re-proves monotonicity; comparing two equal-width SLOPES is what
      // distinguishes slopeHigh from slopeLow.
      const config = { ...DEFAULT_COMPOUND_CONFIG };
      const step = RAY / 100n; // 1% of utilization

      const below = calculateRateFromUtilization(config.kink - step, config);
      const atKink = calculateRateFromUtilization(config.kink, config);
      const above = calculateRateFromUtilization(config.kink + step, config);

      const slopeBelow = atKink - below;
      const slopeAbove = above - atKink;

      expect(slopeAbove).toBeGreaterThan(slopeBelow);
    });
  });
});
