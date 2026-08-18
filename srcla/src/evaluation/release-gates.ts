/**
 * Release Gates — per paper §11.5
 *
 * Enforces quality gates before forecast/policy deployment:
 * - Forecast Gate: calibration coverage, label completeness, regime contamination, minimum observations
 * - Policy Gate: safety violations, statistical indistinguishability, B0 comparison, Sharpe ratio
 */

export interface ReleaseGateResult {
  passed: boolean;
  checks: GateCheck[];
  blockedReason?: string;
}

export interface GateCheck {
  name: string;
  passed: boolean;
  details: string;
  metrics?: Record<string, number>;
}

export interface EvaluationResults {
  calibrationCoverage: number;
  labelCompleteness: number;
  regimeContamination: boolean;
  totalObservations: number;
}

export interface PolicyComparison {
  safetyViolations: number;
  pValue: number;
  srclaAPY: number;
  b0APY: number;
  srclaSharpe: number;
}

/**
 * Forecast Gate (per paper §11.5)
 * Must pass all checks before forecast release
 */
export function evaluateForecastGate(
  evaluation: EvaluationResults
): ReleaseGateResult {
  const checks: GateCheck[] = [];

  // 1. Calibration adequacy
  const calibrationPass = evaluation.calibrationCoverage >= 0.95;
  checks.push({
    name: 'Calibration Coverage',
    passed: calibrationPass,
    details: `${(evaluation.calibrationCoverage * 100).toFixed(1)}% >= 95%`,
    metrics: { coverage: evaluation.calibrationCoverage },
  });

  // 2. Label completeness
  const completenessPass = evaluation.labelCompleteness >= 0.99;
  checks.push({
    name: 'Label Completeness',
    passed: completenessPass,
    details: `${(evaluation.labelCompleteness * 100).toFixed(1)}% complete`,
    metrics: { completeness: evaluation.labelCompleteness },
  });

  // 3. No regime contamination
  const contaminationPass = !evaluation.regimeContamination;
  checks.push({
    name: 'No Regime Contamination',
    passed: contaminationPass,
    details: contaminationPass
      ? 'No look-ahead detected'
      : 'LOOK-AHEAD DETECTED',
  });

  // 4. Minimum observations
  const observationsPass = evaluation.totalObservations >= 365;
  checks.push({
    name: 'Minimum Observations',
    passed: observationsPass,
    details: `${evaluation.totalObservations} >= 365`,
    metrics: { observations: evaluation.totalObservations },
  });

  const passed = checks.every(c => c.passed);
  const result: ReleaseGateResult = {
    passed,
    checks,
  };
  if (!passed) {
    result.blockedReason = checks.find(c => !c.passed)!.name;
  }
  return result;
}

/**
 * Policy Gate (per paper §11.5)
 * Must pass all checks before policy release
 */
export function evaluatePolicyGate(
  comparison: PolicyComparison
): ReleaseGateResult {
  const checks: GateCheck[] = [];

  // 1. No safety violations
  const safetyPass = comparison.safetyViolations === 0;
  checks.push({
    name: 'No Safety Violations',
    passed: safetyPass,
    details: `${comparison.safetyViolations} violations`,
    metrics: { violations: comparison.safetyViolations },
  });

  // 2. Statistical indistinguishability from baselines
  const statPass = comparison.pValue >= 0.05;
  checks.push({
    name: 'Statistical Indistinguishability',
    passed: statPass,
    details: `p-value ${comparison.pValue.toFixed(3)} >= 0.05`,
    metrics: { pValue: comparison.pValue },
  });

  // 3. Outperforms B0 (risk-free)
  const b0Pass = comparison.srclaAPY > comparison.b0APY;
  checks.push({
    name: 'Outperforms B0',
    passed: b0Pass,
    details: `SRCLA ${comparison.srclaAPY.toFixed(2)}% vs B0 ${comparison.b0APY.toFixed(2)}%`,
    metrics: { srclaAPY: comparison.srclaAPY, b0APY: comparison.b0APY },
  });

  // 4. Sharpe ratio acceptable
  const sharpePass = comparison.srclaSharpe >= 0.5;
  checks.push({
    name: 'Acceptable Sharpe Ratio',
    passed: sharpePass,
    details: `Sharpe ${comparison.srclaSharpe.toFixed(2)} >= 0.5`,
    metrics: { sharpe: comparison.srclaSharpe },
  });

  const passed = checks.every(c => c.passed);
  const result: ReleaseGateResult = {
    passed,
    checks,
  };
  if (!passed) {
    result.blockedReason = checks.find(c => !c.passed)!.name;
  }
  return result;
}
