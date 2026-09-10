/**
 * `src/evaluation/quarantined/release-gate.ts` — the RETIRED v0.6 gate, moved
 * out of live `src/` (it is not the §11.5 policy gate; see the module header).
 * Kept under test only because it is still the provenance of earlier published
 * figures, and this case — the safety gate that NEW-14 found passing because
 * the property it gates on was never tested — is the one behaviour of it worth
 * pinning.
 *
 * The import is dynamic and preceded by the opt-in, because the module now
 * throws at module scope without it (`assertQuarantineOptIn`). A static import
 * would hoist above the env assignment and throw.
 */
import type { RiskMetrics } from '../../../src/evaluation/metrics/risk.js';
import { QUARANTINE_ENV_VAR, assertQuarantineOptIn } from '../../../src/evaluation/quarantined/guard.js';

type Mod = typeof import('../../../src/evaluation/quarantined/release-gate.js');
type ReleaseGateParams = Mod['evaluateReleaseGate'] extends (p: infer P) => unknown ? P : never;

let evaluateReleaseGate: Mod['evaluateReleaseGate'];

beforeAll(async () => {
  process.env[QUARANTINE_ENV_VAR] = '1';
  ({ evaluateReleaseGate } = await import('../../../src/evaluation/quarantined/release-gate.js'));
});

it('is behind the quarantine opt-in it now calls at module scope', () => {
  // The module-scope call is `assertQuarantineOptIn(...)`; this is that guard
  // exercised directly, without perturbing the module registry the suite above
  // depends on.
  const previous = process.env[QUARANTINE_ENV_VAR];
  delete process.env[QUARANTINE_ENV_VAR];
  expect(() => assertQuarantineOptIn('src/evaluation/quarantined/release-gate.ts')).toThrow(
    /QUARANTINED/,
  );
  process.env[QUARANTINE_ENV_VAR] = previous;
  expect(() => assertQuarantineOptIn('src/evaluation/quarantined/release-gate.ts')).not.toThrow();
});

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
