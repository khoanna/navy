/**
 * §11.5's PRIMARY release criterion (P24–P26, P28).
 *
 * The theme: SUSTAINABILITY MUST BE DEMONSTRATED WHILE DEPLOYED. A vault
 * holding idle cash passes every redeemability test and has proven nothing,
 * so a perfect coverage score on an undeployed run must report NOT
 * DEMONSTRATED — the v0.6 run in which SRCLA held 1.000 stressed coverage at
 * all four tiers while realizing 0.000% on one era is the case this file
 * exists to refuse.
 */
import {
  qualifiesAsComparator,
  scaleInvariant,
  sustainabilityAtTier,
  REGISTERED_DEMONSTRATION_FLOOR,
  REGISTERED_MAX_EXIT_ORIGINS,
  REGISTERED_MAX_VENUE_STRESS_SHARE,
  REGISTERED_MIN_WITHDRAWAL_SUCCESS,
  REGISTERED_S2_COVERAGE_FLOOR,
} from '../../../src/evaluation/kernel/sustainability.js';
import type { PolicyRunResult } from '../../../src/evaluation/kernel/harness.js';
import { SRCLA_POLICY } from '../../../src/evaluation/kernel/registry.js';

function run(opts: {
  policyId?: string;
  tier?: string;
  capitalAtWorkFraction?: number;
  realizedNetApy?: number;
  minStressedLiquidCoverage?: number;
  withdrawalSuccessRate?: number | null;
  exitOrigins?: number | null;
  exitCensored?: boolean;
  venueStressShare?: number;
  policyViolations?: number;
}): PolicyRunResult {
  return {
    policy: { ...SRCLA_POLICY, id: opts.policyId ?? SRCLA_POLICY.id },
    tier: BigInt(opts.tier ?? '1000000000000'),
    decisionHashes: ['0xd'],
    rebalances: 1,
    inertVsSrcla: false,
    replay: {
      realizedNetApy: opts.realizedNetApy ?? 0.04,
      minStressedLiquidCoverage: opts.minStressedLiquidCoverage ?? 1,
      withdrawalSuccessRate: opts.withdrawalSuccessRate === undefined ? 1 : opts.withdrawalSuccessRate,
      capitalAtWorkFraction: opts.capitalAtWorkFraction ?? 0.9,
      timeToFullExitOrigins: opts.exitOrigins === undefined ? 3 : opts.exitOrigins,
      timeToFullExitCensored: opts.exitCensored ?? false,
      venueStressContribution: { 'compound-usdc': opts.venueStressShare ?? 0.05 },
      displayedVsRealizedGapApy: 0.01,
      policyViolations: opts.policyViolations ?? 0,
    },
  } as unknown as PolicyRunResult;
}

describe('P25: sustainability must be demonstrated while deployed', () => {
  it('an all-idle run reports NOT DEMONSTRATED, not a pass', () => {
    const v = sustainabilityAtTier(
      run({ capitalAtWorkFraction: 0, minStressedLiquidCoverage: 1.0, withdrawalSuccessRate: 1 }),
    );
    expect(v.demonstrated).toBe(false);
    expect(v.sustainable).toBeNull(); // null, never true
    expect(v.s1).toBeNull();
    expect(v.s2).toBeNull();
    expect(v.s3).toBeNull();
    expect(v.s4).toBeNull();
  });

  it("v0.6 SRCLA's perfect coverage at 0.000% return does NOT pass", () => {
    const v = sustainabilityAtTier(
      run({
        capitalAtWorkFraction: 0.02,
        realizedNetApy: 0,
        minStressedLiquidCoverage: 1.0,
        withdrawalSuccessRate: 1,
      }),
    );
    expect(v.sustainable).toBeNull();
    expect(v.breach).toMatch(/NOT DEMONSTRATED/);
  });

  it('a deployed run holding the floor is sustainable', () => {
    const v = sustainabilityAtTier(
      run({
        capitalAtWorkFraction: 0.92,
        minStressedLiquidCoverage: 1.0,
        withdrawalSuccessRate: 1,
        exitOrigins: 3,
        venueStressShare: 0.1,
      }),
    );
    expect(v.demonstrated).toBe(true);
    expect(v.sustainable).toBe(true);
    expect(v.breach).toBeNull();
    expect(qualifiesAsComparator(v)).toBe(true);
  });

  it('a deployed run breaching coverage is NOT sustainable and names the criterion', () => {
    const v = sustainabilityAtTier(
      run({ capitalAtWorkFraction: 0.92, minStressedLiquidCoverage: 0.878, withdrawalSuccessRate: 1 }),
    );
    expect(v.sustainable).toBe(false);
    expect(v.breach).toMatch(/S2/);
    expect(qualifiesAsComparator(v)).toBe(false);
  });

  it('a run that cannot fully exit inside the bound fails S1 even at perfect coverage', () => {
    const v = sustainabilityAtTier(
      run({
        capitalAtWorkFraction: 0.92,
        minStressedLiquidCoverage: 1.0,
        withdrawalSuccessRate: 1,
        exitOrigins: 500,
      }),
    );
    expect(v.sustainable).toBe(false);
    expect(v.breach).toMatch(/S1/);
  });

  it('a RIGHT-CENSORED exit is NOT DEMONSTRATED, not a breach', () => {
    // The era ended before the bound could be tested. Publishing that as a
    // BREACH would convict a vault that would have exited fine.
    const v = sustainabilityAtTier(
      run({ capitalAtWorkFraction: 0.92, exitOrigins: null, exitCensored: true }),
    );
    expect(v.s1).toBeNull();
    expect(v.sustainable).toBeNull();
    expect(v.breach).toMatch(/right-censored/);
  });

  it('a run that NEVER fully exits fails S1 — absence of an exit is not a zero-length exit', () => {
    const v = sustainabilityAtTier(
      run({ capitalAtWorkFraction: 0.92, minStressedLiquidCoverage: 1.0, exitOrigins: null }),
    );
    expect(v.s1).toBe(false);
    expect(v.sustainable).toBe(false);
    expect(v.breach).toMatch(/NEVER/);
  });

  it("a run that itself causes most of a venue's utilization fails S3", () => {
    const v = sustainabilityAtTier(
      run({
        capitalAtWorkFraction: 0.92,
        minStressedLiquidCoverage: 1.0,
        withdrawalSuccessRate: 1,
        venueStressShare: 0.8,
      }),
    );
    expect(v.sustainable).toBe(false);
    expect(v.breach).toMatch(/S3/);
  });

  it('a policy violation fails S4 — continuity is a criterion, not a footnote', () => {
    const v = sustainabilityAtTier(run({ capitalAtWorkFraction: 0.92, policyViolations: 2 }));
    expect(v.s4).toBe(false);
    expect(v.sustainable).toBe(false);
    expect(v.breach).toMatch(/S4/);
  });

  it('an unmeasured withdrawal rate is NOT DEMONSTRATED, never a pass', () => {
    const v = sustainabilityAtTier(
      run({ capitalAtWorkFraction: 0.92, withdrawalSuccessRate: null }),
    );
    expect(v.s1).toBeNull();
    expect(v.sustainable).toBeNull();
  });

  it('a demonstrated breach outranks an unmeasured criterion in the same run', () => {
    const v = sustainabilityAtTier(
      run({
        capitalAtWorkFraction: 0.92,
        withdrawalSuccessRate: null,
        minStressedLiquidCoverage: 0.5,
      }),
    );
    expect(v.sustainable).toBe(false);
  });

  it('publishes the price of unsustainability on every verdict', () => {
    const v = sustainabilityAtTier(
      run({ capitalAtWorkFraction: 0.92, minStressedLiquidCoverage: 0.5, realizedNetApy: 0.39 }),
    );
    expect(v.sustainable).toBe(false);
    expect(v.realizedNetApy).toBeCloseTo(0.39);
    expect(v.displayedVsRealizedGapApy).toBeCloseTo(0.01);
  });

  it('the registered thresholds are the values the paper registered', () => {
    // REVISED registrations (see the report's threshold-revision disclosure).
    // This test exists to make a change to a registered constant deliberate
    // and visible in a diff, not to freeze it forever -- so it pins the
    // CURRENT values and fails loudly the next time one moves.
    expect(REGISTERED_DEMONSTRATION_FLOOR).toBe(0.7);
    expect(REGISTERED_S2_COVERAGE_FLOOR).toBe(0.95);
    expect(REGISTERED_MAX_EXIT_ORIGINS).toBe(24);
    expect(REGISTERED_MAX_VENUE_STRESS_SHARE).toBe(0.25);
    expect(REGISTERED_MIN_WITHDRAWAL_SUCCESS).toBe(0.99);
  });
});

describe('P26: scale invariance is a criterion, not an average', () => {
  it('B4 — sustainable at 1M, breaching at 10M — is NOT scale invariant', () => {
    const vs = [
      sustainabilityAtTier(
        run({
          tier: '1000000000000',
          capitalAtWorkFraction: 0.92,
          minStressedLiquidCoverage: 1.0,
          withdrawalSuccessRate: 1,
        }),
      ),
      sustainabilityAtTier(
        run({
          tier: '10000000000000',
          capitalAtWorkFraction: 0.92,
          minStressedLiquidCoverage: 0.59,
          withdrawalSuccessRate: 1,
        }),
      ),
    ];
    expect(scaleInvariant(vs)).toBe(false);
  });

  it('three passing tiers and one NOT DEMONSTRATED is null, never true', () => {
    const vs = [
      sustainabilityAtTier(run({ capitalAtWorkFraction: 0.92, minStressedLiquidCoverage: 1.0 })),
      sustainabilityAtTier(run({ capitalAtWorkFraction: 0.92, minStressedLiquidCoverage: 1.0 })),
      sustainabilityAtTier(run({ capitalAtWorkFraction: 0.92, minStressedLiquidCoverage: 1.0 })),
      sustainabilityAtTier(run({ capitalAtWorkFraction: 0.0, minStressedLiquidCoverage: 1.0 })),
    ];
    expect(scaleInvariant(vs)).toBeNull();
  });

  it('averaging cannot rescue a breach: 3 x 1.000 and 1 x 0.000 is not sustainable', () => {
    const vs = [1.0, 1.0, 1.0, 0.0].map((c) =>
      sustainabilityAtTier(
        run({ capitalAtWorkFraction: 0.92, minStressedLiquidCoverage: c, withdrawalSuccessRate: 1 }),
      ),
    );
    expect(scaleInvariant(vs)).toBe(false);
  });

  it('every tier passing is scale invariant', () => {
    const vs = [1, 2, 3, 4].map(() =>
      sustainabilityAtTier(run({ capitalAtWorkFraction: 0.92, minStressedLiquidCoverage: 1 })),
    );
    expect(scaleInvariant(vs)).toBe(true);
  });

  it('an empty verdict set is null, never true', () => {
    expect(scaleInvariant([])).toBeNull();
  });
});
