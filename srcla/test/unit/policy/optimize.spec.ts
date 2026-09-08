import { optimize, liquidityCapBase, effectiveCapBase, portfolioLowerBound } from '../../../src/policy/steps/optimize.js';
import { loadBootstrapArtifact } from '../../../src/policy/artifact.js';
import type { DecisionInput, MarketObservation, PolicyArtifact, RateCurve } from '../../../src/policy/types.js';

const WAD = 10n ** 18n;
const Q = 1_000_000_000n; // 1,000 USDC quantum

function market(id: string, over: Partial<MarketObservation> = {}): MarketObservation {
  return {
    marketId: id, adapter: `0x${id}`, protocol: 'aave',
    cash: 10n ** 12n, borrows: 0n, reserves: 0n,
    supplyRateWad: WAD / 100n, utilizationWad: 0n,
    positionBase: 0n, maxDeployableBase: 10n ** 12n, maxWithdrawableBase: 10n ** 12n,
    configDigest: '0xd', regimeId: 'r1', paused: false,
    capBps: 5000, absoluteCapBase: 10n ** 13n, maxLossBps: 50, dependencyGroupIds: [],
    ...over,
  };
}

function curve(id: string, rates: bigint[]): RateCurve {
  return { marketId: id, quantumBase: Q, points: rates, maxXBase: Q * BigInt(rates.length - 1) };
}

function input(markets: MarketObservation[], groups: DecisionInput['dependencyGroups'] = []): DecisionInput {
  return {
    origin: { blockNumber: 1, blockHash: '0xb', timestampSeconds: 1_000_000, finalized: true },
    vault: {
      totalAssetsBase: 10_000_000_000n, idleBase: 10_000_000_000n, sharesOutstanding: 10n ** 10n,
      adminReserveBase: 0n, dynamicReserveBase: 0n, minIdleBps: 0, paused: false, configurationDigest: '0xv',
    },
    markets, dependencyGroups: groups, withdrawals: [],
    gas: { l2BaseFeeWei: 1n, l1BaseFeeWei: 1n, l1BlobBaseFeeWei: 1n, ethUsdE8: 350_000_000_000n, usdcUsdE8: 100_000_000n },
    history: [], lastAction: { timestampSeconds: null, turnoverWindowBase: 0n, recentMoves: [] },
  };
}

function artifact(): PolicyArtifact {
  return {
    ...loadBootstrapArtifact(),
    residualQuantileWadByMarket: { a: 0n, b: 0n },
    // FIXTURE NOTE (found auditing the brief): as originally shipped, the
    // bootstrap artifact's portfolioResidualQuantileWad was -0.2% per 7-day
    // horizon (~-10.4% annualised) -- a deliberately conservative,
    // UNCALIBRATED placeholder (see artifact.ts's `_provisional` warning).
    // At that magnitude it swamped every venue's point forecast at the
    // 1-5% test-fixture rates used below: the optimizer then deployed
    // nothing at every step, and every assertion in the `optimize` describe
    // block that exercises actual capital movement (the dependency-group
    // cap, the reserve floor, "prefers the higher lower bound") passed
    // vacuously against an empty target, not because the mechanism under
    // test worked. Task 11 re-derived and shipped a smaller placeholder
    // (-1e13, see config/bootstrap-artifact.json's own derivation note) that
    // no longer swamps typical fixture rates on its own -- this override is
    // kept anyway so this suite exercises real, non-empty allocation
    // dynamics independent of whatever the shipped artifact currently
    // carries, and so it does not regress silently if that value changes
    // again before Phase 4 calibration lands.
    portfolioResidualQuantileWad: -1_000_000n,
  };
}

const OPTS = { quantumBase: Q, reserveQuantile: 0.95, reserveHorizonSeconds: 86_400 };

describe('liquidityCapBase (P5)', () => {
  it('is unrestricted well below the kink', () => {
    expect(liquidityCapBase(market('a', { utilizationWad: (WAD * 50n) / 100n }))).toBeGreaterThan(0n);
  });

  it('collapses to zero at full utilisation', () => {
    expect(liquidityCapBase(market('a', { utilizationWad: WAD, cash: 0n }))).toBe(0n);
  });

  it('decreases monotonically as utilisation rises', () => {
    const mid = liquidityCapBase(market('a', { utilizationWad: (WAD * 85n) / 100n, cash: 150_000_000n }));
    const high = liquidityCapBase(market('a', { utilizationWad: (WAD * 95n) / 100n, cash: 50_000_000n }));
    expect(high).toBeLessThan(mid);
  });
});

describe('effectiveCapBase', () => {
  it('is the minimum of percentage, absolute, headroom and liquidity caps', () => {
    const m = market('a', { capBps: 5000, absoluteCapBase: 1_000_000n, maxDeployableBase: 10n ** 12n });
    expect(effectiveCapBase(m, 10_000_000_000n)).toBe(1_000_000n);
  });
});

describe('optimize', () => {
  it('prefers the venue with the higher lower bound', () => {
    // FIXTURE NOTE (audited): the brief's default capBps (5000 = 50%) on
    // both venues against this totalAssetsBase means each venue's own
    // per-market cap (5e9) exactly exhausts the 1e10 budget between them
    // (50% + 50% = 100%) with no competition -- both venues fill to their
    // own independent cap regardless of relative attractiveness, so the
    // original fixture asserted `b > a` while actually just asserting
    // `b's cap === a's cap`. Raising capBps so the caps' sum exceeds the
    // budget (60% + 60% = 120% > 100%) forces a genuine trade-off: only one
    // venue can reach its cap, and it must be the more attractive one.
    const i = input([market('a', { capBps: 6000 }), market('b', { capBps: 6000 })]);
    const curves = [
      curve('a', [WAD / 100n, WAD / 100n, WAD / 100n, WAD / 100n, WAD / 100n]),
      curve('b', [WAD / 50n, WAD / 50n, WAD / 50n, WAD / 50n, WAD / 50n]),
    ];
    const { target } = optimize(i, curves, artifact(), OPTS);
    expect(target.get('b')!).toBeGreaterThan(target.get('a') ?? 0n);
  });

  it('respects a dependency-group cap across members', () => {
    const i = input(
      [market('a', { dependencyGroupIds: ['g'] }), market('b', { dependencyGroupIds: ['g'] })],
      [{ id: 'g', capBps: 2000, absoluteCapBase: 10n ** 13n, members: ['a', 'b'] }]
    );
    const curves = [
      curve('a', [WAD / 50n, WAD / 50n, WAD / 50n, WAD / 50n, WAD / 50n]),
      curve('b', [WAD / 50n, WAD / 50n, WAD / 50n, WAD / 50n, WAD / 50n]),
    ];
    const { target } = optimize(i, curves, artifact(), OPTS);
    const total = (target.get('a') ?? 0n) + (target.get('b') ?? 0n);
    // Confirmed by direct inspection: total lands exactly on the group cap
    // boundary (2000bps of totalAssetsBase = 2e9), not on the much larger
    // per-market cap (5000bps = 5e9 each, ~1e10 combined) -- the group cap
    // is genuinely what stops deployment here, not a coincidence of the
    // per-market caps.
    expect(total).toBeGreaterThan(0n);
    expect(total).toBeLessThanOrEqual((10_000_000_000n * 2000n) / 10_000n);
  });

  it('never allocates to a venue whose liquidity cap is zero (P5)', () => {
    // FIXTURE NOTE (audited): the brief's original fixture set cash: 0n,
    // which alone (via effectiveCapBase's headroom/liquidity floor) would
    // already zero the cap with no dependence on the P5 utilisation-decay
    // formula at all -- it passed for the wrong reason. The real 2026-07-21
    // Moonwell incident this cap exists for held NON-zero cash ($6,163) at
    // >=100% utilisation, so this fixture now mirrors that: nonzero cash,
    // over-kink utilisation. This also makes the fixture sensitive to
    // mutation (b) (liquidityCapBase returning m.cash unconditionally),
    // which a cash:0n fixture would not have caught.
    const i = input([
      market('a', { utilizationWad: (WAD * 10004n) / 10000n, cash: 6_163_000_000n }),
      market('b'),
    ]);
    const curves = [
      curve('a', [WAD, WAD, WAD, WAD, WAD]),          // absurdly attractive rate
      curve('b', [WAD / 100n, WAD / 100n, WAD / 100n, WAD / 100n, WAD / 100n]),
    ];
    expect(liquidityCapBase(i.markets[0]!)).toBe(0n);
    const { target } = optimize(i, curves, artifact(), OPTS);
    expect(target.get('a') ?? 0n).toBe(0n);
  });

  it('computes real enumeration regret, not a constant', () => {
    // FIXTURE NOTE (audited): the brief's original fixture (two smoothly
    // declining, always-ordered curves) makes greedy provably optimal --
    // per-quantum marginal return is non-increasing and separable across
    // markets, so the classic exchange argument means greedy already finds
    // the global optimum and regret is 0 for BOTH a correct implementation
    // and a hardcoded-0 stub. `regretBps >= 0n` is true of every bigint, so
    // that assertion could not have distinguished a measured value from a
    // fabricated constant -- exactly the defect this task exists to fix.
    //
    // Greedy here is a pure hill-climber: it only ever takes a step that
    // strictly improves the objective right now, so it can never see past a
    // temporarily bad step to a much better one beyond it. A curve that
    // dips before it spikes forces exactly that: reaching the attractive
    // region requires first accepting two quanta at a rate greedy will
    // never voluntarily choose. Exhaustive enumeration has no such
    // near-sightedness, so this scenario has a real, structurally
    // guaranteed gap between greedy and optimal.
    // Both venues get an unrestricted cap (>= the whole budget) so that
    // 'b' is never forced to overflow into 'a' by hitting its own cap --
    // any spillover into 'a' must come from a genuine value comparison,
    // not from 'b' running out of room.
    const dip = market('a', { capBps: 10_000 });
    const flat = market('b', { capBps: 10_000 });
    const dipCurve = curve('a', [WAD / 1000n, WAD / 1000n, WAD, WAD]);
    const flatCurve = curve('b', [WAD / 5n, WAD / 5n, WAD / 5n, WAD / 5n]);
    const i = input([dip, flat]);
    i.vault.totalAssetsBase = 4n * Q;
    i.vault.idleBase = 4n * Q;
    const { enumeration: dipResult } = optimize(i, [dipCurve, flatCurve], artifact(), OPTS);

    // Control: the same two markets, both flat, where greedy is optimal by
    // the same exchange argument the brief's original fixture relied on --
    // this scenario's true regret is 0.
    const controlA = curve('a', [WAD / 5n, WAD / 5n, WAD / 5n, WAD / 5n]);
    const controlB = curve('b', [WAD / 5n, WAD / 5n, WAD / 5n, WAD / 5n]);
    const iControl = input([market('a'), market('b')]);
    iControl.vault.totalAssetsBase = 4n * Q;
    iControl.vault.idleBase = 4n * Q;
    const { enumeration: controlResult } = optimize(iControl, [controlA, controlB], artifact(), OPTS);

    expect(dipResult).not.toBeNull();
    expect(controlResult).not.toBeNull();
    expect(dipResult!.enumerated).toBeGreaterThan(1);

    // A hardcoded/fabricated regret (the bug this task replaces: "assume
    // optimal is at most 1% better than greedy", a constant 1bp) reports
    // the SAME number regardless of the actual scenario. A real measurement
    // must report a materially larger regret for the dip scenario, where
    // greedy is structurally trapped, than for the control, where it is
    // optimal.
    expect(dipResult!.regretBps).toBeGreaterThan(controlResult!.regretBps);
    expect(controlResult!.regretBps).toBe(0n);
    expect(dipResult!.regretBps).toBeGreaterThan(100n); // >1bp: not the old fabricated constant either
  });

  it('leaves at least the required reserve idle', () => {
    // FIXTURE NOTE (audited): the brief's original fixture left the default
    // capBps (5000 = 50%), which caps market 'a' at exactly 5e9 on this
    // 1e10 budget -- that per-market cap, not the 2e9 admin reserve, is
    // what stopped deployment (confirmed: deployed == 5e9 == the cap,
    // leaving 5e9 idle, nowhere near the 2e9 floor boundary). The reserve
    // requirement was never actually exercised. Raising the per-market cap
    // out of the way lets the stress-scenario reserve requirement (§8.1) be
    // the thing that actually stops the greedy loop.
    const i = input([market('a', { capBps: 10_000 })]);
    i.vault.adminReserveBase = 2_000_000_000n;
    const curves = [curve('a', [WAD / 50n, WAD / 50n, WAD / 50n, WAD / 50n, WAD / 50n])];
    const { target } = optimize(i, curves, artifact(), OPTS);
    const deployed = [...target.values()].reduce((s, v) => s + v, 0n);
    const idle = i.vault.totalAssetsBase - deployed;
    // Not just "at least the floor" (trivially true of an empty deployment
    // too) but pinned to a deployment that actually happened and stopped
    // at the floor boundary, proving the reserve constraint - not the cap
    // or plain inertia - is what bound.
    expect(deployed).toBeGreaterThan(0n);
    expect(idle).toBeGreaterThanOrEqual(2_000_000_000n);
    expect(idle).toBeLessThan(2_000_000_000n + curves[0]!.quantumBase);
  });

  it('is deterministic', () => {
    const i = input([market('a'), market('b')]);
    const curves = [
      curve('a', [WAD / 100n, WAD / 100n, WAD / 100n, WAD / 100n, WAD / 100n]),
      curve('b', [WAD / 100n, WAD / 100n, WAD / 100n, WAD / 100n, WAD / 100n]),
    ];
    const r1 = optimize(i, curves, artifact(), OPTS);
    const r2 = optimize(i, curves, artifact(), OPTS);
    expect([...r1.target.entries()]).toEqual([...r2.target.entries()]);
  });
});

describe('portfolioLowerBound (P2 + P4)', () => {
  it('applies the portfolio quantile once against total notional, not once per venue', () => {
    // FIXTURE NOTE (audited): the brief's original assertion,
    // `bound < bound + 1000n`, is true for literally any bigint `bound` --
    // it does not exercise the implementation at all. Replaced with a
    // fixture that can actually distinguish the two application strategies:
    // put the SAME total notional (2Q) either in one venue or split evenly
    // across two identical-rate venues. Because the quantile term is
    // proportional to notional (q * x / WAD), "applied once against total
    // notional" and "applied once per venue at that venue's own x" are only
    // equal when a single flat rate is used to scale both -- so a naive
    // "add the portfolio quantile inside the per-venue loop, unscaled"
    // implementation (an extra flat -q per active venue, independent of
    // that venue's size) would make the 2-venue case strictly worse than
    // the 1-venue case for equal total notional. Applied correctly (once,
    // against the combined notional), the bound must be identical either
    // way.
    const q = -1_000_000_000_000n;

    const oneVenue = input([market('a')]);
    const oneVenueTarget = new Map([['a', Q * 2n]]);
    const oneVenueCurves = [curve('a', [WAD / 100n, WAD / 100n, WAD / 100n, WAD / 100n, WAD / 100n])];
    const oneVenueBound = portfolioLowerBound(
      oneVenue,
      oneVenueCurves,
      { ...artifact(), portfolioResidualQuantileWad: q },
      oneVenueTarget
    );

    const twoVenues = input([market('a'), market('b')]);
    const twoVenueTarget = new Map([['a', Q], ['b', Q]]);
    const twoVenueCurves = [
      curve('a', [WAD / 100n, WAD / 100n, WAD / 100n, WAD / 100n, WAD / 100n]),
      curve('b', [WAD / 100n, WAD / 100n, WAD / 100n, WAD / 100n, WAD / 100n]),
    ];
    const twoVenueBound = portfolioLowerBound(
      twoVenues,
      twoVenueCurves,
      { ...artifact(), portfolioResidualQuantileWad: q },
      twoVenueTarget
    );

    // Splitting the mu computation across two smaller multiply/divides
    // (one per venue) instead of one larger one is expected to differ from
    // the single-venue path by at most a unit or two of bigint truncation
    // -- not by anything proportional to venue count, which is what a
    // once-per-venue quantile bug would produce.
    const diff = twoVenueBound > oneVenueBound ? twoVenueBound - oneVenueBound : oneVenueBound - twoVenueBound;
    expect(diff).toBeLessThanOrEqual(2n);
  });

  it('gives no credit to a position that cannot be exited (P4)', () => {
    const liquid = input([market('a', { maxWithdrawableBase: 10n ** 12n })]);
    const frozen = input([market('a', { maxWithdrawableBase: 0n })]);
    const curves = [curve('a', [WAD / 50n, WAD / 50n, WAD / 50n, WAD / 50n, WAD / 50n])];
    const target = new Map([['a', Q * 2n]]);
    const a = artifact();
    expect(portfolioLowerBound(frozen, curves, a, target)).toBeLessThan(
      portfolioLowerBound(liquid, curves, a, target)
    );
  });
});
