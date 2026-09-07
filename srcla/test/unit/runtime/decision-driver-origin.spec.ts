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
  };
}

function fakeCollector(snap: CollectedSnapshot | null): SnapshotCollector {
  return { collect: async () => snap } as unknown as SnapshotCollector;
}

/** Records the `orderBy`/`take` args each findMany call received, and always
 *  resolves to an empty page — this test only cares about what was asked
 *  for, not about row shaping (covered elsewhere). */
function fakePrisma(): { prisma: PrismaClient; calls: { model: string; args: unknown }[] } {
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
  } as unknown as PrismaClient;
  return { prisma, calls };
}

describe('buildRawOriginFromCollector', () => {
  it('returns null when the collector has no finalized snapshot', async () => {
    const out = await buildRawOriginFromCollector(fakeCollector(null), fakePrisma().prisma, GAS, {});
    expect(out).toBeNull();
  });

  it('defaults vault.configurationDigest to a well-formed 32-byte zero hash, not the malformed 0-length "0x"', async () => {
    // Whole-branch review, MEDIUM 6: '0x' is a 0-length BytesLike, not a
    // valid bytes32 -- plan.ts ABI-encodes this field as a fixed bytes32
    // and ethers throws on a 0-length value there. This test fails under
    // the pre-fix `?? '0x'` fallback (66 chars expected, 2 chars produced).
    const { prisma } = fakePrisma();
    const out = await buildRawOriginFromCollector(fakeCollector(fakeSnapshot()), prisma, GAS, {});
    expect(out).not.toBeNull();
    expect(out!.vault.configurationDigest).toBe('0x' + '00'.repeat(32));
    expect(out!.vault.configurationDigest).toHaveLength(66); // '0x' + 64 hex chars = a real bytes32
  });

  it('uses the supplied vault digest when chainConfigDigests provides one, instead of the zero sentinel', async () => {
    const { prisma } = fakePrisma();
    const realDigest = '0x' + 'cd'.repeat(32);
    const out = await buildRawOriginFromCollector(fakeCollector(fakeSnapshot()), prisma, GAS, { vault: realDigest });
    expect(out!.vault.configurationDigest).toBe(realDigest);
  });

  it('requests the most recent 5000 forecast labels (desc), not the oldest', async () => {
    // Whole-branch review, MEDIUM 6: `take: 5000` with `orderBy: asc`
    // returns the OLDEST 5000 rows once history exceeds the cap -- the
    // opposite of what a rolling window needs. This test fails under the
    // pre-fix `orderBy: { horizonEndsAt: 'asc' }`.
    const { prisma, calls } = fakePrisma();
    await buildRawOriginFromCollector(fakeCollector(fakeSnapshot()), prisma, GAS, {});
    const call = calls.find((c) => c.model === 'forecastLabel');
    expect(call).toBeDefined();
    expect((call!.args as { orderBy: { horizonEndsAt: string } }).orderBy).toEqual({ horizonEndsAt: 'desc' });
    expect((call!.args as { take: number }).take).toBe(5000);
  });

  it('requests the most recent 5000 withdrawal events (desc), not the oldest', async () => {
    const { prisma, calls } = fakePrisma();
    await buildRawOriginFromCollector(fakeCollector(fakeSnapshot()), prisma, GAS, {});
    const call = calls.find((c) => c.model === 'withdrawalEvent');
    expect(call).toBeDefined();
    expect((call!.args as { orderBy: { timestamp: string } }).orderBy).toEqual({ timestamp: 'desc' });
    expect((call!.args as { take: number }).take).toBe(5000);
  });
});
