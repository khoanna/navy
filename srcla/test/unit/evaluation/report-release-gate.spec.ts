/**
 * `src/evaluation/report/release-gate.ts` — the safety gate that NEW-14 found
 * passing because the property it gates on was never tested.
 */
import { evaluateReleaseGate, type ReleaseGateParams } from '../../../src/evaluation/report/release-gate.js';
import type { RiskMetrics } from '../../../src/evaluation/metrics/risk.js';

function params(risk: Partial<RiskMetrics> = {}): ReleaseGateParams {
  return {
    forecastMetrics: { mae: 0, rmse: 0, mase: 0, pinballLoss: 0, coverage: 0.97, sharpness: 0 },
    srclaMetrics: {
      realizedNetApy: 0.05,
      totalReturn: 0,
      annualizedReturn: 0,
      grossApy: 0,
      netApyAfterCosts: 0,
    },
    b1Metrics: {
      realizedNetApy: 0.01,
      totalReturn: 0,
      annualizedReturn: 0,
      grossApy: 0,
      netApyAfterCosts: 0,
    },
    b2Metrics: {
      realizedNetApy: 0.01,
      totalReturn: 0,
      annualizedReturn: 0,
      grossApy: 0,
      netApyAfterCosts: 0,
    },
    riskMetrics: {
      maxDrawdown: 0.001,
      expectedShortfall: 0,
      withdrawalSuccessRate: 1,
      stressedCoverage: 1,
      ...risk,
    },
    coverageTarget: 0.95,
    significanceLevel: 0.05,
  };
}

const withdrawalCheck = (p: ReleaseGateParams) =>
  evaluateReleaseGate(p).checks.find((c) => c.name === 'Safety: Withdrawal Success')!;

describe('evaluateReleaseGate: withdrawal success', () => {
  it('FAILS when the rate was never measured', () => {
    const check = withdrawalCheck(params({ withdrawalSuccessRate: null }));
    expect(check.pass).toBe(false);
    expect(check.reason).toContain('not measured');
    // And it fails the whole gate, not just its own line.
    expect(evaluateReleaseGate(params({ withdrawalSuccessRate: null })).pass).toBe(false);
  });

  it('passes on a measured 100% — so the failure above is about MEASUREMENT, not the value', () => {
    expect(withdrawalCheck(params({ withdrawalSuccessRate: 1 })).pass).toBe(true);
    expect(evaluateReleaseGate(params({ withdrawalSuccessRate: 1 })).pass).toBe(true);
  });

  it('fails a measured rate below 99%', () => {
    const check = withdrawalCheck(params({ withdrawalSuccessRate: 0.98 }));
    expect(check.pass).toBe(false);
    expect(check.reason).toContain('2.00% withdrawals failed');
  });

  it('reports 0, not NaN, as the value of an unmeasured rate', () => {
    expect(withdrawalCheck(params({ withdrawalSuccessRate: null })).value).toBe(0);
  });
});
