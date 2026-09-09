import { jest } from '@jest/globals';
import { decide, computeCanonicalSnapshotHash, DEFAULT_DECIDE_OPTS } from '../../../src/policy/decide.js';
import { loadBootstrapArtifact } from '../../../src/policy/artifact.js';
import type { DecisionInput, MarketObservation, PolicyArtifact } from '../../../src/policy/types.js';

const WAD = 10n ** 18n;

function market(id: string, over: Partial<MarketObservation> = {}): MarketObservation {
  return {
    marketId: id,
    adapter: `0x${id.padEnd(40, '0')}`,
    protocol: 'aave',
    cash: 10n ** 12n,
    borrows: 0n,
    reserves: 0n,
    supplyRateWad: WAD / 100n,
    utilizationWad: 0n,
    positionBase: 0n,
    maxDeployableBase: 10n ** 12n,
    maxWithdrawableBase: 10n ** 12n,
    configDigest: '0xd',
    regimeId: 'r1',
    paused: false,
    capBps: 10000,
    absoluteCapBase: 10n ** 13n,
    maxLossBps: 50,
    dependencyGroupIds: [],
    ...over,
  };
}

function input(): DecisionInput {
  return {
    origin: { blockNumber: 12345, blockHash: '0x' + 'ab'.repeat(32), timestampSeconds: 1_000_000, finalized: true },
    vault: {
      totalAssetsBase: 10_000_000_000n,
      idleBase: 10_000_000_000n,
      sharesOutstanding: 10n ** 10n,
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
    // 40 completed labels, all for market 'aa' regime 'r1' - deliberately
    // does NOT satisfy market 'bb''s REGIME_MIN_HISTORY rule (bootstrap
    // minObservations is 30, and 'bb' has zero labels of its own), so 'bb'
    // is admission-rejected and only 'aa' is eligible in the base fixture.
    // The dedicated rebalance fixture below (`rebalanceInput`/`rebalanceArtifact`)
    // gives both markets their own history so both are eligible there.
    history: Array.from({ length: 40 }, () => ({
      marketId: 'aa',
      regimeId: 'r1',
      originSeconds: 1,
      horizonSeconds: 604_800 as const,
      horizonEndSeconds: 2,
      availableAtSeconds: 3,
      realizedReturnWad: WAD,
      realizedMinCashBase: 1n,
      originCashBase: 1n,
    })),
    lastAction: { timestampSeconds: null, turnoverWindowBase: 0n, recentMoves: [] },
  };
}

function artifact(): PolicyArtifact {
  return {
    ...loadBootstrapArtifact(),
    residualQuantileWadByMarket: { aa: 0n, bb: 0n },
    pinnedConfigDigests: { aa: '0xd', bb: '0xd' },
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

/**
 * A fixture engineered to genuinely rebalance, for the "plan header carries
 * the snapshot hash" assertion below. The base `input()`/`artifact()` pair
 * above is deliberately admission-thin (only 'aa' clears REGIME_MIN_HISTORY)
 * and, depending on cost-gate parameters, may not clear MIN_TURNOVER against
 * DEFAULT_DECIDE_OPTS.cost - wrapping the assertion in
 * `if (out.action === 'rebalance')` would make it pass vacuously whenever
 * nothing is deployed (exactly issue (1) in the task brief). This fixture
 * gives both markets sufficient history, a healthy positive rate, a
 * generous quantum-affordable universe, and cost-gate params sized so the
 * gain from deploying idle cash clears cost - proven below by asserting
 * `action === 'rebalance'` unconditionally BEFORE checking the header.
 */
function rebalanceHistory(marketId: string) {
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

function rebalanceInput(): DecisionInput {
  const base = input();
  return {
    ...base,
    markets: [
      // protocol: 'compound', not 'aave' - Aave's default IRM (baseRate 0%)
      // produces a genuinely zero supply rate whenever borrows is 0 (the
      // observed supplyRateWad only seeds curve point[0]; every simulated
      // point beyond it is real IRM math over cash/borrows, so an
      // inconsistent hand-set observed rate on a zero-borrow Aave market
      // does not survive into the curve the optimiser actually searches).
      // Compound's kinked-linear model has a non-zero baseRate (3% APY)
      // even at zero utilisation, which is what actually produces a
      // deployable positive curve here.
      market('aa', { protocol: 'compound', supplyRateWad: (WAD * 3n) / 100n }),
      market('bb', { protocol: 'compound', supplyRateWad: (WAD * 3n) / 100n }),
    ],
    history: [...rebalanceHistory('aa'), ...rebalanceHistory('bb')],
  };
}

function rebalanceArtifact(): PolicyArtifact {
  return {
    ...artifact(),
    // Small, non-zero, conservative (paper P1) - this is what actually lets
    // idle cash clear the objective; the shipped bootstrap value already
    // satisfies this (see config/bootstrap-artifact.json's derivation note)
    // but the override keeps this fixture self-contained regardless of the
    // artifact file's contents.
    portfolioResidualQuantileWad: -1_000_000n,
    // §7.2's second forecast target, made an identity here so these cases
    // isolate the rule under test rather than a cash haircut on phi.
    cashResidualQuantileWadByMarket: {},
    cashLowerBoundQuantileWad: 0n,
  };
}

const REBALANCE_OPTS = {
  ...DEFAULT_DECIDE_OPTS,
  cost: {
    ...DEFAULT_DECIDE_OPTS.cost,
    // Cost-gate params tuned so a genuinely profitable deployment of this
    // fixture's full 10,000 USDC clears every gate:
    //  - minTurnoverBps down to 1 (DEFAULT's 10bps floor is already low
    //    enough, kept explicit for clarity);
    //  - maxTurnoverBps raised to 100% so deploying the whole vault in one
    //    decision (this fixture's optimizer result) doesn't trip MAX_TURNOVER
    //    against DEFAULT's 50% cap - a real deployment would be staged over
    //    several cycles, this fixture just needs ONE decision to rebalance;
    //  - slippage/mev/impact bps zeroed so the ~5.75M base-unit gain from a
    //    7-day 3% APY deployment clears C_move, which those bps-of-notional
    //    terms otherwise dominate (8bps of a 10,000 USDC move is 8M base
    //    units, larger than the gain itself).
    minTurnoverBps: 1,
    maxTurnoverBps: 10000,
    slippageBps: 0,
    mevBps: 0,
    impactBps: 0,
  },
};

/**
 * P17's fixture: two venues the optimiser wants to split between, one of which
 * cannot repay its own movement cost.
 *
 * 'aa' runs at 75% utilisation on Compound's kinked model (~7.7% annualised
 * conservative bound) and is capped at 50% of the vault, so the optimiser has
 * to place the other half somewhere; 'bb' is a zero-borrow Compound market at
 * the model's base rate (~3.0%). Both legs are the same size (5,000 USDC), so
 * both see the SAME amortised cost hurdle — `ONE_GOOD_ONE_BAD_OPTS` sizes gas
 * to put that hurdle at ~5.2% annualised, between the two bounds. The margins
 * are ~48% above on 'aa' and ~42% below on 'bb', so this is not a
 * knife-edge fixture.
 */
function oneGoodOneBadInput(): DecisionInput {
  const base = input();
  const markets = [
    market('aa', {
      protocol: 'compound',
      cash: 2_000_000_000_000n,
      borrows: 6_000_000_000_000n,
      utilizationWad: (WAD * 75n) / 100n,
      capBps: 5000,
    }),
    market('bb', { protocol: 'compound', cash: 10n ** 13n, borrows: 0n, utilizationWad: 0n }),
  ];
  return { ...base, markets, history: [...rebalanceHistory('aa'), ...rebalanceHistory('bb')] };
}

function oneGoodOneBadArtifact(): PolicyArtifact {
  return rebalanceArtifact();
}

const ONE_GOOD_ONE_BAD_OPTS = {
  ...REBALANCE_OPTS,
  cost: {
    ...REBALANCE_OPTS.cost,
    // Sized so the amortised cost hurdle for a 5,000 USDC leg over the
    // fixture's 30-day payback lands at ~5.2% annualised: above 'bb''s 3.0%
    // bound and below 'aa''s 7.7%.
    gasPerAction: 600_000_000n,
    planGasOverhead: 600_000_000n,
  },
};

describe('decide', () => {
  it('is deterministic: identical input and artifact give an identical decision hash', () => {
    const a = decide(input(), artifact(), DEFAULT_DECIDE_OPTS);
    const b = decide(input(), artifact(), DEFAULT_DECIDE_OPTS);
    expect(a.decisionHash).toBe(b.decisionHash);
  });

  it('changes the decision hash when the artifact changes', () => {
    const a = decide(input(), artifact(), DEFAULT_DECIDE_OPTS);
    const changed = { ...artifact(), artifactHash: 'different' };
    expect(decide(input(), changed, DEFAULT_DECIDE_OPTS).decisionHash).not.toBe(a.decisionHash);
  });

  // Finding 1 (review round 1): the hash must cover the curves themselves,
  // the paper §10.2 "candidates" the optimiser actually searched over -
  // `lowerBounds` is not a faithful proxy, since forecastMarkets evaluates
  // it at each market's CURRENT position, not at the candidate allocations
  // the optimiser explored. This isolates curves as the ONLY thing that
  // differs: same input/artifact, only `quantumBase` (an opts field
  // simulateCurves samples on) changes between the two calls. In this
  // fixture (only 'aa' admitted, Aave's zero-borrow curve is flat at zero
  // for every x > 0) the optimiser deploys nothing regardless of quantum,
  // so target/reserve/costGate/reasons all come out byte-identical, and
  // `lowerBounds` is also identical (forecastMarkets evaluates it at
  // positionBase = 0, i.e. curve.points[0], which does not depend on
  // quantumBase at all) - genuinely isolating curves as the one thing that
  // differs, not several things at once.
  it('changes the decision hash when only the curves differ (target/reserve/costs/reasons held constant)', () => {
    const i = input();
    const a = artifact();
    const outA = decide(i, a, DEFAULT_DECIDE_OPTS);
    const outB = decide(i, a, { ...DEFAULT_DECIDE_OPTS, quantumBase: 2_000_000_000n });

    // Sanity: everything else the hash also covers is unchanged, so the
    // hash difference below can only be attributed to curves.
    expect([...outB.target.entries()]).toEqual([...outA.target.entries()]);
    expect(outB.reserve).toEqual(outA.reserve);
    expect(outB.costGate).toEqual(outA.costGate);
    expect(outB.reasons).toEqual(outA.reasons);
    expect(outB.lowerBounds).toEqual(outA.lowerBounds);
    expect(outB.admission).toEqual(outA.admission);

    // The thing that actually differs.
    expect(outB.curves[0]!.quantumBase).not.toBe(outA.curves[0]!.quantumBase);

    expect(outB.decisionHash).not.toBe(outA.decisionHash);
  });

  it('changes the decision hash when market state changes', () => {
    const a = decide(input(), artifact(), DEFAULT_DECIDE_OPTS);
    const i = input();
    i.markets[0]!.cash = 1n;
    expect(decide(i, artifact(), DEFAULT_DECIDE_OPTS).decisionHash).not.toBe(a.decisionHash);
  });

  it('snapshot hash covers market state, not just totalAssets', () => {
    const i1 = input();
    const i2 = input();
    i2.markets[0]!.borrows = 12345n;
    expect(computeCanonicalSnapshotHash(i1)).not.toBe(computeCanonicalSnapshotHash(i2));
  });

  it('holds when the vault is paused', () => {
    const i = input();
    i.vault.paused = true;
    const out = decide(i, artifact(), DEFAULT_DECIDE_OPTS);
    expect(out.action).toBe('hold');
    expect(out.plan).toBeNull();
  });

  it('holds and explains when no market is admitted', () => {
    const i = input();
    for (const m of i.markets) m.paused = true;
    const out = decide(i, artifact(), DEFAULT_DECIDE_OPTS);
    expect(out.action).toBe('hold');
    expect(out.reasons.some((r) => r.includes('ADMISSION'))).toBe(true);
  });

  // Whole-branch review, Critical 3: snapshot-collector.ts's collectStrategy
  // cannot yet read supplyRate/utilization/cash for any protocol and reports
  // a hardcoded 0n for all three. Without this distinction, decide() would
  // report a plain ADMISSION_EMPTY hold that reads exactly like a legitimate
  // "nothing is admissible right now" outcome (e.g. REGIME_MIN_HISTORY on a
  // fresh database) rather than "the pipeline cannot see the market at
  // all". This test fails if the NO_MARKET_DATA top-level reason is removed
  // or the rule is weakened to allow a data-less market to admit.
  it('surfaces a distinct NO_MARKET_DATA reason (not a plain admission-empty hold) when every market carries a literal zero rate/cash/borrows', () => {
    const i = input();
    for (const m of i.markets) {
      m.supplyRateWad = 0n;
      m.cash = 0n;
      m.borrows = 0n;
      m.utilizationWad = 0n;
    }
    const out = decide(i, artifact(), DEFAULT_DECIDE_OPTS);
    expect(out.action).toBe('hold');
    expect(out.reasons).toContain('ADMISSION_EMPTY');
    expect(out.reasons).toContain('NO_MARKET_DATA');
    expect(
      out.admission.reasons.every((r) => (r.code === 'NO_MARKET_DATA' ? !r.passed : true))
    ).toBe(true);
  });

  it('does NOT surface NO_MARKET_DATA when admission is empty for an unrelated, data-dependent reason', () => {
    // Same "hold and explains" scenario as above (every market paused) but
    // every market still carries real rate/cash/borrows data -- proves the
    // new reason is specific to the no-data signature, not tacked onto
    // every empty admission.
    const i = input();
    for (const m of i.markets) m.paused = true;
    const out = decide(i, artifact(), DEFAULT_DECIDE_OPTS);
    expect(out.reasons).toContain('ADMISSION_EMPTY');
    expect(out.reasons).not.toContain('NO_MARKET_DATA');
  });

  // Correctness check for defect (2) in the task brief: the SHIPPED bootstrap
  // artifact carries pinnedConfigDigests: {} by design (a pinned digest is
  // only knowable against a live deployment; a later task populates it from
  // chain). admit.ts's CONFIG_DIGEST_UNPINNED rule therefore rejects every
  // market against the real shipped artifact, and decide() must hold with an
  // admission-empty reason - that is correct behaviour, not a bug, and this
  // test pins it so a future change cannot silently "fix" it by weakening
  // the admission rule or inventing digests.
  it('holds with an admission-empty reason when run against the real shipped bootstrap artifact', () => {
    const out = decide(input(), loadBootstrapArtifact(), DEFAULT_DECIDE_OPTS);
    expect(out.action).toBe('hold');
    expect(out.reasons).toContain('ADMISSION_EMPTY');
    expect(out.admission.eligible).toHaveLength(0);
    expect(
      out.admission.reasons.some((r) => r.code === 'CONFIG_DIGEST_UNPINNED' && r.passed === false)
    ).toBe(true);
  });

  // Issue (3) in the task brief: this assertion must be unconditional, not
  // guarded by `if (out.action === 'rebalance')` - a guarded version passes
  // vacuously whenever nothing is deployed, which (given defect (1)) was
  // always. `rebalanceInput`/`rebalanceArtifact`/`REBALANCE_OPTS` above are
  // engineered specifically to make the kernel genuinely rebalance.
  it('emits a plan whose header carries a non-zero snapshot hash when it rebalances', () => {
    const out = decide(rebalanceInput(), rebalanceArtifact(), REBALANCE_OPTS);
    expect(out.action).toBe('rebalance');
    expect(out.plan).not.toBeNull();
    expect(out.snapshotHash).not.toBe('0'.repeat(64));
    const expectedSnapshotHash = out.snapshotHash.startsWith('0x') ? out.snapshotHash : `0x${out.snapshotHash}`;
    expect(out.plan!.header.snapshotHash).toBe(expectedSnapshotHash);
    expect(out.plan!.header.snapshotHash).not.toBe('0x' + '00'.repeat(32));
  });

  // -------------------------------------------------------------------------
  // P17 — per-leg evaluation. v0.6 evaluated ONE gate over the whole target
  // and returned `hold` when it failed, discarding every leg including the
  // ones that were individually profitable. These two cases pin the
  // replacement: a leg is judged on its own, and a blocked leg does not take
  // a clearing one down with it.
  // -------------------------------------------------------------------------

  it('P17: reports a per-leg verdict for every leg it evaluated', () => {
    const out = decide(rebalanceInput(), rebalanceArtifact(), REBALANCE_OPTS);
    expect(out.action).toBe('rebalance');
    expect(out.costGate.legs.length).toBeGreaterThan(0);
    expect(out.costGate.legs.some((l) => l.clears)).toBe(true);
    expect(out.costGate.reason).toBe('HURDLES_CLEARED');
    // Every leg names the venue it moves into and the amount it moves.
    for (const l of out.costGate.legs) {
      expect(l.amountBase).toBeGreaterThan(0n);
      expect(typeof l.reason).toBe('string');
    }
  });

  it('P17: deploys into the venue that clears even when another leg does not', () => {
    const out = decide(oneGoodOneBadInput(), oneGoodOneBadArtifact(), ONE_GOOD_ONE_BAD_OPTS);

    // Non-vacuity, both directions: the optimiser genuinely wanted both
    // venues, and the hurdles genuinely refused one of them.
    const byMarket = new Map(out.costGate.legs.map((l) => [l.marketId, l]));
    expect(byMarket.get('aa')!.clears).toBe(true);
    expect(byMarket.get('bb')!.clears).toBe(false);
    expect(byMarket.get('bb')!.reason).toContain('DEPLOY_BLOCKED');

    // The clearing leg executes. Under v0.6's single gate this whole decision
    // was a hold.
    expect(out.action).toBe('rebalance');
    expect(out.target.get('aa')).toBe(5_000_000_000n);
    expect(out.target.get('bb')).toBe(0n);
    expect(out.plan).not.toBeNull();
  });

  it('P17: holds, and says why, only when EVERY leg is blocked', () => {
    const punitive = {
      ...ONE_GOOD_ONE_BAD_OPTS,
      cost: {
        ...ONE_GOOD_ONE_BAD_OPTS.cost,
        gasPerAction: 5_000_000_000n,
        planGasOverhead: 5_000_000_000n,
      },
    };
    const out = decide(oneGoodOneBadInput(), oneGoodOneBadArtifact(), punitive);
    expect(out.costGate.legs.every((l) => !l.clears)).toBe(true);
    expect(out.action).toBe('hold');
    // The cause is the hurdles, not the brakes' NO_MOVES: the target did NOT
    // equal current, the executed vector did.
    expect(out.costGate.reason).toBe('ALL_LEGS_BLOCKED');
    expect(out.reasons.some((r) => r.startsWith('HURDLES:'))).toBe(true);
  });

  // §9.1.4's partial adjustment, end to end. `adjustmentRate` is 1 on every
  // other fixture (the bootstrap default), so this is the only case that
  // exercises lambda < 1 through the kernel — and, with it, the monotone form
  // of `decide`'s feasibility re-check: a percentage cap is a fraction of TVL,
  // so the CURRENT position can already breach one, and an interpolation
  // between a breaching current and a compliant sub-target sits in between.
  // Requiring absolute compliance there would refuse the very move that
  // repairs the breach.
  it('P17: moves partway toward the sub-target at lambda < 1, from a position already over its cap', () => {
    // 5,000 USDC held in a venue now capped at 10% of a 10,000 USDC vault.
    const overCap = (): DecisionInput => {
      const base = input();
      return {
        ...base,
        vault: { ...base.vault, idleBase: 5_000_000_000n },
        markets: [
          market('aa', {
            protocol: 'compound',
            supplyRateWad: (WAD * 3n) / 100n,
            positionBase: 5_000_000_000n,
            capBps: 1000,
          }),
        ],
        history: rebalanceHistory('aa'),
      };
    };

    const full = decide(overCap(), rebalanceArtifact(), REBALANCE_OPTS);
    // Non-vacuity: at lambda = 1 the kernel goes all the way to the cap.
    expect(full.action).toBe('rebalance');
    expect(full.target.get('aa')).toBe(1_000_000_000n);

    const half = decide(
      overCap(),
      { ...rebalanceArtifact(), adjustmentRate: 0.5 },
      REBALANCE_OPTS,
    );
    expect(half.action).toBe('rebalance');
    // 5,000 + 0.5 * (1,000 - 5,000) = 3,000 USDC: still over the 1,000 cap,
    // but strictly closer to it than the position it started from.
    expect(half.target.get('aa')).toBe(3_000_000_000n);
  });

  // P17 review C1 — `scripts/phase1-fork-check.ts#buildPinnedArtifact` does
  // exactly this: it takes the shipped bootstrap artifact and replaces its
  // empty `pinnedConfigDigests` with live on-chain digests. Admission is then
  // NOT empty, decide() reaches the movement hurdles, and `costHurdleWad`
  // throws unless the artifact carries a payback period. The bootstrap now
  // ships provisional values for all three of the fields `parseArtifact`
  // otherwise defaults on the provisional path.
  it('C1: the shipped bootstrap artifact can price a hurdle once its digests are pinned', () => {
    const bootstrap = loadBootstrapArtifact();
    expect(bootstrap.paybackSeconds).toBe(2_592_000);
    expect(bootstrap.adjustmentRate).toBe(1);
    expect(bootstrap.edgeWindowEffective).toBe(1);
    // Still provisional, therefore still non-citable — adding the fields is
    // not a registration.
    expect(bootstrap._provisional).toBeDefined();

    const pinned: PolicyArtifact = {
      ...bootstrap,
      pinnedConfigDigests: { aa: '0xd', bb: '0xd' },
    };
    const out = decide(rebalanceInput(), pinned, REBALANCE_OPTS);
    // Non-vacuity: admission really did pass and legs really were priced, so
    // this would have thrown before the fix rather than returning at all.
    expect(out.admission.eligible.length).toBeGreaterThan(0);
    expect(out.costGate.legs.length).toBeGreaterThan(0);
  });

  // P17 review I4 — the brakes see the FINAL executed vector (§9.1.4), so
  // MIN_TURNOVER measures `lambda * notional`. A target whose full notional
  // clears the floor and whose scaled notional does not used to HOLD, and a
  // hold changes no state, so the next origin found the same target and held
  // again — forever. The adjustment rate is raised to the floor instead.
  it('P17/I4: a small adjustment rate is raised to the turnover floor, not held under it', () => {
    const FLOOR_BPS = 100; // 1% of the 10,000 USDC vault = 100 USDC
    const opts = {
      ...REBALANCE_OPTS,
      cost: { ...REBALANCE_OPTS.cost, minTurnoverBps: FLOOR_BPS },
    };
    const floorBase =
      (rebalanceInput().vault.totalAssetsBase * BigInt(FLOOR_BPS)) / 10_000n;

    const moved = (out: { target: Map<string, bigint> }): bigint => {
      let n = 0n;
      for (const v of out.target.values()) n += v; // current is all-idle here
      return n;
    };

    const full = decide(rebalanceInput(), rebalanceArtifact(), opts);
    expect(full.action).toBe('rebalance');
    const fullNotional = moved(full);

    const lambda = 0.001;
    // Non-vacuity: at this rate the unraised move is far under the floor, so
    // the old code held here.
    expect((fullNotional * 1n) / 1000n).toBeLessThan(floorBase);

    const slow = decide(
      rebalanceInput(),
      { ...rebalanceArtifact(), adjustmentRate: lambda },
      opts,
    );
    expect(slow.action).toBe('rebalance');
    // Raised to the boundary — the least it is allowed to move — not to the
    // full target.
    expect(moved(slow)).toBe(floorBase);
    expect(moved(slow)).toBeLessThan(fullNotional);
  });

  it('does not read the wall clock', () => {
    const spy = jest.spyOn(Date, 'now');
    decide(input(), artifact(), DEFAULT_DECIDE_OPTS);
    decide(rebalanceInput(), rebalanceArtifact(), REBALANCE_OPTS);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
