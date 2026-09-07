import { admit } from '../../../src/policy/steps/admit.js';
import type { DecisionInput, MarketObservation, PolicyArtifact } from '../../../src/policy/types.js';

const WAD = 10n ** 18n;

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
    history: Array.from({ length: labelCount }, () => ({
      marketId: 'aave', regimeId: 'r1', originSeconds: 1, horizonSeconds: 604_800 as const,
      horizonEndSeconds: 2, availableAtSeconds: 3, realizedReturnWad: WAD, realizedMinCashBase: 1n,
    })),
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

  // Each of the six rules below is exercised in isolation: the fixture is a
  // "healthy market" (as in the first test) with exactly one field pushed to
  // violate that rule, so every other rule still passes. If a rule were
  // accidentally deleted from RULES, exactly its own test would go red.

  it('rejects a paused market on PAUSED alone', () => {
    const r = admit(input([market({ paused: true })]), artifact);
    expect(r.eligible).toEqual([]);
    expect(r.reasons.some((x) => x.code === 'PAUSED' && !x.passed)).toBe(true);
    for (const code of ['CONFIG_DIGEST_UNPINNED', 'REGIME_MIN_HISTORY', 'NO_SYNC_LIQUIDITY', 'CAP_ZERO', 'KINK_EXCEEDED']) {
      expect(r.reasons.some((x) => x.code === code && !x.passed)).toBe(false);
    }
  });

  it('rejects a market with insufficient post-regime history on REGIME_MIN_HISTORY alone', () => {
    const r = admit(input([market()], 5), artifact);
    expect(r.eligible).toEqual([]);
    expect(r.reasons.some((x) => x.code === 'REGIME_MIN_HISTORY' && !x.passed)).toBe(true);
    for (const code of ['PAUSED', 'CONFIG_DIGEST_UNPINNED', 'NO_SYNC_LIQUIDITY', 'CAP_ZERO', 'KINK_EXCEEDED']) {
      expect(r.reasons.some((x) => x.code === code && !x.passed)).toBe(false);
    }
  });

  it('counts only labels under the market\'s current regime toward REGIME_MIN_HISTORY', () => {
    // 40 labels exist but they're all tagged with a superseded regime ('r0'),
    // while the market is currently in 'r1' — none of them should count.
    const base = input([market()], 0);
    base.history = Array.from({ length: 40 }, () => ({
      marketId: 'aave', regimeId: 'r0', originSeconds: 1, horizonSeconds: 604_800 as const,
      horizonEndSeconds: 2, availableAtSeconds: 3, realizedReturnWad: WAD, realizedMinCashBase: 1n,
    }));
    const r = admit(base, artifact);
    expect(r.eligible).toEqual([]);
    expect(r.reasons.some((x) => x.code === 'REGIME_MIN_HISTORY' && !x.passed)).toBe(true);
  });

  it('rejects a market whose config digest is not the pinned one on CONFIG_DIGEST_UNPINNED alone', () => {
    const r = admit(input([market({ configDigest: '0xchanged' })]), artifact);
    expect(r.eligible).toEqual([]);
    expect(r.reasons.some((x) => x.code === 'CONFIG_DIGEST_UNPINNED' && !x.passed)).toBe(true);
    for (const code of ['PAUSED', 'REGIME_MIN_HISTORY', 'NO_SYNC_LIQUIDITY', 'CAP_ZERO', 'KINK_EXCEEDED']) {
      expect(r.reasons.some((x) => x.code === code && !x.passed)).toBe(false);
    }
  });

  it('rejects a market with no pinned digest registered on CONFIG_DIGEST_UNPINNED alone', () => {
    const r = admit(
      input([market({ marketId: 'unregistered' })]),
      artifact
    );
    expect(r.eligible).toEqual([]);
    expect(r.reasons.some((x) => x.marketId === 'unregistered' && x.code === 'CONFIG_DIGEST_UNPINNED' && !x.passed)).toBe(true);
  });

  it('rejects a market with no synchronous exit capacity on NO_SYNC_LIQUIDITY alone', () => {
    const r = admit(input([market({ maxWithdrawableBase: 0n, positionBase: 500n })]), artifact);
    expect(r.eligible).toEqual([]);
    expect(r.reasons.some((x) => x.code === 'NO_SYNC_LIQUIDITY' && !x.passed)).toBe(true);
    for (const code of ['PAUSED', 'CONFIG_DIGEST_UNPINNED', 'REGIME_MIN_HISTORY', 'CAP_ZERO', 'KINK_EXCEEDED']) {
      expect(r.reasons.some((x) => x.code === code && !x.passed)).toBe(false);
    }
  });

  it('rejects a market whose cap is zero on CAP_ZERO alone', () => {
    const r = admit(input([market({ capBps: 0 })]), artifact);
    expect(r.eligible).toEqual([]);
    expect(r.reasons.some((x) => x.code === 'CAP_ZERO' && !x.passed)).toBe(true);
    for (const code of ['PAUSED', 'CONFIG_DIGEST_UNPINNED', 'REGIME_MIN_HISTORY', 'NO_SYNC_LIQUIDITY', 'KINK_EXCEEDED']) {
      expect(r.reasons.some((x) => x.code === code && !x.passed)).toBe(false);
    }
  });

  it('rejects a market past its interest-rate kink on KINK_EXCEEDED alone', () => {
    const r = admit(input([market({ utilizationWad: (WAD * 995n) / 1000n })]), artifact);
    expect(r.eligible).toEqual([]);
    expect(r.reasons.some((x) => x.code === 'KINK_EXCEEDED' && !x.passed)).toBe(true);
    for (const code of ['PAUSED', 'CONFIG_DIGEST_UNPINNED', 'REGIME_MIN_HISTORY', 'NO_SYNC_LIQUIDITY', 'CAP_ZERO']) {
      expect(r.reasons.some((x) => x.code === code && !x.passed)).toBe(false);
    }
  });

  it('is deterministic and returns markets in sorted order', () => {
    // input()'s default history only covers 'aave' — give 'zz' its own
    // matching history too, otherwise it would fail REGIME_MIN_HISTORY and
    // this test would prove nothing about ordering.
    const base = input([market({ marketId: 'zz', adapter: '0xz' }), market()]);
    base.history = [
      ...base.history,
      ...Array.from({ length: 40 }, () => ({
        marketId: 'zz', regimeId: 'r1', originSeconds: 1, horizonSeconds: 604_800 as const,
        horizonEndSeconds: 2, availableAtSeconds: 3, realizedReturnWad: WAD, realizedMinCashBase: 1n,
      })),
    ];
    const r = admit(base, {
      ...artifact,
      pinnedConfigDigests: { aave: '0xdigest', zz: '0xdigest' },
    });
    expect(r.eligible).toEqual(['aave', 'zz']);
  });
});
