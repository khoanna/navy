/**
 * FINAL-REVIEW FIX 4: the §11.5 gate must not re-declare the constants the
 * policy already registers.
 *
 * `src/policy/steps/coverage.ts` exists because the optimiser and the grader
 * had drifted apart on what "stressed liquid coverage" means. The gate then
 * reintroduced the same divergence on its own side: a literal `0.99` for the
 * floor and a literal `5_000n` bps for the stress demand, neither of which
 * would move if the registered set ever changed.
 *
 * These tests are BEHAVIOURAL: they drive `evaluateRegisteredRelease` at the
 * exact boundary implied by the imported constants, so a future edit that
 * changes `REGISTERED_COVERAGE_FLOOR` or `REGISTERED_STRESS_DEMAND_BPS`
 * without the gate following fails here rather than shipping two numbers.
 *
 * They assert NO literal of their own for either value.
 */
import {
  evaluateRegisteredRelease,
  stressDemandBase,
} from '../../../src/evaluation/kernel/gates.js';
import {
  REGISTERED_TIERS,
  type PolicyRunResult,
  type RegisteredEvaluationResult,
} from '../../../src/evaluation/kernel/harness.js';
import { REGISTERED_POLICIES, SRCLA_POLICY } from '../../../src/evaluation/kernel/registry.js';
import { REGISTERED_S2_COVERAGE_FLOOR } from '../../../src/evaluation/kernel/sustainability.js';
import {
  REGISTERED_COVERAGE_FLOOR,
  // The check under test is a release grade, so it sources the RELEASE
  // floor -- deliberately a different constant from the optimiser's
  // eligibility filter above. See REGISTERED_S2_COVERAGE_FLOOR.
  REGISTERED_STRESS_DEMAND_BPS,
} from '../../../src/policy/steps/coverage.js';
import type { PolicyArtifact } from '../../../src/policy/types.js';

const WAD = 10n ** 18n;

/** The worst registered demand level, derived the way the gate must derive it. */
const maxDemandBps = REGISTERED_STRESS_DEMAND_BPS.reduce((m, b) => (b > m ? b : m), 0);

function run(policyId: string, tier: bigint, minStressed: number): PolicyRunResult {
  const policy = REGISTERED_POLICIES.find((p) => p.id === policyId) ?? SRCLA_POLICY;
  return {
    policy,
    tier,
    decisionHashes: ['0xd'],
    rebalances: 1,
    inertVsSrcla: false,
    replay: {
      policyId,
      tier,
      cohortId: `tier-${tier}`,
      snapshots: [
        {
          timestamp: new Date(Date.UTC(2026, 5, 1)),
          totalAssets: tier,
          totalShares: tier,
          sharePriceWad: WAD,
          totalReturn: 0,
          idleBase: tier,
          stressedLiquidCoverage: minStressed,
        },
      ],
      realizedNetApy: 0,
      totalTurnover: 0n,
      withdrawalSuccessRate: 1,
      withdrawals: [],
      totalCosts: 0n,
      minStressedLiquidCoverage: minStressed,
      coverageDistribution: { min: minStressed, p05: minStressed, median: minStressed },
      // §11.5 sustainability metrics — not under test here, so neutral values.
      timeToFullExitOrigins: 0,
      timeToFullExitCensored: false,
      venueStressContribution: {},
      displayedVsRealizedGapApy: 0,
      policyViolations: 0,
      capitalAtWorkFraction: 1,
      deploymentLatencyOrigins: 0,
      idleDragApy: null,
      hurdleBlocks: {},
    },
  } as unknown as PolicyRunResult;
}

/** A complete run where every policy/tier pair scores `coverage`, except an
 * optional single (srcla, `lowTier`) pair which scores `lowCoverage`. */
function evaluation(args: {
  coverage: number;
  lowTier?: bigint;
  lowCoverage?: number;
}): RegisteredEvaluationResult {
  const results: PolicyRunResult[] = [];
  for (const tier of REGISTERED_TIERS) {
    for (const p of REGISTERED_POLICIES) {
      const low =
        args.lowTier !== undefined && p.id === SRCLA_POLICY.id && tier === args.lowTier;
      results.push(run(p.id, tier, low ? args.lowCoverage! : args.coverage));
    }
  }
  return {
    results,
    withdrawalSource: 'observed',
    artifact: { artifactHash: '0xartifact' } as unknown as PolicyArtifact,
    provisional: false,
    missingPolicyIds: [],
    missingTiers: [],
  } as unknown as RegisteredEvaluationResult;
}

const stressedCheck = (r: ReturnType<typeof evaluateRegisteredRelease>) =>
  r.checks.find((c) => c.name === 'Safety: stressed liquid coverage')!;

describe('§11.5 gate sources its coverage floor from the policy registration', () => {
  it('accepts a run sitting exactly ON REGISTERED_S2_COVERAGE_FLOOR', () => {
    const out = evaluateRegisteredRelease(evaluation({ coverage: REGISTERED_S2_COVERAGE_FLOOR }));
    expect(stressedCheck(out).passed).toBe(true);
    expect(stressedCheck(out).detail).toContain(String(REGISTERED_S2_COVERAGE_FLOOR));
  });

  it('blocks a run one ulp-ish below REGISTERED_S2_COVERAGE_FLOOR', () => {
    const justBelow = REGISTERED_S2_COVERAGE_FLOOR - 1e-6;
    const out = evaluateRegisteredRelease(evaluation({ coverage: justBelow }));
    expect(stressedCheck(out).passed).toBe(false);
    expect(out.pass).toBe(false);
  });

  it('is overridable, so the default is genuinely a default and not a hardcode', () => {
    const justBelow = REGISTERED_COVERAGE_FLOOR - 1e-6;
    const out = evaluateRegisteredRelease(evaluation({ coverage: justBelow }), {
      minStressedLiquidCoverage: justBelow,
    });
    expect(stressedCheck(out).passed).toBe(true);
  });
});

describe('§11.5 gate sources its stress demand from REGISTERED_STRESS_DEMAND_BPS', () => {
  it('applies the MAXIMUM registered demand level, not a literal or an index', () => {
    for (const tier of REGISTERED_TIERS) {
      expect(stressDemandBase(tier)).toBe((tier * BigInt(maxDemandBps)) / 10_000n);
    }
    // Derived, not indexed: taking the max must be what the gate does even if
    // the registered set is reordered.
    expect(maxDemandBps).toBe(Math.max(...REGISTERED_STRESS_DEMAND_BPS));
  });

  it('calls a tier feasible when the venue universe holds exactly the demand', () => {
    // A universe holding EXACTLY max-demand of the tier is enough, so the
    // sub-threshold run is a genuine policy FAIL, not CAPACITY_INFEASIBLE.
    const tier = REGISTERED_TIERS[REGISTERED_TIERS.length - 1]!;
    const out = evaluateRegisteredRelease(
      evaluation({ coverage: 1, lowTier: tier, lowCoverage: 0.4 }),
      {
        universeLiquidity: {
          worstTotalCashBase: (tier * BigInt(maxDemandBps)) / 10_000n,
          observedAtIso: '2026-01-01T00:00:00Z',
        },
      },
    );
    expect(stressedCheck(out).passed).toBe(false);
    expect(stressedCheck(out).detail).not.toMatch(/CAPACITY_INFEASIBLE/);
  });

  it('calls it infeasible one base unit below that demand', () => {
    const tier = REGISTERED_TIERS[REGISTERED_TIERS.length - 1]!;
    const out = evaluateRegisteredRelease(
      evaluation({ coverage: 1, lowTier: tier, lowCoverage: 0.4 }),
      {
        universeLiquidity: {
          worstTotalCashBase: (tier * BigInt(maxDemandBps)) / 10_000n - 1n,
          observedAtIso: '2026-01-01T00:00:00Z',
        },
      },
    );
    expect(stressedCheck(out).detail).toMatch(/CAPACITY_INFEASIBLE/);
    // Infeasible is NOT a pass: `null` never rolls up.
    expect(stressedCheck(out).passed).not.toBe(true);
    expect(out.pass).toBe(false);
  });
});

describe('no import cycle between the gate and the policy registration', () => {
  it('coverage.ts is a leaf: the gate may import it, never the other way round', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../../src/policy/steps/coverage.ts', import.meta.url),
      'utf8',
    );
    expect(src).not.toMatch(/from\s+'[^']*evaluation/);
    expect(src).not.toMatch(/\bimport\b/);
  });
});
