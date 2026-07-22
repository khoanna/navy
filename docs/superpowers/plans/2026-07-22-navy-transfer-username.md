# Navy Transfer + @username Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in `@username` directory and a gasless USDC peer-to-peer transfer (EIP-3009 `transferWithAuthorization` relayed by the backend) that the AI Assistant (Plan 2) will later drive.

**Architecture:** Backend gains a `User.username` field + lookup endpoints and a new `be/src/transfer` module that mirrors the existing payment relayer pattern (build EIP-712 typed data → persist its digest as a single-use nonce → user signs → relayer submits `usdc.transferWithAuthorization` → watcher reconciles). The expo-wallet gets a username claim UI in Settings. The transfer *confirm card* UI is built in Plan 2; here we build and prove the rails end-to-end with a live-Sepolia script.

**Tech Stack:** Nest.js 11, Prisma 7 (Postgres), ethers v6, Expo/React Native, Jest, Foundry-deployed Circle USDC on Sepolia.

---

## Prerequisites

- `be/` Postgres up: `docker compose up -d`.
- Circle USDC on Sepolia already configured (`NAVY_USDC_ADDRESS`), and the relayer wallet funded with Sepolia ETH (it pays gas for `transferWithAuthorization`).
- `DATABASE_URL` exported in the shell for any `prisma` CLI command (per CLAUDE.md gotcha).

## File Structure

**Backend (create):**
- `be/src/common/username.ts` — pure username normalize/validate (unit-tested).
- `be/src/transfer/transfer-authorization.ts` — pure EIP-712 `TransferWithAuthorization` builder/digest/recover (unit-tested).
- `be/src/transfer/transfer-guards.ts` — pure recipient parsing + guard predicates (unit-tested).
- `be/src/transfer/transfer.service.ts` — build/submit/history (chain + DB; typecheck-verified).
- `be/src/transfer/transfer.controller.ts` — REST endpoints.
- `be/src/transfer/transfer-watcher.service.ts` — reconciles broadcast transfers.
- `be/src/transfer/transfer.module.ts` — module wiring.
- `be/src/evm/usdc-abi.json` — minimal USDC ABI runtime asset.
- `be/scripts/transfer-e2e.mjs` — standalone live-Sepolia proof.

**Backend (modify):**
- `be/prisma/schema.prisma` — add `User.username` + `Transfer` model.
- `be/src/evm/evm.module.ts` — add `usdc` (relayer-connected) contract to `NavyEvm`.
- `be/src/user/user.service.ts` + `be/src/user/user.module.ts` — username methods; new `UserAccountController`.
- `be/src/config/config.service.ts` — `relayerMinBalanceWei` already exists; no new required env.
- `be/src/app.module.ts` — register `TransferModule`.

**Expo (create):**
- `expo-wallet/src/lib/account/username.ts` — pure validation (shared shape with backend, unit-tested).
- `expo-wallet/src/lib/account/usernameClient.ts` — REST client (unit-tested).
- `expo-wallet/src/features/settings/UsernameSheet.tsx` — claim/edit UI.

**Expo (modify):**
- `expo-wallet/app/(tabs)/settings.tsx` — add a row opening `UsernameSheet`.

---

## Phase A — @username directory (backend)

### Task A1: Add `User.username` to Prisma schema + migrate

**Files:**
- Modify: `be/prisma/schema.prisma` (the `User` model, lines 9-18)

- [ ] **Step 1: Add the field**

In `model User`, add after `primaryWallet`:

```prisma
  username                String?   @unique
```

- [ ] **Step 2: Create the migration**

Run: `cd be && DATABASE_URL="$DATABASE_URL" pnpm prisma migrate dev --name add_user_username`
Expected: migration created + applied, Prisma client regenerated.

- [ ] **Step 3: Verify the client typechecks**

Run: `cd be && pnpm build`
Expected: build succeeds (the generated client now has `username`).

- [ ] **Step 4: Commit**

```bash
git add be/prisma/schema.prisma be/prisma/migrations
git commit -m "feat(be): add opt-in User.username field"
```

### Task A2: Pure username validation

**Files:**
- Create: `be/src/common/username.ts`
- Test: `be/src/common/username.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { normalizeUsername, isValidUsername, USERNAME_RE } from './username';

describe('username', () => {
  it('normalizes to lowercase and strips a leading @', () => {
    expect(normalizeUsername('  @Linh_01 ')).toBe('linh_01');
  });
  it('accepts 3-20 chars of [a-z0-9_]', () => {
    expect(isValidUsername('linh_01')).toBe(true);
    expect(isValidUsername('abc')).toBe(true);
  });
  it('rejects too short, too long, and bad chars', () => {
    expect(isValidUsername('ab')).toBe(false);
    expect(isValidUsername('a'.repeat(21))).toBe(false);
    expect(isValidUsername('bad-name')).toBe(false);
    expect(isValidUsername('has space')).toBe(false);
  });
  it('USERNAME_RE matches the normalized form', () => {
    expect(USERNAME_RE.test('linh_01')).toBe(true);
    expect(USERNAME_RE.test('Linh')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd be && pnpm test username.spec`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// be/src/common/username.ts
/** Canonical username charset: 3-20 lowercase alphanumerics/underscores. */
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

/** Lowercase, trim, and drop a single leading '@' so '@Linh' and 'linh' resolve alike. */
export function normalizeUsername(input: string): string {
  return input.trim().replace(/^@/, '').toLowerCase();
}

/** True when the (already-normalized) value is a legal handle. */
export function isValidUsername(value: string): boolean {
  return USERNAME_RE.test(value);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd be && pnpm test username.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add be/src/common/username.ts be/src/common/username.spec.ts
git commit -m "feat(be): pure username normalize/validate"
```

### Task A3: Username service methods + account controller

**Files:**
- Modify: `be/src/user/user.service.ts`
- Create: `be/src/user/user-account.controller.ts`
- Modify: `be/src/user/user.module.ts`
- Test: `be/src/user/user.service.spec.ts`

- [ ] **Step 1: Write the failing test (service resolution + set)**

```ts
// be/src/user/user.service.spec.ts
import { UserService } from './user.service';

function fakePrisma() {
  const rows: any[] = [];
  return {
    rows,
    user: {
      findUnique: jest.fn(async ({ where }: any) =>
        rows.find((r) => (where.username ? r.username === where.username : r.id === where.id)) ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        const r = rows.find((x) => x.id === where.id);
        Object.assign(r, data);
        return r;
      }),
    },
  } as any;
}

describe('UserService usernames', () => {
  it('resolveUsername returns the primaryWallet of an active user', async () => {
    const prisma = fakePrisma();
    prisma.rows.push({ id: 'u1', username: 'linh', primaryWallet: '0xabc', status: 'active' });
    const svc = new UserService(prisma);
    expect(await svc.resolveUsername('LINH')).toEqual({ username: 'linh', address: '0xabc' });
  });
  it('resolveUsername returns null for unknown/inactive/no-wallet', async () => {
    const prisma = fakePrisma();
    prisma.rows.push({ id: 'u2', username: 'gone', primaryWallet: null, status: 'active' });
    const svc = new UserService(prisma);
    expect(await svc.resolveUsername('nobody')).toBeNull();
    expect(await svc.resolveUsername('gone')).toBeNull();
  });
  it('setUsername rejects an invalid handle', async () => {
    const svc = new UserService(fakePrisma());
    await expect(svc.setUsername('u1', 'bad name')).rejects.toThrow(/invalid/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd be && pnpm test user.service.spec`
Expected: FAIL (methods missing).

- [ ] **Step 3: Implement the service methods**

Replace `be/src/user/user.service.ts` with:

```ts
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeUsername, isValidUsername } from '../common/username';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  upsertByDid(privyDid: string, primaryWallet?: string) {
    return this.prisma.user.upsert({
      where: { privyDid },
      create: { privyDid, primaryWallet: primaryWallet ?? null },
      update: { primaryWallet: primaryWallet ?? undefined },
    });
  }

  /** Public profile for the authenticated user (id, wallet, username). */
  async me(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u) throw new BadRequestException('User not found');
    return { id: u.id, walletAddress: u.primaryWallet, username: u.username ?? null };
  }

  /** True when the normalized handle is free (or already owned by this user). */
  async isUsernameAvailable(raw: string, forUserId?: string): Promise<boolean> {
    const username = normalizeUsername(raw);
    if (!isValidUsername(username)) return false;
    const existing = await this.prisma.user.findUnique({ where: { username } });
    return !existing || existing.id === forUserId;
  }

  /** Claim/replace this user's handle. Throws on invalid or taken. */
  async setUsername(userId: string, raw: string) {
    const username = normalizeUsername(raw);
    if (!isValidUsername(username)) throw new BadRequestException('invalid username');
    const existing = await this.prisma.user.findUnique({ where: { username } });
    if (existing && existing.id !== userId) throw new ConflictException('username taken');
    return this.prisma.user.update({ where: { id: userId }, data: { username } });
  }

  async clearUsername(userId: string) {
    return this.prisma.user.update({ where: { id: userId }, data: { username: null } });
  }

  /** Resolve a handle to an active user's wallet address, or null. Returns only address + handle. */
  async resolveUsername(raw: string): Promise<{ username: string; address: string } | null> {
    const username = normalizeUsername(raw);
    if (!isValidUsername(username)) return null;
    const u = await this.prisma.user.findUnique({ where: { username } });
    if (!u || u.status !== 'active' || !u.primaryWallet) return null;
    return { username, address: u.primaryWallet };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd be && pnpm test user.service.spec`
Expected: PASS.

- [ ] **Step 5: Create the account controller**

```ts
// be/src/user/user-account.controller.ts
import { Body, Controller, Delete, Get, Put, Query, Req, UseGuards } from '@nestjs/common';
import { UserService } from './user.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Throttle } from '@nestjs/throttler';
import { IsString, IsNotEmpty } from 'class-validator';

class SetUsernameDto {
  @IsString() @IsNotEmpty() username!: string;
}

@Controller('user/account')
@UseGuards(JwtGuard, RolesGuard)
@Roles('user')
export class UserAccountController {
  constructor(private readonly users: UserService) {}

  @Get('me')
  me(@Req() req: any) { return this.users.me(req.user.sub); }

  @Get('username/available')
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async available(@Req() req: any, @Query('u') u: string) {
    return { available: await this.users.isUsernameAvailable(u ?? '', req.user.sub) };
  }

  @Put('username')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async set(@Req() req: any, @Body() dto: SetUsernameDto) {
    const u = await this.users.setUsername(req.user.sub, dto.username);
    return { username: u.username };
  }

  @Delete('username')
  async clear(@Req() req: any) {
    await this.users.clearUsername(req.user.sub);
    return { username: null };
  }
}
```

- [ ] **Step 6: Register the controller** in `be/src/user/user.module.ts`

Add `UserAccountController` to the module's `controllers: [...]` array (import it at the top). Ensure `UserService` is in `providers` and `exports` (so `TransferModule` can inject it).

- [ ] **Step 7: Typecheck**

Run: `cd be && pnpm build`
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add be/src/user/
git commit -m "feat(be): username resolve/set/clear + /user/account endpoints"
```

---

## Phase B — Gasless USDC transfer (backend)

### Task B1: `Transfer` Prisma model + migrate

**Files:**
- Modify: `be/prisma/schema.prisma`

- [ ] **Step 1: Add the model**

```prisma
model Transfer {
  id          String    @id @default(uuid())
  fromUserId  String
  fromAddress String
  toAddress   String
  toUsername  String?
  amount      BigInt
  nonce       String    @unique   // bytes32 EIP-3009 authorization nonce
  digest      String    @unique   // EIP-712 digest the wallet signs
  validBefore DateTime
  status      String    @default("awaiting_signature") // awaiting_signature|confirming|confirmed|failed
  txHash      String?
  consumedAt  DateTime?
  createdAt   DateTime  @default(now())

  @@index([fromUserId, createdAt])
  @@index([status])
}
```

- [ ] **Step 2: Migrate**

Run: `cd be && DATABASE_URL="$DATABASE_URL" pnpm prisma migrate dev --name add_transfer`
Expected: applied + client regenerated.

- [ ] **Step 3: Commit**

```bash
git add be/prisma/schema.prisma be/prisma/migrations
git commit -m "feat(be): Transfer model for gasless USDC p2p"
```

### Task B2: Pure `TransferWithAuthorization` EIP-712 builder

**Files:**
- Create: `be/src/transfer/transfer-authorization.ts`
- Test: `be/src/transfer/transfer-authorization.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { ethers } from 'ethers';
import {
  buildTransferTypedData, transferDigest, recoverTransferSigner, randomNonce,
} from './transfer-authorization';

const domain = { name: 'USDC', version: '2', chainId: 11155111, verifyingContract: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' };

describe('transfer-authorization', () => {
  it('round-trips: a wallet signature over the typed data recovers the signer', async () => {
    const w = ethers.Wallet.createRandom();
    const td = buildTransferTypedData({
      domain, from: w.address, to: '0x000000000000000000000000000000000000dEaD',
      amount: 1_000000n, validAfter: 0, validBefore: 9999999999, nonce: randomNonce(),
    });
    const sig = await w.signTypedData(td.domain, td.types as any, td.message);
    expect(recoverTransferSigner(td, sig).toLowerCase()).toBe(w.address.toLowerCase());
  });
  it('digest equals ethers TypedDataEncoder.hash', () => {
    const td = buildTransferTypedData({
      domain, from: '0x000000000000000000000000000000000000bEEF',
      to: '0x000000000000000000000000000000000000dEaD',
      amount: 5n, validAfter: 0, validBefore: 100, nonce: randomNonce(),
    });
    expect(transferDigest(td)).toBe(ethers.TypedDataEncoder.hash(td.domain, td.types as any, td.message));
  });
  it('randomNonce is a 0x 32-byte hex', () => {
    expect(randomNonce()).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd be && pnpm test transfer-authorization.spec`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement** (mirrors `be/src/evm/payment-authorization.ts`)

```ts
// be/src/transfer/transfer-authorization.ts
import { ethers } from 'ethers';
import type { UsdcDomain, Eip712Types } from '../evm/payment-authorization';

export const TRANSFER_WITH_AUTHORIZATION_TYPES: Eip712Types = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

export interface TransferTypedData {
  domain: UsdcDomain;
  types: Eip712Types;
  primaryType: 'TransferWithAuthorization';
  message: { from: string; to: string; value: string; validAfter: string; validBefore: string; nonce: string };
}

/** Fresh random 32-byte EIP-3009 nonce (p2p transfers have no deterministic invoice key). */
export function randomNonce(): string {
  return ethers.hexlify(ethers.randomBytes(32));
}

export function buildTransferTypedData(p: {
  domain: UsdcDomain; from: string; to: string; amount: bigint;
  validAfter: number; validBefore: number; nonce: string;
}): TransferTypedData {
  return {
    domain: p.domain,
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: 'TransferWithAuthorization',
    message: {
      from: p.from, to: p.to, value: p.amount.toString(),
      validAfter: p.validAfter.toString(), validBefore: p.validBefore.toString(), nonce: p.nonce,
    },
  };
}

export function transferDigest(td: TransferTypedData): string {
  return ethers.TypedDataEncoder.hash(td.domain, td.types as any, td.message);
}

export function recoverTransferSigner(td: TransferTypedData, signature: string): string {
  return ethers.verifyTypedData(td.domain, td.types as any, td.message, signature);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd be && pnpm test transfer-authorization.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add be/src/transfer/transfer-authorization.ts be/src/transfer/transfer-authorization.spec.ts
git commit -m "feat(be): pure TransferWithAuthorization EIP-712 builder"
```

### Task B3: Pure recipient parsing + guards

**Files:**
- Create: `be/src/transfer/transfer-guards.ts`
- Test: `be/src/transfer/transfer-guards.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { parseRecipient, assertNotSelfTransfer, assertSufficientBalance } from './transfer-guards';

describe('transfer-guards', () => {
  it('parseRecipient detects a checksummed address', () => {
    expect(parseRecipient('0x0000000000000000000000000000000000000001'))
      .toEqual({ kind: 'address', value: '0x0000000000000000000000000000000000000001' });
  });
  it('parseRecipient treats @handle and bare handle as username', () => {
    expect(parseRecipient('@linh')).toEqual({ kind: 'username', value: 'linh' });
    expect(parseRecipient('linh')).toEqual({ kind: 'username', value: 'linh' });
  });
  it('parseRecipient rejects garbage', () => {
    expect(parseRecipient('0xnothex')).toBeNull();
    expect(parseRecipient('')).toBeNull();
  });
  it('assertNotSelfTransfer throws when from == to (case-insensitive)', () => {
    expect(() => assertNotSelfTransfer('0xAbc', '0xabc')).toThrow(/yourself/i);
  });
  it('assertSufficientBalance throws when balance < amount', () => {
    expect(() => assertSufficientBalance(10n, 20n)).toThrow(/insufficient/i);
    expect(() => assertSufficientBalance(20n, 20n)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd be && pnpm test transfer-guards.spec`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// be/src/transfer/transfer-guards.ts
import { ethers } from 'ethers';
import { normalizeUsername, isValidUsername } from '../common/username';

export type Recipient = { kind: 'address'; value: string } | { kind: 'username'; value: string };

/** Classify a recipient string: a valid 0x address, or a normalized @username, else null. */
export function parseRecipient(input: string): Recipient | null {
  const s = (input ?? '').trim();
  if (!s) return null;
  if (s.startsWith('0x') || /^0x/i.test(s)) {
    return ethers.isAddress(s) ? { kind: 'address', value: ethers.getAddress(s) } : null;
  }
  const u = normalizeUsername(s);
  return isValidUsername(u) ? { kind: 'username', value: u } : null;
}

export function assertNotSelfTransfer(from: string, to: string): void {
  if (from.toLowerCase() === to.toLowerCase()) throw new Error('Cannot transfer to yourself');
}

export function assertSufficientBalance(balance: bigint, amount: bigint): void {
  if (balance < amount) throw new Error('Insufficient USDC balance');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd be && pnpm test transfer-guards.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add be/src/transfer/transfer-guards.ts be/src/transfer/transfer-guards.spec.ts
git commit -m "feat(be): pure recipient parsing + transfer guards"
```

### Task B4: USDC contract on NavyEvm + ABI asset

**Files:**
- Create: `be/src/evm/usdc-abi.json`
- Modify: `be/src/evm/evm.module.ts`

- [ ] **Step 1: Create the minimal USDC ABI**

```json
{
  "abi": [
    "function balanceOf(address owner) view returns (uint256)",
    "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
    "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)"
  ]
}
```

- [ ] **Step 2: Wire `usdc` into `NavyEvm`**

In `be/src/evm/evm.module.ts`: `require('./usdc-abi.json')` as `usdcArtifact`; add `usdc: ethers.Contract;` to the `NavyEvm` interface; in the factory build `const usdc = new ethers.Contract(cfg.usdcAddress, usdcArtifact.abi, relayer);` and include `usdc` in the returned object.

- [ ] **Step 3: Typecheck**

Run: `cd be && pnpm build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add be/src/evm/usdc-abi.json be/src/evm/evm.module.ts
git commit -m "feat(be): expose relayer-connected USDC contract on NavyEvm"
```

### Task B5: TransferService (build + submit)

**Files:**
- Create: `be/src/transfer/transfer.service.ts`
- Test: `be/src/transfer/transfer.service.spec.ts` (pure resolution path only)

This service touches chain + DB, so unit tests cover only the pure resolution/guard wiring via injected fakes; the on-chain path is proven by the e2e script (Task B8).

- [ ] **Step 1: Write the failing test (recipient resolution + guards)**

```ts
import { TransferService } from './transfer.service';

const USDC_DOMAIN = { name: 'USDC', version: '2', chainId: 11155111, verifyingContract: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' };

function deps(over: Partial<any> = {}) {
  const chain = {
    provider: {},
    relayer: { address: '0xrelayer' },
    usdc: { balanceOf: jest.fn(async () => 1_000000n) },
    usdcDomain: USDC_DOMAIN,
    ...over.chain,
  };
  const prisma = { transfer: { create: jest.fn(async ({ data }: any) => ({ id: 't1', ...data })) }, ...over.prisma };
  const users = { resolveUsername: jest.fn(async () => ({ username: 'linh', address: '0x000000000000000000000000000000000000dEaD' })), ...over.users };
  const cfg = { relayerMinBalanceWei: 0n, ...over.cfg };
  return { chain, prisma, users, cfg, svc: new TransferService(chain as any, prisma as any, users as any, cfg as any) };
}

describe('TransferService.buildAuthorization', () => {
  it('resolves @username to an address and persists a Transfer with a digest+nonce', async () => {
    const { svc, prisma } = deps();
    const r = await svc.buildAuthorization('u1', '0xSenderAddktktktktktktktktktktktktktktk1', '@linh', 500000n);
    expect(r.typedData.message.to.toLowerCase()).toBe('0x000000000000000000000000000000000000dead');
    expect(r.typedData.message.value).toBe('500000');
    expect(prisma.transfer.create).toHaveBeenCalled();
  });
  it('rejects an unknown username', async () => {
    const { svc } = deps({ users: { resolveUsername: jest.fn(async () => null) } });
    await expect(svc.buildAuthorization('u1', '0xSender', '@ghost', 1n)).rejects.toThrow(/not found/i);
  });
  it('rejects self-transfer', async () => {
    const self = '0x000000000000000000000000000000000000dEaD';
    const { svc } = deps({ users: { resolveUsername: jest.fn(async () => ({ username: 'me', address: self })) } });
    await expect(svc.buildAuthorization('u1', self, '@me', 1n)).rejects.toThrow(/yourself/i);
  });
  it('rejects insufficient balance', async () => {
    const { svc } = deps({ chain: { usdc: { balanceOf: jest.fn(async () => 10n) }, relayer: { address: '0xr' }, usdcDomain: USDC_DOMAIN, provider: {} } });
    await expect(svc.buildAuthorization('u1', '0xSenderAddktktktktktktktktktktktktktktk1', '@linh', 20n)).rejects.toThrow(/insufficient/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd be && pnpm test transfer.service.spec`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// be/src/transfer/transfer.service.ts
import { ethers } from 'ethers';
import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { NAVY_EVM, type NavyEvm } from '../evm/evm.module';
import { PrismaService } from '../prisma/prisma.service';
import { NavyConfigService } from '../config/config.service';
import { UserService } from '../user/user.service';
import {
  buildTransferTypedData, transferDigest, randomNonce, type TransferTypedData,
} from './transfer-authorization';
import { parseRecipient, assertNotSelfTransfer, assertSufficientBalance } from './transfer-guards';

/** Authorizations are valid for this long (seconds). */
const TRANSFER_TTL_SECONDS = 15 * 60;

export interface TransferAuthResult {
  transferId: string;
  typedData: TransferTypedData;
  recipient: { address: string; username: string | null };
  amount: string;
}

@Injectable()
export class TransferService {
  constructor(
    @Inject(NAVY_EVM) private readonly chain: NavyEvm,
    private readonly prisma: PrismaService,
    private readonly users: UserService,
    private readonly cfg: NavyConfigService,
  ) {}

  async buildAuthorization(userId: string, fromAddress: string, recipient: string, amount: bigint): Promise<TransferAuthResult> {
    if (amount <= 0n) throw new BadRequestException('amount must be positive');

    // Relayer pays gas for transferWithAuthorization; fail fast if it's low.
    const relBal = await this.chain.provider.getBalance(this.chain.relayer.address);
    if (relBal < this.cfg.relayerMinBalanceWei) throw new ServiceUnavailableException('Transfer relayer temporarily unavailable');

    const parsed = parseRecipient(recipient);
    if (!parsed) throw new BadRequestException('Invalid recipient');

    let toAddress: string;
    let toUsername: string | null = null;
    if (parsed.kind === 'address') {
      toAddress = parsed.value;
    } else {
      const resolved = await this.users.resolveUsername(parsed.value);
      if (!resolved) throw new BadRequestException(`User @${parsed.value} not found`);
      toAddress = resolved.address;
      toUsername = resolved.username;
    }

    assertNotSelfTransfer(fromAddress, toAddress);

    const balance: bigint = await this.chain.usdc.balanceOf(fromAddress);
    assertSufficientBalance(balance, amount);

    const nonce = randomNonce();
    const validBeforeSec = Math.floor(Date.now() / 1000) + TRANSFER_TTL_SECONDS;
    const typedData = buildTransferTypedData({
      domain: this.chain.usdcDomain, from: fromAddress, to: toAddress,
      amount, validAfter: 0, validBefore: validBeforeSec, nonce,
    });
    const digest = transferDigest(typedData);

    const row = await this.prisma.transfer.create({
      data: {
        fromUserId: userId, fromAddress, toAddress, toUsername, amount,
        nonce, digest, validBefore: new Date(validBeforeSec * 1000), status: 'awaiting_signature',
      },
    });

    return { transferId: row.id, typedData, recipient: { address: toAddress, username: toUsername }, amount: amount.toString() };
  }

  /** Recover signer, CAS-consume, relay transferWithAuthorization, persist confirming + txHash. */
  async submit(userId: string, transferId: string, signature: string, expectedPayer: string): Promise<{ txHash: string; status: string }> {
    const t = await this.prisma.transfer.findUnique({ where: { id: transferId } });
    if (!t || t.fromUserId !== userId) throw new BadRequestException('Transfer not found');
    if (t.consumedAt) throw new BadRequestException('Transfer already submitted');
    if (t.validBefore < new Date()) throw new BadRequestException('Transfer authorization expired');

    let signer: string;
    try { signer = ethers.recoverAddress(t.digest, signature); }
    catch { throw new BadRequestException('Invalid signature'); }
    if (signer.toLowerCase() !== expectedPayer.toLowerCase()) throw new BadRequestException('Signature does not match the authenticated user');

    const consumed = await this.prisma.transfer.updateMany({
      where: { id: transferId, consumedAt: null }, data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) throw new BadRequestException('Transfer already submitted');

    const validBefore = Math.floor(t.validBefore.getTime() / 1000);
    const sig = ethers.Signature.from(signature);
    const tx = await this.chain.usdc.transferWithAuthorization(
      t.fromAddress, t.toAddress, t.amount, 0, validBefore, t.nonce, sig.v, sig.r, sig.s,
    );
    await this.prisma.transfer.update({ where: { id: transferId }, data: { status: 'confirming', txHash: tx.hash } });
    const receipt = await tx.wait();
    const ok = receipt && receipt.status === 1;
    const status = ok ? 'confirmed' : 'failed';
    await this.prisma.transfer.update({
      where: { id: transferId },
      data: ok ? { status } : { status, consumedAt: null }, // revert → allow resubmit
    });
    return { txHash: tx.hash, status };
  }

  async history(userId: string, take = 20) {
    const rows = await this.prisma.transfer.findMany({
      where: { fromUserId: userId }, orderBy: { createdAt: 'desc' }, take,
    });
    return rows.map((r) => ({
      id: r.id, toAddress: r.toAddress, toUsername: r.toUsername,
      amount: r.amount.toString(), status: r.status, txHash: r.txHash, createdAt: r.createdAt,
    }));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd be && pnpm test transfer.service.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add be/src/transfer/transfer.service.ts be/src/transfer/transfer.service.spec.ts
git commit -m "feat(be): TransferService build/submit gasless USDC"
```

### Task B6: TransferController + module + app wiring

**Files:**
- Create: `be/src/transfer/transfer.controller.ts`
- Create: `be/src/transfer/transfer.module.ts`
- Modify: `be/src/app.module.ts`

- [ ] **Step 1: Controller**

```ts
// be/src/transfer/transfer.controller.ts
import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { TransferService } from './transfer.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Throttle } from '@nestjs/throttler';
import { IsString, IsNotEmpty, Matches } from 'class-validator';
import { parsePositiveAmount } from '../common/amount.util';

class BuildDto {
  @IsString() @IsNotEmpty() recipient!: string;
  @IsString() @Matches(/^\d+$/, { message: 'amountBase must be a base-unit integer string' }) amountBase!: string;
}
class SubmitDto {
  @IsString() @IsNotEmpty() transferId!: string;
  @IsString() @Matches(/^0x[0-9a-fA-F]{130}$/, { message: 'signature must be 65-byte hex' }) signature!: string;
}

@Controller('transfer')
@UseGuards(JwtGuard, RolesGuard)
@Roles('user')
export class TransferController {
  constructor(private readonly transfers: TransferService) {}

  @Post('authorization')
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  build(@Req() req: any, @Body() dto: BuildDto) {
    return this.transfers.buildAuthorization(req.user.sub, req.user.walletAddress, dto.recipient, parsePositiveAmount(dto.amountBase, 'amountBase'));
  }

  @Post('submit')
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  submit(@Req() req: any, @Body() dto: SubmitDto) {
    return this.transfers.submit(req.user.sub, dto.transferId, dto.signature, req.user.walletAddress);
  }

  @Get('history')
  history(@Req() req: any) { return this.transfers.history(req.user.sub); }
}
```

- [ ] **Step 2: Module**

```ts
// be/src/transfer/transfer.module.ts
import { Module } from '@nestjs/common';
import { TransferController } from './transfer.controller';
import { TransferService } from './transfer.service';
import { TransferWatcherService } from './transfer-watcher.service';
import { UserModule } from '../user/user.module';

@Module({
  imports: [UserModule],
  controllers: [TransferController],
  providers: [TransferService, TransferWatcherService],
  exports: [TransferService],
})
export class TransferModule {}
```

(NAVY_EVM, PrismaService, NavyConfigService come from global modules; `UserModule` must `exports: [UserService]`.)

- [ ] **Step 3: Register in `app.module.ts`**

Import `TransferModule` and add it to the root module's `imports` array.

- [ ] **Step 4: Typecheck**

Run: `cd be && pnpm build`
Expected: succeeds (TransferWatcherService created next task — create a stub now so the module compiles, or implement B7 before this step). **Implement B7 first if build fails.**

- [ ] **Step 5: Commit**

```bash
git add be/src/transfer/transfer.controller.ts be/src/transfer/transfer.module.ts be/src/app.module.ts
git commit -m "feat(be): transfer controller + module wiring"
```

### Task B7: Transfer watcher (self-healing reconcile)

**Files:**
- Create: `be/src/transfer/transfer-watcher.service.ts`

- [ ] **Step 1: Implement a periodic sweep** (mirrors `ChainWatcherService` intent, minimal)

```ts
// be/src/transfer/transfer-watcher.service.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NAVY_EVM, type NavyEvm } from '../evm/evm.module';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TransferWatcherService {
  private readonly log = new Logger(TransferWatcherService.name);
  constructor(@Inject(NAVY_EVM) private readonly chain: NavyEvm, private readonly prisma: PrismaService) {}

  /** Reconcile any transfer stuck in 'confirming' (e.g. a crash after broadcast). */
  @Interval(30_000)
  async sweepConfirming() {
    const stuck = await this.prisma.transfer.findMany({ where: { status: 'confirming' }, take: 25 });
    for (const t of stuck) {
      if (!t.txHash) continue;
      try {
        const receipt = await this.chain.provider.getTransactionReceipt(t.txHash);
        if (!receipt) continue; // still pending
        const ok = receipt.status === 1;
        await this.prisma.transfer.update({
          where: { id: t.id },
          data: ok ? { status: 'confirmed' } : { status: 'failed', consumedAt: null },
        });
      } catch (e) {
        this.log.warn(`sweepConfirming ${t.id}: ${(e as Error).message}`);
      }
    }
  }
}
```

(If `@nestjs/schedule` `ScheduleModule.forRoot()` isn't already imported in `app.module.ts`, confirm it is — the farming scheduler uses it, so it should be.)

- [ ] **Step 2: Typecheck + commit**

Run: `cd be && pnpm build` → succeeds.

```bash
git add be/src/transfer/transfer-watcher.service.ts
git commit -m "feat(be): transfer watcher reconciles confirming transfers"
```

### Task B8: Live-Sepolia e2e proof script

**Files:**
- Create: `be/scripts/transfer-e2e.mjs`

- [ ] **Step 1: Implement** a standalone script (in the spirit of `evm-e2e.mjs`) that, using two funded Sepolia EOAs from env (`E2E_SENDER_PK`, `E2E_RECIPIENT_ADDR`) and the deployed USDC:
  1. Builds `TransferWithAuthorization` typed data for a tiny amount (e.g. 0.01 USDC).
  2. Signs it with the sender key.
  3. Submits `usdc.transferWithAuthorization(...)` via the relayer wallet.
  4. Waits for the receipt and asserts `status === 1` and the recipient balance increased by the amount.

```js
// be/scripts/transfer-e2e.mjs  (run: node be/scripts/transfer-e2e.mjs)
import 'dotenv/config';
import { ethers } from 'ethers';

const RPC = process.env.SEPOLIA_RPC_URL;
const USDC = process.env.NAVY_USDC_ADDRESS;
const relayerPk = process.env.NAVY_RELAYER_PRIVATE_KEY;
const senderPk = process.env.E2E_SENDER_PK;         // funded plain EOA holding USDC
const recipient = process.env.E2E_RECIPIENT_ADDR;   // any address
const name = process.env.NAVY_USDC_EIP712_NAME ?? 'USDC';
const version = process.env.NAVY_USDC_EIP712_VERSION ?? '2';
const chainId = Number(process.env.EVM_CHAIN_ID ?? 11155111);

const abi = [
  'function balanceOf(address) view returns (uint256)',
  'function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s)',
];

const provider = new ethers.JsonRpcProvider(RPC, chainId);
const relayer = new ethers.Wallet(relayerPk, provider);
const sender = new ethers.Wallet(senderPk, provider);
const usdc = new ethers.Contract(USDC, abi, relayer);

const value = 10_000n; // 0.01 USDC
const nonce = ethers.hexlify(ethers.randomBytes(32));
const validBefore = Math.floor(Date.now() / 1000) + 900;
const domain = { name, version, chainId, verifyingContract: USDC };
const types = { TransferWithAuthorization: [
  { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
  { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
] };
const message = { from: sender.address, to: recipient, value: value.toString(), validAfter: '0', validBefore: String(validBefore), nonce };

const before = await usdc.balanceOf(recipient);
const sig = ethers.Signature.from(await sender.signTypedData(domain, types, message));
const tx = await usdc.transferWithAuthorization(sender.address, recipient, value, 0, validBefore, nonce, sig.v, sig.r, sig.s);
console.log('submitted', tx.hash);
const receipt = await tx.wait();
const after = await usdc.balanceOf(recipient);
if (receipt.status !== 1) throw new Error('transfer reverted');
if (after - before !== value) throw new Error(`balance delta ${after - before} != ${value}`);
console.log('OK gasless transfer confirmed; recipient +0.01 USDC');
```

- [ ] **Step 2: Run against Sepolia** (requires a funded sender holding test USDC from faucet.circle.com)

Run: `cd be && E2E_SENDER_PK=0x... E2E_RECIPIENT_ADDR=0x... node scripts/transfer-e2e.mjs`
Expected: prints `OK gasless transfer confirmed`.

- [ ] **Step 3: Commit**

```bash
git add be/scripts/transfer-e2e.mjs
git commit -m "test(be): live-Sepolia gasless transfer e2e proof"
```

---

## Phase C — Expo @username UI

### Task C1: Pure username validation (expo)

**Files:**
- Create: `expo-wallet/src/lib/account/username.ts`
- Test: `expo-wallet/src/lib/account/username.test.ts`

- [ ] **Step 1: Write the failing test** (same contract as backend)

```ts
import { normalizeUsername, isValidUsername } from './username';
describe('username (expo)', () => {
  it('normalizes and validates', () => {
    expect(normalizeUsername('@Linh')).toBe('linh');
    expect(isValidUsername('linh_01')).toBe(true);
    expect(isValidUsername('ab')).toBe(false);
  });
});
```

- [ ] **Step 2: Run** `cd expo-wallet && pnpm test username.test` → FAIL.

- [ ] **Step 3: Implement** (copy of backend `username.ts`, framework-free):

```ts
// expo-wallet/src/lib/account/username.ts
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
export function normalizeUsername(input: string): string { return input.trim().replace(/^@/, '').toLowerCase(); }
export function isValidUsername(value: string): boolean { return USERNAME_RE.test(value); }
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add expo-wallet/src/lib/account/username.ts expo-wallet/src/lib/account/username.test.ts
git commit -m "feat(expo): pure username validation"
```

### Task C2: Username REST client

**Files:**
- Create: `expo-wallet/src/lib/account/usernameClient.ts`
- Test: `expo-wallet/src/lib/account/usernameClient.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { UsernameClient } from './usernameClient';

function fakeFetch(handler: (url: string, init?: RequestInit) => any) {
  return async (url: string, init?: RequestInit) => {
    const body = handler(url, init);
    return { ok: true, status: 200, json: async () => body } as Response;
  };
}

describe('UsernameClient', () => {
  it('checkAvailable hits the availability endpoint', async () => {
    const c = new UsernameClient('http://x', fakeFetch(() => ({ available: true })) as any);
    expect(await c.checkAvailable('linh')).toEqual({ available: true });
  });
  it('setUsername PUTs the handle', async () => {
    let seen: any;
    const c = new UsernameClient('http://x', fakeFetch((_u, init) => { seen = init; return { username: 'linh' }; }) as any);
    expect(await c.setUsername('linh')).toEqual({ username: 'linh' });
    expect(seen.method).toBe('PUT');
  });
});
```

- [ ] **Step 2: Run** `cd expo-wallet && pnpm test usernameClient.test` → FAIL.

- [ ] **Step 3: Implement** (uses an injected authed-fetch like `FarmingClient`)

```ts
// expo-wallet/src/lib/account/usernameClient.ts
export class UsernameClient {
  constructor(
    private readonly baseUrl: string,
    private readonly authedFetch: (url: string, init?: RequestInit) => Promise<Response>,
  ) {}
  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.authedFetch(`${this.baseUrl}${path}`, {
      ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`username ${path} failed (${res.status})`);
    return (await res.json()) as T;
  }
  me() { return this.json<{ id: string; walletAddress: string | null; username: string | null }>('/user/account/me'); }
  checkAvailable(u: string) { return this.json<{ available: boolean }>(`/user/account/username/available?u=${encodeURIComponent(u)}`); }
  setUsername(username: string) { return this.json<{ username: string }>('/user/account/username', { method: 'PUT', body: JSON.stringify({ username }) }); }
  clearUsername() { return this.json<{ username: null }>('/user/account/username', { method: 'DELETE' }); }
}
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add expo-wallet/src/lib/account/usernameClient.ts expo-wallet/src/lib/account/usernameClient.test.ts
git commit -m "feat(expo): username REST client"
```

### Task C3: Username claim sheet + Settings row

**Files:**
- Create: `expo-wallet/src/features/settings/UsernameSheet.tsx`
- Modify: `expo-wallet/app/(tabs)/settings.tsx`

- [ ] **Step 1: Build the sheet** (reuses `Sheet`, `Button`, `Text`, and the existing settings-sheet pattern like `LinkEmailSheet.tsx`). It: loads current username via `UsernameClient.me()`, debounced availability check as the user types (using `isValidUsername` for instant client-side gating), and calls `setUsername`/`clearUsername`. Wire the client with `useNavySession().authedFetch` + `getEnv().navyApiUrl`.

```tsx
// expo-wallet/src/features/settings/UsernameSheet.tsx
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { OtpInput } from '@/ui/OtpInput'; // not used; illustrative — use a TextInput-based field from @/ui if present
import { colors, space } from '@/ui/theme';
import { getEnv } from '@/lib/config/env';
import { useNavySession } from '@/lib/auth/SessionContext';
import { UsernameClient } from '@/lib/account/usernameClient';
import { normalizeUsername, isValidUsername } from '@/lib/account/username';

export function UsernameSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { authedFetch } = useNavySession();
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<'idle' | 'checking' | 'ok' | 'taken' | 'invalid' | 'saving'>('idle');
  const client = React.useMemo(
    () => (authedFetch ? new UsernameClient(getEnv().navyApiUrl, authedFetch) : null),
    [authedFetch],
  );

  useEffect(() => { if (open && client) client.me().then((m) => setValue(m.username ?? '')).catch(() => {}); }, [open, client]);

  useEffect(() => {
    if (!client) return;
    const n = normalizeUsername(value);
    if (!n) { setStatus('idle'); return; }
    if (!isValidUsername(n)) { setStatus('invalid'); return; }
    setStatus('checking');
    const t = setTimeout(() => {
      client.checkAvailable(n).then((r) => setStatus(r.available ? 'ok' : 'taken')).catch(() => setStatus('idle'));
    }, 350);
    return () => clearTimeout(t);
  }, [value, client]);

  const save = async () => {
    if (!client || status !== 'ok') return;
    setStatus('saving');
    try { await client.setUsername(normalizeUsername(value)); onClose(); }
    catch { setStatus('taken'); }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Your @username">
      <View style={{ gap: space.md }}>
        <Text variant="caption" muted>Pick a handle so friends can send you USDC by name. Opt-in — leave blank to stay private.</Text>
        {/* Replace with the app's standard text field component; render `value`, onChangeText=setValue, autoCapitalize=none */}
        <Text variant="body" color={colors.textHi}>@{normalizeUsername(value) || '…'}</Text>
        <Text variant="caption" color={status === 'ok' ? colors.aqua : status === 'taken' || status === 'invalid' ? colors.danger : colors.textDim}>
          {status === 'ok' ? 'Available' : status === 'taken' ? 'Taken' : status === 'invalid' ? '3-20 letters, numbers, underscore' : status === 'checking' ? 'Checking…' : ' '}
        </Text>
        <Button title="Save" onPress={save} disabled={status !== 'ok'} />
      </View>
    </Sheet>
  );
}
```

> Implementation note: use the app's existing text-input primitive (check `src/ui/` — if none exists, use React Native `TextInput` styled with theme tokens). Remove the placeholder `OtpInput` import.

- [ ] **Step 2: Add a Settings row** in `expo-wallet/app/(tabs)/settings.tsx` that opens the sheet, mirroring how existing rows (e.g. the Recovery/LinkEmail rows) toggle their sheets: a `useState(false)` + a `PressRow`/settings item labeled "Username" showing the current handle, and `<UsernameSheet open={...} onClose={...} />` at the bottom.

- [ ] **Step 3: Typecheck**

Run: `cd expo-wallet && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add expo-wallet/src/features/settings/UsernameSheet.tsx expo-wallet/app/(tabs)/settings.tsx
git commit -m "feat(expo): claim @username in Settings"
```

---

## Verification (whole plan)

- [ ] `cd be && pnpm test` — all backend unit tests pass.
- [ ] `cd be && pnpm build` — typechecks.
- [ ] `cd be && node scripts/transfer-e2e.mjs` (with funded env) — prints `OK gasless transfer confirmed`.
- [ ] `cd expo-wallet && pnpm test && pnpm exec tsc --noEmit` — pass.
- [ ] Manual: in the app, open Settings → Username, claim a handle, confirm availability + save round-trips.

## Self-Review notes (addressed)

- **Spec coverage:** @username opt-in field + Settings UI ✓; gasless USDC transfer (build/submit/watch) ✓; recipient by address AND @username ✓; USDC-only ✓; plain-EOA payer (USDC EIP-3009 re-verifies the sig on-chain) ✓; self-healing revert reset ✓; live-Sepolia proof ✓.
- **Type consistency:** `TransferTypedData`, `buildTransferTypedData`, `transferDigest`, `recoverTransferSigner`, `randomNonce`, `parseRecipient`, `resolveUsername({username,address})` used consistently across service + tests.
- The transfer *confirm-card UI* + `transferClient`/`transferFlow` for the app are intentionally built in Plan 2 (the Assistant chat consumes them); this plan proves the backend rails via the e2e script and delivers the username UI.
