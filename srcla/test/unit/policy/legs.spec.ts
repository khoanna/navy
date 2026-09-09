import {
  chooseExecuted,
  notionalBase,
  partialAdjust,
  partialAdjustAtLeast,
  planLegs,
  survivingTarget,
} from '../../../src/policy/steps/legs.js';
import { rateAt } from '../../../src/policy/steps/simulate.js';
import type { CostParams } from '../../../src/policy/steps/cost.js';
import type { DecisionInput, PolicyArtifact, RateCurve } from '../../../src/policy/types.js';

const WAD = 10n ** 18n;
const pct = (x: number) => BigInt(Math.round(x * 1e16)); // percent -> WAD fraction

// --- fixtures --------------------------------------------------------------
//
// Two venues: 'a' pays 20% APY, 'b' pays 1%. Both are far enough apart that a
// meaningfully-sized leg into 'a' clears its hurdle by orders of magnitude,
// while a one-base-unit leg cannot repay its own gas at any rate — the two
// ends this module has to keep apart.

function artifact(): PolicyArtifact {
  return {
    artifactHash: '0xlegstest',
    policyVersion: 1,
    horizonSeconds: 604_800,
    coverageTarget: 0.95,
    method: 'rolling',
    methodParams: {},
    residualQuantileWadByMarket: { a: 0n, b: 0n },
    cashResidualQuantileWadByMarket: {},
    cashLowerBoundQuantileWad: 0n,
    portfolioResidualQuantileWad: 0n,
    residualPanel: {
      marketIds: ['a', 'b'],
      originsSeconds: [0, 3600, 7200, 10_800],
      rows: [
        [1_000_000_000_000n, -2_000_000_000_000n],
        [-3_000_000_000_000n, 1_000_000_000_000n],
        [2_000_000_000_000n, 3_000_000_000_000n],
        [-1_000_000_000_000n, -1_000_000_000_000n],
      ],
    },
    minObservations: 4,
    availabilityLagSeconds: 3600,
    noTradeBandK: 0,
    paybackSeconds: 30 * 86_400,
    adjustmentRate: 1,
    edgeWindowEffective: 30,
    configDigest: '0xdigest',
    pinnedConfigDigests: {},
  };
}

function flatCurve(marketId: string, rate: bigint): RateCurve {
  const quantumBase = 1_000_000_000n;
  return {
    marketId,
    quantumBase,
    points: Array.from({ length: 17 }, () => rate),
    maxXBase: quantumBase * 16n,
  };
}

function curves(): RateCurve[] {
  return [flatCurve('a', pct(20)), flatCurve('b', pct(1))];
}

function input(): DecisionInput {
  return {
    origin: { blockNumber: 1, blockHash: '0xb', timestampSeconds: 1_000_000, finalized: true },
    vault: {
      totalAssetsBase: 10_000_000_000n,
      idleBase: 10_000_000_000n,
      sharesOutstanding: 10n ** 10n,
      adminReserveBase: 0n,
      dynamicReserveBase: 0n,
      minIdleBps: 0,
      paused: false,
      configurationDigest: '0xv',
    },
    markets: [],
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

function params(): CostParams {
  return {
    cooldownSeconds: 3600,
    minTurnoverBps: 10,
    maxTurnoverBps: 5000,
    turnoverWindowSeconds: 86_400,
    reversalWindowSeconds: 86_400,
    reversalAllowanceBps: 200,
    slippageBps: 5,
    mevBps: 1,
    impactBps: 2,
    failureRateBps: 50,
    bufferBps: 100,
    gasPerAction: 250_000n,
    planGasOverhead: 150_000n,
    actionDispatchGas: 15_000n,
    approveResetGas: 50_000n,
    swapGas: 180_000n,
    l1BytesPerAction: 400n,
  };
}

describe('P17 per-leg evaluation and partial adjustment', () => {
  it('executes the leg that clears when another leg does not', () => {
    const current = new Map([['a', 0n], ['b', 1_000_000_000n]]);
    const target = new Map([['a', 5_000_000_000n], ['b', 0n]]);
    const verdicts = planLegs(current, target, input(), artifact(), curves(), params());
    const clearing = verdicts.filter((v) => v.clears);
    expect(clearing.length).toBeGreaterThan(0);
    const sub = survivingTarget(current, target, verdicts);
    expect(sub.get('a')).toBeGreaterThan(0n);
  });

  it('NEVER returns the empty target when at least one leg clears', () => {
    const current = new Map([['a', 0n], ['b', 0n]]);
    const target = new Map([['a', 5_000_000_000n], ['b', 1n]]);
    const verdicts = planLegs(current, target, input(), artifact(), curves(), params());
    const sub = survivingTarget(current, target, verdicts);
    expect([...sub.values()].some((v) => v > 0n)).toBe(true);
  });

  // Non-vacuity for the test above: the 1-base-unit leg really is blocked, so
  // "at least one leg cleared" is a partial execution and not a restatement of
  // "everything cleared".
  it('blocks a leg too small to repay its own gas while the large one clears', () => {
    const current = new Map([['a', 0n], ['b', 0n]]);
    const target = new Map([['a', 5_000_000_000n], ['b', 1n]]);
    const verdicts = planLegs(current, target, input(), artifact(), curves(), params());
    const byMarket = new Map(verdicts.map((v) => [v.marketId, v]));
    expect(byMarket.get('a')!.clears).toBe(true);
    expect(byMarket.get('b')!.clears).toBe(false);
    const sub = survivingTarget(current, target, verdicts);
    expect(sub.get('a')).toBe(5_000_000_000n);
    expect(sub.get('b')).toBe(0n);
  });

  it('returns the current position unchanged when no leg clears', () => {
    const current = new Map([['a', 1_000_000_000n]]);
    const target = new Map([['a', 1_000_000_001n]]); // 1 base unit: cannot repay gas
    const verdicts = planLegs(current, target, input(), artifact(), curves(), params());
    expect(verdicts.length).toBeGreaterThan(0);
    expect(verdicts.every((v) => !v.clears)).toBe(true);
    expect(survivingTarget(current, target, verdicts)).toEqual(current);
  });

  // §9.1 states a hurdle for deploying idle (9.1.2) and for rotating between
  // venues (9.1.3), and none for taking exposure OFF. A reduction the
  // optimiser asked for is a constraint response, so blocking it would
  // reinstate all-or-nothing in the direction that raises risk.
  it('lets an unpaired divest to idle through with no economic hurdle', () => {
    const current = new Map([['a', 5_000_000_000n], ['b', 0n]]);
    const target = new Map([['a', 1_000_000_000n], ['b', 0n]]);
    const verdicts = planLegs(current, target, input(), artifact(), curves(), params());
    expect(verdicts.map((v) => v.kind)).toEqual(['divest']);
    expect(verdicts[0]!.clears).toBe(true);
    expect(survivingTarget(current, target, verdicts).get('a')).toBe(1_000_000_000n);
  });

  // A venue that has just fallen out of admission has no simulated curve, so
  // neither hurdle can be priced for it. It must be left alone rather than
  // crash on a missing curve — steps/unwind.ts is its registered exit.
  it('skips a venue with no curve instead of dereferencing one', () => {
    const current = new Map([['a', 0n], ['gone', 3_000_000_000n]]);
    const target = new Map([['a', 5_000_000_000n]]);
    const verdicts = planLegs(current, target, input(), artifact(), curves(), params());
    expect(verdicts.every((v) => v.marketId !== 'gone')).toBe(true);
    expect(verdicts.map((v) => v.kind)).toEqual(['deploy']);
    expect(survivingTarget(current, target, verdicts).get('gone')).toBe(3_000_000_000n);
  });

  it('partialAdjust at lambda=1 reaches the sub-target exactly', () => {
    const cur = new Map([['a', 0n], ['b', 1_000_000n]]);
    const sub = new Map([['a', 4_000_000n], ['b', 0n]]);
    expect(partialAdjust(cur, sub, 1)).toEqual(sub);
  });

  it('partialAdjust at lambda=0.5 moves halfway and conserves total', () => {
    const cur = new Map([['a', 0n], ['b', 1_000_000n]]);
    const sub = new Map([['a', 1_000_000n], ['b', 0n]]);
    const out = partialAdjust(cur, sub, 0.5);
    expect(out.get('a')).toBe(500_000n);
    expect(out.get('b')).toBe(500_000n);
    const totalBefore = [...cur.values()].reduce((s, v) => s + v, 0n);
    const totalAfter = [...out.values()].reduce((s, v) => s + v, 0n);
    expect(totalAfter).toBe(totalBefore);
  });

  // Truncating each venue's scaled delta independently mints or burns base
  // units the vault has no source for; the dust correction is what keeps the
  // total exact, and it must never drive a venue negative.
  it('partialAdjust conserves the total exactly on amounts that do not divide evenly', () => {
    const cur = new Map([['a', 7n], ['b', 11n], ['c', 5n]]);
    const sub = new Map([['a', 0n], ['b', 0n], ['c', 23n]]);
    const out = partialAdjust(cur, sub, 1 / 3);
    expect([...out.values()].reduce((s, v) => s + v, 0n)).toBe(23n);
    expect([...out.values()].every((v) => v >= 0n)).toBe(true);
  });

  // The dust correction is against the INTENDED total change, not against
  // zero. Correcting toward zero conserved the total unconditionally and so
  // silently undid every reduction: a 5,000 -> 1,000 USDC divest at lambda=0.5
  // came back out at 5,000, and decide() then held on the feasibility
  // re-check rather than de-risking.
  it('partialAdjust shrinks the total when the sub-target does', () => {
    const cur = new Map([['a', 5_000_000_000n]]);
    const sub = new Map([['a', 1_000_000_000n]]);
    expect(partialAdjust(cur, sub, 0.5).get('a')).toBe(3_000_000_000n);
    expect(partialAdjust(cur, sub, 0.25).get('a')).toBe(4_000_000_000n);
  });

  it('partialAdjust grows the total when the sub-target does', () => {
    const cur = new Map([['a', 0n], ['b', 0n]]);
    const sub = new Map([['a', 4_000_000_000n], ['b', 2_000_000_000n]]);
    const out = partialAdjust(cur, sub, 0.5);
    expect(out.get('a')).toBe(2_000_000_000n);
    expect(out.get('b')).toBe(1_000_000_000n);
  });

  // decide() is pure and its hash covers the target: two runs on the same
  // input must pair and round identically.
  it('is deterministic', () => {
    const current = new Map([['a', 0n], ['b', 2_000_000_000n]]);
    const target = new Map([['a', 6_000_000_000n], ['b', 0n]]);
    const one = planLegs(current, target, input(), artifact(), curves(), params());
    const two = planLegs(current, target, input(), artifact(), curves(), params());
    expect(one).toEqual(two);
    expect(partialAdjust(current, target, 0.37)).toEqual(partialAdjust(current, target, 0.37));
  });

  it('a cleared rotation moves exposure between the two venues it names', () => {
    const current = new Map([['a', 0n], ['b', 4_000_000_000n]]);
    const target = new Map([['a', 4_000_000_000n], ['b', 0n]]);
    const verdicts = planLegs(current, target, input(), artifact(), curves(), params());
    expect(verdicts.map((v) => v.kind)).toEqual(['rotate']);
    const rot = verdicts[0]!;
    expect(rot.marketId).toBe('a');
    expect(rot.fromMarketId).toBe('b');
    expect(rot.clears).toBe(true);
    // 20% into 'a' against 1% out of 'b' is a 19pp annualised edge.
    expect(rot.edgeWad).toBeGreaterThan(pct(18));
    expect(rot.edgeWad).toBeLessThan(pct(20));
    const sub = survivingTarget(current, target, verdicts);
    expect(sub.get('a')).toBe(4_000_000_000n);
    expect(sub.get('b')).toBe(0n);
    // Conservation: a rotation neither creates nor destroys assets.
    expect([...sub.values()].reduce((s, v) => s + v, 0n)).toBe(
      [...current.values()].reduce((s, v) => s + v, 0n),
    );
  });

  it('WAD is the unit of every rate field on a verdict', () => {
    const current = new Map([['a', 0n]]);
    const target = new Map([['a', 5_000_000_000n]]);
    const v = planLegs(current, target, input(), artifact(), curves(), params())[0]!;
    // 20% APY with a zero residual quantile is exactly 2e17 WAD.
    expect(v.edgeWad).toBe(WAD / 5n);
    expect(v.hurdleWad).toBeGreaterThan(0n);
    expect(v.hurdleWad).toBeLessThan(v.edgeWad);
  });
});

// ---------------------------------------------------------------------------
// I2 — the curve is read at the ABSOLUTE post-move level, not at the delta.
// ---------------------------------------------------------------------------

/**
 * A curve that pays 20% up to a 4,000 USDC total allocation and 0% at 8,000.
 * `RateCurve.points[k]` is the rate at x = k*quantum where x is the vault's
 * TOTAL position in the venue, so a vault already holding 4,000 that deploys
 * another 4,000 earns the rate at 8,000 — not the rate at 4,000.
 */
function steppedCurve(marketId = 'a'): RateCurve {
  const quantumBase = 1_000_000_000n;
  const points = [0, 1, 2, 3, 4].map(() => pct(20)).concat([0, 1, 2, 3].map(() => 0n));
  return { marketId, quantumBase, points, maxXBase: quantumBase * 8n };
}

describe('P17/I2 hurdles are priced at the absolute post-move level', () => {
  it('a deploy on top of an existing position reads the curve at current + delta', () => {
    const curve = steppedCurve();
    // Non-vacuity: the two readings genuinely differ, and in the direction
    // that makes the delta reading over-permissive.
    expect(rateAt(curve, 4_000_000_000n)).toBe(pct(20));
    expect(rateAt(curve, 8_000_000_000n)).toBe(0n);

    const current = new Map([['a', 4_000_000_000n]]);
    const target = new Map([['a', 8_000_000_000n]]);
    const legs = planLegs(current, target, input(), artifact(), [curve], params());

    expect(legs).toHaveLength(1);
    const leg = legs[0]!;
    expect(leg.kind).toBe('deploy');
    // The delta prices the movement cost...
    expect(leg.amountBase).toBe(4_000_000_000n);
    // ...and the post-move LEVEL prices the curve. Reading at the delta would
    // have given 20% here and cleared; the real post-move rate is 0%.
    expect(leg.edgeWad).toBe(0n);
    expect(leg.hurdleWad).toBeGreaterThan(0n);
    expect(leg.clears).toBe(false);
  });

  it('a first deployment into an empty venue is unaffected — level equals delta there', () => {
    const curve = steppedCurve();
    const current = new Map([['a', 0n]]);
    const target = new Map([['a', 4_000_000_000n]]);
    const leg = planLegs(current, target, input(), artifact(), [curve], params())[0]!;
    expect(leg.amountBase).toBe(4_000_000_000n);
    expect(leg.edgeWad).toBe(pct(20));
    expect(leg.clears).toBe(true);
  });

  it('successive legs into one venue each see the level that leg reaches', () => {
    // 'b' divests 2,000 into 'a', then idle funds another 2,000 into 'a'.
    // 'a' starts at 4,000, so the rotation lands it at 6,000 and the deploy at
    // 8,000 — the deploy must NOT be re-priced from 4,000.
    const curve = steppedCurve();
    const bCurve = flatCurve('b', pct(1));
    const current = new Map([['a', 4_000_000_000n], ['b', 2_000_000_000n]]);
    const target = new Map([['a', 8_000_000_000n], ['b', 0n]]);
    const legs = planLegs(current, target, input(), artifact(), [curve, bCurve], params());

    expect(legs.map((l) => l.kind)).toEqual(['rotate', 'deploy']);
    // rotate: 'a' goes 4,000 -> 6,000 (curve reads 0% there), 'b' goes 2,000 -> 0.
    expect(legs[0]!.amountBase).toBe(2_000_000_000n);
    expect(rateAt(curve, 6_000_000_000n)).toBe(0n);
    // deploy: 'a' goes 6,000 -> 8,000, still 0%.
    expect(legs[1]!.amountBase).toBe(2_000_000_000n);
    expect(legs[1]!.edgeWad).toBe(0n);
    expect(legs[1]!.clears).toBe(false);
  });

  it('a rotation reads its SOURCE at the post-move level, not at zero', () => {
    // 'src' pays 20% up to 4,000 and 0% at 8,000; the vault holds 8,000 and
    // rotates 4,000 out, landing the source at 4,000 (a 20% reading). Pricing
    // the source at 0n — which this used to do — would read 20% as well but
    // for a level the position never occupies; the distinguishing case is the
    // level the source actually reaches, asserted directly below.
    const src = steppedCurve('src');
    const dst = flatCurve('dst', pct(3));
    const current = new Map([['src', 8_000_000_000n], ['dst', 0n]]);
    const target = new Map([['src', 4_000_000_000n], ['dst', 4_000_000_000n]]);
    const leg = planLegs(current, target, input(), artifact(), [src, dst], params())[0]!;

    expect(leg.kind).toBe('rotate');
    expect(leg.fromMarketId).toBe('src');
    // edge = bound(dst @ 4,000) - bound(src @ post-move 4,000) = 3% - 20%.
    expect(rateAt(src, 4_000_000_000n)).toBe(pct(20));
    expect(leg.edgeWad).toBe(pct(3) - pct(20));
    expect(leg.clears).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// I4 — the adjustment rate is raised to the minimum-turnover floor, never
// scaled under it.
// ---------------------------------------------------------------------------

describe('P17/I4 partialAdjustAtLeast', () => {
  const cur = () => new Map([['a', 0n]]);
  const sub = () => new Map([['a', 10_000_000n]]); // 10 USDC of notional

  it('leaves lambda alone when the scaled notional already clears the floor', () => {
    const out = partialAdjustAtLeast(cur(), sub(), 0.9, 5_000_000n);
    expect(out.get('a')).toBe(9_000_000n);
  });

  it('raises lambda to exactly the floor when the scaled notional is under it', () => {
    // lambda=0.1 alone would move 1 USDC, under a 5 USDC floor. The result is
    // the SMALLEST vector that clears the floor, not the full sub-target.
    const out = partialAdjustAtLeast(cur(), sub(), 0.1, 5_000_000n);
    expect(out.get('a')).toBe(5_000_000n);
    expect(notionalBase(cur(), out)).toBe(5_000_000n);
  });

  it('never exceeds the sub-target: at most lambda = 1', () => {
    const out = partialAdjustAtLeast(cur(), sub(), 0.1, 10_000_000n);
    expect(out.get('a')).toBe(10_000_000n);
  });

  it('leaves the vector at lambda when NO rate can clear the floor', () => {
    // The full sub-target is itself under the floor, so the brake must refuse
    // it — inflating the move past the sub-target to satisfy a floor would be
    // moving money the optimiser never asked to move.
    const out = partialAdjustAtLeast(cur(), sub(), 0.1, 20_000_000n);
    expect(out.get('a')).toBe(1_000_000n);
  });

  it('raises a reduction to the floor too, and never past the sub-target', () => {
    const from = new Map([['a', 10_000_000n]]);
    const to = new Map([['a', 0n]]);
    expect(partialAdjustAtLeast(from, to, 0.1, 5_000_000n).get('a')).toBe(5_000_000n);
    expect(partialAdjustAtLeast(from, to, 0.1, 10_000_000n).get('a')).toBe(0n);
  });

  it('is deterministic', () => {
    expect(partialAdjustAtLeast(cur(), sub(), 0.1, 3_333_333n)).toEqual(
      partialAdjustAtLeast(cur(), sub(), 0.1, 3_333_333n),
    );
  });
});

// ---------------------------------------------------------------------------
// I1 — the feasibility fallback backs off to the risk-reducing subset before
// it holds.
// ---------------------------------------------------------------------------

describe('P17/I1 chooseExecuted', () => {
  const current = () => new Map([['a', 5_000_000_000n], ['b', 0n]]);
  const sub = () => new Map([['a', 5_000_000_000n], ['b', 3_000_000_000n]]);
  const divestOnly = () => new Map([['a', 2_000_000_000n], ['b', 0n]]);
  const identity = (c: Map<string, bigint>) => c;

  it('takes the full surviving set when it commits', () => {
    const out = chooseExecuted(current(), sub(), divestOnly(), true, identity);
    expect(out.executed).toEqual(sub());
    expect(out.backedOff).toBe(false);
  });

  it('backs off to the divest-only subset rather than discarding it', () => {
    const commit = (c: Map<string, bigint>) => (c.get('b') === 0n ? c : null);
    const out = chooseExecuted(current(), sub(), divestOnly(), true, commit);
    expect(out.executed).toEqual(divestOnly());
    expect(out.backedOff).toBe(true);
  });

  it('holds only when the divest-only subset is ALSO infeasible', () => {
    const out = chooseExecuted(current(), sub(), divestOnly(), true, () => null);
    expect(out.executed).toEqual(current());
    expect(out.backedOff).toBe(false);
  });

  it('does not attempt the backoff when no divest leg cleared', () => {
    let calls = 0;
    const commit = (c: Map<string, bigint>) => {
      calls++;
      return c.get('b') === 0n ? c : null;
    };
    const out = chooseExecuted(current(), sub(), divestOnly(), false, commit);
    expect(calls).toBe(1);
    expect(out.executed).toEqual(current());
    expect(out.backedOff).toBe(false);
  });
});
