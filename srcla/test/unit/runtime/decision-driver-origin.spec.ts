/**
 * Whole-branch review, MEDIUM 6: unit coverage for
 * `buildRawOriginFromCollector` (src/runtime/decision-driver.ts), which had
 * no unit test anywhere in the branch (only exercised through
 * `DecisionDriver.runCycle`'s injected `loadOrigin`, which bypasses this
 * function entirely). Uses minimal fakes for `SnapshotCollector` and
 * `PrismaClient` — only the methods this function actually calls — so it
 * runs with no database and no chain.
 */
import { buildRawOriginFromCollector } from '../../../src/runtime/decision-driver.js';
import type { SnapshotCollector } from '../../../src/collector/snapshot-collector.js';
import type { CollectedSnapshot } from '../../../src/collector/types.js';
import type { PrismaClient } from '@prisma/client';

const GAS = {
  l2BaseFeeWei: 5_000_000n,
  l1BaseFeeWei: 8_000_000_000n,
  l1BlobBaseFeeWei: 1n,
  ethUsdE8: 350_000_000_000n,
  usdcUsdE8: 100_000_000n,
};

/** §9.1 churn windows. Real values, not zeros: a zero window would make
 *  loadLastAction's query degenerate and hide a regression in it. */
const CHURN = {
  cooldownSeconds: 3600,
  turnoverWindowSeconds: 86_400,
  reversalWindowSeconds: 86_400,
};

function fakeSnapshot(): CollectedSnapshot {
  return {
    blockNumber: 12345,
    blockHash: '0x' + 'ab'.repeat(32),
    timestamp: new Date(1_000_000_000),
    vault: {
      totalAssets: 10_000_000_000n,
      synchronousLiquidity: 9_000_000_000n,
      idleBase: 1_000_000_000n,
      minIdleBps: 50n,
      paused: false,
      reserve: { admin: 0n, dynamic: 0n },
    },
    strategies: [],
    incomplete: false,
    missingMarkets: [],
  };
}

function fakeCollector(snap: CollectedSnapshot | null): SnapshotCollector {
  return { collect: async () => snap } as unknown as SnapshotCollector;
}

/** Records the `orderBy`/`take` args each findMany call received, and always
 *  resolves to an empty page — this test only cares about what was asked
 *  for, not about row shaping (covered elsewhere). */
function fakePrisma(decisions: unknown[] = []): { prisma: PrismaClient; calls: { model: string; args: unknown }[] } {
  const calls: { model: string; args: unknown }[] = [];
  const prisma = {
    forecastLabel: {
      findMany: async (args: unknown) => {
        calls.push({ model: 'forecastLabel', args });
        return [];
      },
    },
    withdrawalEvent: {
      findMany: async (args: unknown) => {
        calls.push({ model: 'withdrawalEvent', args });
        return [];
      },
    },
    decision: {
      findMany: async (args: unknown) => {
        calls.push({ model: 'decision', args });
        return decisions;
      },
    },
  } as unknown as PrismaClient;
  return { prisma, calls };
}

describe('buildRawOriginFromCollector', () => {
  it('returns null when the collector has no finalized snapshot', async () => {
    const out = await buildRawOriginFromCollector(fakeCollector(null), fakePrisma().prisma, GAS, {}, CHURN);
    expect(out).toBeNull();
  });

  it('defaults vault.configurationDigest to a well-formed 32-byte zero hash, not the malformed 0-length "0x"', async () => {
    // Whole-branch review, MEDIUM 6: '0x' is a 0-length BytesLike, not a
    // valid bytes32 -- plan.ts ABI-encodes this field as a fixed bytes32
    // and ethers throws on a 0-length value there. This test fails under
    // the pre-fix `?? '0x'` fallback (66 chars expected, 2 chars produced).
    const { prisma } = fakePrisma();
    const out = await buildRawOriginFromCollector(fakeCollector(fakeSnapshot()), prisma, GAS, {}, CHURN);
    expect(out).not.toBeNull();
    expect(out!.vault.configurationDigest).toBe('0x' + '00'.repeat(32));
    expect(out!.vault.configurationDigest).toHaveLength(66); // '0x' + 64 hex chars = a real bytes32
  });

  it('uses the supplied vault digest when chainConfigDigests provides one, instead of the zero sentinel', async () => {
    const { prisma } = fakePrisma();
    const realDigest = '0x' + 'cd'.repeat(32);
    const out = await buildRawOriginFromCollector(fakeCollector(fakeSnapshot()), prisma, GAS, { vault: realDigest }, CHURN);
    expect(out!.vault.configurationDigest).toBe(realDigest);
  });

  it('requests the most recent 5000 forecast labels (desc), not the oldest', async () => {
    // Whole-branch review, MEDIUM 6: `take: 5000` with `orderBy: asc`
    // returns the OLDEST 5000 rows once history exceeds the cap -- the
    // opposite of what a rolling window needs. This test fails under the
    // pre-fix `orderBy: { horizonEndsAt: 'asc' }`.
    const { prisma, calls } = fakePrisma();
    await buildRawOriginFromCollector(fakeCollector(fakeSnapshot()), prisma, GAS, {}, CHURN);
    const call = calls.find((c) => c.model === 'forecastLabel');
    expect(call).toBeDefined();
    expect((call!.args as { orderBy: { horizonEndsAt: string } }).orderBy).toEqual({ horizonEndsAt: 'desc' });
    expect((call!.args as { take: number }).take).toBe(5000);
  });

  it('requests the most recent 5000 withdrawal events (desc), not the oldest', async () => {
    const { prisma, calls } = fakePrisma();
    await buildRawOriginFromCollector(fakeCollector(fakeSnapshot()), prisma, GAS, {}, CHURN);
    const call = calls.find((c) => c.model === 'withdrawalEvent');
    expect(call).toBeDefined();
    expect((call!.args as { orderBy: { timestamp: string } }).orderBy).toEqual({ timestamp: 'desc' });
    expect((call!.args as { take: number }).take).toBe(5000);
  });

  it('refuses to build an origin from an INCOMPLETE snapshot (paper §12 row 1)', async () => {
    // A configured venue that could not be read is not the same as a venue
    // that is absent: deciding on the remainder would reallocate the whole
    // vault across a silently truncated market set. Before the collector
    // carried this flag there was no way for any consumer to tell.
    const snap = { ...fakeSnapshot(), incomplete: true, missingMarkets: ['Moonwell'] };
    const out = await buildRawOriginFromCollector(fakeCollector(snap), fakePrisma().prisma, GAS, {}, CHURN);
    expect(out).toBeNull();
  });

  it('does not even query the database for an incomplete snapshot', async () => {
    const snap = { ...fakeSnapshot(), incomplete: true, missingMarkets: ['Aave'] };
    const db = fakePrisma();
    await buildRawOriginFromCollector(fakeCollector(snap), db.prisma, GAS, {}, CHURN);
    expect(db.calls).toHaveLength(0);
  });

  it('carries each market\'s real borrows and reserves through to the origin', async () => {
    // These two were hardcoded `0n` here regardless of what the collector
    // reported, which is what admit.ts\'s NO_MARKET_DATA rule and the rate
    // simulator\'s utilization denominator both read.
    const snap: CollectedSnapshot = {
      ...fakeSnapshot(),
      strategies: [
        {
          address: '0x' + 'aa'.repeat(20),
          name: 'Moonwell',
          totalAssets: 3_000_000_000n,
          maxWithdrawable: 2_700_000_000n,
          maxDeployable: 9_000_000_000n,
          supplyRate: 33_000_000_000_000_000n,
          utilization: 777_777_777_777_777_777n,
          cash: 300_000_000n,
          borrows: 700_000_000n,
          reserves: 100_000_000n,
          paused: false,
          configDigest: '0x' + 'd3'.repeat(32),
        },
      ],
    };

    const out = await buildRawOriginFromCollector(fakeCollector(snap), fakePrisma().prisma, GAS, {}, CHURN);

    expect(out!.markets[0]!.borrows).toBe(700_000_000n);
    expect(out!.markets[0]!.reserves).toBe(100_000_000n);
    expect(out!.markets[0]!.cash).toBe(300_000_000n);
    expect(out!.markets[0]!.supplyRateWad).toBe(33_000_000_000_000_000n);
    expect(out!.markets[0]!.utilizationWad).toBe(777_777_777_777_777_777n);
  });

  it('reads deployable headroom from maxDeployable, not maxWithdrawable', async () => {
    // The deployable half of the cold-start deadlock (audit NEW-11): the
    // adapter's `maxWithdrawable()` is min(position, cash) and is 0 for a
    // venue the vault has not entered, so reusing it as headroom made
    // `admit.ts`'s CAP_ZERO reject every empty venue.
    const snap: CollectedSnapshot = {
      ...fakeSnapshot(),
      strategies: [
        {
          address: '0x' + 'bb'.repeat(20),
          name: 'Aave',
          totalAssets: 0n,
          maxWithdrawable: 0n,
          maxDeployable: 12_000_000_000n,
          supplyRate: 41_000_000_000_000_000n,
          utilization: 500_000_000_000_000_000n,
          cash: 400_000_000n,
          borrows: 400_000_000n,
          reserves: 0n,
          paused: false,
          configDigest: '0x' + 'd4'.repeat(32),
        },
      ],
    };

    const out = await buildRawOriginFromCollector(fakeCollector(snap), fakePrisma().prisma, GAS, {}, CHURN);
    expect(out!.markets[0]!.maxDeployableBase).toBe(12_000_000_000n);
    // ...and the empty venue still reports a positive deployable headroom.
    expect(out!.markets[0]!.positionBase).toBe(0n);
    expect(out!.markets[0]!.maxDeployableBase).toBeGreaterThan(0n);
  });
});

/**
 * Readiness audit NEW-19. `buildRawOriginFromCollector` hardcoded
 * `lastAction: { timestampSeconds: null, turnoverWindowBase: 0n }`, so
 * §9.1's cooldown (guarded on `timestampSeconds !== null`) never fired in
 * production and the rolling max-turnover window was permanently empty.
 * These are the tests a return to that hardcode has to survive, and cannot.
 */
describe('buildRawOriginFromCollector feeds §9.1 churn state from persisted decisions', () => {
  const snapshotSeconds = Math.floor(new Date(1_000_000_000).getTime() / 1000);

  const rebalanceRow = (ageSeconds: number, moves: Array<[string, string]>) => ({
    timestamp: new Date((snapshotSeconds - ageSeconds) * 1000),
    actionDecision: {
      action: 'rebalance',
      planId: '0x' + 'a'.repeat(64),
      reasons: ['REBALANCE'],
      moves: moves.map(([marketId, deltaBase]) => ({ marketId, deltaBase })),
    },
  });

  it('derives a non-null cooldown timestamp from a past rebalance', async () => {
    const db = fakePrisma([rebalanceRow(600, [['Aave', '2000000000']])]);
    const out = await buildRawOriginFromCollector(fakeCollector(fakeSnapshot()), db.prisma, GAS, {}, CHURN);
    expect(out!.lastAction.timestampSeconds).toBe(snapshotSeconds - 600);
  });

  it('derives the rolling turnover window from those rows', async () => {
    const db = fakePrisma([
      rebalanceRow(600, [['Aave', '2000000000'], ['Compound', '-500000000']]),
      rebalanceRow(7200, [['Moonwell', '1000000000']]),
    ]);
    const out = await buildRawOriginFromCollector(fakeCollector(fakeSnapshot()), db.prisma, GAS, {}, CHURN);
    expect(out!.lastAction.turnoverWindowBase).toBe(3_500_000_000n);
  });

  it('derives the signed recent moves the reversal allowance reads', async () => {
    const db = fakePrisma([rebalanceRow(600, [['Aave', '-2000000000']])]);
    const out = await buildRawOriginFromCollector(fakeCollector(fakeSnapshot()), db.prisma, GAS, {}, CHURN);
    expect(out!.lastAction.recentMoves).toEqual([
      { marketId: 'Aave', deltaBase: -2_000_000_000n, timestampSeconds: snapshotSeconds - 600 },
    ]);
  });

  it('leaves the state neutral when the only history is a HOLD', async () => {
    const db = fakePrisma([
      { timestamp: new Date((snapshotSeconds - 600) * 1000), actionDecision: { action: 'hold', planId: null } },
    ]);
    const out = await buildRawOriginFromCollector(fakeCollector(fakeSnapshot()), db.prisma, GAS, {}, CHURN);
    expect(out!.lastAction).toEqual({ timestampSeconds: null, turnoverWindowBase: 0n, recentMoves: [] });
  });

  it('queries the longest of the three churn horizons, not the shortest', async () => {
    // A cooldown longer than either rolling window must still see its own
    // history; querying the shortest horizon would silently truncate it.
    const db = fakePrisma();
    await buildRawOriginFromCollector(fakeCollector(fakeSnapshot()), db.prisma, GAS, {}, {
      cooldownSeconds: 7 * 86_400,
      turnoverWindowSeconds: 3600,
      reversalWindowSeconds: 3600,
    });
    const call = db.calls.find((c) => c.model === 'decision');
    const where = (call!.args as { where: { timestamp: { gt: Date; lte: Date } } }).where;
    expect(where.timestamp.gt).toEqual(new Date((snapshotSeconds - 7 * 86_400) * 1000));
    expect(where.timestamp.lte).toEqual(new Date(snapshotSeconds * 1000));
  });
});

// ---------------------------------------------------------------------------
// The LIVE rate-model seam (E1b, 2026-09-10, GAP 2)
//
// `buildRawOriginFromCollector` populated NEITHER `irmParams` nor
// `aaveIrmParams`, so the production keeper path ran every venue through
// `DefaultConfigs` on every cycle -- Aave through the placeholder that E1
// removed from the OFFLINE path only, Compound and Moonwell through
// placeholders measured at 7.5689 pp and 7.2538 pp MAE against the archive's
// own stored supply rates. `RateCurve.points` feeds `rateAt` ->
// `annualLowerBound` -> both movement hurdles, so that is a wrong deployment
// and rotation decision with real funds behind it.
//
// These tests are an INTEGRATION-LEVEL observation of the fix: they run the
// real `buildRawOriginFromCollector` output through the real
// `simulateCurves` and watch what `console.warn` does -- the placeholder
// warning is the mechanism that makes a fallback impossible to miss, so
// "does it fire" is the honest question, not "is the field set".
// ---------------------------------------------------------------------------

import { jest } from '@jest/globals';
import { simulateCurves, __resetPlaceholderConfigWarnings } from '../../../src/policy/steps/simulate.js';
import { irmSeamFor } from '../../../src/runtime/decision-driver.js';
import type { DecisionInput } from '../../../src/policy/types.js';
import type { StrategySnapshot, VenueIrmReading } from '../../../src/collector/types.js';

const RAY = 10n ** 27n;

/** Comet USDC's real shape: a SUPPLY curve, reserve factor 0 by design. */
const COMPOUND_IRM: VenueIrmReading = {
  address: '0xb125E6687d4313864e53df431d5425969c15Eb2F',
  baseRateWad: 0n,
  kinkRay: (RAY * 90n) / 100n,
  slopeLowWad: 54_036_986_297_479_200n,
  slopeHighWad: 3_036_078_082_168_372_800n,
  reserveFactorBps: 0,
};
/** mUSDC's real shape: a BORROW curve plus the reserve cut. */
const MOONWELL_IRM: VenueIrmReading = {
  address: '0x54dC357F7461BcEEE5BdbA80996f5CB7d7512445',
  baseRateWad: 0n,
  kinkRay: (RAY * 90n) / 100n,
  slopeLowWad: 61_041_780_821_613_600n,
  slopeHighWad: 9_006_164_383_533_832_800n,
  reserveFactorBps: 1500,
};
/** Aave's shape: two extra bounds, which is what tells the shapes apart. */
const AAVE_IRM: VenueIrmReading = {
  address: '0x86AB1C62A8bf868E1b3E1ab87d587Aba6fbCbDC5',
  baseRateWad: 0n,
  kinkRay: (RAY * 90n) / 100n,
  slopeLowWad: (47n * 10n ** 18n) / 1000n,
  slopeHighWad: (10n * 10n ** 18n) / 100n,
  reserveFactorBps: 1000,
  optimalUtilizationRay: (RAY * 90n) / 100n,
  maxUtilizationRay: RAY,
};

function strategy(name: string, irm?: VenueIrmReading): StrategySnapshot {
  const base: StrategySnapshot = {
    address: '0x' + name.toLowerCase().padEnd(40, '0').slice(0, 40),
    name,
    totalAssets: 1_000_000_000n,
    maxWithdrawable: 1_000_000_000n,
    maxDeployable: 10n ** 13n,
    supplyRate: (5n * 10n ** 18n) / 100n,
    utilization: (85n * 10n ** 18n) / 100n,
    cash: 500_000_000_000n,
    borrows: 2_833_333_333_333n,
    reserves: 0n,
    paused: false,
    configDigest: '0x' + 'cc'.repeat(32),
  };
  return irm ? { ...base, irm } : base;
}

function snapshotWith(strategies: StrategySnapshot[]): CollectedSnapshot {
  return { ...fakeSnapshot(), strategies };
}

/** The kernel fields `simulateCurves` reads, and nothing else. */
function kernelInput(markets: DecisionInput['markets']): DecisionInput {
  return {
    origin: { blockNumber: 1, blockHash: '0x' + '00'.repeat(32), timestampSeconds: 1_000, finalized: true },
    markets,
  } as unknown as DecisionInput;
}

describe('the live path simulates the observed rate model, not DefaultConfigs', () => {
  let warn = jest.spyOn(console, 'warn');

  beforeEach(() => {
    __resetPlaceholderConfigWarnings();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it('does NOT warn when the collector supplied a reading for every venue', async () => {
    const { prisma } = fakePrisma();
    const snap = snapshotWith([
      strategy('Aave', AAVE_IRM),
      strategy('Compound', COMPOUND_IRM),
      strategy('Moonwell', MOONWELL_IRM),
    ]);
    const out = await buildRawOriginFromCollector(fakeCollector(snap), prisma, GAS, {}, CHURN);

    // The seams are populated, in the shape each protocol's model takes.
    const byId = new Map(out!.markets.map((m) => [m.marketId, m]));
    expect(byId.get('Compound')!.irmParams).toBeDefined();
    expect(byId.get('Moonwell')!.irmParams!.reserveFactorBps).toBe(1500);
    expect(byId.get('Aave')!.aaveIrmParams).toBeDefined();
    expect(byId.get('Aave')!.irmParams).toBeUndefined();

    const curves = simulateCurves(
      kernelInput(out!.markets),
      ['Aave', 'Compound', 'Moonwell'],
      100_000_000_000n,
      3,
    );
    expect(curves).toHaveLength(3);
    // THE OBSERVATION: no placeholder warning fired for any venue.
    expect(warn).not.toHaveBeenCalled();
  });

  it('DOES warn, naming the market, for a venue whose reading is absent', async () => {
    const { prisma } = fakePrisma();
    // Moonwell's rate-model read failed at this block; the other two answered.
    const snap = snapshotWith([
      strategy('Aave', AAVE_IRM),
      strategy('Compound', COMPOUND_IRM),
      strategy('Moonwell'),
    ]);
    const out = await buildRawOriginFromCollector(fakeCollector(snap), prisma, GAS, {}, CHURN);
    expect(out!.markets.find((m) => m.marketId === 'Moonwell')!.irmParams).toBeUndefined();

    simulateCurves(kernelInput(out!.markets), ['Aave', 'Compound', 'Moonwell'], 100_000_000_000n, 3);

    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0]![0] as string;
    expect(message).toContain('PLACEHOLDER RATE MODEL');
    // Names the market -- a warning that does not say WHICH venue is on a
    // placeholder is not actionable.
    expect(message).toContain("market 'Moonwell'");
    expect(message).toContain('moonwell');
    // And says nothing about the two venues that ARE on real parameters.
    expect(message).not.toContain("market 'Compound'");
    expect(message).not.toContain("market 'Aave'");
  });

  it('the curve a real reading produces differs materially from the placeholder curve', async () => {
    // The warning proves the fallback is announced; this proves it MATTERS.
    const { prisma } = fakePrisma();
    const withIrm = await buildRawOriginFromCollector(
      fakeCollector(snapshotWith([strategy('Compound', COMPOUND_IRM)])),
      prisma, GAS, {}, CHURN,
    );
    const withoutIrm = await buildRawOriginFromCollector(
      fakeCollector(snapshotWith([strategy('Compound')])),
      prisma, GAS, {}, CHURN,
    );

    const observed = simulateCurves(kernelInput(withIrm!.markets), ['Compound'], 100_000_000_000n, 3)[0]!;
    const placeholder = simulateCurves(kernelInput(withoutIrm!.markets), ['Compound'], 100_000_000_000n, 3)[0]!;

    // Real Comet at ~85% utilization on these parameters pays ~4.6%; the
    // placeholder's 80% kink and 6.25% slope assert ~8.6%. `rateAt` reads
    // exactly these points, and `annualLowerBound` reads `rateAt`.
    expect(observed.points[0]).not.toBe(placeholder.points[0]);
    expect(placeholder.points[0]!).toBeGreaterThan((observed.points[0]! * 15n) / 10n);
  });

  it('irmSeamFor refuses an Aave reading that is missing its own bounds', () => {
    // Half of an Aave reading is not a Compound reading: routing it into
    // `irmParams` would make `resolveConfig` throw on every live cycle.
    const { optimalUtilizationRay: _o, ...noBounds } = AAVE_IRM;
    expect(irmSeamFor('Aave', noBounds)).toEqual({});
    expect(irmSeamFor('Aave', undefined)).toEqual({});
  });
});
