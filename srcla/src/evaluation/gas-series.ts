/**
 * Per-origin MEASURED gas and oracle observations (paper §9.1).
 *
 * `HarnessConfig.gas` was a single registered constant flagged NOT OBSERVED,
 * because nothing in srcla persisted a gas or oracle snapshot. The archive
 * backfill now measures all five fields at every origin -- they ride in the
 * same multicall3 batch as the venue state -- so the §9.1 cost gate can be
 * priced from what the chain charged rather than from an assumption.
 *
 * This is not a cosmetic upgrade. H3 ablates the complete-cost movement gate,
 * so a constant-priced gate makes H3's measured contribution a statement about
 * the constant. Over the registered window the L2 base fee moved between
 * 714_160 and 3_869_277 wei and ETH between roughly $2,450 and $4,290 -- a
 * factor of five and a factor of nearly two, both inside the same dataset.
 *
 * THE ONE RULE: no backward extrapolation. `at()` carries the last
 * observation AT OR BEFORE the origin and THROWS before the first one. A gas
 * price invented for a period nobody measured is a fabricated cost, and a
 * fabricated cost moves the gate that decides whether a rebalance happens.
 *
 * PURE apart from `loadGasSeries`, which reads the database.
 * UNITS: wei for fees; 8-dp integers for the Chainlink answers.
 */
import { createHash } from 'crypto';
import type { PrismaClient } from '@prisma/client';
import type { GasObservation } from '../policy/types.js';

export interface GasRow {
  timestampSeconds: number;
  l2BaseFeeWei: bigint;
  l1BaseFeeWei: bigint;
  l1BlobBaseFeeWei: bigint;
  ethUsdE8: bigint;
  usdcUsdE8: bigint;
}

export interface GasSeries {
  /** The measured observation in force at `originSeconds`. */
  at(originSeconds: number): GasObservation;
  /** How many observations back this series. */
  readonly length: number;
  /** Bounds, for a manifest or report line. */
  readonly firstSeconds: number;
  readonly lastSeconds: number;
  /**
   * SHA-256 over every observation in time order.
   *
   * The manifest's dataset hash covers snapshots and withdrawals only, so
   * without this a swapped gas series over the same window would reproduce
   * the same dataset hash while changing every cost-gate decision. Recorded
   * in the manifest's `costs.measuredSeries`.
   */
  readonly digest: string;
  /** Extremes, so a report can state the range the run actually saw. */
  readonly summary: GasSeriesSummary;
}

export interface GasSeriesSummary {
  observations: number;
  firstIso: string;
  lastIso: string;
  minL2BaseFeeWei: string;
  maxL2BaseFeeWei: string;
  minEthUsdE8: string;
  maxEthUsdE8: string;
}

/** Distinguish a series from a single constant observation at a call site. */
export function isGasSeries(value: GasObservation | GasSeries): value is GasSeries {
  return typeof (value as GasSeries).at === 'function';
}

/** Resolve either shape at an origin, so callers need no branching. */
export function gasAt(value: GasObservation | GasSeries, originSeconds: number): GasObservation {
  return isGasSeries(value) ? value.at(originSeconds) : value;
}

/**
 * Build a series from measured rows.
 *
 * Sorted once; `at()` binary-searches. Duplicate timestamps keep the LAST row
 * given, so a re-collected origin supersedes rather than duplicating.
 */
export function gasSeriesFrom(rows: readonly GasRow[]): GasSeries {
  if (rows.length === 0) {
    throw new Error(
      'gasSeriesFrom: no measured gas observations. The evaluation will not substitute a ' +
        'registered constant -- run `pnpm backfill:history` so ChainCostSnapshot is populated.',
    );
  }

  const sorted = [...rows].sort((a, b) => a.timestampSeconds - b.timestampSeconds);
  const deduped: GasRow[] = [];
  for (const row of sorted) {
    const last = deduped[deduped.length - 1];
    if (last !== undefined && last.timestampSeconds === row.timestampSeconds) {
      deduped[deduped.length - 1] = row;
    } else {
      deduped.push(row);
    }
  }

  const first = deduped[0]!;
  const last = deduped[deduped.length - 1]!;

  const toObservation = (row: GasRow): GasObservation => ({
    l2BaseFeeWei: row.l2BaseFeeWei,
    l1BaseFeeWei: row.l1BaseFeeWei,
    l1BlobBaseFeeWei: row.l1BlobBaseFeeWei,
    ethUsdE8: row.ethUsdE8,
    usdcUsdE8: row.usdcUsdE8,
  });

  const hash = createHash('sha256');
  let minL2 = first.l2BaseFeeWei;
  let maxL2 = first.l2BaseFeeWei;
  let minEth = first.ethUsdE8;
  let maxEth = first.ethUsdE8;
  for (const r of deduped) {
    hash.update(
      `${r.timestampSeconds}|${r.l2BaseFeeWei}|${r.l1BaseFeeWei}|${r.l1BlobBaseFeeWei}|` +
        `${r.ethUsdE8}|${r.usdcUsdE8}\n`,
    );
    if (r.l2BaseFeeWei < minL2) minL2 = r.l2BaseFeeWei;
    if (r.l2BaseFeeWei > maxL2) maxL2 = r.l2BaseFeeWei;
    if (r.ethUsdE8 < minEth) minEth = r.ethUsdE8;
    if (r.ethUsdE8 > maxEth) maxEth = r.ethUsdE8;
  }

  return {
    length: deduped.length,
    firstSeconds: first.timestampSeconds,
    lastSeconds: last.timestampSeconds,
    digest: `0x${hash.digest('hex')}`,
    summary: {
      observations: deduped.length,
      firstIso: new Date(first.timestampSeconds * 1000).toISOString(),
      lastIso: new Date(last.timestampSeconds * 1000).toISOString(),
      minL2BaseFeeWei: minL2.toString(),
      maxL2BaseFeeWei: maxL2.toString(),
      minEthUsdE8: minEth.toString(),
      maxEthUsdE8: maxEth.toString(),
    },
    at(originSeconds: number): GasObservation {
      if (originSeconds < first.timestampSeconds) {
        throw new Error(
          `no gas observation at or before ${originSeconds} ` +
            `(${new Date(originSeconds * 1000).toISOString()}); the series starts at ` +
            `${new Date(first.timestampSeconds * 1000).toISOString()}. Extrapolating backwards ` +
            `would invent a cost for a period nobody measured, and the §9.1 gate is priced ` +
            `off exactly that number.`,
        );
      }
      // Rightmost row whose timestamp is <= originSeconds.
      let lo = 0;
      let hi = deduped.length - 1;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (deduped[mid]!.timestampSeconds <= originSeconds) lo = mid;
        else hi = mid - 1;
      }
      return toObservation(deduped[lo]!);
    },
  };
}

/**
 * Load the measured series over a window.
 *
 * The window is widened backwards by `lookbackSeconds` so the first origin has
 * an observation at or before it — without that, the very first decision of a
 * run would throw on a series that starts at the same instant.
 */
export async function loadGasSeries(
  prisma: PrismaClient,
  startDate: Date,
  endDate: Date,
  lookbackSeconds = 86_400,
): Promise<GasSeries> {
  const rows = await prisma.chainCostSnapshot.findMany({
    where: {
      timestamp: {
        gte: new Date(startDate.getTime() - lookbackSeconds * 1000),
        lte: endDate,
      },
    },
    orderBy: { timestamp: 'asc' },
  });

  return gasSeriesFrom(
    rows.map((r) => ({
      timestampSeconds: Math.floor(r.timestamp.getTime() / 1000),
      l2BaseFeeWei: BigInt(r.l2BaseFeeWei),
      l1BaseFeeWei: BigInt(r.l1BaseFeeWei),
      l1BlobBaseFeeWei: BigInt(r.l1BlobBaseFeeWei),
      ethUsdE8: BigInt(r.ethUsdE8),
      usdcUsdE8: BigInt(r.usdcUsdE8),
    })),
  );
}
