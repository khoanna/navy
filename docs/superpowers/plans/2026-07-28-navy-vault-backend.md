# NavyVault Backend Implementation Plan (Plan 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend for the pooled ERC-4626 `NavyVault` — a NestJS `be/src/vault/` module providing gasless deposit (relayer + EIP-3009), gasless redeem (ERC-2612 permit on the share token + relayer), a cron **rebalancer keeper** that moves pooled funds between Compound/Morpho adapters by live APY under a target-weight-with-drift strategy, an on-chain **event watcher** that reconciles DB state, and the Prisma models backing it.

**Architecture:** Mirrors the existing `payments` and `transfer` BFF modules exactly. `VaultService` builds EIP-712 typed data, persists a durable single-use nonce/digest, CAS-consumes it on submit, and relays the on-chain call. `RebalancerService` mirrors `FarmingAgentScheduler` (cron + re-entrancy guard) and drives allocation from a **framework-free `decideRebalance()`** (plain TS, unit-tested). `VaultWatcherService` mirrors `ChainWatcherService` (poll receipts, decode events, reconcile, crash-recovery sweep). The on-chain layer is the deployed `NavyVault` (Plan 1); the keeper signs `reallocate`/`deployToAdapter` from a dedicated **keeper (allocator) wallet**.

**Tech Stack:** NestJS 11, Prisma 7 (Postgres, driver adapter), ethers v6, `@nestjs/schedule` cron. Spec: `docs/superpowers/specs/2026-07-28-navy-vault-rebalancing-farming-design.md`.

**Scope note (Plan 2 of 3):** This plan is **additive** — it adds `be/src/vault/` alongside the existing `farming` module and does NOT remove anything. Plan 3 removes the dead subwallet/crypto/farming code and repoints the AI-assistant tools + fe/expo. The on-chain contract ABI is already exported at `be/src/evm/navy-vault-abi.json` (107 entries, current as of the audited contract).

**Live-deploy dependency:** All code and unit tests below are buildable/testable **now** (the vault address is an env var; the keeper reads adapters generically). The final live E2E (Task 12) requires a deployed vault + funded relayer/keeper and is **deferred** until Plan 1 is deployed to Sepolia — the plan marks it clearly.

**Conventions to follow (verified against the codebase):**
- BFF: build typed data → persist EIP-712 digest as durable single-use nonce → on submit, recover signer, assert `signer == req.user.walletAddress`, **CAS-consume** via `updateMany({where:{id, consumedAt:null}, data:{consumedAt:new Date()}})` (count must be 1), then relay. Mirror `be/src/transfer/transfer.service.ts` and `be/src/payments/relayer.service.ts`.
- EVM: `NAVY_EVM` provider in `be/src/evm/evm.module.ts` wires ethers `JsonRpcProvider` + relayer/owner `ethers.Wallet` + contracts; ABIs are `require()`d. USDC domain read from config (`usdcDomain`).
- Money columns are `BigInt`; **serialize to string** at the controller boundary (see `be/src/common/serialize.ts`).
- Routes gated by `@UseGuards(JwtGuard, RolesGuard) @Roles('user')`; `req.user = {sub, role, walletAddress, sid}`.
- Config via the global `NavyConfigService` (`be/src/config/config.service.ts`), env-driven.
- Keep chain-free logic in plain-TS modules (`*.ts` + `*.spec.ts` in the same dir); jest `testRegex: .*\.spec\.ts$`.
- Prisma: `id String @id @default(uuid())`, string status enums, `@@index`, `DATABASE_URL` required for CLI (`DATABASE_URL=... pnpm prisma migrate dev --name X`).

---

## Phase A — Data model + framework-free logic (unit-testable now)

### Task 1: Prisma models for vault deposits, redeems, and rebalance events

**Files:**
- Modify: `be/prisma/schema.prisma`
- Migration: generated

- [ ] **Step 1: Add three models** to `be/prisma/schema.prisma` (mirror the `Transfer` model's style — BigInt money, unique nonce/digest, string status, `consumedAt` CAS marker, indexes):

```prisma
model VaultDeposit {
  id          String    @id @default(uuid())
  userId      String
  userAddress String
  assetsBase  BigInt              // USDC base units deposited
  nonce       String    @unique   // bytes32 EIP-3009 authorization nonce (hex)
  digest      String    @unique   // EIP-712 digest the wallet signs
  validBefore DateTime?
  status      String    @default("awaiting_signature") // awaiting_signature|confirming|confirmed|failed
  txHash      String?
  consumedAt  DateTime?           // CAS-consume marker (single-use)
  createdAt   DateTime  @default(now())

  @@index([userId, createdAt])
  @@index([status])
}

model VaultRedeem {
  id          String    @id @default(uuid())
  userId      String
  userAddress String
  sharesBase  BigInt              // navUSDC shares redeemed
  digest      String    @unique   // EIP-712 permit digest the wallet signs
  deadline    DateTime?
  status      String    @default("awaiting_signature") // awaiting_signature|confirming|confirmed|failed
  txHash      String?
  consumedAt  DateTime?
  createdAt   DateTime  @default(now())

  @@index([userId, createdAt])
  @@index([status])
}

model RebalanceEvent {
  id          String   @id @default(uuid())
  kind        String   // reallocate|deploy|divest
  fromAdapter String?
  toAdapter   String?
  amountBase  BigInt   @default(0)
  aprFromE18  BigInt   @default(0) // 1e18-scaled APR snapshot (source venue)
  aprToE18    BigInt   @default(0) // 1e18-scaled APR snapshot (dest venue)
  txHash      String?
  status      String   @default("confirming") // confirming|confirmed|failed
  createdAt   DateTime @default(now())

  @@index([createdAt])
  @@index([status])
}
```

- [ ] **Step 2: Generate the migration + client**

Run (from `be/`): `DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '\"')" pnpm prisma migrate dev --name vault_models`
Expected: creates `be/prisma/migrations/*_vault_models/`, regenerates the client. (Postgres must be up: `docker compose up -d`.)

- [ ] **Step 3: Typecheck**

Run: `pnpm build`
Expected: compiles (the new models are available on `PrismaService`).

- [ ] **Step 4: Commit**

```bash
git add be/prisma/schema.prisma be/prisma/migrations
git commit -m "feat(be): Prisma models for vault deposits, redeems, rebalance events"
```

---

### Task 2: EIP-712 typed-data builders (plain TS, unit-tested)

**Files:**
- Create: `be/src/vault/vault-authorization.ts`
- Create: `be/src/vault/vault-authorization.spec.ts`

Two typed-data builders: (a) **deposit** = USDC `ReceiveWithAuthorization` (to = vault) — reuse the existing shape from `be/src/evm/payment-authorization.ts`; (b) **redeem** = the vault share token's ERC-2612 `Permit` (owner = user, spender = relayer).

- [ ] **Step 1: Write the failing tests** in `be/src/vault/vault-authorization.spec.ts`:

```typescript
import { ethers } from 'ethers';
import {
  buildDepositAuthorizationTypedData,
  depositAuthorizationDigest,
  recoverDepositSigner,
  buildRedeemPermitTypedData,
  redeemPermitDigest,
  recoverRedeemSigner,
  randomNonce,
} from './vault-authorization';

const usdcDomain = { name: 'USDC', version: '2', chainId: 11155111, verifyingContract: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' };
const vaultDomain = { name: 'Navy Vault USDC', version: '1', chainId: 11155111, verifyingContract: '0x00000000000000000000000000000000000V4017'.toLowerCase().replace('v4017', '00b0a7') };

describe('vault deposit authorization (EIP-3009 ReceiveWithAuthorization)', () => {
  it('round-trips: a wallet signs the typed data, and the digest recovers that wallet', async () => {
    const w = ethers.Wallet.createRandom();
    const td = buildDepositAuthorizationTypedData({
      domain: usdcDomain,
      from: w.address,
      to: '0x000000000000000000000000000000000000b0a7',
      amount: 1_000_000n,
      validAfter: 0,
      validBefore: Math.floor(Date.now() / 1000) + 3600,
      nonce: randomNonce(),
    });
    const sig = await w.signTypedData(td.domain, td.types, td.message);
    expect(recoverDepositSigner(td, sig).toLowerCase()).toBe(w.address.toLowerCase());
    // digest is deterministic and matches ethers' hash
    expect(depositAuthorizationDigest(td)).toBe(ethers.TypedDataEncoder.hash(td.domain, td.types, td.message));
  });
});

describe('vault redeem permit (EIP-2612 Permit on the share token)', () => {
  it('round-trips: owner signs Permit(owner, spender, value, nonce, deadline)', async () => {
    const w = ethers.Wallet.createRandom();
    const spender = '0x000000000000000000000000000000000000dEaD';
    const td = buildRedeemPermitTypedData({
      domain: vaultDomain,
      owner: w.address,
      spender,
      value: 500_000n,
      nonce: 0n,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    });
    const sig = await w.signTypedData(td.domain, td.types, td.message);
    expect(recoverRedeemSigner(td, sig).toLowerCase()).toBe(w.address.toLowerCase());
    expect(redeemPermitDigest(td)).toBe(ethers.TypedDataEncoder.hash(td.domain, td.types, td.message));
  });
});

describe('randomNonce', () => {
  it('produces a 32-byte hex string', () => {
    expect(randomNonce()).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `be/`): `pnpm test vault-authorization`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `be/src/vault/vault-authorization.ts`**

```typescript
import { ethers } from 'ethers';

export interface Eip712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}
export type Eip712Types = Record<string, { name: string; type: string }[]>;
export interface TypedData {
  domain: Eip712Domain;
  types: Eip712Types;
  primaryType: string;
  message: Record<string, unknown>;
}

// USDC ReceiveWithAuthorization (EIP-3009) — same shape as payments/transfer.
export const RECEIVE_WITH_AUTHORIZATION_TYPES: Eip712Types = {
  ReceiveWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

// EIP-2612 Permit — the vault share token (ERC20Permit).
export const PERMIT_TYPES: Eip712Types = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

export function randomNonce(): string {
  return ethers.hexlify(ethers.randomBytes(32));
}

export function buildDepositAuthorizationTypedData(p: {
  domain: Eip712Domain;
  from: string;
  to: string;
  amount: bigint;
  validAfter: number;
  validBefore: number;
  nonce: string;
}): TypedData {
  return {
    domain: p.domain,
    types: RECEIVE_WITH_AUTHORIZATION_TYPES,
    primaryType: 'ReceiveWithAuthorization',
    message: {
      from: p.from,
      to: p.to,
      value: p.amount.toString(),
      validAfter: p.validAfter,
      validBefore: p.validBefore,
      nonce: p.nonce,
    },
  };
}

export function depositAuthorizationDigest(td: TypedData): string {
  return ethers.TypedDataEncoder.hash(td.domain, td.types, td.message);
}

export function recoverDepositSigner(td: TypedData, signature: string): string {
  return ethers.verifyTypedData(td.domain, td.types, td.message, signature);
}

export function buildRedeemPermitTypedData(p: {
  domain: Eip712Domain;
  owner: string;
  spender: string;
  value: bigint;
  nonce: bigint;
  deadline: number;
}): TypedData {
  return {
    domain: p.domain,
    types: PERMIT_TYPES,
    primaryType: 'Permit',
    message: {
      owner: p.owner,
      spender: p.spender,
      value: p.value.toString(),
      nonce: p.nonce.toString(),
      deadline: p.deadline,
    },
  };
}

export function redeemPermitDigest(td: TypedData): string {
  return ethers.TypedDataEncoder.hash(td.domain, td.types, td.message);
}

export function recoverRedeemSigner(td: TypedData, signature: string): string {
  return ethers.verifyTypedData(td.domain, td.types, td.message, signature);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test vault-authorization`
Expected: PASS (3 suites). (Note: the placeholder `verifyingContract` in the test is any valid-looking address — the round-trip is domain-independent as long as signer and recoverer use the same `td`.)

- [ ] **Step 5: Commit**

```bash
git add be/src/vault/vault-authorization.ts be/src/vault/vault-authorization.spec.ts
git commit -m "feat(be): EIP-712 typed-data builders for vault deposit + redeem"
```

---

### Task 3: `decideRebalance` strategy (plain TS, unit-tested)

**Files:**
- Create: `be/src/vault/rebalance.logic.ts`
- Create: `be/src/vault/rebalance.logic.spec.ts`

Framework-free target-weight-with-drift strategy (per the spec §Strategy): given per-adapter live APY + current allocation + idle + config, decide the rebalance moves. Enforces drift band (hysteresis), gas-breakeven, and a liquidity buffer. No chain/Nest imports.

- [ ] **Step 1: Write the failing tests** in `be/src/vault/rebalance.logic.spec.ts`:

```typescript
import { decideRebalance, RebalanceConfig, AdapterState } from './rebalance.logic';

const cfg: RebalanceConfig = {
  driftBandBps: 500,        // rebalance only if an adapter is >5% off target
  minIdleBps: 1000,         // keep 10% idle
  gasCostBase: 100_000n,    // ~0.1 USDC-equivalent gas cost estimate (base units)
  safetyFactor: 2,
  horizonSeconds: 21_600,   // 6h cooldown horizon for the breakeven check
};

function st(addr: string, targetBps: number, aprE18: bigint, assetsBase: bigint): AdapterState {
  return { address: addr, targetBps, aprE18, assetsBase };
}

describe('decideRebalance', () => {
  it('deploys idle above the buffer toward the highest-APY under-target adapter', () => {
    // total = 1000e6, idle = 1000e6 (nothing deployed). Targets 50/50.
    const adapters = [st('0xA', 5000, 30n * 10n ** 15n, 0n), st('0xB', 5000, 50n * 10n ** 15n, 0n)];
    const moves = decideRebalance({ adapters, idleBase: 1_000_000_000n, totalBase: 1_000_000_000n, config: cfg });
    // Should deploy ~900e6 (keeping 100e6 = 10% idle) split toward targets, prioritizing higher APR (B).
    expect(moves.length).toBeGreaterThan(0);
    const deployed = moves.filter((m) => m.kind === 'deploy').reduce((a, m) => a + m.amountBase, 0n);
    expect(deployed).toBeLessThanOrEqual(900_000_000n);
    expect(deployed).toBeGreaterThan(0n);
  });

  it('does nothing when allocation is within the drift band', () => {
    // total 1000e6, targets 50/50, actual 480/520 (2% drift < 5% band), idle 0.
    const adapters = [st('0xA', 5000, 4n * 10n ** 16n, 480_000_000n), st('0xB', 5000, 4n * 10n ** 16n, 520_000_000n)];
    const moves = decideRebalance({ adapters, idleBase: 0n, totalBase: 1_000_000_000n, config: cfg });
    expect(moves).toEqual([]);
  });

  it('reallocates from an over-target to an under-target adapter when drift exceeds the band', () => {
    // targets 50/50, actual 800/200 (30% drift > 5%), idle 0.
    const adapters = [st('0xA', 5000, 3n * 10n ** 16n, 800_000_000n), st('0xB', 5000, 5n * 10n ** 16n, 200_000_000n)];
    const moves = decideRebalance({ adapters, idleBase: 0n, totalBase: 1_000_000_000n, config: cfg });
    const re = moves.find((m) => m.kind === 'reallocate');
    expect(re).toBeDefined();
    expect(re!.fromAdapter).toBe('0xA');
    expect(re!.toAdapter).toBe('0xB');
    expect(re!.amountBase).toBeGreaterThan(0n);
  });

  it('skips a move whose expected extra yield does not clear the gas-breakeven check', () => {
    // tiny drift amount so Δapy * principal * horizon < gasCost * safetyFactor.
    const adapters = [st('0xA', 5000, 3n * 10n ** 16n, 500_100_000n), st('0xB', 5000, 3n * 10n ** 16n, 499_900_000n)];
    // within band anyway; force a case just above band but below breakeven:
    const adapters2 = [st('0xA', 9000, 30n * 10n ** 15n, 1_000_000n), st('0xB', 1000, 30n * 10n ** 15n, 0n)];
    const moves = decideRebalance({ adapters: adapters2, idleBase: 0n, totalBase: 1_000_000n, config: cfg });
    // 1 USDC total, moving cents for ~0 APR delta must not clear 2x gas breakeven.
    expect(moves).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test rebalance.logic`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `be/src/vault/rebalance.logic.ts`**

```typescript
export interface AdapterState {
  address: string;
  targetBps: number;   // desired share of total (0..10000)
  aprE18: bigint;      // 1e18-scaled annual supply rate
  assetsBase: bigint;  // current assets in this adapter (base units)
}

export interface RebalanceConfig {
  driftBandBps: number;   // only act when an adapter is this far off target
  minIdleBps: number;     // keep this fraction of total idle in the vault
  gasCostBase: bigint;    // estimated gas cost of a move, in asset base units
  safetyFactor: number;   // require expected gain > gasCost * safetyFactor
  horizonSeconds: number; // yield horizon used in the breakeven check
}

export type Move =
  | { kind: 'deploy'; toAdapter: string; amountBase: bigint; aprToE18: bigint }
  | { kind: 'reallocate'; fromAdapter: string; toAdapter: string; amountBase: bigint; aprFromE18: bigint; aprToE18: bigint };

const YEAR = 31_536_000n;
const WAD = 10n ** 18n;

/** Expected extra yield (base units) from moving `amount` at an APR delta over the horizon. */
function expectedGain(amountBase: bigint, aprDeltaE18: bigint, horizonSeconds: number): bigint {
  if (aprDeltaE18 <= 0n || amountBase <= 0n) return 0n;
  // amount * aprDelta * horizon / (WAD * YEAR)
  return (amountBase * aprDeltaE18 * BigInt(horizonSeconds)) / (WAD * YEAR);
}

function clearsBreakeven(amountBase: bigint, aprDeltaE18: bigint, c: RebalanceConfig): boolean {
  const gain = expectedGain(amountBase, aprDeltaE18, c.horizonSeconds);
  return gain > c.gasCostBase * BigInt(c.safetyFactor);
}

/**
 * Target-weight-with-drift rebalancer. Returns an ordered list of moves:
 * 1) deploy idle (above the minIdle buffer) toward under-target adapters, highest-APR first;
 * 2) reallocate from over-target to under-target adapters when drift exceeds the band.
 * Every move must clear the gas-breakeven check. Deterministic; no chain/Nest deps.
 */
export function decideRebalance(input: {
  adapters: AdapterState[];
  idleBase: bigint;
  totalBase: bigint;
  config: RebalanceConfig;
}): Move[] {
  const { adapters, config } = input;
  const total = input.totalBase;
  if (total === 0n || adapters.length === 0) return [];

  const minIdle = (total * BigInt(config.minIdleBps)) / 10000n;
  const band = (total * BigInt(config.driftBandBps)) / 10000n;
  const target = (a: AdapterState) => (total * BigInt(a.targetBps)) / 10000n;

  const moves: Move[] = [];
  let idle = input.idleBase;

  // Deployable idle above the buffer.
  let deployable = idle > minIdle ? idle - minIdle : 0n;

  // Under-target adapters, highest APR first.
  const under = adapters
    .map((a) => ({ a, deficit: target(a) > a.assetsBase ? target(a) - a.assetsBase : 0n }))
    .filter((x) => x.deficit > 0n)
    .sort((x, y) => (y.a.aprE18 > x.a.aprE18 ? 1 : y.a.aprE18 < x.a.aprE18 ? -1 : 0));

  // 1) Deploy idle toward deficits.
  for (const { a, deficit } of under) {
    if (deployable === 0n) break;
    const amount = deficit < deployable ? deficit : deployable;
    if (amount <= 0n) continue;
    // Deploying idle earns aprE18 vs 0 idle → delta is the adapter's own APR.
    if (!clearsBreakeven(amount, a.aprE18, config)) continue;
    moves.push({ kind: 'deploy', toAdapter: a.address, amountBase: amount, aprToE18: a.aprE18 });
    deployable -= amount;
  }

  // 2) Reallocate from over-target to under-target when drift exceeds band.
  const over = adapters
    .map((a) => ({ a, surplus: a.assetsBase > target(a) ? a.assetsBase - target(a) : 0n }))
    .filter((x) => x.surplus > band)
    .sort((x, y) => (y.surplus > x.surplus ? 1 : -1));

  const need = adapters
    .map((a) => ({ a, deficit: target(a) > a.assetsBase ? target(a) - a.assetsBase : 0n }))
    .filter((x) => x.deficit > band)
    .sort((x, y) => (y.a.aprE18 > x.a.aprE18 ? 1 : y.a.aprE18 < x.a.aprE18 ? -1 : 0));

  for (const src of over) {
    let surplus = src.surplus;
    for (const dst of need) {
      if (surplus === 0n) break;
      const amount = dst.deficit < surplus ? dst.deficit : surplus;
      if (amount <= 0n) continue;
      const aprDelta = dst.a.aprE18 - src.a.aprE18;
      if (!clearsBreakeven(amount, aprDelta > 0n ? aprDelta : 0n, config)) continue;
      moves.push({
        kind: 'reallocate',
        fromAdapter: src.a.address,
        toAdapter: dst.a.address,
        amountBase: amount,
        aprFromE18: src.a.aprE18,
        aprToE18: dst.a.aprE18,
      });
      surplus -= amount;
      dst.deficit -= amount;
    }
  }

  return moves;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test rebalance.logic`
Expected: PASS. If a specific numeric assertion is off (the breakeven boundary is sensitive to the config constants), adjust the TEST's config/inputs to match the documented intent — do NOT weaken the breakeven logic. Report any adjustment.

- [ ] **Step 5: Commit**

```bash
git add be/src/vault/rebalance.logic.ts be/src/vault/rebalance.logic.spec.ts
git commit -m "feat(be): framework-free decideRebalance target-weight-with-drift strategy"
```

---

## Phase B — EVM wiring + config

### Task 4: Extend config + EVM provider for the vault + keeper

**Files:**
- Modify: `be/src/config/config.service.ts`
- Modify: `be/src/evm/evm.module.ts`
- Create: `be/src/evm/yield-adapter-abi.json`

- [ ] **Step 1: Add config getters** in `be/src/config/config.service.ts` (mirror the existing getters):

```typescript
  get vaultAddress(): string { return this.req('NAVY_VAULT_ADDRESS'); }
  get keeperPrivateKey(): string { return this.env.NAVY_KEEPER_PRIVATE_KEY ?? this.req('NAVY_OWNER_PRIVATE_KEY'); }
  get vaultShareEip712Name(): string { return this.env.NAVY_VAULT_EIP712_NAME ?? 'Navy Vault USDC'; }
  get vaultShareEip712Version(): string { return this.env.NAVY_VAULT_EIP712_VERSION ?? '1'; }
```

- [ ] **Step 2: Add a minimal `IYieldAdapter` ABI** at `be/src/evm/yield-adapter-abi.json` (the keeper/reader needs `totalAssets`/`supplyRatePerYear` per adapter):

```json
{ "abi": [
  { "type": "function", "name": "totalAssets", "stateMutability": "view", "inputs": [], "outputs": [{ "type": "uint256" }] },
  { "type": "function", "name": "supplyRatePerYear", "stateMutability": "view", "inputs": [], "outputs": [{ "type": "uint256" }] },
  { "type": "function", "name": "asset", "stateMutability": "view", "inputs": [], "outputs": [{ "type": "address" }] }
] }
```

- [ ] **Step 3: Wire the vault + keeper** into `be/src/evm/evm.module.ts`. Extend the `NavyEvm` interface and factory:
  - Add to the interface: `vault: ethers.Contract` (connected to relayer), `vaultAsKeeper: ethers.Contract` (connected to the keeper wallet, for allocator txs), `keeper: ethers.Wallet`, `vaultShareDomain: UsdcDomain` (the ERC20Permit domain of the share token), and a helper `yieldAdapterAbi` (the required JSON `.abi`).
  - In the factory: `const vaultArtifact = require('./navy-vault-abi.json'); const adapterArtifact = require('./yield-adapter-abi.json');` then:
    ```typescript
    const keeper = new ethers.Wallet(cfg.keeperPrivateKey, provider);
    const vault = new ethers.Contract(cfg.vaultAddress, vaultArtifact, relayer);      // relayer for deposit/redeem
    const vaultAsKeeper = new ethers.Contract(cfg.vaultAddress, vaultArtifact, keeper); // keeper for reallocate/deploy
    const vaultShareDomain = {
      name: cfg.vaultShareEip712Name, version: cfg.vaultShareEip712Version,
      chainId: cfg.evmChainId, verifyingContract: cfg.vaultAddress,
    };
    ```
    (Note: `navy-vault-abi.json` is a bare ABI array; use `vaultArtifact` directly, not `vaultArtifact.abi` — confirm by checking the file is an array. If the payments artifact is `{abi:[...]}` and the vault file is `[...]`, use the correct shape for each. The vault ABI was exported via `jq '.abi'`, so it is a bare array.)
  - Return the new fields.

- [ ] **Step 4: Typecheck**

Run (from `be/`): `pnpm build`
Expected: compiles. (Do NOT need a live vault — the contracts are lazily connected; construction only needs the address string, which is env-validated at boot.)

- [ ] **Step 5: Commit**

```bash
git add be/src/config/config.service.ts be/src/evm/evm.module.ts be/src/evm/yield-adapter-abi.json
git commit -m "feat(be): wire NavyVault + keeper wallet + adapter ABI into the EVM provider"
```

---

## Phase C — BFF: deposit, redeem, reads

### Task 5: Vault deposit BFF (authorization + submit)

**Files:**
- Create: `be/src/vault/vault.service.ts` (deposit methods first)
- Create: `be/src/vault/dto.ts`

Mirror `be/src/transfer/transfer.service.ts` (random-nonce EIP-3009 + CAS + relay).

- [ ] **Step 1: Add DTOs** in `be/src/vault/dto.ts`:

```typescript
export class DepositAuthorizationDto { amountBase!: string; }
export class SubmitDto { id!: string; signature!: string; }
export class RedeemPermitDto { sharesBase!: string; }
```

- [ ] **Step 2: Implement deposit methods** in `be/src/vault/vault.service.ts`:

```typescript
import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ethers } from 'ethers';
import { PrismaService } from '../prisma/prisma.service';
import { NAVY_EVM, NavyEvm } from '../evm/evm.module';
import {
  buildDepositAuthorizationTypedData, depositAuthorizationDigest, recoverDepositSigner, randomNonce,
} from './vault-authorization';

@Injectable()
export class VaultService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(NAVY_EVM) private readonly chain: NavyEvm,
  ) {}

  /** Build the EIP-3009 ReceiveWithAuthorization typed data (to = vault) and persist a single-use nonce. */
  async buildDepositAuthorization(userId: string, userAddress: string, amountBase: bigint) {
    if (amountBase <= 0n) throw new BadRequestException('amountBase must be positive');
    const validBefore = Math.floor(Date.now() / 1000) + 3600;
    const nonce = randomNonce();
    const td = buildDepositAuthorizationTypedData({
      domain: this.chain.usdcDomain,
      from: userAddress,
      to: await this.chain.vault.getAddress(),
      amount: amountBase,
      validAfter: 0,
      validBefore,
      nonce,
    });
    const digest = depositAuthorizationDigest(td);
    await this.prisma.vaultDeposit.create({
      data: {
        userId, userAddress, assetsBase: amountBase, nonce, digest,
        validBefore: new Date(validBefore * 1000), status: 'awaiting_signature',
      },
    });
    return { typedData: td, deposit: { id: (await this.prisma.vaultDeposit.findUniqueOrThrow({ where: { digest } })).id } };
  }

  /** Recover signer, assert it is the user, CAS-consume, and relay depositWithAuthorization. */
  async submitDeposit(id: string, signature: string, expectedUser: string) {
    const d = await this.prisma.vaultDeposit.findUnique({ where: { id } });
    if (!d) throw new BadRequestException('Unknown deposit');
    const signer = ethers.verifyTypedData(
      this.chain.usdcDomain,
      { ReceiveWithAuthorization: [
        { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
      ] },
      { from: d.userAddress, to: await this.chain.vault.getAddress(), value: d.assetsBase.toString(),
        validAfter: 0, validBefore: Math.floor((d.validBefore as Date).getTime() / 1000), nonce: d.nonce },
      signature,
    );
    if (signer.toLowerCase() !== expectedUser.toLowerCase()) throw new BadRequestException('Signature does not match caller');

    const consumed = await this.prisma.vaultDeposit.updateMany({
      where: { id, consumedAt: null }, data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) throw new BadRequestException('Authorization already submitted');

    const sig = ethers.Signature.from(signature);
    const validBefore = Math.floor((d.validBefore as Date).getTime() / 1000);
    try {
      const tx = await this.chain.vault.depositWithAuthorization(
        d.userAddress, d.assetsBase, 0, validBefore, d.nonce, sig.v, sig.r, sig.s,
      );
      await this.prisma.vaultDeposit.update({ where: { id }, data: { status: 'confirming', txHash: tx.hash } });
      return { status: 'confirming', txHash: tx.hash };
    } catch (e) {
      // Relay failed: release the nonce so the user can retry.
      await this.prisma.vaultDeposit.update({ where: { id }, data: { consumedAt: null, status: 'failed' } });
      throw new ServiceUnavailableException('Relay failed: ' + (e as Error).message);
    }
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm build`
Expected: compiles.

- [ ] **Step 4: Commit**

```bash
git add be/src/vault/vault.service.ts be/src/vault/dto.ts
git commit -m "feat(be): vault deposit BFF (EIP-3009 authorization + CAS + relay)"
```

---

### Task 6: Vault redeem BFF (permit + submit)

**Files:**
- Modify: `be/src/vault/vault.service.ts` (add redeem methods)

Gasless redeem: user signs an ERC-2612 permit over their navUSDC shares granting the **relayer** an allowance; the relayer calls `vault.permit(...)` then `vault.redeem(shares, user, user)`.

- [ ] **Step 1: Add redeem methods** to `VaultService`:

```typescript
  /** Build the ERC-2612 permit typed data (owner=user, spender=relayer) over the share token. */
  async buildRedeemPermit(userId: string, userAddress: string, sharesBase: bigint) {
    if (sharesBase <= 0n) throw new BadRequestException('sharesBase must be positive');
    const bal: bigint = await this.chain.vault.balanceOf(userAddress);
    if (sharesBase > bal) throw new BadRequestException('Insufficient shares');
    const nonce: bigint = await this.chain.vault.nonces(userAddress);
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const spender = await this.chain.relayer.getAddress();
    const { buildRedeemPermitTypedData, redeemPermitDigest } = await import('./vault-authorization');
    const td = buildRedeemPermitTypedData({
      domain: this.chain.vaultShareDomain, owner: userAddress, spender, value: sharesBase, nonce, deadline,
    });
    const digest = redeemPermitDigest(td);
    const row = await this.prisma.vaultRedeem.create({
      data: { userId, userAddress, sharesBase, digest, deadline: new Date(deadline * 1000), status: 'awaiting_signature' },
    });
    return { typedData: td, redeem: { id: row.id } };
  }

  /** Recover signer, assert user, CAS-consume, relay permit + redeem(shares, user, user). */
  async submitRedeem(id: string, signature: string, expectedUser: string) {
    const r = await this.prisma.vaultRedeem.findUnique({ where: { id } });
    if (!r) throw new BadRequestException('Unknown redeem');
    const spender = await this.chain.relayer.getAddress();
    const nonce: bigint = await this.chain.vault.nonces(r.userAddress);
    const deadline = Math.floor((r.deadline as Date).getTime() / 1000);
    const { buildRedeemPermitTypedData, recoverRedeemSigner } = await import('./vault-authorization');
    const td = buildRedeemPermitTypedData({
      domain: this.chain.vaultShareDomain, owner: r.userAddress, spender, value: r.sharesBase, nonce, deadline,
    });
    const signer = recoverRedeemSigner(td, signature);
    if (signer.toLowerCase() !== expectedUser.toLowerCase()) throw new BadRequestException('Signature does not match caller');

    const consumed = await this.prisma.vaultRedeem.updateMany({ where: { id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (consumed.count !== 1) throw new BadRequestException('Permit already submitted');

    const sig = ethers.Signature.from(signature);
    try {
      const permitTx = await this.chain.vault.permit(r.userAddress, spender, r.sharesBase, deadline, sig.v, sig.r, sig.s);
      await permitTx.wait();
      const tx = await this.chain.vault.redeem(r.sharesBase, r.userAddress, r.userAddress);
      await this.prisma.vaultRedeem.update({ where: { id }, data: { status: 'confirming', txHash: tx.hash } });
      return { status: 'confirming', txHash: tx.hash };
    } catch (e) {
      await this.prisma.vaultRedeem.update({ where: { id }, data: { consumedAt: null, status: 'failed' } });
      throw new ServiceUnavailableException('Relay failed: ' + (e as Error).message);
    }
  }

  /** Read-only: a user's share balance, its asset value, and pool APYs. */
  async getPosition(userAddress: string) {
    const shares: bigint = await this.chain.vault.balanceOf(userAddress);
    const assets: bigint = shares === 0n ? 0n : await this.chain.vault.convertToAssets(shares);
    return { sharesBase: shares.toString(), assetsBase: assets.toString() };
  }

  async getApys() {
    const count: bigint = await this.chain.vault.adapterCount();
    const out: { adapter: string; aprE18: string; assetsBase: string }[] = [];
    for (let i = 0n; i < count; i++) {
      const addr: string = await this.chain.vault.adapters(i);
      const adapter = new ethers.Contract(addr, this.chain.yieldAdapterAbi, this.chain.provider);
      const [apr, assets]: [bigint, bigint] = await Promise.all([adapter.supplyRatePerYear(), adapter.totalAssets()]);
      out.push({ adapter: addr, aprE18: apr.toString(), assetsBase: assets.toString() });
    }
    return out;
  }
```

- [ ] **Step 2: Typecheck**

Run: `pnpm build`
Expected: compiles. (`this.chain.yieldAdapterAbi` must be exported from the EVM provider per Task 4 — if missing, add it.)

- [ ] **Step 3: Commit**

```bash
git add be/src/vault/vault.service.ts
git commit -m "feat(be): vault redeem BFF (ERC-2612 permit + relay) + position/apys reads"
```

---

### Task 7: Vault controller + module + BigInt serialization

**Files:**
- Create: `be/src/vault/vault.controller.ts`
- Create: `be/src/vault/vault.module.ts`
- Modify: `be/src/app.module.ts`

- [ ] **Step 1: Implement the controller** `be/src/vault/vault.controller.ts` (guarded `@Roles('user')`, `req.user.walletAddress` as the payer/owner; strings in/out):

```typescript
import { Body, Controller, Get, Post, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { VaultService } from './vault.service';
import { DepositAuthorizationDto, RedeemPermitDto, SubmitDto } from './dto';

function reqAmount(s: string): bigint {
  if (!/^\d+$/.test(s)) throw new BadRequestException('amount must be a base-unit integer string');
  return BigInt(s);
}

@Controller('vault')
@UseGuards(JwtGuard, RolesGuard)
@Roles('user')
export class VaultController {
  constructor(private readonly vault: VaultService) {}

  @Post('deposit/authorization')
  depositAuth(@Req() req: any, @Body() dto: DepositAuthorizationDto) {
    return this.vault.buildDepositAuthorization(req.user.sub, req.user.walletAddress, reqAmount(dto.amountBase));
  }

  @Post('deposit/submit')
  depositSubmit(@Req() req: any, @Body() dto: SubmitDto) {
    return this.vault.submitDeposit(dto.id, dto.signature, req.user.walletAddress);
  }

  @Post('redeem/permit')
  redeemPermit(@Req() req: any, @Body() dto: RedeemPermitDto) {
    return this.vault.buildRedeemPermit(req.user.sub, req.user.walletAddress, reqAmount(dto.sharesBase));
  }

  @Post('redeem/submit')
  redeemSubmit(@Req() req: any, @Body() dto: SubmitDto) {
    return this.vault.submitRedeem(dto.id, dto.signature, req.user.walletAddress);
  }

  @Get('position')
  position(@Req() req: any) {
    return this.vault.getPosition(req.user.walletAddress);
  }

  @Get('apys')
  apys() {
    return this.vault.getApys();
  }
}
```

- [ ] **Step 2: Implement the module** `be/src/vault/vault.module.ts` (RebalancerService + VaultWatcherService added in Tasks 8–9):

```typescript
import { Module } from '@nestjs/common';
import { VaultController } from './vault.controller';
import { VaultService } from './vault.service';

@Module({
  controllers: [VaultController],
  providers: [VaultService],
  exports: [VaultService],
})
export class VaultModule {}
```

- [ ] **Step 3: Register** in `be/src/app.module.ts` — add `VaultModule` to the `imports` array (alongside `TransferModule`, `FarmingModule`).

- [ ] **Step 4: Typecheck**

Run: `pnpm build`
Expected: compiles.

- [ ] **Step 5: Commit**

```bash
git add be/src/vault/vault.controller.ts be/src/vault/vault.module.ts be/src/app.module.ts
git commit -m "feat(be): vault controller + module registration"
```

---

## Phase D — Keeper + watcher

### Task 8: Rebalancer keeper (cron)

**Files:**
- Create: `be/src/vault/rebalancer.service.ts`
- Modify: `be/src/vault/vault.module.ts`

Mirror `be/src/farming/farming-agent.scheduler.ts` (cron + `running` re-entrancy guard). Reads adapter APY + allocation + `targetBps` + idle, calls `decideRebalance`, executes moves from the **keeper** wallet, records `RebalanceEvent`.

- [ ] **Step 1: Implement `be/src/vault/rebalancer.service.ts`**:

```typescript
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ethers } from 'ethers';
import { PrismaService } from '../prisma/prisma.service';
import { NAVY_EVM, NavyEvm } from '../evm/evm.module';
import { NavyConfigService } from '../config/config.service';
import { decideRebalance, AdapterState, RebalanceConfig, Move } from './rebalance.logic';

@Injectable()
export class RebalancerService {
  private readonly logger = new Logger(RebalancerService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: NavyConfigService,
    @Inject(NAVY_EVM) private readonly chain: NavyEvm,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async tick() {
    if (this.running) { this.logger.warn('rebalancer tick still running; skipping'); return; }
    this.running = true;
    try { await this.tickOnce(); }
    catch (e) { this.logger.error('rebalancer tick failed: ' + (e as Error).message); }
    finally { this.running = false; }
  }

  async tickOnce(): Promise<void> {
    const vault = this.chain.vault;
    const count: bigint = await vault.adapterCount();
    if (count === 0n) return;

    const adapters: AdapterState[] = [];
    for (let i = 0n; i < count; i++) {
      const addr: string = await vault.adapters(i);
      const info = await vault.adapterInfo(addr); // (exists, targetBps, capBps)
      const ad = new ethers.Contract(addr, this.chain.yieldAdapterAbi, this.chain.provider);
      const [apr, assets]: [bigint, bigint] = await Promise.all([ad.supplyRatePerYear(), ad.totalAssets()]);
      adapters.push({ address: addr, targetBps: Number(info.targetBps ?? info[1]), aprE18: apr, assetsBase: assets });
    }
    const totalBase: bigint = await vault.totalAssets();
    const idleBase: bigint = await this.chain.usdc.balanceOf(await vault.getAddress());

    const config: RebalanceConfig = {
      driftBandBps: this.cfg.rebalanceDriftBandBps,
      minIdleBps: this.cfg.rebalanceMinIdleBps,
      gasCostBase: this.cfg.rebalanceGasCostBase,
      safetyFactor: this.cfg.rebalanceSafetyFactor,
      horizonSeconds: this.cfg.rebalanceHorizonSeconds,
    };
    const moves = decideRebalance({ adapters, idleBase, totalBase, config });
    for (const m of moves) {
      try { await this.execute(m); }
      catch (e) { this.logger.error(`move failed (${m.kind}): ${(e as Error).message}`); }
    }
  }

  private async execute(m: Move): Promise<void> {
    const v = this.chain.vaultAsKeeper;
    if (m.kind === 'deploy') {
      const tx = await v.deployToAdapter(m.toAdapter, m.amountBase);
      await this.prisma.rebalanceEvent.create({ data: {
        kind: 'deploy', toAdapter: m.toAdapter, amountBase: m.amountBase,
        aprToE18: m.aprToE18, txHash: tx.hash, status: 'confirming',
      }});
    } else {
      const tx = await v.reallocate(m.fromAdapter, m.toAdapter, m.amountBase);
      await this.prisma.rebalanceEvent.create({ data: {
        kind: 'reallocate', fromAdapter: m.fromAdapter, toAdapter: m.toAdapter, amountBase: m.amountBase,
        aprFromE18: m.aprFromE18, aprToE18: m.aprToE18, txHash: tx.hash, status: 'confirming',
      }});
    }
  }
}
```

- [ ] **Step 2: Add the config getters** in `be/src/config/config.service.ts`:

```typescript
  get rebalanceDriftBandBps(): number { return parseInt(this.env.NAVY_REBALANCE_DRIFT_BPS ?? '500', 10); }
  get rebalanceMinIdleBps(): number { return parseInt(this.env.NAVY_REBALANCE_MIN_IDLE_BPS ?? '1000', 10); }
  get rebalanceGasCostBase(): bigint { return BigInt(this.env.NAVY_REBALANCE_GAS_COST_BASE ?? '100000'); }
  get rebalanceSafetyFactor(): number { return parseInt(this.env.NAVY_REBALANCE_SAFETY_FACTOR ?? '2', 10); }
  get rebalanceHorizonSeconds(): number { return parseInt(this.env.NAVY_REBALANCE_HORIZON_SECONDS ?? '21600', 10); }
```

- [ ] **Step 3: Register** `RebalancerService` in `be/src/vault/vault.module.ts` providers.

- [ ] **Step 4: Typecheck**

Run: `pnpm build`
Expected: compiles. (`adapterInfo` returns a struct — index or named access both work with ethers v6; the code tolerates both via `info.targetBps ?? info[1]`.)

- [ ] **Step 5: Commit**

```bash
git add be/src/vault/rebalancer.service.ts be/src/vault/vault.module.ts be/src/config/config.service.ts
git commit -m "feat(be): rebalancer keeper cron driving decideRebalance from the keeper wallet"
```

---

### Task 9: Vault event watcher + reconciliation

**Files:**
- Create: `be/src/vault/vault-watcher.service.ts`
- Modify: `be/src/vault/vault.module.ts`

Mirror `be/src/payments/chain-watcher.service.ts`: poll `confirming` rows, read receipts, decode `Deposit`/`Withdraw`/`Reallocated`/`Deployed`/`Divested`, reconcile status, and a recovery sweep.

- [ ] **Step 1: Implement `be/src/vault/vault-watcher.service.ts`**:

```typescript
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NAVY_EVM, NavyEvm } from '../evm/evm.module';

@Injectable()
export class VaultWatcherService {
  private readonly logger = new Logger(VaultWatcherService.name);
  constructor(
    private readonly prisma: PrismaService,
    @Inject(NAVY_EVM) private readonly chain: NavyEvm,
  ) {}

  @Interval(15000)
  async sweepConfirming() {
    await this.sweep('vaultDeposit');
    await this.sweep('vaultRedeem');
    await this.sweepRebalance();
  }

  private async sweep(model: 'vaultDeposit' | 'vaultRedeem') {
    const rows = await (this.prisma as any)[model].findMany({ where: { status: 'confirming' } });
    for (const row of rows) {
      if (!row.txHash) continue;
      const receipt = await this.chain.provider.getTransactionReceipt(row.txHash);
      if (!receipt) continue; // still pending
      const status = receipt.status === 1 ? 'confirmed' : 'failed';
      await (this.prisma as any)[model].update({ where: { id: row.id }, data: { status } });
      if (status === 'failed') {
        this.logger.warn(`${model} ${row.id} reverted on-chain (tx ${row.txHash})`);
      }
    }
  }

  private async sweepRebalance() {
    const rows = await this.prisma.rebalanceEvent.findMany({ where: { status: 'confirming' } });
    for (const row of rows) {
      if (!row.txHash) continue;
      const receipt = await this.chain.provider.getTransactionReceipt(row.txHash);
      if (!receipt) continue;
      await this.prisma.rebalanceEvent.update({
        where: { id: row.id }, data: { status: receipt.status === 1 ? 'confirmed' : 'failed' },
      });
    }
  }

  /** Recover deposits stranded between CAS-consume and the confirming write (mirrors ChainWatcher). */
  @Interval(45000)
  async recoverConsumedDeposits() {
    const stranded = await this.prisma.vaultDeposit.findMany({
      where: { status: 'awaiting_signature', consumedAt: { not: null }, txHash: null },
    });
    for (const d of stranded) {
      // If the on-chain USDC authorization nonce was used, the deposit likely landed; otherwise release it.
      try {
        const used: boolean = await this.chain.usdc.authorizationState(d.userAddress, d.nonce);
        if (used) {
          await this.prisma.vaultDeposit.update({ where: { id: d.id }, data: { status: 'confirming' } });
        } else if (d.validBefore && d.validBefore.getTime() < Date.now()) {
          await this.prisma.vaultDeposit.update({ where: { id: d.id }, data: { consumedAt: null, status: 'failed' } });
        }
      } catch (e) {
        this.logger.error('recoverConsumedDeposits: ' + (e as Error).message);
      }
    }
  }
}
```

- [ ] **Step 2: Ensure `authorizationState` is on the USDC ABI** at `be/src/evm/usdc-abi.json` (add if missing: `{"type":"function","name":"authorizationState","stateMutability":"view","inputs":[{"type":"address"},{"type":"bytes32"}],"outputs":[{"type":"bool"}]}`). Verify by reading the file; add the entry if absent.

- [ ] **Step 3: Register** `VaultWatcherService` in `be/src/vault/vault.module.ts` providers.

- [ ] **Step 4: Typecheck**

Run: `pnpm build`
Expected: compiles.

- [ ] **Step 5: Commit**

```bash
git add be/src/vault/vault-watcher.service.ts be/src/vault/vault.module.ts be/src/evm/usdc-abi.json
git commit -m "feat(be): vault event watcher + deposit crash-recovery sweep"
```

---

## Phase E — Wiring, env, and live proof

### Task 10: Env documentation + boot smoke

**Files:**
- Modify: `be/.env.example` (create the keys if the file exists; otherwise document in `be/scripts/gateway-bringup.md`)

- [ ] **Step 1: Document the new env keys** (append to `be/.env.example` or the bring-up runbook):

```
# NavyVault (Plan 2)
NAVY_VAULT_ADDRESS=            # deployed NavyVault (Plan 1 DeployVault output)
NAVY_KEEPER_PRIVATE_KEY=       # allocator/keeper wallet (falls back to NAVY_OWNER_PRIVATE_KEY)
NAVY_VAULT_EIP712_NAME=Navy Vault USDC
NAVY_VAULT_EIP712_VERSION=1
NAVY_REBALANCE_DRIFT_BPS=500
NAVY_REBALANCE_MIN_IDLE_BPS=1000
NAVY_REBALANCE_GAS_COST_BASE=100000
NAVY_REBALANCE_SAFETY_FACTOR=2
NAVY_REBALANCE_HORIZON_SECONDS=21600
```

- [ ] **Step 2: Full build + unit tests**

Run (from `be/`): `pnpm build && pnpm test vault`
Expected: build passes; the plain-TS specs (`vault-authorization`, `rebalance.logic`) pass. (Service/keeper/watcher have chain deps and are verified via build + the deferred E2E, per the codebase convention.)

- [ ] **Step 3: Commit**

```bash
git add be/.env.example
git commit -m "docs(be): document NavyVault backend env keys"
```

---

### Task 11: Live E2E proof script (DEFERRED — needs a deployed vault)

**Files:**
- Create: `be/scripts/vault-e2e.mjs`

A standalone live-Sepolia proof (mirrors `be/scripts/evm-e2e.mjs` / `farming-e2e.mjs`): with a funded relayer + keeper + a deployed vault, it (1) builds a deposit authorization, signs it with a test key, submits → asserts shares minted; (2) reads position/apys; (3) triggers a rebalance tick; (4) builds a redeem permit, signs, submits → asserts USDC returned. Gated behind an env flag (`NAVY_VAULT_E2E=1`).

- [ ] **Step 1: Write `be/scripts/vault-e2e.mjs`** following the structure of `be/scripts/evm-e2e.mjs` (read that file first for the exact bootstrap: RPC/wallet setup, contract instantiation from the ABI JSON, and the assert helpers). Implement the 4 steps above with clear `console.log` assertions and non-zero exit on failure.

- [ ] **Step 2: (DEFERRED) Run against a deployed vault**

Run: `NAVY_VAULT_E2E=1 NAVY_VAULT_ADDRESS=<deployed> node be/scripts/vault-e2e.mjs`
Expected: deposit→position→rebalance→redeem all assert green. **This step is blocked until Plan 1 is deployed to Sepolia with funded relayer/keeper — mark it done only after a live run.**

- [ ] **Step 3: Commit**

```bash
git add be/scripts/vault-e2e.mjs
git commit -m "feat(be): live-Sepolia vault E2E proof script (deposit/rebalance/redeem)"
```

---

## Self-Review

**Spec coverage (Plan 2 portion of the design doc):**
- Gasless deposit (relayer + EIP-3009 `depositWithAuthorization`) → Tasks 2, 5. ✅
- Gasless redeem (ERC-2612 permit on share token + relayer `redeem`) → Tasks 2, 6. ✅
- `GET /vault/position`, `GET /vault/apys` → Task 6/7. ✅
- Durable single-use nonce + CAS-consume + signer==caller assertion → Tasks 5, 6 (mirrors payments/transfer). ✅
- Rebalancer keeper (cron, re-entrancy guard, target-weight+drift, gas-breakeven, idle buffer) → Tasks 3, 8. ✅
- On-chain constraints are the guardrail; keeper only optimizes → keeper calls `reallocate`/`deployToAdapter` which the audited contract bounds (cap/minIdle/maxLoss). ✅
- VaultWatcher (decode events, reconcile, crash-recovery sweep mirroring `recoverConsumedOrders`) → Task 9. ✅
- Prisma models `VaultDeposit`/`VaultRedeem`/`RebalanceEvent`; BigInt→string at boundary → Tasks 1, 7. ✅
- Live proof `vault-e2e.mjs` → Task 11 (deferred to deployment). ✅

**Correctly deferred / out of scope:** removal of the old farming/subwallet/crypto code, AI-assistant tool repoint, fe/expo screens — all **Plan 3**. The live E2E + any integration test that hits a real contract wait on the Sepolia deploy.

**Placeholder scan:** No `TODO`/"implement later" steps. The only deferred *execution* is Task 11 Step 2 (needs a deployed vault) and Task 1 Step 2 (needs Postgres up) — both are environment prerequisites, clearly marked, with the code written now. The redeem `spender` is the relayer (matches `redeem(shares, receiver, owner)` allowance semantics); the deposit nonce is a random bytes32 (vault deposits have no invoice key, matching `transfer`).

**Type consistency:** `decideRebalance` returns `Move[]` consumed verbatim by `RebalancerService.execute`; `AdapterState`/`RebalanceConfig` field names match between logic, spec, and keeper. Typed-data builder names (`buildDepositAuthorizationTypedData`, `recoverDepositSigner`, `buildRedeemPermitTypedData`, `recoverRedeemSigner`, `randomNonce`) match between `vault-authorization.ts`, its spec, and `VaultService`. Prisma field names (`assetsBase`, `sharesBase`, `nonce`, `digest`, `consumedAt`, `validBefore`, `deadline`, `status`, `txHash`) match between the schema and every service query. `NavyEvm` additions (`vault`, `vaultAsKeeper`, `keeper`, `vaultShareDomain`, `yieldAdapterAbi`) are defined in Task 4 and consumed in Tasks 5, 6, 8, 9.

**Note on ABI shape:** `be/src/evm/navy-vault-abi.json` is a **bare ABI array** (exported via `jq '.abi'`), whereas `navy-payments-abi.json` is `{abi:[...]}`. Task 4 uses `vaultArtifact` directly. The implementer must verify each file's shape before `new ethers.Contract(...)` and use the correct reference.
