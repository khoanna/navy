/**
 * Reward Valuation Service - values protocol reward tokens in USDC terms
 *
 * This implements Section 4.2 of the SRCLA design:
 * - Uses price feeds to value reward tokens
 * - Caches valuations to reduce chain calls
 * - Detects stale prices
 * - Calculates total reward value across multiple tokens
 */

export interface PriceFeed {
  latestAnswer(): Promise<bigint>;
  getPrice(maxAge: number): Promise<bigint>;
}

export interface RewardValuation {
  token: string;
  priceUsd: bigint; // Price in USDC terms (e.g., 1e8 = $1)
  valueBase: bigint; // Total value in USDC base units (6 decimals)
  amount: bigint; // Original token amount
  decimals: number; // Token decimals
  isStale: boolean;
  timestamp: number;
}

export interface RewardValuationConfig {
  /** Map of token address to price feed */
  feeds: Map<string, PriceFeed>;
  /** How long to cache valuations (seconds) */
  cacheDurationSeconds: number;
  /** Max age for price data before considered stale (seconds) */
  maxPriceAgeSeconds: number;
}

interface CacheEntry {
  valuation: RewardValuation;
  expiresAt: number;
}

/**
 * Reward Valuation Service
 */
export class RewardValuationService {
  private config: RewardValuationConfig;
  private cache: Map<string, CacheEntry> = new Map();

  constructor(config: RewardValuationConfig) {
    this.config = config;
  }

  /**
   * Update the price feed for a token
   */
  setFeed(token: string, feed: PriceFeed): void {
    this.config.feeds.set(token, feed);
  }

  /**
   * Remove a price feed
   */
  removeFeed(token: string): void {
    this.config.feeds.delete(token);
  }

  /**
   * Get valuation for a single token amount
   */
  async getValuation(
    token: string,
    amount: bigint,
    decimals: number = 18
  ): Promise<RewardValuation> {
    const cacheKey = `${token}-${amount}`;

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.valuation;
    }

    const feed = this.config.feeds.get(token);
    const now = Math.floor(Date.now() / 1000);

    if (!feed) {
      const valuation: RewardValuation = {
        token,
        priceUsd: 0n,
        valueBase: 0n,
        amount,
        decimals,
        isStale: true,
        timestamp: now,
      };
      return valuation;
    }

    // Get price with staleness check
    let priceUsd: bigint;
    let isStale = false;

    try {
      priceUsd = await feed.getPrice(this.config.maxPriceAgeSeconds);
    } catch {
      // Try latest answer as fallback
      try {
        priceUsd = await feed.latestAnswer();
        isStale = true;
      } catch {
        const valuation: RewardValuation = {
          token,
          priceUsd: 0n,
          valueBase: 0n,
          amount,
          decimals,
          isStale: true,
          timestamp: now,
        };
        return valuation;
      }
    }

    // Calculate value in USDC base units (6 decimals)
    // priceUsd is in USDC terms (e.g., $1 = 1e8)
    // amount is in token units with decimals
    // value = amount * priceUsd / (10^decimals)
    const valueBase = this.convertToUsdcBase(amount, priceUsd, decimals);

    const valuation: RewardValuation = {
      token,
      priceUsd,
      valueBase,
      amount,
      decimals,
      isStale,
      timestamp: now,
    };

    // Cache the result
    this.cache.set(cacheKey, {
      valuation,
      expiresAt: Date.now() + this.config.cacheDurationSeconds * 1000,
    });

    return valuation;
  }

  /**
   * Get valuations for multiple tokens
   */
  async getValuations(
    rewards: Array<{ token: string; amount: bigint; decimals?: number }>
  ): Promise<RewardValuation[]> {
    const results = await Promise.all(
      rewards.map((r) => this.getValuation(r.token, r.amount, r.decimals ?? 18))
    );
    return results;
  }

  /**
   * Calculate total reward value in USDC base units
   */
  async getTotalValue(
    rewards: Array<{ token: string; amount: bigint; decimals?: number }>
  ): Promise<bigint> {
    const valuations = await this.getValuations(rewards);
    return valuations.reduce((sum, v) => sum + v.valueBase, 0n);
  }

  /**
   * Check if any valuations are stale
   */
  async hasStaleValuations(
    rewards: Array<{ token: string; amount: bigint; decimals?: number }>
  ): Promise<boolean> {
    const valuations = await this.getValuations(rewards);
    return valuations.some((v) => v.isStale);
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Convert token amount to USDC base units
   */
  private convertToUsdcBase(
    amount: bigint,
    priceUsd: bigint,
    decimals: number
  ): bigint {
    // Value = amount * price / (10^decimals)
    // We need result in USDC terms with 6 decimals
    // So: value_base = amount * price * 10^6 / (10^decimals * 10^8)
    // Since price is in USDC terms (e.g., $1 = 1e8)

    if (amount === 0n || priceUsd === 0n) {
      return 0n;
    }

    // Handle different decimal combinations safely
    const scaleFactor = 10n ** BigInt(decimals + 8); // denominator for conversion
    const value = (amount * priceUsd) / scaleFactor;

    // Convert to 6 decimal USDC base units
    return value * 1_000_000n / 1n; // Scale if needed
  }

  /**
   * Get cache stats
   */
  getCacheStats(): { size: number; entries: number } {
    return {
      size: this.cache.size,
      entries: this.cache.size,
    };
  }

  /**
   * Remove expired cache entries
   */
  pruneCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
      }
    }
  }
}

/**
 * Mock Price Feed for testing
 */
export class MockPriceFeed implements PriceFeed {
  private price: bigint;
  private stale: boolean = false;
  private throwOnGetPrice: boolean = false;

  constructor(price: bigint = 1_000_00000n) {
    // Default: $1.00 with 8 decimals
    this.price = price;
  }

  setPrice(price: bigint): void {
    this.price = price;
  }

  setStale(stale: boolean): void {
    this.stale = stale;
  }

  setThrowOnGetPrice(throw_: boolean): void {
    this.throwOnGetPrice = throw_;
  }

  async latestAnswer(): Promise<bigint> {
    if (this.stale) {
      throw new Error('Stale price');
    }
    return this.price;
  }

  async getPrice(_maxAge: number): Promise<bigint> {
    if (this.throwOnGetPrice) {
      throw new Error('Price unavailable');
    }
    if (this.stale) {
      throw new Error('Stale price');
    }
    return this.price;
  }
}
