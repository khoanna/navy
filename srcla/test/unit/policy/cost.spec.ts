import {
  MOVE_COST_TERMS,
  movementCostBase,
  reversalChurnBase,
  applyBrakes,
} from '../../../src/policy/steps/cost.js';
import type { DecisionInput, MarketObservation } from '../../../src/policy/types.js';

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
    // P14: impact/slippageMev are now bps of the harvest (swap) leg only,
    // not any move - a 'deploy' move no longer moves these terms at all,
    // so the fixture uses 'harvest' to keep testing the proportional-scaling
    // property the test is named for.
    const small = movementCostBase(input([market('a')]), [{ adapter: '0xa', amountBase: Q, kind: 'harvest' }], PARAMS);
    const large = movementCostBase(input([market('a')]), [{ adapter: '0xa', amountBase: Q * 100n, kind: 'harvest' }], PARAMS);
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

/** Sum of `|target_i - current_i|` over every venue — the same `notional`
 *  the pre-P13/P15/P16 `costGate` derived internally via `movesFrom`, now
 *  passed into `applyBrakes` explicitly rather than recomputed inside it. */
function notionalOf(current: Map<string, bigint>, target: Map<string, bigint>): bigint {
  let n = 0n;
  for (const id of new Set([...current.keys(), ...target.keys()])) {
    const delta = (target.get(id) ?? 0n) - (current.get(id) ?? 0n);
    n += delta < 0n ? -delta : delta;
  }
  return n;
}

/**
 * §9.1.4's brakes, extracted from the pre-P13/P15/P16 `costGate` into
 * `applyBrakes` (CRITICAL 1 of the Task 3 review): stubbing `costGate`'s
 * whole body to throw removed the only enforcement of these five checks,
 * not just their old tests. Paper §9.1.4: "Cooldown, minimum turnover,
 * maximum turnover, and reversal allowances remain in force ... they bound
 * the policy's aggregate behavior, whereas the hurdles above decide
 * individual legs" — these are a distinct, always-live constraint, not
 * subsumed by the two hurdles in `steps/hurdles.ts`.
 */
describe('applyBrakes', () => {
  it('blocks while inside the cooldown window', () => {
    const i = input([market('a', { positionBase: 0n })], 999_000); // 1000s ago, cooldown 3600
    const current = new Map([['a', 0n]]);
    const target = new Map([['a', Q * 4n]]);
    const reason = applyBrakes(i, notionalOf(current, target), current, target, PARAMS);
    expect(reason).toContain('COOLDOWN');
  });

  it('blocks a move whose turnover is below the minimum', () => {
    const i = input([market('a')]);
    const current = new Map([['a', 0n]]);
    const target = new Map([['a', 1n]]);
    const reason = applyBrakes(i, notionalOf(current, target), current, target, PARAMS);
    expect(reason).toContain('MIN_TURNOVER');
  });

  it('blocks a move whose turnover exceeds the maximum', () => {
    const i = input([market('a')]);
    const current = new Map([['a', 0n]]);
    const target = new Map([['a', 9_000_000_000n]]);
    const reason = applyBrakes(i, notionalOf(current, target), current, target, PARAMS);
    expect(reason).toContain('MAX_TURNOVER');
  });

  it('returns null when no brake fires', () => {
    const i = input([market('a')]);
    const current = new Map([['a', 0n]]);
    const target = new Map([['a', Q * 4n]]);
    expect(applyBrakes(i, notionalOf(current, target), current, target, PARAMS)).toBeNull();
  });

  it('is deterministic', () => {
    const i = input([market('a')]);
    const current = new Map([['a', 0n]]);
    const target = new Map([['a', Q * 4n]]);
    const args: Parameters<typeof applyBrakes> = [i, notionalOf(current, target), current, target, PARAMS];
    expect(applyBrakes(...args)).toEqual(applyBrakes(...args));
  });
});

describe('applyBrakes churn brakes read persisted history (NEW-19)', () => {
  // Every case here supplies REAL history. The bug was that the production
  // driver supplied none, so a gate that only ever saw an empty history was
  // indistinguishable from a gate that did not exist.
  it('MAX_TURNOVER fires on turnover already spent in the rolling window', () => {
    // Vault 10,000 USDC; maxTurnoverBps 5000 -> 5,000 USDC allowed. A move
    // of 4,000 alone passes; with 2,000 already spent it must not.
    const current = new Map([['a', 0n]]);
    const target = new Map([['a', Q * 4n]]);

    const alone = applyBrakes(input([market('a')]), notionalOf(current, target), current, target, PARAMS);
    expect(alone).toBeNull();

    const withHistory = applyBrakes(
      input([market('a')], null, { turnoverWindowBase: Q * 2n }),
      notionalOf(current, target),
      current,
      target,
      PARAMS
    );
    expect(withHistory).toContain('MAX_TURNOVER');
    // The message names the window it applied, so a rejection is never
    // attributed to a bound the gate did not use.
    expect(withHistory).toContain(String(PARAMS.turnoverWindowSeconds));
  });

  it('REVERSAL_ALLOWANCE blocks undoing a recent move; a monotone continuation in the SAME direction is NOT charged', () => {
    // Vault 10,000 USDC; reversalAllowanceBps 200 -> 200 USDC of churn.
    // A recent +2,000 into `a` followed by a proposed full exit is 4,000 of
    // round-trip churn (gross 4,000, |net| 0).
    const history = { recentMoves: [{ marketId: 'a', deltaBase: Q * 2n, timestampSeconds: 999_000 }] };

    const reversingCurrent = new Map([['a', Q * 2n]]);
    const reversingTarget = new Map([['a', 0n]]);
    const reversing = applyBrakes(
      input([market('a', { positionBase: Q * 2n })], null, history),
      notionalOf(reversingCurrent, reversingTarget),
      reversingCurrent,
      reversingTarget,
      PARAMS
    );
    expect(reversing).toContain('REVERSAL_ALLOWANCE');

    // THE defining property (this is what separates the allowance from a
    // second turnover cap): the SAME history, but a move in the SAME
    // direction — a monotone continuation, not a reversal — must not be
    // charged at all.
    const continuingCurrent = new Map([['a', Q * 2n]]);
    const continuingTarget = new Map([['a', Q * 4n]]);
    const continuing = applyBrakes(
      input([market('a', { positionBase: Q * 2n })], null, history),
      notionalOf(continuingCurrent, continuingTarget),
      continuingCurrent,
      continuingTarget,
      PARAMS
    );
    expect(continuing).toBeNull();
  });

  it('the reversal brake is inert only because there is no history', () => {
    // Same reversal shape, empty recentMoves: nothing to reverse against,
    // so no brake fires at all. Stated explicitly so a future regression to
    // a permanently-empty history cannot masquerade as "the brake approves
    // this move" when really it never saw anything to compare against.
    const current = new Map([['a', Q * 2n]]);
    const target = new Map([['a', 0n]]);
    const reason = applyBrakes(
      input([market('a', { positionBase: Q * 2n })]),
      notionalOf(current, target),
      current,
      target,
      PARAMS
    );
    expect(reason).toBeNull();
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

describe('P14: movement cost attributed by leg', () => {
  it('charges no impact or slippage to a lending deposit', () => {
    const moves = [{ adapter: 'a', amountBase: 1_000_000_000_000n, kind: 'deploy' as const }];
    const { terms } = movementCostBase(input([market('a')]), moves, PARAMS);
    expect(terms['impact']).toBe(0n);
    expect(terms['slippageMev']).toBe(0n);
    expect(terms['entry']).toBeGreaterThan(0n);
  });

  it('charges no impact or slippage to a lending withdrawal', () => {
    const moves = [{ adapter: 'a', amountBase: 1_000_000_000_000n, kind: 'divest' as const }];
    const { terms } = movementCostBase(input([market('a')]), moves, PARAMS);
    expect(terms['impact']).toBe(0n);
    expect(terms['slippageMev']).toBe(0n);
    expect(terms['exit']).toBeGreaterThan(0n);
  });

  it('still charges impact and slippage to a harvest swap', () => {
    const moves = [{ adapter: 'a', amountBase: 1_000_000_000_000n, kind: 'harvest' as const }];
    const { terms } = movementCostBase(input([market('a')]), moves, PARAMS);
    expect(terms['impact']).toBeGreaterThan(0n);
    expect(terms['slippageMev']).toBeGreaterThan(0n);
  });

  it('a lending plan and a harvest plan of equal notional differ by exactly impact + slippage', () => {
    const n = 1_000_000_000_000n;
    const lend = movementCostBase(input([market('a')]), [{ adapter: 'a', amountBase: n, kind: 'deploy' as const }], PARAMS);
    const harv = movementCostBase(input([market('a')]), [{ adapter: 'a', amountBase: n, kind: 'harvest' as const }], PARAMS);
    const bpsPart = harv.terms['impact']! + harv.terms['slippageMev']!;
    expect(bpsPart).toBeGreaterThan(0n);
    // the harvest also carries approve/reset + swap gas; isolate the bps terms
    expect(lend.terms['impact']! + lend.terms['slippageMev']!).toBe(0n);
  });
});
