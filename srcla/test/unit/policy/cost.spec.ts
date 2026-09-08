import {
  MOVE_COST_TERMS,
  movementCostBase,
  noTradeBandBase,
  costGate,
  reversalChurnBase,
} from '../../../src/policy/steps/cost.js';
import { loadBootstrapArtifact } from '../../../src/policy/artifact.js';
import type { DecisionInput, MarketObservation, PolicyArtifact, RateCurve } from '../../../src/policy/types.js';

const WAD = 10n ** 18n;
const Q = 1_000_000_000n;

function market(id: string, over: Partial<MarketObservation> = {}): MarketObservation {
  return {
    marketId: id, adapter: `0x${id}`, protocol: 'aave',
    cash: 10n ** 12n, borrows: 0n, reserves: 0n,
    supplyRateWad: WAD / 100n, utilizationWad: 0n,
    positionBase: 0n, maxDeployableBase: 10n ** 12n, maxWithdrawableBase: 10n ** 12n,
    configDigest: '0xd', regimeId: 'r1', paused: false,
    capBps: 10000, absoluteCapBase: 10n ** 13n, maxLossBps: 50, dependencyGroupIds: [],
    ...over,
  };
}

function input(
  markets: MarketObservation[],
  lastActionSeconds: number | null = null,
  lastAction: Partial<DecisionInput['lastAction']> = {}
): DecisionInput {
  return {
    origin: { blockNumber: 1, blockHash: '0xb', timestampSeconds: 1_000_000, finalized: true },
    vault: {
      totalAssetsBase: 10_000_000_000n, idleBase: 10_000_000_000n, sharesOutstanding: 10n ** 10n,
      adminReserveBase: 0n, dynamicReserveBase: 0n, minIdleBps: 0, paused: false, configurationDigest: '0xv',
    },
    markets, dependencyGroups: [], withdrawals: [],
    gas: {
      l2BaseFeeWei: 5_000_000n,          // 0.005 gwei, typical Base
      l1BaseFeeWei: 8_000_000_000n,      // 8 gwei on L1 - NOT read by cost.ts
                                          // post-blob-migration fix; kept
                                          // here only because GasObservation
                                          // still carries the field.
      l1BlobBaseFeeWei: 10_000_000n,     // ~0.01 gwei-equivalent; matches
                                          // the order of magnitude measured
                                          // on a pinned Base fork
                                          // (10,141,036 wei - SRCLA-REPORT.md
                                          // §5). NOT the EIP-4844 protocol
                                          // floor of 1 wei, which would
                                          // collapse this term to zero and
                                          // violate "L1 data cost must be
                                          // non-zero" (task-9-brief.md
                                          // constraint 3).
      ethUsdE8: 350_000_000_000n,        // $3,500
      usdcUsdE8: 100_000_000n,           // $1.00
    },
    history: [],
    lastAction: {
      timestampSeconds: lastActionSeconds,
      turnoverWindowBase: 0n,
      recentMoves: [],
      ...lastAction,
    },
  };
}

function curve(id: string, rate: bigint): RateCurve {
  return { marketId: id, quantumBase: Q, points: [rate, rate, rate, rate, rate], maxXBase: Q * 4n };
}

const artifact = (): PolicyArtifact => ({
  ...loadBootstrapArtifact(),
  residualQuantileWadByMarket: { a: 0n, b: 0n },
  noTradeBandK: 1.0,
});

const PARAMS = {
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
  // Per-protocol-call gas (exit/entry/claim only - see cost.ts's FINDING 1
  // comment for why this must NOT also drive l2).
  gasPerAction: 250_000n,
  // submitPlan (contract/src/NavyVaultSRCLA.sol) writes ~12 storage words
  // for the PlanHeader plus a PlanSubmitted event; EIP-2929 cold SSTORE
  // (~20k/word) plus the 21k base tx cost puts a full submission in the
  // 150k-250k gas range.
  planGasOverhead: 150_000n,
  // executeAction's own dispatch overhead (Merkle proof verification at
  // <=3-hash depth + next-index bookkeeping + ActionExecuted event),
  // EXCLUDING the protocol call the action performs.
  actionDispatchGas: 15_000n,
  // Was hardcoded to 50,000 inline (task-9-brief.md FINDING 2); moved here
  // with the same default value.
  approveResetGas: 50_000n,
  // Was hardcoded to 180,000 inline (task-9-brief.md FINDING 2); moved here
  // with the same default value.
  swapGas: 180_000n,
  // Sized to one `executeAction` call (see cost.ts's derivation comment),
  // not a whole plan submission - 2,000 was far too high (task-9-brief.md
  // FINDING A) and is what made the old calldata-priced L1 term dominate.
  l1BytesPerAction: 400n,
};

describe('movementCostBase', () => {
  it('registers all eleven terms from paper 9.1', () => {
    expect(MOVE_COST_TERMS).toEqual([
      'l2', 'l1Data', 'exit', 'entry', 'claim',
      'approveReset', 'swap', 'impact', 'slippageMev', 'failure', 'buffer',
    ]);
  });

  it('reports every registered term, none missing', () => {
    const { terms } = movementCostBase(input([market('a')]), [{ adapter: '0xa', amountBase: Q, kind: 'deploy' }], PARAMS);
    for (const name of MOVE_COST_TERMS) expect(terms[name]).toBeDefined();
  });

  it('includes a non-zero L1 data cost', () => {
    const { terms } = movementCostBase(input([market('a')]), [{ adapter: '0xa', amountBase: Q, kind: 'deploy' }], PARAMS);
    expect(terms['l1Data']!).toBeGreaterThan(0n);
  });

  it('scales with the number of actions', () => {
    const one = movementCostBase(input([market('a')]), [{ adapter: '0xa', amountBase: Q, kind: 'deploy' }], PARAMS);
    const two = movementCostBase(
      input([market('a'), market('b')]),
      [{ adapter: '0xa', amountBase: Q, kind: 'divest' }, { adapter: '0xb', amountBase: Q, kind: 'deploy' }],
      PARAMS
    );
    expect(two.totalBase).toBeGreaterThan(one.totalBase);
  });

  it('totals exactly the sum of every registered term - none silently dropped from the total', () => {
    // Distinct from "includes a non-zero L1 data cost" above: that test
    // only reads `terms['l1Data']`, so a `totalBase` reduce that skips
    // l1Data (while still reporting it correctly in `terms`) would not be
    // caught there. This recomputes the sum independently and compares.
    const { totalBase, terms } = movementCostBase(input([market('a')]), [{ adapter: '0xa', amountBase: Q, kind: 'deploy' }], PARAMS);
    const independentSum = MOVE_COST_TERMS.reduce((s, k) => s + terms[k]!, 0n);
    expect(totalBase).toBe(independentSum);
  });

  it('scales proportional terms with notional', () => {
    const small = movementCostBase(input([market('a')]), [{ adapter: '0xa', amountBase: Q, kind: 'deploy' }], PARAMS);
    const large = movementCostBase(input([market('a')]), [{ adapter: '0xa', amountBase: Q * 100n, kind: 'deploy' }], PARAMS);
    expect(large.terms['slippageMev']!).toBeGreaterThan(small.terms['slippageMev']!);
  });
});

// FINDING B (task-9-brief.md addendum) - a durable anchor pinning total
// pure-execution cost to the empirical order of magnitude measured on a
// live Base fork. Without this, a mis-scaled gas/data term (e.g. the
// pre-EIP-4844 calldata model this replaced, which overstated execution
// cost ~259x) passes every structural test above while quietly changing
// which rebalances the gate lets through.
//
// Only the seven directly gas-derived terms are anchored - l2, l1Data,
// exit, entry, claim, approveReset, swap. `impact` and `slippageMev` are
// bps-of-notional modelling assumptions, not measured gas, and are
// deliberately excluded (they would swamp the bound at any real notional
// regardless of whether the gas model is correct). `failure` and `buffer`
// are excluded too - they are haircuts multiplicatively derived FROM the
// seven gas terms, not independent measurements, so anchoring the raw
// seven is the more direct test of the gas model itself.
describe('movementCostBase - pure-execution cost anchor', () => {
  const PURE_EXECUTION_TERMS = ['l2', 'l1Data', 'exit', 'entry', 'claim', 'approveReset', 'swap'] as const;

  function pureExecutionTotal(terms: Record<string, bigint>): bigint {
    return PURE_EXECUTION_TERMS.reduce((s, k) => s + terms[k]!, 0n);
  }

  it('anchors a three-action rebalance to the measured Base order of magnitude (< $0.10, > $0)', () => {
    // SRCLA-REPORT.md §1 finding 7 / §5: a full three-VENUE (six-action:
    // three withdraws + three deposits) rebalance on a pinned Base fork
    // measured ~$0.0105 total. This fixture is half that shape - one
    // divest + two deploys, three actions - under this file's shared
    // "realistic Base" gas fixture (0.005 gwei L2, ~0.01 gwei-equivalent
    // blob fee, $3,500 ETH). $0.10 leaves an order of magnitude of
    // headroom above the measured figure while still catching a
    // several-hundred-x scaling defect.
    const i = input([market('a'), market('b'), market('c')]);
    const moves = [
      { adapter: '0xa', amountBase: Q, kind: 'divest' as const },
      { adapter: '0xb', amountBase: Q, kind: 'deploy' as const },
      { adapter: '0xc', amountBase: Q, kind: 'deploy' as const },
    ];
    const { terms } = movementCostBase(i, moves, PARAMS);
    const total = pureExecutionTotal(terms);

    expect(total).toBeGreaterThan(0n);
    expect(total).toBeLessThan(100_000n); // $0.10 in USDC base units (6dp)
  });

  // FINDING 3 (task-9-brief.md round-3 addendum) - THE DURABLE GUARD. Every
  // test above checks terms individually or checks that the total equals
  // their sum; none checked that the terms are mutually EXCLUSIVE. That gap
  // is exactly how FINDING 1 survived two rounds and every prior mutation
  // check: pre-fix, `l2` was an exact algebraic duplicate of
  // `exit + entry + claim` (both used `n * gasPerAction * l2BaseFeeWei`
  // where `n = divestCount + deployCount + harvestCount`), so it passed
  // "reports every term", "totals the sum", and the anchor bound - none of
  // those can see a term double-counting another.
  it('no gas-derived term duplicates another (non-overlap)', () => {
    // At least one of each move kind, per the finding's instruction, so
    // every one of the seven pure-execution terms is populated.
    const i = input([market('a'), market('b'), market('c')]);
    const moves = [
      { adapter: '0xa', amountBase: Q, kind: 'divest' as const },
      { adapter: '0xb', amountBase: Q, kind: 'deploy' as const },
      { adapter: '0xc', amountBase: Q, kind: 'harvest' as const },
    ];
    const { terms } = movementCostBase(i, moves, PARAMS);

    // The specific historical defect: l2 (plan submission + dispatch
    // overhead) must not equal the sum of the three protocol-call terms
    // (exit + entry + claim). This identity is exact and fixture-independent
    // in the pre-fix formula (l2 = n*gasPerAction*fee = (divestCount+
    // deployCount+harvestCount)*gasPerAction*fee = exit+entry+claim for ANY
    // move counts), so it is not sensitive to the specific counts chosen
    // here - any non-empty fixture reproduces it pre-fix.
    const exitEntryClaim = terms['exit']! + terms['entry']! + terms['claim']!;
    expect(terms['l2']!).not.toBe(exitEntryClaim);

    // A few further targeted combinations that would indicate the same
    // underlying gas being priced into two different terms. These are
    // deliberately NOT a blind brute-force subset-sum over all seven terms:
    // exit/entry/claim share one rate (gasPerAction) by design and are
    // EXPECTED to be simple integer multiples of each other depending on
    // move counts (e.g. equal counts make them numerically equal) - that is
    // correct pricing, not duplication, and a blind combinatorial check
    // would false-positive on it. Each comparison below crosses a genuine
    // conceptual boundary (plan-level vs protocol-call vs harvest-only gas).
    expect(terms['l2']!).not.toBe(terms['l1Data']! + terms['exit']! + terms['entry']! + terms['claim']!);
    expect(terms['approveReset']! + terms['swap']!).not.toBe(exitEntryClaim);
    expect(terms['l2']!).not.toBe(terms['approveReset']! + terms['swap']!);
  });
});

describe('costGate', () => {
  it('blocks while inside the cooldown window', () => {
    const i = input([market('a', { positionBase: 0n })], 999_000); // 1000s ago, cooldown 3600
    const r = costGate(i, [curve('a', WAD / 10n)], artifact(), new Map([['a', 0n]]), new Map([['a', Q * 4n]]), PARAMS);
    expect(r.passed).toBe(false);
    expect(r.reason).toContain('COOLDOWN');
  });

  it('blocks a move whose turnover is below the minimum', () => {
    const i = input([market('a')]);
    const r = costGate(i, [curve('a', WAD / 10n)], artifact(), new Map([['a', 0n]]), new Map([['a', 1n]]), PARAMS);
    expect(r.passed).toBe(false);
    expect(r.reason).toContain('MIN_TURNOVER');
  });

  it('blocks a move whose turnover exceeds the maximum', () => {
    const i = input([market('a')]);
    const r = costGate(i, [curve('a', WAD / 10n)], artifact(), new Map([['a', 0n]]), new Map([['a', 9_000_000_000n]]), PARAMS);
    expect(r.passed).toBe(false);
    expect(r.reason).toContain('MAX_TURNOVER');
  });

  // REPAIRED FIXTURE — see task-9-report.md "Fixture audit" for the full
  // derivation. The brief's original numbers (portfolioResidualQuantileWad
  // = -(WAD/100), curve rate WAD/1000, target Q*2) produce a NEGATIVE
  // gainBase (~ -19.96M base units) that never clears moveCostBase (~2.53M
  // base units) in the first place, so the test would pass vacuously — it
  // would report NO_TRADE_BAND as the reason regardless of whether the band
  // logic is correct, because MOVE_COST would have failed it too. This
  // version uses a smaller quantile (WAD/100_000) and a higher curve rate
  // (WAD/10) so gainBase (~3.82M) genuinely clears moveCostBase (~2.53M)
  // while a large noTradeBandK (1000) still pushes bandBase (~20M) above
  // both gainBase and moveCostBase — the band is what blocks it, and only
  // the band.
  it('blocks a gain that clears cost but not the uncertainty band (P8)', () => {
    const i = input([market('a')]);
    const a = { ...artifact(), portfolioResidualQuantileWad: -(WAD / 100_000n), noTradeBandK: 1000 };
    const r = costGate(i, [curve('a', WAD / 10n)], a, new Map([['a', 0n]]), new Map([['a', Q * 2n]]), PARAMS);
    expect(r.passed).toBe(false);
    expect(r.reason).toContain('NO_TRADE_BAND');
    expect(r.bandBase).toBeGreaterThan(r.moveCostBase);
    // The defining property this test exists to prove: the gain clears
    // C_move on its own. Without this, "blocked by NO_TRADE_BAND" would be
    // consistent with the move also failing on cost alone.
    expect(r.gainBase).toBeGreaterThan(r.moveCostBase);
  });

  it('passes a clearly profitable move outside cooldown', () => {
    const i = input([market('a')]);
    const a = { ...artifact(), noTradeBandK: 0 };
    const r = costGate(i, [curve('a', WAD / 2n)], a, new Map([['a', 0n]]), new Map([['a', Q * 4n]]), PARAMS);
    expect(r.passed).toBe(true);
    expect(r.gainBase).toBeGreaterThan(r.moveCostBase);
  });

  it('is deterministic', () => {
    const i = input([market('a')]);
    const args: Parameters<typeof costGate> = [
      i, [curve('a', WAD / 2n)], artifact(), new Map([['a', 0n]]), new Map([['a', Q * 4n]]), PARAMS,
    ];
    expect(costGate(...args)).toEqual(costGate(...args));
  });
});

describe('noTradeBandBase', () => {
  it('scales linearly with notional and with the artifact dispersion quantile', () => {
    const i = input([market('a')]);
    const a = { ...artifact(), portfolioResidualQuantileWad: -(WAD / 100n), noTradeBandK: 2 };

    const base = noTradeBandBase(i, [curve('a', WAD / 10n)], a, Q);
    const doubleNotional = noTradeBandBase(i, [curve('a', WAD / 10n)], a, Q * 2n);
    expect(doubleNotional).toBe(base * 2n);

    const wideDispersion = { ...a, portfolioResidualQuantileWad: -(WAD / 50n) }; // 2x |quantile|
    expect(noTradeBandBase(i, [curve('a', WAD / 10n)], wideDispersion, Q)).toBe(base * 2n);
  });

  it('is zero when noTradeBandK is zero', () => {
    const i = input([market('a')]);
    const a = { ...artifact(), noTradeBandK: 0 };
    expect(noTradeBandBase(i, [curve('a', WAD / 10n)], a, Q * 5n)).toBe(0n);
  });
});

/**
 * §9.1's third churn brake (readiness audit NEW-19: "Reversal allowance does
 * not exist at all — grep for `reversal` returns nothing in src or test").
 *
 * The defining property is that it must NOT be a second turnover cap: a
 * policy that keeps building one position is not churning and must pay
 * nothing here, while a round trip of the same notional must pay twice it.
 */
describe('reversalChurnBase', () => {
  const proposed = (entries: Array<[string, bigint]>) => new Map(entries);

  it('is zero for a monotone build-up, however many steps', () => {
    const churn = reversalChurnBase(
      [
        { marketId: 'a', deltaBase: 100n, timestampSeconds: 999_000 },
        { marketId: 'a', deltaBase: 200n, timestampSeconds: 999_500 },
      ],
      proposed([['a', 300n]]),
      1_000_000,
      86_400
    );
    expect(churn).toBe(0n);
  });

  it('is zero for a monotone wind-down', () => {
    const churn = reversalChurnBase(
      [{ marketId: 'a', deltaBase: -100n, timestampSeconds: 999_000 }],
      proposed([['a', -400n]]),
      1_000_000,
      86_400
    );
    expect(churn).toBe(0n);
  });

  it('charges twice the reversed amount for a round trip', () => {
    // +500 then -500: gross 1000, net 0 -> churn 1000 = 2 * 500.
    const churn = reversalChurnBase(
      [{ marketId: 'a', deltaBase: 500n, timestampSeconds: 999_000 }],
      proposed([['a', -500n]]),
      1_000_000,
      86_400
    );
    expect(churn).toBe(1000n);
  });

  it('charges only the reversed part of a partial reversal', () => {
    // +500 then -200: gross 700, |net| 300 -> churn 400 = 2 * 200.
    const churn = reversalChurnBase(
      [{ marketId: 'a', deltaBase: 500n, timestampSeconds: 999_000 }],
      proposed([['a', -200n]]),
      1_000_000,
      86_400
    );
    expect(churn).toBe(400n);
  });

  it('does not net one venue against another', () => {
    // Divesting `a` to fund `b` is a rotation, not a reversal of either.
    const churn = reversalChurnBase(
      [{ marketId: 'a', deltaBase: 500n, timestampSeconds: 999_000 }],
      proposed([['a', 100n], ['b', -100n]]),
      1_000_000,
      86_400
    );
    expect(churn).toBe(0n);
  });

  it('accumulates across the window rather than resetting each decision', () => {
    // Two prior round trips already sit in the window; the proposal adds a
    // third. A per-decision measure would report only the newest one.
    const history = [
      { marketId: 'a', deltaBase: 100n, timestampSeconds: 999_000 },
      { marketId: 'a', deltaBase: -100n, timestampSeconds: 999_100 },
      { marketId: 'a', deltaBase: 100n, timestampSeconds: 999_200 },
    ];
    expect(reversalChurnBase(history, proposed([['a', -100n]]), 1_000_000, 86_400)).toBe(400n);
    expect(reversalChurnBase(history, proposed([]), 1_000_000, 86_400)).toBe(200n);
  });

  it('forgets history that has aged out of the window', () => {
    const old = [{ marketId: 'a', deltaBase: 500n, timestampSeconds: 1_000_000 - 86_400 }];
    expect(reversalChurnBase(old, proposed([['a', -500n]]), 1_000_000, 86_400)).toBe(0n);
    const fresh = [{ marketId: 'a', deltaBase: 500n, timestampSeconds: 1_000_000 - 86_399 }];
    expect(reversalChurnBase(fresh, proposed([['a', -500n]]), 1_000_000, 86_400)).toBe(1000n);
  });

  it('ignores a record stamped after the origin', () => {
    const future = [{ marketId: 'a', deltaBase: 500n, timestampSeconds: 1_000_001 }];
    expect(reversalChurnBase(future, proposed([['a', -500n]]), 1_000_000, 86_400)).toBe(0n);
  });
});

describe('costGate churn brakes read persisted history (NEW-19)', () => {
  // Every case here supplies REAL history. The bug was that the production
  // driver supplied none, so a gate that only ever saw an empty history was
  // indistinguishable from a gate that did not exist.
  const profitable = () => ({ ...artifact(), noTradeBandK: 0 });

  it('MAX_TURNOVER fires on turnover already spent in the rolling window', () => {
    // Vault 10,000 USDC; maxTurnoverBps 5000 -> 5,000 USDC allowed. A move
    // of 4,000 alone passes; with 2,000 already spent it must not.
    const alone = costGate(
      input([market('a')]),
      [curve('a', WAD / 2n)],
      profitable(),
      new Map([['a', 0n]]),
      new Map([['a', Q * 4n]]),
      PARAMS
    );
    expect(alone.passed).toBe(true);

    const withHistory = costGate(
      input([market('a')], null, { turnoverWindowBase: Q * 2n }),
      [curve('a', WAD / 2n)],
      profitable(),
      new Map([['a', 0n]]),
      new Map([['a', Q * 4n]]),
      PARAMS
    );
    expect(withHistory.passed).toBe(false);
    expect(withHistory.reason).toContain('MAX_TURNOVER');
    // The message names the window it applied, so a rejection is never
    // attributed to a bound the gate did not use.
    expect(withHistory.reason).toContain(String(PARAMS.turnoverWindowSeconds));
  });

  it('REVERSAL_ALLOWANCE blocks undoing a recent move, and only that', () => {
    // Vault 10,000 USDC; reversalAllowanceBps 200 -> 200 USDC of churn.
    // A recent +2,000 into `a` followed by a proposed exit is 4,000 of churn.
    const reversing = costGate(
      input([market('a', { positionBase: Q * 2n })], null, {
        recentMoves: [{ marketId: 'a', deltaBase: Q * 2n, timestampSeconds: 999_000 }],
      }),
      [curve('a', WAD / 2n)],
      profitable(),
      new Map([['a', Q * 2n]]),
      new Map([['a', 0n]]),
      PARAMS
    );
    expect(reversing.passed).toBe(false);
    expect(reversing.reason).toContain('REVERSAL_ALLOWANCE');

    // The SAME history with a move in the SAME direction is not a reversal
    // and must not be charged: this is what separates the allowance from a
    // second turnover cap.
    const continuing = costGate(
      input([market('a', { positionBase: Q * 2n })], null, {
        recentMoves: [{ marketId: 'a', deltaBase: Q * 2n, timestampSeconds: 999_000 }],
      }),
      [curve('a', WAD / 2n)],
      profitable(),
      new Map([['a', Q * 2n]]),
      new Map([['a', Q * 4n]]),
      PARAMS
    );
    expect(continuing.passed).toBe(true);
  });

  it('the reversal gate is inert only because there is no history', () => {
    // Same reversal, empty recentMoves: nothing to reverse, so it passes.
    // Stated explicitly so a future regression to a permanently-empty
    // history cannot masquerade as "the gate approves this move".
    const r = costGate(
      input([market('a', { positionBase: Q * 2n })]),
      [curve('a', WAD / 2n)],
      profitable(),
      new Map([['a', Q * 2n]]),
      new Map([['a', 0n]]),
      PARAMS
    );
    expect(r.reason).not.toContain('REVERSAL_ALLOWANCE');
  });
});
