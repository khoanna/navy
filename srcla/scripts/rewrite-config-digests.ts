#!/usr/bin/env tsx
/**
 * Rewrite persisted `MarketSnapshot.configDigest` into the `identity|parameters`
 * form (see `src/domain/config-digest.ts`).
 *
 * WHY THIS EXISTS. The archive backfill originally emitted one combined
 * digest, which conflated §6.2's two distinct questions: "did the market's
 * implementation change?" (quarantine) and "did its parameters change?" (new
 * regime). With one string, `admit`'s CONFIG_DIGEST_MISMATCH pinned whatever
 * was in force on the calibration era's first day and every venue became
 * permanently inadmissible at its first governance rate change -- the first
 * end-to-end run realised 0.000% net APY for all seventeen policies.
 *
 * The digest is DERIVED, and every input is already persisted (irmAddress and
 * the four irm* coefficients, plus `paused`), so this repairs in place without
 * re-fetching a single block. It is idempotent: a row already carrying the
 * separator is left alone.
 *
 * Usage: DATABASE_URL=... pnpm exec tsx scripts/rewrite-config-digests.ts [--dry-run]
 */
import { PrismaClient } from '@prisma/client';
import { BASE, MARKET_IDS } from '../src/collector/archive/calls.js';
import { DIGEST_SEPARATOR } from '../src/domain/config-digest.js';

const MARKET_ADDRESS: Record<string, string> = {
  [MARKET_IDS.compound]: BASE.comet,
  [MARKET_IDS.aave]: BASE.aavePool,
  [MARKET_IDS.moonwell]: BASE.mToken,
};

const PROTOCOL: Record<string, string> = {
  [MARKET_IDS.compound]: 'compound',
  [MARKET_IDS.aave]: 'aave',
  [MARKET_IDS.moonwell]: 'moonwell',
};

function digestFor(row: {
  marketId: string;
  irmAddress: string | null;
  irmBaseRateWad: string | null;
  irmKinkRay: string | null;
  irmSlopeLowWad: string | null;
  irmSlopeHighWad: string | null;
  paused: boolean;
}): string | null {
  const protocol = PROTOCOL[row.marketId];
  const market = MARKET_ADDRESS[row.marketId];
  if (protocol === undefined || market === undefined) return null;

  const hasIrm =
    row.irmAddress !== null &&
    row.irmBaseRateWad !== null &&
    row.irmKinkRay !== null &&
    row.irmSlopeLowWad !== null &&
    row.irmSlopeHighWad !== null;

  const identity = [protocol, market.toLowerCase()].join(':');
  const params = hasIrm
    ? [
        (row.irmAddress ?? '').toLowerCase(),
        row.irmBaseRateWad, row.irmKinkRay, row.irmSlopeLowWad, row.irmSlopeHighWad,
        row.paused ? 'paused' : 'active',
      ].join(':')
    : `no-irm:${row.paused ? 'paused' : 'active'}`;
  return `${identity}${DIGEST_SEPARATOR}${params}`;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.marketSnapshot.findMany({
      // Not "lacks the separator": the format was revised once more after the
      // first repair (the rate-model address moved from the identity half to
      // the parameter half), so this must be able to re-run over rows that
      // already carry a separator. It is keyed on the row's data, so a row
      // already correct is rewritten to the same value.
      where: { blockNumber: { not: null } },
      select: {
        id: true, marketId: true, configDigest: true, paused: true,
        irmAddress: true, irmBaseRateWad: true, irmKinkRay: true,
        irmSlopeLowWad: true, irmSlopeHighWad: true,
      },
    });
    console.log(`[digests] ${rows.length} rows still on the combined format`);
    if (rows.length === 0) return;

    let rewritten = 0;
    let skipped = 0;
    // Group by the value being written so identical rows share one UPDATE.
    const byDigest = new Map<string, string[]>();
    for (const r of rows) {
      const next = digestFor(r);
      if (next === null) { skipped += 1; continue; }
      const list = byDigest.get(next) ?? [];
      list.push(r.id);
      byDigest.set(next, list);
    }

    console.log(`[digests] ${byDigest.size} distinct digests to write`);
    for (const [digest, ids] of byDigest) {
      if (!dryRun) {
        for (let i = 0; i < ids.length; i += 1000) {
          await prisma.marketSnapshot.updateMany({
            where: { id: { in: ids.slice(i, i + 1000) } },
            data: { configDigest: digest },
          });
        }
      }
      rewritten += ids.length;
    }
    console.log(`[digests] ${dryRun ? 'would rewrite' : 'rewrote'} ${rewritten}, skipped ${skipped}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('[digests] FAILED:', err);
  process.exit(1);
});
