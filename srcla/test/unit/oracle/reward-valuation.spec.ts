import { describe, it, expect } from '@jest/globals';
import {
  RewardValuationService,
  RewardValuationConfig,
  MockPriceFeed,
} from '../../../src/oracle/reward-valuation.js';

const COMP_TOKEN = '0x0000000000000000000000000000000000000C01';
const WELL_TOKEN = '0x0000000000000000000000000000000000000W01';

describe('RewardValuationService', () => {
  describe('getValuation', () => {
    it('should return stale for missing feed', async () => {
      const config: RewardValuationConfig = {
        feeds: new Map(),
        cacheDurationSeconds: 60,
        maxPriceAgeSeconds: 300,
      };
      const service = new RewardValuationService(config);

      const valuation = await service.getValuation(COMP_TOKEN, 100_00000000_000000000000000000n);

      expect(valuation.isStale).toBe(true);
      expect(valuation.token).toBe(COMP_TOKEN);
    });

    it('should return valuation with correct value', async () => {
      const feed = new MockPriceFeed(50_00000000n); // $50 per COMP
      const config: RewardValuationConfig = {
        feeds: new Map([[COMP_TOKEN, feed]]),
        cacheDurationSeconds: 60,
        maxPriceAgeSeconds: 300,
      };
      const service = new RewardValuationService(config);

      // 1 COMP with 18 decimals = 1e18
      const amount = 1_00000000_000000000000000000n; // 100 COMP
      const valuation = await service.getValuation(COMP_TOKEN, amount);

      expect(valuation.isStale).toBe(false);
      expect(valuation.priceUsd).toBe(50_00000000n);
    });

    it('should handle stale price feed', async () => {
      const feed = new MockPriceFeed(50_00000000n);
      feed.setStale(true);
      const config: RewardValuationConfig = {
        feeds: new Map([[COMP_TOKEN, feed]]),
        cacheDurationSeconds: 60,
        maxPriceAgeSeconds: 300,
      };
      const service = new RewardValuationService(config);

      const amount = 1_00000000_000000000000000000n; // 100 COMP
      const valuation = await service.getValuation(COMP_TOKEN, amount);

      expect(valuation.isStale).toBe(true);
    });

    it('should cache valuations', async () => {
      const feed = new MockPriceFeed(50_00000000n);
      const config: RewardValuationConfig = {
        feeds: new Map([[COMP_TOKEN, feed]]),
        cacheDurationSeconds: 60,
        maxPriceAgeSeconds: 300,
      };
      const service = new RewardValuationService(config);

      const amount = 1_00000000_000000000000000000n;

      // First call
      const valuation1 = await service.getValuation(COMP_TOKEN, amount);

      // Change price
      feed.setPrice(100_00000000n);

      // Second call should return cached value
      const valuation2 = await service.getValuation(COMP_TOKEN, amount);

      expect(valuation1.priceUsd).toBe(valuation2.priceUsd);
    });
  });

  describe('getValuations', () => {
    it('should return valuations for multiple tokens', async () => {
      const compFeed = new MockPriceFeed(50_00000000n); // $50
      const wellFeed = new MockPriceFeed(1_00000000n); // $0.01
      const config: RewardValuationConfig = {
        feeds: new Map([
          [COMP_TOKEN, compFeed],
          [WELL_TOKEN, wellFeed],
        ]),
        cacheDurationSeconds: 60,
        maxPriceAgeSeconds: 300,
      };
      const service = new RewardValuationService(config);

      const valuations = await service.getValuations([
        { token: COMP_TOKEN, amount: 1_00000000_000000000000000000n }, // 100 COMP
        { token: WELL_TOKEN, amount: 1_00000000_000000000000000000n }, // 100 WELL
      ]);

      expect(valuations).toHaveLength(2);
      expect(valuations[0]!.token).toBe(COMP_TOKEN);
      expect(valuations[0]!.priceUsd).toBe(50_00000000n);
      expect(valuations[1]!.token).toBe(WELL_TOKEN);
      expect(valuations[1]!.priceUsd).toBe(1_00000000n);
    });
  });

  describe('getTotalValue', () => {
    it('should sum up total value', async () => {
      const compFeed = new MockPriceFeed(50_00000000n); // $50
      const config: RewardValuationConfig = {
        feeds: new Map([[COMP_TOKEN, compFeed]]),
        cacheDurationSeconds: 60,
        maxPriceAgeSeconds: 300,
      };
      const service = new RewardValuationService(config);

      const total = await service.getTotalValue([
        { token: COMP_TOKEN, amount: 1_00000000_000000000000000000n }, // 100 COMP @ $50 = $5000
      ]);

      expect(total).toBeGreaterThan(0n);
    });
  });

  describe('hasStaleValuations', () => {
    it('should return true when any valuation is stale', async () => {
      const compFeed = new MockPriceFeed(50_00000000n);
      compFeed.setStale(true);
      const config: RewardValuationConfig = {
        feeds: new Map([[COMP_TOKEN, compFeed]]),
        cacheDurationSeconds: 60,
        maxPriceAgeSeconds: 300,
      };
      const service = new RewardValuationService(config);

      const hasStale = await service.hasStaleValuations([
        { token: COMP_TOKEN, amount: 1_00000000_000000000000000000n },
      ]);

      expect(hasStale).toBe(true);
    });

    it('should return false when all valuations are fresh', async () => {
      const compFeed = new MockPriceFeed(50_00000000n);
      const config: RewardValuationConfig = {
        feeds: new Map([[COMP_TOKEN, compFeed]]),
        cacheDurationSeconds: 60,
        maxPriceAgeSeconds: 300,
      };
      const service = new RewardValuationService(config);

      const hasStale = await service.hasStaleValuations([
        { token: COMP_TOKEN, amount: 1_00000000_000000000000000000n },
      ]);

      expect(hasStale).toBe(false);
    });
  });

  describe('cache management', () => {
    it('should clear cache', async () => {
      const feed = new MockPriceFeed(50_00000000n);
      const config: RewardValuationConfig = {
        feeds: new Map([[COMP_TOKEN, feed]]),
        cacheDurationSeconds: 60,
        maxPriceAgeSeconds: 300,
      };
      const service = new RewardValuationService(config);

      // First call
      await service.getValuation(COMP_TOKEN, 1_00000000_000000000000000000n);

      // Clear cache
      service.clearCache();

      // Change price
      feed.setPrice(100_00000000n);

      // Should get new price after cache clear
      const valuation = await service.getValuation(COMP_TOKEN, 1_00000000_000000000000000000n);
      expect(valuation.priceUsd).toBe(100_00000000n);
    });

    it('should prune expired entries', async () => {
      const feed = new MockPriceFeed(50_00000000n);
      const config: RewardValuationConfig = {
        feeds: new Map([[COMP_TOKEN, feed]]),
        cacheDurationSeconds: 0, // Immediately expire
        maxPriceAgeSeconds: 300,
      };
      const service = new RewardValuationService(config);

      // First call
      await service.getValuation(COMP_TOKEN, 1_00000000_000000000000000000n);

      // Prune
      service.pruneCache();

      // Should get new price since cache was pruned
      feed.setPrice(100_00000000n);
      const valuation = await service.getValuation(COMP_TOKEN, 1_00000000_000000000000000000n);
      expect(valuation.priceUsd).toBe(100_00000000n);
    });
  });

  describe('feed management', () => {
    it('should update feed', async () => {
      const feed = new MockPriceFeed(50_00000000n);
      const config: RewardValuationConfig = {
        feeds: new Map(),
        cacheDurationSeconds: 60,
        maxPriceAgeSeconds: 300,
      };
      const service = new RewardValuationService(config);

      // Add feed
      service.setFeed(COMP_TOKEN, feed);

      const valuation = await service.getValuation(COMP_TOKEN, 1_00000000_000000000000000000n);
      expect(valuation.priceUsd).toBe(50_00000000n);
    });

    it('should remove feed', async () => {
      const feed = new MockPriceFeed(50_00000000n);
      const config: RewardValuationConfig = {
        feeds: new Map([[COMP_TOKEN, feed]]),
        cacheDurationSeconds: 60,
        maxPriceAgeSeconds: 300,
      };
      const service = new RewardValuationService(config);

      // Remove feed
      service.removeFeed(COMP_TOKEN);

      const valuation = await service.getValuation(COMP_TOKEN, 1_00000000_000000000000000000n);
      expect(valuation.isStale).toBe(true);
    });
  });
});

describe('MockPriceFeed', () => {
  it('should return configured price', async () => {
    const feed = new MockPriceFeed(100_00000000n);

    const price = await feed.latestAnswer();
    expect(price).toBe(100_00000000n);
  });

  it('should throw for stale price', async () => {
    const feed = new MockPriceFeed(100_00000000n);
    feed.setStale(true);

    await expect(feed.latestAnswer()).rejects.toThrow('Stale price');
  });

  it('should throw on getPrice when configured', async () => {
    const feed = new MockPriceFeed(100_00000000n);
    feed.setThrowOnGetPrice(true);

    await expect(feed.getPrice(300)).rejects.toThrow('Price unavailable');
  });
});
