/**
 * Release gate evaluation
 */
import type { ForecastMetrics } from '../metrics/forecast.js';
import type { ReturnMetrics } from '../metrics/returns.js';
import type { RiskMetrics } from '../metrics/risk.js';

export interface GateCheck {
  name: string;
  pass: boolean;
  value: number;
  threshold: number;
  reason?: string | undefined;
}

export interface ReleaseGateResult {
  pass: boolean;
  checks: GateCheck[];
  overallReason: string;
}

export interface ReleaseGateParams {
  forecastMetrics: ForecastMetrics;
  srclaMetrics: ReturnMetrics;
  b1Metrics: ReturnMetrics;
  b2Metrics: ReturnMetrics;
  riskMetrics: RiskMetrics;
  coverageTarget: number;
  significanceLevel: number;
}

/**
 * Evaluate release gate
 *
 * FAIL if:
 * - Coverage < target
 * - Any safety violation
 * - SRCLA not statistically better than B1
 * - SRCLA not statistically better than B2
 */
export function evaluateReleaseGate(params: ReleaseGateParams): ReleaseGateResult {
  const checks: GateCheck[] = [];

  // Check 1: Forecast coverage
  checks.push({
    name: 'Forecast Coverage',
    pass: params.forecastMetrics.coverage >= params.coverageTarget,
    value: params.forecastMetrics.coverage,
    threshold: params.coverageTarget,
    reason: params.forecastMetrics.coverage < params.coverageTarget
      ? `Coverage ${(params.forecastMetrics.coverage * 100).toFixed(2)}% below target ${(params.coverageTarget * 100).toFixed(1)}%`
      : undefined,
  });

  // Check 2: Safety — withdrawal success rate >= 99%
  checks.push({
    name: 'Safety: Withdrawal Success',
    pass: params.riskMetrics.withdrawalSuccessRate >= 0.99,
    value: params.riskMetrics.withdrawalSuccessRate,
    threshold: 0.99,
    reason: params.riskMetrics.withdrawalSuccessRate < 0.99
      ? `${((1 - params.riskMetrics.withdrawalSuccessRate) * 100).toFixed(2)}% withdrawals failed`
      : undefined,
  });

  // Check 3: Max drawdown <= 5%
  checks.push({
    name: 'Safety: Max Drawdown',
    pass: params.riskMetrics.maxDrawdown <= 0.05,
    value: params.riskMetrics.maxDrawdown,
    threshold: 0.05,
    reason: params.riskMetrics.maxDrawdown > 0.05
      ? `Max drawdown ${(params.riskMetrics.maxDrawdown * 100).toFixed(2)}% exceeds 5% threshold`
      : undefined,
  });

  // Check 4: SRCLA > B1 (by at least 10 bps)
  const minImprovement = 0.001; // 10 bps
  checks.push({
    name: 'Outperform B1 (Highest Rate)',
    pass: params.srclaMetrics.realizedNetApy > params.b1Metrics.realizedNetApy + minImprovement,
    value: params.srclaMetrics.realizedNetApy,
    threshold: params.b1Metrics.realizedNetApy + minImprovement,
    reason: params.srclaMetrics.realizedNetApy <= params.b1Metrics.realizedNetApy + minImprovement
      ? `SRCLA APY ${(params.srclaMetrics.realizedNetApy * 100).toFixed(3)}% does not outperform B1 ${(params.b1Metrics.realizedNetApy * 100).toFixed(3)}%`
      : undefined,
  });

  // Check 5: SRCLA > B2 (by at least 5 bps)
  const minImprovementB2 = 0.0005; // 5 bps
  checks.push({
    name: 'Outperform B2 (Capacity-Aware)',
    pass: params.srclaMetrics.realizedNetApy > params.b2Metrics.realizedNetApy + minImprovementB2,
    value: params.srclaMetrics.realizedNetApy,
    threshold: params.b2Metrics.realizedNetApy + minImprovementB2,
    reason: params.srclaMetrics.realizedNetApy <= params.b2Metrics.realizedNetApy + minImprovementB2
      ? `SRCLA APY ${(params.srclaMetrics.realizedNetApy * 100).toFixed(3)}% does not outperform B2 ${(params.b2Metrics.realizedNetApy * 100).toFixed(3)}%`
      : undefined,
  });

  const allPassed = checks.every((c) => c.pass);
  const failedChecks = checks.filter((c) => !c.pass);

  return {
    pass: allPassed,
    checks,
    overallReason: allPassed
      ? 'All release gates passed'
      : `Failed: ${failedChecks.map((c) => c.name).join(', ')}`,
  };
}
