import { MOVE_COST_TERMS, movementCostBase, noTradeBandBase, costGate } from '../../../src/policy/steps/cost.js';
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

function input(markets: MarketObservation[], lastActionSeconds: number | null = null): DecisionInput {
  return {
    origin: { blockNumber: 1, blockHash: '0xb', timestampSeconds: 1_000_000, finalized: true },
    vault: {
      totalAssetsBase: 10_000_000_000n, idleBase: 10_000_000_000n, sharesOutstanding: 10n ** 10n,
      adminReserveBase: 0n, dynamicReserveBase: 0n, minIdleBps: 0, paused: false, configurationDigest: '0xv',
    },
    markets, dependencyGroups: [], withdrawals: [],
    gas: {
      l2BaseFeeWei: 5_000_000n,          // 0.005 gwei, typical Base
      l1BaseFeeWei: 8_000_000_000n,      // 8 gwei on L1
      l1BlobBaseFeeWei: 1n,
      ethUsdE8: 350_000_000_000n,        // $3,500
      usdcUsdE8: 100_000_000n,           // $1.00
    },
    history: [], lastAction: { timestampSeconds: lastActionSeconds, turnoverWindowBase: 0n },
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
  slippageBps: 5,
  mevBps: 1,
  impactBps: 2,
  failureRateBps: 50,
  bufferBps: 100,
  gasPerAction: 250_000n,
  l1BytesPerAction: 2_000n,
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
