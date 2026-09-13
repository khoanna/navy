import { describe, it, expect } from '@jest/globals';
import {
  alignedResiduals,
  chiSquareUpperTail,
  christoffersenTest,
  independenceTest,
  kupiecTest,
  resolveSweepMethod,
  runForecastGate,
  thinToNonOverlapping,
  MIN_EXCEEDANCE_OBSERVATIONS,
  type ArtifactRegistration,
} from '../../../src/evaluation/kernel/forecast-gate.js';
import { computeArtifactHash } from '../../../src/policy/artifact.js';
import { MIN_SELECTION_MARGIN, registeredGrid } from '../../../src/forecast/grid-sweep.js';
import { REGISTERED_ERAS, testableHorizons, type EraTag } from '../../../src/evaluation/eras.js';
import { REGISTERED_HORIZONS_SECONDS } from '../../../src/policy/registered.js';

/**
 * The REGISTERED grid is the full grid minus horizons this gate cannot test:
 * Christoffersen runs on non-overlapping windows, so a horizon too long for a
 * sealed era leaves too few to test. The sweep and the gate must agree on
 * this, which is the divergence the grid check exists to catch.
 */
const testableGridSize = (): number => {
  const admissible = testableHorizons(
    [...REGISTERED_HORIZONS_SECONDS],
    MIN_EXCEEDANCE_OBSERVATIONS,
    (Object.keys(REGISTERED_ERAS) as EraTag[]).filter((e) => REGISTERED_ERAS[e].sealed),
  );
  return registeredGrid().filter((p) => admissible.includes(p.horizonSeconds)).length;
};
import type { RegisteredGateCheck } from '../../../src/evaluation/kernel/gates.js';
import type { CompletedLabel, PolicyArtifact, ResidualPanel } from '../../../src/policy/types.js';

const HORIZON = 86_400;
const LAG = 900;
const CADENCE = 3_600;
const MARKETS = ['aave-v3-usdc', 'compound-v3-usdc', 'moonwell-usdc'];
const WARMUP = 30;
const ORIGINS = 900;

/**
 * A deterministic integer hash. Used instead of `Math.random` so the residual
 * distribution has a real tail (a short periodic wobble takes only a handful
 * of distinct values, and a 1% order statistic on it collapses onto the
 * minimum, which would make every coverage figure exactly 100% and every
 * Kupiec test a rejection of ZERO breaches rather than of a wrong rate) while
 * the suite still gives the same p-values on every machine, forever.
 */
function mix(i: number): number {
  let t = (i * 2654435761) >>> 0;
  t ^= t >>> 15;
  t = Math.imul(t, 2246822519) >>> 0;
  t ^= t >>> 13;
  return t >>> 0;
}

/**
 * A deterministic label series: a constant level plus a bounded, hash-driven
 * deviation, so a rolling-mean forecast has a repeatable residual whose
 * quantiles are exactly computable.
 */
function labels(
  opts: {
    markets?: readonly string[];
    origins?: number;
    /** Called for the residual driver at index i; WAD. */
    wobble?: (i: number, marketId: string) => bigint;
    regimeAt?: (i: number, marketId: string) => string;
    availableAt?: (originSeconds: number) => number;
    horizonEnd?: (originSeconds: number) => number;
  } = {},
): CompletedLabel[] {
  const markets = opts.markets ?? MARKETS;
  const origins = opts.origins ?? ORIGINS;
  const wobble =
    opts.wobble ??
    ((i, marketId) =>
      BigInt((mix(i + 977 * (MARKETS.indexOf(marketId) + 1)) % 2001) - 1000) * 10n ** 12n);
  const out: CompletedLabel[] = [];
  for (let i = 0; i < origins; i++) {
    const originSeconds = 1_700_000_000 + i * CADENCE;
    const horizonEndSeconds = opts.horizonEnd
      ? opts.horizonEnd(originSeconds)
      : originSeconds + HORIZON;
    for (const marketId of markets) {
      out.push({
        marketId,
        regimeId: opts.regimeAt ? opts.regimeAt(i, marketId) : `${marketId}:r0`,
        originSeconds,
        horizonSeconds: HORIZON,
        horizonEndSeconds,
        availableAtSeconds: opts.availableAt
          ? opts.availableAt(originSeconds)
          : horizonEndSeconds + LAG,
        realizedReturnWad: 10n ** 15n + wobble(i, marketId),
        realizedMinCashBase: 1_000_000_000n,
        originCashBase: 1_000_000_000n,
      });
    }
  }
  return out;
}

function panel(): ResidualPanel {
  return {
    marketIds: [...MARKETS],
    originsSeconds: [1_700_000_000, 1_700_003_600],
    rows: [
      [-1n, -2n, -3n],
      [-2n, -3n, -4n],
    ],
  };
}

function registration(over: Partial<ArtifactRegistration> = {}): ArtifactRegistration {
  return {
    gridPoints: testableGridSize(),
    scorablePoints: testableGridSize(),
    selectionMargin: MIN_SELECTION_MARGIN * 10,
    ...over,
  };
}

/** Build an artifact whose hash is self-consistent. */
function artifact(over: Partial<PolicyArtifact> = {}): PolicyArtifact {
  const body: Omit<PolicyArtifact, 'artifactHash'> = {
    policyVersion: 5,
    horizonSeconds: HORIZON,
    coverageTarget: 0.99,
    method: 'rolling',
    methodParams: { windowObservations: 24 },
    // Well below every residual this fixture produces, so nothing breaches
    // and achieved coverage is 100%.
    residualQuantileWadByMarket: Object.fromEntries(
      MARKETS.map((m) => [m, -(10n ** 16n)] as const),
    ),
    cashResidualQuantileWadByMarket: Object.fromEntries(
      MARKETS.map((m) => [m, -5n * (10n ** 17n)] as const),
    ),
    cashLowerBoundQuantileWad: -(10n ** 17n),
    portfolioResidualQuantileWad: -(10n ** 16n),
    residualPanel: panel(),
    minObservations: WARMUP,
    availabilityLagSeconds: LAG,
    noTradeBandK: 1,
    paybackSeconds: 30 * 86_400,
    adjustmentRate: 0.5,
    edgeWindowEffective: 40,
    configDigest: 'registered-test',
    pinnedConfigDigests: Object.fromEntries(MARKETS.map((m) => [m, `pin:${m}`] as const)),
    ...over,
  } as Omit<PolicyArtifact, 'artifactHash'>;
  return { ...body, artifactHash: computeArtifactHash(body) };
}

/**
 * A well-formed registered artifact: its per-venue quantile is the order
 * statistic that ACHIEVES the registered 99% target on the label series, which
 * is what a correctly fit artifact looks like. A quantile far below every
 * residual is not "safe", it is miscalibrated in the other direction — zero
 * breaches in 870 observations is a Kupiec rejection just as a hundred are.
 */
function goodArtifact(): PolicyArtifact {
  return artifactWithCoverage(0.99);
}

/**
 * Coverage is a property of the QUANTILE against the residual series, so an
 * artifact "with coverage 0.88" is one whose registered quantile the residual
 * series breaches 12% of the time. Solve for it rather than asserting it.
 */
function artifactWithCoverage(target: number): PolicyArtifact {
  const residuals = alignedResiduals('rolling', { windowObservations: 24 }, labels(), HORIZON, WARMUP)!;
  const quantiles: Record<string, bigint> = {};
  for (const marketId of MARKETS) {
    const sorted = residuals.get(marketId)!.map((r) => r.residualWad).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    // Index `floor((1 - target) * n)` leaves exactly `target` of the sample at
    // or above it — the same construction `solveQuantileForCoverage` uses.
    const idx = Math.floor((1 - target) * sorted.length);
    quantiles[marketId] = sorted[Math.min(idx, sorted.length - 1)]!;
  }
  return artifact({ residualQuantileWadByMarket: quantiles });
}

function artifactMissingPanel(): PolicyArtifact {
  const a = artifact();
  const { residualPanel: _drop, artifactHash: _h, ...rest } = a;
  return { ...rest, artifactHash: computeArtifactHash(rest) };
}

const find = (r: { checks: RegisteredGateCheck[] }, prefix: string): RegisteredGateCheck =>
  r.checks.find((c) => c.name.startsWith(prefix))!;

describe('§11.5 forecast gate', () => {
  it('FAILS when achieved coverage misses the target', () => {
    const g = runForecastGate(artifactWithCoverage(0.88), labels(), {
      registration: registration(),
    });
    expect(find(g, 'Per-venue coverage').passed).toBe(false);
    expect(g.pass).toBe(false);
  });

  it('FAILS when the artifact is missing a field the policy reads (P23)', () => {
    const g = runForecastGate(artifactMissingPanel(), labels(), {
      registration: registration(),
    });
    expect(find(g, 'Artifact completeness').passed).toBe(false);
    expect(find(g, 'Artifact completeness').detail).toContain('residualPanel');
  });

  it('FAILS when the selection margin is below the registered threshold', () => {
    const g = runForecastGate(goodArtifact(), labels(), {
      registration: registration({ selectionMargin: 1.27e-7 }),
    });
    expect(find(g, 'Selection margin').passed).toBe(false);
    expect(g.blockedReasons).toContain('Selection margin');
  });

  it('PASSES a well-formed registered artifact', () => {
    const g = runForecastGate(goodArtifact(), labels(), { registration: registration() });
    expect(g.blockedReasons).toEqual([]);
    expect(g.pass).toBe(true);
  });
});

describe('the forecast gate is three-valued, and null never passes', () => {
  it('reports NOT PRODUCED — not a pass — when the registration block is absent', () => {
    const g = runForecastGate(goodArtifact(), labels(), {});
    expect(find(g, 'Registered grid points').passed).toBeNull();
    expect(find(g, 'Selection margin').passed).toBeNull();
    expect(g.pass).toBe(false);
    expect(g.blockedReasons).toContain('Selection margin');
  });

  it('reports NOT PRODUCED for a method whose residuals it cannot recompute', () => {
    const g = runForecastGate(
      artifact({ method: 'state-space', methodParams: { halfLifeObservations: 24 } }),
      labels(),
      { registration: registration() },
    );
    expect(find(g, 'Per-venue coverage').passed).toBeNull();
    expect(find(g, 'Kupiec').passed).toBeNull();
    expect(find(g, 'Christoffersen').passed).toBeNull();
    expect(g.pass).toBe(false);
  });

  it('every check gates — the forecast gate has no reported-only line', () => {
    const g = runForecastGate(goodArtifact(), labels(), { registration: registration() });
    for (const c of g.checks) expect(c.gating).toBe(true);
    expect(g.blockedReasons).toEqual(
      g.checks.filter((c) => c.passed !== true).map((c) => c.name),
    );
  });
});

describe('the measured label checks', () => {
  it('FAILS regime purity when the impure SHARE exceeds the registered tolerance', () => {
    // Alternating every label makes essentially every window straddle, which
    // is contamination at a level that could move a calibration.
    const g = runForecastGate(
      goodArtifact(),
      labels({ regimeAt: (i, m) => `${m}:r${i % 2}` }),
      { registration: registration() },
    );
    const c = find(g, 'Regime purity');
    expect(c.passed).toBe(false);
    expect(c.detail).toContain('straddle');
  });

  it('PASSES regime purity for a single governance boundary, and still reports it', () => {
    // THE POINT OF THE REVISION. One regime change in the middle of an era is
    // an exogenous governance action, not a defect in the forecast, and a
    // zero-tolerance check could only ever be met by an era in which no
    // governance happened. The straddling windows are still REPORTED.
    const g = runForecastGate(
      goodArtifact(),
      labels({ regimeAt: (i, m) => `${m}:r${i < 200 ? 0 : 1}` }),
      { registration: registration() },
    );
    const c = find(g, 'Regime purity');
    expect(c.passed).toBe(true);
    expect(c.detail).toMatch(/tolerance/);
  });

  it('FAILS the availability-lag barrier when a label is readable too early', () => {
    const g = runForecastGate(
      goodArtifact(),
      labels({ availableAt: (o) => o + HORIZON }),
      { registration: registration() },
    );
    expect(find(g, 'Availability-lag barrier').passed).toBe(false);
  });

  it('FAILS the availability-lag barrier when horizonEnd is not origin + H', () => {
    const g = runForecastGate(
      goodArtifact(),
      labels({ horizonEnd: (o) => o + HORIZON - 1 }),
      { registration: registration() },
    );
    expect(find(g, 'Availability-lag barrier').passed).toBe(false);
  });

  it('FAILS label completeness when a registered venue is missing', () => {
    const g = runForecastGate(goodArtifact(), labels({ markets: MARKETS.slice(0, 2) }), {
      registration: registration(),
    });
    const c = find(g, 'Label completeness');
    expect(c.passed).toBe(false);
    expect(c.detail).toContain('moonwell-usdc');
  });
});

describe('the registered-grid check', () => {
  it('FAILS when the sweep scored fewer points than the registered grid', () => {
    const g = runForecastGate(goodArtifact(), labels(), {
      registration: registration({ scorablePoints: testableGridSize() - 1 }),
    });
    expect(find(g, 'Registered grid points').passed).toBe(false);
  });

  it('counts the registered grid rather than a hardcoded number', () => {
    const g = runForecastGate(goodArtifact(), labels(), { registration: registration() });
    expect(find(g, 'Registered grid points').detail).toContain(
      `registered grid ${testableGridSize()}`,
    );
  });
});

describe('artifact reproducibility', () => {
  it('FAILS when the declared hash does not describe the body', () => {
    const g = runForecastGate({ ...goodArtifact(), artifactHash: '0xdeadbeef' }, labels(), {
      registration: registration(),
    });
    expect(find(g, 'Artifact reproducibility').passed).toBe(false);
  });

  it('FAILS a provisional artifact', () => {
    const g = runForecastGate({ ...goodArtifact(), _provisional: 'bootstrap' }, labels(), {
      registration: registration(),
    });
    expect(find(g, 'Calibrated artifact').passed).toBe(false);
  });

  it('FAILS an artifact whose adjustment rate is outside (0, 1]', () => {
    const g = runForecastGate(artifact({ adjustmentRate: 0 }), labels(), {
      registration: registration(),
    });
    expect(find(g, 'Artifact completeness').detail).toContain('adjustmentRate');
  });
});

describe('Kupiec and Christoffersen', () => {
  it('chi-square upper tails are the exact 1- and 2-dof closed forms', () => {
    // chi2(1) at 3.841459 is the 95th percentile.
    expect(chiSquareUpperTail(3.841459, 1)).toBeCloseTo(0.05, 4);
    // chi2(2) at 5.991465 is the 95th percentile: exp(-x/2).
    expect(chiSquareUpperTail(5.991465, 2)).toBeCloseTo(0.05, 6);
    expect(chiSquareUpperTail(0, 1)).toBe(1);
    expect(chiSquareUpperTail(-1, 2)).toBe(1);
  });

  it('Kupiec does not reject when the breach rate equals the expected rate', () => {
    const k = kupiecTest(10, 1000, 0.01)!;
    expect(k.lr).toBeCloseTo(0, 8);
    expect(k.pValue).toBeCloseTo(1, 6);
  });

  it('Kupiec rejects a breach rate ten times the expected one', () => {
    const k = kupiecTest(100, 1000, 0.01)!;
    expect(k.pValue).toBeLessThan(0.01);
  });

  it('Kupiec handles zero exceedances without a NaN', () => {
    const k = kupiecTest(0, 1000, 0.01)!;
    expect(Number.isFinite(k.lr)).toBe(true);
    expect(k.pValue).toBeLessThan(0.05);
  });

  it('Kupiec returns null rather than a fabricated p-value with no observations', () => {
    expect(kupiecTest(0, 0, 0.01)).toBeNull();
  });

  it('Christoffersen rejects a perfectly clustered exceedance stream', () => {
    // 10 breaches, all consecutive: the rate is right, the pattern is not.
    const stream = Array.from({ length: 100 }, (_, i) => i >= 20 && i < 30);
    const c = christoffersenTest(stream, 0.1)!;
    expect(c.lrInd).toBeGreaterThan(5);
    expect(c.pValue).toBeLessThan(0.05);
  });

  it('Christoffersen does not reject an evenly spaced stream at the right rate', () => {
    const stream = Array.from({ length: 100 }, (_, i) => i % 10 === 0);
    const c = christoffersenTest(stream, 0.1)!;
    expect(c.pValue).toBeGreaterThan(0.05);
  });

  it('Christoffersen returns null on a degenerate stream', () => {
    expect(christoffersenTest([], 0.01)).toBeNull();
    expect(christoffersenTest([true], 0.01)).toBeNull();
  });
});

describe('the dependence-aware stream', () => {
  it('thins overlapping windows to non-overlapping ones', () => {
    const rows = Array.from({ length: 48 }, (_, i) => ({ originSeconds: i * 3_600 }));
    const kept = thinToNonOverlapping(rows, 86_400);
    expect(kept.map((r) => r.originSeconds)).toEqual([0, 86_400]);
  });

  it('keeps every observation when the cadence already exceeds the horizon', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ originSeconds: i * 172_800 }));
    expect(thinToNonOverlapping(rows, 86_400)).toHaveLength(5);
  });

  it('reports Christoffersen NOT PRODUCED when thinning leaves too few windows', () => {
    // 400 hourly origins thin to 17 daily windows — below the minimum, while
    // the raw stream (370 residuals) is comfortably above it. The independence
    // statement is therefore withheld while the unconditional one is still
    // made: the two are separate claims with separate evidence.
    const g = runForecastGate(goodArtifact(), labels({ origins: 400 }), {
      registration: registration(),
    });
    const kupiec = find(g, 'Kupiec');
    const cc = find(g, 'Christoffersen');
    expect(kupiec.passed).not.toBeNull();
    expect(cc.passed).toBeNull();
    expect(cc.detail).toContain(`${MIN_EXCEEDANCE_OBSERVATIONS}`);
  });
});

describe('method-name resolution', () => {
  it("maps the policy artifact's 'arx' onto the sweep's 'direct-arx'", () => {
    expect(resolveSweepMethod('arx')).toBe('direct-arx');
  });

  it('refuses an unrecognised method rather than defaulting', () => {
    expect(resolveSweepMethod('lstm')).toBeNull();
    expect(alignedResiduals('lstm', {}, labels(), HORIZON, WARMUP)).toBeNull();
  });
});

describe('aligned residuals', () => {
  it('is strictly causal — the first scored residual is at index minObservations', () => {
    const ls = labels({ markets: ['aave-v3-usdc'], origins: 60 });
    const rows = alignedResiduals('rolling', { windowObservations: 24 }, ls, HORIZON, WARMUP)!;
    const series = rows.get('aave-v3-usdc')!;
    expect(series).toHaveLength(60 - WARMUP);
    expect(series[0]!.originSeconds).toBe(ls[WARMUP]!.originSeconds);
  });

  it('ignores labels at a different horizon', () => {
    const ls = labels({ markets: ['aave-v3-usdc'], origins: 60 }).map((l) => ({
      ...l,
      horizonSeconds: 604_800 as CompletedLabel['horizonSeconds'],
    }));
    expect(alignedResiduals('rolling', {}, ls, HORIZON, WARMUP)!.size).toBe(0);
  });
});

describe('P37 (G2): one-sided coverage tests', () => {
  it('cannot reject a lower bound for breaching LESS often than expected', () => {
    const oneSided = kupiecTest(0, 2_290, 0.01, 'above')!;
    expect(oneSided.pValue).toBe(1);
    // The two-sided statistic on the same stream still rejects, and stays
    // available as a reported diagnostic.
    expect(kupiecTest(0, 2_290, 0.01)!.pValue).toBeLessThan(0.05);
  });

  it('halves the two-sided tail when the breach rate is above expected', () => {
    const twoSided = kupiecTest(15, 1_000, 0.01)!;
    const oneSided = kupiecTest(15, 1_000, 0.01, 'above')!;
    expect(oneSided.lr).toBe(twoSided.lr);
    expect(oneSided.pValue).toBeCloseTo(twoSided.pValue / 2, 12);
  });

  it('the independence test rejects clustered breaches at an on-target rate', () => {
    const stream = Array.from({ length: 100 }, (_, i) => i >= 20 && i < 30);
    const t = independenceTest(stream)!;
    expect(t.lrInd).toBeGreaterThan(5);
    expect(t.pValue).toBeLessThan(0.05);
  });

  it('the independence test does not reject evenly spaced breaches', () => {
    const stream = Array.from({ length: 100 }, (_, i) => i % 10 === 0);
    expect(independenceTest(stream)!.pValue).toBeGreaterThan(0.05);
  });

  it('the independence test returns null on a degenerate stream', () => {
    expect(independenceTest([])).toBeNull();
    expect(independenceTest([true])).toBeNull();
  });
});

describe('P37 (G1): the forecast domain excludes dry label windows (P34)', () => {
  const DRY = 'moonwell-usdc';
  /** Label index of an origin in the `labels()` fixture. */
  const indexOf = (l: CompletedLabel): number => (l.originSeconds - 1_700_000_000) / CADENCE;
  /**
   * `DRY` is at zero cash for every label window that touches origins
   * [600, 700): windows starting in [576, 700). Its realized returns collapse
   * on [600, 700), so the rolling forecast breaches there.
   */
  function dryLabels(): CompletedLabel[] {
    return labels({
      wobble: (i, marketId) =>
        marketId === DRY && i >= 600 && i < 700
          ? -(10n ** 17n)
          : BigInt((mix(i + 977 * (MARKETS.indexOf(marketId) + 1)) % 2001) - 1000) * 10n ** 12n,
    }).map((l) =>
      l.marketId === DRY && indexOf(l) >= 576 && indexOf(l) < 700
        ? { ...l, realizedMinCashBase: 0n }
        : l,
    );
  }

  it('v0.10 grades the dry window and fails that venue\'s coverage', () => {
    const g = runForecastGate(goodArtifact(), dryLabels(), { registration: registration() });
    expect(find(g, `Per-venue coverage — ${DRY}`).passed).toBe(false);
  });

  it('P37 excludes every residual whose window saw zero cash, and says how many', () => {
    const g = runForecastGate(goodArtifact(), dryLabels(), {
      registration: registration(),
      amendment: 'p37',
    });
    const c = find(g, `Per-venue coverage, P34 domain — ${DRY}`);
    expect(c.passed).toBe(true);
    expect(c.detail).toContain('P34 domain: 124 residual(s) excluded');
  });

  it('an all-dry venue reports NOT EVALUATED and blocks — never a pass', () => {
    const ls = labels().map((l) => (l.marketId === DRY ? { ...l, realizedMinCashBase: 0n } : l));
    const g = runForecastGate(goodArtifact(), ls, { registration: registration(), amendment: 'p37' });
    const c = find(g, `Per-venue coverage, P34 domain — ${DRY}`);
    expect(c.passed).toBeNull();
    expect(c.detail).toMatch(/^NOT EVALUATED/);
    // G1: the detail reports the breaches among the excluded rows too, not
    // just their count.
    expect(c.detail).toMatch(/\(\d+ of them breaches\)/);
    expect(g.pass).toBe(false);
  });
});

describe('P37 (G2) inside the gate', () => {
  it('does not reject a floor for being too safe', () => {
    // `artifact()` places every quantile below every residual: zero breaches.
    const p37 = runForecastGate(artifact(), labels(), { registration: registration(), amendment: 'p37' });
    expect(find(p37, 'Kupiec unconditional coverage, one-sided — aave-v3-usdc').passed).toBe(true);
    expect(find(p37, 'Kupiec unconditional coverage, one-sided — aave-v3-usdc').detail).toContain(
      'two-sided p',
    );
    const v010 = runForecastGate(artifact(), labels(), { registration: registration() });
    expect(find(v010, 'Kupiec unconditional coverage — aave-v3-usdc').passed).toBe(false);
  });

  it('gates Christoffersen on independence and reports LR_cc', () => {
    const g = runForecastGate(goodArtifact(), labels(), { registration: registration(), amendment: 'p37' });
    const c = find(g, 'Christoffersen independence — aave-v3-usdc');
    expect(c.detail).toMatch(/^LR_ind /);
    expect(c.detail).toContain('LR_cc');
  });

  it('leaves the default (v0.10) gate byte-identical', () => {
    const implicit = runForecastGate(goodArtifact(), labels(), { registration: registration() });
    const explicit = runForecastGate(goodArtifact(), labels(), {
      registration: registration(),
      amendment: 'v0.10',
    });
    expect(explicit).toEqual(implicit);
  });
});
