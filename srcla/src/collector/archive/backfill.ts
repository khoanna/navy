/**
 * The archive backfill: hourly origins over the registered window, persisted
 * as raw protocol integers (paper §10.1).
 *
 * THE RULES THIS FILE EXISTS TO ENFORCE
 *
 *  1. Nothing is ever substituted. A venue that could not be read is a
 *     recorded gap, not a row of zeros. A gap is recoverable by re-running;
 *     a plausible-looking zero is not, because downstream it is
 *     indistinguishable from a real reading and `deriveCompletedLabels` will
 *     average it into a realized return.
 *  2. An origin is persisted ATOMICALLY. Two venues written and one not is
 *     worse than none, because the absent venue reads as "no observation in
 *     this window" rather than as a gap.
 *  3. Resume is driven by the DATABASE, not a cursor file. A cursor and the
 *     database disagree the moment a run is killed mid-write.
 *  4. Origins sit on a cadence-aligned grid. A resumed run whose origins are
 *     offset from the first run's produces two interleaved half-datasets that
 *     look like one dense dataset, and the label deriver would average rates
 *     across an irregular grid without complaining.
 *  5. The rate model a row's parameters came from is verified AT THAT ROW'S
 *     OWN BLOCK. This file used to re-read the venue addresses once per 500
 *     origins and trust them in between; a governance model swap was then
 *     attributed to the old model's coefficients for up to three weeks, and
 *     `configDigest` -- derived from the same reading -- missed the regime
 *     boundary entirely. 3,262 of Moonwell's 10,632 calibration rows carried
 *     a misattributed model. The identity now rides in the origin's own
 *     multicall (`buildOriginCalls`'s `identity.*` legs) and a mismatch
 *     re-fetches the origin rather than being written.
 *
 * UNITS: money is bigint USDC base units (6 dp); rates WAD annualized; times
 * are Unix seconds.
 */
import type { PrismaClient } from '@prisma/client';
import { eraFor, type EraTag } from '../../evaluation/eras.js';
import { resolveBlockAtOrBefore, type BlockAnchor } from './block-index.js';
import type { RpcPool } from './endpoints.js';
import {
  BASE,
  buildOriginCalls,
  decodeAggregate3,
  decodeOrigin,
  encodeAggregate3,
  resolveAddresses,
  type ArchiveAddresses,
  type OriginReading,
} from './calls.js';

/**
 * How many times one origin may be re-fetched after an address drift.
 *
 * ONE is enough and two would hide a bug. The retry re-issues the SAME block
 * with the addresses that block itself reported, so the second attempt reads
 * the contracts the chain named; if it still disagrees, the disagreement is
 * not staleness and must surface as a gap rather than be papered over.
 */
const MAX_ADDRESS_CORRECTIONS = 1;

/** One hour, the paper's registered origin cadence. */
export const DEFAULT_CADENCE_SECONDS = 3600;

export interface BackfillGap {
  timestampSeconds: number;
  reason: string;
}

export interface BackfillSummary {
  requested: number;
  persisted: number;
  /** Origins already in the database, skipped without a network call. */
  skipped: number;
  /**
   * Origins on the grid that this invocation did not attempt because
   * `--limit` trimmed them.
   *
   * Kept SEPARATE from `skipped`: on a resumed full run an operator reads
   * `skipped` as work already done, and folding a limit into it would report
   * a smoke test as near-complete coverage.
   */
  deferredByLimit: number;
  gaps: BackfillGap[];
  /**
   * Origins whose batch was built against a superseded address and had to be
   * re-fetched (rule 5). Reported rather than swallowed: this is the measured
   * frequency of governance model swaps in the window, and a run that reports
   * zero over a window known to contain them is a run whose identity check is
   * not working.
   */
  addressCorrections: number;
  /** Persisted origins per era, so coverage is visible without a query. */
  byEra: Record<string, number>;
  endpointStats: ReturnType<RpcPool['stats']>;
  elapsedMs: number;
}

export interface BackfillOptions {
  fromSeconds: number;
  toSeconds: number;
  cadenceSeconds?: number;
  /** Concurrent origins in flight. Defaults to the pool's total capacity. */
  concurrency?: number;
  /** Stop after this many NEW origins. For smoke tests. */
  limit?: number;
  /** Decode and report without writing. */
  dryRun?: boolean;
  anchor?: BlockAnchor;
  onProgress?: (done: number, total: number, summary: Readonly<BackfillSummary>) => void;
}

/**
 * The origin grid.
 *
 * Aligned to `cadenceSeconds` from the Unix epoch, so a run starting anywhere
 * inside the window produces a SUBSET of the same grid rather than a shifted
 * one. That is what makes resume safe (rule 4).
 */
export function enumerateOrigins(
  fromSeconds: number,
  toSeconds: number,
  cadenceSeconds: number = DEFAULT_CADENCE_SECONDS,
): number[] {
  if (!Number.isInteger(cadenceSeconds) || cadenceSeconds <= 0) {
    throw new Error(`cadence must be a positive integer number of seconds, got ${cadenceSeconds}`);
  }
  if (3600 % cadenceSeconds !== 0 && cadenceSeconds % 3600 !== 0) {
    throw new Error(
      `cadence ${cadenceSeconds}s neither divides nor is a multiple of an hour; such a grid ` +
        `drifts against the hourly origins the paper registers`,
    );
  }
  if (toSeconds < fromSeconds) throw new Error('toSeconds must not precede fromSeconds');

  const first = Math.ceil(fromSeconds / cadenceSeconds) * cadenceSeconds;
  const out: number[] = [];
  for (let t = first; t <= toSeconds; t += cadenceSeconds) out.push(t);
  return out;
}

/**
 * Origins already persisted, as a Set of Unix seconds.
 *
 * Read from `MarketSnapshot` rather than a cursor: rule 3.
 */
export async function persistedOrigins(
  prisma: PrismaClient,
  fromSeconds: number,
  toSeconds: number,
): Promise<Set<number>> {
  const rows = await prisma.marketSnapshot.findMany({
    where: {
      timestamp: { gte: new Date(fromSeconds * 1000), lte: new Date(toSeconds * 1000) },
      blockNumber: { not: null },
    },
    select: { timestamp: true },
    distinct: ['timestamp'],
  });
  return new Set(rows.map((r) => Math.floor(r.timestamp.getTime() / 1000)));
}

export interface FetchedOrigin {
  reading: OriginReading;
  /** The addresses the returned reading was actually decoded against. */
  addresses: ArchiveAddresses;
  /** True when `addresses` differ from the ones the caller proposed. */
  corrected: boolean;
}

/**
 * Fetch and decode one origin, VERIFYING the rate-model identity at its own
 * block. Throws on a failure the caller records as a gap.
 *
 * `addresses` is a HINT, not an authority. The batch carries identity legs
 * read from the fixed market contracts at the same block, so a hint that
 * governance has superseded is detected here and the origin re-fetched
 * against what the chain reported. That is the whole of the fix for the
 * 500-origin refresh cadence: correctness no longer depends on how often the
 * caller re-resolves, because every origin checks its own.
 */
export async function fetchOrigin(
  pool: RpcPool,
  addresses: ArchiveAddresses,
  targetSeconds: number,
  anchor?: BlockAnchor,
): Promise<FetchedOrigin> {
  const block = await resolveBlockAtOrBefore(pool, targetSeconds, anchor);

  let current = addresses;
  let corrected = false;
  for (let attempt = 0; ; attempt += 1) {
    const calls = buildOriginCalls(current, block.blockNumber);
    const raw = await pool.call(async (p) =>
      p.call({ to: BASE.multicall3, data: encodeAggregate3(calls), blockTag: block.blockNumber }),
    );
    const reading = decodeOrigin(current, calls, decodeAggregate3(raw), {
      blockNumber: block.blockNumber,
      blockHash: block.hash,
      timestampSeconds: block.timestampSeconds,
      baseFeePerGasWei: block.baseFeePerGasWei,
    });

    if (reading.addressDrift.length === 0) return { reading, addresses: current, corrected };

    if (attempt >= MAX_ADDRESS_CORRECTIONS || reading.observedAddresses === null) {
      throw new Error(
        `address identity did not settle at block ${block.blockNumber}: ` +
          `${reading.addressDrift.join(',')} still disagree after ${attempt + 1} attempt(s). ` +
          `Refusing to persist parameters read from a contract the chain did not name.`,
      );
    }
    current = reading.observedAddresses;
    corrected = true;
  }
}

/**
 * Persist one origin's rows in a single transaction (rule 2).
 *
 * The `timestamp` written is the GRID origin, not the block's own timestamp:
 * the grid is what the label deriver walks, and a row stamped with the block
 * time would sit a few seconds off it and break the alignment resume depends
 * on. The block's real height and hash are recorded alongside, so the
 * provenance is not lost.
 */
export async function persistOrigin(
  prisma: PrismaClient,
  reading: OriginReading,
  gridOriginSeconds: number,
  eraTag: EraTag | null,
): Promise<void> {
  const timestamp = new Date(gridOriginSeconds * 1000);

  await prisma.$transaction(async (tx) => {
    for (const m of reading.markets) {
      await tx.marketSnapshot.create({
        data: {
          marketId: m.marketId,
          blockHash: reading.blockHash,
          blockNumber: BigInt(reading.blockNumber),
          timestamp,
          // The vault does not exist at these historical blocks, so its
          // totals are not observable. The replay supplies them from its own
          // simulated state (`evaluation/replay/state.ts`); a zero here is a
          // structural absence, not a reading.
          totalAssetsBase: '0',
          idleBase: '0',
          supplyRateE18: m.supplyRateE18.toString(),
          utilizationE18: m.utilizationE18.toString(),
          cashBase: m.cashBase.toString(),
          borrowsBase: m.borrowsBase.toString(),
          reservesBase: m.reservesBase.toString(),
          capBps: 5000,
          paused: m.paused,
          configDigest: m.configDigest,
          reserveFactorBps: m.reserveFactorBps,
          eraTag,
          ...(m.irm !== null
            ? {
                irmAddress: m.irm.address,
                irmBaseRateWad: m.irm.baseRateWad.toString(),
                irmKinkRay: m.irm.kinkRay.toString(),
                irmSlopeLowWad: m.irm.slopeLowWad.toString(),
                irmSlopeHighWad: m.irm.slopeHighWad.toString(),
                ...(m.irm.optimalUtilizationRay !== undefined
                  ? { irmOptimalUtilizationRay: m.irm.optimalUtilizationRay.toString() }
                  : {}),
                ...(m.irm.maxUtilizationRay !== undefined
                  ? { irmMaxUtilizationRay: m.irm.maxUtilizationRay.toString() }
                  : {}),
              }
            : {}),
          ...mapRawColumns(m.raw),
          qualityFlags: reading.failures.length > 0 ? reading.failures.join(',') : null,
        },
      });
    }

    if (reading.cost !== null) {
      await tx.chainCostSnapshot.upsert({
        where: { blockNumber: BigInt(reading.blockNumber) },
        create: {
          blockNumber: BigInt(reading.blockNumber),
          blockHash: reading.blockHash,
          timestamp,
          l2BaseFeeWei: reading.cost.l2BaseFeeWei.toString(),
          l1BaseFeeWei: reading.cost.l1BaseFeeWei.toString(),
          l1BlobBaseFeeWei: reading.cost.l1BlobBaseFeeWei.toString(),
          baseFeeScalar: reading.cost.baseFeeScalar,
          blobBaseFeeScalar: reading.cost.blobBaseFeeScalar,
          ethUsdE8: reading.cost.ethUsdE8.toString(),
          usdcUsdE8: reading.cost.usdcUsdE8.toString(),
          ethUsdRoundId: reading.cost.ethUsdRoundId,
          usdcUsdRoundId: reading.cost.usdcUsdRoundId,
          ethUsdUpdatedAt: reading.cost.ethUsdUpdatedAt,
          usdcUsdUpdatedAt: reading.cost.usdcUsdUpdatedAt,
        },
        update: {},
      });
    }
  });
}

/** Map the decoder's protocol-specific raw integers onto their columns. */
function mapRawColumns(raw: Record<string, string>): Record<string, string> {
  const allowed = [
    'cometSupplyBase',
    'cometBorrowBase',
    'aaveVirtualBalBase',
    'aaveDebtBase',
    'aaveDeficitBase',
    'mwExchangeRate',
  ] as const;
  const out: Record<string, string> = {};
  for (const key of allowed) {
    const v = raw[key];
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/**
 * Run the backfill.
 *
 * Concurrency is a fixed worker pool over the origin list. `RpcPool` owns
 * endpoint selection and backoff, so the worker count is only about how many
 * origins are in flight, not about which endpoint serves them.
 */
export async function runBackfill(
  prisma: PrismaClient,
  pool: RpcPool,
  opts: BackfillOptions,
): Promise<BackfillSummary> {
  const started = Date.now();
  const cadence = opts.cadenceSeconds ?? DEFAULT_CADENCE_SECONDS;
  const all = enumerateOrigins(opts.fromSeconds, opts.toSeconds, cadence);

  const already = opts.dryRun === true
    ? new Set<number>()
    : await persistedOrigins(prisma, opts.fromSeconds, opts.toSeconds);
  const outstanding = all.filter((t) => !already.has(t));
  const todo = opts.limit !== undefined ? outstanding.slice(0, opts.limit) : outstanding;

  const summary: BackfillSummary = {
    requested: all.length,
    persisted: 0,
    skipped: all.length - outstanding.length,
    deferredByLimit: outstanding.length - todo.length,
    gaps: [],
    addressCorrections: 0,
    byEra: {},
    endpointStats: pool.stats(),
    elapsedMs: 0,
  };

  if (todo.length === 0) {
    summary.elapsedMs = Date.now() - started;
    summary.endpointStats = pool.stats();
    return summary;
  }

  // A SEED, resolved once, plus a hint that moves forward as the workers
  // observe governance changes. Correctness does not depend on either: every
  // origin verifies its own identity inside its own multicall (rule 5), and a
  // wrong hint costs one extra round trip at the boundary, not a wrong row.
  //
  // The hint exists purely so that ONE origin pays for a model swap rather
  // than every subsequent origin paying until some refresh interval elapses.
  let hint: ArchiveAddresses | null = null;
  let seeding: Promise<ArchiveAddresses> | null = null;
  const addressHint = async (originSeconds: number): Promise<ArchiveAddresses> => {
    if (hint !== null) return hint;
    if (seeding === null) {
      seeding = (async () => {
        const block = await resolveBlockAtOrBefore(pool, originSeconds, opts.anchor);
        const resolved = await resolveAddresses(pool, block.blockNumber);
        hint = resolved;
        return resolved;
      })();
    }
    return seeding;
  };

  const workers = Math.max(1, opts.concurrency ?? pool.capacity);
  let next = 0;
  let done = 0;

  const runWorker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= todo.length) return;
      const originSeconds = todo[index]!;
      try {
        const proposed = await addressHint(originSeconds);
        const fetched = await fetchOrigin(pool, proposed, originSeconds, opts.anchor);
        const reading = fetched.reading;
        if (fetched.corrected) {
          summary.addressCorrections += 1;
          // Move the shared hint forward so the NEXT origin does not pay for
          // the same swap. Never backwards-checked: a worker on an earlier
          // origin that inherits a later hint simply corrects again, which is
          // one round trip, not a wrong row.
          hint = fetched.addresses;
        }

        if (reading.markets.length === 0) {
          summary.gaps.push({
            timestampSeconds: originSeconds,
            reason: `no venue readable (${reading.failures.join(',')})`,
          });
        } else {
          const tag = eraFor(originSeconds);
          if (opts.dryRun !== true) await persistOrigin(prisma, reading, originSeconds, tag);
          summary.persisted += 1;
          const key = tag ?? 'outside-window';
          summary.byEra[key] = (summary.byEra[key] ?? 0) + 1;
          if (reading.markets.length < 3) {
            summary.gaps.push({
              timestampSeconds: originSeconds,
              reason: `partial: ${reading.markets.length}/3 venues (${reading.failures.join(',')})`,
            });
          }
        }
      } catch (err) {
        summary.gaps.push({ timestampSeconds: originSeconds, reason: String(err).slice(0, 200) });
      } finally {
        done += 1;
        if (opts.onProgress !== undefined && done % 50 === 0) {
          summary.endpointStats = pool.stats();
          summary.elapsedMs = Date.now() - started;
          opts.onProgress(done, todo.length, summary);
        }
      }
    }
  };

  await Promise.all(Array.from({ length: workers }, runWorker));

  summary.endpointStats = pool.stats();
  summary.elapsedMs = Date.now() - started;
  return summary;
}
