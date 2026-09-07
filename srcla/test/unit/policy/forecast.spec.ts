import { computeArtifactHash, loadBootstrapArtifact } from '../../../src/policy/artifact.js';
import { lowerBoundAt, exitableFraction } from '../../../src/policy/steps/forecast.js';
import type { PolicyArtifact, RateCurve } from '../../../src/policy/types.js';

const WAD = 10n ** 18n;

const curve: RateCurve = {
  marketId: 'aave',
  quantumBase: 1_000_000_000n,
  points: [(WAD * 5n) / 100n, (WAD * 4n) / 100n, (WAD * 3n) / 100n],
  maxXBase: 2_000_000_000n,
};

function artifact(over: Partial<PolicyArtifact> = {}): PolicyArtifact {
  return {
    ...loadBootstrapArtifact(),
    residualQuantileWadByMarket: { aave: -(WAD / 1000n), compound: -(WAD / 500n) },
    ...over,
  };
}

describe('lowerBoundAt', () => {
  it('subtracts the per-venue residual quantile from the point forecast', () => {
    const a = artifact();
    const lower = lowerBoundAt(curve, a, 'aave', 0n, 604_800);
    const horizonMu = ((WAD * 5n) / 100n) * 604_800n / 31_536_000n;
    expect(lower).toBe(horizonMu - WAD / 1000n);
  });

  it('uses a different quantile for a different venue (P1)', () => {
    const a = artifact();
    const aaveQ = a.residualQuantileWadByMarket['aave']!;
    const compQ = a.residualQuantileWadByMarket['compound']!;
    expect(aaveQ).not.toBe(compQ);
  });

  it('falls back to the most conservative registered quantile for an unknown venue', () => {
    const a = artifact();
    const lower = lowerBoundAt(curve, a, 'unknown', 0n, 604_800);
    const horizonMu = ((WAD * 5n) / 100n) * 604_800n / 31_536_000n;
    expect(lower).toBe(horizonMu - WAD / 500n);
  });

  it('decreases as allocation grows, because the curve does', () => {
    const a = artifact();
    const at0 = lowerBoundAt(curve, a, 'aave', 0n, 604_800);
    const at2 = lowerBoundAt(curve, a, 'aave', 2_000_000_000n, 604_800);
    expect(at2 < at0).toBe(true);
  });

  it('rejects a positive residual quantile — the bound must not exceed the mean', () => {
    const bad = artifact({ residualQuantileWadByMarket: { aave: WAD / 1000n } });
    expect(() => lowerBoundAt(curve, bad, 'aave', 0n, 604_800)).toThrow(/must be <= 0/);
  });
});

describe('exitableFraction (P4)', () => {
  it('is 1 when the whole position is synchronously withdrawable', () => {
    expect(exitableFraction(1_000n, 1_000n)).toBe(1);
  });

  it('is 0 when nothing can be withdrawn', () => {
    expect(exitableFraction(1_000n, 0n)).toBe(0);
  });

  it('is the ratio in between', () => {
    expect(exitableFraction(1_000n, 250n)).toBeCloseTo(0.25, 10);
  });

  it('treats a zero target position as fully exitable', () => {
    expect(exitableFraction(0n, 0n)).toBe(1);
  });
});

describe('computeArtifactHash', () => {
  it('is stable across key ordering', () => {
    const { artifactHash: _drop, ...rest } = loadBootstrapArtifact();
    const reordered = Object.fromEntries(Object.entries(rest).reverse()) as typeof rest;
    expect(computeArtifactHash(rest)).toBe(computeArtifactHash(reordered));
  });

  it('changes when a calibrated value changes', () => {
    const { artifactHash: _drop, ...rest } = loadBootstrapArtifact();
    const changed = { ...rest, portfolioResidualQuantileWad: rest.portfolioResidualQuantileWad - 1n };
    expect(computeArtifactHash(rest)).not.toBe(computeArtifactHash(changed));
  });
});
