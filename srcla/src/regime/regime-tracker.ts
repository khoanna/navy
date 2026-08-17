/**
 * Regime Tracker - Tracks and transitions market regime states
 *
 * Implements regime detection and tracking per SRCLA design Section 6.2
 * and Section 7.3 (no-look-ahead and calibration gate).
 *
 * Regime transitions are based on:
 * - Utilization ratios
 * - Volatility metrics
 * - Configuration changes
 * - Minimum observation periods
 */

import {
  RegimeState,
  RegimeTransition,
  ColdStartStatus,
  RegimeThresholds,
  RegimeConfig,
  RegimeMetrics,
  RegimeDetectorConfig,
} from './types.js';

import { WAD, RAY } from '../protocols/math.js';

/**
 * Default regime thresholds (can be overridden by config)
 */
export const DEFAULT_REGIME_THRESHOLDS: RegimeThresholds = {
  // STEADY state: utilization < 80%, volatility < 10% annualized
  steadyUtilizationMax: (80n * RAY) / 100n, // 80% in RAY
  steadyVolatilityMax: (10n * WAD) / 100n, // 10% in WAD

  // VOLATILE state: utilization < 90%, volatility < 25% annualized
  volatileUtilizationMax: (90n * RAY) / 100n, // 90% in RAY
  volatileVolatilityMax: (25n * WAD) / 100n, // 25% in WAD

  // STRESSED state: utilization < 95%, volatility < 50% annualized
  stressedUtilizationMax: (95n * RAY) / 100n, // 95% in RAY
  stressedVolatilityMax: (50n * WAD) / 100n, // 50% in WAD
};

/**
 * Default regime detector configuration
 */
export const DEFAULT_REGIME_DETECTOR_CONFIG: RegimeDetectorConfig = {
  thresholds: DEFAULT_REGIME_THRESHOLDS,
  minDaysBeforeStress: 7,
  hysteresisBps: 500, // 5% hysteresis before transitioning to lower states
  coldStartDays: 7,
  coldStartCapacityFactor: 50, // 50% of normal capacity
  coldStartReserveFactor: 150, // 150% of normal reserves
};

/**
 * Regime Tracker for managing market regime states
 *
 * Tracks regime history, enforces cold start periods, and provides
 * regime state classification based on market metrics.
 */
export class RegimeTracker {
  private config: RegimeDetectorConfig;
  private regimes: Map<string, RegimeConfig> = new Map();
  private transitions: RegimeTransition[] = [];
  private metricsHistory: Map<string, RegimeMetrics[]> = new Map();
  private lastTransitionTime: Map<string, number> = new Map();

  constructor(config: Partial<RegimeDetectorConfig> = {}) {
    this.config = { ...DEFAULT_REGIME_DETECTOR_CONFIG, ...config };
  }

  /**
   * Register a new market or update existing regime
   */
  registerMarket(
    marketId: string,
    configDigest: string,
    blockHash: string
  ): void {
    const existing = this.regimes.get(marketId);
    const now = new Date();

    // Check if this is a new regime (config change)
    if (existing && existing.configDigest !== configDigest) {
      // Material configuration change - start new regime
      this.recordTransition({
        marketId,
        from: existing.currentState,
        to: RegimeState.VOLATILE, // Start in VOLATILE for new configs
        configDigest,
        blockHash,
        timestamp: now,
        reason: 'CONFIG_CHANGE: material proxy/rate/reward/oracle change detected',
      });

      this.regimes.set(marketId, {
        marketId,
        currentState: RegimeState.VOLATILE,
        configDigest,
        activatedAt: now,
        minObservationDays: this.config.coldStartDays,
        minCompletedOutcomes: 10,
      });

      // Clear metrics history for new regime (per §7.3 no-look-ahead)
      this.metricsHistory.set(marketId, []);
    } else if (!existing) {
      // New market - start in VOLATILE with cold start
      this.regimes.set(marketId, {
        marketId,
        currentState: RegimeState.VOLATILE,
        configDigest,
        activatedAt: now,
        minObservationDays: this.config.coldStartDays,
        minCompletedOutcomes: 10,
      });

      this.recordTransition({
        marketId,
        from: RegimeState.VOLATILE,
        to: RegimeState.VOLATILE,
        configDigest,
        blockHash,
        timestamp: now,
        reason: 'NEW_MARKET: initial admission',
      });
    }

    this.lastTransitionTime.set(marketId, now.getTime());
  }

  /**
   * Record a regime transition
   */
  private recordTransition(transition: RegimeTransition): void {
    this.transitions.push(transition);
  }

  /**
   * Update market metrics and evaluate regime state
   */
  updateMetrics(metrics: RegimeMetrics): RegimeState | null {
    const regime = this.regimes.get(metrics.marketId);
    if (!regime) {
      return null;
    }

    // Add to history
    const history = this.metricsHistory.get(metrics.marketId) ?? [];
    history.push(metrics);

    // Keep only recent history (last 1000 observations)
    if (history.length > 1000) {
      history.shift();
    }
    this.metricsHistory.set(metrics.marketId, history);

    // Check if in cold start
    const coldStartStatus = this.getColdStartStatus(metrics.marketId);
    if (coldStartStatus.isColdStart) {
      return regime.currentState; // Cannot transition during cold start
    }

    // Evaluate new regime state
    const newState = this.evaluateRegimeState(metrics, regime);

    // Apply hysteresis before transitioning down
    if (newState !== regime.currentState) {
      const canTransition = this.checkHysteresis(
        metrics.marketId,
        regime.currentState,
        newState
      );

      if (canTransition) {
        const oldState = regime.currentState;
        regime.currentState = newState;

        this.recordTransition({
          marketId: metrics.marketId,
          from: oldState,
          to: newState,
          configDigest: metrics.configDigest,
          blockHash: metrics.blockHash,
          timestamp: metrics.timestamp,
          reason: this.buildTransitionReason(oldState, newState, metrics),
        });

        this.lastTransitionTime.set(metrics.marketId, Date.now());
      }
    }

    return regime.currentState;
  }

  /**
   * Evaluate regime state based on current metrics
   */
  private evaluateRegimeState(
    metrics: RegimeMetrics,
    regime: RegimeConfig
  ): RegimeState {
    const { thresholds } = this.config;
    const { utilizationE18, volatilityE18 } = metrics;

    // STRESSED: very high utilization OR very high volatility
    if (
      utilizationE18 >= thresholds.stressedUtilizationMax ||
      volatilityE18 >= thresholds.stressedVolatilityMax
    ) {
      return RegimeState.STRESSED;
    }

    // VOLATILE: elevated utilization OR volatility
    if (
      utilizationE18 >= thresholds.volatileUtilizationMax ||
      volatilityE18 >= thresholds.volatileVolatilityMax
    ) {
      return RegimeState.VOLATILE;
    }

    // RECOVERY: transitioning from stressed/volatile to steady
    if (
      regime.currentState === RegimeState.STRESSED ||
      regime.currentState === RegimeState.VOLATILE
    ) {
      // Check if conditions have improved enough for RECOVERY
      if (
        utilizationE18 < thresholds.volatileUtilizationMax &&
        volatilityE18 < thresholds.volatileVolatilityMax
      ) {
        return RegimeState.RECOVERY;
      }
    }

    // STEADY: normal conditions
    return RegimeState.STEADY;
  }

  /**
   * Check hysteresis before state transition
   *
   * Prevents rapid oscillation between states by requiring
   * sustained conditions for transition.
   */
  private checkHysteresis(
    marketId: string,
    _currentState: RegimeState,
    newState: RegimeState
  ): boolean {
    const lastTransition = this.lastTransitionTime.get(marketId) ?? 0;
    const elapsedMs = Date.now() - lastTransition;

    // Allow immediate transition to STRESSED
    if (newState === RegimeState.STRESSED) {
      return true;
    }

    // For non-stressed transitions, require hysteresis period
    const hysteresisSeconds = 3600; // 1 hour minimum between non-stress transitions
    return elapsedMs >= hysteresisSeconds * 1000;
  }

  /**
   * Build human-readable transition reason
   */
  private buildTransitionReason(
    from: RegimeState,
    to: RegimeState,
    metrics: RegimeMetrics
  ): string {
    const utilizationPct = Number((metrics.utilizationE18 * 100n) / RAY);
    const volatilityPct = Number((metrics.volatilityE18 * 100n) / WAD);

    return `REGIME_CHANGE: ${from} -> ${to} (util=${utilizationPct}%, vol=${volatilityPct}%)`;
  }

  /**
   * Get current regime state for a market
   */
  getRegimeState(marketId: string): RegimeState | null {
    return this.regimes.get(marketId)?.currentState ?? null;
  }

  /**
   * Get regime configuration for a market
   */
  getRegimeConfig(marketId: string): RegimeConfig | null {
    return this.regimes.get(marketId) ?? null;
  }

  /**
   * Get cold start status for a market
   */
  getColdStartStatus(marketId: string): ColdStartStatus {
    const regime = this.regimes.get(marketId);
    if (!regime) {
      return {
        isColdStart: true,
        daysActive: 0,
        reducedCapacityFactor: 0,
        increasedReserveFactor: 0,
      };
    }

    const now = new Date();
    const msSinceActivation = now.getTime() - regime.activatedAt.getTime();
    const daysActive = Math.floor(msSinceActivation / (24 * 60 * 60 * 1000));

    const isColdStart = daysActive < this.config.coldStartDays;

    return {
      isColdStart,
      daysActive,
      reducedCapacityFactor: isColdStart
        ? this.config.coldStartCapacityFactor
        : 100,
      increasedReserveFactor: isColdStart
        ? this.config.coldStartReserveFactor
        : 100,
    };
  }

  /**
   * Check if a market is eligible for deployment based on regime and cold start
   */
  isEligible(marketId: string): boolean {
    const regime = this.regimes.get(marketId);
    if (!regime) {
      return false;
    }

    // Check cold start
    const coldStart = this.getColdStartStatus(marketId);
    if (coldStart.isColdStart) {
      return false;
    }

    // Check regime state
    // STRESSED markets are not eligible for new deployments
    if (regime.currentState === RegimeState.STRESSED) {
      return false;
    }

    // Get metrics history
    const history = this.metricsHistory.get(marketId) ?? [];

    // Check minimum completed outcomes (calibration gate per §7.3)
    if (history.length < regime.minCompletedOutcomes) {
      return false;
    }

    return true;
  }

  /**
   * Get regime transitions for a market
   */
  getTransitions(marketId?: string): RegimeTransition[] {
    if (marketId) {
      return this.transitions.filter((t) => t.marketId === marketId);
    }
    return [...this.transitions];
  }

  /**
   * Get metrics history for a market
   */
  getMetricsHistory(marketId: string, limit?: number): RegimeMetrics[] {
    const history = this.metricsHistory.get(marketId) ?? [];
    if (limit && limit > 0) {
      return history.slice(-limit);
    }
    return [...history];
  }

  /**
   * Get effective capacity for a market considering cold start
   */
  getEffectiveCapacity(
    marketId: string,
    normalCapacity: bigint
  ): bigint {
    const coldStart = this.getColdStartStatus(marketId);
    const factor = coldStart.reducedCapacityFactor;

    // Apply capacity reduction during cold start
    return (normalCapacity * BigInt(factor)) / 100n;
  }

  /**
   * Get effective reserve for a market considering cold start
   */
  getEffectiveReserve(
    marketId: string,
    normalReserve: bigint
  ): bigint {
    const coldStart = this.getColdStartStatus(marketId);
    const factor = coldStart.increasedReserveFactor;

    // Apply reserve increase during cold start
    return (normalReserve * BigInt(factor)) / 100n;
  }

  /**
   * Get all markets by regime state
   */
  getMarketsByState(state: RegimeState): string[] {
    const markets: string[] = [];
    for (const [marketId, regime] of this.regimes) {
      if (regime.currentState === state) {
        markets.push(marketId);
      }
    }
    return markets;
  }

  /**
   * Get summary statistics
   */
  getSummary(): {
    totalMarkets: number;
    byState: Record<RegimeState, number>;
    inColdStart: number;
    eligible: number;
    ineligible: number;
  } {
    const byState: Record<RegimeState, number> = {
      [RegimeState.STEADY]: 0,
      [RegimeState.VOLATILE]: 0,
      [RegimeState.STRESSED]: 0,
      [RegimeState.RECOVERY]: 0,
    };

    let inColdStart = 0;
    let eligible = 0;

    for (const [marketId, regime] of this.regimes) {
      byState[regime.currentState]++;

      const coldStart = this.getColdStartStatus(marketId);
      if (coldStart.isColdStart) {
        inColdStart++;
      }

      if (this.isEligible(marketId)) {
        eligible++;
      }
    }

    return {
      totalMarkets: this.regimes.size,
      byState,
      inColdStart,
      eligible,
      ineligible: this.regimes.size - eligible,
    };
  }
}
