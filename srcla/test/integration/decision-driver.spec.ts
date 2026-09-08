import { DecisionDriver } from '../../src/runtime/decision-driver.js';
import { loadBootstrapArtifact } from '../../src/policy/artifact.js';
import { DEFAULT_DECIDE_OPTS } from '../../src/policy/decide.js';

const WAD = 10n ** 18n;

const rawOrigin = {
  origin: { blockNumber: 1, blockHash: '0x' + 'ab'.repeat(32), timestampSeconds: 1_000_000, finalized: true as const },
  vault: {
    totalAssetsBase: 10_000_000_000n, idleBase: 10_000_000_000n, sharesOutstanding: 10n ** 10n,
    adminReserveBase: 0n, dynamicReserveBase: 0n, minIdleBps: 0, paused: false,
    configurationDigest: '0x' + 'cd'.repeat(32),
  },
  markets: [{
    marketId: 'aa', adapter: '0x' + 'aa'.repeat(20), protocol: 'aave' as const,
    cash: 10n ** 12n, borrows: 0n, reserves: 0n,
    supplyRateWad: WAD / 100n, utilizationWad: 0n,
    positionBase: 0n, maxDeployableBase: 10n ** 12n, maxWithdrawableBase: 10n ** 12n,
    configDigest: '0xd', regimeId: 'r1', paused: false,
    capBps: 10000, absoluteCapBase: 10n ** 13n, maxLossBps: 50, dependencyGroupIds: [],
  }],
  dependencyGroups: [], withdrawals: [],
  gas: { l2BaseFeeWei: 5_000_000n, l1BaseFeeWei: 8_000_000_000n, l1BlobBaseFeeWei: 1n, ethUsdE8: 350_000_000_000n, usdcUsdE8: 100_000_000n },
  allLabels: Array.from({ length: 40 }, () => ({
    marketId: 'aa', regimeId: 'r1', originSeconds: 1, horizonSeconds: 604_800 as const,
    horizonEndSeconds: 2, availableAtSeconds: 3, realizedReturnWad: WAD, realizedMinCashBase: 1n,
  })),
  lastAction: { timestampSeconds: null, turnoverWindowBase: 0n, recentMoves: [] },
};

describe('DecisionDriver', () => {
  it('returns null when the origin source yields nothing', async () => {
    const driver = new DecisionDriver({
      loadOrigin: async () => null,
      artifact: { ...loadBootstrapArtifact(), pinnedConfigDigests: { aa: '0xd' } },
      opts: DEFAULT_DECIDE_OPTS,
      persist: async () => {},
    });
    expect(await driver.runCycle()).toBeNull();
  });

  it('produces a decision with a stable hash across two identical cycles', async () => {
    const persisted: string[] = [];
    const driver = new DecisionDriver({
      loadOrigin: async () => rawOrigin,
      artifact: { ...loadBootstrapArtifact(), pinnedConfigDigests: { aa: '0xd' }, residualQuantileWadByMarket: { aa: 0n } },
      opts: DEFAULT_DECIDE_OPTS,
      persist: async (out) => { persisted.push(out.decisionHash); },
    });
    const a = await driver.runCycle();
    const b = await driver.runCycle();
    expect(a!.decisionHash).toBe(b!.decisionHash);
    expect(persisted).toHaveLength(2);
  });

  it('routes history through the look-ahead barrier', async () => {
    const withFuture = {
      ...rawOrigin,
      allLabels: [...rawOrigin.allLabels, {
        marketId: 'aa', regimeId: 'r1', originSeconds: 1, horizonSeconds: 604_800 as const,
        horizonEndSeconds: 2_000_000, availableAtSeconds: 2_000_000,
        realizedReturnWad: WAD * 1000n, realizedMinCashBase: 1n,
      }],
    };
    const artifact = { ...loadBootstrapArtifact(), pinnedConfigDigests: { aa: '0xd' }, residualQuantileWadByMarket: { aa: 0n } };
    const clean = new DecisionDriver({ loadOrigin: async () => rawOrigin, artifact, opts: DEFAULT_DECIDE_OPTS, persist: async () => {} });
    const dirty = new DecisionDriver({ loadOrigin: async () => withFuture, artifact, opts: DEFAULT_DECIDE_OPTS, persist: async () => {} });
    expect((await dirty.runCycle())!.decisionHash).toBe((await clean.runCycle())!.decisionHash);
  });
});
