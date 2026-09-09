/**
 * §8.2 - "For the three-market universe, its output is checked against
 * exhaustive enumeration at the same quantum and its approximation regret is
 * persisted." (Readiness audit NEW-18.)
 *
 * The defect: `verifyExhaustively` returned `null` whenever
 * `totalAssets / quantumBase > 64`, and the production quantum is a FIXED
 * 1,000 USDC — a 64,000 USDC ceiling. Three of the four registered tiers
 * (100k, 1M, 10M) were never checked against enumeration at all, and the
 * evaluation harness asked for 100 steps per tier, so it never enumerated
 * either.
 *
 * The load-bearing assertion here is that enumeration returns a RESULT at
 * every registered tier. A test that only checked "regret is small" would
 * have passed vacuously against `null` handling, which is exactly how the
 * gap survived.
 */
import {
  ENUMERATION_MAX_STEPS,
  resolveQuantumBase,
  optimize,
} from '../../../src/policy/steps/optimize.js';
import { decide, DEFAULT_DECIDE_OPTS } from '../../../src/policy/decide.js';
import { simulateCurves } from '../../../src/policy/steps/simulate.js';
import { loadBootstrapArtifact } from '../../../src/policy/artifact.js';
import type { DecisionInput, MarketObservation, PolicyArtifact } from '../../../src/policy/types.js';

const WAD = 10n ** 18n;
const USDC = 1_000_000n;

/** §11.1's registered tiers, in USDC base units. */
const TIERS = [10_000n * USDC, 100_000n * USDC, 1_000_000n * USDC, 10_000_000n * USDC];

function adapterFor(marketId: string): string {
  const hex = [...marketId].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  return `0x${(hex + '0'.repeat(40)).slice(0, 40)}`;
}

function market(marketId: string, rateWad: bigint, tier: bigint): MarketObservation {
  return {
    marketId,
    adapter: adapterFor(marketId),
    protocol: 'aave',
    cash: tier * 10n,
    borrows: tier,
    reserves: 0n,
    supplyRateWad: rateWad,
    utilizationWad: WAD / 10n,
    positionBase: 0n,
    maxDeployableBase: tier * 10n,
    maxWithdrawableBase: tier * 10n,
    configDigest: `0xpin-${marketId}`,
    regimeId: 'r1',
    paused: false,
    capBps: 10_000,
    absoluteCapBase: tier * 10n,
    maxLossBps: 50,
    dependencyGroupIds: [],
  };
}

function input(tier: bigint): DecisionInput {
  const markets = [
    market('aave', WAD / 20n, tier),
    market('compound', WAD / 25n, tier),
    market('moonwell', WAD / 30n, tier),
  ];
  return {
    origin: { blockNumber: 1, blockHash: '0xb', timestampSeconds: 1_000_000, finalized: true },
    vault: {
      totalAssetsBase: tier,
      idleBase: tier,
      sharesOutstanding: tier,
      adminReserveBase: 0n,
      dynamicReserveBase: 0n,
      minIdleBps: 0,
      paused: false,
      configurationDigest: '0x' + '11'.repeat(32),
    },
    markets,
    dependencyGroups: [],
    withdrawals: [],
    gas: {
      l2BaseFeeWei: 5_000_000n,
      l1BaseFeeWei: 8_000_000_000n,
      l1BlobBaseFeeWei: 10_000_000n,
      ethUsdE8: 350_000_000_000n,
      usdcUsdE8: 100_000_000n,
    },
    history: [],
    lastAction: { timestampSeconds: null, turnoverWindowBase: 0n, recentMoves: [] },
  };
}

function artifact(): PolicyArtifact {
  return {
    ...loadBootstrapArtifact(),
    pinnedConfigDigests: {
      aave: '0xpin-aave',
      compound: '0xpin-compound',
      moonwell: '0xpin-moonwell',
    },
    minObservations: 0,
    residualQuantileWadByMarket: {},
    noTradeBandK: 0,
    // P15/P17: `paybackSeconds` is the registered window a move must repay its
    // own movement cost within, and `steps/hurdles.ts` throws without it. The
    // bootstrap artifact does not carry one (a payback period is a
    // registration, not a default), so a fixture that drives decide() through
    // the per-leg hurdles has to supply it. 30 days matches
    // scripts/freeze-artifact.ts's PAYBACK_SECONDS.
    paybackSeconds: 30 * 86_400,
  };
}

describe('resolveQuantumBase (§8.2 same-quantum enumeration)', () => {
  it('leaves a quantum that already fits the budget untouched', () => {
    expect(resolveQuantumBase(10_000n * USDC, 1_000n * USDC)).toBe(1_000n * USDC);
  });

  it('keeps every registered tier at or under the enumeration budget', () => {
    for (const tier of TIERS) {
      const q = resolveQuantumBase(tier, 1_000n * USDC);
      expect(Number(tier / q)).toBeLessThanOrEqual(ENUMERATION_MAX_STEPS);
    }
  });

  it('scales to the documented grid at each tier', () => {
    expect(resolveQuantumBase(10_000n * USDC, 1_000n * USDC)).toBe(1_000n * USDC);
    expect(resolveQuantumBase(100_000n * USDC, 1_000n * USDC)).toBe(2_000n * USDC);
    expect(resolveQuantumBase(1_000_000n * USDC, 1_000n * USDC)).toBe(20_000n * USDC);
    expect(resolveQuantumBase(10_000_000n * USDC, 1_000n * USDC)).toBe(200_000n * USDC);
  });

  it('rounds up to a {1,2,5} x 10^k grid rather than to a raw ratio', () => {
    // 64,000,001 base units / 64 = 1,000,000.02 -> the next grid value is
    // 2,000,000, not the raw ceiling.
    expect(resolveQuantumBase(64_000_001n, 1n)).toBe(2_000_000n);
  });

  it('never LOWERS a deliberately coarse requested quantum', () => {
    // Carried by the early return: a quantum already inside the budget is
    // handed straight back. The scaling branch below cannot lower one
    // either — reaching it requires total >= (maxSteps+1) * requested, so
    // ceil(total/maxSteps) is strictly greater than requested.
    expect(resolveQuantumBase(10_000n * USDC, 5_000n * USDC)).toBe(5_000n * USDC);
    expect(resolveQuantumBase(10_000n * USDC, 20_000n * USDC)).toBe(20_000n * USDC);
  });

  it('only ever raises a quantum once the scaling branch is reached', () => {
    // The branch M27 exposed as unreachable-if-guarded: every input that
    // gets past the early return comes back strictly coarser.
    for (const requested of [1n, 7n, 1_000n, 999_999n, 1_000n * USDC]) {
      const total = 10_000_000n * USDC;
      if (total / requested <= BigInt(ENUMERATION_MAX_STEPS)) continue;
      expect(resolveQuantumBase(total, requested)).toBeGreaterThan(requested);
    }
  });

  it('rejects a non-positive quantum instead of dividing by it', () => {
    expect(() => resolveQuantumBase(1000n, 0n)).toThrow(/must be positive/);
    expect(() => resolveQuantumBase(1000n, -1n)).toThrow(/must be positive/);
  });

  it('is a no-op for an empty vault', () => {
    expect(resolveQuantumBase(0n, 1_000n * USDC)).toBe(1_000n * USDC);
  });
});

describe('§8.2 enumeration is reachable at every registered tier', () => {
  for (const tier of TIERS) {
    it(`enumerates at the ${tier / USDC} USDC tier`, () => {
      const out = decide(input(tier), artifact(), DEFAULT_DECIDE_OPTS);
      expect(out.enumeration).not.toBeNull();
      expect(out.enumeration!.enumerated).toBeGreaterThan(0);
    });

    it(`reports a bounded approximation regret at the ${tier / USDC} USDC tier`, () => {
      const out = decide(input(tier), artifact(), DEFAULT_DECIDE_OPTS);
      // Regret is measured against the actual best feasible candidate found
      // by brute force, so it is >= 0 by construction; the greedy solver is
      // required to stay within the registered 100 bps.
      expect(out.enumeration!.regretBps).toBeGreaterThanOrEqual(0n);
      expect(out.enumeration!.passed).toBe(true);
    });
  }

  it('enumerates on the SAME quantum the greedy solver used', () => {
    // §8.2: "checked against exhaustive enumeration at the same quantum". If
    // the two grids differed, the reported regret would not bound this
    // solver's approximation error at all.
    const tier = 1_000_000n * USDC;
    const i = input(tier);
    const a = artifact();
    const q = resolveQuantumBase(tier, DEFAULT_DECIDE_OPTS.quantumBase);
    const out = decide(i, a, DEFAULT_DECIDE_OPTS);

    for (const [, amount] of out.target) {
      expect(amount % q).toBe(0n);
    }
    expect(out.curves.every((c) => c.quantumBase === q)).toBe(true);
  });

  it('optimize() resolves the quantum even when called directly', () => {
    // A caller reaching past decide() must not be able to produce an
    // unenumerable grid by accident.
    const tier = 10_000_000n * USDC;
    const i = input(tier);
    const a = artifact();
    const q = resolveQuantumBase(tier, 1_000n * USDC);
    const curves = simulateCurves(i, ['aave', 'compound', 'moonwell'], q, 16);
    const { enumeration } = optimize(i, curves, a, {
      quantumBase: 1_000n * USDC,
      reserveQuantile: 0.95,
      reserveHorizonSeconds: 86_400,
    });
    expect(enumeration).not.toBeNull();
  });

  it('returns null for a universe of more than three markets, per §8.2', () => {
    const tier = 10_000n * USDC;
    const i = input(tier);
    i.markets.push(market('extra', WAD / 40n, tier));
    const a = artifact();
    a.pinnedConfigDigests['extra'] = '0xpin-extra';
    const out = decide(i, a, DEFAULT_DECIDE_OPTS);
    expect(out.enumeration).toBeNull();
  });
});
