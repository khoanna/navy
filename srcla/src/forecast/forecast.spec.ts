import { RollingForecast } from './rolling.js';
import { EWResidualForecast } from './ew-residual.js';
import { DirectARXForecast } from './direct-arx.js';
import { selectBestMethod } from './select.js';
import { WAD } from '../protocols/math.js';

function makeHistory(n: number, baseReturn: bigint): bigint[] {
  return Array.from({ length: n }, () => baseReturn);
}

describe('ForecastEngine', () => {
  describe('Rolling method', () => {
    it('should forecast with rolling window', () => {
      const method = new RollingForecast({ windowDays: 7, quantile: 0.05 });
      const history = makeHistory(30, WAD + 10000000000000n); // Slight positive return

      const result = method.forecast(history, 86400);

      expect(result.meanReturn).toBeGreaterThan(WAD);
      expect(result.lowerReturn).toBeLessThanOrEqual(result.meanReturn);
    });

    it('should return conservative estimate with insufficient history', () => {
      const method = new RollingForecast({ windowDays: 30, quantile: 0.05 });
      const history = makeHistory(5, WAD);

      const result = method.forecast(history, 86400);

      expect(result.coverage).toBe(0);
    });
  });

  describe('EW-Residual method', () => {
    it('should weight recent observations more', () => {
      const method = new EWResidualForecast({ decay: 0.95, residualQuantile: 0.05 });
      const history = makeHistory(50, WAD);

      const result = method.forecast(history, 86400);

      expect(result.method).toBe('ew-residual');
      expect(result.meanReturn).toBeGreaterThan(0n);
    });
  });

  describe('ARX method', () => {
    it('should forecast with autoregressive model', () => {
      const method = new DirectARXForecast({ lags: 3, features: ['rate'] });
      const history = makeHistory(30, WAD);

      const result = method.forecast(history, { rate: history }, 86400);

      expect(result.marketId).toBe('arx');
    });
  });

  describe('Method selection', () => {
    it('should select method with lowest loss', () => {
      const candidates = [
        { method: 'rolling' as const, config: { windowDays: 30 }, loss: 0.05 },
        { method: 'ew-residual' as const, config: { decay: 0.95 }, loss: 0.03 },
        { method: 'arx' as const, config: { lags: 7 }, loss: 0.04 },
      ];

      const selected = selectBestMethod(candidates);

      expect(selected.method).toBe('ew-residual');
    });

    it('should tie-break by priority', () => {
      const candidates = [
        { method: 'rolling' as const, config: {}, loss: 0.05 },
        { method: 'ew-residual' as const, config: {}, loss: 0.05 },
        { method: 'arx' as const, config: {}, loss: 0.05 },
      ];

      const selected = selectBestMethod(candidates);

      expect(selected.method).toBe('rolling'); // Priority 1
    });
  });
});
