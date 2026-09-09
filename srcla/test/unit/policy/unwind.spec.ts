/**
 * §9.1's bounded safety unwind (readiness audit NEW-20).
 *
 * The defect: `optimize` builds `target` only over ADMITTED markets, so a
 * paused or de-admitted venue's position became an ordinary divest and was
 * then subjected to the full economic gate — cooldown, MIN_TURNOVER,
 * MAX_TURNOVER and `gain > max(C_move, k*sigma)`. A safety exit could be
 * SUPPRESSED BY MIN_TURNOVER, and when every market failed admission,
 * `decide` returned at ADMISSION_EMPTY without building a target at all.
 *
 * The end-to-end tests below therefore assert the two things a bypass has to
 * prove: the plan is emitted, AND the same move would have been blocked by
 * the gate had it gone through it. Asserting only the first would pass even
 * if the gate had never been reachable.
 */
import { safetyUnwind, SAFETY_EXIT_CODES } from '../../../src/policy/steps/unwind.js';
import { admit } from '../../../src/policy/steps/admit.js';
import { decide, DEFAULT_DECIDE_OPTS } from '../../../src/policy/decide.js';
import { applyBrakes } from '../../../src/policy/steps/cost.js';
import { planLegs } from '../../../src/policy/steps/legs.js';
import { simulateCurves } from '../../../src/policy/steps/simulate.js';
import { ActionKind } from '../../../src/policy/steps/plan.js';
import { loadBootstrapArtifact } from '../../../src/policy/artifact.js';
import type {
  AdmissionResult,
  DecisionInput,
  MarketObservation,
  PolicyArtifact,
} from '../../../src/policy/types.js';

const WAD = 10n ** 18n;
const USDC = 1_000_000n;

/** A syntactically valid 20-byte address derived deterministically from the
 *  market id — `plan.ts` ABI-encodes the adapter, so a placeholder that is
 *  not valid hex throws inside ethers rather than reaching an assertion. */
function adapterFor(marketId: string): string {
  const hex = [...marketId].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  return `0x${(hex + '0'.repeat(40)).slice(0, 40)}`;
}

function market(marketId: string, over: Partial<MarketObservation> = {}): MarketObservation {
  return {
    marketId,
    adapter: adapterFor(marketId),
    protocol: 'aave',
    cash: 500_000n * USDC,
    borrows: 100_000n * USDC,
    reserves: 0n,
    supplyRateWad: WAD / 20n,
    utilizationWad: WAD / 5n,
    positionBase: 0n,
    maxDeployableBase: 500_000n * USDC,
    maxWithdrawableBase: 500_000n * USDC,
    configDigest: `0xpin-${marketId}`,
    regimeId: 'r1',
    paused: false,
    capBps: 5000,
    absoluteCapBase: 1_000_000n * USDC,
    maxLossBps: 50,
    dependencyGroupIds: [],
    ...over,
  };
}

function input(markets: MarketObservation[], totalAssetsBase = 100_000n * USDC): DecisionInput {
  return {
    origin: { blockNumber: 1, blockHash: '0xb', timestampSeconds: 1_000_000, finalized: true },
    vault: {
      totalAssetsBase,
      idleBase: totalAssetsBase,
      sharesOutstanding: totalAssetsBase,
      adminReserveBase: 0n,
      dynamicReserveBase: 0n,
      minIdleBps: 0,
      paused: false,
      configurationDigest: '0x' + '11'.repeat(32),
    },
    markets,
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

/** An artifact that pins every market's digest and needs no label history,
 *  so admission turns purely on the rule under test. */
function artifactFor(markets: MarketObservation[]): PolicyArtifact {
  const pinnedConfigDigests: Record<string, string> = {};
  for (const m of markets) pinnedConfigDigests[m.marketId] = `0xpin-${m.marketId}`;
  return {
    ...loadBootstrapArtifact(),
    pinnedConfigDigests,
    minObservations: 0,
    residualQuantileWadByMarket: {},
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

function reasonsWith(marketId: string, code: string): AdmissionResult {
  return { eligible: [], reasons: [{ marketId, code, passed: false, detail: 'x' }] };
}

describe('SAFETY_EXIT_CODES', () => {
  it('is exactly the two §12 safety conditions', () => {
    expect([...SAFETY_EXIT_CODES].sort()).toEqual(['CONFIG_DIGEST_MISMATCH', 'PAUSED']);
  });

  it('excludes CONFIG_DIGEST_UNPINNED', () => {
    // The shipped bootstrap artifact has an EMPTY pin map, so every market
    // fails this rule on every cycle. Admitting it to the safety set would
    // emergency-exit the whole vault, forever.
    expect(SAFETY_EXIT_CODES).not.toContain('CONFIG_DIGEST_UNPINNED');
  });

  it('excludes the read-failure and illiquidity codes', () => {
    // §12 row 1 is "do not decide", not "exit"; the illiquid-withdrawal row
    // forbids exceeding loss bounds, which is what forcing an exit out of a
    // cashless venue does.
    for (const code of ['NO_MARKET_DATA', 'NO_SYNC_LIQUIDITY', 'KINK_EXCEEDED', 'REGIME_MIN_HISTORY']) {
      expect(SAFETY_EXIT_CODES).not.toContain(code);
    }
  });
});

describe('safetyUnwind', () => {
  const OPTS = { maxBps: 2500 };

  it('exits a paused venue that holds a position', () => {
    const m = market('aave', { paused: true, positionBase: 10_000n * USDC });
    const out = safetyUnwind(input([m]), reasonsWith('aave', 'PAUSED'), OPTS);
    expect(out.exits).toEqual([
      {
        marketId: 'aave',
        adapter: adapterFor('aave'),
        positionBase: 10_000n * USDC,
        codes: ['PAUSED'],
      },
    ]);
  });

  it('does not exit a venue holding nothing', () => {
    const m = market('aave', { paused: true, positionBase: 0n });
    const out = safetyUnwind(input([m]), reasonsWith('aave', 'PAUSED'), OPTS);
    expect(out.exits).toEqual([]);
  });

  it('does not exit on a NON-safety admission failure', () => {
    const m = market('aave', { positionBase: 10_000n * USDC });
    for (const code of ['REGIME_MIN_HISTORY', 'CONFIG_DIGEST_UNPINNED', 'NO_MARKET_DATA', 'KINK_EXCEEDED']) {
      expect(safetyUnwind(input([m]), reasonsWith('aave', code), OPTS).exits).toEqual([]);
    }
  });

  it('ignores a PASSING safety rule', () => {
    const m = market('aave', { positionBase: 10_000n * USDC });
    const admission: AdmissionResult = {
      eligible: ['aave'],
      reasons: [{ marketId: 'aave', code: 'PAUSED', passed: true, detail: 'active' }],
    };
    expect(safetyUnwind(input([m]), admission, OPTS).exits).toEqual([]);
  });

  it('reports every safety code that fired, sorted', () => {
    const m = market('aave', { paused: true, positionBase: 10_000n * USDC });
    const admission: AdmissionResult = {
      eligible: [],
      reasons: [
        { marketId: 'aave', code: 'PAUSED', passed: false, detail: 'x' },
        { marketId: 'aave', code: 'CONFIG_DIGEST_MISMATCH', passed: false, detail: 'y' },
        { marketId: 'aave', code: 'REGIME_MIN_HISTORY', passed: false, detail: 'z' },
      ],
    };
    expect(safetyUnwind(input([m]), admission, OPTS).exits[0]!.codes).toEqual([
      'CONFIG_DIGEST_MISMATCH',
      'PAUSED',
    ]);
  });

  it('bounds one plan at maxBps of TVL and defers the rest', () => {
    // TVL 100,000; bound 25% = 25,000. Three paused venues of 20,000 /
    // 10,000 / 8,000: the first fits, the second takes the running total to
    // 30,000 (> 25,000) and is deferred, and so is the third.
    const markets = [
      market('a', { paused: true, positionBase: 20_000n * USDC }),
      market('b', { paused: true, positionBase: 10_000n * USDC }),
      market('c', { paused: true, positionBase: 8_000n * USDC }),
    ];
    const admission: AdmissionResult = {
      eligible: [],
      reasons: markets.map((m) => ({ marketId: m.marketId, code: 'PAUSED', passed: false, detail: 'x' })),
    };
    const out = safetyUnwind(input(markets), admission, OPTS);
    expect(out.exits.map((e) => e.marketId)).toEqual(['a']);
    expect(out.deferred).toEqual(['b', 'c']);
    expect(out.notionalBase).toBe(20_000n * USDC);
    expect(out.boundBase).toBe(25_000n * USDC);
  });

  it('takes the largest exposure first', () => {
    const markets = [
      market('a', { paused: true, positionBase: 5_000n * USDC }),
      market('z', { paused: true, positionBase: 20_000n * USDC }),
    ];
    const admission: AdmissionResult = {
      eligible: [],
      reasons: markets.map((m) => ({ marketId: m.marketId, code: 'PAUSED', passed: false, detail: 'x' })),
    };
    const out = safetyUnwind(input(markets), admission, { maxBps: 2100 });
    expect(out.exits.map((e) => e.marketId)).toEqual(['z']);
  });

  it('breaks an exact position tie on market id, deterministically', () => {
    const markets = [
      market('zeta', { paused: true, positionBase: 20_000n * USDC }),
      market('alpha', { paused: true, positionBase: 20_000n * USDC }),
    ];
    const admission: AdmissionResult = {
      eligible: [],
      reasons: markets.map((m) => ({ marketId: m.marketId, code: 'PAUSED', passed: false, detail: 'x' })),
    };
    const out = safetyUnwind(input(markets), admission, { maxBps: 2500 });
    expect(out.exits.map((e) => e.marketId)).toEqual(['alpha']);
    expect(out.deferred).toEqual(['zeta']);
  });

  it('still exits a single venue larger than the whole bound', () => {
    // A bounded unwind that can never unwind is worse than one that exceeds
    // its bound once. The plan's own maxRecognizedLoss and per-action minOut
    // still bound the LOSS.
    const m = market('a', { paused: true, positionBase: 90_000n * USDC });
    const out = safetyUnwind(input([m]), reasonsWith('a', 'PAUSED'), OPTS);
    expect(out.exits.map((e) => e.marketId)).toEqual(['a']);
    expect(out.notionalBase).toBeGreaterThan(out.boundBase);
  });
});

describe('decide() emits a bounded safety unwind that bypasses the economic gate', () => {
  /** A paused venue holding a position too small to clear MIN_TURNOVER. */
  function pausedTinyPosition() {
    // MIN_TURNOVER is 10 bps of 100,000 USDC = 100 USDC. A 50 USDC stranded
    // position is below it, which is the audit's exact scenario.
    const markets = [
      market('aave', { paused: true, positionBase: 50n * USDC, maxWithdrawableBase: 50n * USDC }),
      market('compound', { positionBase: 0n }),
    ];
    return { markets, input: input(markets), artifact: artifactFor(markets) };
  }

  // P17 rewrote what "the gate" is: the single `costGate` this control used to
  // call is gone, replaced by §9.1.4's two halves — the per-leg hurdles
  // (steps/hurdles.ts, driven by steps/legs.ts) and the aggregate brakes
  // (cost.ts#applyBrakes). The property under test is unchanged — this exit
  // could not have reached the chain through the economic path — so the
  // control now asserts it against BOTH halves, which is strictly stronger
  // than the one assertion it replaces.
  it('would be suppressed by the economic path: MIN_TURNOVER, and no leg to price', () => {
    // The control. Without this, "the unwind was emitted" is consistent with
    // the economic path having been passable all along.
    const { markets, input: i, artifact } = pausedTinyPosition();
    const current = new Map(markets.map((m) => [m.marketId, m.positionBase]));
    const target = new Map(markets.map((m) => [m.marketId, 0n]));

    // 1. The aggregate brake. 50 USDC of notional against a 100,000 USDC
    //    vault is 5bps, under the 10bps MIN_TURNOVER floor.
    let notional = 0n;
    for (const id of new Set([...current.keys(), ...target.keys()])) {
      const d = (target.get(id) ?? 0n) - (current.get(id) ?? 0n);
      notional += d < 0n ? -d : d;
    }
    expect(notional).toBe(50n * USDC);
    const brake = applyBrakes(i, notional, current, target, DEFAULT_DECIDE_OPTS.cost);
    expect(brake).not.toBeNull();
    expect(brake).toContain('MIN_TURNOVER');

    // 2. The hurdles cannot even see the exit. A paused venue fails
    //    admission, so it has no simulated curve, so `planLegs` emits no leg
    //    for it — the economic path has no way to divest it at any size.
    const admission = admit(i, artifact);
    expect(admission.eligible).not.toContain('aave');
    const curves = simulateCurves(i, admission.eligible, DEFAULT_DECIDE_OPTS.quantumBase, 16);
    const legs = planLegs(current, target, i, artifact, curves, DEFAULT_DECIDE_OPTS.cost);
    expect(legs.every((l) => l.marketId !== 'aave')).toBe(true);
  });

  it('emits the exit anyway, with the gate reported as bypassed', () => {
    const { input: i, artifact } = pausedTinyPosition();
    const out = decide(i, artifact, DEFAULT_DECIDE_OPTS);

    expect(out.action).toBe('rebalance');
    expect(out.plan).not.toBeNull();
    expect(out.target.get('aave')).toBe(0n);
    expect(out.costGate.reason).toBe('SAFETY_UNWIND_BYPASS');
    expect(out.reasons.join(' ')).toContain('SAFETY_UNWIND');
    // A bypass must never look like a cleared gate. P17 removed the
    // gain/cost/band triple this used to check for a fabricated non-zero (all
    // four fields were permanently 0n once the single gate went, and no
    // consumer read them); the same property is now that NOTHING WAS PRICED —
    // an empty leg list, which `HURDLES_CLEARED` can never produce, since it
    // requires at least one leg to have cleared.
    expect(out.costGate.legs).toEqual([]);
  });

  it('emits ActionKind.EmergencyExit, not Divest', () => {
    const { input: i, artifact } = pausedTinyPosition();
    const out = decide(i, artifact, DEFAULT_DECIDE_OPTS);
    expect(out.plan!.actions).toHaveLength(1);
    expect(out.plan!.actions[0]!.kind).toBe(ActionKind.EmergencyExit);
    expect(out.plan!.actions[0]!.amountBase).toBe(50n * USDC);
  });

  it('unwinds even when EVERY market fails admission', () => {
    // The ADMISSION_EMPTY early return used to swallow exactly this case.
    const markets = [market('aave', { paused: true, positionBase: 20_000n * USDC })];
    const out = decide(input(markets), artifactFor(markets), DEFAULT_DECIDE_OPTS);
    expect(out.admission.eligible).toEqual([]);
    expect(out.action).toBe('rebalance');
    expect(out.plan!.actions[0]!.kind).toBe(ActionKind.EmergencyExit);
  });

  it('emits divests only — no deploy rides out on the bypass', () => {
    // `compound` is healthy, admitted and empty: an ordinary cycle would
    // deploy into it. The safety plan must not carry that move through the
    // gate it just bypassed.
    const markets = [
      market('aave', { paused: true, positionBase: 20_000n * USDC }),
      market('compound', { positionBase: 0n, supplyRateWad: WAD / 5n }),
    ];
    const out = decide(input(markets), artifactFor(markets), DEFAULT_DECIDE_OPTS);
    expect(out.plan!.actions.map((a) => a.kind)).toEqual([ActionKind.EmergencyExit]);
    expect(out.target.get('compound')).toBe(0n);
  });

  it('leaves a healthy venue untouched by an unrelated venue\'s unwind', () => {
    const markets = [
      market('aave', { paused: true, positionBase: 20_000n * USDC }),
      market('compound', { positionBase: 5_000n * USDC }),
    ];
    const out = decide(input(markets), artifactFor(markets), DEFAULT_DECIDE_OPTS);
    expect(out.target.get('compound')).toBe(5_000n * USDC);
    expect(out.plan!.actions).toHaveLength(1);
  });

  it('does NOT bypass the gate when nothing qualifies for an unwind', () => {
    // The bypass must be reachable only through the registered safety set.
    const markets = [market('aave', { positionBase: 50n * USDC })];
    const out = decide(input(markets), artifactFor(markets), DEFAULT_DECIDE_OPTS);
    expect(out.costGate.reason).not.toBe('SAFETY_UNWIND_BYPASS');
  });

  it('names the bound and the deferred venues in its reasons', () => {
    const markets = [
      market('a', { paused: true, positionBase: 20_000n * USDC }),
      market('b', { paused: true, positionBase: 10_000n * USDC }),
    ];
    const out = decide(input(markets), artifactFor(markets), DEFAULT_DECIDE_OPTS);
    const reason = out.reasons.find((r) => r.startsWith('SAFETY_UNWIND'))!;
    expect(reason).toContain('a[PAUSED]');
    expect(reason).toContain('deferred to a later cycle: b');
    expect(out.plan!.actions).toHaveLength(1);
  });

  it('unwinds a venue whose pinned digest no longer matches', () => {
    const markets = [market('aave', { positionBase: 20_000n * USDC, configDigest: '0xchanged' })];
    const out = decide(input(markets), artifactFor(markets), DEFAULT_DECIDE_OPTS);
    expect(out.plan!.actions[0]!.kind).toBe(ActionKind.EmergencyExit);
    expect(out.reasons.join(' ')).toContain('CONFIG_DIGEST_MISMATCH');
  });

  it('does NOT unwind a venue that merely has no pin registered', () => {
    const markets = [market('aave', { positionBase: 20_000n * USDC })];
    const out = decide(input(markets), { ...artifactFor(markets), pinnedConfigDigests: {} }, DEFAULT_DECIDE_OPTS);
    expect(out.reasons.join(' ')).not.toContain('SAFETY_UNWIND');
  });

  it('is deterministic', () => {
    const markets = [market('aave', { paused: true, positionBase: 20_000n * USDC })];
    const a = decide(input(markets), artifactFor(markets), DEFAULT_DECIDE_OPTS);
    const b = decide(input(markets), artifactFor(markets), DEFAULT_DECIDE_OPTS);
    expect(a.decisionHash).toBe(b.decisionHash);
    expect(a.plan!.merkleRoot).toBe(b.plan!.merkleRoot);
  });
});
