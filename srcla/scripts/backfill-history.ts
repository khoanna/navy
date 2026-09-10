#!/usr/bin/env tsx
/**
 * Backfill Base venue history into `MarketSnapshot` + `ChainCostSnapshot`.
 *
 * This is Phase 4's dataset. It reads Compound III, Aave V3 and Moonwell
 * DIRECTLY at historical blocks -- not through the Navy adapters, which exist
 * only on the Anvil fork -- at hourly origins across the registered eras.
 *
 * It is RESUMABLE: re-running the same command continues from what the
 * database already holds. It never substitutes a value; a venue it could not
 * read is reported as a gap and the origin is short by that venue, or skipped
 * entirely if no venue answered.
 *
 * Usage:
 *   DATABASE_URL=postgresql://user:password@localhost:5433/srcla \
 *     pnpm backfill:history [options]
 *
 *   --from <ISO>        default: the calibration era's start (2024-03-15)
 *   --to <ISO>          default: now
 *   --era <tag>         backfill exactly one registered era instead of --from/--to
 *   --cadence <s>       default 3600 (the paper's registered origin cadence)
 *   --concurrency <n>   default: the RPC pool's total capacity
 *   --limit <n>         stop after N new origins (smoke tests)
 *   --dry-run           decode and report without writing
 *
 * UNITS: money is bigint USDC base units (6 dp); rates WAD annualized.
 */
import { PrismaClient } from '@prisma/client';
import { runBackfill, DEFAULT_CADENCE_SECONDS } from '../src/collector/archive/backfill.js';
import { ARCHIVE_ENDPOINTS, RpcPool } from '../src/collector/archive/endpoints.js';
import { REGISTERED_ERAS, eraBounds, type EraTag } from '../src/evaluation/eras.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

function seconds(iso: string, label: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`--${label} is not a parseable date: ${iso}`);
  return Math.floor(ms / 1000);
}

function windowFromArgs(): { fromSeconds: number; toSeconds: number; label: string } {
  const eraArg = arg('era');
  if (eraArg !== undefined) {
    if (!(eraArg in REGISTERED_ERAS)) {
      throw new Error(
        `--era must be one of ${Object.keys(REGISTERED_ERAS).join(', ')}, got '${eraArg}'`,
      );
    }
    const era = REGISTERED_ERAS[eraArg as EraTag];
    const now = Math.floor(Date.now() / 1000);
    return {
      fromSeconds: era.startSeconds,
      // Held-out B's registered end is an open sentinel; clamp to now, since
      // no data exists past the present.
      toSeconds: Math.min(era.endSeconds, now),
      label: `era '${eraArg}'`,
    };
  }
  const from = arg('from');
  const to = arg('to');
  return {
    fromSeconds:
      from !== undefined ? seconds(from, 'from') : REGISTERED_ERAS.calibration.startSeconds,
    toSeconds: to !== undefined ? seconds(to, 'to') : Math.floor(Date.now() / 1000),
    label: 'explicit window',
  };
}

function fmt(seconds_: number): string {
  return new Date(seconds_ * 1000).toISOString().replace('.000Z', 'Z');
}

async function main(): Promise<void> {
  const { fromSeconds, toSeconds, label } = windowFromArgs();
  const cadence = arg('cadence') !== undefined ? Number(arg('cadence')) : DEFAULT_CADENCE_SECONDS;
  const limit = arg('limit') !== undefined ? Number(arg('limit')) : undefined;
  const concurrency = arg('concurrency') !== undefined ? Number(arg('concurrency')) : undefined;
  const dryRun = flag('dry-run');

  const pool = new RpcPool(ARCHIVE_ENDPOINTS, {
    ...(concurrency !== undefined ? { concurrencyPerEndpoint: Math.max(1, Math.ceil(concurrency / ARCHIVE_ENDPOINTS.length)) } : {}),
  });

  console.log('[backfill] registered eras');
  for (const tag of Object.keys(REGISTERED_ERAS) as EraTag[]) {
    const b = eraBounds(tag);
    const era = REGISTERED_ERAS[tag];
    console.log(
      `  ${tag.padEnd(12)} ${b.start.slice(0, 10)} -> ${b.end.slice(0, 10)} ` +
        `${String(b.days).padStart(6)}d ${era.sealed ? 'SEALED' : '      '}`,
    );
  }
  console.log(
    `[backfill] window   ${label}: ${fmt(fromSeconds)} -> ${fmt(toSeconds)} at ${cadence}s cadence`,
  );
  console.log(`[backfill] endpoints ${ARCHIVE_ENDPOINTS.length}, pool capacity ${pool.capacity}`);
  if (dryRun) console.log('[backfill] DRY RUN — nothing will be written');

  const prisma = new PrismaClient();
  try {
    const summary = await runBackfill(prisma, pool, {
      fromSeconds,
      toSeconds,
      cadenceSeconds: cadence,
      ...(limit !== undefined ? { limit } : {}),
      ...(concurrency !== undefined ? { concurrency } : {}),
      dryRun,
      onProgress: (done, total, s) => {
        const rate = done / Math.max(1, s.elapsedMs / 1000);
        const etaMin = ((total - done) / Math.max(0.001, rate) / 60).toFixed(1);
        console.log(
          `[backfill] ${done}/${total} origins  ${rate.toFixed(1)}/s  ETA ${etaMin}m  ` +
            `gaps ${s.gaps.length}`,
        );
      },
    });

    console.log('');
    console.log(`[backfill] requested ${summary.requested} origins on the grid`);
    console.log(`[backfill] skipped   ${summary.skipped} already persisted`);
    if (summary.deferredByLimit > 0) {
      console.log(
        `[backfill] deferred  ${summary.deferredByLimit} not attempted (--limit); ` +
          `this run is NOT complete coverage`,
      );
    }
    console.log(`[backfill] persisted ${summary.persisted}`);
    console.log(`[backfill] gaps      ${summary.gaps.length}`);
    // The measured frequency of governance rate-model swaps in this window.
    // Zero over a window known to contain them means the identity check in
    // `buildOriginCalls` is not doing its job -- see backfill.ts rule 5.
    console.log(`[backfill] address corrections ${summary.addressCorrections}`);
    console.log(`[backfill] elapsed   ${(summary.elapsedMs / 1000 / 60).toFixed(1)} min`);
    console.log('[backfill] per era:');
    for (const [era, n] of Object.entries(summary.byEra).sort()) {
      console.log(`    ${era.padEnd(14)} ${n}`);
    }
    console.log('[backfill] per endpoint:');
    for (const s of summary.endpointStats) {
      console.log(`    ${s.url.padEnd(42)} ok=${s.ok} failed=${s.failed}`);
    }

    if (summary.gaps.length > 0) {
      // Printed, never smoothed. Spec §13's stated fallback is to record the
      // degradation in the manifest rather than silently interpolating.
      console.log('');
      console.log(`[backfill] GAPS (first 20 of ${summary.gaps.length}) — these are DISCLOSED,`);
      console.log('[backfill] not interpolated. Re-run to retry them.');
      for (const g of summary.gaps.slice(0, 20)) {
        console.log(`    ${fmt(g.timestampSeconds)}  ${g.reason}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('[backfill] FAILED:', err);
  process.exit(1);
});
