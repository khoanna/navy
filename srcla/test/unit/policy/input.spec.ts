import { buildDecisionInput, filterUsableLabels } from '../../../src/policy/input.js';
import type {
  CompletedLabel,
  GasObservation,
  MarketObservation,
  PolicyArtifact,
  WithdrawalObservation,
} from '../../../src/policy/types.js';

const ORIGIN = 1_000_000;

const artifact = {
  availabilityLagSeconds: 600,
  minObservations: 1,
} as unknown as PolicyArtifact;

function label(over: Partial<CompletedLabel>): CompletedLabel {
  return {
    marketId: 'aave',
    regimeId: 'r1',
    originSeconds: ORIGIN - 100_000,
    horizonSeconds: 86_400,
    horizonEndSeconds: ORIGIN - 10_000,
    availableAtSeconds: ORIGIN - 5_000,
    realizedReturnWad: 1n,
    realizedMinCashBase: 1n,
    ...over,
  };
}

describe('filterUsableLabels — no-look-ahead barrier', () => {
  const regimes = { aave: 'r1' };

  it('keeps a label whose horizon ended and lag elapsed', () => {
    const kept = filterUsableLabels([label({})], ORIGIN, artifact, regimes);
    expect(kept).toHaveLength(1);
  });

  it('drops a label whose horizon has not ended', () => {
    const future = label({ horizonEndSeconds: ORIGIN + 1 });
    expect(filterUsableLabels([future], ORIGIN, artifact, regimes)).toHaveLength(0);
  });

  it('drops a label whose horizon ended exactly at origin but is not yet available', () => {
    const notYet = label({ horizonEndSeconds: ORIGIN, availableAtSeconds: ORIGIN + 1 });
    expect(filterUsableLabels([notYet], ORIGIN, artifact, regimes)).toHaveLength(0);
  });

  it('drops a label whose availability lag has not elapsed', () => {
    const lagged = label({ horizonEndSeconds: ORIGIN - 100, availableAtSeconds: ORIGIN - 100 });
    expect(filterUsableLabels([lagged], ORIGIN, artifact, regimes)).toHaveLength(0);
  });

  it('drops a label from a superseded configuration regime', () => {
    const stale = label({ regimeId: 'r0' });
    expect(filterUsableLabels([stale], ORIGIN, artifact, regimes)).toHaveLength(0);
  });

  it('admits a label when horizonEndSeconds equals origin exactly', () => {
    const atBoundary = label({ horizonEndSeconds: ORIGIN, availableAtSeconds: 999_000 });
    expect(filterUsableLabels([atBoundary], ORIGIN, artifact, regimes)).toHaveLength(1);
  });

  it('rejects a label when horizonEndSeconds exceeds origin by 1', () => {
    const justPastBoundary = label({ horizonEndSeconds: ORIGIN + 1, availableAtSeconds: 999_000 });
    expect(filterUsableLabels([justPastBoundary], ORIGIN, artifact, regimes)).toHaveLength(0);
  });

  it('admits a label when availability lag plus availableAtSeconds equals origin exactly', () => {
    const lagAtBoundary = label({ horizonEndSeconds: 999_500, availableAtSeconds: 999_400 });
    // 999_400 + 600 = 1_000_000 === ORIGIN
    expect(filterUsableLabels([lagAtBoundary], ORIGIN, artifact, regimes)).toHaveLength(1);
  });

  it('rejects a label when availability lag plus availableAtSeconds exceeds origin by 1', () => {
    const lagPastBoundary = label({ horizonEndSeconds: 999_500, availableAtSeconds: 999_401 });
    // 999_401 + 600 = 1_000_001 > ORIGIN
    expect(filterUsableLabels([lagPastBoundary], ORIGIN, artifact, regimes)).toHaveLength(0);
  });

  it('admits a label when no current regime is recorded for its market', () => {
    const emptyRegimes = {};
    const normal = label({});
    expect(filterUsableLabels([normal], ORIGIN, artifact, emptyRegimes)).toHaveLength(1);
  });

  it('straddles availability boundary and rejects half under randomised input', () => {
    const labels = Array.from({ length: 200 }, (_, i) =>
      label({ horizonEndSeconds: ORIGIN - 1_000, availableAtSeconds: ORIGIN - 700 + i })
    );
    const kept = filterUsableLabels(labels, ORIGIN, artifact, regimes);
    expect(kept.length).toBeGreaterThan(0); // the test must be capable of failing
    expect(kept.length).toBeLessThan(labels.length); // and must actually reject some
    for (const l of kept) {
      expect(l.horizonEndSeconds).toBeLessThanOrEqual(ORIGIN);
      expect(l.availableAtSeconds + artifact.availabilityLagSeconds).toBeLessThanOrEqual(ORIGIN);
    }
  });
});

describe('buildDecisionInput', () => {
  function rawOrigin(over: Partial<any>): any {
    const base: any = {
      origin: { blockNumber: 1000, blockHash: '0x123', timestampSeconds: ORIGIN, finalized: true },
      vault: {
        totalAssetsBase: 1000000n,
        idleBase: 500000n,
        sharesOutstanding: 1000000n,
        adminReserveBase: 0n,
        dynamicReserveBase: 0n,
        minIdleBps: 100,
        paused: false,
        configurationDigest: '0x456',
      },
      markets: [
        {
          marketId: 'aave',
          adapter: '0xaaa',
          protocol: 'aave' as const,
          cash: 1000n,
          borrows: 100n,
          reserves: 50n,
          supplyRateWad: 1000n,
          utilizationWad: 500n,
          positionBase: 500n,
          maxDeployableBase: 1000n,
          maxWithdrawableBase: 500n,
          configDigest: '0x789',
          regimeId: 'r1',
          paused: false,
          capBps: 100,
          absoluteCapBase: 10000000n,
          maxLossBps: 50,
          dependencyGroupIds: [],
        } as MarketObservation,
      ],
      dependencyGroups: [],
      withdrawals: [] as WithdrawalObservation[],
      gas: {
        l2BaseFeeWei: 1n,
        l1BaseFeeWei: 1n,
        l1BlobBaseFeeWei: 1n,
        ethUsdE8: 200000000n,
        usdcUsdE8: 100000000n,
      } as GasObservation,
      allLabels: [] as CompletedLabel[],
      lastAction: { timestampSeconds: null, turnoverWindowBase: 0n },
    };
    return { ...base, ...over };
  }

  it('excludes future-dated labels from history', () => {
    const futureLabel = label({ horizonEndSeconds: ORIGIN + 100 });
    const raw = rawOrigin({ allLabels: [futureLabel] });
    const decision = buildDecisionInput(raw, artifact);
    expect(decision.history).toHaveLength(0);
  });

  it('excludes withdrawals after origin from output', () => {
    const withdrawal: WithdrawalObservation = {
      timestampSeconds: ORIGIN + 100,
      assetsBase: 1000n,
    };
    const validWithdrawal: WithdrawalObservation = {
      timestampSeconds: ORIGIN - 100,
      assetsBase: 500n,
    };
    const raw = rawOrigin({ withdrawals: [withdrawal, validWithdrawal] });
    const decision = buildDecisionInput(raw, artifact);
    expect(decision.withdrawals).toHaveLength(1);
    expect(decision.withdrawals[0]?.assetsBase).toBe(500n);
  });

  it('sorts markets by marketId', () => {
    const markets: MarketObservation[] = [
      {
        marketId: 'zulu',
        adapter: '0xaaa',
        protocol: 'aave' as const,
        cash: 1000n,
        borrows: 100n,
        reserves: 50n,
        supplyRateWad: 1000n,
        utilizationWad: 500n,
        positionBase: 500n,
        maxDeployableBase: 1000n,
        maxWithdrawableBase: 500n,
        configDigest: '0x789',
        regimeId: 'r1',
        paused: false,
        capBps: 100,
        absoluteCapBase: 10000000n,
        maxLossBps: 50,
        dependencyGroupIds: [],
      } as MarketObservation,
      {
        marketId: 'alpha',
        adapter: '0xbbb',
        protocol: 'compound' as const,
        cash: 2000n,
        borrows: 200n,
        reserves: 100n,
        supplyRateWad: 1500n,
        utilizationWad: 600n,
        positionBase: 1000n,
        maxDeployableBase: 2000n,
        maxWithdrawableBase: 1000n,
        configDigest: '0xabc',
        regimeId: 'r2',
        paused: false,
        capBps: 200,
        absoluteCapBase: 20000000n,
        maxLossBps: 100,
        dependencyGroupIds: [],
      } as MarketObservation,
      {
        marketId: 'bravo',
        adapter: '0xccc',
        protocol: 'moonwell' as const,
        cash: 1500n,
        borrows: 150n,
        reserves: 75n,
        supplyRateWad: 1250n,
        utilizationWad: 550n,
        positionBase: 750n,
        maxDeployableBase: 1500n,
        maxWithdrawableBase: 750n,
        configDigest: '0xdef',
        regimeId: 'r1',
        paused: false,
        capBps: 150,
        absoluteCapBase: 15000000n,
        maxLossBps: 75,
        dependencyGroupIds: [],
      } as MarketObservation,
    ];
    const raw = rawOrigin({ markets });
    const decision = buildDecisionInput(raw, artifact);
    expect(decision.markets.map((m) => m.marketId)).toEqual(['alpha', 'bravo', 'zulu']);
  });

  it('sorts dependencyGroups by id', () => {
    const dependencyGroups = [
      { id: 'z-group', capBps: 100, absoluteCapBase: 1000000n, members: [] },
      { id: 'a-group', capBps: 50, absoluteCapBase: 500000n, members: [] },
      { id: 'm-group', capBps: 75, absoluteCapBase: 750000n, members: [] },
    ];
    const raw = rawOrigin({ dependencyGroups });
    const decision = buildDecisionInput(raw, artifact);
    expect(decision.dependencyGroups.map((g) => g.id)).toEqual(['a-group', 'm-group', 'z-group']);
  });
});
