import { describe, it, expect, jest } from '@jest/globals';
import type { JsonRpcProvider } from 'ethers';
import {
  UniswapV3TWAPOracle,
  UNISWAP_V3_FACTORY,
  TWAPResult,
  PriceValidationResult,
} from './twap-oracle.js';

// Mock ethers provider - simplified interface
const mockProvider = {
  getNetwork: jest.fn<() => Promise<{ chainId: number }>>().mockResolvedValue({ chainId: 8453 }),
} as unknown as JsonRpcProvider;

describe('UniswapV3TWAPOracle', () => {
  describe('constructor', () => {
    it('should create oracle with default config', () => {
      const oracle = new UniswapV3TWAPOracle({ provider: mockProvider });

      expect(oracle.getTWAPWindow()).toBe(300);
      expect(oracle.getMaxDeviation()).toBe(500n);
    });

    it('should create oracle with custom config', () => {
      const oracle = new UniswapV3TWAPOracle({
        provider: mockProvider,
        twapWindowSeconds: 600,
        maxDeviationBps: 1000,
        minObservations: 3,
      });

      expect(oracle.getTWAPWindow()).toBe(600);
      expect(oracle.getMaxDeviation()).toBe(1000n);
    });

    it('should reject zero TWAP window', () => {
      const oracle = new UniswapV3TWAPOracle({ provider: mockProvider });
      expect(() => oracle.setTWAPWindow(0)).toThrow('TWAP window must be positive');
    });

    it('should reject negative TWAP window', () => {
      const oracle = new UniswapV3TWAPOracle({ provider: mockProvider });
      expect(() => oracle.setTWAPWindow(-1)).toThrow('TWAP window must be positive');
    });

    it('should reject zero max deviation', () => {
      const oracle = new UniswapV3TWAPOracle({ provider: mockProvider });
      expect(() => oracle.setMaxDeviation(0)).toThrow('Max deviation must be positive');
    });
  });

  describe('getPoolAddress', () => {
    it('should have correct factory address', () => {
      expect(UNISWAP_V3_FACTORY).toBe('0x33128a8fC55774888C2A2137E1Af3F734F15E2b3');
    });
  });

  describe('calculateTWAP', () => {
    /**
     * The calculateTWAP function takes tickCumulatives and secondsAgos from observe().
     * tickCumulatives[i] is the cumulative tick value at time (now - secondsAgos[i])
     * The array is ordered from OLDEST to NEWEST (most seconds ago first, 0 last).
     *
     * TWAP = sum of tick deltas / sum of time deltas
     * where tickDelta[i] = tickCumulatives[i+1] - tickCumulatives[i]
     * and timeDelta[i] = secondsAgos[i] - secondsAgos[i+1]
     */

    it('should calculate TWAP for uniform tick', () => {
      const oracle = new UniswapV3TWAPOracle({ provider: mockProvider });

      // For constant tick=1000 over 300 seconds:
      // secondsAgos[0]=300 (oldest), secondsAgos[3]=0 (newest)
      // tickCumulatives increases by tick * time delta
      // Oldest has lowest cumulative, newest has highest
      const tickCumulatives: bigint[] = [0n, 100000n, 200000n, 300000n];
      const secondsAgos: bigint[] = [300n, 200n, 100n, 0n];

      const twap = oracle.calculateTWAP(tickCumulatives, secondsAgos);

      // tickDelta = 100000 each, timeDelta = 100 each
      // TWAP = (100000*100 + 100000*100 + 100000*100) / 300 = 100000
      expect(twap).toBe(1000n);
    });

    it('should calculate TWAP with varying ticks', () => {
      const oracle = new UniswapV3TWAPOracle({ provider: mockProvider });

      // Simulate: tick=1000 for 100s, tick=1100 for 100s, tick=1200 for 100s
      // Cumulative increases by tick*time at each interval
      const tickCumulatives: bigint[] = [
        0n,                           // oldest: 0 cumulative
        100000n,                      // +100000 from first 100s at tick=1000
        100000n + 110000n,           // +110000 from second 100s at tick=1100
        100000n + 110000n + 120000n, // +120000 from third 100s at tick=1200
      ];
      const secondsAgos: bigint[] = [300n, 200n, 100n, 0n];

      const twap = oracle.calculateTWAP(tickCumulatives, secondsAgos);

      // tickDelta = 100000, 110000, 120000 over 100s each
      // TWAP = (100000 + 110000 + 120000) / 300 = 1100
      expect(twap).toBe(1100n);
    });

    it('should calculate TWAP with partial window observations', () => {
      const oracle = new UniswapV3TWAPOracle({ provider: mockProvider });

      // Just two observations spanning 300 seconds
      const tickCumulatives: bigint[] = [0n, 1050n * 300n];
      const secondsAgos: bigint[] = [300n, 0n];

      const twap = oracle.calculateTWAP(tickCumulatives, secondsAgos);

      // TWAP = (1050*300 - 0) / 300 = 1050
      expect(twap).toBe(1050n);
    });

    it('should throw for insufficient observations', () => {
      const oracle = new UniswapV3TWAPOracle({ provider: mockProvider });

      const tickCumulatives: bigint[] = [0n];
      const secondsAgos: bigint[] = [0n];

      expect(() => oracle.calculateTWAP(tickCumulatives, secondsAgos)).toThrow(
        'Invalid observations: need at least 2 observations'
      );
    });

    it('should throw for mismatched arrays', () => {
      const oracle = new UniswapV3TWAPOracle({ provider: mockProvider });

      const tickCumulatives: bigint[] = [0n, 100000n, 200000n];
      const secondsAgos: bigint[] = [300n, 0n]; // Different length

      expect(() => oracle.calculateTWAP(tickCumulatives, secondsAgos)).toThrow();
    });

    it('should handle decreasing ticks', () => {
      const oracle = new UniswapV3TWAPOracle({ provider: mockProvider });

      // Simulate decreasing: tick=1200 for 100s, tick=1100 for 100s, tick=1000 for 100s
      const tickCumulatives: bigint[] = [
        0n,
        120000n,
        120000n + 110000n,
        120000n + 110000n + 100000n,
      ];
      const secondsAgos: bigint[] = [300n, 200n, 100n, 0n];

      const twap = oracle.calculateTWAP(tickCumulatives, secondsAgos);

      // TWAP = (120000 + 110000 + 100000) / 300 = 1100
      expect(twap).toBe(1100n);
    });
  });

  describe('tickToSqrtRatioX96', () => {
    it('should convert tick 0 to sqrt ratio', () => {
      const oracle = new UniswapV3TWAPOracle({ provider: mockProvider });

      const sqrtRatio = oracle.tickToSqrtRatioX96(0);

      // sqrt(1) * 2^96 should be 2^96
      expect(sqrtRatio).toBe(1n << 96n);
    });

    it('should convert tick 1 to sqrt ratio', () => {
      const oracle = new UniswapV3TWAPOracle({ provider: mockProvider });

      const sqrtRatio = oracle.tickToSqrtRatioX96(1);

      // sqrt(1.0001) * 2^96
      // Should be greater than 2^96
      expect(sqrtRatio).toBeGreaterThan(1n << 96n);
    });

    it('should convert tick -1 to sqrt ratio', () => {
      const oracle = new UniswapV3TWAPOracle({ provider: mockProvider });

      const sqrtRatio = oracle.tickToSqrtRatioX96(-1);

      // sqrt(0.9999) * 2^96
      // Should be less than 2^96
      expect(sqrtRatio).toBeLessThan(1n << 96n);
    });

    it('should convert bigint tick', () => {
      const oracle = new UniswapV3TWAPOracle({ provider: mockProvider });

      const sqrtRatio = oracle.tickToSqrtRatioX96(100n);

      expect(typeof sqrtRatio).toBe('bigint');
      expect(sqrtRatio).toBeGreaterThan(0n);
    });

    it('should throw for tick out of range', () => {
      const oracle = new UniswapV3TWAPOracle({ provider: mockProvider });

      expect(() => oracle.tickToSqrtRatioX96(887273)).toThrow('Tick out of range');
      expect(() => oracle.tickToSqrtRatioX96(-887273)).toThrow('Tick out of range');
    });
  });

  describe('tickToPrice', () => {
    it('should convert tick to price with 18 decimals', () => {
      const oracle = new UniswapV3TWAPOracle({ provider: mockProvider });

      const price = oracle.tickToPrice(0, 18);

      // Tick 0 means price = 1
      expect(price).toBe(1_00000000_0000000000n);
    });

    it('should convert tick to price with 6 decimals', () => {
      const oracle = new UniswapV3TWAPOracle({ provider: mockProvider });

      const price = oracle.tickToPrice(0, 6);

      // Tick 0 means price = 1
      expect(price).toBe(1_000000n);
    });

    it('should convert positive tick to higher price', () => {
      const oracle = new UniswapV3TWAPOracle({ provider: mockProvider });

      const price1 = oracle.tickToPrice(1, 18);
      const price0 = oracle.tickToPrice(0, 18);

      expect(price1).toBeGreaterThan(price0);
    });

    it('should convert negative tick to lower price', () => {
      const oracle = new UniswapV3TWAPOracle({ provider: mockProvider });

      const priceNeg = oracle.tickToPrice(-1, 18);
      const price0 = oracle.tickToPrice(0, 18);

      expect(priceNeg).toBeLessThan(price0);
    });
  });

  describe('getPriceFromTick', () => {
    it('should return 1 for tick 0', () => {
      const oracle = new UniswapV3TWAPOracle({ provider: mockProvider });

      const price = oracle.getPriceFromTick(0);

      expect(price).toBeCloseTo(1, 10);
    });

    it('should return correct price for tick 1', () => {
      const oracle = new UniswapV3TWAPOracle({ provider: mockProvider });

      const price = oracle.getPriceFromTick(1);

      // 1.0001^1 = 1.0001
      expect(price).toBeCloseTo(1.0001, 4);
    });

    it('should return correct price for tick 100', () => {
      const oracle = new UniswapV3TWAPOracle({ provider: mockProvider });

      const price = oracle.getPriceFromTick(100);

      // 1.0001^100 ≈ 1.01005
      expect(price).toBeCloseTo(1.01005, 3);
    });

    it('should handle bigint input', () => {
      const oracle = new UniswapV3TWAPOracle({ provider: mockProvider });

      const price = oracle.getPriceFromTick(10n);

      expect(price).toBeCloseTo(1.001, 3);
    });
  });

  describe('validatePrice', () => {
    it('should return validation result structure', async () => {
      const oracle = new UniswapV3TWAPOracle({
        provider: mockProvider,
        maxDeviationBps: 500, // 5%
      });

      // This test would require a real pool or mock
      // Here we test the structure
      const result = await oracle.validatePrice(
        '0x0000000000000000000000000000000000000001'
      );

      // Without a real provider, this will fail validation
      // but we can check the structure
      expect(result).toHaveProperty('isValid');
      expect(result).toHaveProperty('twapTick');
      expect(result).toHaveProperty('currentTick');
      expect(result).toHaveProperty('deviationBps');
      expect(result).toHaveProperty('maxDeviationBps');
    });
  });

  describe('TWAPResult structure', () => {
    it('should have all required fields', () => {
      const result: TWAPResult = {
        twapTick: 1000n,
        anchorTick: 1000n,
        windowSeconds: 300,
        observationCount: 4,
        anchorTimestamp: 1234567890,
        isValid: true,
      };

      expect(result.twapTick).toBe(1000n);
      expect(result.anchorTick).toBe(1000n);
      expect(result.windowSeconds).toBe(300);
      expect(result.observationCount).toBe(4);
      expect(result.anchorTimestamp).toBe(1234567890);
      expect(result.isValid).toBe(true);
    });

    it('should include invalidReason when invalid', () => {
      const result: TWAPResult = {
        twapTick: 0n,
        anchorTick: 0n,
        windowSeconds: 300,
        observationCount: 0,
        anchorTimestamp: 0,
        isValid: false,
        invalidReason: 'Insufficient observations',
      };

      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe('Insufficient observations');
    });
  });

  describe('PriceValidationResult structure', () => {
    it('should have all required fields for valid result', () => {
      const result: PriceValidationResult = {
        isValid: true,
        twapTick: 1000n,
        currentTick: 1001n,
        deviationBps: 10n,
        maxDeviationBps: 500n,
      };

      expect(result.isValid).toBe(true);
      expect(result.twapTick).toBe(1000n);
      expect(result.currentTick).toBe(1001n);
      expect(result.deviationBps).toBe(10n);
      expect(result.maxDeviationBps).toBe(500n);
    });

    it('should include reason when invalid', () => {
      const result: PriceValidationResult = {
        isValid: false,
        twapTick: 1000n,
        currentTick: 1050n,
        deviationBps: 500n,
        maxDeviationBps: 400n,
        reason: 'Price deviation exceeds max',
      };

      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('Price deviation exceeds max');
    });
  });

  describe('edge cases', () => {
    it('should handle 0 observations', () => {
      const oracle = new UniswapV3TWAPOracle({ provider: mockProvider });

      const tickCumulatives: bigint[] = [];
      const secondsAgos: bigint[] = [];

      expect(() => oracle.calculateTWAP(tickCumulatives, secondsAgos)).toThrow();
    });

    it('should handle expired window observations', () => {
      const oracle = new UniswapV3TWAPOracle({ provider: mockProvider });

      // Just check calculation still works for any window
      const tickCumulatives: bigint[] = [0n, 1000n * 300n];
      const secondsAgos: bigint[] = [10000n, 9700n];

      const twap = oracle.calculateTWAP(tickCumulatives, secondsAgos);

      // The TWAP calculation itself doesn't validate age
      expect(twap).toBe(1000n);
    });

    it('should handle very large tick differences', () => {
      const oracle = new UniswapV3TWAPOracle({ provider: mockProvider });

      const tickCumulatives: bigint[] = [0n, 1000000n * 300n];
      const secondsAgos: bigint[] = [300n, 0n];

      const twap = oracle.calculateTWAP(tickCumulatives, secondsAgos);

      expect(twap).toBe(1000000n);
    });

    it('should handle very small tick differences', () => {
      const oracle = new UniswapV3TWAPOracle({ provider: mockProvider });

      // Tick went from 1000000 to 1000001 over 300 seconds
      const tickCumulatives: bigint[] = [0n, 1000000n * 300n + 1n * 300n];
      const secondsAgos: bigint[] = [300n, 0n];

      const twap = oracle.calculateTWAP(tickCumulatives, secondsAgos);

      // TWAP = (1000000*300 + 1*300) / 300 = 1000000 + 1
      expect(twap).toBe(1000001n);
    });
  });

  describe('configuration updates', () => {
    it('should update TWAP window', () => {
      const oracle = new UniswapV3TWAPOracle({ provider: mockProvider });

      oracle.setTWAPWindow(600);
      expect(oracle.getTWAPWindow()).toBe(600);

      oracle.setTWAPWindow(120);
      expect(oracle.getTWAPWindow()).toBe(120);
    });

    it('should update max deviation', () => {
      const oracle = new UniswapV3TWAPOracle({ provider: mockProvider });

      oracle.setMaxDeviation(1000);
      expect(oracle.getMaxDeviation()).toBe(1000n);

      oracle.setMaxDeviation(100);
      expect(oracle.getMaxDeviation()).toBe(100n);
    });
  });

  describe('constants', () => {
    it('should export correct factory address', () => {
      expect(UNISWAP_V3_FACTORY).toBe('0x33128a8fC55774888C2A2137E1Af3F734F15E2b3');
    });
  });
});
