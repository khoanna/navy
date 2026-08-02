# SRCLA Standalone Service Foundation Implementation Plan (Plan 4 of 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `/srcla` as an independently deployable Node.js/TypeScript worker with its own PostgreSQL schema, archive-capable Base RPC ingestion, deterministic finalized snapshots, process locking, and a read-only strategy-history API.

**Architecture:** Pure domain modules have no Fastify, Prisma, scheduler, or ethers dependencies. Infrastructure adapters validate configuration, collect one canonical finalized Base snapshot every 15 minutes, persist append-only/versioned records, and expose read-only data. Only the executor added in Plan 5 loads the allocator key; this foundation never submits transactions.

**Tech Stack:** Node.js 24, pnpm 10, TypeScript 5.7+, ethers 6.17, Prisma 7.8 with PostgreSQL driver adapter, Fastify 5, Zod 4, Jest 30.

## Global Constraints

- `/srcla` is its own app, not a pnpm workspace package and not imported by `/be`.
- One `BASE_RPC_URL` must support live reads, submission later, archive reads, and pinned-block calls.
- Chain ID must be exactly `8453`; asset must be exact Circle native Base USDC.
- Persist integer chain quantities as decimal strings/Prisma `BigInt`; never JSON-serialize JavaScript `bigint` directly.
- Finalized snapshots run every 15 minutes; allocation evaluation is added in Plan 5 and runs hourly.
- One owned PostgreSQL schema/database; `/be` never connects to it.
- API is read-only and has no policy mutation or transaction endpoint.
- Every deterministic record includes code commit, policy version, block number/hash, and content hash.

---

### Task 1: Scaffold the independent TypeScript application and strict configuration

**Files:**
- Create: `srcla/package.json`
- Create: `srcla/tsconfig.json`
- Create: `srcla/jest.config.js`
- Create: `srcla/.env.example`
- Create: `srcla/src/config.ts`
- Create: `srcla/src/config.spec.ts`
- Create: `srcla/src/main.ts`
- Create: `srcla/src/domain/units.ts`
- Create: `srcla/README.md`
- Create: `srcla/pnpm-lock.yaml`

**Interfaces:**
- Produces: `SrclaConfig`, `loadConfig(env)`, `BaseUnits`, `Wad`, and runnable `main()`.

- [ ] **Step 1: Write failing configuration tests**

```typescript
it('rejects a non-Base chain and missing archive RPC', () => {
  expect(() => loadConfig({ BASE_CHAIN_ID: '11155111', BASE_RPC_URL: '' })).toThrow(/BASE_RPC_URL|8453/);
});

it('accepts exact Base and native USDC identity', () => {
  const cfg = loadConfig(validEnv);
  expect(cfg.chainId).toBe(8453);
  expect(cfg.usdcAddress).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
});
```

- [ ] **Step 2: Initialize dependencies and confirm test failure**

Run from `srcla/` after creating `package.json`:

```bash
pnpm add ethers@^6.17 fastify@^5 zod@^4 dotenv@^17 @prisma/client@^7.8 @prisma/adapter-pg@^7.8 pg@^8
pnpm add -D typescript@^5.7 jest@^30 ts-jest@^29 @types/jest@^30 @types/node@^24 prisma@^7.8 eslint@^9 prettier@^3
pnpm test -- config
```

Expected: FAIL because `loadConfig` is absent.

- [ ] **Step 3: Implement strict parsing and branded units**

```typescript
// package.json scripts
"scripts": {
  "build": "tsc -p tsconfig.json",
  "test": "jest --runInBand",
  "start": "node dist/main.js",
  "collect:once": "node dist/scripts/collect-once.js"
}

const schema = z.object({
  BASE_RPC_URL: z.string().url(),
  BASE_CHAIN_ID: z.coerce.number().int().refine((v) => v === 8453),
  BASE_USDC_ADDRESS: z.literal('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'),
  NAVY_VAULT_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  REWARD_EXECUTOR_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  DATABASE_URL: z.string().min(1),
  HTTP_HOST: z.string().default('127.0.0.1'),
  HTTP_PORT: z.coerce.number().int().positive().default(3100),
});
```

Define `BaseUnits` and `Wad` as branded `bigint` types plus `asBaseUnits`, `asWad`, and decimal-string serializers. Do not load an allocator key in this plan.

- [ ] **Step 4: Run unit tests, typecheck, and build**

Run: `cd srcla && pnpm test -- config && pnpm exec tsc --noEmit && pnpm build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add srcla/package.json srcla/pnpm-lock.yaml srcla/tsconfig.json srcla/jest.config.js srcla/.env.example srcla/src srcla/README.md
git commit -m "feat(srcla): scaffold standalone TypeScript service"
```

---

### Task 2: Create the SRCLA-owned PostgreSQL schema and repository boundary

**Files:**
- Create: `srcla/prisma.config.ts`
- Create: `srcla/prisma/schema.prisma`
- Create: `srcla/prisma/migrations/20260802000000_srcla_foundation/migration.sql`
- Create: `srcla/src/db/prisma.ts`
- Create: `srcla/src/db/repositories.ts`
- Create: `srcla/src/db/repositories.spec.ts`
- Create: `srcla/src/domain/snapshots.ts`

**Interfaces:**
- Produces: `SnapshotRepository`, `RegimeRepository`, `PolicyRepository`, `DecisionRepository`, `PlanRepository`, and `EvaluationRepository` used by Plans 5 and 7.

- [ ] **Step 1: Write idempotency and append-only repository tests**

```typescript
it('stores only one snapshot for a market and finalized block hash', async () => {
  await repo.insertSnapshot(snapshot);
  await repo.insertSnapshot(snapshot);
  expect(await repo.countByBlock(snapshot.blockHash)).toBe(1);
});

it('never mutates an activated policy payload', async () => {
  await policies.activate(policy);
  await expect(policies.replacePayload(policy.id, differentPayload)).rejects.toThrow(/immutable/i);
});
```

- [ ] **Step 2: Add schema and run the failing repository tests**

Define models `ChainBlock`, `Market`, `MarketSnapshot`, `ContractRegime`, `PolicyVersion`, `AdmissionRecord`, `Forecast`, `ReserveDecision`, `AllocationCandidate`, `Decision`, `ExecutionPlan`, `PlanAction`, `TransactionAttempt`, `RewardObservation`, `HarvestRecord`, `Alert`, and `EvaluationRun`. Use unique constraints on chain/block hash, market/block, policy hash, decision hash, plan ID, action index, sender/nonce, and tx hash.

Run: `cd srcla && source .env && pnpm prisma migrate deploy && pnpm test -- repositories`

Expected: FAIL until repository methods exist.

- [ ] **Step 3: Implement typed repositories with transactions**

```typescript
export interface SnapshotRepository {
  insertFinalizedBundle(bundle: FinalizedSnapshotBundle): Promise<'inserted' | 'already_exists'>;
  latestComplete(marketId: string): Promise<MarketSnapshotRecord | null>;
  range(marketId: string, from: Date, to: Date): Promise<MarketSnapshotRecord[]>;
}
```

Define `FinalizedSnapshotBundle`, `MarketSnapshotRecord`, `ChainBlockRecord`, and raw protocol/reward/oracle observation types in `src/domain/snapshots.ts` before implementing the repository. Task 3 must consume these types rather than redeclare them.

Insert the block, all market snapshots, reward observations, and data-quality flags in one database transaction. Store raw JSON only after recursively converting bigint values to decimal strings; also store a canonical SHA-256 content hash.

- [ ] **Step 4: Run migration, tests, and Prisma validation**

Run: `cd srcla && source .env && pnpm prisma validate && pnpm prisma migrate deploy && pnpm test -- repositories`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add srcla/prisma.config.ts srcla/prisma srcla/src/db srcla/src/domain/snapshots.ts
git commit -m "feat(srcla): add owned decision and snapshot database"
```

---

### Task 3: Validate deployed identities and collect finalized Base snapshots

**Files:**
- Create: `srcla/src/chain/abis.ts`
- Create: `srcla/src/chain/base-client.ts`
- Create: `srcla/src/chain/identity.ts`
- Create: `srcla/src/collector/types.ts`
- Create: `srcla/src/collector/snapshot-collector.ts`
- Create: `srcla/src/collector/snapshot-collector.spec.ts`
- Create: `srcla/scripts/collect-once.ts`
- Create: `srcla/src/collector/fixtures/finalized-block.json`
- Copy generated ABIs to: `srcla/src/chain/abi/*.json`

**Interfaces:**
- Produces: `BaseClient.readAt(blockTag, calls)`, `verifyDeploymentIdentity`, and `SnapshotCollector.collectFinalized()`.

- [ ] **Step 1: Write canonical-block and identity tests**

```typescript
it('uses one finalized block tag for every call in a bundle', async () => {
  const bundle = await collector.collectFinalized();
  expect(new Set(bundle.calls.map((c) => c.blockHash))).toEqual(new Set([bundle.block.hash]));
});

it('rejects mismatched chain, asset, vault, adapter, or executor identity', async () => {
  rpc.chainId = 11155111;
  await expect(verifyDeploymentIdentity(rpc, cfg)).rejects.toThrow(/chain id/i);
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `cd srcla && pnpm test -- snapshot-collector`

Expected: FAIL because collector modules are absent.

- [ ] **Step 3: Implement finalized multicall-style collection**

```typescript
const finalized = await provider.getBlock('finalized');
if (!finalized?.hash) throw new Error('finalized block unavailable');
const tag = finalized.number;
const observations = await Promise.all(readers.map((reader) => reader.read(tag)));
if (observations.some((o) => o.blockNumber !== tag)) throw new Error('mixed snapshot block');
```

Read vault NAV/idle/supply, adapter balances/liquidity/configuration digest, protocol raw rate inputs, proxy implementations/code hashes, reward configurations/funding/claimable amounts, Chainlink rounds, Uniswap route/pool state, and Base fee fields. Preserve raw units and read errors; never substitute dashboard APY.

- [ ] **Step 4: Run fixture tests and an optional archive-RPC smoke command**

Run: `cd srcla && pnpm test -- snapshot-collector && pnpm exec tsc --noEmit`

Run with configured archive RPC: `cd srcla && source .env && pnpm run collect:once -- --dry-run`

Expected: tests pass; dry-run prints one block hash and a deterministic content hash without writing when `--dry-run` is set.

- [ ] **Step 5: Commit**

```bash
git add srcla/src/chain srcla/src/collector srcla/scripts/collect-once.ts
git commit -m "feat(srcla): collect block-consistent finalized Base snapshots"
```

---

### Task 4: Add scheduling, process ownership, and crash-safe ingestion

**Files:**
- Create: `srcla/src/runtime/advisory-lock.ts`
- Create: `srcla/src/runtime/scheduler.ts`
- Create: `srcla/src/runtime/health.ts`
- Create: `srcla/src/runtime/scheduler.spec.ts`
- Modify: `srcla/src/main.ts`

**Interfaces:**
- Produces: `Scheduler.start()`, `runSnapshotTick()`, advisory lock key `srcla:snapshot`, and health state.

- [ ] **Step 1: Write overlap and recovery tests**

```typescript
it('skips overlapping snapshot ticks and records degraded health', async () => {
  collector.blockNext();
  const first = scheduler.runSnapshotTick();
  expect(await scheduler.runSnapshotTick()).toEqual({ status: 'skipped', reason: 'lock_busy' });
  collector.release();
  await first;
});
```

Test database unavailable, incomplete bundle rollback, duplicate finalized block, RPC error, and process restart after a block was already inserted.

- [ ] **Step 2: Run and confirm failure**

Run: `cd srcla && pnpm test -- scheduler`

Expected: FAIL because runtime modules are absent.

- [ ] **Step 3: Implement PostgreSQL advisory locks and 15-minute cadence**

```typescript
await lock.withLock('srcla:snapshot', async () => {
  const bundle = await collector.collectFinalized();
  await snapshots.insertFinalizedBundle(bundle);
  health.markSnapshotSuccess(bundle.block);
});
```

Schedule from UTC wall-clock quarter hours rather than `setInterval` drift. On SIGTERM, stop new ticks, finish or abort the current database transaction, close HTTP, Prisma, and provider resources, then exit.

- [ ] **Step 4: Run scheduler tests and build**

Run: `cd srcla && pnpm test -- scheduler && pnpm build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add srcla/src/runtime srcla/src/main.ts
git commit -m "feat(srcla): schedule crash-safe finalized ingestion"
```

---

### Task 5: Expose the read-only SRCLA HTTP API

**Files:**
- Create: `srcla/src/http/server.ts`
- Create: `srcla/src/http/routes.ts`
- Create: `srcla/src/http/serializers.ts`
- Create: `srcla/src/http/server.spec.ts`
- Modify: `srcla/src/main.ts`
- Modify: `srcla/README.md`

**Interfaces:**
- Produces versioned `GET /v1/health`, `/v1/policy`, `/v1/markets`, `/v1/allocation`, `/v1/decisions`, `/v1/decisions/:hash`, `/v1/plans`, `/v1/harvests`, and `/v1/evaluations`.

- [ ] **Step 1: Write API contract and write-method rejection tests**

```typescript
it('serializes bigint fields as decimal strings', async () => {
  const res = await app.inject({ method: 'GET', url: '/v1/allocation' });
  expect(res.json().totalAssetsBase).toMatch(/^\d+$/);
});

it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('exposes no %s mutation surface', async (method) => {
  expect((await app.inject({ method, url: '/v1/policy' })).statusCode).toBe(404);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd srcla && pnpm test -- server`

Expected: FAIL because HTTP modules are absent.

- [ ] **Step 3: Implement query-only routes and stable envelopes**

```typescript
app.get('/v1/health', async () => ({ data: health.snapshot() }));
app.get('/v1/decisions/:hash', async (req, reply) => {
  const row = await decisions.byHash(req.params.hash);
  return row ? { data: serialize(row) } : reply.code(404).send({ error: { code: 'NOT_FOUND' } });
});
```

Use `{ data, meta }` success envelopes and `{ error: { code, message } }` failures. Add pagination with deterministic `(createdAt,id)` cursors. Do not instantiate a wallet or expose a generic RPC proxy.

- [ ] **Step 4: Run API tests, full test suite, and build**

Run: `cd srcla && pnpm test && pnpm exec tsc --noEmit && pnpm build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add srcla/src/http srcla/src/main.ts srcla/README.md
git commit -m "feat(srcla): expose read-only strategy history API"
```
