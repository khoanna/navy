import { admit } from '../../../src/policy/steps/admit.js';
import type { DecisionInput, MarketObservation, PolicyArtifact } from '../../../src/policy/types.js';

const WAD = 10n ** 18n;

const ALL_CODES = [
  'PAUSED',
  'CONFIG_DIGEST_UNPINNED',
  'REGIME_MIN_HISTORY',
  'NO_MARKET_DATA',
  'NO_SYNC_LIQUIDITY',
  'CAP_ZERO',
  'KINK_EXCEEDED',
  'DEPENDENCY_UNREGISTERED',
];

function otherCodes(exclude: string): string[] {
  return ALL_CODES.filter((c) => c !== exclude);
}

function expectOnlyCodeFails(reasons: { code: string; passed: boolean }[], code: string) {
  expect(reasons.some((x) => x.code === code && !x.passed)).toBe(true);
  for (const other of otherCodes(code)) {
    expect(reasons.some((x) => x.code === other && !x.passed)).toBe(false);
  }
}

function market(over: Partial<MarketObservation> = {}): MarketObservation {
  return {
    marketId: 'aave', adapter: '0xa', protocol: 'aave',
    cash: 1_000_000_000n, borrows: 500_000_000n, reserves: 0n,
    supplyRateWad: WAD / 100n, utilizationWad: (WAD * 50n) / 100n,
    positionBase: 0n, maxDeployableBase: 1_000_000_000n, maxWithdrawableBase: 1_000_000_000n,
    configDigest: '0xdigest', regimeId: 'r1', paused: false,
    capBps: 5000, absoluteCapBase: 10n ** 12n, maxLossBps: 50, dependencyGroupIds: [],
    ...over,
  };
}

function labelsFor(marketId: string, regimeId: string, count: number) {
  return Array.from({ length: count }, () => ({
    marketId, regimeId, originSeconds: 1, horizonSeconds: 604_800 as const,
    horizonEndSeconds: 2, availableAtSeconds: 3, realizedReturnWad: WAD, realizedMinCashBase: 1n,
  }));
}

function input(markets: MarketObservation[], labelCount = 40): DecisionInput {
  return {
    origin: { blockNumber: 1, blockHash: '0xb', timestampSeconds: 1_000_000, finalized: true },
    vault: {
      totalAssetsBase: 10n ** 12n, idleBase: 10n ** 11n, sharesOutstanding: 10n ** 12n,
      adminReserveBase: 0n, dynamicReserveBase: 0n, minIdleBps: 50,
      paused: false, configurationDigest: '0xvault',
    },
    markets, dependencyGroups: [], withdrawals: [],
    gas: { l2BaseFeeWei: 1n, l1BaseFeeWei: 1n, l1BlobBaseFeeWei: 1n, ethUsdE8: 350_000_000_000n, usdcUsdE8: 100_000_000n },
    history: labelsFor('aave', 'r1', labelCount),
    lastAction: { timestampSeconds: null, turnoverWindowBase: 0n },
  };
}

const artifact: PolicyArtifact = {
  artifactHash: '0xartifact',
  policyVersion: 1,
  horizonSeconds: 604_800,
  coverageTarget: 0.95,
  method: 'rolling',
  methodParams: {},
  residualQuantileWadByMarket: {},
  portfolioResidualQuantileWad: 0n,
  minObservations: 30,
  availabilityLagSeconds: 0,
  noTradeBandK: 1,
  configDigest: '0xartifact',
  pinnedConfigDigests: { aave: '0xdigest' },
};

describe('admit', () => {
  it('admits a healthy market', () => {
    const r = admit(input([market()]), artifact);
    expect(r.eligible).toEqual(['aave']);
  });

  // Each of the seven rules below is exercised in isolation: the fixture is a
  // "healthy market" (as in the first test) with exactly one field pushed to
  // violate that rule, so every other rule still passes. If a rule were
  // accidentally deleted from RULES, exactly its own test would go red.

  it('rejects a paused market on PAUSED alone', () => {
    const r = admit(input([market({ paused: true })]), artifact);
    expect(r.eligible).toEqual([]);
    expectOnlyCodeFails(r.reasons, 'PAUSED');
  });

  it('rejects a market with insufficient post-regime history on REGIME_MIN_HISTORY alone', () => {
    const r = admit(input([market()], 5), artifact);
    expect(r.eligible).toEqual([]);
    expectOnlyCodeFails(r.reasons, 'REGIME_MIN_HISTORY');
  });

  it('counts only labels under the market\'s current regime toward REGIME_MIN_HISTORY', () => {
    // 40 labels exist but they're all tagged with a superseded regime ('r0'),
    // while the market is currently in 'r1' — none of them should count.
    const base = input([market()], 0);
    base.history = labelsFor('aave', 'r0', 40);
    const r = admit(base, artifact);
    expect(r.eligible).toEqual([]);
    expectOnlyCodeFails(r.reasons, 'REGIME_MIN_HISTORY');
  });

  it('rejects a market whose config digest is not the pinned one on CONFIG_DIGEST_UNPINNED alone', () => {
    const r = admit(input([market({ configDigest: '0xchanged' })]), artifact);
    expect(r.eligible).toEqual([]);
    expectOnlyCodeFails(r.reasons, 'CONFIG_DIGEST_UNPINNED');
  });

  it('rejects a market with no pinned digest registered on CONFIG_DIGEST_UNPINNED alone', () => {
    // marketId 'unregistered' has no entry in artifact.pinnedConfigDigests.
    // Give it its own matching history so REGIME_MIN_HISTORY doesn't also
    // fire and mask which rule is actually being tested.
    const base = input([market({ marketId: 'unregistered' })], 0);
    base.history = labelsFor('unregistered', 'r1', 40);
    const r = admit(base, artifact);
    expect(r.eligible).toEqual([]);
    expect(
      r.reasons.some((x) => x.marketId === 'unregistered' && x.code === 'CONFIG_DIGEST_UNPINNED' && !x.passed)
    ).toBe(true);
    for (const other of otherCodes('CONFIG_DIGEST_UNPINNED')) {
      expect(r.reasons.some((x) => x.marketId === 'unregistered' && x.code === other && !x.passed)).toBe(false);
    }
  });

  it('rejects a market with zero rate, zero cash and zero borrows on NO_MARKET_DATA alone — whole-branch review, Critical 3', () => {
    // This is exactly what snapshot-collector.ts's collectStrategy reports
    // for every market today (supplyRate/utilization/cash hardcoded to 0n,
    // "Would need protocol-specific calls"). Catches a regression where
    // this rule is removed or narrowed, letting a data-less market flow
    // through admission and produce a decision that looks considered.
    // positionBase/maxWithdrawableBase kept non-zero so NO_SYNC_LIQUIDITY
    // (which also reacts to cash=0n at zero position) does not also fire —
    // this isolates NO_MARKET_DATA as the only failing rule.
    const r = admit(
      input([market({ supplyRateWad: 0n, cash: 0n, borrows: 0n, positionBase: 500n, maxWithdrawableBase: 500n })]),
      artifact
    );
    expect(r.eligible).toEqual([]);
    expectOnlyCodeFails(r.reasons, 'NO_MARKET_DATA');
  });

  it('admits a market with a genuinely zero rate as long as cash or borrows is non-zero — NO_MARKET_DATA requires all three', () => {
    // A real venue can legitimately have a 0% supply rate; that alone must
    // not be mistaken for "the collector returned nothing". Only the
    // rate+cash+borrows-all-zero combination is treated as no-data.
    const r = admit(input([market({ supplyRateWad: 0n })]), artifact);
    expect(r.eligible).toEqual(['aave']);
  });

  it('rejects a market with no synchronous exit capacity (existing position) on NO_SYNC_LIQUIDITY alone', () => {
    const r = admit(input([market({ maxWithdrawableBase: 0n, positionBase: 500n })]), artifact);
    expect(r.eligible).toEqual([]);
    expectOnlyCodeFails(r.reasons, 'NO_SYNC_LIQUIDITY');
  });

  it('rejects a market with no protocol cash to enter at zero position on NO_SYNC_LIQUIDITY alone', () => {
    const r = admit(input([market({ positionBase: 0n, cash: 0n })]), artifact);
    expect(r.eligible).toEqual([]);
    expectOnlyCodeFails(r.reasons, 'NO_SYNC_LIQUIDITY');
  });

  it('rejects a market whose fractional cap is zero on CAP_ZERO alone', () => {
    const r = admit(input([market({ capBps: 0 })]), artifact);
    expect(r.eligible).toEqual([]);
    expectOnlyCodeFails(r.reasons, 'CAP_ZERO');
  });

  it('rejects a market whose absolute cap is zero on CAP_ZERO alone', () => {
    const r = admit(input([market({ absoluteCapBase: 0n })]), artifact);
    expect(r.eligible).toEqual([]);
    expectOnlyCodeFails(r.reasons, 'CAP_ZERO');
  });

  it('rejects a market with zero deployable headroom on CAP_ZERO alone', () => {
    // Keep an existing position with non-zero maxWithdrawableBase so
    // NO_SYNC_LIQUIDITY doesn't also fire.
    const r = admit(input([market({ maxDeployableBase: 0n, positionBase: 500n })]), artifact);
    expect(r.eligible).toEqual([]);
    expectOnlyCodeFails(r.reasons, 'CAP_ZERO');
  });

  it('rejects a market past its interest-rate kink on KINK_EXCEEDED alone', () => {
    const r = admit(input([market({ utilizationWad: (WAD * 995n) / 1000n })]), artifact);
    expect(r.eligible).toEqual([]);
    expectOnlyCodeFails(r.reasons, 'KINK_EXCEEDED');
  });

  it('rejects a market whose dependency group is not registered on DEPENDENCY_UNREGISTERED alone', () => {
    const r = admit(input([market({ dependencyGroupIds: ['ghost'] })]), artifact);
    expect(r.eligible).toEqual([]);
    expectOnlyCodeFails(r.reasons, 'DEPENDENCY_UNREGISTERED');
  });

  it('admits a market whose declared dependency group IS registered', () => {
    const base = input([market({ dependencyGroupIds: ['g1'] })]);
    base.dependencyGroups = [{ id: 'g1', capBps: 5000, absoluteCapBase: 10n ** 12n, members: ['aave'] }];
    const r = admit(base, artifact);
    expect(r.eligible).toEqual(['aave']);
  });

  it('is deterministic and returns markets in sorted order', () => {
    // input()'s default history only covers 'aave' — give 'zz' its own
    // matching history too, otherwise it would fail REGIME_MIN_HISTORY and
    // this test would prove nothing about ordering.
    const base = input([market({ marketId: 'zz', adapter: '0xz' }), market()]);
    base.history = [...base.history, ...labelsFor('zz', 'r1', 40)];
    const r = admit(base, {
      ...artifact,
      pinnedConfigDigests: { aave: '0xdigest', zz: '0xdigest' },
    });
    expect(r.eligible).toEqual(['aave', 'zz']);
  });
});
