/**
 * WithdrawalTracker — exercised against the real class, with a fake chain and
 * a fake Prisma client.
 *
 * The previous version of this file asserted nothing about the tracker: it
 * re-implemented hex slicing and percentile arithmetic inline and checked its
 * own reimplementation, so it stayed green through the entire lifetime of
 * audit finding NEW-10 (the tracker filtered on `Withdrawal(address,uint256,
 * uint256)`, an event that exists nowhere in contract/src, and therefore
 * matched zero logs forever — making the paper's §8.1 demand quantile
 * `Q_beta(W_H)` identically zero).
 */
import { ethers } from 'ethers';
import type { PrismaClient } from '@prisma/client';
import type { ChainClient } from '../../../src/chain/client.js';
import { WithdrawalTracker } from '../../../src/collector/withdrawal-tracker.js';
import { VAULT_EVENTS_IFACE, WITHDRAW_TOPIC } from '../../../src/chain/contract-abis.js';

const VAULT = '0x' + '11'.repeat(20);
/** Navy's gasless redeem is relayed, so the ERC-4626 `sender` is the relayer. */
const RELAYER = '0x' + '22'.repeat(20);
const OWNER = '0x' + '33'.repeat(20);
const RECEIVER = '0x' + '44'.repeat(20);

interface FakeLog {
  address: string;
  topics: string[];
  data: string;
  blockHash: string;
  blockNumber: number;
  index: number;
}

/** Build a real ABI-encoded `Withdraw` log. */
function withdrawLog(opts: {
  assets: bigint;
  shares: bigint;
  owner?: string;
  blockNumber?: number;
  blockHash?: string;
  index?: number;
}): FakeLog {
  const encoded = VAULT_EVENTS_IFACE.encodeEventLog('Withdraw', [
    RELAYER,
    RECEIVER,
    opts.owner ?? OWNER,
    opts.assets,
    opts.shares,
  ]);
  return {
    address: VAULT,
    topics: [...encoded.topics],
    data: encoded.data,
    blockHash: opts.blockHash ?? '0x' + 'be'.repeat(32),
    blockNumber: opts.blockNumber ?? 90,
    index: opts.index ?? 0,
  };
}

function fakeChain(opts: { head: number; finalized: number; logs: FakeLog[] }) {
  const filters: ethers.Filter[] = [];
  const client = {
    getBlockNumber: async () => opts.head,
    getFinalizedBlock: async () => ({ number: opts.finalized, hash: '0x' + 'aa'.repeat(32), timestamp: 1_700_000_000 }),
    getBlock: async (n: number) => ({ number: n, timestamp: 1_700_000_000 + n }),
    getLogs: async (filter: ethers.Filter) => {
      filters.push(filter);
      return opts.logs as unknown as ethers.Log[];
    },
  };
  return { client: client as unknown as ChainClient, filters };
}

function fakePrisma() {
  const upserts: Array<{ id: string; data: Record<string, unknown> }> = [];
  const rows: Array<Record<string, unknown>> = [];
  const queries: unknown[] = [];
  const prisma = {
    withdrawalEvent: {
      upsert: async (args: { where: { id: string }; create: Record<string, unknown> }) => {
        upserts.push({ id: args.where.id, data: args.create });
        return {};
      },
      findMany: async (args: unknown) => {
        queries.push(args);
        return rows;
      },
      findFirst: async () => null,
    },
    chainBlock: { findUnique: async () => null },
  } as unknown as PrismaClient;
  return { prisma, upserts, rows, queries };
}

describe('WithdrawalTracker.collectSince — the event it filters on', () => {
  it('filters the vault for the ERC-4626 Withdraw topic', async () => {
    const chain = fakeChain({ head: 200, finalized: 100, logs: [] });
    const tracker = new WithdrawalTracker(chain.client, VAULT, fakePrisma().prisma);

    await tracker.collectSince(50);

    expect(chain.filters).toHaveLength(1);
    expect(chain.filters[0]!.address).toBe(VAULT);
    expect(chain.filters[0]!.topics).toEqual([
      ethers.id('Withdraw(address,address,address,uint256,uint256)'),
    ]);
  });

  it('does not filter on the nonexistent Withdrawal(address,uint256,uint256) topic', async () => {
    const chain = fakeChain({ head: 200, finalized: 100, logs: [] });
    await new WithdrawalTracker(chain.client, VAULT, fakePrisma().prisma).collectSince(50);
    expect(chain.filters[0]!.topics![0]).not.toBe(
      ethers.id('Withdrawal(address,uint256,uint256)')
    );
    expect(chain.filters[0]!.topics![0]).toBe(WITHDRAW_TOPIC);
  });

  it('scans only up to the FINALIZED block, not the chain head (§7.3/§10.1)', async () => {
    // A reorg above the finalized head could otherwise retract a withdrawal
    // that had already been folded into the reserve quantile.
    const chain = fakeChain({ head: 200, finalized: 137, logs: [] });
    await new WithdrawalTracker(chain.client, VAULT, fakePrisma().prisma).collectSince(50);

    expect(chain.filters[0]!.fromBlock).toBe(51);
    expect(chain.filters[0]!.toBlock).toBe(137);
    expect(chain.filters[0]!.toBlock).not.toBe(200);
  });

  it('does nothing when the cursor is already at or past the finalized head', async () => {
    const chain = fakeChain({ head: 200, finalized: 137, logs: [] });
    const events = await new WithdrawalTracker(chain.client, VAULT, fakePrisma().prisma).collectSince(
      137
    );
    expect(events).toEqual([]);
    expect(chain.filters).toHaveLength(0);
  });
});

describe('WithdrawalTracker.collectSince — decoding a real Withdraw log', () => {
  it('reads assets and shares out of the two data words', async () => {
    const chain = fakeChain({
      head: 200,
      finalized: 100,
      logs: [withdrawLog({ assets: 4_250_000n, shares: 4_000_000n })],
    });
    const db = fakePrisma();

    const [event] = await new WithdrawalTracker(chain.client, VAULT, db.prisma).collectSince(50);

    expect(event!.assets).toBe(4_250_000n);
    expect(event!.shares).toBe(4_000_000n);
  });

  it('attributes the withdrawal to the share OWNER, not to the relayer that called it', async () => {
    // `Withdraw` has THREE indexed parameters. The old parser assumed the
    // one-indexed-parameter `Withdrawal` shape and read topics[1] — under the
    // real event that is the caller, which for Navy is always the relayer.
    const chain = fakeChain({
      head: 200,
      finalized: 100,
      logs: [withdrawLog({ assets: 1_000_000n, shares: 1_000_000n })],
    });

    const [event] = await new WithdrawalTracker(chain.client, VAULT, fakePrisma().prisma).collectSince(
      50
    );

    expect(event!.owner.toLowerCase()).toBe(OWNER);
    expect(event!.caller.toLowerCase()).toBe(RELAYER);
    expect(event!.receiver.toLowerCase()).toBe(RECEIVER);
    expect(event!.owner.toLowerCase()).not.toBe(RELAYER);
  });

  it('persists the owner into the sender column and stamps the finalized block timestamp', async () => {
    const chain = fakeChain({
      head: 200,
      finalized: 100,
      logs: [withdrawLog({ assets: 7_500_000n, shares: 7_000_000n, blockNumber: 90 })],
    });
    const db = fakePrisma();

    await new WithdrawalTracker(chain.client, VAULT, db.prisma).collectSince(50);

    expect(db.upserts).toHaveLength(1);
    expect(db.upserts[0]!.data.sender).toBe(ethers.getAddress(OWNER));
    expect(db.upserts[0]!.data.assets).toBe('7500000');
    expect(db.upserts[0]!.data.shares).toBe('7000000');
    expect((db.upserts[0]!.data.timestamp as Date).getTime()).toBe((1_700_000_000 + 90) * 1000);
  });
});

describe('WithdrawalTracker — deduplication', () => {
  it('keeps two identical withdrawals in the same block apart by log index', async () => {
    // Two 1,000,000-unit redemptions by the same owner in one block are two
    // distinct withdrawals. The old key hashed (blockHash, account, assets,
    // shares) into 32 bits, so they collapsed to one row — under-counting
    // demand exactly when it spikes.
    const same = { assets: 1_000_000n, shares: 1_000_000n, blockNumber: 90 };
    const chain = fakeChain({
      head: 200,
      finalized: 100,
      logs: [withdrawLog({ ...same, index: 0 }), withdrawLog({ ...same, index: 1 })],
    });
    const db = fakePrisma();

    const events = await new WithdrawalTracker(chain.client, VAULT, db.prisma).collectSince(50);

    expect(events).toHaveLength(2);
    expect(new Set(db.upserts.map((u) => u.id)).size).toBe(2);
  });

  it('gives the same log the same id on a re-scan', async () => {
    const log = withdrawLog({ assets: 2_000_000n, shares: 2_000_000n, index: 3 });
    const first = fakePrisma();
    const second = fakePrisma();

    await new WithdrawalTracker(fakeChain({ head: 200, finalized: 100, logs: [log] }).client, VAULT, first.prisma).collectSince(50);
    await new WithdrawalTracker(fakeChain({ head: 300, finalized: 250, logs: [log] }).client, VAULT, second.prisma).collectSince(50);

    expect(first.upserts[0]!.id).toBe(second.upserts[0]!.id);
  });
});

describe('WithdrawalTracker.getWithdrawalHistory', () => {
  it('anchors the window on the supplied origin time and does not filter by market id', async () => {
    // The old signature took a `marketId` and filtered `sender: marketId`.
    // `sender` holds a withdrawing ACCOUNT, so that matched nothing, ever —
    // and it anchored the cutoff on `new Date()`, making the result
    // irreproducible from a snapshot.
    const db = fakePrisma();
    const chain = fakeChain({ head: 200, finalized: 100, logs: [] });
    const tracker = new WithdrawalTracker(chain.client, VAULT, db.prisma);

    const originSeconds = 1_700_000_000;
    await tracker.getWithdrawalHistory(7, originSeconds);

    const where = (db.queries[0] as { where: { sender?: string; timestamp: { gte: Date } } }).where;
    expect(where.sender).toBeUndefined();
    expect(where.timestamp.gte.getTime()).toBe((originSeconds - 7 * 86_400) * 1000);
  });

  it('narrows to a single owner when one is supplied', async () => {
    const db = fakePrisma();
    const chain = fakeChain({ head: 200, finalized: 100, logs: [] });
    const tracker = new WithdrawalTracker(chain.client, VAULT, db.prisma);

    await tracker.getWithdrawalHistory(30, 1_700_000_000, OWNER);

    expect((db.queries[0] as { where: { sender?: string } }).where.sender).toBe(OWNER);
  });

  it('returns the persisted assets as bigints', async () => {
    const db = fakePrisma();
    db.rows.push({ assets: '12345678' }, { assets: '999' });
    const chain = fakeChain({ head: 200, finalized: 100, logs: [] });

    const out = await new WithdrawalTracker(chain.client, VAULT, db.prisma).getWithdrawalHistory(
      7,
      1_700_000_000
    );

    expect(out).toEqual([12_345_678n, 999n]);
  });
});
