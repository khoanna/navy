/**
 * Constrained Optimizer - allocates funds across adapters subject to constraints
 *
 * This module extends the GreedyAllocator with additional constraint handling:
 * - Dependency group constraints
 * - Reserve constraints
 * - Absolute exposure limits
 * - Constraint validation
 *
 * For simple greedy allocation without constraints, use GreedyAllocator directly.
 */

import { DependencyGroups } from './dependency-groups.js';
import type { ForecastResult } from '../forecast/types.js';

/**
 * Constraints for the optimization
 */
export interface OptimizationConstraints {
  /** Minimum reserve as basis points (e.g., 500 = 5%) */
  minReserveBps: bigint;
  /** Maximum market cap per adapter as basis points of TVL */
  maxMarketCapBps: bigint;
  /** Maximum total exposure for dependency groups */
  maxDependencyGroupCapBps: bigint;
  /** Maximum absolute exposure in USDC (6 decimals) */
  maxAbsoluteExposure: bigint;
  /** Minimum action amount to include in plan (6 decimals) */
  minActionAmount: bigint;
}

/**
 * Forecast data for an adapter
 */
export interface AdapterForecast {
  adapter: string;
  forecast: ForecastResult;
  capacity: bigint; // max amount that can be deployed (6 decimals)
  currentAllocation: bigint; // current amount already allocated (6 decimals)
}

/**
 * Result of the optimization
 */
export interface OptimizationResult {
  /** Allocations by adapter address (6 decimals) */
  allocations: Map<string, bigint>;
  /** Amount kept as idle/USDC (6 decimals) */
  idleAmount: bigint;
  /** Expected return for the period (6 decimals) */
  expectedReturn: bigint;
  /** Constraint violations found */
  violations: string[];
  /** Whether the optimization was successful */
  success: boolean;
}

/**
 * Constraint violation types
 */
export enum ViolationType {
  MARKET_CAP = 'MARKET_CAP',
  GROUP_CAP = 'GROUP_CAP',
  RESERVE = 'RESERVE',
  CAPACITY = 'CAPACITY',
}

/**
 * Constrained Optimizer for SRCLA
 */
export class ConstrainedOptimizer {
  private constraints: OptimizationConstraints;
  private dependencyGroups: DependencyGroups;

  constructor(constraints: OptimizationConstraints, dependencyGroups: DependencyGroups) {
    this.constraints = constraints;
    this.dependencyGroups = dependencyGroups;
  }

  /**
   * Optimize allocation given total assets and adapter forecasts
   *
   * @param totalAssets - Total assets to allocate (6 decimals)
   * @param forecasts - Array of adapter forecasts sorted by expected return (descending)
   * @returns Optimization result with allocations and violations
   */
  optimize(totalAssets: bigint, forecasts: AdapterForecast[]): OptimizationResult {
    const allocations = new Map<string, bigint>();
    const violations: string[] = [];

    // Calculate minimum reserve required
    const minReserve = (totalAssets * this.constraints.minReserveBps) / 10000n;
    const deployableAmount = totalAssets - minReserve;

    // Track group allocations for constraint checking
    const groupAllocations = new Map<string, bigint>();

    // Sort forecasts by lower return (descending) - most promising first
    const sortedForecasts = [...forecasts].sort((a, b) => {
      const returnA = a.forecast.lowerReturn;
      const returnB = b.forecast.lowerReturn;
      return returnB > returnA ? 1 : returnB < returnA ? -1 : 0;
    });

    let remainingAmount = deployableAmount;
    let expectedReturn = 0n;

    for (const item of sortedForecasts) {
      if (remainingAmount <= 0n) break;

      const { adapter, forecast: _, capacity, currentAllocation } = item;

      // Check market cap constraint
      const maxForAdapter = (totalAssets * this.constraints.maxMarketCapBps) / 10000n;
      const currentInAdapter = allocations.get(adapter) ?? 0n;

      if (currentInAdapter >= maxForAdapter) {
        violations.push(
          `Market cap reached for ${adapter}: ${currentInAdapter} >= ${maxForAdapter}`
        );
        continue;
      }

      // Calculate how much we can allocate respecting market cap
      let availableForAdapter = maxForAdapter - currentInAdapter;

      // Respect capacity constraints
      const additionalCapacity = capacity > currentAllocation
        ? capacity - currentAllocation
        : 0n;
      availableForAdapter = availableForAdapter < additionalCapacity
        ? availableForAdapter
        : additionalCapacity;

      // Respect dependency group constraints
      const groupCaps = this.dependencyGroups.getGroupCapsForAdapter(adapter);
      for (const [groupId, groupCapBps] of groupCaps) {
        const currentGroupAllocation = groupAllocations.get(groupId) ?? 0n;
        const maxGroupAllocation = (totalAssets * groupCapBps) / 10000n;
        const remainingGroupCapacity = maxGroupAllocation > currentGroupAllocation
          ? maxGroupAllocation - currentGroupAllocation
          : 0n;
        availableForAdapter = availableForAdapter < remainingGroupCapacity
          ? availableForAdapter
          : remainingGroupCapacity;

        if (remainingGroupCapacity === 0n && currentGroupAllocation >= maxGroupAllocation) {
          violations.push(
            `Group cap reached for ${groupId} on ${adapter}: ${currentGroupAllocation} >= ${maxGroupAllocation}`
          );
        }
      }

      // Respect max absolute exposure
      const totalCurrentAllocation = Array.from(allocations.values()).reduce(
        (sum, amt) => sum + amt,
        0n
      );
      const remainingAbsoluteExposure = this.constraints.maxAbsoluteExposure > totalCurrentAllocation
        ? this.constraints.maxAbsoluteExposure - totalCurrentAllocation
        : 0n;
      availableForAdapter = availableForAdapter < remainingAbsoluteExposure
        ? availableForAdapter
        : remainingAbsoluteExposure;

      // Allocate what we can
      const allocatedAmount = remainingAmount < availableForAdapter
        ? remainingAmount
        : availableForAdapter;

      // Filter by minimum action amount
      if (allocatedAmount >= this.constraints.minActionAmount) {
        const newAllocation = (allocations.get(adapter) ?? 0n) + allocatedAmount;
        allocations.set(adapter, newAllocation);
        remainingAmount -= allocatedAmount;

        // Update expected return
        expectedReturn += (allocatedAmount * item.forecast.meanReturn) / 10000n;

        // Update group allocations
        for (const groupId of groupCaps.keys()) {
          const current = groupAllocations.get(groupId) ?? 0n;
          groupAllocations.set(groupId, current + allocatedAmount);
        }
      }
    }

    // Calculate final idle amount (including reserve)
    const deployedAmount = Array.from(allocations.values()).reduce(
      (sum, amt) => sum + amt,
      0n
    );
    const idleAmount = totalAssets - deployedAmount;

    // Validate reserve constraint
    if (idleAmount < minReserve) {
      violations.push(
        `Reserve constraint violated: ${idleAmount} < ${minReserve} (${this.constraints.minReserveBps} bps)`
      );
    }

    // Validate all dependency group constraints
    const groupViolations = this.validateGroupConstraints(allocations, totalAssets);
    violations.push(...groupViolations);

    return {
      allocations,
      idleAmount,
      expectedReturn,
      violations,
      success: violations.length === 0,
    };
  }

  /**
   * Validate dependency group constraints
   */
  private validateGroupConstraints(
    allocations: Map<string, bigint>,
    totalAssets: bigint
  ): string[] {
    const violations: string[] = [];
    const allGroups = this.dependencyGroups.getGroups();

    for (const [groupId, group] of allGroups) {
      let groupTotal = 0n;
      for (const adapter of group.adapters) {
        groupTotal += allocations.get(adapter) ?? 0n;
      }

      const maxGroupAllocation = (totalAssets * group.capBps) / 10000n;
      if (groupTotal > maxGroupAllocation) {
        violations.push(
          `Group ${groupId} cap exceeded: ${groupTotal} > ${maxGroupAllocation} (${group.capBps} bps)`
        );
      }
    }

    return violations;
  }

  /**
   * Calculate the delta (change) needed from current allocations to target
   */
  calculateDelta(
    currentAllocations: Map<string, bigint>,
    targetAllocations: Map<string, bigint>
  ): Map<string, bigint> {
    const delta = new Map<string, bigint>();

    // Add new allocations
    for (const [adapter, target] of targetAllocations) {
      const current = currentAllocations.get(adapter) ?? 0n;
      const diff = target - current;
      if (diff > 0) {
        delta.set(adapter, diff);
      }
    }

    // Subtract reduced allocations
    for (const [adapter, current] of currentAllocations) {
      const target = targetAllocations.get(adapter) ?? 0n;
      const diff = current - target;
      if (diff > 0) {
        delta.set(adapter, -diff);
      }
    }

    return delta;
  }

  /**
   * Filter actions to only include those above minimum threshold
   */
  filterActionsByMinimum(
    actions: Map<string, bigint>
  ): Map<string, bigint> {
    const filtered = new Map<string, bigint>();
    for (const [adapter, amount] of actions) {
      if (amount >= this.constraints.minActionAmount) {
        filtered.set(adapter, amount);
      }
    }
    return filtered;
  }
}
