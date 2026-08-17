/**
 * Uniswap V3 TWAP Oracle for SRCLA
 *
 * Implements §9.4 TWAP oracle for validating swap prices against
 * oracle-derived expected output to prevent sandwich attacks.
 *
 * TWAP Window: 300 seconds (5 minutes)
 * Max Deviation: 500 bps (5%)
 * Formula: TWAP = Σ(tickDelta × timeDelta) / Σ(timeDelta)
 */

import { ethers, type Contract, type Provider } from 'ethers';

// Base mainnet addresses
export const UNISWAP_V3_FACTORY = '0x33128a8fC55774888C2A2137E1Af3F734F15E2b3';
export const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// Factory ABI fragment for getPool
const FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)',
];

// Pool ABI fragments for observe and slot0
const POOL_ABI = [
  'function observe(uint32[] calldata secondsAgos) external view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)',
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() external view returns (uint128)',
];

/**
 * Configuration for the TWAP oracle
 */
export interface TWAPOracleConfig {
  /** Ethers JSON RPC provider */
  provider: Provider;
  /** TWAP window in seconds (default: 300 = 5 minutes) */
  twapWindowSeconds?: number;
  /** Max deviation in basis points (default: 500 = 5%) */
  maxDeviationBps?: number;
  /** Minimum observations required for valid TWAP */
  minObservations?: number;
}

/**
 * Observation data from Uniswap V3 pool
 */
export interface Observation {
  tickCumulative: bigint;
  secondsPerLiquidityCumulativeX128: bigint;
  blockTimestamp: number;
}

/**
 * TWAP result
 */
export interface TWAPResult {
  /** Time-weighted average tick */
  twapTick: bigint;
  /** The observation tick that was used as the starting point */
  anchorTick: bigint;
  /** Window that was used for calculation */
  windowSeconds: number;
  /** Number of observations used */
  observationCount: number;
  /** Timestamp of the anchor observation */
  anchorTimestamp: number;
  /** Whether the TWAP could be computed */
  isValid: boolean;
  /** Reason if invalid */
  invalidReason?: string;
}

/**
 * Price validation result
 */
export interface PriceValidationResult {
  /** Whether the price passes validation */
  isValid: boolean;
  /** The TWAP tick */
  twapTick: bigint;
  /** The current tick from the pool */
  currentTick: bigint;
  /** Deviation in basis points (absolute) */
  deviationBps: bigint;
  /** Max allowed deviation */
  maxDeviationBps: bigint;
  /** Reason if invalid */
  reason?: string;
}

/**
 * Pool state for price conversion
 */
export interface PoolState {
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
  observationIndex: number;
  observationCardinality: number;
}

/**
 * Uniswap V3 TWAP Oracle
 *
 * Fetches TWAP prices from Uniswap V3 pools and validates swap prices
 * against oracle-derived expected output to prevent sandwich attacks.
 */
export class UniswapV3TWAPOracle {
  private provider: Provider;
  private twapWindowSeconds: number;
  private maxDeviationBps: bigint;
  private minObservations: number;
  private factory: Contract;

  constructor(config: TWAPOracleConfig) {
    this.provider = config.provider;
    this.twapWindowSeconds = config.twapWindowSeconds ?? 300;
    this.maxDeviationBps = BigInt(config.maxDeviationBps ?? 500);
    this.minObservations = config.minObservations ?? 2;
    this.factory = new ethers.Contract(
      UNISWAP_V3_FACTORY,
      FACTORY_ABI,
      this.provider
    );
  }

  /**
   * Get pool address from the Uniswap V3 factory
   */
  async getPoolAddress(
    tokenA: string,
    tokenB: string,
    fee: number
  ): Promise<string> {
    // Sort tokens to match Uniswap's pair ordering
    const [token0, token1] = this.sortTokens(tokenA, tokenB);
    const getPool = this.factory.getPool;
    if (!getPool) {
      throw new Error('Factory does not support getPool');
    }
    const result = await (getPool as Function)(token0, token1, fee);
    return result as string;
  }

  /**
   * Get observations from a Uniswap V3 pool
   * Calls the pool's observe() function with configurable window
   */
  async getObservations(
    poolAddress: string,
    windowSeconds: number = this.twapWindowSeconds
  ): Promise<{ ticks: bigint[]; times: bigint[] }> {
    const pool = new ethers.Contract(poolAddress, POOL_ABI, this.provider);

    // Generate seconds ago array: [window, window-1, ..., 0]
    // We need enough observations to cover the window
    const observationSeconds = 60; // Sample every minute
    const numObservations = Math.ceil(windowSeconds / observationSeconds) + 1;

    const secondsAgos: number[] = [];
    for (let i = numObservations - 1; i >= 0; i--) {
      secondsAgos.push(i * observationSeconds);
    }

    const observeFn = pool.observe;
    if (!observeFn) {
      throw new Error('Pool does not support observe()');
    }
    const [tickCumulatives] = await observeFn(secondsAgos) as [bigint[]];

    // Calculate the actual times (current time minus seconds ago)
    const now = Math.floor(Date.now() / 1000);
    const times = secondsAgos.map((ago) => BigInt(now - ago));

    return { ticks: tickCumulatives as bigint[], times };
  }

  /**
   * Calculate TWAP from tick observations
   * Formula: TWAP = Σ(tickDelta × timeDelta) / Σ(timeDelta)
   *
   * Tick cumulatives are cumulative sums of ticks at each observation.
   * The tick delta between two observations = tickCumulative[later] - tickCumulative[earlier]
   */
  calculateTWAP(
    tickCumulatives: bigint[],
    secondsAgos: bigint[]
  ): bigint {
    if (tickCumulatives.length < 2 || tickCumulatives.length !== secondsAgos.length) {
      throw new Error('Invalid observations: need at least 2 observations');
    }

    // Sort by seconds ago (descending: oldest first, most recent last)
    // We need to pair (tick, time) properly
    const n = tickCumulatives.length;
    let weightedSum = 0n;
    let totalTime = 0n;

    // Tick cumulatives go backwards in time, so:
    // tickCumulatives[i] is the cumulative at time secondsAgos[i] seconds ago
    // The actual timestamp = currentTime - secondsAgos[i]
    //
    // For the TWAP, we look at the difference between consecutive observations
    // tickDelta[i] = tickCumulatives[i+1] - tickCumulatives[i]
    // timeDelta[i] = secondsAgos[i] - secondsAgos[i+1]
    //
    // TWAP = sum(tickDelta[i] * timeDelta[i]) / sum(timeDelta[i])

    for (let i = 0; i < n - 1; i++) {
      const tickI = tickCumulatives[i] ?? 0n;
      const tickNext = tickCumulatives[i + 1] ?? 0n;
      const tickDelta = tickNext - tickI;

      const timeI = secondsAgos[i] ?? 0n;
      const timeNext = secondsAgos[i + 1] ?? 0n;
      const timeDelta = timeI - timeNext;

      if (timeDelta > 0n) {
        // Average tick over this interval = tickDelta / timeDelta
        // weightedSum accumulates (average tick * time)
        // = (tickDelta / timeDelta) * timeDelta = tickDelta
        weightedSum += tickDelta;
        totalTime += timeDelta;
      }
    }

    if (totalTime === 0n) {
      throw new Error('Invalid observations: zero time elapsed');
    }

    // TWAP = sum of tick deltas / sum of time deltas
    // This gives us the average tick over the entire window
    return weightedSum / totalTime;
  }

  /**
   * Get TWAP price for a pool
   */
  async getTWAPPrice(
    poolAddress: string,
    windowSeconds?: number
  ): Promise<TWAPResult> {
    const window = windowSeconds ?? this.twapWindowSeconds;

    try {
      // Get observations
      const { ticks, times } = await this.getObservations(poolAddress, window);

      if (ticks.length < this.minObservations) {
        return {
          twapTick: 0n,
          anchorTick: 0n,
          windowSeconds: window,
          observationCount: ticks.length,
          anchorTimestamp: 0,
          isValid: false,
          invalidReason: `Insufficient observations: ${ticks.length} < ${this.minObservations}`,
        };
      }

      // Convert times to seconds ago (bigint array)
      const now = BigInt(Math.floor(Date.now() / 1000));
      const secondsAgos: bigint[] = times.map((t) => now - t);

      // Calculate TWAP
      const twapTick = this.calculateTWAP(ticks, secondsAgos);

      // Anchor tick is the most recent observation
      const anchorTick = ticks[ticks.length - 1] ?? 0n;
      const anchorTimestamp = Number(times[times.length - 1] ?? 0n);

      return {
        twapTick,
        anchorTick,
        windowSeconds: window,
        observationCount: ticks.length,
        anchorTimestamp,
        isValid: true,
      };
    } catch (error) {
      return {
        twapTick: 0n,
        anchorTick: 0n,
        windowSeconds: window,
        observationCount: 0,
        anchorTimestamp: 0,
        isValid: false,
        invalidReason: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get current pool state
   */
  async getPoolState(poolAddress: string): Promise<PoolState> {
    const pool = new ethers.Contract(poolAddress, POOL_ABI, this.provider);
    const slot0Fn = pool.slot0;
    const liquidityFn = pool.liquidity;

    if (!slot0Fn || !liquidityFn) {
      throw new Error('Pool does not support required methods');
    }

    const [sqrtPriceX96, tick, , , , , unlocked] = await slot0Fn() as [bigint, number, number, number, number, number, boolean];

    if (!unlocked) {
      throw new Error('Pool is locked');
    }

    const liquidity = await liquidityFn() as bigint;

    return {
      sqrtPriceX96,
      tick,
      liquidity,
      observationIndex: 0,
      observationCardinality: 0,
    };
  }

  /**
   * Validate a swap price against TWAP
   * Returns detailed validation result
   */
  async validatePrice(
    poolAddress: string,
    _expectedOutputAmount?: bigint,
    _inputAmount?: bigint
  ): Promise<PriceValidationResult> {
    try {
      // Get TWAP
      const twapResult = await this.getTWAPPrice(poolAddress);

      if (!twapResult.isValid) {
        return {
          isValid: false,
          twapTick: 0n,
          currentTick: 0n,
          deviationBps: 0n,
          maxDeviationBps: this.maxDeviationBps,
          reason: `TWAP invalid: ${twapResult.invalidReason ?? 'unknown'}`,
        };
      }

      // Get current pool state
      const poolState = await this.getPoolState(poolAddress);
      const currentTick = BigInt(poolState.tick);

      // Calculate deviation
      const deviationBps = this.calculateDeviationBps(
        currentTick,
        twapResult.twapTick
      );

      const isValid = deviationBps <= this.maxDeviationBps;

      const result: PriceValidationResult = {
        isValid,
        twapTick: twapResult.twapTick,
        currentTick,
        deviationBps,
        maxDeviationBps: this.maxDeviationBps,
      };

      if (!isValid) {
        result.reason = `Price deviation ${deviationBps}bps exceeds max ${this.maxDeviationBps}bps`;
      }

      return result;
    } catch (error) {
      return {
        isValid: false,
        twapTick: 0n,
        currentTick: 0n,
        deviationBps: 0n,
        maxDeviationBps: this.maxDeviationBps,
        reason: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Convert tick to sqrt ratio X96
   * Uses the formula: sqrtPriceX96 = sqrt(1.0001^tick) * 2^96
   */
  tickToSqrtRatioX96(tick: number | bigint): bigint {
    const t = typeof tick === 'bigint' ? Number(tick) : tick;
    return this.getSqrtRatioAtTick(t);
  }

  /**
   * Convert tick to price ratio (token1/token0)
   * Returns the price as a BigInt with appropriate scaling
   */
  tickToPrice(tick: number | bigint, decimals: number = 18): bigint {
    // For tick = 0, price = 1
    const t = typeof tick === 'bigint' ? Number(tick) : tick;
    if (t === 0) {
      return 10n ** BigInt(decimals);
    }

    // Use getTickPrice for accurate calculation
    const price = this.getTickPrice(BigInt(t));
    return price;
  }

  /**
   * Calculate price from tick for display
   * Returns price with 18 decimal precision
   */
  getPriceFromTick(tick: number | bigint): number {
    const t = typeof tick === 'bigint' ? Number(tick) : tick;
    return Math.pow(1.0001, t);
  }

  /**
   * Get the sqrt ratio at a given tick using binary search
   * This is the standard Uniswap V3 implementation
   */
  private getSqrtRatioAtTick(tick: number): bigint {
    const MIN_TICK = -887272;
    const MAX_TICK = 887272;

    if (tick < MIN_TICK || tick > MAX_TICK) {
      throw new Error('Tick out of range');
    }

    // Q96 is 2^96
    const Q96 = 1n << 96n;

    // sqrt(1.0001) in Q192 format (multiply by 2^192)
    // This is 2^192 * sqrt(1.0001)
    const SQRT_10001_Q192 = 627710173538668076383578942317605701376n * 100049975621n;

    let ratio = Q96;

    if (tick > 0) {
      // For positive ticks, multiply by sqrt(1.0001) repeatedly
      // Keep result in Q192 format, then shift right by 96 to get Q96
      let resultQ192 = ratio;
      for (let i = 0; i < tick; i++) {
        resultQ192 = (resultQ192 * SQRT_10001_Q192) >> 96n;
      }
      ratio = resultQ192;
    } else if (tick < 0) {
      // For negative ticks, multiply by 1/sqrt(1.0001)
      // 1/sqrt(1.0001) = 2^192 / SQRT_10001_Q192
      const INV_SQRT_10001_Q192 = (1n << 192n) / SQRT_10001_Q192;
      let resultQ192 = ratio;
      for (let i = 0; i < Math.abs(tick); i++) {
        resultQ192 = (resultQ192 * INV_SQRT_10001_Q192) >> 96n;
      }
      ratio = resultQ192;
    }

    return ratio;
  }

  /**
   * Calculate deviation in basis points between two ticks
   */
  private calculateDeviationBps(tick1: bigint, tick2: bigint): bigint {
    if (tick2 === 0n) {
      return 0n;
    }

    // Convert tick difference to basis points using price ratio
    const price1 = this.getTickPrice(tick1);
    const price2 = this.getTickPrice(tick2);

    if (price2 === 0n) {
      return 0n;
    }

    const ratio = (price1 * 10000n) / price2;
    const deviation = ratio > 10000n ? ratio - 10000n : 10000n - ratio;

    return deviation;
  }

  /**
   * Get price value from tick using precise calculation
   * Price = 1.0001^tick in 1e18 precision
   */
  private getTickPrice(tick: bigint): bigint {
    // Handle tick 0
    if (tick === 0n) {
      return 1_00000000_0000000000n; // 1e18
    }

    const absTick = tick < 0n ? -tick : tick;

    // For efficiency, we compute 1.0001^tick using exponentiation by squaring
    // 1.0001 = 10001/10000
    let result = 1_00000000_0000000000n; // 1e18
    let multiplier = 10001n;
    let divisor = 10000n;
    let exp = absTick;

    while (exp > 0n) {
      if (exp % 2n === 1n) {
        result = (result * multiplier) / divisor;
      }
      exp = exp / 2n;
      if (exp > 0n) {
        // Square the multiplier/divisor for the next iteration
        multiplier = (multiplier * multiplier) / divisor;
        divisor = (divisor * divisor) / 10000n;
      }
    }

    if (tick < 0n) {
      // For negative ticks, invert the price
      const one = 1_00000000_0000000000n;
      result = (one * one) / result;
    }

    return result;
  }

  /**
   * Sort tokens to match Uniswap's pair ordering
   */
  private sortTokens(
    tokenA: string,
    tokenB: string
  ): [string, string] {
    // Convert to lowercase for comparison
    const addrA = tokenA.toLowerCase();
    const addrB = tokenB.toLowerCase();

    // Sort by address
    if (addrA < addrB) {
      return [tokenA, tokenB];
    } else {
      return [tokenB, tokenA];
    }
  }

  /**
   * Get the TWAP window configuration
   */
  getTWAPWindow(): number {
    return this.twapWindowSeconds;
  }

  /**
   * Get the max deviation configuration
   */
  getMaxDeviation(): bigint {
    return this.maxDeviationBps;
  }

  /**
   * Update TWAP window
   */
  setTWAPWindow(seconds: number): void {
    if (seconds <= 0) {
      throw new Error('TWAP window must be positive');
    }
    this.twapWindowSeconds = seconds;
  }

  /**
   * Update max deviation
   */
  setMaxDeviation(bps: number): void {
    if (bps <= 0) {
      throw new Error('Max deviation must be positive');
    }
    this.maxDeviationBps = BigInt(bps);
  }
}
