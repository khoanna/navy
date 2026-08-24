/**
 * Greedy Allocator — Unified allocation algorithm for SRCLA
 *
 * This module implements the core greedy allocation strategy used across the SRCLA
 * system. The algorithm:
 * 1. Sorts markets by expected return (descending)
 * 2. Allocates greedily to each market up to its capacity
 * 3. Respects per-adapter caps and idle buffer
 *
 * USAGE:
 *   import { GreedyAllocator } from './greedy-allocator.js';
 *
 *   const allocator = new GreedyAllocator();
 *   const result = allocator.allocate({
 *     amount: 1_000_000_000_000n, // 1M USDC (6 decimals)
 *     markets: [
 *       { id: 'compound', expectedReturn: 50000000000000000n, capacity: 500_000_000_000n },
 *       { id: 'aave', expectedReturn: 45000000000000000n, capacity: 300_000_000_000n },
 *     ],
 *     options: { maxPerAdapter: 0.5, idleBufferBps: 500 }
 *   });
 *
 * MATH PRECISION:
 *   - All monetary amounts in base units (USDC = 6 decimals)
 *   - All rates in WAD (10^18 = 100%)
 *   - All basis points in basis (10000 = 100%)
 */

import { WAD } from '../protocols/math.js';

// ============================================================================
// Types
// ============================================================================

/**
 * A market (adapter/protocol) that can receive allocation
 */
export interface AllocatableMarket {
  /** Unique identifier for the market (e.g., adapter address) */
  id: string;
  /**
   * Expected return as WAD-scaled rate
   * @example 50000000000000000n = 5% APY (5e16)
   */
  expectedReturn: bigint;
  /**
   * Maximum amount this market can receive
   * @example 500_000_000_000n = 500,000 USDC
   */
  capacity: bigint;
  /**
   * Current amount already allocated to this market (optional)
   * Used when rebalancing existing allocations
   */
  currentAllocation?: bigint;
}

/**
 * Result of a single market allocation
 */
export interface MarketAllocation {
  marketId: string;
  amount: bigint;
  expectedReturn: bigint;
}

/**
 * Result of the greedy allocation run
 */
export interface AllocationResult {
  /** Allocations by market, sorted by expected return (descending) */
  allocations: MarketAllocation[];
  /** Amount kept as idle/USDC */
  idleAmount: bigint;
  /** Total amount allocated */
  totalAllocated: bigint;
  /** Expected return of the portfolio (WAD-scaled) */
  portfolioReturn: bigint;
}

/**
 * Configuration options for the allocator
 */
export interface AllocatorOptions {
  /**
   * Maximum allocation per adapter as fraction (0.5 = 50% of total)
   * @default 1.0 (100%, no cap)
   */
  maxPerAdapter?: number;
  /**
   * Minimum amount to keep as idle (buffer) in basis points
   * @example 500 = 5% idle buffer
   * @default 0
   */
  idleBufferBps?: number;
  /**
   * Minimum amount to allocate in a single market
   * Smaller amounts are skipped
   * @default 0
   */
  minAllocation?: bigint;
  /**
   * Cold start capacity factor (0.5 = 50% capacity during cold start)
   * @default 1.0
   */
  coldStartFactor?: number;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Calculate the maximum amount that can be allocated to a single market,
 * respecting both the per-adapter cap and the market's capacity.
 */
function calculateMaxAllocation(
  market: AllocatableMarket,
  totalAmount: bigint,
  maxPerAdapter: bigint,
): bigint {
  // Per-adapter cap based on total assets
  const adapterCap = (totalAmount * maxPerAdapter) / WAD;

  // Current allocation to this market
  const current = market.currentAllocation ?? 0n;

  // Maximum we could allocate to reach the cap
  const toReachCap = adapterCap > current ? adapterCap - current : 0n;

  // Respect market capacity
  const capacityLimit = market.capacity > current
    ? market.capacity - current
    : 0n;

  // Return the minimum of cap headroom and capacity limit
  return toReachCap < capacityLimit ? toReachCap : capacityLimit;
}

// ============================================================================
// Greedy Allocator
// ============================================================================

/**
 * Unified greedy allocation algorithm
 *
 * This is the single source of truth for SRCLA's greedy allocation strategy.
 * It replaces three prior implementations in:
 * - optimizer/constrained-optimizer.ts
 * - evaluation/srcla-policy.ts
 * - controller/controller.ts
 *
 * DESIGN DECISIONS:
 * 1. Pure function - no side effects, fully testable
 * 2. Explicit options - all behavior controlled via parameters
 * 3. Sorted output - allocations returned in descending return order
 * 4. Clear math - WAD/RAY/BPS conventions documented
 */
export class GreedyAllocator {
  /**
   * Allocate funds across markets using greedy strategy
   *
   * @param totalAmount - Total amount to allocate (6 decimal base units)
   * @param markets - Array of markets with return forecasts and capacities
   * @param options - Configuration options
   * @returns Allocation result with breakdown
   */
  allocate(
    totalAmount: bigint,
    markets: AllocatableMarket[],
    options: AllocatorOptions = {},
  ): AllocationResult {
    const {
      maxPerAdapter = 1.0,
      idleBufferBps = 0,
      minAllocation = 0n,
      coldStartFactor = 1.0,
    } = options;

    // Calculate deployable amount after idle buffer
    const idleBuffer = (totalAmount * BigInt(idleBufferBps)) / 10000n;
    const deployableAmount = totalAmount - idleBuffer;

    // Apply cold start factor if specified
    const effectiveDeployable = coldStartFactor < 1.0
      ? (deployableAmount * BigInt(Math.floor(coldStartFactor * 10000))) / 10000n
      : deployableAmount;

    // Sort markets by expected return (descending - highest first)
    const sortedMarkets = [...markets]
      .filter((m) => m.capacity > 0n) // Skip zero-capacity markets
      .sort((a, b) => {
        // Descending order: highest return first
        if (b.expectedReturn > a.expectedReturn) return 1;
        if (b.expectedReturn < a.expectedReturn) return -1;
        return 0;
      });

    // Greedy allocation
    const allocations: MarketAllocation[] = [];
    let remaining = effectiveDeployable;
    let totalAllocated = 0n;
    let portfolioReturnSum = 0n;

    // Convert maxPerAdapter (fraction) to WAD scale
    const maxPerAdapterWad = BigInt(Math.floor(maxPerAdapter * Number(WAD)));

    for (const market of sortedMarkets) {
      if (remaining <= 0n) break;

      // Calculate maximum we can allocate to this market
      const maxForMarket = calculateMaxAllocation(
        market,
        totalAmount,
        maxPerAdapterWad,
      );

      // Amount to allocate (minimum of remaining and maxForMarket)
      const allocateAmount = maxForMarket < remaining ? maxForMarket : remaining;

      // Skip if below minimum allocation threshold
      if (allocateAmount < minAllocation) continue;

      // Record allocation
      const allocation: MarketAllocation = {
        marketId: market.id,
        amount: allocateAmount,
        expectedReturn: market.expectedReturn,
      };
      allocations.push(allocation);

      remaining -= allocateAmount;
      totalAllocated += allocateAmount;
      portfolioReturnSum += (allocateAmount * market.expectedReturn) / WAD;
    }

    // Calculate portfolio return (weighted average)
    const portfolioReturn = totalAllocated > 0n
      ? (portfolioReturnSum * WAD) / totalAllocated
      : 0n;

    return {
      allocations,
      idleAmount: totalAmount - totalAllocated,
      totalAllocated,
      portfolioReturn,
    };
  }

  /**
   * Compute the target allocation for rebalancing
   *
   * This is a specialized version for rebalancing scenarios where we need
   * to compute the delta (change) from current allocation.
   *
   * @param currentAllocation - Map of current market allocations
   * @param markets - Available markets with forecasts
   * @param totalAssets - Total vault assets
   * @param options - Standard allocation options
   * @returns Map of marketId -> target allocation
   */
  computeRebalanceTarget(
    currentAllocation: Map<string, bigint>,
    markets: AllocatableMarket[],
    totalAssets: bigint,
    options: AllocatorOptions = {},
  ): Map<string, bigint> {
    // Add current allocation to market data
    const marketsWithCurrent = markets.map((m) => ({
      ...m,
      currentAllocation: currentAllocation.get(m.id) ?? 0n,
    }));

    // Run allocation
    const result = this.allocate(totalAssets, marketsWithCurrent, options);

    // Build result map
    const target = new Map<string, bigint>();
    for (const alloc of result.allocations) {
      target.set(alloc.marketId, alloc.amount);
    }

    return target;
  }
}

