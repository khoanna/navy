import {
  BASE_ANCHOR,
  estimateBlockForTimestamp,
  resolveBlockAtOrBefore,
} from '../../../../src/collector/archive/block-index.js';
import type { RpcPool } from '../../../../src/collector/archive/endpoints.js';

describe('estimateBlockForTimestamp', () => {
  it('returns the anchor block for the anchor timestamp', () => {
    expect(estimateBlockForTimestamp(BASE_ANCHOR, BASE_ANCHOR.timestampSeconds, 2)).toBe(
      BASE_ANCHOR.blockNumber,
    );
  });

  it('advances one block per two seconds forward', () => {
    expect(estimateBlockForTimestamp(BASE_ANCHOR, BASE_ANCHOR.timestampSeconds + 3600, 2)).toBe(
      BASE_ANCHOR.blockNumber + 1800,
    );
  });

  it('rewinds symmetrically backward', () => {
    expect(estimateBlockForTimestamp(BASE_ANCHOR, BASE_ANCHOR.timestampSeconds - 3600, 2)).toBe(
      BASE_ANCHOR.blockNumber - 1800,
    );
  });

  it('never returns a negative height', () => {
    expect(estimateBlockForTimestamp(BASE_ANCHOR, 0, 2)).toBe(0);
  });

  it('rejects a non-positive block time rather than dividing by zero', () => {
    expect(() => estimateBlockForTimestamp(BASE_ANCHOR, 1, 0)).toThrow(/positive/i);
  });
});

/**
 * A chain whose block n has timestamp `genesis + n * 2`, so the exact answer
 * is computable and the walk's behaviour is fully determined.
 */
function fakeChain(genesis = 1_000_000): { pool: RpcPool; calls: number[] } {
  const calls: number[] = [];
  const pool = {
    call: async <T,>(fn: (p: never) => Promise<T>): Promise<T> =>
      fn({
        getBlock: async (n: number) => {
          calls.push(n);
          return { number: n, timestamp: genesis + n * 2 };
        },
      } as never),
  } as unknown as RpcPool;
  return { pool, calls };
}

describe('resolveBlockAtOrBefore', () => {
  const genesis = 1_000_000;
  const anchor = { blockNumber: 0, timestampSeconds: genesis };

  it('returns the exact block when the target lands on one', async () => {
    const { pool } = fakeChain(genesis);
    const r = await resolveBlockAtOrBefore(pool, genesis + 5000 * 2, anchor);
    expect(r.blockNumber).toBe(5000);
    expect(r.timestampSeconds).toBe(genesis + 10_000);
  });

  it('returns the block AT OR BEFORE the target, never after', async () => {
    const { pool } = fakeChain(genesis);
    // One second past block 5000 and one before 5001: must resolve to 5000.
    const r = await resolveBlockAtOrBefore(pool, genesis + 5000 * 2 + 1, anchor);
    expect(r.blockNumber).toBe(5000);
    expect(r.timestampSeconds).toBeLessThanOrEqual(genesis + 5000 * 2 + 1);
  });

  it('holds the at-or-before invariant across a sweep of offsets', async () => {
    for (const offset of [0, 1, 2, 3, 999, 1001, 86_399]) {
      const { pool } = fakeChain(genesis);
      const target = genesis + offset;
      const r = await resolveBlockAtOrBefore(pool, target, anchor);
      expect(r.timestampSeconds).toBeLessThanOrEqual(target);
      expect(r.timestampSeconds + 2).toBeGreaterThan(target);
    }
  });

  it('corrects a badly wrong anchor rather than trusting the estimate', async () => {
    const { pool, calls } = fakeChain(genesis);
    // Anchor claims block 0 is 100,000s later than it is, so the first
    // estimate is ~50,000 blocks off.
    const r = await resolveBlockAtOrBefore(pool, genesis + 20_000, {
      blockNumber: 0,
      timestampSeconds: genesis + 100_000,
    });
    expect(r.blockNumber).toBe(10_000);
    expect(calls.length).toBeGreaterThan(1);
  });

  it('throws rather than looping when the chain does not settle', async () => {
    // Every block reports the same timestamp, so the residual never shrinks.
    const pool = {
      call: async <T,>(fn: (p: never) => Promise<T>): Promise<T> =>
        fn({ getBlock: async (n: number) => ({ number: n, timestamp: genesis }) } as never),
    } as unknown as RpcPool;
    await expect(
      resolveBlockAtOrBefore(pool, genesis + 1_000_000, anchor, { maxIterations: 4 }),
    ).rejects.toThrow(/did not settle/i);
  });
});
