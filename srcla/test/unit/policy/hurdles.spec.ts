import { annualLowerBound, deployClears, rotateClears, edgeStandardErrorWad } from '../../../src/policy/steps/hurdles.js';
import type { CostParams } from '../../../src/policy/steps/cost.js';
import type { DecisionInput, PolicyArtifact, RateCurve, ResidualPanel } from '../../../src/policy/types.js';

const WAD = 10n ** 18n;
const SECONDS_PER_YEAR = 31_536_000n;
const pct = (x: number) => BigInt(Math.round(x * 1e16)); // percent -> WAD fraction

/**
 * R1-REVISED replaces the brief's original Step 1 test list wholesale: two
 * of its tests asserted horizon-independence of the DECISION, which is false
 * (the residual quantile's annualisation, `annualLowerBound`, is linear in
 * 1/H by construction — see test 8). Only `costHurdleWad` is horizon-free;
 * that is what test 1 actually asserts.
 */

// --- fixtures --------------------------------------------------------------

/**
 * Three venues, eight aligned origins, enough spread per column (and
 * imperfect cross-column correlation) that `columnSigma`/`columnCorr` in
 * hurdles.ts never degenerate to zero — a zero-variance panel would make
 * every significance test pass vacuously (0 < 0 is false either way).
 */
const PANEL_UNIT = 10_000_000_000_000n; // 1e13 WAD ~ same order as the measured residual quantiles
const PANEL_ROWS: bigint[][] = [
  [2n * PANEL_UNIT, -1n * PANEL_UNIT, 1n * PANEL_UNIT],
  [-1n * PANEL_UNIT, 2n * PANEL_UNIT, -2n * PANEL_UNIT],
  [3n * PANEL_UNIT, 1n * PANEL_UNIT, 0n * PANEL_UNIT],
  [-2n * PANEL_UNIT, -3n * PANEL_UNIT, 2n * PANEL_UNIT],
  [1n * PANEL_UNIT, 0n * PANEL_UNIT, -1n * PANEL_UNIT],
  [-3n * PANEL_UNIT, 2n * PANEL_UNIT, 3n * PANEL_UNIT],
  [2n * PANEL_UNIT, -2n * PANEL_UNIT, -3n * PANEL_UNIT],
  [-1n * PANEL_UNIT, 1n * PANEL_UNIT, 1n * PANEL_UNIT],
];

/** The measured calibration quantiles named in the ruling, verbatim. */
const MEASURED_QUANTILES: Record<string, bigint> = {
  aave: -106084734766695n,
  compound: -51437739289824n,
  moonwell: -90840211541856n,
};

function artifact(
  overrides: Partial<{
    horizonSeconds: number;
    paybackSeconds: number;
    edgeWindowEffective: number;
    noTradeBandK: number;
    residualQuantileWadByMarket: Record<string, bigint>;
  }> = {},
): PolicyArtifact {
  return {
    artifactHash: '0xhurdlestest',
    policyVersion: 1,
    horizonSeconds: (overrides.horizonSeconds ?? 604_800) as PolicyArtifact['horizonSeconds'],
    coverageTarget: 0.95,
    method: 'rolling',
    methodParams: {},
    residualQuantileWadByMarket: overrides.residualQuantileWadByMarket ?? MEASURED_QUANTILES,
    cashResidualQuantileWadByMarket: {},
    cashLowerBoundQuantileWad: -(WAD / 100n),
    portfolioResidualQuantileWad: -(WAD / 100n),
    residualPanel: {
      marketIds: ['aave', 'compound', 'moonwell'],
      originsSeconds: PANEL_ROWS.map((_, i) => i * 3600),
      rows: PANEL_ROWS,
    },
    minObservations: 8,
    availabilityLagSeconds: 3600,
    noTradeBandK: overrides.noTradeBandK ?? 2,
    paybackSeconds: overrides.paybackSeconds ?? 30 * 86_400,
    adjustmentRate: 1,
    edgeWindowEffective: overrides.edgeWindowEffective ?? 30,
    configDigest: '0xdigest',
    pinnedConfigDigests: {},
  };
}

function flatCurve(rate: bigint, marketId = 'aave'): RateCurve {
  const quantumBase = 1_000_000_000n;
  return { marketId, quantumBase, points: [rate, rate, rate, rate, rate], maxXBase: quantumBase * 4n };
}

function baseInput(overrides: Partial<DecisionInput['vault']> = {}): DecisionInput {
  return {
    origin: { blockNumber: 1, blockHash: '0xb', timestampSeconds: 1_000_000, finalized: true },
    vault: {
      totalAssetsBase: 10_000_000_000_000n,
      idleBase: 10_000_000_000_000n,
      sharesOutstanding: 10n ** 12n,
      adminReserveBase: 0n,
      dynamicReserveBase: 0n,
      minIdleBps: 0,
      paused: false,
      configurationDigest: '0xv',
      ...overrides,
    },
    markets: [],
    dependencyGroups: [],
    withdrawals: [],
    gas: {
      // "Realistic Base" gas fixture, matching cost.spec.ts's shared fixture.
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

/** All cash idle, nothing deployed anywhere yet. */
function idleInput(): DecisionInput {
  return baseInput({ idleBase: 10_000_000_000_000n });
}

/** The vault already holds a position — the counterfactual a rotation compares against. */
function deployedInput(): DecisionInput {
  return baseInput({ idleBase: 0n });
}

function params(overrides: Partial<CostParams> = {}): CostParams {
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
    ...overrides,
  };
}

/**
 * Bisects the flat curve rate at which `deployClears` flips from false to
 * true, to within an interval of 1 wei of WAD precision (100 halvings of a
 * [-WAD, WAD] bracket is far more than needed; bigint division just stops
 * moving once the bracket collapses).
 */
function findDeployThreshold(
  input: DecisionInput,
  art: PolicyArtifact,
  marketId: string,
  amountBase: bigint,
  p: CostParams,
): bigint {
  let lo = -WAD;
  let hi = WAD;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2n;
    const clears = deployClears(input, art, flatCurve(mid, marketId), marketId, amountBase, p).clears;
    if (clears) hi = mid;
    else lo = mid;
  }
  return hi;
}

const AMOUNT = 1_000_000_000_000n; // $1,000,000 USDC (6dp) — large enough that costHurdleWad is negligible next to the annualised quantile

// --- tests -------------------------------------------------------------

describe('P13/P15/P16 hurdles (R1-REVISED)', () => {
  it('1. costHurdleWad is horizon-free: identical across {1d, 7d, 14d} for the same move', () => {
    const at = (h: number) =>
      deployClears(idleInput(), artifact({ horizonSeconds: h }), flatCurve(pct(5)), 'aave', AMOUNT, params())
        .costHurdleWad;
    const oneDay = at(86_400);
    const week = at(604_800);
    const fortnight = at(1_209_600);
    expect(week).toBe(oneDay);
    expect(fortnight).toBe(oneDay);
  });

  it('2. the double-count is gone: implied deployment threshold ~= |q|*YEAR/H + costHurdle, not 2x it', () => {
    const H = 604_800;
    const art = artifact({ horizonSeconds: H });
    const threshold = findDeployThreshold(idleInput(), art, 'aave', AMOUNT, params());

    const q = MEASURED_QUANTILES['aave']!;
    const absAnnualQ = (-q * SECONDS_PER_YEAR) / BigInt(H);
    const costHurdle = deployClears(idleInput(), art, flatCurve(0n), 'aave', AMOUNT, params()).costHurdleWad;

    const expected = absAnnualQ + costHurdle;
    const oldRuleThreshold = 2n * absAnnualQ;

    // Structurally below the old double-counted threshold...
    expect(threshold).toBeLessThan(oldRuleThreshold);
    // ...and, since AMOUNT makes costHurdle negligible here, within 5% of
    // the bare annualised quantile on its own.
    const diff = threshold > absAnnualQ ? threshold - absAnnualQ : absAnnualQ - threshold;
    const fivePercentOfAbsAnnualQ = absAnnualQ / 20n;
    expect(diff).toBeLessThan(fivePercentOfAbsAnnualQ);
    // And it matches the closed form to bisection precision (bigint integer
    // division on each side introduces rounding well under 1e-6 of either
    // term's own magnitude, nowhere near the 2x-vs-1x distinction above).
    const closedFormDiff = threshold > expected ? threshold - expected : expected - threshold;
    expect(closedFormDiff).toBeLessThan(fivePercentOfAbsAnnualQ / 1_000n);
  });

  it('3. deployClears is monotone and crisp around its own bisected threshold (not about the threshold\'s location — see test 2 for that)', () => {
    const art = artifact({ horizonSeconds: 604_800 });
    const threshold = findDeployThreshold(idleInput(), art, 'aave', AMOUNT, params());
    const tenBps = pct(0.1);

    const above = deployClears(idleInput(), art, flatCurve(threshold + tenBps), 'aave', AMOUNT, params());
    const below = deployClears(idleInput(), art, flatCurve(threshold - tenBps), 'aave', AMOUNT, params());

    expect(above.clears).toBe(true);
    expect(below.clears).toBe(false);
  });

  it('4. significanceWad strictly decreases as edgeWindowEffective grows', () => {
    const narrow = rotateClears(
      deployedInput(), artifact({ edgeWindowEffective: 4 }),
      flatCurve(pct(9), 'aave'), flatCurve(pct(4), 'compound'), 'aave', 'compound', AMOUNT, params(),
    );
    const wide = rotateClears(
      deployedInput(), artifact({ edgeWindowEffective: 400 }),
      flatCurve(pct(9), 'aave'), flatCurve(pct(4), 'compound'), 'aave', 'compound', AMOUNT, params(),
    );
    expect(wide.significanceWad).toBeLessThan(narrow.significanceWad);
  });

  it('5. significanceWad is zero for a deploy verdict, non-zero for a rotation verdict', () => {
    const dep = deployClears(idleInput(), artifact(), flatCurve(pct(5), 'aave'), 'aave', AMOUNT, params());
    const rot = rotateClears(
      deployedInput(), artifact(),
      flatCurve(pct(9), 'aave'), flatCurve(pct(4), 'compound'), 'aave', 'compound', AMOUNT, params(),
    );
    expect(dep.significanceWad).toBe(0n);
    expect(rot.significanceWad).toBeGreaterThan(0n);
  });

  it('6. costHurdleWad falls as movement cost falls', () => {
    const cheap = rotateClears(
      deployedInput(), artifact(),
      flatCurve(pct(9), 'aave'), flatCurve(pct(4), 'compound'), 'aave', 'compound', AMOUNT,
      params({ gasPerAction: 1n }),
    );
    const dear = rotateClears(
      deployedInput(), artifact(),
      flatCurve(pct(9), 'aave'), flatCurve(pct(4), 'compound'), 'aave', 'compound', AMOUNT,
      params({ gasPerAction: 10_000_000n }),
    );
    expect(cheap.costHurdleWad).toBeLessThan(dear.costHurdleWad);
  });

  it('7. a rotation differential ~20% above the hurdle clears; ~20% below does not (neither arm vacuous)', () => {
    // MINOR 7: the original 5pp/9pp-vs-4pp fixture was vacuous in both
    // directions — its "clears" case cleared by 79x (nowhere near the
    // boundary) and its "blocked" case had a NEGATIVE edge (aave's
    // quantile exceeds compound's in magnitude, so 1bp of raw rate spread
    // was never going to be the deciding factor). Rebuilt so both arms sit
    // close to the actual hurdle instead.
    const art = artifact();

    // hurdleWad (cost + significance) does not depend on the curve RATES —
    // only on cost/params/artifact/amount — so probe it once with any flat
    // rates, then aim the raw rate differential at hurdle +/- 20% by
    // solving edge = (rTo - rFrom) + bias, where
    // bias = annualLowerBound(...,0) at rate 0 for each venue.
    const probe = rotateClears(
      deployedInput(), art, flatCurve(0n, 'aave'), flatCurve(0n, 'compound'), 'aave', 'compound', AMOUNT, params(),
    );
    const hurdle = probe.hurdleWad;
    expect(hurdle).toBeGreaterThan(0n); // otherwise this test would prove nothing

    const bias = annualLowerBound(flatCurve(0n, 'aave'), art, 'aave', AMOUNT)
      - annualLowerBound(flatCurve(0n, 'compound'), art, 'compound', 0n);
    const rFrom = pct(4);
    const margin = hurdle / 5n; // ~20% of the hurdle

    const rToClear = rFrom + (hurdle + margin - bias);
    const big = rotateClears(
      deployedInput(), art, flatCurve(rToClear, 'aave'), flatCurve(rFrom, 'compound'), 'aave', 'compound', AMOUNT, params(),
    );
    const rToBlock = rFrom + (hurdle - margin - bias);
    const tiny = rotateClears(
      deployedInput(), art, flatCurve(rToBlock, 'aave'), flatCurve(rFrom, 'compound'), 'aave', 'compound', AMOUNT, params(),
    );

    expect(big.clears).toBe(true);
    expect(tiny.clears).toBe(false);
    // Both arms sit within one-fifth of a hurdle-width of the boundary, by
    // construction (bigint-exact — no curve rate feeds into hurdleWad, so
    // both verdicts report the SAME hurdle the probe measured).
    expect(big.hurdleWad).toBe(hurdle);
    expect(tiny.hurdleWad).toBe(hurdle);
    expect(big.edgeWad - big.hurdleWad).toBe(margin);
    expect(tiny.hurdleWad - tiny.edgeWad).toBe(margin);
  });

  it('8. annualLowerBound is HIGHER at H=14d than H=1d for the same curve (residual horizon dependence)', () => {
    const oneDay = annualLowerBound(flatCurve(pct(5), 'aave'), artifact({ horizonSeconds: 86_400 }), 'aave', 0n);
    const fortnight = annualLowerBound(flatCurve(pct(5), 'aave'), artifact({ horizonSeconds: 1_209_600 }), 'aave', 0n);
    expect(fortnight).toBeGreaterThan(oneDay);
  });

  // --- fix-round-1 additions (CRITICAL/IMPORTANT/MINOR review findings) ---

  it('9. IMPORTANT 2: paybackSeconds <= 0 fails with a named error, not a bigint RangeError', () => {
    const zeroPayback = artifact({ paybackSeconds: 0 });
    expect(() =>
      deployClears(idleInput(), zeroPayback, flatCurve(pct(5)), 'aave', AMOUNT, params()),
    ).toThrow(/paybackSeconds must be > 0/);
    expect(() =>
      rotateClears(
        deployedInput(), zeroPayback,
        flatCurve(pct(9), 'aave'), flatCurve(pct(4), 'compound'), 'aave', 'compound', AMOUNT, params(),
      ),
    ).toThrow(/paybackSeconds must be > 0/);

    // The zero-amount short-circuit (nothing to amortise a cost over) must
    // still not throw, payback or no payback — this is the artifact
    // `config/bootstrap-artifact.json` actually ships (paybackSeconds
    // absent -> 0 on the provisional path), evaluated against a genuinely
    // empty move.
    expect(() =>
      deployClears(idleInput(), zeroPayback, flatCurve(pct(5)), 'aave', 0n, params()),
    ).not.toThrow();
  });

  it('10. IMPORTANT 3: rotateClears marks SIGNIFICANCE_UNAVAILABLE when the panel does not cover both venues', () => {
    const noPanel = artifact();
    delete (noPanel as { residualPanel?: ResidualPanel }).residualPanel;
    const v1 = rotateClears(
      deployedInput(), noPanel,
      flatCurve(pct(9), 'aave'), flatCurve(pct(4), 'compound'), 'aave', 'compound', AMOUNT, params(),
    );
    expect(v1.significanceWad).toBe(0n);
    expect(v1.reason).toContain('SIGNIFICANCE_UNAVAILABLE');

    // Also degenerate when a panel exists but omits one of the two venues —
    // the live service boots from the bootstrap artifact, which has no
    // panel at all, but a partially-registered one is the same failure mode.
    const partialPanel = artifact({});
    (partialPanel as { residualPanel?: ResidualPanel }).residualPanel = {
      marketIds: ['aave'],
      originsSeconds: [0, 3600, 7200, 10800],
      rows: [[1n], [2n], [3n], [4n]],
    };
    const v2 = rotateClears(
      deployedInput(), partialPanel,
      flatCurve(pct(9), 'aave'), flatCurve(pct(4), 'compound'), 'aave', 'compound', AMOUNT, params(),
    );
    expect(v2.reason).toContain('SIGNIFICANCE_UNAVAILABLE');

    // And the marker is ABSENT when the panel genuinely covers both venues
    // (the default fixture) — this must never fire on a healthy artifact.
    const covered = rotateClears(
      deployedInput(), artifact(),
      flatCurve(pct(9), 'aave'), flatCurve(pct(4), 'compound'), 'aave', 'compound', AMOUNT, params(),
    );
    expect(covered.reason).not.toContain('SIGNIFICANCE_UNAVAILABLE');
  });

  it('11. IMPORTANT 4: deployClears decides and reports off the SAME comparison at the boundary', () => {
    const art = artifact({ horizonSeconds: 604_800 });
    const threshold = findDeployThreshold(idleInput(), art, 'aave', AMOUNT, params());
    // Sweep a narrow band either side of the bisected threshold. The
    // pre-fix defect was an independently-truncated base-unit gain/cost
    // comparison disagreeing with the annualised edgeWad/hurdleWad fields
    // in a ~1.2e7-wide band exactly here — this asserts the invariant that
    // makes that impossible: clears is ALWAYS `edgeWad > hurdleWad`.
    for (const delta of [-2_000_000n, -1n, 0n, 1n, 2_000_000n]) {
      const v = deployClears(idleInput(), art, flatCurve(threshold + delta), 'aave', AMOUNT, params());
      expect(v.clears).toBe(v.edgeWad > v.hurdleWad);
    }
  });

  it('12. MINOR 5: correlation clamp — identical residual columns give a well-defined (zero) standard error', () => {
    // The reviewer's own repro shape: identical columns are exactly where
    // the unclamped Pearson ratio was measured to overshoot WAD (up to
    // `WAD + 234999n` observed across random columns; identical columns
    // alone overshoot by ~2e4). True rho for identical columns is exactly
    // 1, so the standard error of their difference must be exactly zero —
    // a corrupted (unclamped) rho could instead drive `varDiff` negative.
    const col = [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n].map((v) => v * PANEL_UNIT);
    const identicalPanel: ResidualPanel = {
      marketIds: ['aave', 'compound', 'moonwell'],
      originsSeconds: col.map((_, i) => i * 3600),
      rows: col.map((v) => [v, v, v]), // aave === compound === moonwell at every origin
    };
    const art = artifact();
    (art as { residualPanel?: ResidualPanel }).residualPanel = identicalPanel;
    expect(edgeStandardErrorWad(art, 'aave', 'compound')).toBe(0n);
  });

  it('13. MINOR 6: pins SECONDS_PER_YEAR to 365 days, not protocols/math.ts\'s 365.25d', () => {
    const H = 604_800;
    const q = MEASURED_QUANTILES['aave']!;
    const result = annualLowerBound(flatCurve(0n, 'aave'), artifact({ horizonSeconds: H }), 'aave', 0n);
    const expected365 = (q * 31_536_000n) / BigInt(H);
    expect(result).toBe(expected365);

    // The other candidate constant would give a measurably different
    // number — not swallowed by test 2's 5% tolerance band (a 0.07% shift),
    // which is exactly why that test cannot be relied on to catch a swap
    // and this needs its own exact pin.
    const expected365_25 = (q * 31_557_600n) / BigInt(H);
    expect(result).not.toBe(expected365_25);
  });
});
