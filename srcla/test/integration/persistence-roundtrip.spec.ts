/**
 * Proof that `prisma/schema.prisma` survives contact with a real Postgres.
 *
 * Phase 1 carried this as open gap #4: the schema was reviewed as
 * additive-only and push-safe, but `prisma db push` and the persistence
 * round-trip never ran, so every downstream claim about persisted decisions
 * rested on a schema nobody had executed.
 *
 * The specific risk is precision. Every money and rate column is a `String`
 * holding a decimal integer, because Postgres has no 256-bit integer and
 * Prisma's `BigInt` maps to int8. A `Number` coercion anywhere on the write
 * or read path silently truncates above 2^53 -- and `supplyRateE18`,
 * `mwExchangeRate` and the IRM slopes all live above it.
 *
 * Needs the database: `docker compose up -d` then
 *   DATABASE_URL=postgresql://user:password@localhost:5433/srcla pnpm test:integration
 */
import { PrismaClient } from '@prisma/client';

/** > 2^53 (9007199254740992), so a float round-trip cannot reproduce it. */
const ABOVE_FLOAT53 = 987_654_321_098_765_432_109n;
const MARKET = 'roundtrip-compound';

describe('MarketSnapshot persistence round-trip', () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.marketSnapshot.deleteMany({ where: { marketId: MARKET } });
    await prisma.$disconnect();
  });

  it('preserves bigint precision through the String columns', async () => {
    const blockHash = '0x' + 'ab'.repeat(32);
    await prisma.marketSnapshot.create({
      data: {
        marketId: MARKET,
        blockHash,
        timestamp: new Date('2025-01-01T00:00:00Z'),
        totalAssetsBase: '0',
        idleBase: '0',
        supplyRateE18: ABOVE_FLOAT53.toString(),
        utilizationE18: '900000000000000000',
        cashBase: '1',
        borrowsBase: '2',
        reservesBase: '3',
        capBps: 5000,
        paused: false,
        configDigest: '0x' + '11'.repeat(32),
      },
    });

    const row = await prisma.marketSnapshot.findFirstOrThrow({
      where: { marketId: MARKET, blockHash },
    });

    expect(BigInt(row.supplyRateE18)).toBe(ABOVE_FLOAT53);
    expect(BigInt(row.utilizationE18)).toBe(900_000_000_000_000_000n);
  });

  it('enforces the (marketId, blockHash) uniqueness the collector relies on for idempotent re-collection', async () => {
    const blockHash = '0x' + 'cd'.repeat(32);
    const data = {
      marketId: MARKET,
      blockHash,
      timestamp: new Date('2025-01-02T00:00:00Z'),
      totalAssetsBase: '0',
      idleBase: '0',
      supplyRateE18: '1',
      utilizationE18: '1',
      cashBase: '1',
      borrowsBase: '1',
      reservesBase: '1',
      capBps: 5000,
      paused: false,
      configDigest: '0x' + '22'.repeat(32),
    };
    await prisma.marketSnapshot.create({ data });
    await expect(prisma.marketSnapshot.create({ data })).rejects.toThrow();
  });
});
