import { computeArtifactHash, loadBootstrapArtifact } from '../../../src/policy/artifact.js';
import { lowerBoundAt, exitableFraction, forecastMarkets } from '../../../src/policy/steps/forecast.js';
import type { DecisionInput, MarketObservation, PolicyArtifact, RateCurve } from '../../../src/policy/types.js';

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

  describe('empty per-venue map (the shipped bootstrap artifact today)', () => {
    it('falls back to portfolioResidualQuantileWad and the bound is strictly below the point forecast', () => {
      const a = artifact({ residualQuantileWadByMarket: {}, portfolioResidualQuantileWad: -(WAD / 400n) });
      const lower = lowerBoundAt(curve, a, 'aave', 0n, 604_800);
      const horizonMu = ((WAD * 5n) / 100n) * 604_800n / 31_536_000n;
      expect(lower).toBe(horizonMu - WAD / 400n);
      expect(lower < horizonMu).toBe(true);
    });

    it('still rejects a positive quantile via the fallback path, not only the per-venue path', () => {
      const bad = artifact({ residualQuantileWadByMarket: {}, portfolioResidualQuantileWad: WAD / 400n });
      expect(() => lowerBoundAt(curve, bad, 'aave', 0n, 604_800)).toThrow(/must be <= 0/);
    });
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

describe('forecastMarkets with the actual shipped bootstrap artifact', () => {
  function market(over: Partial<MarketObservation> = {}): MarketObservation {
    return {
      marketId: 'aave', adapter: '0xa', protocol: 'aave',
      cash: 1_000_000_000n, borrows: 500_000_000n, reserves: 0n,
      supplyRateWad: (WAD * 5n) / 100n, utilizationWad: (WAD * 50n) / 100n,
      positionBase: 0n, maxDeployableBase: 1_000_000_000n, maxWithdrawableBase: 500_000_000n,
      configDigest: '0xdigest', regimeId: 'r1', paused: false,
      capBps: 5000, absoluteCapBase: 10n ** 12n, maxLossBps: 50, dependencyGroupIds: [],
      ...over,
    };
  }

  function input(markets: MarketObservation[]): DecisionInput {
    return {
      origin: { blockNumber: 1, blockHash: '0xb', timestampSeconds: 1_000_000, finalized: true },
      vault: {
        totalAssetsBase: 10n ** 12n, idleBase: 10n ** 11n, sharesOutstanding: 10n ** 12n,
        adminReserveBase: 0n, dynamicReserveBase: 0n, minIdleBps: 50,
        paused: false, configurationDigest: '0xvault',
      },
      markets, dependencyGroups: [], withdrawals: [],
      gas: { l2BaseFeeWei: 1n, l1BaseFeeWei: 1n, l1BlobBaseFeeWei: 1n, ethUsdE8: 350_000_000_000n, usdcUsdE8: 100_000_000n },
      history: [],
      lastAction: { timestampSeconds: null, turnoverWindowBase: 0n, recentMoves: [] },
    };
  }

  it('pins today\'s real behaviour: every lowerWad is <= muWad, using loadBootstrapArtifact() unmodified', () => {
    const bootstrap = loadBootstrapArtifact();
    // Sanity: this test is only meaningful while the shipped artifact still
    // exercises the empty-map fallback branch — if that ever changes, this
    // assertion should fail loudly rather than the test silently testing a
    // different path than intended.
    expect(Object.keys(bootstrap.residualQuantileWadByMarket)).toHaveLength(0);

    const markets = [market({ marketId: 'aave' }), market({ marketId: 'compound', protocol: 'compound' })];
    const curves: RateCurve[] = markets.map((m) => ({
      marketId: m.marketId,
      quantumBase: 1_000_000_000n,
      points: [(WAD * 5n) / 100n, (WAD * 4n) / 100n, (WAD * 3n) / 100n],
      maxXBase: 2_000_000_000n,
    }));

    const results = forecastMarkets(input(markets), curves, bootstrap);
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.lowerWad <= r.muWad).toBe(true);
    }
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

/**
 * P1's RELATIVE form. See `PolicyArtifact.relativeResidualQuantileWadByMarket`
 * for the calibration measurement that motivates it: the ABSOLUTE forecast
 * error varies 2.9x-5.9x across utilization bands while the RELATIVE error
 * varies 1.8x-2.9x and tracks the level being forecast.
 *
 * The behaviour that matters is the interaction with §6's capacity curves.
 * `lowerBoundAt` evaluates `mu` at the CANDIDATE allocation, so at a large
 * vault size it is a rate the vault's own deposit has already compressed. A
 * fixed absolute haircut then consumes a growing share of a shrinking edge
 * and eventually exceeds it, which is what left the controller 61% idle at
 * the 10M tier.
 */
describe('lowerBoundAt — the relative residual quantile', () => {
  const relArtifact = (qRelWad: bigint): PolicyArtifact =>
    artifact({ relativeResidualQuantileWadByMarket: { aave: qRelWad } });

  it('scales the haircut with the forecast instead of subtracting a constant', () => {
    // -20% of the forecast.
    const a = relArtifact(-(WAD / 5n));
    const lower = lowerBoundAt(curve, a, 'aave', 0n, 604_800);
    const horizonMu = (((WAD * 5n) / 100n) * 604_800n) / 31_536_000n;
    expect(lower).toBe((horizonMu * (WAD - WAD / 5n)) / WAD);
  });

  it('is STRICTER than the absolute form where the forecast is high', () => {
    // The REGISTERED calibration values, not the fixture's placeholder ones:
    // aave measured -1.159% APY absolute and -0.188 relative. Over a 7-day
    // horizon the absolute haircut is 1.159% * 7/365 of a unit.
    const H = 604_800n;
    const absQ = -((WAD * 1159n) / 100_000n * H) / 31_536_000n;
    const relQ = -((WAD * 188n) / 1000n);
    const hot: RateCurve = { ...curve, points: [(WAD * 7n) / 100n] }; // 7% APY
    const a = artifact({ residualQuantileWadByMarket: { aave: absQ } });
    const r = artifact({
      residualQuantileWadByMarket: { aave: absQ },
      relativeResidualQuantileWadByMarket: { aave: relQ },
    });
    const absolute = lowerBoundAt(hot, a, 'aave', 0n, 604_800);
    const relative = lowerBoundAt(hot, r, 'aave', 0n, 604_800);
    // Both are positive and sane at this level; the relative one is lower,
    // i.e. the re-specification is not a blanket relaxation.
    expect(absolute).toBeGreaterThan(0n);
    expect(relative).toBeGreaterThan(0n);
    expect(relative).toBeLessThan(absolute);
  });

  it('is LOOSER only where the vault\'s own deposit has compressed the rate', () => {
    const H = 604_800n;
    const absQ = -((WAD * 1159n) / 100_000n * H) / 31_536_000n;
    const relQ = -((WAD * 188n) / 1000n);
    // Below aave's measured 1.159% APY haircut, which is exactly where the
    // absolute form inverts: any venue the vault's own deposit compresses
    // under that rate can never clear a deployment hurdle again.
    const compressed: RateCurve = { ...curve, points: [WAD / 100n] }; // 1.0% APY
    const a = artifact({ residualQuantileWadByMarket: { aave: absQ } });
    const r = artifact({
      residualQuantileWadByMarket: { aave: absQ },
      relativeResidualQuantileWadByMarket: { aave: relQ },
    });
    expect(lowerBoundAt(compressed, a, 'aave', 0n, 604_800)).toBeLessThan(0n);
    expect(lowerBoundAt(compressed, r, 'aave', 0n, 604_800)).toBeGreaterThan(0n);
  });

  it('never drives the bound negative on a positive forecast — the absolute form does', () => {
    // A venue whose post-deposit rate the vault's own size has compressed to
    // near nothing. The absolute haircut exceeds it and the bound inverts;
    // the relative haircut cannot, because it is a fraction OF the forecast.
    const compressed: RateCurve = { ...curve, points: [WAD / 1000n] }; // 0.1% APY
    const absolute = lowerBoundAt(compressed, artifact(), 'aave', 0n, 604_800);
    const relative = lowerBoundAt(compressed, relArtifact(-(WAD / 5n)), 'aave', 0n, 604_800);
    expect(absolute).toBeLessThan(0n);
    expect(relative).toBeGreaterThan(0n);
  });

  it('clamps at -WAD rather than inverting the bound', () => {
    const a = relArtifact(-2n * WAD);
    expect(lowerBoundAt(curve, a, 'aave', 0n, 604_800)).toBe(0n);
  });

  it('rejects a positive relative quantile loudly', () => {
    expect(() => lowerBoundAt(curve, relArtifact(WAD / 10n), 'aave', 0n, 604_800)).toThrow(
      /must be <= 0/,
    );
  });

  it('falls back to a conservative PEER, never to zero, for an unregistered venue', () => {
    const a = artifact({
      relativeResidualQuantileWadByMarket: { compound: -(WAD / 4n), moonwell: -(WAD / 10n) },
    });
    const lower = lowerBoundAt(curve, a, 'aave', 0n, 604_800);
    const horizonMu = (((WAD * 5n) / 100n) * 604_800n) / 31_536_000n;
    // The most conservative peer is compound's -25%, not moonwell's -10%.
    expect(lower).toBe((horizonMu * (WAD - WAD / 4n)) / WAD);
  });

  it('keeps using the ABSOLUTE form when the artifact carries no relative map', () => {
    // An artifact frozen before the field existed must not be handed a
    // relative quantile derived from its absolute one -- they are not
    // interconvertible without the forecast level each was measured against.
    const a = artifact();
    expect(a.relativeResidualQuantileWadByMarket).toBeUndefined();
    const horizonMu = (((WAD * 5n) / 100n) * 604_800n) / 31_536_000n;
    expect(lowerBoundAt(curve, a, 'aave', 0n, 604_800)).toBe(horizonMu - WAD / 1000n);
  });
});
