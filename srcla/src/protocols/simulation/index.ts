/**
 * Simulation Engine
 *
 * Orchestrates post-deposit interest rate simulation across multiple
 * lending protocols. The SimulationEngine provides a unified interface
 * for simulating deposits across Aave V3, Compound III, and Moonwell,
 * enabling SRCLA to make informed allocation decisions.
 *
 * @module protocols/simulation
 */

import { WAD } from '../math.js';
import {
  AaveSimulatorConfig,
  CompoundSimulatorConfig,
  DEFAULT_AAVE_CONFIG,
  DEFAULT_COMPOUND_CONFIG,
  DEFAULT_MOONWELL_CONFIG,
  DetailedSimulatedRate,
  ISimulator,
  MarketState,
  MoonwellSimulatorConfig,
  SimulatedRate,
} from './types.js';
import { AaveV3Simulator } from './aave-simulator.js';
import { CompoundV3Simulator } from './compound-simulator.js';
import { MoonwellSimulator } from './moonwell-simulator.js';

// ============================================================================
// Protocol Identifiers
// ============================================================================

/** Supported lending protocols for simulation */
export type ProtocolId = 'aave' | 'compound' | 'moonwell';

/** Mapping from protocol ID to simulator instances */
export const ProtocolSimulators: Record<ProtocolId, ISimulator> = {
  aave: new AaveV3Simulator(),
  compound: new CompoundV3Simulator(),
  moonwell: new MoonwellSimulator(),
};

/** Default configurations for each protocol */
export const DefaultConfigs: Record<ProtocolId, AaveSimulatorConfig | CompoundSimulatorConfig | MoonwellSimulatorConfig> = {
  aave: DEFAULT_AAVE_CONFIG,
  compound: DEFAULT_COMPOUND_CONFIG,
  moonwell: DEFAULT_MOONWELL_CONFIG,
};

// ============================================================================
// Simulation Engine
// ============================================================================

/**
 * Simulation Engine Configuration
 */
export interface SimulationEngineConfig {
  /** Custom configurations per protocol */
  configs?: Partial<Record<ProtocolId, AaveSimulatorConfig | CompoundSimulatorConfig | MoonwellSimulatorConfig>>;
  /** Default deposit amount for batch simulation */
  defaultDepositAmount?: bigint;
}

/**
 * Simulation Engine
 *
 * Main orchestrator for post-deposit rate simulation across multiple
 * lending protocols. Provides batch simulation, comparison, and
 * capacity analysis capabilities.
 *
 * @example
 * ```typescript
 * const engine = new SimulationEngine();
 *
 * // Simulate a deposit across all markets
 * const results = engine.simulateBatch(markets, 10_000_000_000_000n);
 *
 * // Find the best market for a deposit
 * const best = engine.findBestMarket(markets, 10_000_000_000_000n);
 *
 * // Get detailed comparison
 * const comparison = engine.compareMarkets(markets, 5_000_000_000_000n);
 * ```
 */
export class SimulationEngine {
  private simulators: Map<ProtocolId, ISimulator>;
  private configs: Record<ProtocolId, AaveSimulatorConfig | CompoundSimulatorConfig | MoonwellSimulatorConfig>;
  private defaultDepositAmount: bigint;

  /**
   * Create a new SimulationEngine.
   *
   * @param config - Optional configuration
   */
  constructor(config?: SimulationEngineConfig) {
    // Initialize simulators
    this.simulators = new Map<ProtocolId, ISimulator>([
      ['aave', new AaveV3Simulator()],
      ['compound', new CompoundV3Simulator()],
      ['moonwell', new MoonwellSimulator()],
    ]);

    // Initialize configs with defaults
    this.configs = { ...DefaultConfigs };

    // Override with custom configs if provided
    if (config?.configs) {
      for (const [protocol, customConfig] of Object.entries(config.configs)) {
        if (customConfig) {
          this.configs[protocol as ProtocolId] = customConfig;
        }
      }
    }

    // Set default deposit amount (10M USDC)
    this.defaultDepositAmount = config?.defaultDepositAmount ?? 10_000_000_000_000n;
  }

  /**
   * Detect the protocol type from market ID.
   *
   * @param marketId - Market identifier
   * @returns Detected protocol or 'aave' as default
   */
  detectProtocol(marketId: string): ProtocolId {
    const lower = marketId.toLowerCase();
    if (lower.includes('compound')) return 'compound';
    if (lower.includes('moonwell')) return 'moonwell';
    if (lower.includes('aave')) return 'aave';
    return 'aave'; // Default to Aave
  }

  /**
   * Get the simulator for a specific protocol.
   *
   * @param protocol - Protocol identifier
   * @returns Simulator instance
   */
  getSimulator(protocol: ProtocolId): ISimulator {
    const simulator = this.simulators.get(protocol);
    if (!simulator) {
      throw new Error(`Unknown protocol: ${protocol}`);
    }
    return simulator;
  }

  /**
   * Get the configuration for a specific protocol.
   *
   * @param protocol - Protocol identifier
   * @returns Configuration
   */
  getConfig(protocol: ProtocolId): AaveSimulatorConfig | CompoundSimulatorConfig | MoonwellSimulatorConfig {
    return this.configs[protocol];
  }

  /**
   * Simulate a deposit on a single market.
   *
   * @param state - Market state
   * @param depositAmount - Amount to deposit
   * @param protocol - Optional protocol override
   * @returns Simulation result
   */
  simulate(
    state: MarketState,
    depositAmount: bigint,
    protocol?: ProtocolId
  ): SimulatedRate {
    const detectedProtocol = protocol ?? this.detectProtocol(state.marketId);
    const simulator = this.getSimulator(detectedProtocol);
    const config = this.configs[detectedProtocol];

    return simulator.simulateRate(state, depositAmount, config);
  }

  /**
   * Simulate a deposit on multiple markets.
   *
   * @param states - Array of market states
   * @param depositAmount - Amount to deposit per market
   * @returns Array of simulation results
   */
  simulateBatch(
    states: MarketState[],
    depositAmount: bigint = this.defaultDepositAmount
  ): SimulatedRate[] {
    return states.map(state => this.simulate(state, depositAmount));
  }

  /**
   * Simulate with detailed metadata.
   *
   * @param state - Market state
   * @param depositAmount - Amount to deposit
   * @param protocol - Optional protocol override
   * @returns Detailed simulation result
   */
  simulateDetailed(
    state: MarketState,
    depositAmount: bigint,
    protocol?: ProtocolId
  ): DetailedSimulatedRate {
    const detectedProtocol = protocol ?? this.detectProtocol(state.marketId);
    const result = this.simulate(state, depositAmount, detectedProtocol);

    const rateImpact = state.supplyRate - result.postDepositRate;
    const rateImpactPercent = state.supplyRate > 0n
      ? (rateImpact * WAD) / state.supplyRate
      : 0n;

    return {
      ...result,
      marketName: state.name,
      simulatedDeposit: depositAmount,
      rateImpact,
      rateImpactPercent,
      wouldExceedCapacity: depositAmount > result.effectiveCapacity,
    };
  }

  /**
   * Find the best market for a deposit based on post-deposit yield.
   *
   * @param states - Array of market states
   * @param depositAmount - Amount to deposit
   * @returns Best market with detailed simulation
   */
  findBestMarket(
    states: MarketState[],
    depositAmount: bigint = this.defaultDepositAmount
  ): DetailedSimulatedRate | null {
    if (states.length === 0) return null;

    const detailed = states.map(state =>
      this.simulateDetailed(state, depositAmount)
    );

    // Sort by post-deposit rate (descending)
    detailed.sort((a, b) =>
      b.postDepositRate > a.postDepositRate ? 1 : -1
    );

    return detailed[0] ?? null;
  }

  /**
   * Compare all markets and return sorted results.
   *
   * @param states - Array of market states
   * @param depositAmount - Amount to deposit
   * @returns Sorted array of detailed simulations (best first)
   */
  compareMarkets(
    states: MarketState[],
    depositAmount: bigint = this.defaultDepositAmount
  ): DetailedSimulatedRate[] {
    return states
      .map(state => this.simulateDetailed(state, depositAmount))
      .sort((a, b) =>
        b.postDepositRate > a.postDepositRate ? 1 : -1
      );
  }

  /**
   * Calculate total effective capacity across all markets.
   *
   * @param states - Array of market states
   * @returns Total effective capacity (USDC base units)
   */
  totalEffectiveCapacity(states: MarketState[]): bigint {
    return states.reduce((total, state) => {
      const protocol = this.detectProtocol(state.marketId);
      const result = this.simulate(state, 0n, protocol);
      return total + result.effectiveCapacity;
    }, 0n);
  }

  /**
   * Calculate weighted average post-deposit rate.
   *
   * @param states - Array of market states
   * @param allocations - Allocation amounts per market (same order as states)
   * @returns Weighted average rate (WAD)
   */
  weightedAverageRate(
    states: MarketState[],
    allocations: bigint[]
  ): bigint {
    if (states.length !== allocations.length) {
      throw new Error('States and allocations must have same length');
    }

    let totalWeight = 0n;
    let weightedRate = 0n;

    for (let i = 0; i < states.length; i++) {
      const state = states[i];
      const allocation = allocations[i];
      if (!state || allocation === undefined || allocation === 0n) continue;

      const result = this.simulate(state, allocation);
      totalWeight += allocation;
      weightedRate += result.postDepositRate * allocation;
    }

    if (totalWeight === 0n) return 0n;
    return weightedRate / totalWeight;
  }

  /**
   * Calculate rate impact summary across all markets.
   *
   * @param states - Array of market states
   * @param depositAmount - Amount to deposit
   * @returns Summary of rate impacts
   */
  rateImpactSummary(
    states: MarketState[],
    depositAmount: bigint = this.defaultDepositAmount
  ): {
    averageImpact: bigint;
    worstImpact: bigint;
    bestImpact: bigint;
    impacts: bigint[];
  } {
    const impacts: bigint[] = [];

    for (const state of states) {
      const result = this.simulate(state, depositAmount);
      if (state.supplyRate > 0n) {
        const impact = state.supplyRate - result.postDepositRate;
        const impactPercent = (impact * WAD) / state.supplyRate;
        impacts.push(impactPercent);
      }
    }

    if (impacts.length === 0) {
      return {
        averageImpact: 0n,
        worstImpact: 0n,
        bestImpact: 0n,
        impacts: [],
      };
    }

    // Sort impacts
    impacts.sort((a, b) => Number(a - b));

    const sum = impacts.reduce((a, b) => a + b, 0n);
    const averageImpact = sum / BigInt(impacts.length);

    return {
      averageImpact,
      worstImpact: impacts[0] ?? 0n, // Smallest (most negative) impact
      bestImpact: impacts[impacts.length - 1] ?? 0n, // Largest (least negative) impact
      impacts,
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a simulation engine with Aave-specific configuration.
 *
 * @param customConfig - Optional Aave config override
 * @returns Configured SimulationEngine
 */
export function createAaveSimulationEngine(
  customConfig?: Partial<AaveSimulatorConfig>
): SimulationEngine {
  const config: SimulationEngineConfig = {
    configs: {
      aave: { ...DEFAULT_AAVE_CONFIG, ...customConfig },
    },
  };
  return new SimulationEngine(config);
}

/**
 * Create a simulation engine with Compound-specific configuration.
 *
 * @param customConfig - Optional Compound config override
 * @returns Configured SimulationEngine
 */
export function createCompoundSimulationEngine(
  customConfig?: Partial<CompoundSimulatorConfig>
): SimulationEngine {
  const config: SimulationEngineConfig = {
    configs: {
      compound: { ...DEFAULT_COMPOUND_CONFIG, ...customConfig },
    },
  };
  return new SimulationEngine(config);
}

/**
 * Create a simulation engine with Moonwell-specific configuration.
 *
 * @param customConfig - Optional Moonwell config override
 * @returns Configured SimulationEngine
 */
export function createMoonwellSimulationEngine(
  customConfig?: Partial<MoonwellSimulatorConfig>
): SimulationEngine {
  const config: SimulationEngineConfig = {
    configs: {
      moonwell: { ...DEFAULT_MOONWELL_CONFIG, ...customConfig },
    },
  };
  return new SimulationEngine(config);
}

// ============================================================================
// Exports
// ============================================================================

// Types
export {
  AaveSimulatorConfig,
  CompoundSimulatorConfig,
  DetailedSimulatedRate,
  ISimulator,
  MarketState,
  MoonwellSimulatorConfig,
  SimulatedRate,
  SimulatorConfig,
} from './types.js';

// Simulators
export { AaveV3Simulator } from './aave-simulator.js';
export { CompoundV3Simulator } from './compound-simulator.js';
export { MoonwellSimulator } from './moonwell-simulator.js';

// Engine - SimulationEngine is defined above in this file
