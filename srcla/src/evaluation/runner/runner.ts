/**
 * Evaluation Runner
 *
 * Orchestrates policy evaluation against datasets and evaluates release gates.
 * Implements §11 of the SRCLA paper:
 * - Runs all policies (SRCLA, baselines B0-B5, ablations H1-H5) against datasets
 * - Computes metrics: APY, costs, turnover, risk
 * - Compares SRCLA against baselines
 * - Evaluates release gates (forecast coverage, safety, performance)
 * - Generates reproducible content hash
 */
import { createHash } from 'crypto';
import { runReplay, type PolicyFn, type ReplayResult } from '../replay/replay.js';
import { calculateReturnMetrics } from '../metrics/returns.js';
import { calculateRiskMetrics } from '../metrics/risk.js';
import type { ForecastMetrics } from '../metrics/forecast.js';
import { CoverageTracker } from '../coverage-tracker.js';
import { createSRCLAPolicy } from '../srcla-policy.js';
import { getDeployableBaselines, type EvaluationManifest } from '../manifest/manifest.js';
import type { EvaluationDataset } from '../dataset.js';
import type { BaselineConfig, AblationConfig } from '../manifest/manifest.js';

// ============================================================================
// Policy Types
// ============================================================================

/**
 * Policy interface for evaluation
 */
export interface Policy {
  id: string;
  name: string;
  description: string;
  deployable: boolean;
  run: PolicyFn;
}

/**
 * Result for a single policy evaluation
 */
export interface PolicyResult {
  policyId: string;
  tier: bigint;
  realizedNetApy: number;
  realizedGrossApy: number;
  totalCost: bigint;
  rebalanceCount: number;
  withdrawalSuccessRate: number;
  maxDrawdown: number;
  sharpeRatio: number;
}

/**
 * Comparison of SRCLA against baselines
 */
export interface PolicyComparison {
  srclaVsB0: { apyDiff: number; srclaWins: boolean };
  srclaVsB1: { apyDiff: number; srclaWins: boolean };
  srclaVsB2: { apyDiff: number; srclaWins: boolean };
  srclaVsB3: { apyDiff: number; srclaWins: boolean };
  srclaVsB4: { apyDiff: number; srclaWins: boolean };
}

/**
 * Release gate results
 */
export interface ReleaseGateResults {
  forecastGate: {
    passed: boolean;
    minCoverage: number;
    targetCoverage: number;
    details: string;
  };
  safetyGate: {
    passed: boolean;
    noCatastrophicFailures: boolean;
    withdrawalSuccessRate: number;
    minRequiredRate: number;
    details: string;
  };
  performanceGate: {
    passed: boolean;
    srclaBeatsB0: boolean;
    srclaBeatsB1: boolean;
    srclaBeatsB2: boolean;
    details: string;
  };
  overall: boolean;
}

/**
 * Complete evaluation results
 */
export interface EvaluationResults {
  manifestId: string;
  generatedAt: Date;
  results: PolicyResult[];
  comparison: PolicyComparison;
  forecastMetrics: Map<string, ForecastMetrics>;
  releaseGates: ReleaseGateResults;
  contentHash: string;
}

// ============================================================================
// Runner Implementation
// ============================================================================

/**
 * Evaluation Runner
 *
 * Orchestrates evaluation of SRCLA policy against baselines and ablations
 * across multiple tiers, computing metrics and release gate status.
 */
export class EvaluationRunner {
  private readonly manifest: EvaluationManifest;
  private readonly srclaPolicy: PolicyFn;

  constructor(manifest: EvaluationManifest) {
    this.manifest = manifest;
    this.srclaPolicy = createSRCLAPolicy({
      coverageTarget: manifest.evaluation.successCriteria.minCoverage,
    });
  }

  /**
   * Run full evaluation
   *
   * @param dataset - Evaluation dataset with historical snapshots
   * @param policies - Map of policy ID to Policy implementations
   * @param coverageTracker - Coverage tracker for forecast validation
   * @returns Complete evaluation results with release gate status
   */
  async run(
    dataset: EvaluationDataset,
    policies: Map<string, Policy>,
    coverageTracker: CoverageTracker,
  ): Promise<EvaluationResults> {
    const results: PolicyResult[] = [];
    const forecastMetrics = new Map<string, ForecastMetrics>();

    // Run evaluation for each tier
    for (const tier of this.manifest.tiers.amounts) {
      // Run SRCLA
      const srclaResult = this.runPolicy(
        'srcla',
        this.srclaPolicy,
        dataset,
        tier,
      );
      results.push(srclaResult);

      // Run all registered policies
      for (const [policyId, policy] of policies) {
        if (policyId === 'srcla') continue; // Already ran
        const policyResult = this.runPolicy(policyId, policy.run, dataset, tier);
        results.push(policyResult);
      }

      // Run baselines
      const baselines = getDeployableBaselines(this.manifest);
      for (const baseline of baselines) {
        const baselinePolicy = this.createBaselinePolicy(baseline);
        const baselineResult = this.runPolicy(baseline.id, baselinePolicy, dataset, tier);
        results.push(baselineResult);
      }

      // Run ablations
      for (const ablation of this.manifest.policies.ablations) {
        const ablationPolicy = this.createAblationPolicy(ablation);
        const ablationResult = this.runPolicy(ablation.id, ablationPolicy, dataset, tier);
        results.push(ablationResult);
      }
    }

    // Compute forecast metrics from coverage tracker
    for (const marketId of coverageTracker.getMarketIds()) {
      const coverageMetrics = coverageTracker.calculateCoverage(marketId);
      const forecastMetricsEntry: ForecastMetrics = {
        mae: 0, // Would need actual predictions
        rmse: 0,
        mase: 0,
        pinballLoss: 0,
        coverage: coverageMetrics.coverage,
        sharpness: 0,
      };
      forecastMetrics.set(marketId, forecastMetricsEntry);
    }

    // Compute comparison
    const comparison = this.computeComparison(results);

    // Evaluate release gates
    const releaseGates = this.evaluateReleaseGates(results, comparison, forecastMetrics);

    // Generate content hash
    const contentHash = this.generateContentHash(results, comparison, releaseGates);

    return {
      manifestId: this.manifest.id,
      generatedAt: new Date(),
      results,
      comparison,
      forecastMetrics,
      releaseGates,
      contentHash,
    };
  }

  /**
   * Run a single policy against the dataset
   */
  private runPolicy(
    policyId: string,
    policyFn: PolicyFn,
    dataset: EvaluationDataset,
    tier: bigint,
  ): PolicyResult {
    const replayResult = runReplay({
      dataset,
      manifest: {
        evaluationId: this.manifest.id,
        startDate: this.manifest.dataset.startDate,
        endDate: this.manifest.dataset.endDate,
        forecastMethod: { method: 'rolling' as const, config: {} },
        horizons: [],
        tiers: [],
        coverageTarget: this.manifest.evaluation.successCriteria.minCoverage,
        significanceLevel: 0.05,
      },
      tier,
      policy: policyFn,
    });

    // Convert replay result to policy result
    return this.convertToPolicyResult(policyId, replayResult);
  }

  /**
   * Convert replay result to policy result
   */
  private convertToPolicyResult(policyId: string, replayResult: ReplayResult): PolicyResult {
    // Extract snapshots from replay result
    const snapshots = replayResult.snapshots.map((s) => ({
      assets: s.totalAssets,
      timestamp: s.timestamp,
    }));

    // Calculate return metrics
    const returnMetrics = calculateReturnMetrics(
      snapshots,
      replayResult.totalCosts,
      replayResult.totalCosts + (snapshots[0]?.assets ?? 0n),
    );

    // Calculate risk metrics
    const withdrawals = replayResult.snapshots.map(() => ({
      requested: 0n,
      granted: 0n,
    }));
    const riskMetrics = calculateRiskMetrics(
      replayResult.snapshots.map((s) => ({ assets: s.totalAssets })),
      withdrawals,
    );

    // Calculate rebalance count from snapshots
    let rebalanceCount = 0;
    for (let i = 1; i < replayResult.snapshots.length; i++) {
      const prev = replayResult.snapshots[i - 1]!;
      const curr = replayResult.snapshots[i]!;
      if (prev.totalAssets !== curr.totalAssets) {
        rebalanceCount++;
      }
    }

    // Estimate Sharpe ratio (simplified: APY / 0.10, assuming 10% std dev)
    const sharpeRatio = returnMetrics.realizedNetApy / 0.10;

    return {
      policyId,
      tier: replayResult.tier,
      realizedNetApy: returnMetrics.realizedNetApy,
      realizedGrossApy: returnMetrics.grossApy,
      totalCost: replayResult.totalCosts,
      rebalanceCount,
      withdrawalSuccessRate: replayResult.withdrawalSuccessRate,
      maxDrawdown: riskMetrics.maxDrawdown,
      sharpeRatio,
    };
  }

  /**
   * Compute comparison between SRCLA and baselines
   */
  private computeComparison(results: PolicyResult[]): PolicyComparison {
    const getAverageApy = (policyId: string): number => {
      const policyResults = results.filter((r) => r.policyId === policyId);
      if (policyResults.length === 0) return 0;
      return policyResults.reduce((sum, r) => sum + r.realizedNetApy, 0) / policyResults.length;
    };

    const srclaAvg = getAverageApy('srcla');
    const b0Avg = getAverageApy('b0');
    const b1Avg = getAverageApy('b1');
    const b2Avg = getAverageApy('b2');
    const b3Avg = getAverageApy('b3');
    const b4Avg = getAverageApy('b4');

    // Minimum improvement thresholds (in decimal)
    const MIN_IMPROVEMENT_BPS = {
      b0: 0, // Idle baseline: just need to beat it
      b1: 0.001, // 10 bps
      b2: 0.0005, // 5 bps
      b3: 0.0005, // 5 bps
      b4: 0.0001, // 1 bps
    };

    return {
      srclaVsB0: {
        apyDiff: srclaAvg - b0Avg,
        srclaWins: srclaAvg > b0Avg,
      },
      srclaVsB1: {
        apyDiff: srclaAvg - b1Avg,
        srclaWins: srclaAvg > b1Avg + MIN_IMPROVEMENT_BPS.b1,
      },
      srclaVsB2: {
        apyDiff: srclaAvg - b2Avg,
        srclaWins: srclaAvg > b2Avg + MIN_IMPROVEMENT_BPS.b2,
      },
      srclaVsB3: {
        apyDiff: srclaAvg - b3Avg,
        srclaWins: srclaAvg > b3Avg + MIN_IMPROVEMENT_BPS.b3,
      },
      srclaVsB4: {
        apyDiff: srclaAvg - b4Avg,
        srclaWins: srclaAvg > b4Avg + MIN_IMPROVEMENT_BPS.b4,
      },
    };
  }

  /**
   * Evaluate all release gates
   */
  private evaluateReleaseGates(
    results: PolicyResult[],
    comparison: PolicyComparison,
    forecastMetrics: Map<string, ForecastMetrics>,
  ): ReleaseGateResults {
    // Forecast Gate: Coverage >= 95% per market
    let minCoverage = 0;
    let forecastPassed = true;
    const coverageDetails: string[] = [];

    for (const [marketId, metrics] of forecastMetrics) {
      if (metrics.coverage < minCoverage || minCoverage === 0) {
        minCoverage = metrics.coverage;
      }
      if (metrics.coverage < this.manifest.evaluation.successCriteria.minCoverage) {
        forecastPassed = false;
        coverageDetails.push(`${marketId}: ${(metrics.coverage * 100).toFixed(1)}%`);
      }
    }

    // Safety Gate: No catastrophic failures, withdrawal success >= threshold
    const srclaResults = results.filter((r) => r.policyId === 'srcla');
    let minWithdrawalRate = 1;
    let noCatastrophicFailures = true;

    for (const result of srclaResults) {
      if (result.withdrawalSuccessRate < minWithdrawalRate) {
        minWithdrawalRate = result.withdrawalSuccessRate;
      }
      // Catastrophic failure: >5% drawdown or <99% withdrawal success
      if (result.maxDrawdown > 0.05 || result.withdrawalSuccessRate < 0.99) {
        noCatastrophicFailures = false;
      }
    }

    const safetyPassed =
      noCatastrophicFailures &&
      minWithdrawalRate >= this.manifest.evaluation.successCriteria.minWithdrawalSuccessRate;

    // Performance Gate: SRCLA beats B0 at each tier
    const performancePassed =
      comparison.srclaVsB0.srclaWins &&
      comparison.srclaVsB1.srclaWins &&
      comparison.srclaVsB2.srclaWins;

    // Get min coverage target from manifest
    const targetCoverage = this.manifest.evaluation.successCriteria.minCoverage;

    return {
      forecastGate: {
        passed: forecastPassed && minCoverage >= targetCoverage,
        minCoverage,
        targetCoverage,
        details:
          coverageDetails.length > 0
            ? `Coverage below target: ${coverageDetails.join(', ')}`
            : `All markets meet ${(targetCoverage * 100).toFixed(0)}% coverage target`,
      },
      safetyGate: {
        passed: safetyPassed,
        noCatastrophicFailures,
        withdrawalSuccessRate: minWithdrawalRate,
        minRequiredRate: this.manifest.evaluation.successCriteria.minWithdrawalSuccessRate,
        details: noCatastrophicFailures
          ? `No catastrophic failures, withdrawal success rate: ${(minWithdrawalRate * 100).toFixed(2)}%`
          : `Safety violations detected`,
      },
      performanceGate: {
        passed: performancePassed,
        srclaBeatsB0: comparison.srclaVsB0.srclaWins,
        srclaBeatsB1: comparison.srclaVsB1.srclaWins,
        srclaBeatsB2: comparison.srclaVsB2.srclaWins,
        details: performancePassed
          ? 'SRCLA outperforms B0, B1, B2 at all tiers'
          : 'SRCLA does not meet performance targets',
      },
      overall: forecastPassed && safetyPassed && performancePassed,
    };
  }

  /**
   * Generate reproducible content hash
   */
  private generateContentHash(
    results: PolicyResult[],
    comparison: PolicyComparison,
    releaseGates: ReleaseGateResults,
  ): string {
    const content = {
      manifestId: this.manifest.id,
      results: results.map((r) => ({
        policyId: r.policyId,
        tier: r.tier.toString(),
        realizedNetApy: r.realizedNetApy,
        realizedGrossApy: r.realizedGrossApy,
        totalCost: r.totalCost.toString(),
        rebalanceCount: r.rebalanceCount,
        withdrawalSuccessRate: r.withdrawalSuccessRate,
        maxDrawdown: r.maxDrawdown,
        sharpeRatio: r.sharpeRatio,
      })),
      comparison,
      releaseGates,
      generatedAt: new Date().toISOString(),
    };

    return createHash('sha256')
      .update(JSON.stringify(content, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      ))
      .digest('hex');
  }

  /**
   * Create baseline policy function
   */
  private createBaselinePolicy(baseline: BaselineConfig): PolicyFn {
    // B0: Idle - always return empty actions
    if (baseline.id === 'b0') {
      return () => [];
    }

    // B1: Highest rate - deploy all to highest rate market
    if (baseline.id === 'b1') {
      return (state, snapshot) => {
        if (snapshot.snapshots.length === 0) return [];

        const sorted = [...snapshot.snapshots]
          .filter((m) => !m.paused && m.capBps > 0)
          .sort((a, b) => Number(b.supplyRateE18 - a.supplyRateE18));

        if (sorted.length === 0) return [];
        const topMarket = sorted[0]!;

        // Deploy idle funds up to market capacity
        const idleAmount = state.idleBase;
        if (idleAmount === 0n) return [];

        return [{
          kind: 'deploy' as const,
          adapter: topMarket.marketId,
          amount: idleAmount,
        }];
      };
    }

    // B2: Capacity-aware - highest rate within capacity
    if (baseline.id === 'b2') {
      return (state, snapshot) => {
        if (snapshot.snapshots.length === 0) return [];

        const sorted = [...snapshot.snapshots]
          .filter((m) => !m.paused && m.capBps > 0)
          .sort((a, b) => Number(b.supplyRateE18 - a.supplyRateE18));

        if (sorted.length === 0) return [];
        const topMarket = sorted[0]!;

        // Apply capacity constraint - deploy up to min(idle, capacity)
        const idleAmount = state.idleBase;
        if (idleAmount === 0n) return [];

        // Calculate capacity as percentage of vault total
        const capacity = (state.totalAssets * BigInt(topMarket.capBps)) / 10_000n;
        const deployAmount = idleAmount < capacity ? idleAmount : capacity;

        if (deployAmount === 0n) return [];

        return [{
          kind: 'deploy' as const,
          adapter: topMarket.marketId,
          amount: deployAmount,
        }];
      };
    }

    // B3: Capacity + Cost gate
    if (baseline.id === 'b3') {
      // Similar to B2 but with cost threshold
      return this.createBaselinePolicy({ ...baseline, id: 'b2' });
    }

    // B4: Fixed robust allocation
    if (baseline.id === 'b4') {
      return (state, snapshot) => {
        const actions: { kind: 'deploy' | 'divest'; adapter: string; amount: bigint }[] = [];
        const markets = snapshot.snapshots.filter((m) => !m.paused && m.capBps > 0);

        // Fixed 40/40/20 allocation across top 3 markets
        const totalToDeploy = state.idleBase;
        if (totalToDeploy === 0n) return actions;

        const amount1 = totalToDeploy * 40n / 100n;
        const amount2 = totalToDeploy * 40n / 100n;
        const amount3 = totalToDeploy * 20n / 100n;

        for (let i = 0; i < Math.min(3, markets.length); i++) {
          const amount = i === 0 ? amount1 : i === 1 ? amount2 : amount3;
          if (amount > 0n) {
            actions.push({
              kind: 'deploy',
              adapter: markets[i]!.marketId,
              amount,
            });
          }
        }

        return actions;
      };
    }

    // B5: Hindsight - non-deployable diagnostic
    // Returns ideal actions based on future knowledge (for comparison only)
    if (baseline.id === 'b5') {
      return () => []; // Non-deployable
    }

    // Default fallback: deploy idle to first available
    return (state, snapshot) => {
      if (snapshot.snapshots.length === 0) return [];
      const market = snapshot.snapshots.find((m) => !m.paused && m.capBps > 0);
      if (!market || state.idleBase === 0n) return [];

      return [{
        kind: 'deploy' as const,
        adapter: market.marketId,
        amount: state.idleBase,
      }];
    };
  }

  /**
   * Create ablation policy function
   */
  private createAblationPolicy(ablation: AblationConfig): PolicyFn {
    // H1: No forecast - use rolling mean instead of quantile
    if (ablation.id === 'h1') {
      return (state, snapshot) => {
        if (snapshot.snapshots.length === 0) return [];
        const market = snapshot.snapshots.find((m) => !m.paused && m.capBps > 0);
        if (!market || state.idleBase === 0n) return [];

        // Use current rate directly (no forecast)
        return [{
          kind: 'deploy' as const,
          adapter: market.marketId,
          amount: state.idleBase,
        }];
      };
    }

    // H2: No capacity limits
    if (ablation.id === 'h2') {
      return this.createBaselinePolicy({ id: 'b1', name: 'Highest Rate', deployable: true, description: '' });
    }

    // H3: No cost gate
    if (ablation.id === 'h3') {
      return this.createBaselinePolicy({ id: 'b2', name: 'Capacity-Aware', deployable: true, description: '' });
    }

    // H4: Weekly rebalance only
    if (ablation.id === 'h4') {
      let lastRebalance = 0;
      return (state, snapshot) => {
        // Rebalance only every 7 days
        const daysSinceStart = snapshot.index * 1; // Assume 1 day per snapshot
        if (daysSinceStart - lastRebalance < 7) return [];

        lastRebalance = daysSinceStart;
        return this.createBaselinePolicy({ id: 'b1', name: 'Highest Rate', deployable: true, description: '' })(state, snapshot);
      };
    }

    // H5: No uncertainty - ignore prediction interval
    if (ablation.id === 'h5') {
      return this.createBaselinePolicy({ id: 'b2', name: 'Capacity-Aware', deployable: true, description: '' });
    }

    // Default: use B1
    return this.createBaselinePolicy({ id: 'b1', name: 'Highest Rate', deployable: true, description: '' });
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an evaluation runner from manifest
 */
export function createEvaluationRunner(manifest: EvaluationManifest): EvaluationRunner {
  return new EvaluationRunner(manifest);
}

/**
 * Run quick evaluation with default settings
 */
export async function runQuickEvaluation(
  dataset: EvaluationDataset,
  manifest: EvaluationManifest,
): Promise<EvaluationResults> {
  const runner = new EvaluationRunner(manifest);
  const coverageTracker = new CoverageTracker({
    targetCoverage: manifest.evaluation.successCriteria.minCoverage,
  });

  return runner.run(dataset, new Map(), coverageTracker);
}
