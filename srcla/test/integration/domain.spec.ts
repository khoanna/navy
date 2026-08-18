import { parseUsdc, formatUsdc, bpsToFraction, calcBps, bigintClamp } from '../../src/domain/units.js';
import { canonicalize, hashData, computeDecisionHash, computeSnapshotHash } from '../../src/domain/hashing.js';

describe('units', () => {
  describe('parseUsdc', () => {
    it('should parse USDC string to BigInt', () => {
      expect(parseUsdc('100.50')).toBe(100_500_000n);
      expect(parseUsdc('1000000')).toBe(1_000_000_000_000n);
      expect(parseUsdc('0.000001')).toBe(1n);
    });

    it('should format BigInt to USDC string', () => {
      expect(formatUsdc(100_500_000n)).toBe('100.50');
      expect(formatUsdc(1_000_000_000_000n)).toBe('1000000.00');
    });

    it('should handle zero', () => {
      expect(parseUsdc('0')).toBe(0n);
      expect(formatUsdc(0n)).toBe('0.00');
    });

    it('should pad fraction to 6 digits', () => {
      expect(parseUsdc('1.1')).toBe(1_100_000n);
      expect(parseUsdc('1.12345')).toBe(1_123_450n);
    });
  });

  describe('bpsToFraction', () => {
    it('should convert bps to fraction', () => {
      expect(bpsToFraction(100n)).toBe(0.01);
      expect(bpsToFraction(1000n)).toBe(0.1);
      expect(bpsToFraction(1n)).toBe(0.0001);
    });
  });

  describe('calcBps', () => {
    it('should calculate bps of amount', () => {
      // 1% of 1000 USDC = 10_000_000n
      expect(calcBps(1_000_000_000_000n, 100n)).toBe(10_000_000_000n);
      // 0.5% of 1000 USDC = 5_000_000n
      expect(calcBps(1_000_000_000_000n, 50n)).toBe(5_000_000_000n);
    });
  });

  describe('bigintClamp', () => {
    it('should clamp value between min and max', () => {
      expect(bigintClamp(5n, 0n, 10n)).toBe(5n);
      expect(bigintClamp(-1n, 0n, 10n)).toBe(0n);
      expect(bigintClamp(15n, 0n, 10n)).toBe(10n);
    });
  });
});

describe('hashing', () => {
  describe('canonicalize', () => {
    it('should canonicalize primitives', () => {
      expect(canonicalize(null)).toBe('null');
      expect(canonicalize(true)).toBe('true');
      expect(canonicalize(123)).toBe('123');
      expect(canonicalize('hello')).toBe('"hello"');
    });

    it('should canonicalize arrays', () => {
      expect(canonicalize([1, 2, 3])).toBe('[1,2,3]');
      expect(canonicalize(['a', 'b'])).toBe('["a","b"]');
    });

    it('should canonicalize objects with sorted keys', () => {
      expect(canonicalize({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    });
  });

  describe('hashData', () => {
    it('should produce consistent SHA-256 hash', () => {
      const h1 = hashData({ a: 1, b: 2 });
      const h2 = hashData({ a: 1, b: 2 });
      const h3 = hashData({ b: 2, a: 1 });
      expect(h1).toBe(h2);
      expect(h1).toBe(h3);
      expect(h1).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('computeDecisionHash', () => {
    it('should produce consistent decision hash', () => {
      const inputs = {
        policyVersion: '1.0.0',
        snapshotHash: '0xabc',
        timestamp: new Date('2026-08-09T12:00:00Z'),
        admissions: [],
        forecasts: [],
        allocation: null,
      };
      const h1 = computeDecisionHash(inputs);
      const h2 = computeDecisionHash(inputs);
      expect(h1).toBe(h2);
      expect(h1).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('computeSnapshotHash', () => {
    it('should produce consistent snapshot hash', () => {
      const snapshot = {
        marketId: '0x123',
        blockHash: '0xabc',
        timestamp: new Date('2026-08-09T12:00:00Z'),
        totalAssetsBase: '1000000',
        supplyRateE18: '50000000000000000',
        utilizationE18: '700000000000000000',
      };
      const h1 = computeSnapshotHash(snapshot);
      const h2 = computeSnapshotHash(snapshot);
      expect(h1).toBe(h2);
      expect(h1).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
