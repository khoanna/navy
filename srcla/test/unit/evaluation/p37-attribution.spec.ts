/**
 * P37 (G3, implementing P34): an S2 breach is a VENUE FAILURE only when every
 * origin below the floor is explained by a position trapped in a venue with zero
 * withdrawable cash, the untrapped remainder stays at or above the floor, and
 * the run never deployed into a dry venue. Anything else is an ALLOCATOR ERROR
 * and blocks exactly as before. The registered v0.10 verdict never changes.
 */
import {
  attributeS2Breach,
  sustainabilityAtTier,
  REGISTERED_S2_COVERAGE_FLOOR,
} from '../../../src/evaluation/kernel/sustainability.js';
import type { PolicyRunResult } from '../../../src/evaluation/kernel/harness.js';
import { SRCLA_POLICY } from '../../../src/evaluation/kernel/registry.js';
import type { ReplaySnapshot } from '../../../src/evaluation/replay/replay.js';

/** 10,000 USDC in base units. */
const NAV = 10_000_000_000n;

function snap(over: Partial<ReplaySnapshot> = {}): ReplaySnapshot {
  return {
    timestamp: new Date(Date.UTC(2026, 7, 27)),
    totalAssets: NAV,
    totalShares: NAV,
    sharePriceWad: 10n ** 18n,
    totalReturn: 0,
    idleBase: 0n,
    stressedLiquidCoverage: 1,
    holdingsBaseByMarket: {},
    executedDeployBaseByMarket: {},
    dryMarketIds: [],
    untrappedStressedLiquidCoverage: 1,
    ...over,
  };
}

/** The Moonwell shape: 12% of NAV trapped in a venue with zero cash, the rest liquid. */
const trapped = (over: Partial<ReplaySnapshot> = {}): ReplaySnapshot =>
  snap({
    stressedLiquidCoverage: 0.878,
    dryMarketIds: ['moonwell-usdc'],
    holdingsBaseByMarket: { 'moonwell-usdc': 1_200_000_000n, 'aave-v3-usdc': 8_800_000_000n },
    untrappedStressedLiquidCoverage: 1,
    ...over,
  });

function run(snapshots: ReplaySnapshot[]): PolicyRunResult {
  const min = Math.min(...snapshots.map((s) => s.stressedLiquidCoverage));
  return {
    policy: SRCLA_POLICY,
    tier: NAV,
    decisionHashes: ['0xd'],
    rebalances: 1,
    inertVsSrcla: false,
    firstProposal: null,
    replay: {
      snapshots,
      realizedNetApy: 0.34,
      minStressedLiquidCoverage: min,
      coverageDistribution: { min, p05: min, median: 1 },
      withdrawalSuccessRate: 1,
      capitalAtWorkFraction: 0.943,
      timeToFullExitOrigins: 1,
      timeToFullExitCensored: false,
      venueStressContribution: { 'moonwell-usdc': 0.01 },
      displayedVsRealizedGapApy: 0,
      policyViolations: 0,
    },
  } as unknown as PolicyRunResult;
}

describe('P37 (G3): attributing an S2 breach', () => {
  it('a position trapped in a dry venue, with the rest liquid, is a VENUE FAILURE', () => {
    const a = attributeS2Breach([snap(), trapped(), trapped()]);
    expect(a.kind).toBe('VENUE FAILURE');
    expect(a.shortOrigins).toBe(2);
    expect(a.trappedShareMax).toBeCloseTo(0.12, 6);
    expect(a.untrappedCoverageMin).toBe(1);
  });

  it('one deploy leg into the dry venue makes it an ALLOCATOR ERROR', () => {
    const a = attributeS2Breach([
      snap(),
      trapped({ executedDeployBaseByMarket: { 'moonwell-usdc': 1n } }),
      trapped(),
    ]);
    expect(a.kind).toBe('ALLOCATOR ERROR');
    expect(a.detail).toMatch(/deployed into a venue with zero withdrawable cash/);
  });

  it('a deploy into a dry venue at an origin ABOVE the floor still counts', () => {
    const a = attributeS2Breach([
      snap({ dryMarketIds: ['moonwell-usdc'], executedDeployBaseByMarket: { 'moonwell-usdc': 5n } }),
      trapped(),
    ]);
    expect(a.kind).toBe('ALLOCATOR ERROR');
  });

  it('a shortfall on the untrapped part is an ALLOCATOR ERROR', () => {
    expect(attributeS2Breach([trapped({ untrappedStressedLiquidCoverage: 0.9 })]).kind).toBe(
      'ALLOCATOR ERROR',
    );
  });

  it('a short origin holding no dry venue is an ALLOCATOR ERROR', () => {
    expect(attributeS2Breach([snap({ stressedLiquidCoverage: 0.878 })]).kind).toBe('ALLOCATOR ERROR');
  });

  it('no snapshots cannot be attributed to a venue', () => {
    expect(attributeS2Breach([]).kind).toBe('ALLOCATOR ERROR');
  });
});

describe('P37 (G3): S2 under the amendment', () => {
  it('a VENUE FAILURE fails neither S2 nor the run under P37, and is reported', () => {
    const v = sustainabilityAtTier(run([snap(), trapped()]), { amendment: 'p37' });
    expect(v.s2).toBe(true);
    expect(v.sustainable).toBe(true);
    expect(v.s2Attribution?.kind).toBe('VENUE FAILURE');
  });

  it('the registered v0.10 verdict on the same run is unchanged: S2 fails', () => {
    const v = sustainabilityAtTier(run([snap(), trapped()]));
    expect(v.s2).toBe(false);
    expect(v.s2Attribution).toBeUndefined();
    expect(v.breach).toContain(`vs floor ${REGISTERED_S2_COVERAGE_FLOOR.toFixed(3)}`);
  });

  it('an ALLOCATOR ERROR still fails S2 under P37', () => {
    const v = sustainabilityAtTier(run([trapped({ untrappedStressedLiquidCoverage: 0.5 })]), {
      amendment: 'p37',
    });
    expect(v.s2).toBe(false);
    expect(v.sustainable).toBe(false);
    expect(v.s2Attribution?.kind).toBe('ALLOCATOR ERROR');
  });

  it('FAIL CLOSED: S2 failing at the run level with no origin below the floor in the snapshots (inconsistent data) is ALLOCATOR ERROR, never a pass', () => {
    // The run-level minStressedLiquidCoverage disagrees with every per-origin
    // snapshot (all at 1) — attributeS2Breach alone would see no short origin
    // and answer 'NO BREACH'. That must never surface as anything but a block.
    const inconsistent = {
      policy: SRCLA_POLICY,
      tier: NAV,
      decisionHashes: ['0xd'],
      rebalances: 1,
      inertVsSrcla: false,
      firstProposal: null,
      replay: {
        snapshots: [snap(), snap()],
        realizedNetApy: 0.34,
        minStressedLiquidCoverage: 0.878,
        coverageDistribution: { min: 0.878, p05: 0.878, median: 1 },
        withdrawalSuccessRate: 1,
        capitalAtWorkFraction: 0.943,
        timeToFullExitOrigins: 1,
        timeToFullExitCensored: false,
        venueStressContribution: { 'moonwell-usdc': 0.01 },
        displayedVsRealizedGapApy: 0,
        policyViolations: 0,
      },
    } as unknown as PolicyRunResult;

    const v = sustainabilityAtTier(inconsistent, { amendment: 'p37' });
    expect(v.s2).toBe(false);
    expect(v.sustainable).toBe(false);
    expect(v.s2Attribution?.kind).toBe('ALLOCATOR ERROR');
  });
});
