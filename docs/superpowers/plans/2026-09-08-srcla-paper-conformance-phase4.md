# SRCLA Paper Conformance — Phase 4 Implementation Plan (Dataset, Eras, Registered Run)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the honest held-out dataset the registered §11 evaluation needs, freeze the eras, the manifest and the forecast artifact, run B0–B5 / H1–H7 at four tiers, and regenerate `SRCLA-REPORT.{md,json}` with a reproducible `PASS` or `FAIL`.

**Architecture:** A resumable archive backfill reads Base mainnet directly at hourly origins through Multicall3, so one `eth_call` per origin yields every venue's raw IRM state, the block header, the L1/L2 gas parameters and the two Chainlink feeds. Those rows land in `MarketSnapshot` (raw integers, paper §10.1) and a new `ChainCostSnapshot`. A registered era module then splits that history into a calibration era, a **sealed held-out era**, and the paper's declared burned window — which is excluded from both. The existing `src/evaluation/kernel/` harness, gates and manifest consume the result unchanged.

**Tech Stack:** TypeScript (ESM, NodeNext), Prisma 5 + Postgres 16 on `:5433`, ethers v6, Jest (`*.spec.ts`). Run from `srcla/`.

**Spec:** `docs/superpowers/specs/2026-09-07-srcla-paper-conformance-design.md` §9 and §12 (Phase 4)
**Paper:** `docs/research/output/srcla-paper.md` (v0.5) §2.2, §4.1, §7, §10.1, §11
**Carried from earlier phases:** `docs/superpowers/plans/2026-09-07-srcla-phase1-outcome.md`

---

## Global Constraints

- **Never fabricate data.** No synthetic snapshot, no interpolated origin, no invented rate. A gap in the archive is recorded as a gap and disclosed in the manifest — spec §13's stated fallback is "degrade cadence for the earliest months and record the degradation in the manifest rather than silently interpolating."
- **The held-out era is SEALED.** Until Task 9 runs the registered evaluation, no task may read, print, plot, aggregate or reason about held-out rows. Tasks 6–8 (artifact calibration, grid sweep) query the calibration era **only**, enforced in code by `eras.ts`, not by discipline. Peeking invalidates the entire result under §2.2 and there is no way to un-peek.
- **The burned window `2026-05-26 → 2026-08-23` is design data** (paper §4.1). It is excluded from the calibration era and from every held-out era. See "Era design" below for why this is stricter than §4.1's letter.
- **Money is `bigint` in USDC base units (6 dp); rates are WAD (1e18) annualized; Aave is RAY (1e27); times are seconds.** ESM relative imports carry `.js`.
- **`decide()` stays pure** — no I/O, no `Date.now()`, no randomness. Nothing in this phase changes that.
- **Baseline:** `srcla` `pnpm test:unit` green, `pnpm exec tsc --noEmit` clean, `pnpm typecheck:scripts` clean. Record the starting test count before changing anything.
- **Commit by explicit pathspec** (`git commit -m "..." -- <paths>`); `git add` exact paths only, never `-A`. The working tree carries unrelated user changes.
- **Every commit ends with:**
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_016KXi2riEacocX5ifipzS7f
  ```

---

## Era design — how "no held-out data" is solved

`CLAUDE.md` records the blocker: *"There is no held-out data. The only dataset in the repo spans exactly the paper's declared burned window (2026-05-26 → 2026-08-23)."*

The fix is not to wait for wall-clock time. Base mainnet archive state for all three venues is **available and verified back to at least 2024-09-03** (probed at block `19_300_000`: Comet `getUtilization` = `591542423036707633`, Aave `getReserveData` returns strategy `0x46Da…134E`, Moonwell `getCash` = `12571903786612`). The repository has never read any of it. That makes ~20 months of genuinely unseen history available today.

Registered eras, fixed before any fitting runs:

| Era | Window | Days | Role |
|---|---|---|---|
| **Calibration** | `2024-09-01T00:00:00Z` → `2025-08-31T23:59:59Z` | 365 | The only data any artifact, quantile, grid sweep or `k` may be fit on. |
| **Held-out A (primary, SEALED)** | `2025-09-01T00:00:00Z` → `2026-05-25T23:59:59Z` | 267 | The registered evaluation window. Never read before Task 9. |
| **Burned (EXCLUDED)** | `2026-05-26T00:00:00Z` → `2026-08-23T23:59:59Z` | 90 | Paper §4.1 design data. In neither era. |
| **Held-out B (secondary)** | `2026-08-24T00:00:00Z` → collection time | 16+ | Chronologically clean but low-power confirmation; grows with the live collector. |

**Two deviations must be disclosed in the manifest and the report, not buried:**

1. **§4.1's letter says the burned window "lies inside the calibration era."** Here it lies in neither. Putting it in calibration would place fitting data *after* held-out A in time, inverting walk-forward order and creating exactly the look-ahead §7.3 forbids. Excluding it satisfies §4.1's actual purpose (the window must never be held-out) strictly more than including it would. This is a paper-owner decision recorded here; if the owner rules otherwise, held-out A must be abandoned and only held-out B survives.

2. **Held-out A precedes the burned window in time.** The amendments P1–P8 and the code were designed with knowledge of what happened in May–Aug 2026. Nobody has looked at Sep 2025–May 2026, so there is no direct contamination — but a designer who knew the later period could in principle have chosen mechanisms that happen to suit the earlier one. Held-out B is chronologically clean and carries no such caveat, which is why both are reported: **A for statistical power, B for temporal purity.** Neither alone is sufficient evidence and the report must say so.

---

## File structure

| Path | Responsibility |
|---|---|
| `src/collector/archive/endpoints.ts` | `RpcPool`: multi-endpoint rotation, per-endpoint health, exponential backoff, bounded concurrency. |
| `src/collector/archive/block-index.ts` | Timestamp → block number, by anchored linear estimate plus bounded correction. Pure arithmetic + one probe. |
| `src/collector/archive/calls.ts` | The Multicall3 `aggregate3` call set for one origin, and pure decoders from `returnData` to typed venue/cost readings. No I/O. |
| `src/collector/archive/backfill.ts` | Orchestration: enumerate origins, skip persisted, fetch, decode, persist, report gaps. |
| `scripts/backfill-history.ts` | CLI over `backfill.ts`. Resumable, `--from/--to/--cadence/--concurrency`. |
| `src/evaluation/eras.ts` | The registered era boundaries above, the burned-window declaration, and the guards that make sealing mechanical. |
| `src/evaluation/gas-series.ts` | Load `ChainCostSnapshot` rows into per-origin `GasObservation`s for the harness. |
| `src/forecast/grid-sweep.ts` | The §7.3 registered grid (3 methods × 3 horizons × 3 coverages × params, per venue), fit on the calibration era only. |
| `scripts/freeze-artifact.ts` | Runs the sweep, writes `config/registered-artifact.json` with no `_provisional` field. |
| `prisma/schema.prisma` | `ChainCostSnapshot`; `MarketSnapshot.blockNumber`, `.reserveFactorBps`, `.eraTag`. |

---

## Task Map

| # | Task | Closes |
|---|---|---|
| 1 | Postgres on `:5433`, schema push, persistence round-trip | Phase 1 gap #4 |
| 2 | Schema additions: `ChainCostSnapshot`, `blockNumber`, `reserveFactorBps`, `eraTag` | spec §5.4, §9 |
| 3 | `RpcPool` + `block-index` | spec §9 "resumable, multi-endpoint with backoff" |
| 4 | `calls.ts` — the per-origin call set and its pure decoders | spec §9, paper §10.1 |
| 5 | `backfill.ts` + `scripts/backfill-history.ts`, then RUN it | spec §9 "Dataset" |
| 6 | `src/evaluation/eras.ts` — registered eras and the sealing guard | spec §9 "Eras", paper §4.1 |
| 7 | Measured per-origin gas replaces `harnessConfig()`'s constants | spec §9, Phase 1 gap #7 |
| 8 | Grid sweep → frozen, non-provisional artifact | spec §8, V2, paper §7.3 |
| 9 | Run the registered evaluation; regenerate `SRCLA-REPORT.{md,json}` | spec §9 "Reporting", V5 |

Tasks 1–5 are "prepare the dataset." Tasks 6–9 are "run the experiment." Task 5's run is long (~20–40 min) and is the gate for everything after it.

---

### Task 1: Bring up Postgres and prove the schema

Phase 1 carried gap #4: *"Schema never validated against Postgres — `prisma db push` and the persistence round-trip never ran."* Nothing downstream is trustworthy until it has.

**Files:**
- Create: `srcla/docker-compose.yml`
- Test: `srcla/test/integration/persistence-roundtrip.spec.ts`

**Interfaces:**
- Produces: a reachable `postgresql://user:password@localhost:5433/srcla`, and a proven `MarketSnapshot` write/read round-trip preserving `bigint` precision through the `String` columns.

- [ ] **Step 1: Write the compose file**

`srcla/` has never had one — `CLAUDE.md` says so explicitly ("there is *no* `docker-compose.yml` in `srcla/` — bring your own instance"). That instruction exists because the file was missing, not because it should be. Add it, on `5433:5432`, so the instance is reproducible rather than hand-rolled per operator.

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: srcla-postgres
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
      POSTGRES_DB: srcla
    ports:
      - '5433:5432'
    volumes:
      - srcla-pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U user -d srcla']
      interval: 5s
      timeout: 5s
      retries: 10
volumes:
  srcla-pgdata:
```

- [ ] **Step 2: Bring it up and push the schema**

```bash
cd srcla && docker compose up -d
DATABASE_URL='postgresql://user:password@localhost:5433/srcla' pnpm prisma:push
```
Expected: `Your database is now in sync with your Prisma schema.`

- [ ] **Step 3: Write the round-trip test**

The risk this catches is real and specific: every money column is a `String` holding a decimal `bigint`. A silent `Number` coercion anywhere loses precision above 2^53, and USDC base units at the 10,000,000 tier are 1e13 — under 2^53, but `supplyRateE18` and `mwExchangeRate` are not.

```ts
// srcla/test/integration/persistence-roundtrip.spec.ts
import { PrismaClient } from '@prisma/client';

const BIG = 987_654_321_098_765_432_109n; // > 2^53, breaks under Number coercion

describe('MarketSnapshot persistence round-trip', () => {
  const prisma = new PrismaClient();
  afterAll(async () => { await prisma.$disconnect(); });

  it('preserves bigint precision through the String columns', async () => {
    const blockHash = '0x' + 'ab'.repeat(32);
    await prisma.marketSnapshot.create({
      data: {
        marketId: 'roundtrip-compound', blockHash, timestamp: new Date('2025-01-01T00:00:00Z'),
        totalAssetsBase: '0', idleBase: '0',
        supplyRateE18: BIG.toString(), utilizationE18: '900000000000000000',
        cashBase: '1', borrowsBase: '2', reservesBase: '3',
        capBps: 5000, paused: false, configDigest: '0x' + '11'.repeat(32),
      },
    });
    const row = await prisma.marketSnapshot.findFirstOrThrow({ where: { marketId: 'roundtrip-compound', blockHash } });
    expect(BigInt(row.supplyRateE18)).toBe(BIG);
    await prisma.marketSnapshot.deleteMany({ where: { marketId: 'roundtrip-compound' } });
  });
});
```

- [ ] **Step 4: Run it**

Run: `DATABASE_URL='postgresql://user:password@localhost:5433/srcla' pnpm test:integration -- persistence-roundtrip`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(srcla): a reproducible srcla Postgres, and proof the schema round-trips

Phase 1 carried gap #4: the schema was reviewed as push-safe but never pushed,
and no persistence round-trip ever ran. Adds the compose file srcla never had
and a test that fails on any Number coercion of the bigint String columns.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016KXi2riEacocX5ifipzS7f" -- srcla/docker-compose.yml srcla/test/integration/persistence-roundtrip.spec.ts
```

---

### Task 2: Schema additions for measured costs and archive provenance

The harness currently hardcodes its five gas/price inputs (`scripts/run-registered-evaluation.ts#harnessConfig`, flagged `NOT OBSERVED`, and Phase 1 gap #7: *"Four of five gas/price inputs are placeholders"*). The backfill can measure all five per origin at no extra RPC cost — they ride in the same Multicall3 batch — so the schema must have somewhere to put them.

**Files:**
- Modify: `srcla/prisma/schema.prisma`

**Interfaces:**
- Produces: model `ChainCostSnapshot`; `MarketSnapshot.blockNumber: BigInt?`, `.reserveFactorBps: Int?`, `.eraTag: String?`.

- [ ] **Step 1: Add the cost model**

```prisma
/// Per-origin measured execution-cost inputs (paper §9.1's C_move terms).
/// Every field is READ FROM CHAIN at the origin's block, replacing the five
/// registered constants `run-registered-evaluation.ts#harnessConfig` used to
/// assert. `l1BaseFeeWei`/`l1BlobBaseFeeWei` come from the OP-Stack
/// GasPriceOracle predeploy 0x420...0F; `ethUsdE8`/`usdcUsdE8` from the Base
/// Chainlink feeds; `l2BaseFeeWei` is the block header's own baseFeePerGas.
model ChainCostSnapshot {
  id               String   @id @default(cuid())
  blockNumber      BigInt   @unique
  blockHash        String
  timestamp        DateTime
  l2BaseFeeWei     String
  l1BaseFeeWei     String
  l1BlobBaseFeeWei String
  /// OP-Stack fee scalars, so the L1 data cost is reproducible rather than
  /// assumed. Absent on blocks predating Ecotone.
  baseFeeScalar        Int?
  blobBaseFeeScalar    Int?
  ethUsdE8         String
  usdcUsdE8        String
  /// Chainlink round ids, so a stale feed is detectable after the fact
  /// rather than silently priced.
  ethUsdRoundId    String?
  usdcUsdRoundId   String?

  @@index([timestamp])
}
```

- [ ] **Step 2: Extend `MarketSnapshot`**

Add inside the existing model, after `qualityFlags`:

```prisma
  /// Archive provenance. The live collector keys on blockHash alone; a
  /// backfilled row must also carry the height, because resume, gap
  /// detection and the manifest's pinned-block claim are all expressed in
  /// block numbers.
  blockNumber      BigInt?
  /// Protocol reserve factor, bps. Distinct from `aaveReserveFactorBps`,
  /// which is Aave-specific by name; Compound and Moonwell have one too and
  /// it is a rate-model input, not a cosmetic field.
  reserveFactorBps Int?
  /// Which registered era this origin falls in — 'calibration',
  /// 'heldout-a', 'burned', 'heldout-b'. Denormalised from
  /// `src/evaluation/eras.ts` at write time so the SEALING GUARD is a
  /// database predicate, not a convention a query can forget.
  eraTag           String?
```

Add an index alongside the existing ones: `@@index([eraTag, timestamp])`.

- [ ] **Step 3: Push and verify**

Run:
```bash
DATABASE_URL='postgresql://user:password@localhost:5433/srcla' pnpm prisma:push
DATABASE_URL='postgresql://user:password@localhost:5433/srcla' pnpm test:integration -- persistence-roundtrip
```
Expected: sync succeeds (all additions are nullable, so no data loss prompt); the round-trip still passes.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(srcla): schema room for measured costs and archive provenance

The harness asserted five gas/price constants because nothing persisted the
measured ones. The backfill reads all five in the same multicall as the venue
state, so they cost nothing extra to collect and everything to omit.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016KXi2riEacocX5ifipzS7f" -- srcla/prisma/schema.prisma
```

---

### Task 3: `RpcPool` and the block index

Measured, not assumed: `https://mainnet.base.org` rate-limits to ~1.6 calls/s and drops 11 of 16 requests at concurrency 3. Three other free endpoints sustain 5.5–8.3 calls/s at that concurrency with **zero** drops: `https://base.drpc.org`, `https://base-mainnet.public.blastapi.io`, `https://gateway.tenderly.co/public/base`. A single-endpoint backfill is therefore not merely slow, it is unreliable — the pool is load-bearing.

**Files:**
- Create: `srcla/src/collector/archive/endpoints.ts`
- Create: `srcla/src/collector/archive/block-index.ts`
- Test: `srcla/test/unit/collector/archive/block-index.spec.ts`

**Interfaces:**
- Produces:
  - `class RpcPool { constructor(urls: readonly string[], opts?: { concurrencyPerEndpoint?: number; maxAttempts?: number }); call<T>(fn: (p: JsonRpcProvider) => Promise<T>): Promise<T>; stats(): Array<{ url: string; ok: number; failed: number; cooldownUntilMs: number }> }`
  - `const ARCHIVE_ENDPOINTS: readonly string[]`
  - `estimateBlockForTimestamp(anchor: { blockNumber: number; timestampSeconds: number }, targetSeconds: number, blockTimeSeconds: number): number`
  - `async function resolveBlockAtOrBefore(pool: RpcPool, targetSeconds: number, anchor: BlockAnchor): Promise<{ blockNumber: number; timestampSeconds: number }>`

- [ ] **Step 1: Write the failing test for the block estimator**

The estimator is the only part of this task that is pure and therefore the only part worth unit-testing; the pool's behaviour is network-shaped and is verified by Task 5's run.

```ts
// srcla/test/unit/collector/archive/block-index.spec.ts
import { estimateBlockForTimestamp } from '../../../../src/collector/archive/block-index.js';

const ANCHOR = { blockNumber: 19_300_000, timestampSeconds: 1_725_389_347 };

describe('estimateBlockForTimestamp', () => {
  it('returns the anchor block for the anchor timestamp', () => {
    expect(estimateBlockForTimestamp(ANCHOR, ANCHOR.timestampSeconds, 2)).toBe(19_300_000);
  });

  it('advances one block per two seconds forward', () => {
    expect(estimateBlockForTimestamp(ANCHOR, ANCHOR.timestampSeconds + 3600, 2)).toBe(19_301_800);
  });

  it('rewinds symmetrically backward', () => {
    expect(estimateBlockForTimestamp(ANCHOR, ANCHOR.timestampSeconds - 3600, 2)).toBe(19_298_200);
  });

  it('never returns a negative height', () => {
    expect(estimateBlockForTimestamp(ANCHOR, 0, 2)).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test:unit -- block-index`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `endpoints.ts`**

`RpcPool.call` picks the healthiest endpoint not in cooldown, runs the caller's function against its `JsonRpcProvider`, and on failure puts that endpoint in exponential cooldown (250 ms → 8 s, capped) and retries on the next one, up to `maxAttempts` across endpoints. It exposes `stats()` so the backfill can report which endpoint carried the run — an operator who sees one endpoint at 90% failure needs that visible, not averaged away.

Set `staticNetwork: true` on every provider: without it ethers issues an `eth_chainId` per provider per call batch, which on a rate-limited public endpoint is a wasted request in the budget.

Pin `ARCHIVE_ENDPOINTS` to the three verified-clean endpoints, with `https://mainnet.base.org` last as a fallback rather than first — it is the official one and the *worst* performing, which is exactly the trap a default ordering would fall into.

- [ ] **Step 4: Implement `block-index.ts`**

`estimateBlockForTimestamp` is `anchor.blockNumber + round((target - anchor.timestampSeconds) / blockTimeSeconds)`, clamped at 0. Base produces blocks on a fixed 2-second cadence, so this lands within a handful of blocks over a two-year span.

`resolveBlockAtOrBefore` takes the estimate, fetches that header, and walks by the residual `(target - header.timestamp) / blockTime` until the header is the newest block at or before the target — bounded to 8 iterations, throwing rather than looping if the chain is not behaving as assumed. It must return the block **at or before** the target, never after: an origin that reads state from the future is a look-ahead leak, and one that reads a few seconds early is merely a slightly stale origin.

- [ ] **Step 5: Verify**

Run: `pnpm test:unit -- block-index && pnpm exec tsc --noEmit`
Expected: 4 passing, tsc clean.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(srcla): a multi-endpoint archive RPC pool and a block-at-timestamp index

Measured, not assumed: mainnet.base.org sustains 1.6 calls/s and drops 11 of 16
requests at concurrency 3, while drpc/blastapi/tenderly sustain 5.5-8.3 with
none. A single-endpoint backfill of 17k origins is not slow, it is unreliable.
resolveBlockAtOrBefore returns the block AT OR BEFORE the target so an origin
can never read state from after its own timestamp.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016KXi2riEacocX5ifipzS7f" -- srcla/src/collector/archive/endpoints.ts srcla/src/collector/archive/block-index.ts srcla/test/unit/collector/archive/block-index.spec.ts
```

---

### Task 4: The per-origin call set and its pure decoders

The live `SnapshotCollector` reads venue state **through the deployed adapter contracts** (`ADAPTER_IFACE`, `comet()`, `aToken()`, `mToken()`, `supplyRatePerYear()`). Those adapters exist only on the Anvil fork; they have no Base mainnet history. **The backfill therefore cannot reuse `SnapshotCollector` and must read the protocols directly** — this is the single most important structural fact in the phase, and the reason `calls.ts` exists rather than a `blockNumber` parameter on the existing collector.

All addresses and shapes below were verified on Base at block `19_300_000` (2024-09-03) and `35_338_178` (2025-09-10).

**Files:**
- Create: `srcla/src/collector/archive/calls.ts`
- Test: `srcla/test/unit/collector/archive/calls.spec.ts`

**Interfaces:**
- Consumes: `RpcPool` from Task 3.
- Produces:
  - `interface ArchiveAddresses { comet, aavePool, aaveAToken, aaveVariableDebt, aaveStrategy, mToken, mComptroller, mInterestRateModel, usdc, multicall3, gasOracle, ethUsdFeed, usdcUsdFeed }`
  - `async function resolveAddresses(pool: RpcPool, blockNumber: number): Promise<ArchiveAddresses>`
  - `function buildOriginCalls(addr: ArchiveAddresses, blockNumber: number): Multicall3Call[]`
  - `function decodeOrigin(addr: ArchiveAddresses, results: readonly Multicall3Result[]): OriginReading`
  - `interface OriginReading { blockNumber, blockHash, timestampSeconds, markets: VenueReading[], cost: CostReading, failures: string[] }`
  - `interface VenueReading { marketId, supplyRateE18, utilizationE18, cashBase, borrowsBase, reservesBase, paused, configDigest, raw: Record<string, bigint | null>, irm: IrmReading | null }`

- [ ] **Step 1: Pin the registered constants**

```ts
/** Base mainnet, verified on-chain. Do NOT copy from memory or from
 *  DEPLOYMENTS.md's retired Sepolia section. */
export const BASE = {
  usdc:        '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  comet:       '0xb125E6687d4313864e53df431d5425969c15Eb2F',
  aavePool:    '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
  mToken:      '0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22',
  multicall3:  '0xcA11bde05977b3631167028862bE2a173976CA11',
  gasOracle:   '0x420000000000000000000000000000000000000F',
  ethUsdFeed:  '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',
  usdcUsdFeed: '0x7e860098F58bBFC8648a4311b374B1D669a2bc6B',
} as const;

/** The registered market ids. They must contain 'aave' / 'compound' /
 *  'moonwell' because `src/domain/protocol.ts#protocolOf` classifies by
 *  substring and THROWS otherwise, and they must match
 *  `config/evaluation-manifest.json`'s `markets[].marketId`. */
export const MARKET_IDS = {
  aave: 'aave-v3-usdc',
  compound: 'compound-v3-usdc',
  moonwell: 'moonwell-usdc',
} as const;
```

- [ ] **Step 2: Write the call set**

One `aggregate3` per origin, `allowFailure: true` on every leg so one dead venue degrades that venue rather than the origin. Multicall3's own helpers supply the header, which is why no separate `eth_getBlockByNumber` is needed:

```
Multicall3: getBlockNumber(), getCurrentBlockTimestamp(), getBlockHash(n-1), getBasefee()
Comet:      getUtilization(), totalSupply(), isSupplyPaused(), totalsBasic(),
            supplyKink(), supplyPerSecondInterestRateBase(),
            supplyPerSecondInterestRateSlopeLow(), supplyPerSecondInterestRateSlopeHigh()
USDC:       balanceOf(comet), balanceOf(aaveAToken)
Aave Pool:  getReserveData(usdc), getVirtualUnderlyingBalance(usdc)
Aave vDebt: totalSupply()
Aave strat: getInterestRateDataBps(usdc)
mToken:     getCash(), totalBorrows(), totalReserves(), supplyRatePerTimestamp(),
            exchangeRateStored(), reserveFactorMantissa()
Comptroller:mintGuardianPaused(mToken)
Moonwell IRM: kink(), baseRatePerTimestamp(), multiplierPerTimestamp(),
            jumpMultiplierPerTimestamp(), timestampsPerYear()
GasOracle:  l1BaseFee(), blobBaseFee(), baseFeeScalar(), blobBaseFeeScalar()
Chainlink:  ethUsd.latestRoundData(), usdcUsd.latestRoundData()
```

`getSupplyRate(utilization)` is **not** in the batch: it needs the utilization the same batch is fetching. Compute the Comet supply rate from the decoded IRM parameters instead — that is the same arithmetic the adapter performs, and it keeps the batch to one round trip.

- [ ] **Step 3: Handle the two shapes that change over the window**

Both were observed to differ between 2024-09 and 2025-09 and a decoder that assumes either one silently corrupts half the dataset:

- **Moonwell's `interestRateModel()` address changes** (`0x54dC…2445` at block 19.3M, `0x0F70…6cab` at 35.3M). `resolveAddresses` must therefore be called **per resume-chunk, not once for the run**, and the IRM address must be re-read whenever the chunk's start block moves. Record the model address on the row so a later reader can tell which model produced the parameters.
- **Aave's rate strategy is versioned.** `getInterestRateDataBps(asset)` (returning bps `(optimalUsageRatio, baseVariableBorrowRate, variableRateSlope1, variableRateSlope2)` — observed `9000,0,650,6000` at 19.3M and `9000,175,625,4000` at 35.3M) is the V3.2 shape. Where that leg fails, fall back to the V3.0 getters `OPTIMAL_USAGE_RATIO()` / `getBaseVariableBorrowRate()` / `getVariableRateSlope1()` / `getVariableRateSlope2()` in a second, small batch — and where BOTH fail, write `irm: null` rather than defaults. A null IRM is a disclosed gap; `DEFAULT_AAVE_CONFIG` silently substituted is a fabricated one.

- [ ] **Step 4: Write the decoder tests against recorded fixtures**

These tests must not touch the network. Capture the raw `aggregate3` `returnData` hex once from block `19_300_000` into `test/fixtures/archive-origin-19300000.json` and assert the decoder's output against the values verified on chain:

```ts
// srcla/test/unit/collector/archive/calls.spec.ts
import { decodeOrigin } from '../../../../src/collector/archive/calls.js';
import fixture from '../../../fixtures/archive-origin-19300000.json';

describe('decodeOrigin', () => {
  const reading = decodeOrigin(fixture.addresses, fixture.results);

  it('decodes Compound utilization as Comet reports it, not recomputed', () => {
    const c = reading.markets.find((m) => m.marketId === 'compound-v3-usdc')!;
    expect(c.utilizationE18).toBe(591542423036707633n);
  });

  it('decodes Moonwell cash in USDC base units', () => {
    const m = reading.markets.find((m) => m.marketId === 'moonwell-usdc')!;
    expect(m.cashBase).toBe(12571903786612n);
  });

  it("annualizes Compound's PER-SECOND slopes to WAD-annual", () => {
    // supplyPerSecondInterestRateSlopeLow = 1141552511 at block 35338178;
    // x 31_557_600 s/yr = 3.602...e16 WAD ~= 3.60% -- NOT the 6.25% placeholder
    // in DEFAULT_COMPOUND_CONFIG, which is why this must be read, not assumed.
    const c = reading.markets.find((m) => m.marketId === 'compound-v3-usdc')!;
    expect(c.irm!.slopeLowWad).toBeGreaterThan(0n);
    expect(c.irm!.kinkRay).toBe(900_000_000_000_000_000n); // 90%, not the 80% default
  });

  it('reports a failed leg as a named failure rather than a zero', () => {
    const withDead = { ...fixture, results: fixture.results.map((r, i) => (i === 4 ? { success: false, returnData: '0x' } : r)) };
    const out = decodeOrigin(withDead.addresses, withDead.results);
    expect(out.failures.length).toBeGreaterThan(0);
    expect(out.markets.every((m) => m.cashBase >= 0n)).toBe(true);
  });
});
```

The third test is the load-bearing one. `DEFAULT_COMPOUND_CONFIG` asserts an 80% kink and a 6.25% low slope; the chain says 90% and ~3.6%. A backfill that captured state but not IRM parameters would leave the optimiser simulating a rate model that does not exist, and H1 (capacity simulation) would be ablating a fiction.

- [ ] **Step 5: Run the tests**

Run: `pnpm test:unit -- calls`
Expected: 4 passing.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(srcla): read the three venues directly at a historical block

SnapshotCollector reads venue state THROUGH the deployed adapters, which exist
only on the Anvil fork and have no Base mainnet history -- so the backfill
cannot reuse it and reads Comet/Pool/mToken directly. One multicall3 aggregate3
per origin carries the header, both IRM shapes, the OP-Stack gas parameters and
both Chainlink feeds. Compound's real kink is 90% and its low slope ~3.6%
annualized, against DEFAULT_COMPOUND_CONFIG's placeholder 80% and 6.25%.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016KXi2riEacocX5ifipzS7f" -- srcla/src/collector/archive/calls.ts srcla/test/unit/collector/archive/calls.spec.ts srcla/test/fixtures/archive-origin-19300000.json
```

---

### Task 5: The backfill orchestrator, and the run

**Files:**
- Create: `srcla/src/collector/archive/backfill.ts`
- Create: `srcla/scripts/backfill-history.ts`
- Modify: `srcla/package.json` (add `backfill:history`)
- Test: `srcla/test/unit/collector/archive/backfill.spec.ts`

**Interfaces:**
- Consumes: `RpcPool`, `resolveBlockAtOrBefore`, `resolveAddresses`, `buildOriginCalls`, `decodeOrigin`.
- Produces:
  - `function enumerateOrigins(fromSeconds: number, toSeconds: number, cadenceSeconds: number): number[]`
  - `async function runBackfill(prisma, pool, opts: BackfillOptions): Promise<BackfillSummary>`
  - `interface BackfillSummary { requested: number; persisted: number; skipped: number; gaps: Array<{ timestampSeconds: number; reason: string }>; endpointStats: ReturnType<RpcPool['stats']> }`

- [ ] **Step 1: Write the failing tests for origin enumeration and resume**

```ts
// srcla/test/unit/collector/archive/backfill.spec.ts
import { enumerateOrigins } from '../../../../src/collector/archive/backfill.js';

describe('enumerateOrigins', () => {
  it('emits one origin per cadence, inclusive of the start', () => {
    const o = enumerateOrigins(1_000_000, 1_000_000 + 3 * 3600, 3600);
    expect(o).toEqual([1_000_000, 1_003_600, 1_007_200, 1_010_800]);
  });

  it('is aligned to the cadence so a resumed run reproduces the same origins', () => {
    const a = enumerateOrigins(1_725_148_800, 1_725_148_800 + 86_400, 3600);
    const b = enumerateOrigins(1_725_148_800 + 43_200, 1_725_148_800 + 86_400, 3600);
    expect(a.filter((t) => t >= 1_725_148_800 + 43_200)).toEqual(b);
  });

  it('rejects a cadence that does not divide an hour', () => {
    expect(() => enumerateOrigins(0, 3600, 700)).toThrow(/cadence/i);
  });
});
```

The second test is the one that matters. A resumed run whose origins are offset from the first run's produces two interleaved half-datasets that look like one dense dataset, and `deriveCompletedLabels` would average rates across an irregular grid without complaining.

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm test:unit -- backfill`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `backfill.ts`**

- Enumerate origins on the aligned grid.
- **Resume by querying what is already persisted** (`SELECT timestamp FROM MarketSnapshot WHERE eraTag IS NOT NULL`) into a `Set` and skipping those origins. Resume must be driven by the database, not a cursor file: a cursor file and the database disagree the moment a run is killed mid-write.
- For each origin: resolve the block at or before it, build and run the batch, decode, and persist three `MarketSnapshot` rows plus one `ChainCostSnapshot` in a single `prisma.$transaction`. A partial origin — two venues written and one not — is worse than a missing one, because `deriveCompletedLabels` would treat the absent venue as having no observation in that window rather than as a gap.
- Stamp `eraTag` at write time from `src/evaluation/eras.ts` (Task 6). If Task 6 has not landed, stamp `null` and backfill the tag in Task 6's step 4 — do **not** invent a local copy of the boundaries.
- Record every failure in `gaps[]` with its reason. Print a summary that states persisted, skipped, gap count and per-endpoint stats. **Never** write a row with a substituted value.

- [ ] **Step 4: Implement the CLI**

```
Usage: DATABASE_URL=... pnpm backfill:history \
  --from 2024-09-01T00:00:00Z --to 2026-09-08T00:00:00Z \
  [--cadence 3600] [--concurrency 3] [--limit N] [--dry-run]
```

`--limit` exists so the first invocation can be a 24-origin smoke test against the real chain before committing to a multi-hour run. `--dry-run` decodes and prints without writing.

- [ ] **Step 5: Smoke-test against the real chain**

```bash
cd srcla
DATABASE_URL='postgresql://user:password@localhost:5433/srcla' \
  pnpm backfill:history --from 2024-09-01T00:00:00Z --to 2026-09-08T00:00:00Z --limit 24
```
Expected: 24 origins persisted, 0 gaps, and three market rows per origin. Then check the values are sane, in SQL, before trusting 17,000 more of them:

```sql
SELECT "marketId", count(*), min("supplyRateE18"::numeric), max("supplyRateE18"::numeric)
FROM "MarketSnapshot" GROUP BY 1;
```
A `supplyRateE18` of 0, or a utilization above 1e18 for Compound, means the decoder is wrong and the full run must not start.

- [ ] **Step 6: Run the full backfill**

```bash
DATABASE_URL='postgresql://user:password@localhost:5433/srcla' \
  pnpm backfill:history --from 2024-09-01T00:00:00Z --to 2026-09-08T00:00:00Z \
  2>&1 | tee backfill-$(date +%Y%m%d-%H%M).log
```
~17,700 origins at ~15 calls/s across the pool: expect 20–40 minutes. It is resumable, so an interruption costs only the origins in flight. Re-run the same command to continue.

- [ ] **Step 7: Verify coverage before declaring the dataset ready**

```sql
SELECT date_trunc('month', timestamp) AS month, count(DISTINCT timestamp) AS origins,
       count(*) FILTER (WHERE "irmKinkRay" IS NULL) AS missing_irm
FROM "MarketSnapshot" GROUP BY 1 ORDER BY 1;
```
Expect ~720 origins per full month and three rows per origin. Any month materially below that is a gap to disclose in the manifest, not to interpolate.

- [ ] **Step 8: Commit (code only — never the database or the log)**

```bash
git commit -m "feat(srcla): a resumable archive backfill of Base venue history

Phase 4's dataset. One aggregate3 per hourly origin over the registered window,
resumed from what the database already holds rather than a cursor file, written
one origin per transaction so a partial origin cannot masquerade as a complete
one. A failed leg is recorded as a gap; nothing is ever substituted.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016KXi2riEacocX5ifipzS7f" -- srcla/src/collector/archive/backfill.ts srcla/scripts/backfill-history.ts srcla/package.json srcla/test/unit/collector/archive/backfill.spec.ts
```

---

### Task 6: Registered eras and a mechanical sealing guard

**Files:**
- Create: `srcla/src/evaluation/eras.ts`
- Test: `srcla/test/unit/evaluation/eras.spec.ts`
- Modify: `srcla/src/evaluation/dataset.ts` (era-scoped loading)

**Interfaces:**
- Produces:
  - `type EraTag = 'calibration' | 'heldout-a' | 'burned' | 'heldout-b'`
  - `const REGISTERED_ERAS: Readonly<Record<EraTag, { startSeconds: number; endSeconds: number; sealed: boolean; role: string }>>`
  - `function eraFor(timestampSeconds: number): EraTag | null`
  - `function assertNotSealed(tag: EraTag, purpose: string): void`
  - `async function loadEra(prisma, tag: EraTag, purpose: string): Promise<EvaluationDataset>`

- [ ] **Step 1: Write the failing tests**

```ts
// srcla/test/unit/evaluation/eras.spec.ts
import { eraFor, assertNotSealed, REGISTERED_ERAS } from '../../../src/evaluation/eras.js';

const at = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

describe('registered eras', () => {
  it('places the paper§4.1 burned window in its own era, in neither calibration nor held-out', () => {
    expect(eraFor(at('2026-05-26T00:00:00Z'))).toBe('burned');
    expect(eraFor(at('2026-08-23T12:00:00Z'))).toBe('burned');
  });

  it('never lets the burned window fall inside a held-out era', () => {
    for (const tag of ['heldout-a', 'heldout-b'] as const) {
      const e = REGISTERED_ERAS[tag];
      const b = REGISTERED_ERAS['burned'];
      expect(e.endSeconds < b.startSeconds || e.startSeconds > b.endSeconds).toBe(true);
    }
  });

  it('orders calibration strictly before the primary held-out era', () => {
    expect(REGISTERED_ERAS['calibration'].endSeconds).toBeLessThan(REGISTERED_ERAS['heldout-a'].startSeconds);
  });

  it('refuses to hand sealed data to a fitting purpose', () => {
    expect(() => assertNotSealed('heldout-a', 'artifact calibration')).toThrow(/sealed/i);
    expect(() => assertNotSealed('calibration', 'artifact calibration')).not.toThrow();
  });

  it('leaves no gap and no overlap between adjacent eras', () => {
    const spans = Object.values(REGISTERED_ERAS).sort((a, b) => a.startSeconds - b.startSeconds);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]!.startSeconds).toBe(spans[i - 1]!.endSeconds + 1);
    }
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm test:unit -- eras`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `eras.ts` with the boundaries from "Era design"**

`sealed: true` on `heldout-a` and `heldout-b`. `assertNotSealed` throws with the purpose in the message. `loadEra` takes a `purpose` string and calls `assertNotSealed` before it queries — so the guard cannot be forgotten by a caller who only imports `loadDataset`.

The module's header comment must carry the two disclosed deviations from "Era design" verbatim. A future reader who finds only the numbers will not know they were deliberate.

- [ ] **Step 4: Stamp `eraTag` on the persisted rows**

```bash
DATABASE_URL=... pnpm exec tsx -e "
import { PrismaClient } from '@prisma/client';
import { eraFor } from './src/evaluation/eras.js';
const p = new PrismaClient();
const rows = await p.marketSnapshot.findMany({ where: { eraTag: null }, select: { id: true, timestamp: true } });
for (const r of rows) {
  const tag = eraFor(Math.floor(r.timestamp.getTime() / 1000));
  if (tag !== null) await p.marketSnapshot.update({ where: { id: r.id }, data: { eraTag: tag } });
}
console.log('stamped', rows.length);
await p.\$disconnect();"
```

- [ ] **Step 5: Verify the split is real, WITHOUT looking at held-out values**

Counting rows per era is not peeking; reading their rates is. Run only this:

```sql
SELECT "eraTag", count(DISTINCT timestamp) AS origins,
       min(timestamp) AS first, max(timestamp) AS last
FROM "MarketSnapshot" GROUP BY 1 ORDER BY 2 DESC;
```
Expect roughly: calibration ~8,760 origins, heldout-a ~6,400, burned ~2,160, heldout-b ~380.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(srcla): registered eras, and a sealing guard that is not a convention

CLAUDE.md recorded 'there is no held-out data' because the only dataset spanned
exactly the burned window. Base archive state for all three venues reads back to
2024-09, none of which this repository has ever looked at, so the fix is 267 days
of genuinely sealed data rather than waiting for wall-clock. assertNotSealed
makes the seal a precondition of loading rather than a rule a query can forget.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016KXi2riEacocX5ifipzS7f" -- srcla/src/evaluation/eras.ts srcla/src/evaluation/dataset.ts srcla/test/unit/evaluation/eras.spec.ts
```

---

### Task 7: Measured per-origin gas replaces the registered constants

`harnessConfig()` asserts `l2BaseFeeWei: 30_000_000n`, `ethUsdE8: 350_000_000_000n` and three more, all flagged `NOT OBSERVED`. Task 5 measured every one of them at every origin. The §9.1 cost gate is the mechanism H3 ablates, so feeding it a constant makes H3's result a statement about a constant.

**Files:**
- Create: `srcla/src/evaluation/gas-series.ts`
- Modify: `srcla/src/evaluation/kernel/decision-input.ts` (per-origin gas), `srcla/src/evaluation/kernel/harness.ts`, `srcla/scripts/run-registered-evaluation.ts`
- Test: `srcla/test/unit/evaluation/gas-series.spec.ts`

**Interfaces:**
- Produces:
  - `interface GasSeries { at(originSeconds: number): GasObservation }`
  - `async function loadGasSeries(prisma, startDate: Date, endDate: Date): Promise<GasSeries>`
  - `function gasSeriesFrom(rows: readonly GasRow[]): GasSeries`
- Changes: `HarnessConfig.gas` becomes `GasObservation | GasSeries`; `buildDecisionInput` resolves it at `originSeconds`.

- [ ] **Step 1: Write the failing test**

```ts
// srcla/test/unit/evaluation/gas-series.spec.ts
import { gasSeriesFrom } from '../../../src/evaluation/gas-series.js';

const row = (t: number, eth: bigint) => ({
  timestampSeconds: t, l2BaseFeeWei: 1n, l1BaseFeeWei: 2n, l1BlobBaseFeeWei: 3n,
  ethUsdE8: eth, usdcUsdE8: 100_000_000n,
});

describe('gasSeriesFrom', () => {
  const s = gasSeriesFrom([row(1000, 300_000_000_000n), row(2000, 400_000_000_000n)]);

  it('returns the observation at an exact origin', () => {
    expect(s.at(2000).ethUsdE8).toBe(400_000_000_000n);
  });

  it('carries the LAST observation at or before an origin, never a later one', () => {
    expect(s.at(1500).ethUsdE8).toBe(300_000_000_000n);
  });

  it('throws before the first observation rather than extrapolating backwards', () => {
    expect(() => s.at(999)).toThrow(/no gas observation/i);
  });
});
```

The third test is the point: extrapolating a gas price backwards into a period nobody measured is a fabricated cost, and a fabricated cost moves the §9.1 gate.

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm test:unit -- gas-series`

- [ ] **Step 3: Implement and wire it**

`gasSeriesFrom` sorts once and binary-searches. `buildDecisionInput` gains no new parameter — it reads `config.gas`, which is now either a constant observation (preserving every existing test) or a series it resolves at `originSeconds`. Narrow with a type guard, not a cast.

In `run-registered-evaluation.ts`, replace the five constants with `await loadGasSeries(prisma, startDate, endDate)` and **remove the corresponding entries from `NOT_OBSERVED`** — leaving them there after they are observed is the same class of defect as the gate that passed on absence.

- [ ] **Step 4: Verify**

Run: `pnpm test:unit && pnpm exec tsc --noEmit`
Expected: the new suite passes and the pre-existing count is unchanged apart from the additions. If an existing harness test breaks, it is asserting against the old constants — port it, do not delete it.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(srcla): price the cost gate from measured chain state, not constants

harnessConfig asserted five gas and oracle values flagged NOT OBSERVED. The
backfill measures all five at every origin in the same multicall as the venue
state. H3 ablates the cost gate, so a constant-priced gate makes H3's result a
statement about the constant. The series refuses to extrapolate backwards.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016KXi2riEacocX5ifipzS7f" -- srcla/src/evaluation/gas-series.ts srcla/src/evaluation/kernel/decision-input.ts srcla/src/evaluation/kernel/harness.ts srcla/scripts/run-registered-evaluation.ts srcla/test/unit/evaluation/gas-series.spec.ts
```

---

### Task 8: The grid sweep, and a frozen non-provisional artifact

`config/bootstrap-artifact.json` carries `_provisional`, which the §11.5 gate treats as a hard block ("Calibrated artifact"). Its own notes say `noTradeBandK: 1.0` "carries no such registration and was never swept" and that calibrating it "needs the same multi-month collected MarketSnapshot series" — which Task 5 has now produced.

`src/forecast/select.ts` is the F1/F2/F3 defect site and is imported by nothing; it uses `require()` inside an ESM module and would throw if it ever were. **Do not repair it in place** — build `grid-sweep.ts` against the calibration era and delete `select.ts` in the same commit, so there is one grid rather than two.

**Files:**
- Create: `srcla/src/forecast/grid-sweep.ts`
- Create: `srcla/scripts/freeze-artifact.ts`
- Delete: `srcla/src/forecast/select.ts` (and its spec, if any)
- Modify: `srcla/src/policy/artifact.ts` (load a registered artifact with no `_provisional`)
- Test: `srcla/test/unit/forecast/grid-sweep.spec.ts`

**Interfaces:**
- Produces:
  - `interface GridPoint { method: 'rolling' | 'ew-residual' | 'direct-arx'; methodParams: Record<string, number>; horizonSeconds: 86400 | 604800 | 1209600; coverageTarget: 0.9 | 0.95 | 0.99 }`
  - `function registeredGrid(): GridPoint[]`
  - `function sweep(labelsByEra: CompletedLabel[], grid: GridPoint[]): Array<{ point: GridPoint; loss: SelectionLoss; quantileWadByMarket: Record<string, bigint> }>`
  - `function selectPoint(results): { point: GridPoint; reason: string }`
  - `function solveQuantileForCoverage(residuals: bigint[], target: number): bigint`

- [ ] **Step 1: Write the failing tests**

```ts
// srcla/test/unit/forecast/grid-sweep.spec.ts
import { registeredGrid, solveQuantileForCoverage } from '../../../src/forecast/grid-sweep.js';

describe('registeredGrid', () => {
  it('crosses 3 methods x 3 horizons x 3 coverages, per the amended §7.2 grid', () => {
    const g = registeredGrid();
    expect(new Set(g.map((p) => p.method)).size).toBe(3);
    expect(new Set(g.map((p) => p.horizonSeconds))).toEqual(new Set([86_400, 604_800, 1_209_600]));
    expect(new Set(g.map((p) => p.coverageTarget))).toEqual(new Set([0.9, 0.95, 0.99]));
  });

  it('evaluates 99% coverage, which no previous candidate ever did', () => {
    expect(registeredGrid().some((p) => p.coverageTarget === 0.99)).toBe(true);
  });
});

describe('solveQuantileForCoverage', () => {
  const residuals = Array.from({ length: 100 }, (_, i) => BigInt(i - 50) * 10n ** 15n);

  it('SOLVES the quantile to hit the target rather than fixing it at 5%', () => {
    const q90 = solveQuantileForCoverage(residuals, 0.9);
    const q99 = solveQuantileForCoverage(residuals, 0.99);
    expect(q99).toBeLessThan(q90); // a tighter target needs a deeper bound
  });

  it('achieves at least the requested coverage on its own sample', () => {
    for (const target of [0.9, 0.95, 0.99]) {
      const q = solveQuantileForCoverage(residuals, target);
      const covered = residuals.filter((r) => r >= q).length / residuals.length;
      expect(covered).toBeGreaterThanOrEqual(target);
    }
  });

  it('never returns a positive shrink', () => {
    const allPositive = [1n, 2n, 3n].map((x) => x * 10n ** 15n);
    expect(solveQuantileForCoverage(allPositive, 0.95)).toBeLessThanOrEqual(0n);
  });
});
```

The second `solveQuantileForCoverage` test is P1's whole content: the report's finding was that *"all nine candidates used `q=5%` irrespective of target"*, so a quantile that does not move with the target is the defect restated.

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm test:unit -- grid-sweep`

- [ ] **Step 3: Implement the sweep**

`sweep` fits each grid point on the calibration era's completed labels — obtained through `loadEra(prisma, 'calibration', 'grid sweep')`, which is what makes the seal mechanical — scores it with the §7.3 loss already implemented in `src/evaluation/metrics/forecast.ts` (do not write a second loss), and solves the per-venue quantile to the point's target.

`selectPoint` picks the minimum loss and returns the reason, including the runner-up and the margin, so the choice is auditable rather than a bare winner.

- [ ] **Step 4: Sweep `noTradeBandK` on the same era**

P8's `k` is registered by the same rule and is currently an uncalibrated `1.0`. Sweep `k ∈ {0, 0.25, 0.5, 1, 2, 4}` on the calibration era, scoring turnover against realized return, and record the selected value with its sweep table. If the sweep is flat — every `k` scores within noise — record `k` as **unresolved** and keep `1.0` with the sweep table as evidence. An unresolved sweep honestly reported is a result; a value chosen because it makes a gate move is not.

- [ ] **Step 5: Write `freeze-artifact.ts`**

It runs the sweep, then writes `config/registered-artifact.json` containing the selected method, params, horizon, coverage target, per-venue quantiles, per-venue cash quantiles, `noTradeBandK`, `minObservations`, `availabilityLagSeconds`, the calibration era bounds, the row count it was fit on, and the artifact hash. **It must not write `_provisional`.** It must refuse to run if any origin it reads carries a sealed `eraTag` — `loadEra` already enforces that, and the script asserts it a second time because this is the one file where a mistake is unrecoverable.

- [ ] **Step 6: Run it**

```bash
DATABASE_URL='postgresql://user:password@localhost:5433/srcla' pnpm exec tsx scripts/freeze-artifact.ts --out config/registered-artifact.json
```
Print the selected point, the runner-up, the margin, the per-venue quantiles and the `k` sweep table. Read them: a coverage target of 0.99 selected with a quantile near zero means too few labels, not a confident forecast.

- [ ] **Step 7: Verify and commit**

Run: `pnpm test:unit && pnpm exec tsc --noEmit && pnpm typecheck:scripts`

```bash
git commit -m "feat(srcla): the registered forecast grid, swept on calibration data only

Closes F1/F2/F3 and the artifact half of the release gate. select.ts declared a
3x3 grid, traversed one horizon, used q=5% for every coverage target and
derived rmse as mae x 1.2 -- and was imported by nothing, so it is deleted
rather than repaired. The quantile is now SOLVED to the target per venue (P1).
k is swept rather than asserted; an inconclusive sweep is reported as
unresolved rather than resolved to a convenient value.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016KXi2riEacocX5ifipzS7f" -- srcla/src/forecast/grid-sweep.ts srcla/scripts/freeze-artifact.ts srcla/src/policy/artifact.ts srcla/test/unit/forecast/grid-sweep.spec.ts srcla/config/registered-artifact.json
```

---

### Task 9: Run the registered evaluation and regenerate the report

**Files:**
- Modify: `srcla/scripts/run-registered-evaluation.ts` (era-scoped, registered artifact)
- Create: `srcla/src/evaluation/report/render-markdown.ts`
- Modify: `SRCLA-REPORT.md`, `SRCLA-REPORT.json`
- Test: `srcla/test/unit/evaluation/render-markdown.spec.ts`

- [ ] **Step 1: Point the runner at the sealed era**

Replace `--start/--end` with `--era heldout-a` (keeping the explicit dates as an override for held-out B), and load `config/registered-artifact.json` in place of the bootstrap. **This is the first and only moment the held-out data is read.** Everything before this point must already be committed — if a result prompts a change to the artifact or the grid, that change is a new registration on a new era, not a retune.

- [ ] **Step 2: Run held-out A**

```bash
DATABASE_URL='postgresql://user:password@localhost:5433/srcla' \
  pnpm evaluation:run --era heldout-a --out evaluation-heldout-a.json
```
Record the `RESULT` banner, every gate line, the result hash, the manifest hash and the dataset hash.

- [ ] **Step 3: Run held-out B**

```bash
DATABASE_URL='postgresql://user:password@localhost:5433/srcla' \
  pnpm evaluation:run --era heldout-b --out evaluation-heldout-b.json
```
Expect low power and say so. Held-out B's job is temporal purity, not significance.

- [ ] **Step 4: Verify both runs reproduce**

```bash
pnpm evaluation:verify evaluation-heldout-a.json
pnpm evaluation:verify evaluation-heldout-b.json
```
A result hash that does not re-derive means the run is not reproducible, which fails §11.5 regardless of what the gate said.

- [ ] **Step 5: Render the report from `src/evaluation/report/`**

`SRCLA-REPORT.md` is generated by untracked `evaluation-v2/*.mjs` (defect V5) and `CLAUDE.md` says outright: *"`SRCLA-REPORT.md` is stale... Do not cite it; regenerate it."* Write `render-markdown.ts`, taking the two run records and emitting the report. It must state, in its own words and near the top:

- the era table and both disclosed deviations from "Era design";
- that withdrawals are a **registered schedule, not observed** — the Navy vault has no Base mainnet history, so §8.1's `Q_β(W_H)` has no real `W_H` over this window and the harness's `withdrawalSource` says which was used;
- every `NOT_OBSERVED` entry that survives Task 7;
- whether `noTradeBandK` resolved;
- the gate verdict per check, with `NOT PRODUCED` distinguished from `FAILED`;
- the §11.1 fork-replay check as **NOT PRODUCED** and therefore blocking, unless `fork-runner.ts` has been wired (it is out of this plan's scope and its absence must be stated, not omitted).

Golden-file test the renderer against a fixed run record so the prose cannot drift from the numbers.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(srcla): the registered evaluation on sealed data, and a regenerated report

First run against data nothing in this repository had read. Replaces the report
produced by the untracked evaluation-v2 harness (V5) with one rendered from
src/evaluation/report/. Reports held-out A for power and held-out B for
temporal purity, and states both disclosed era deviations, the registered
withdrawal schedule, the surviving NOT_OBSERVED entries and every gate line
that did not verify.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016KXi2riEacocX5ifipzS7f" -- srcla/src/evaluation/report/render-markdown.ts srcla/scripts/run-registered-evaluation.ts srcla/test/unit/evaluation/render-markdown.spec.ts SRCLA-REPORT.md SRCLA-REPORT.json
```

---

## Phase 4 Exit Criteria

- [ ] `docker compose up -d` in `srcla/` yields a working `:5433`; `prisma db push` is clean; the round-trip test passes
- [ ] `MarketSnapshot` holds ≥ 15,000 distinct origins across ≥ 700 days, three markets each, with `irmKinkRay` populated
- [ ] Every origin has a matching `ChainCostSnapshot`; `NOT_OBSERVED` no longer lists the five gas/price inputs
- [ ] `eraFor` assigns every persisted origin; the burned window is in neither held-out era; `assertNotSealed` blocks sealed reads, asserted by test
- [ ] `config/registered-artifact.json` exists, carries **no** `_provisional`, and records the calibration era it was fit on
- [ ] `pnpm evaluation:run --era heldout-a` completes and `evaluation:verify` re-derives its result hash
- [ ] `SRCLA-REPORT.{md,json}` regenerated from `src/evaluation/report/`, carrying the era table, both disclosures and every unverified gate line
- [ ] `pnpm test:unit` green against its recorded baseline with every delta accounted for; `tsc --noEmit` and `typecheck:scripts` clean

## Self-Review Notes

- **Spec coverage:** spec §9 "Dataset" → Tasks 3–5; "Eras" → Task 6; "Corrections" → Tasks 7–8 (V2's artifact reproducibility; V3's tiers already correct in `REGISTERED_TIERS`); "Reporting" → Task 9 (V5). Spec §5.4's schema additions → Task 2. Phase 1 gaps #4 and #7 → Tasks 1 and 7.
- **Knowingly NOT closed by this plan, and why:**
  - **§11.1 fork replay (`fork-runner.ts` unwired).** It needs an Anvil process per (policy, tier) — 64 forked replays — and is a phase of its own. The gate reports it `NOT PRODUCED` and therefore **blocks**, so the honest outcome of Task 9 is very likely `FAIL` on this check alone. That is the designed behaviour, not a defect: spec §2 goal 3 asks for a reproducible `PASS` **or** `FAIL`.
  - **Observed withdrawals.** The vault has no Base mainnet history and no honest source exists; the registered schedule is used and disclosed.
  - **Reward emissions.** Phase 3's probe governs; if emissions are immaterial the measured contribution is zero and is reported as such.
  - **`ForecastLabel` has no writer** (Phase 1 gap #2). The harness derives labels from the dataset (`deriveCompletedLabels`), so the evaluation does not need the table. The live service still does; out of scope here.
- **Ordering rationale:** 1 before everything (nothing persists without it). 2 before 5 (the backfill writes columns that must exist). 3 and 4 before 5 (its dependencies). 6 after 5 because `eraTag` is stamped over rows that must already exist. 7 after 5 because it consumes `ChainCostSnapshot`. 8 after 6 because the sweep must be era-scoped to be honest. 9 last, because it is the only task that opens the sealed data.
- **Largest risk:** the dataset is one long unattended network run. It is resumable and gap-recording, so the failure mode is a shorter dataset that says it is shorter — not a plausible-looking wrong one.
