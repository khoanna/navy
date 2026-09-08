/**
 * §9.2's admission list (readiness audit NEW-26).
 *
 * "A reward contributes to forecast or accounting only if its token,
 * emission, DENOMINATOR, remaining horizon, funding, claim simulation,
 * Chainlink price feeds, and approved Uniswap V3 route all pass admission."
 *
 * Seven of the eight criteria were implemented; the denominator rule did not
 * exist. Its absence was invisible for a specific reason worth encoding: a
 * distribution can be live, funded, inside its horizon, freshly priced and
 * routed while its denominator is zero — every other rule passes in exactly
 * that state, so nothing failed and nothing was reported. The isolation
 * cases below therefore assert that each code fires ALONE.
 */
import {
  admitReward,
  recognizedRewardValueBase,
  unadmittedPolicy,
  type RewardObservation,
  type RewardTokenPolicy,
} from '../../../src/policy/steps/reward-admission.js';

const NOW = 1_800_000_000;
const TOKEN = '0xC0Mp00000000000000000000000000000000000A';
const E18 = 10n ** 18n;

/** Every §9.2 code, so an isolation assertion can name the complement. */
const ALL_CODES = [
  'TOKEN_NOT_ADMITTED',
  'CLAIM_SIMULATION_FAILED',
  'EMISSION_ENDED',
  'DENOMINATOR_INVALID',
  'UNDERFUNDED',
  'FEED_INVALID',
  'FEED_STALE',
  'NO_APPROVED_ROUTE',
];

function obs(over: Partial<RewardObservation> = {}): RewardObservation {
  return {
    adapter: '0xadapter',
    token: TOKEN,
    tokenDecimals: 18,
    observedAtSeconds: NOW,
    claimableAmount: 100n * E18,
    heldAmount: 0n,
    claimSimulationSucceeded: true,
    emissionEndSeconds: NOW + 30 * 86_400,
    distributionDenominatorAmount: 1_000_000n * E18,
    adapterShareAmount: 10_000n * E18,
    controllerFundedAmount: 10n ** 30n,
    rewardUsdE8: 100_000_000n,
    rewardFeedUpdatedAtSeconds: NOW - 60,
    usdcUsdE8: 100_000_000n,
    usdcFeedUpdatedAtSeconds: NOW - 60,
    routeId: 'comp-usdc-3000',
    routeApproved: true,
    ...over,
  };
}

function policy(over: Partial<RewardTokenPolicy> = {}): RewardTokenPolicy {
  return {
    token: TOKEN,
    admitted: true,
    haircutBps: 1_000,
    maxContributionBase: 10n ** 12n,
    maxFeedAgeSeconds: 3_600,
    ...over,
  };
}

/** Asserts exactly one code failed, so a test cannot pass for the wrong reason. */
function expectOnlyCodeFails(
  reasons: Array<{ code: string; passed: boolean }>,
  code: string
): void {
  expect(reasons.some((r) => r.code === code && !r.passed)).toBe(true);
  for (const other of ALL_CODES.filter((c) => c !== code)) {
    expect(reasons.some((r) => r.code === other && !r.passed)).toBe(false);
  }
}

describe('§9.2 admission covers all eight named criteria', () => {
  it('evaluates exactly the registered code set', () => {
    const r = admitReward(obs(), policy());
    expect(r.reasons.map((x) => x.code).filter((c) => c !== 'OK').sort()).toEqual([...ALL_CODES].sort());
  });

  it('admits a fully compliant reward', () => {
    const r = admitReward(obs(), policy());
    expect(r.admitted).toBe(true);
    expect(r.reasons.some((x) => x.code === 'OK')).toBe(true);
  });
});

describe('DENOMINATOR_INVALID', () => {
  it('rejects a zero distribution denominator, on that code alone', () => {
    // The state the missing rule made invisible: every other criterion
    // passes while the controller's per-unit accrual is a division by zero.
    //
    // `adapterShareAmount` is ALSO zeroed, deliberately. With a non-zero
    // share this case is caught by the share-vs-denominator branch instead,
    // and a mutant that deletes the zero-denominator branch outright then
    // survives — which it did on the first pass. Zeroing the share leaves
    // the zero-denominator branch as the only thing that can reject it.
    const r = admitReward(obs({ distributionDenominatorAmount: 0n, adapterShareAmount: 0n }), policy());
    expect(r.admitted).toBe(false);
    expectOnlyCodeFails(r.reasons, 'DENOMINATOR_INVALID');
    expect(r.reasons.find((x) => x.code === 'DENOMINATOR_INVALID')!.detail).toContain('undefined');
  });

  it('rejects a negative denominator, on that branch alone', () => {
    // Share below the denominator (-1 < 0 is false, and -2 > -1 is false),
    // so again only the denominator branch can reject this.
    const r = admitReward(obs({ distributionDenominatorAmount: -1n, adapterShareAmount: 0n }), policy());
    expect(r.admitted).toBe(false);
    expectOnlyCodeFails(r.reasons, 'DENOMINATOR_INVALID');
  });

  it('rejects an adapter share larger than the whole distribution base', () => {
    const r = admitReward(
      obs({ distributionDenominatorAmount: 100n * E18, adapterShareAmount: 101n * E18 }),
      policy()
    );
    expect(r.admitted).toBe(false);
    expectOnlyCodeFails(r.reasons, 'DENOMINATOR_INVALID');
  });

  it('rejects a negative adapter share', () => {
    const r = admitReward(obs({ adapterShareAmount: -1n }), policy());
    expect(r.admitted).toBe(false);
    expectOnlyCodeFails(r.reasons, 'DENOMINATOR_INVALID');
  });

  it('accepts an adapter holding the ENTIRE distribution base', () => {
    // The boundary is inclusive: sole supplier is a legitimate state, not an
    // inconsistency.
    const r = admitReward(
      obs({ distributionDenominatorAmount: 100n * E18, adapterShareAmount: 100n * E18 }),
      policy()
    );
    expect(r.admitted).toBe(true);
  });

  it('accepts a zero adapter share against a positive denominator', () => {
    // Nothing accrued yet is not an inconsistency; it just values at zero.
    const r = admitReward(obs({ adapterShareAmount: 0n }), policy());
    expect(r.admitted).toBe(true);
  });

  it('is independent of EMISSION_ENDED', () => {
    // The distribution is live and inside its horizon; only the denominator
    // is broken. If the two were conflated this would report the wrong code.
    const r = admitReward(
      obs({ emissionEndSeconds: NOW + 86_400, distributionDenominatorAmount: 0n }),
      policy()
    );
    expectOnlyCodeFails(r.reasons, 'DENOMINATOR_INVALID');
  });

  it('zeroes the recognised value, with no partial credit', () => {
    const { grossBase, conservativeBase } = recognizedRewardValueBase(
      obs({ distributionDenominatorAmount: 0n }),
      policy()
    );
    expect(grossBase).toBe(0n);
    expect(conservativeBase).toBe(0n);
  });
});

describe('the other seven rules still fire in isolation', () => {
  it('TOKEN_NOT_ADMITTED', () => {
    expectOnlyCodeFails(admitReward(obs(), policy({ admitted: false })).reasons, 'TOKEN_NOT_ADMITTED');
  });

  it('CLAIM_SIMULATION_FAILED', () => {
    expectOnlyCodeFails(
      admitReward(obs({ claimSimulationSucceeded: false }), policy()).reasons,
      'CLAIM_SIMULATION_FAILED'
    );
  });

  it('EMISSION_ENDED', () => {
    expectOnlyCodeFails(admitReward(obs({ emissionEndSeconds: NOW - 1 }), policy()).reasons, 'EMISSION_ENDED');
  });

  it('UNDERFUNDED', () => {
    expectOnlyCodeFails(
      admitReward(obs({ controllerFundedAmount: 1n }), policy()).reasons,
      'UNDERFUNDED'
    );
  });

  it('FEED_INVALID', () => {
    expectOnlyCodeFails(admitReward(obs({ rewardUsdE8: 0n }), policy()).reasons, 'FEED_INVALID');
  });

  it('FEED_STALE', () => {
    expectOnlyCodeFails(
      admitReward(obs({ usdcFeedUpdatedAtSeconds: NOW - 100_000 }), policy()).reasons,
      'FEED_STALE'
    );
  });

  it('NO_APPROVED_ROUTE', () => {
    expectOnlyCodeFails(admitReward(obs({ routeApproved: false }), policy()).reasons, 'NO_APPROVED_ROUTE');
  });

  it('an unregistered token gets the all-rejecting default policy', () => {
    const r = admitReward(obs(), unadmittedPolicy(TOKEN));
    expect(r.admitted).toBe(false);
    expect(recognizedRewardValueBase(obs(), unadmittedPolicy(TOKEN)).grossBase).toBe(0n);
  });
});
