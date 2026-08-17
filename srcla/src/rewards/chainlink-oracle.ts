/**
 * Chainlink Oracle Client
 *
 * Fetches and validates on-chain Chainlink price feeds per §9.2:
 * - Validates staleness (max 24 hours)
 * - Validates deviation from last known price (max 50%)
 * - Caches prices to reduce chain calls
 */

import { ethers } from 'ethers';
import type { ChainClient } from '../chain/client.js';
import type {
  ChainlinkPrice,
  ChainlinkOracleConfig,
  OracleValidation,
} from './types.js';

// Chainlink Aggregator ABI - minimal interface for price reading
const CHAINLINK_ABI = [
  'function latestAnswer() external view returns (int256)',
  'function latestTimestamp() external view returns (uint256)',
  'function latestRound() external view returns (uint256)',
  'function getRoundData(uint80 _roundId) external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function description() external view returns (string)',
  'function decimals() external view returns (uint8)',
];

/**
 * Default Chainlink oracle configuration
 */
export const DEFAULT_CHAINLINK_CONFIG: ChainlinkOracleConfig = {
  maxStalenessSeconds: 86400, // 24 hours
  maxDeviationBps: 5000n, // 50%
  cacheDurationSeconds: 300, // 5 minutes
};

/**
 * Cache entry for Chainlink prices
 */
interface PriceCacheEntry {
  price: ChainlinkPrice;
  expiresAt: number;
}

/**
 * ChainlinkOracle - Fetches and validates Chainlink price feeds
 *
 * Per §9.2 requirements:
 * - Fetch on-chain prices via Chainlink feeds
 * - Validate staleness (max 24 hours)
 * - Validate deviation from last known price (max 50%)
 */
export class ChainlinkOracle {
  private client: ChainClient;
  private config: ChainlinkOracleConfig;
  private priceCache: Map<string, PriceCacheEntry> = new Map();

  constructor(client: ChainClient, config: Partial<ChainlinkOracleConfig> = {}) {
    this.client = client;
    this.config = { ...DEFAULT_CHAINLINK_CONFIG, ...config };
  }

  /**
   * Get the latest price from a Chainlink feed
   *
   * @param feedAddress - Chainlink aggregator contract address
   * @param bypassCache - Skip cache lookup
   * @returns ChainlinkPrice with staleness check
   */
  async getPrice(feedAddress: string, bypassCache = false): Promise<ChainlinkPrice> {
    // Check cache first
    if (!bypassCache) {
      const cached = this.priceCache.get(feedAddress.toLowerCase());
      if (cached && cached.expiresAt > Date.now()) {
        return cached.price;
      }
    }

    const contract = new ethers.Contract(feedAddress, CHAINLINK_ABI, this.client.provider);

    try {
      // Fetch latest answer and timestamp
      const latestAnswerFn = contract.latestAnswer;
      const latestTimestampFn = contract.latestTimestamp;
      const decimalsFn = contract.decimals;

      if (typeof latestAnswerFn !== 'function' ||
          typeof latestTimestampFn !== 'function' ||
          typeof decimalsFn !== 'function') {
        throw new Error('Contract does not support required functions');
      }

      const [answer, timestamp, decimals] = await Promise.all([
        latestAnswerFn() as Promise<bigint>,
        latestTimestampFn() as Promise<bigint>,
        decimalsFn() as Promise<number>,
      ]);

      // Convert int256 to uint256 and handle negative prices
      const price = BigInt(answer.toString());
      const updatedAt = new Date(Number(timestamp) * 1000);
      const now = new Date();

      // Calculate staleness
      const ageSeconds = Math.floor((now.getTime() - updatedAt.getTime()) / 1000);
      const isStale = ageSeconds > this.config.maxStalenessSeconds;

      const chainlinkPrice: ChainlinkPrice = {
        price,
        decimals,
        updatedAt,
        isStale,
      };

      // Cache the result
      this.priceCache.set(feedAddress.toLowerCase(), {
        price: chainlinkPrice,
        expiresAt: Date.now() + this.config.cacheDurationSeconds * 1000,
      });

      return chainlinkPrice;
    } catch (error) {
      // Return stale price on error
      return {
        price: 0n,
        decimals: 8,
        updatedAt: new Date(0),
        isStale: true,
      };
    }
  }

  /**
   * Validate price feed data
   *
   * @param feedAddress - Chainlink aggregator contract address
   * @param lastKnownPrice - Previous price for deviation check
   * @returns OracleValidation with validation result
   */
  async validate(
    feedAddress: string,
    lastKnownPrice?: bigint
  ): Promise<OracleValidation> {
    const price = await this.getPrice(feedAddress);

    // Check for zero price
    if (price.price === 0n) {
      return {
        valid: false,
        reason: 'Price is zero',
      };
    }

    // Check staleness
    if (price.isStale) {
      return {
        valid: false,
        price: price.price,
        updatedAt: price.updatedAt,
        isStale: true,
        reason: `Price is stale: last update ${price.updatedAt.toISOString()}`,
      };
    }

    // Check deviation from last known price
    if (lastKnownPrice !== undefined && lastKnownPrice > 0n) {
      const deviationBps = this.calculateDeviation(price.price, lastKnownPrice);

      if (deviationBps > this.config.maxDeviationBps) {
        return {
          valid: false,
          price: price.price,
          updatedAt: price.updatedAt,
          isStale: false,
          deviationBps,
          reason: `Price deviation ${deviationBps}bps exceeds max ${this.config.maxDeviationBps}bps`,
        };
      }

      return {
        valid: true,
        price: price.price,
        updatedAt: price.updatedAt,
        isStale: false,
        deviationBps,
      };
    }

    return {
      valid: true,
      price: price.price,
      updatedAt: price.updatedAt,
      isStale: false,
    };
  }

  /**
   * Get historical round data
   *
   * @param feedAddress - Chainlink aggregator contract address
   * @param roundId - Round ID to fetch
   * @returns Round data
   */
  async getRoundData(
    feedAddress: string,
    roundId: bigint
  ): Promise<{ price: bigint; updatedAt: Date; answeredInRound: bigint } | null> {
    const contract = new ethers.Contract(feedAddress, CHAINLINK_ABI, this.client.provider);

    try {
      const getRoundDataFn = contract.getRoundData;
      if (typeof getRoundDataFn !== 'function') {
        return null;
      }

      const result = await getRoundDataFn(roundId) as [bigint, bigint, bigint, bigint, bigint];
      const [, answer, , updatedAt, answeredInRound] = result;

      return {
        price: BigInt(answer.toString()),
        updatedAt: new Date(Number(updatedAt) * 1000),
        answeredInRound: BigInt(answeredInRound.toString()),
      };
    } catch {
      return null;
    }
  }

  /**
   * Get the description of a feed
   *
   * @param feedAddress - Chainlink aggregator contract address
   * @returns Feed description
   */
  async getDescription(feedAddress: string): Promise<string> {
    const contract = new ethers.Contract(feedAddress, CHAINLINK_ABI, this.client.provider);
    const descriptionFn = contract.description;
    if (typeof descriptionFn !== 'function') {
      return '';
    }
    return descriptionFn() as Promise<string>;
  }

  /**
   * Calculate price deviation in basis points
   *
   * deviationBps = |newPrice - oldPrice| / oldPrice * 10000
   *
   * @param newPrice - New price
   * @param oldPrice - Previous price
   * @returns Deviation in basis points
   */
  calculateDeviation(newPrice: bigint, oldPrice: bigint): bigint {
    if (oldPrice === 0n) return 0n;

    const diff = newPrice > oldPrice ? newPrice - oldPrice : oldPrice - newPrice;
    // (diff / oldPrice) * 10000 with WAD precision
    return (diff * 10000n) / oldPrice;
  }

  /**
   * Convert price to USD terms (8 decimals)
   *
   * @param price - Raw price from feed
   * @param feedDecimals - Decimals of the feed
   * @returns Price normalized to 8 decimal places
   */
  normalizePrice(price: bigint, feedDecimals: number): bigint {
    if (feedDecimals === 8) return price;

    const diff = 8 - feedDecimals;
    if (diff > 0) {
      return price * 10n ** BigInt(diff);
    } else {
      return price / 10n ** BigInt(-diff);
    }
  }

  /**
   * Clear the price cache
   */
  clearCache(): void {
    this.priceCache.clear();
  }

  /**
   * Prune expired cache entries
   */
  pruneCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.priceCache) {
      if (entry.expiresAt <= now) {
        this.priceCache.delete(key);
      }
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; entries: number } {
    return {
      size: this.priceCache.size,
      entries: this.priceCache.size,
    };
  }
}
