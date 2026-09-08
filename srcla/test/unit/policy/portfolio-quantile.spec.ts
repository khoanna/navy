/**
 * P2's `q^p_alpha(w)` and P8's band (paper §8.2, §9.1).
 *
 * The two defects these exist to prevent coming back:
 *
 *  NEW-7 — the portfolio quantile was `frozenScalar * notional`, invariant to
 *  the MIX. Two candidates deploying the same total in different proportions
 *  received an identical term, so P2 could never change a ranking. The tests
 *  below fail if the quantile stops depending on w.
 *
 *  NEW-8 — P8's band used the same frozen scalar, sized so it "stays out of
 *  the way", making `max(C_move, k*sigma)` always `C_move`. The band tests
 *  fail if the band stops responding to the target's dispersion.
 */
import {
  buildResidualPanel,
  empiricalLowerQuantile,
  portfolioQuantileProvenance,
  portfolioResidualQuantileFor,
  portfolioWeightsWad,
} from '../../../src/policy/steps/portfolio-quantile.js';
import { portfolioLowerBound } from '../../../src/policy/steps/optimize.js';
import { noTradeBandBase } from '../../../src/policy/steps/cost.js';
import type {
  DecisionInput,
  PolicyArtifact,
  RateCurve,
  ResidualPanel,
} from '../../../src/policy/types.js';

const WAD = 10n ** 18n;
const E14 = 10n ** 14n;

/** `a` swings +/-5e14; `b` swings +/-1e14 in the OPPOSITE direction. */
const TWO_VENUE_PANEL: ResidualPanel = {
  marketIds: ['a', 'b'],
  originsSeconds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  rows: [
    [-5n * E14, 1n * E14],
    [-4n * E14, 1n * E14],
    [-3n * E14, 0n],
    [-2n * E14, 0n],
    [-1n * E14, 0n],
    [1n * E14, 0n],
    [2n * E14, 0n],
    [3n * E14, -1n * E14],
    [4n * E14, -1n * E14],
    [5n * E14, -1n * E14],
  ],
};

function artifact(over: Partial<PolicyArtifact> = {}): PolicyArtifact {
  return {
    artifactHash: '0xa',
    policyVersion: 1,
    horizonSeconds: 604_800,
    coverageTarget: 0.9,
    method: 'ew-residual',
    methodParams: {},
    residualQuantileWadByMarket: {},
    portfolioResidualQuantileWad: -1n * 10n ** 13n,
    minObservations: 3,
    availabilityLagSeconds: 900,
    noTradeBandK: 1,
    configDigest: '0xc',
    pinnedConfigDigests: {},
    residualPanel: TWO_VENUE_PANEL,
    ...over,
  } as PolicyArtifact;
}

const mix = (a: bigint, b: bigint): Map<string, bigint> =>
  new Map([
    ['a', a],
    ['b', b],
  ]);

describe('portfolioResidualQuantileFor', () => {
  // THE NEW-7 defect, stated directly.
  it('discriminates between two mixes of IDENTICAL total notional', () => {
    const heavyA = portfolioResidualQuantileFor(artifact(), mix(900n, 100n));
    const heavyB = portfolioResidualQuantileFor(artifact(), mix(100n, 900n));

    expect(heavyA).not.toBe(heavyB);
    // `a` is the dispersed venue, so leaning on it is penalised harder.
    expect(heavyA).toBeLessThan(heavyB);
  });

  it('scales with the weight of the dispersed venue', () => {
    const q = (a: bigint): bigint => portfolioResidualQuantileFor(artifact(), mix(a, 1000n - a));

    const quarter = q(250n);
    const half = q(500n);
    const all = q(1000n);

    expect(all).toBeLessThan(half);
    expect(half).toBeLessThan(quarter);
  });

  it('equals the venue quantile when the whole target is one venue', () => {
    // coverageTarget 0.9, n = 10. `(1 - 0.9)` is 0.09999999999999998 in
    // binary floating point, so the index is floor(0.9999...) = 0 — the
    // smallest residual of `a`, -5e14. `calibrateResidualQuantiles` computes
    // the index with the identical expression, which is what keeps the
    // per-venue and portfolio quantiles the same estimator rather than two
    // that differ by an off-by-one.
    expect(portfolioResidualQuantileFor(artifact(), mix(1000n, 0n))).toBe(-5n * E14);
  });

  it('rewards diversification across negatively co-moving venues', () => {
    // `b` moves against `a`, so a mixed portfolio's worst period is milder
    // than the concentrated one's. A term that multiplied a constant by
    // notional could not express this at all.
    const concentrated = portfolioResidualQuantileFor(artifact(), mix(1000n, 0n));
    const diversified = portfolioResidualQuantileFor(artifact(), mix(700n, 300n));

    expect(diversified).toBeGreaterThan(concentrated);
  });

  it('is never positive', () => {
    const upOnly: ResidualPanel = {
      marketIds: ['a'],
      originsSeconds: [1, 2, 3, 4, 5],
      rows: [[1n * E14], [2n * E14], [3n * E14], [4n * E14], [5n * E14]],
    };

    expect(
      portfolioResidualQuantileFor(artifact({ residualPanel: upOnly }), new Map([['a', 100n]])),
    ).toBeLessThanOrEqual(0n);
  });

  describe('fallback to the registered scalar', () => {
    it('falls back when the artifact carries no panel', () => {
      const a = artifact();
      delete (a as { residualPanel?: ResidualPanel }).residualPanel;

      expect(portfolioResidualQuantileFor(a, mix(500n, 500n))).toBe(a.portfolioResidualQuantileWad);
      expect(portfolioQuantileProvenance(a, mix(500n, 500n))).toBe('frozen-scalar');
    });

    it('falls back when the target deploys nothing', () => {
      expect(portfolioResidualQuantileFor(artifact(), new Map())).toBe(
        artifact().portfolioResidualQuantileWad,
      );
    });

    it('falls back when the target holds only venues the panel does not cover', () => {
      // Attributing `a`'s dispersion to a market the panel never observed
      // would be inventing a calibration.
      const target = new Map([['unknown-venue', 1000n]]);

      expect(portfolioResidualQuantileFor(artifact(), target)).toBe(
        artifact().portfolioResidualQuantileWad,
      );
      expect(portfolioQuantileProvenance(artifact(), target)).toBe('frozen-scalar');
    });

    it('reports calibrated provenance when the panel is used', () => {
      expect(portfolioQuantileProvenance(artifact(), mix(500n, 500n))).toBe('calibrated-panel');
    });
  });
});

describe('portfolioWeightsWad', () => {
  it('normalises over the TOTAL target, including un-panelled venues', () => {
    // Half the money sits in a venue the panel does not cover. The covered
    // half must keep weight 0.5, not be renormalised to 1.0 — otherwise the
    // un-panelled half's risk is quietly reweighted onto `a`.
    const w = portfolioWeightsWad(['a', 'b'], new Map([['a', 500n], ['other', 500n]]))!;

    expect(w[0]).toBe(WAD / 2n);
    expect(w[1]).toBe(0n);
  });

  it('ignores negative entries rather than letting them cancel real weight', () => {
    const w = portfolioWeightsWad(['a', 'b'], new Map([['a', 400n], ['b', -100n]]))!;

    expect(w[0]).toBe(WAD);
    expect(w[1]).toBe(0n);
  });

  it('returns null for an empty target', () => {
    expect(portfolioWeightsWad(['a'], new Map())).toBeNull();
  });
});

describe('empiricalLowerQuantile', () => {
  it('takes the (1 - coverage) order statistic', () => {
    const sample = [5n, 1n, 4n, 2n, 3n, 9n, 8n, 7n, 6n, 0n];

    expect(empiricalLowerQuantile(sample, 0.7)).toBe(3n);
    expect(empiricalLowerQuantile(sample, 0.8)).toBe(1n);
    expect(empiricalLowerQuantile(sample, 0.95)).toBe(0n);
  });

  it('clamps to the smallest observation rather than reading past the end', () => {
    expect(empiricalLowerQuantile([7n, 3n, 5n], 0.0)).toBe(7n);
  });

  it('returns 0n for an empty sample', () => {
    expect(empiricalLowerQuantile([], 0.95)).toBe(0n);
  });
});

describe('buildResidualPanel', () => {
  const label = (marketId: string, originSeconds: number, realizedReturnWad: bigint) => ({
    marketId,
    originSeconds,
    realizedReturnWad,
  });

  it('de-means per venue and aligns rows by origin', () => {
    const labels = [
      label('a', 1, 10n), label('a', 2, 20n), label('a', 3, 30n),
      label('b', 1, 100n), label('b', 2, 100n), label('b', 3, 130n),
    ];

    const panel = buildResidualPanel(labels, 3)!;

    expect(panel.marketIds).toEqual(['a', 'b']);
    expect(panel.originsSeconds).toEqual([1, 2, 3]);
    expect(panel.rows).toEqual([
      [-10n, -10n],
      [0n, -10n],
      [10n, 20n],
    ]);
  });

  it('drops an origin at which any panel venue has no observation', () => {
    // A portfolio residual needs one observation per venue at the SAME
    // instant; filling the gap with 0 would assert that venue had no
    // dispersion that period.
    const labels = [
      label('a', 1, 10n), label('a', 2, 20n), label('a', 3, 30n), label('a', 4, 40n),
      label('b', 1, 10n), label('b', 3, 30n), label('b', 4, 40n),
    ];

    const panel = buildResidualPanel(labels, 3)!;

    expect(panel.originsSeconds).toEqual([1, 3, 4]);
  });

  it('returns undefined below minObservations', () => {
    expect(buildResidualPanel([label('a', 1, 10n), label('a', 2, 20n)], 3)).toBeUndefined();
  });

  it('returns undefined for no labels at all', () => {
    expect(buildResidualPanel([], 3)).toBeUndefined();
  });

  // A constant-rate window has not measured a dispersion of zero; it has
  // measured nothing. Returning the panel would make q^p identically 0 — the
  // most optimistic value available — silently overriding the artifact's
  // registered conservative quantile.
  it('reports NO CALIBRATION for an all-zero panel rather than an optimistic zero', () => {
    const flat = [
      label('a', 1, 50n), label('a', 2, 50n), label('a', 3, 50n),
      label('b', 1, 40n), label('b', 2, 40n), label('b', 3, 40n),
    ];

    expect(buildResidualPanel(flat, 3)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The objective and the band, through the real call sites
// ---------------------------------------------------------------------------

/** A flat 5% APY curve over [0, maxX]. */
function curve(marketId: string, points: number, quantumBase: bigint): RateCurve {
  return {
    marketId,
    quantumBase,
    points: Array.from({ length: points }, () => (WAD * 5n) / 100n),
    maxXBase: quantumBase * BigInt(points - 1),
  };
}

const CURVES: RateCurve[] = [curve('a', 11, 100_000_000n), curve('b', 11, 100_000_000n)];

const INPUT = {
  markets: [
    { marketId: 'a', maxWithdrawableBase: 10n ** 15n },
    { marketId: 'b', maxWithdrawableBase: 10n ** 15n },
  ],
} as unknown as DecisionInput;

const bigMix = (a: bigint, b: bigint): Map<string, bigint> =>
  new Map([
    ['a', a * 100_000_000n],
    ['b', b * 100_000_000n],
  ]);

describe('portfolioLowerBound with a calibrated quantile', () => {
  // The exact NEW-7 sentence: "Two candidates deploying the same total in
  // different proportions get identical quantile terms, so the P2 objective
  // never changes a ranking."
  it('ranks two equal-notional mixes differently', () => {
    const heavyA = portfolioLowerBound(INPUT, CURVES, artifact(), bigMix(9n, 1n));
    const heavyB = portfolioLowerBound(INPUT, CURVES, artifact(), bigMix(1n, 9n));

    expect(heavyA).not.toBe(heavyB);
    expect(heavyB).toBeGreaterThan(heavyA);
  });

  it('gives the two mixes an IDENTICAL score once the panel is removed', () => {
    // Both venues quote the same flat rate, so with a mix-invariant quantile
    // term the objective cannot tell them apart at all. This is the
    // behaviour being fixed, pinned so a regression is visible.
    const noPanel = artifact();
    delete (noPanel as { residualPanel?: ResidualPanel }).residualPanel;

    expect(portfolioLowerBound(INPUT, CURVES, noPanel, bigMix(9n, 1n))).toBe(
      portfolioLowerBound(INPUT, CURVES, noPanel, bigMix(1n, 9n)),
    );
  });

  it('still removes the term entirely under H2 (disable.uncertainty)', () => {
    const disable = { uncertainty: true };

    expect(portfolioLowerBound(INPUT, CURVES, artifact(), bigMix(9n, 1n), disable)).toBe(
      portfolioLowerBound(INPUT, CURVES, artifact(), bigMix(1n, 9n), disable),
    );
  });
});

describe('noTradeBandBase', () => {
  const NOTIONAL = 1_000_000_000_000n; // 1,000,000 USDC

  // THE NEW-8 defect: the band was a constant fraction of notional, so it
  // could never be the binding term and P8 was decorative.
  it('widens for a concentrated high-dispersion target', () => {
    const concentrated = noTradeBandBase(INPUT, CURVES, artifact(), NOTIONAL, mix(1000n, 0n));
    const diversified = noTradeBandBase(INPUT, CURVES, artifact(), NOTIONAL, mix(700n, 300n));

    expect(concentrated).toBeGreaterThan(diversified);
  });

  it('narrows for a target in the LOW-dispersion venue', () => {
    // `b`'s worst residual is -1e14 against `a`'s -5e14, so the same
    // notional moved into `b` faces a fifth of the band. A constant times
    // notional cannot express this.
    const inB = noTradeBandBase(INPUT, CURVES, artifact(), NOTIONAL, mix(0n, 1000n));
    const inA = noTradeBandBase(INPUT, CURVES, artifact(), NOTIONAL, mix(1000n, 0n));

    expect(inB).toBe(100_000_000n); // 100 USDC
    expect(inA).toBe(inB * 5n);
  });

  it('scales linearly with k', () => {
    const one = noTradeBandBase(INPUT, CURVES, artifact({ noTradeBandK: 1 }), NOTIONAL, mix(1000n, 0n));
    const two = noTradeBandBase(INPUT, CURVES, artifact({ noTradeBandK: 2 }), NOTIONAL, mix(1000n, 0n));

    expect(two).toBe(one * 2n);
  });

  it('is zero when k is zero', () => {
    expect(
      noTradeBandBase(INPUT, CURVES, artifact({ noTradeBandK: 0 }), NOTIONAL, mix(1000n, 0n)),
    ).toBe(0n);
  });

  // The size claim. C_move on a $1M Base move is ~800 USDC (8 bps of
  // notional from impact + slippage + MEV). With the shipped placeholder
  // (sigma = 1e13 WAD, k = 1) the band was ~10 USDC — about 80x too small to
  // ever bind. A dispersion read off real residuals is the same order as
  // C_move.
  it('is orders of magnitude larger than the Phase 1 placeholder band', () => {
    const placeholder = artifact({ portfolioResidualQuantileWad: -1n * 10n ** 13n });
    delete (placeholder as { residualPanel?: ResidualPanel }).residualPanel;

    const placeholderBand = noTradeBandBase(INPUT, CURVES, placeholder, NOTIONAL, mix(1000n, 0n));
    const calibratedBand = noTradeBandBase(INPUT, CURVES, artifact(), NOTIONAL, mix(1000n, 0n));

    expect(placeholderBand).toBe(10_000_000n); // 10 USDC
    expect(calibratedBand).toBeGreaterThan(placeholderBand * 20n);
    // 500 USDC: the same order as C_move, so `max(C_move, k*sigma)` can
    // actually be the band rather than always being C_move.
    expect(calibratedBand).toBe(500_000_000n);
  });
});
