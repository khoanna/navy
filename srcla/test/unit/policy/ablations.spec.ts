/**
 * The registered baseline/ablation switch set (paper §11.2 B0-B5/B2u, §11.3
 * H1-H7). Every test here isolates ONE switch and proves both directions:
 * that turning it on changes the kernel's answer, and that the non-ablated
 * answer is not accidentally the same. A test that only asserted the ablated
 * value would pass just as happily against a switch that does nothing.
 *
 * Units: money is bigint USDC base units (6 dp); rates are WAD (1e18)
 * annualized; quantiles are WAD.
 */
import { decide, DEFAULT_DECIDE_OPTS } from '../../../src/policy/decide.js';
import { loadBootstrapArtifact } from '../../../src/policy/artifact.js';
import { requiredReserve } from '../../../src/policy/steps/reserve.js';
import { portfolioLowerBound, reserveOptsFrom } from '../../../src/policy/steps/optimize.js';
import { simulateCurves, flatDisplayedRateCurves } from '../../../src/policy/steps/simulate.js';
import type {
  DecisionInput,
  MarketObservation,
  PolicyArtifact,
  RateCurve,
} from '../../../src/policy/types.js';

const WAD = 10n ** 18n;
/** USDC base units (6 dp). 10,000 USDC. */
const TIER = 10_000_000_000n;

function market(id: string, over: Partial<MarketObservation> = {}): MarketObservation {
  return {
    marketId: id,
    adapter: `0x${id.padEnd(40, '0')}`,
    protocol: 'compound',
    // USDC base units
    cash: 100_000_000_000n,
    borrows: 300_000_000_000n,
    reserves: 0n,
    supplyRateWad: (WAD * 3n) / 100n, // 3% APY, WAD annualized
    utilizationWad: (WAD * 75n) / 100n,
    positionBase: 0n,
    maxDeployableBase: 10n ** 13n,
    maxWithdrawableBase: 10n ** 13n,
    configDigest: '0xd',
    regimeId: 'r1',
    paused: false,
    capBps: 10_000,
    absoluteCapBase: 10n ** 13n,
    maxLossBps: 50,
    dependencyGroupIds: [],
    ...over,
  };
}

function history(marketId: string) {
  return Array.from({ length: 40 }, () => ({
    marketId,
    regimeId: 'r1',
    originSeconds: 1,
    horizonSeconds: 604_800 as const,
    horizonEndSeconds: 2,
    availableAtSeconds: 3,
    realizedReturnWad: WAD,
    realizedMinCashBase: 1n,
    originCashBase: 1n,
  }));
}

function input(over: Partial<DecisionInput> = {}): DecisionInput {
  return {
    origin: { blockNumber: 1, blockHash: '0x' + 'ab'.repeat(32), timestampSeconds: 1_000_000, finalized: true },
    vault: {
      totalAssetsBase: TIER,
      idleBase: TIER,
      sharesOutstanding: TIER,
      adminReserveBase: 0n,
      dynamicReserveBase: 0n,
      minIdleBps: 0,
      paused: false,
      configurationDigest: '0x' + 'cd'.repeat(32),
    },
    markets: [market('aa'), market('bb')],
    dependencyGroups: [],
    withdrawals: [],
    gas: {
      l2BaseFeeWei: 5_000_000n,
      l1BaseFeeWei: 8_000_000_000n,
      l1BlobBaseFeeWei: 1n,
      ethUsdE8: 350_000_000_000n,
      usdcUsdE8: 100_000_000n,
    },
    history: [...history('aa'), ...history('bb')],
    lastAction: { timestampSeconds: null, turnoverWindowBase: 0n, recentMoves: [] },
    ...over,
  };
}

function artifact(over: Partial<PolicyArtifact> = {}): PolicyArtifact {
  return {
    ...loadBootstrapArtifact(),
    residualQuantileWadByMarket: { aa: 0n, bb: 0n },
    pinnedConfigDigests: { aa: '0xd', bb: '0xd' },
    portfolioResidualQuantileWad: -1_000_000n,
    // §7.2's second forecast target, made an identity here so these cases
    // isolate the rule under test rather than a cash haircut on phi.
    cashResidualQuantileWadByMarket: {},
    cashLowerBoundQuantileWad: 0n,
    noTradeBandK: 0,
    ...over,
  };
}

/** Cost params loose enough that a genuinely profitable deploy clears the gate. */
const OPTS = {
  ...DEFAULT_DECIDE_OPTS,
  cost: {
    ...DEFAULT_DECIDE_OPTS.cost,
    minTurnoverBps: 1,
    maxTurnoverBps: 10_000,
    slippageBps: 0,
    mevBps: 0,
    impactBps: 0,
  },
};

// ---------------------------------------------------------------------------
// B3 — omit the P3 netting of the withdrawal quantile (reserve.ts)
// ---------------------------------------------------------------------------

describe('reserve: P3 netting switch (baseline B3)', () => {
  /** target: 5,000 USDC in 'aa'; the venue can absorb the whole exit. */
  const target = new Map<string, bigint>([['aa', 5_000_000_000n]]);
  const withdrawn: DecisionInput['withdrawals'] = [
    { timestampSeconds: 999_950, assetsBase: 3_000_000_000n },
  ];
  const base = () => input({ markets: [market('aa', { maxWithdrawableBase: 5_000_000_000n })], withdrawals: withdrawn });

  it('nets the withdrawal quantile against executable exits by default', () => {
    const r = requiredReserve(base(), artifact(), target, { quantile: 0.95, horizonSeconds: 86_400 });
    // Q_beta = 3,000 USDC, exec0 = min(5,000, 5,000) = 5,000 USDC -> netted to 0.
    expect(r.netDemandQuantileBase).toBe(0n);
  });

  it('uses the RAW quantile when netting is disabled, raising the required reserve', () => {
    const netted = requiredReserve(base(), artifact(), target, { quantile: 0.95, horizonSeconds: 86_400 });
    const raw = requiredReserve(base(), artifact(), target, { quantile: 0.95, horizonSeconds: 86_400, netting: false });

    expect(raw.netDemandQuantileBase).toBe(3_000_000_000n);
    // Non-vacuity: the two branches must actually disagree, and the raw one
    // must be the larger reserve.
    expect(netted.netDemandQuantileBase).not.toBe(raw.netDemandQuantileBase);
    expect(raw.requiredBase).toBeGreaterThan(netted.requiredBase);
  });

  it('leaves the stress term netted even when the demand term is not', () => {
    const raw = requiredReserve(base(), artifact(), target, { quantile: 0.95, horizonSeconds: 86_400, netting: false });
    const netted = requiredReserve(base(), artifact(), target, { quantile: 0.95, horizonSeconds: 86_400 });
    expect(raw.stressShortfallBase).toBe(netted.stressShortfallBase);
    expect(raw.stressShortfallBase).toBeGreaterThan(0n);
  });
});

// ---------------------------------------------------------------------------
// H4 — admin floor only, no stress feasibility (reserve.ts floorOnly)
// ---------------------------------------------------------------------------

describe('reserve: H4 floor-only switch', () => {
  const target = new Map<string, bigint>([['aa', 5_000_000_000n]]);
  const base = () => input({ markets: [market('aa', { maxWithdrawableBase: 5_000_000_000n })] });
  // 2% admin floor of the 10,000 USDC tier = 200 USDC.
  const withFloor = () => {
    const i = base();
    i.vault.minIdleBps = 200;
    return i;
  };

  it('reduces the requirement to the floor and empties the scenario list', () => {
    const full = requiredReserve(withFloor(), artifact(), target, { quantile: 0.95, horizonSeconds: 86_400 });
    const h4 = requiredReserve(withFloor(), artifact(), target, { quantile: 0.95, horizonSeconds: 86_400, floorOnly: true });

    expect(h4.requiredBase).toBe(h4.floorBase);
    expect(h4.floorBase).toBe(200_000_000n);
    expect(h4.netDemandQuantileBase).toBe(0n);
    expect(h4.stressShortfallBase).toBe(0n);
    expect(h4.scenarioFeasible).toHaveLength(0);

    // Non-vacuity: the full rule genuinely requires MORE than the floor here
    // (the w50 scenario cannot be met from a 5,000 USDC exit), so the switch
    // is observably doing something.
    expect(full.requiredBase).toBeGreaterThan(full.floorBase);
    expect(full.scenarioFeasible.length).toBeGreaterThan(0);
  });

  it('keeps the admin floor — it is not the same as removing the reserve', () => {
    const h4 = requiredReserve(withFloor(), artifact(), target, { quantile: 0.95, horizonSeconds: 86_400, floorOnly: true });
    expect(h4.requiredBase).toBeGreaterThan(0n);
  });
});

describe('reserveOptsFrom', () => {
  const o = { reserveQuantile: 0.95, reserveHorizonSeconds: 86_400 };

  it('maps the netting switch (B3) onto reserve netting', () => {
    expect(reserveOptsFrom({}, o).netting).toBe(true);
    expect(reserveOptsFrom({ netting: true }, o).netting).toBe(false);
  });

  it('maps the dynamicReserve switch (H4) onto floorOnly', () => {
    expect(reserveOptsFrom({}, o).floorOnly).toBe(false);
    expect(reserveOptsFrom({ dynamicReserve: true }, o).floorOnly).toBe(true);
  });

  it('does not confuse the two switches', () => {
    expect(reserveOptsFrom({ netting: true }, o).floorOnly).toBe(false);
    expect(reserveOptsFrom({ dynamicReserve: true }, o).netting).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// H2 — remove the calibrated lower bounds; use the point forecast
// ---------------------------------------------------------------------------

describe('portfolioLowerBound: H2 uncertainty switch', () => {
  const quantum = 1_000_000_000n; // 1,000 USDC
  const curve = (id: string): RateCurve => ({
    marketId: id,
    quantumBase: quantum,
    points: Array.from({ length: 16 }, () => (WAD * 5n) / 100n), // flat 5% APY
    maxXBase: quantum * 15n,
  });
  const curves = [curve('aa')];
  const target = new Map<string, bigint>([['aa', 5_000_000_000n]]);
  const art = () =>
    artifact({
      residualQuantileWadByMarket: { aa: -2n * 10n ** 16n, bb: 0n }, // -2% WAD
      portfolioResidualQuantileWad: -1n * 10n ** 16n, // -1% WAD
    });

  it('drops the portfolio residual quantile term exactly', () => {
    const i = input({ markets: [market('aa')] });
    const withBound = portfolioLowerBound(i, curves, art(), target, {});
    const ablated = portfolioLowerBound(i, curves, art(), target, { uncertainty: true });

    const notional = 5_000_000_000n;
    const term = (art().portfolioResidualQuantileWad * notional) / WAD;
    expect(term).toBeLessThan(0n);
    expect(withBound).toBe(ablated + term);
    expect(ablated).toBeGreaterThan(withBound);
  });

  it('also removes the PER-VENUE calibrated bound in the portfolioBound branch', () => {
    const i = input({ markets: [market('aa')] });
    const marginal = portfolioLowerBound(i, curves, art(), target, { portfolioBound: true });
    const marginalAblated = portfolioLowerBound(i, curves, art(), target, {
      portfolioBound: true,
      uncertainty: true,
    });

    // Non-vacuity: the per-venue quantile is non-zero, so the two must differ.
    expect(marginal).not.toBe(marginalAblated);
    expect(marginalAblated).toBeGreaterThan(marginal);
    // With no quantile at any level the two aggregations coincide.
    expect(marginalAblated).toBe(portfolioLowerBound(i, curves, art(), target, { uncertainty: true }));
  });
});

// ---------------------------------------------------------------------------
// H1 — remove post-deposit simulation; rank on the displayed rate
// ---------------------------------------------------------------------------

describe('flatDisplayedRateCurves: H1 capacity switch', () => {
  it('returns a constant curve at the displayed rate, while the simulated curve decays', () => {
    const i = input({ markets: [market('aa', { cash: 1_000_000_000n, borrows: 4_000_000_000n })] });
    const flat = flatDisplayedRateCurves(i, ['aa'], 1_000_000_000n, 16);
    const simulated = simulateCurves(i, ['aa'], 1_000_000_000n, 16);

    expect(flat).toHaveLength(1);
    expect(new Set(flat[0]!.points.map((p) => p.toString())).size).toBe(1);
    expect(flat[0]!.points[0]).toBe(i.markets[0]!.supplyRateWad);

    // Non-vacuity: on this fixture the simulated curve genuinely falls with
    // allocation, so "flat" is a real ablation and not a restatement.
    expect(simulated[0]!.points[15]).toBeLessThan(simulated[0]!.points[0]!);
  });

  it('matches the simulated curve in shape so no downstream consumer needs an H1 branch', () => {
    const i = input();
    const flat = flatDisplayedRateCurves(i, ['aa', 'bb'], 1_000_000_000n, 16);
    const simulated = simulateCurves(i, ['aa', 'bb'], 1_000_000_000n, 16);

    expect(flat.map((c) => c.marketId)).toEqual(simulated.map((c) => c.marketId));
    expect(flat.map((c) => c.points.length)).toEqual(simulated.map((c) => c.points.length));
    expect(flat.map((c) => c.maxXBase)).toEqual(simulated.map((c) => c.maxXBase));
    expect(flat.map((c) => c.quantumBase)).toEqual(simulated.map((c) => c.quantumBase));
  });

  it('only emits curves for eligible markets', () => {
    const i = input();
    expect(flatDisplayedRateCurves(i, ['bb'], 1_000_000_000n, 4).map((c) => c.marketId)).toEqual(['bb']);
  });
});

describe('decide: H1 capacity switch reaches the kernel', () => {
  it('uses flat displayed-rate curves when capacityCurves is disabled', () => {
    const i = input({ markets: [market('aa', { cash: 1_000_000_000n, borrows: 4_000_000_000n })] });
    const normal = decide(i, artifact(), OPTS);
    const ablated = decide(i, artifact(), { ...OPTS, disable: { capacityCurves: true } });

    expect(normal.curves).toHaveLength(1);
    expect(ablated.curves).toHaveLength(1);
    expect(new Set(ablated.curves[0]!.points.map((p) => p.toString())).size).toBe(1);
    // Non-vacuity: the un-ablated kernel really did simulate a decaying curve.
    expect(new Set(normal.curves[0]!.points.map((p) => p.toString())).size).toBeGreaterThan(1);
    expect(normal.decisionHash).not.toBe(ablated.decisionHash);
  });
});

// ---------------------------------------------------------------------------
// H3 — remove the complete-cost gate and the no-trade band
// ---------------------------------------------------------------------------

describe('decide: H3 cost switch', () => {
  /** Cost params so punitive that no move can ever clear the gate. */
  // P14: impact/slippage/MEV are now charged only to a harvest (swap) leg,
  // not to the lending deploy/divest moves this fixture produces, so
  // inflating those three bps alone no longer makes the move uneconomic.
  // Punitive gas-derived terms (gasPerAction drives entry/exit; unaffected
  // by move kind) replace them as the lever that dominates any realistic
  // gain, keeping this test's point - "the live gate genuinely blocks,
  // the ablated one does not" - intact.
  const PUNITIVE = {
    ...OPTS,
    cost: {
      ...OPTS.cost,
      slippageBps: 5_000,
      mevBps: 1_000,
      impactBps: 1_000,
      bufferBps: 5_000,
      gasPerAction: 10_000_000_000_000n,
      planGasOverhead: 10_000_000_000_000n,
    },
  };

  it('blocks the rebalance when the gate is live and permits it when ablated', () => {
    const i = input();
    const gated = decide(i, artifact(), PUNITIVE);
    const ablated = decide(i, artifact(), { ...PUNITIVE, disable: { costGate: true } });

    // Non-vacuity: the live gate genuinely rejects this move.
    expect(gated.costGate.passed).toBe(false);
    expect(gated.action).toBe('hold');

    expect(ablated.costGate.passed).toBe(true);
    expect(ablated.costGate.reason).toBe('COST_GATE_ABLATED');
    expect(ablated.action).toBe('rebalance');
  });

  it('reports zeroed cost terms rather than a fabricated evaluated cost', () => {
    const ablated = decide(input(), artifact(), { ...OPTS, disable: { costGate: true } });
    expect(ablated.costGate.moveCostBase).toBe(0n);
    expect(ablated.costGate.bandBase).toBe(0n);
    expect(ablated.costGate.terms).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// H4 vs B2u at the decide() level — the floor survives one and not the other
// ---------------------------------------------------------------------------

describe('decide: H4 (floor only) is not B2u (no reserve at all)', () => {
  const withFloor = () => {
    const i = input({ markets: [market('aa')] });
    i.vault.minIdleBps = 2_000; // 20% admin floor = 2,000 USDC
    return i;
  };

  it('H4 still honours the admin floor; B2u does not', () => {
    const h4 = decide(withFloor(), artifact(), { ...OPTS, disable: { dynamicReserve: true } });
    const b2u = decide(withFloor(), artifact(), { ...OPTS, disable: { reserve: true } });

    const deployed = (out: { target: Map<string, bigint> }): bigint =>
      [...out.target.values()].reduce((s, v) => s + v, 0n);

    expect(deployed(h4)).toBeLessThanOrEqual(TIER - 2_000_000_000n);
    // Non-vacuity: with the reserve entirely removed the optimiser deploys
    // strictly more than the floor would have allowed.
    expect(deployed(b2u)).toBeGreaterThan(deployed(h4));
  });

  it('H4 reports an empty scenario list, the un-ablated kernel does not', () => {
    const h4 = decide(withFloor(), artifact(), { ...OPTS, disable: { dynamicReserve: true } });
    const full = decide(withFloor(), artifact(), OPTS);
    expect(h4.reserve.scenarioFeasible).toHaveLength(0);
    expect(full.reserve.scenarioFeasible.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The optimiser must score candidates against the SAME reserve rule that
// decide() then reports — see reserveOptsFrom's doc comment.
// ---------------------------------------------------------------------------

describe('decide: the reported reserve obeys the same switches the search did', () => {
  it('reports the floor-only reserve under H4', () => {
    const i = input();
    i.vault.minIdleBps = 500;
    const out = decide(i, artifact(), { ...OPTS, disable: { dynamicReserve: true } });
    expect(out.reserve.requiredBase).toBe(out.reserve.floorBase);
  });

  it('reports the raw (un-netted) quantile under the B3 switch', () => {
    const i = input({
      markets: [market('aa', { maxWithdrawableBase: 5_000_000_000n })],
      withdrawals: [{ timestampSeconds: 999_950, assetsBase: 3_000_000_000n }],
    });
    const netted = decide(i, artifact(), OPTS);
    const raw = decide(i, artifact(), { ...OPTS, disable: { netting: true } });
    expect(raw.reserve.netDemandQuantileBase).toBeGreaterThan(netted.reserve.netDemandQuantileBase);
  });
});

// ---------------------------------------------------------------------------
// Cold start: P4's phi must not make a first deployment impossible.
// ---------------------------------------------------------------------------

describe('decide: cold start into an empty venue', () => {
  /** The value the on-chain adapter's maxWithdrawable() returns for a venue
   *  the vault has not entered: min(ourBalance = 0, protocolCash) = 0. */
  const coldStart = (maxWithdrawableBase: bigint) =>
    input({ markets: [market('aa', { positionBase: 0n, maxWithdrawableBase })] });

  it('deploys when maxWithdrawableBase is the venue exit CAPACITY', () => {
    const out = decide(coldStart(100_000_000_000n), artifact(), OPTS);
    const deployed = [...out.target.values()].reduce((s, v) => s + v, 0n);
    expect(out.admission.eligible).toEqual(['aa']);
    expect(deployed).toBeGreaterThan(0n);
  });

  it('deploys NOTHING if it is fed min(position, cash) instead — the deadlock', () => {
    const out = decide(coldStart(0n), artifact(), OPTS);
    // Admission still passes (admit.ts special-cases the zero-position
    // branch), so this is not a rejection: exitableFraction(x, 0) = 0 zeroes
    // the objective for every candidate and the optimiser silently holds.
    expect(out.admission.eligible).toEqual(['aa']);
    expect([...out.target.values()].reduce((s, v) => s + v, 0n)).toBe(0n);
  });

  it('is the phi weighting that does it: H7 deploys even from the bad input', () => {
    const out = decide(coldStart(0n), artifact(), { ...OPTS, disable: { exitableWeight: true } });
    expect([...out.target.values()].reduce((s, v) => s + v, 0n)).toBeGreaterThan(0n);
  });
});
