import { annualLowerBound, deployClears, rotateClears } from '../../../src/policy/steps/hurdles.js';
import type { CostParams } from '../../../src/policy/steps/cost.js';
import type { DecisionInput, PolicyArtifact, RateCurve } from '../../../src/policy/types.js';

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

  it('3. near-boundary discrimination: 10bps above the implied threshold clears, 10bps below does not', () => {
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

  it('7. a 5pp differential clears the rotation hurdle; a 1bp one does not', () => {
    const big = rotateClears(
      deployedInput(), artifact(),
      flatCurve(pct(9), 'aave'), flatCurve(pct(4), 'compound'), 'aave', 'compound', AMOUNT, params(),
    );
    const tiny = rotateClears(
      deployedInput(), artifact(),
      flatCurve(pct(4.01), 'aave'), flatCurve(pct(4), 'compound'), 'aave', 'compound', AMOUNT, params(),
    );
    expect(big.clears).toBe(true);
    expect(tiny.clears).toBe(false);
  });

  it('8. annualLowerBound is HIGHER at H=14d than H=1d for the same curve (residual horizon dependence)', () => {
    const oneDay = annualLowerBound(flatCurve(pct(5), 'aave'), artifact({ horizonSeconds: 86_400 }), 'aave', 0n);
    const fortnight = annualLowerBound(flatCurve(pct(5), 'aave'), artifact({ horizonSeconds: 1_209_600 }), 'aave', 0n);
    expect(fortnight).toBeGreaterThan(oneDay);
  });
});
