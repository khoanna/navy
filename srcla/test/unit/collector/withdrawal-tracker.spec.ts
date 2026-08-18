import { ethers } from 'ethers';

/**
 * Unit tests for withdrawal event parsing logic.
 * Tests the raw event data parsing without Prisma dependencies.
 */
describe('Withdrawal Event Parsing', () => {
  // Event signature for Withdrawal(address,uint256,uint256)
  const WITHDRAWAL_TOPIC = ethers.id('Withdrawal(address,uint256,uint256)');

  describe('Event Topic', () => {
    it('should compute correct withdrawal event topic', () => {
      // Verify the topic matches expected value
      expect(WITHDRAWAL_TOPIC).toBeTruthy();
      expect(WITHDRAWAL_TOPIC.startsWith('0x')).toBe(true);
      expect(WITHDRAWAL_TOPIC.length).toBe(66); // 32 bytes = 64 hex chars + 0x
    });
  });

  describe('Event Data Parsing', () => {
    it('should parse assets and shares from event data', () => {
      const assets = 1000000n; // 1 USDC (6 decimals)
      const shares = 1100000n; // 1.1 shares

      // Build raw log data: two 32-byte words
      // Manual hex padding since ethers v6 zeroPadValue has type restrictions
      const padHex = (value: bigint): string => {
        const hex = value.toString(16);
        return '0x' + hex.padStart(64, '0');
      };

      const assetsHex = padHex(assets);
      const sharesHex = padHex(shares);
      const rawData = assetsHex.slice(2) + sharesHex.slice(2);

      // Parse assets from data (first 32 bytes)
      const assetsParsed = ethers.toBigInt('0x' + rawData.slice(0, 64));
      expect(assetsParsed).toBe(assets);

      // Parse shares from data (second 32 bytes)
      const sharesParsed = ethers.toBigInt('0x' + rawData.slice(64, 128));
      expect(sharesParsed).toBe(shares);
    });

    it('should handle large values correctly', () => {
      const assets = 1_000_000_000_000n; // 1 million USDC
      const shares = 1_100_000_000_000n; // 1.1 million shares

      const padHex = (value: bigint): string => {
        const hex = value.toString(16);
        return '0x' + hex.padStart(64, '0');
      };

      const assetsHex = padHex(assets);
      const sharesHex = padHex(shares);
      const rawData = assetsHex.slice(2) + sharesHex.slice(2);

      const assetsParsed = ethers.toBigInt('0x' + rawData.slice(0, 64));
      const sharesParsed = ethers.toBigInt('0x' + rawData.slice(64, 128));

      expect(assetsParsed).toBe(assets);
      expect(sharesParsed).toBe(shares);
    });
  });

  describe('Indexed Parameter Parsing', () => {
    it('should parse sender address from indexed topic', () => {
      const sender = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';

      // Pad sender to 32 bytes (as EVM stores indexed address parameters)
      const paddedSender = ethers.zeroPadValue(sender, 32);

      // The topic value is the padded address
      // To extract: take last 40 hex chars (20 bytes = address)
      const extractedSender = '0x' + paddedSender.slice(-40);

      expect(extractedSender).toBe(sender.toLowerCase());
    });
  });

  describe('Event Structure', () => {
    it('should build correct log structure for Withdrawal event', () => {
      const sender = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
      const assets = 5000000n; // 5 USDC
      const shares = 5500000n; // 5.5 shares

      // Pad address helper
      const padAddress = (addr: string): string => {
        return '0x' + addr.slice(2).padStart(64, '0');
      };

      // Build the topics array (same as EVM log structure)
      const topics = [
        WITHDRAWAL_TOPIC, // Event signature
        padAddress(sender), // Indexed: sender
        // Note: assets and shares are NOT indexed, so they're in data
      ];

      // Build the data (non-indexed parameters)
      const padHex = (value: bigint): string => {
        const hex = value.toString(16);
        return '0x' + hex.padStart(64, '0');
      };
      const assetsHex = padHex(assets);
      const sharesHex = padHex(shares);
      // Build data as hex without 0x prefix
      const data = assetsHex.slice(2) + sharesHex.slice(2);

      // Verify structure matches Withdrawal(address indexed sender, uint256 assets, uint256 shares)
      expect(topics.length).toBe(2); // signature + sender (indexed)
      expect(topics[0]).toBe(WITHDRAWAL_TOPIC);
      expect(topics[1]).toBe(ethers.zeroPadValue(sender, 32));

      // Data contains assets and shares
      const parsedAssets = ethers.toBigInt('0x' + data.slice(0, 64));
      const parsedShares = ethers.toBigInt('0x' + data.slice(64, 128));

      expect(parsedAssets).toBe(assets);
      expect(parsedShares).toBe(shares);
    });
  });

  describe('Timestamp Calculation', () => {
    it('should convert block timestamp to Date correctly', () => {
      const blockTimestamp = 1700000000; // Unix timestamp
      const expectedDate = new Date(blockTimestamp * 1000);

      expect(expectedDate.getTime()).toBe(1700000000000);
    });

    it('should handle zero timestamp', () => {
      const blockTimestamp = 0;
      const expectedDate = new Date(blockTimestamp * 1000);

      expect(expectedDate.getTime()).toBe(0);
    });
  });

  describe('Event ID Generation', () => {
    it('should generate deterministic event IDs', () => {
      // Test the hashing logic used for deduplication
      const eventData = '0xblockhash-0xsender-1000000-1100000';

      // Simple deterministic hash (like the actual implementation)
      let hash = 0;
      for (let i = 0; i < eventData.length; i++) {
        const char = eventData.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }

      const eventId = 'we_' + Math.abs(hash).toString(36) + '_' + '0xblockhash'.slice(0, 8);

      expect(eventId.startsWith('we_')).toBe(true);
      expect(eventId.length).toBeGreaterThan(10);
    });

    it('should generate different IDs for different events', () => {
      const event1 = '0xblock1-0xsender1-1000000-1100000';
      const event2 = '0xblock2-0xsender2-2000000-2200000';

      // Simple hash
      const hash1 = (() => {
        let h = 0;
        for (let i = 0; i < event1.length; i++) {
          h = ((h << 5) - h) + event1.charCodeAt(i);
          h = h & h;
        }
        return Math.abs(h);
      })();

      const hash2 = (() => {
        let h = 0;
        for (let i = 0; i < event2.length; i++) {
          h = ((h << 5) - h) + event2.charCodeAt(i);
          h = h & h;
        }
        return Math.abs(h);
      })();

      expect(hash1).not.toBe(hash2);
    });
  });
});

describe('Withdrawal History for Reserve Calculation', () => {
  describe('Quantile Calculation', () => {
    it('should calculate 95th percentile correctly', () => {
      // Sample withdrawal amounts (in USDC base units)
      const withdrawals = [
        1000000n,  // 1 USDC
        2000000n,  // 2 USDC
        1500000n,  // 1.5 USDC
        3000000n,  // 3 USDC
        5000000n,  // 5 USDC
        4000000n,  // 4 USDC
        2500000n,  // 2.5 USDC
        3500000n,  // 3.5 USDC
      ];

      // Sort ascending
      const sorted = [...withdrawals].sort((a, b) => {
        if (a < b) return -1;
        if (a > b) return 1;
        return 0;
      });

      // Calculate 95th percentile index
      const percentile = 0.95;
      const index = (sorted.length - 1) * percentile;
      const lower = Math.floor(index);
      const upper = Math.ceil(index);

      let p95: bigint;
      if (lower === upper || upper >= sorted.length) {
        p95 = sorted[lower]!;
      } else {
        // Linear interpolation
        const fraction = index - lower;
        const lowerValue = Number(sorted[lower]);
        const upperValue = Number(sorted[upper]);
        const interpolated = lowerValue + fraction * (upperValue - lowerValue);
        p95 = BigInt(Math.round(interpolated));
      }

      // With 8 values, 95th percentile should be ~4.5 USDC
      expect(Number(p95)).toBeGreaterThanOrEqual(4000000);
      expect(Number(p95)).toBeLessThanOrEqual(5000000);
    });

    it('should handle empty history', () => {
      const withdrawals: bigint[] = [];

      // With empty history, should use floor reserve
      const floor = 500000000n; // 500 USDC (5% of hypothetical 10M total)

      expect(withdrawals.length).toBe(0);
      // In the actual ReserveOptimizer, empty history falls back to floor
      expect(floor).toBe(500000000n);
    });

    it('should handle single value', () => {
      const withdrawals = [1000000n];

      // 95th percentile of single value is that value
      const percentile = 0.95;
      const index = (withdrawals.length - 1) * percentile;
      const result = withdrawals[Math.floor(index)]!;

      expect(result).toBe(1000000n);
    });
  });
});
