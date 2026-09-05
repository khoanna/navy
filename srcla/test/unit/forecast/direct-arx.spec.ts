import { DirectARXForecast } from '../../../src/forecast/direct-arx.js';
import { WAD } from '../../../src/protocols/math.js';

describe('DirectARXForecast', () => {
  describe('lower bound calibration', () => {
    it('should compute lower bound from residual quantile', () => {
      const forecaster = new DirectARXForecast({ lags: 5, features: [] });
      // Simulate residuals: mean error is -0.5% (forecast underestimates)
      // 10th percentile of residuals should be negative
      const residuals = Array.from({ length: 100 }, (_, i) => {
        // Random-ish residuals centered around -0.005 * WAD
        const sign = i < 50 ? -1n : 1n;
        return sign * WAD / 200n; // ±0.5% of WAD
      });
      // Force residuals into the forecaster via test helper
      const lowerBound = forecaster.computeLowerBoundForTest(residuals);
      // Lower bound should be less than mean (WAD) because residuals are negative
      expect(lowerBound).toBeLessThan(WAD);
    });

    it('should return WAD when residuals.length < 10', () => {
      const forecaster = new DirectARXForecast({ lags: 5, features: [] });
      const lowerBound = forecaster.computeLowerBoundForTest([WAD / 100n, WAD / 50n]);
      expect(lowerBound).toBe(WAD);
    });

    it('lower bound should always be <= mean forecast', () => {
      const forecaster = new DirectARXForecast({ lags: 5, features: [] });
      const residuals = Array.from({ length: 50 }, (_, i) =>
        (BigInt(i) - 25n) * WAD / 1000n
      );
      const mean = WAD + WAD / 100n; // 1% above WAD
      const lowerBound = forecaster.computeLowerBoundForTest(residuals);
      expect(lowerBound).toBeLessThanOrEqual(mean);
    });
  });
});
