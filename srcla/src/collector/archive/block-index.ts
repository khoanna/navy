/**
 * Timestamp -> block height on Base.
 *
 * Base produces blocks on a fixed two-second cadence, so an anchored linear
 * estimate lands within a handful of blocks even across a two-year span, and
 * a bounded correction walk closes the residual. This is deliberately NOT a
 * binary search over the whole chain: a search costs ~25 header fetches per
 * origin against public endpoints that sustain single-digit calls per second,
 * which would dominate the backfill's entire request budget.
 *
 * THE INVARIANT: `resolveBlockAtOrBefore` returns the newest block whose
 * timestamp is AT OR BEFORE the target. Never after. An origin that reads
 * state from a block later than its own timestamp is a look-ahead leak into
 * every label derived from it; an origin that reads a few seconds early is
 * merely a slightly stale origin, which is the direction this must err in.
 *
 * PURE except `resolveBlockAtOrBefore`, which fetches headers.
 * UNITS: timestamps are Unix seconds; heights are integers.
 */
import type { RpcPool } from './endpoints.js';

/** Base's block time, fixed by the OP-Stack sequencer configuration. */
export const BASE_BLOCK_TIME_SECONDS = 2;

export interface BlockAnchor {
  blockNumber: number;
  timestampSeconds: number;
}

/**
 * A verified Base mainnet anchor.
 *
 * Read from chain, not assumed: block 19_300_000 has timestamp 1_725_389_347
 * (2024-09-03T18:49:07Z). Any anchor works; this one sits inside the backfill
 * window, so the estimate's error is smallest where it is used most.
 */
export const BASE_ANCHOR: BlockAnchor = {
  blockNumber: 19_300_000,
  timestampSeconds: 1_725_389_347,
};

/**
 * The linear estimate. Clamped at 0: a target before genesis has no block,
 * and a negative height would otherwise be sent to the RPC verbatim.
 */
export function estimateBlockForTimestamp(
  anchor: BlockAnchor,
  targetSeconds: number,
  blockTimeSeconds: number = BASE_BLOCK_TIME_SECONDS,
): number {
  if (blockTimeSeconds <= 0) throw new Error('blockTimeSeconds must be positive');
  const delta = targetSeconds - anchor.timestampSeconds;
  const estimate = anchor.blockNumber + Math.round(delta / blockTimeSeconds);
  return estimate < 0 ? 0 : estimate;
}

export interface ResolvedBlock {
  blockNumber: number;
  timestampSeconds: number;
}

/**
 * The newest block at or before `targetSeconds`.
 *
 * Walks from the linear estimate by the residual, then confirms the boundary
 * by checking the successor. Bounded at `maxIterations`: if Base ever stops
 * behaving like a two-second chain this THROWS rather than looping or
 * returning its best guess, because a wrong origin block is indistinguishable
 * from a right one once it is in the dataset.
 */
export async function resolveBlockAtOrBefore(
  pool: RpcPool,
  targetSeconds: number,
  anchor: BlockAnchor = BASE_ANCHOR,
  opts: { blockTimeSeconds?: number; maxIterations?: number } = {},
): Promise<ResolvedBlock> {
  const blockTime = opts.blockTimeSeconds ?? BASE_BLOCK_TIME_SECONDS;
  const maxIterations = opts.maxIterations ?? 16;

  const headerAt = async (n: number): Promise<ResolvedBlock> => {
    const block = await pool.call(async (p) => p.getBlock(n));
    if (block === null) throw new Error(`no block at height ${n}`);
    return { blockNumber: Number(block.number), timestampSeconds: Number(block.timestamp) };
  };

  let header = await headerAt(estimateBlockForTimestamp(anchor, targetSeconds, blockTime));

  for (let i = 0; i < maxIterations; i++) {
    const residual = targetSeconds - header.timestampSeconds;

    if (residual < 0) {
      // Overshot. Step back by the residual, at least one block.
      const step = Math.min(-1, Math.trunc(residual / blockTime));
      const next = header.blockNumber + step;
      header = await headerAt(next < 0 ? 0 : next);
      continue;
    }

    // At or before the target. Confirm the successor is after it -- that
    // check, not the estimate, is what makes "at or before" a verified
    // property.
    if (residual < blockTime * 2) {
      const next = await headerAt(header.blockNumber + 1);
      if (next.timestampSeconds > targetSeconds) return header;
      header = next;
      continue;
    }

    header = await headerAt(header.blockNumber + Math.max(1, Math.trunc(residual / blockTime)));
  }

  throw new Error(
    `resolveBlockAtOrBefore did not settle within ${maxIterations} iterations for target ` +
      `${targetSeconds}; last height ${header.blockNumber} at ${header.timestampSeconds}`,
  );
}
