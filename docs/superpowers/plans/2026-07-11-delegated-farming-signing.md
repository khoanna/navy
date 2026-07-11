# Delegated Farming Auto-Funding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user enable "auto-farm": after delegating their Privy embedded wallet, the backend auto-transfers idle SOL from that wallet into their farming subwallet (bounded, server-validated via delegated signing) — the subwallet then farms as it does today.

**Architecture:** New, tightly-scoped delegated-signing path in `be/` that reuses `@privy-io/server-auth@1.32.5` `walletApi.solana.signTransaction`. Delegated signing is used *only* for a server-built `SystemProgram.transfer` from the user's embedded wallet to their own subwallet, validated by a new `DelegatedPolicyValidator` (reusing `deriveTxSummary`). The audited subwallet `SigningService`/`PolicyValidator`/envelope-encryption is untouched. A client toggle drives delegate/revoke + the backend endpoints.

**Tech Stack:** Nest.js 11, Prisma 7, `@privy-io/server-auth` (backend); Expo SDK 54, `@privy-io/expo` (client); `@solana/web3.js`; jest.

**Spec:** `docs/superpowers/specs/2026-07-11-delegated-farming-signing-design.md`

**Backend commands run from `/home/khoa/Desktop/uni/be`; client from `/home/khoa/Desktop/uni/expo-wallet`.**

**Run be/ tests SCOPED (`pnpm test <pattern>`) — the full suite loads the heavy web3 graph and can crash the machine. Postgres must be up (`docker compose up -d`) for anything touching Prisma/migrations.**

---

## File Structure

**Backend — new:**
- `be/src/wallet/delegated-policy.validator.ts` (+ `.spec.ts`) — validates a delegated funding tx (only system-transfer to the subwallet, amount bounded).
- `be/src/farming/funding.util.ts` (+ `.spec.ts`) — pure `computeFundAmount`.
- `be/src/farming/delegated-funding.service.ts` (+ `.spec.ts`) — builds + policy-checks + delegated-signs + submits the funding transfer.
- `be/src/farming/delegation.service.ts` (+ `.spec.ts`) — enable/disable/status/fund-now/auto-fund orchestration.

**Backend — modified:**
- `be/src/config/config.service.ts` — `privyAuthorizationKey` getter (+ `.spec.ts`).
- `be/src/wallet/privy.service.ts` (+ `.spec.ts`) — auth-key client, `getDelegatedWallet`, `signDelegatedTransaction`.
- `be/src/wallet/tx-summary.ts` (+ existing `tx-summary.spec.ts`) — decode `lamports` on `system-transfer` (additive).
- `be/src/wallet/wallet.module.ts` — export `PrivyService`.
- `be/src/farming/farming.controller.ts` — delegation endpoints.
- `be/src/farming/farming.module.ts` — register new providers + `FARM_FUNDING_BOUNDS`.
- `be/src/farming/farming-agent.scheduler.ts` (+ `.spec.ts`) — auto-fund delegated users.
- `be/prisma/schema.prisma` — two `User` fields + migration.
- `be/.env.example` — new env vars.

**Client — new:**
- `expo-wallet/src/lib/account/delegationStatus.ts` (+ `.test.ts`) — pure status mapping.
- `expo-wallet/src/features/farming/AutoFarmToggle.tsx` — the toggle.

**Client — modified:**
- the client API module (delegation calls) and `app/(tabs)/farming.tsx` (mount the toggle).

---

## Task 1: Config — `privyAuthorizationKey` getter

**Files:**
- Modify: `be/src/config/config.service.ts`
- Test: `be/src/config/config.service.spec.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create/append `be/src/config/config.service.spec.ts`:

```typescript
import { NavyConfigService } from './config.service';

const BASE = {
  SUBWALLET_MASTER_KEY: '11'.repeat(32),
  NETWORK: 'devnet',
  SOLANA_RPC_DEVNET: 'https://api.devnet.solana.com',
  NAVY_JWT_SECRET: 'x'.repeat(32),
  NAVY_JWT_ACCESS_TTL: '900',
  NAVY_JWT_REFRESH_TTL: '2592000',
  PRIVY_APP_ID: 'app',
  PRIVY_APP_SECRET: 'secret',
  ADMIN_MAX_TOTP_FAILS: '5',
} as NodeJS.ProcessEnv;

describe('NavyConfigService.privyAuthorizationKey', () => {
  it('is undefined when the env var is absent', () => {
    const cfg = new NavyConfigService({ ...BASE });
    expect(cfg.privyAuthorizationKey).toBeUndefined();
  });
  it('returns the key when present', () => {
    const cfg = new NavyConfigService({ ...BASE, PRIVY_AUTHORIZATION_KEY: 'wallet-auth-priv' });
    expect(cfg.privyAuthorizationKey).toBe('wallet-auth-priv');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test config.service`
Expected: FAIL — `privyAuthorizationKey` is not a function/getter.

- [ ] **Step 3: Implement**

In `be/src/config/config.service.ts`, add this getter inside the class (after `privyAppSecret`):

```typescript
  get privyAuthorizationKey(): string | undefined { return this.env.PRIVY_AUTHORIZATION_KEY || undefined; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test config.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/config.service.ts src/config/config.service.spec.ts
git commit -m "feat(be): privyAuthorizationKey config getter (delegated-signing gate)"
```

---

## Task 2: Prisma — user delegation fields + migration

**Files:**
- Modify: `be/prisma/schema.prisma`
- Migration: generated

- [ ] **Step 1: Edit the schema**

In `be/prisma/schema.prisma`, change the `User` model to add two fields (keep existing fields/relations):

```prisma
model User {
  id                     String   @id @default(uuid())
  privyDid               String   @unique
  primaryWallet          String?
  status                 String   @default("active")
  createdAt              DateTime @default(now())
  farmDelegationWalletId String?
  farmDelegationEnabledAt DateTime?
  subwallets             FarmingSubwallet[]
}
```

- [ ] **Step 2: Create the migration + regenerate client**

Ensure Postgres is up (`docker compose up -d`). Run (DATABASE_URL must be in the shell env per CLAUDE.md):

```bash
DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)" pnpm prisma migrate dev --name add_user_farm_delegation
```

Expected: a new migration under `be/prisma/migrations/*_add_user_farm_delegation/` and the Prisma client regenerated.

- [ ] **Step 3: Verify the field is typed**

Run: `pnpm exec tsc --noEmit -p tsconfig.json` (or `pnpm build`)
Expected: clean (the generated client now knows the fields).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(be): user farmDelegationWalletId + farmDelegationEnabledAt"
```

---

## Task 3: tx-summary — decode transfer lamports (additive)

**Files:**
- Modify: `be/src/wallet/tx-summary.ts`
- Test: `be/src/wallet/tx-summary.spec.ts` (append)

This is an **additive** change to shared, sensitive code: it adds an optional `lamports` field read on `system-transfer`. Existing consumers ignore it; the existing `PolicyValidator` is unaffected.

- [ ] **Step 1: Write the failing test**

Append to `be/src/wallet/tx-summary.spec.ts`:

```typescript
import { SystemProgram, Transaction, Keypair } from '@solana/web3.js';
import { deriveTxSummary } from './tx-summary';

describe('deriveTxSummary system-transfer lamports', () => {
  it('decodes the transfer amount as a bigint', () => {
    const from = Keypair.generate().publicKey;
    const to = Keypair.generate().publicKey;
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: 12345 }));
    const summary = deriveTxSummary(tx);
    expect(summary.instructions[0].kind).toBe('system-transfer');
    expect(summary.instructions[0].destination).toBe(to.toBase58());
    expect(summary.instructions[0].lamports).toBe(12345n);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tx-summary`
Expected: FAIL — `lamports` is `undefined`.

- [ ] **Step 3: Implement**

In `be/src/wallet/tx-summary.ts`:

1. Add `lamports?: bigint;` to the `DecodedIx` interface (after `rawOpcode?: number;`).
2. In `decodeSystem`, set `lamports` on the transfer branch. The System `Transfer` layout is `u32 opcode (2)` + `u64 lamports (LE)`:

```typescript
  if (opcode === 2) {
    const lamports = data.length >= 12 ? data.readBigUInt64LE(4) : undefined;
    return { programId, kind: 'system-transfer', destination: keyAt(ix, 1), lamports };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tx-summary`
Expected: PASS (new + existing tx-summary tests).

Also run the policy validator to confirm nothing regressed:
Run: `pnpm test policy.validator`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/wallet/tx-summary.ts src/wallet/tx-summary.spec.ts
git commit -m "feat(be): decode system-transfer lamports in tx-summary (additive)"
```

---

## Task 4: DelegatedPolicyValidator

**Files:**
- Create: `be/src/wallet/delegated-policy.validator.ts`
- Test: `be/src/wallet/delegated-policy.validator.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `be/src/wallet/delegated-policy.validator.spec.ts`:

```typescript
import { SystemProgram, Transaction, Keypair, TransactionInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { deriveTxSummary } from './tx-summary';
import { DelegatedPolicyValidator } from './delegated-policy.validator';

const sub = Keypair.generate().publicKey;
const user = Keypair.generate().publicKey;
const ctx = { subwallet: sub.toBase58(), minLamports: 1000n, maxLamports: 1_000_000n };

function summaryOf(tx: Transaction) { return deriveTxSummary(tx); }

describe('DelegatedPolicyValidator', () => {
  const v = new DelegatedPolicyValidator();

  it('allows a single bounded system-transfer to the subwallet', () => {
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: user, toPubkey: sub, lamports: 5000 }));
    expect(v.check(summaryOf(tx), ctx)).toEqual({ ok: true });
  });
  it('denies when there is more than one instruction', () => {
    const tx = new Transaction()
      .add(SystemProgram.transfer({ fromPubkey: user, toPubkey: sub, lamports: 5000 }))
      .add(SystemProgram.transfer({ fromPubkey: user, toPubkey: sub, lamports: 5000 }));
    expect(v.check(summaryOf(tx), ctx).ok).toBe(false);
  });
  it('denies a transfer to a destination other than the subwallet', () => {
    const other = Keypair.generate().publicKey;
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: user, toPubkey: other, lamports: 5000 }));
    expect(v.check(summaryOf(tx), ctx).ok).toBe(false);
  });
  it('denies an amount below min or above max', () => {
    const low = new Transaction().add(SystemProgram.transfer({ fromPubkey: user, toPubkey: sub, lamports: 500 }));
    const high = new Transaction().add(SystemProgram.transfer({ fromPubkey: user, toPubkey: sub, lamports: 2_000_000 }));
    expect(v.check(summaryOf(low), ctx).ok).toBe(false);
    expect(v.check(summaryOf(high), ctx).ok).toBe(false);
  });
  it('denies a non-system-program instruction', () => {
    const ix = new TransactionInstruction({ keys: [], programId: TOKEN_PROGRAM_ID, data: Buffer.alloc(0) });
    const tx = new Transaction().add(ix);
    expect(v.check(summaryOf(tx), ctx).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test delegated-policy`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `be/src/wallet/delegated-policy.validator.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import type { TxSummary } from './tx-summary';
import type { PolicyResult } from './policy.validator';

export interface DelegatedFundingContext {
  subwallet: string;
  minLamports: bigint;
  maxLamports: bigint;
}

/**
 * Authoritative guard for the ONE delegated operation Navy performs on a user's
 * embedded wallet: a single SystemProgram.transfer into the user's own subwallet,
 * amount-bounded. Anything else is denied. Reuses deriveTxSummary — never trusts a
 * caller-supplied summary (the funding service derives it from the built tx).
 */
@Injectable()
export class DelegatedPolicyValidator {
  check(tx: TxSummary, ctx: DelegatedFundingContext): PolicyResult {
    if (tx.instructions.length !== 1) {
      return { ok: false, reason: `expected exactly 1 instruction, got ${tx.instructions.length}` };
    }
    const ix = tx.instructions[0];
    if (ix.kind !== 'system-transfer') {
      return { ok: false, reason: `only system-transfer permitted, got ${ix.kind}` };
    }
    if (ix.destination !== ctx.subwallet) {
      return { ok: false, reason: `transfer destination not the subwallet: ${ix.destination}` };
    }
    if (ix.lamports === undefined) {
      return { ok: false, reason: 'transfer lamports could not be decoded' };
    }
    if (ix.lamports < ctx.minLamports || ix.lamports > ctx.maxLamports) {
      return { ok: false, reason: `amount ${ix.lamports} out of bounds [${ctx.minLamports}, ${ctx.maxLamports}]` };
    }
    return { ok: true };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test delegated-policy`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/wallet/delegated-policy.validator.ts src/wallet/delegated-policy.validator.spec.ts
git commit -m "feat(be): DelegatedPolicyValidator (only bounded transfer to own subwallet)"
```

---

## Task 5: computeFundAmount pure helper

**Files:**
- Create: `be/src/farming/funding.util.ts`
- Test: `be/src/farming/funding.util.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `be/src/farming/funding.util.spec.ts`:

```typescript
import { computeFundAmount } from './funding.util';

const bounds = { reserve: 5_000_000n, fundMin: 10_000_000n, fundMax: 1_000_000_000n };

describe('computeFundAmount', () => {
  it('returns null when spare (balance - reserve) is below fundMin', () => {
    expect(computeFundAmount(5_000_000n, bounds)).toBeNull();       // spare 0
    expect(computeFundAmount(14_000_000n, bounds)).toBeNull();      // spare 9m < 10m
  });
  it('returns spare when between fundMin and fundMax', () => {
    expect(computeFundAmount(25_000_000n, bounds)).toBe(20_000_000n); // spare 20m
  });
  it('clamps to fundMax when spare exceeds it', () => {
    expect(computeFundAmount(2_000_000_000n, bounds)).toBe(1_000_000_000n);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test funding.util`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `be/src/farming/funding.util.ts`:

```typescript
export interface FundingBounds {
  /** Lamports to always leave in the user's embedded wallet. */
  reserve: bigint;
  /** Minimum spare that justifies a top-up. */
  fundMin: bigint;
  /** Maximum single top-up. */
  fundMax: bigint;
}

/** Pure: how much to move from the user's wallet into their subwallet, or null to skip. */
export function computeFundAmount(userBalance: bigint, bounds: FundingBounds): bigint | null {
  const spare = userBalance - bounds.reserve;
  if (spare < bounds.fundMin) return null;
  return spare < bounds.fundMax ? spare : bounds.fundMax;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test funding.util`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/farming/funding.util.ts src/farming/funding.util.spec.ts
git commit -m "feat(be): computeFundAmount pure helper"
```

---

## Task 6: PrivyService — delegated signing + delegated-wallet lookup

**Files:**
- Modify: `be/src/wallet/privy.service.ts`
- Test: `be/src/wallet/privy.service.spec.ts` (create)

**VERIFY BEFORE CODING** against `be/node_modules/@privy-io/server-auth`: `new PrivyClient(appId, appSecret, { walletApi: { authorizationPrivateKey } })`; `client.walletApi.solana.signTransaction({ walletId } | { address, chainType:'solana' }, transaction, idempotencyKey? ) → { signedTransaction }`; `client.getUser(did) → { linkedAccounts }` where a delegated solana wallet has `type:'wallet'`, `chainType:'solana'`, `delegated:true`, `id`, `address`. (These were confirmed in the installed 1.32.5 types.)

- [ ] **Step 1: Write the failing test**

Create `be/src/wallet/privy.service.spec.ts`:

```typescript
import { SystemProgram, Transaction, Keypair } from '@solana/web3.js';
import { PrivyService } from './privy.service';

function makeService(authKey?: string) {
  const cfg = { privyAppId: 'app', privyAppSecret: 'secret', privyAuthorizationKey: authKey } as any;
  const svc = new PrivyService(cfg);
  return svc;
}

describe('PrivyService.getDelegatedWallet', () => {
  it('returns the delegated solana wallet id + address', async () => {
    const svc = makeService('k');
    (svc as any).client = {
      getUser: jest.fn().mockResolvedValue({
        linkedAccounts: [
          { type: 'email', address: 'a@b.c' },
          { type: 'wallet', chainType: 'solana', delegated: true, id: 'wallet-123', address: 'SoLaddr' },
        ],
      }),
    };
    await expect(svc.getDelegatedWallet('did:1')).resolves.toEqual({ walletId: 'wallet-123', address: 'SoLaddr' });
  });
  it('returns null when no delegated solana wallet exists', async () => {
    const svc = makeService('k');
    (svc as any).client = {
      getUser: jest.fn().mockResolvedValue({
        linkedAccounts: [{ type: 'wallet', chainType: 'solana', delegated: false, id: 'w', address: 'x' }],
      }),
    };
    await expect(svc.getDelegatedWallet('did:1')).resolves.toBeNull();
  });
});

describe('PrivyService.signDelegatedTransaction', () => {
  it('throws when the authorization key is not configured', async () => {
    const svc = makeService(undefined);
    const tx = new Transaction();
    await expect(svc.signDelegatedTransaction({ address: 'x', tx })).rejects.toThrow(/not configured/);
  });
  it('calls walletApi.solana.signTransaction with walletId + idempotencyKey and returns the signed tx', async () => {
    const svc = makeService('k');
    const kp = Keypair.generate();
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: kp.publicKey, lamports: 1 }));
    tx.feePayer = kp.publicKey;
    tx.recentBlockhash = '11111111111111111111111111111111';
    const signMock = jest.fn().mockResolvedValue({ signedTransaction: tx });
    (svc as any).client = { walletApi: { solana: { signTransaction: signMock } } };
    const out = await svc.signDelegatedTransaction({ walletId: 'wallet-123', address: 'x', tx, idempotencyKey: 'idem-1' });
    expect(out).toBe(tx);
    expect(signMock).toHaveBeenCalledWith(expect.objectContaining({ walletId: 'wallet-123', transaction: tx, idempotencyKey: 'idem-1' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test privy.service`
Expected: FAIL — `getDelegatedWallet`/`signDelegatedTransaction` not defined.

- [ ] **Step 3: Implement**

Replace `be/src/wallet/privy.service.ts` with:

```typescript
import { Injectable } from '@nestjs/common';
import { PrivyClient } from '@privy-io/server-auth';
import { Transaction, VersionedTransaction } from '@solana/web3.js';
import { NavyConfigService } from '../config/config.service';

export interface VerifiedPrivyUser { userId: string; wallet?: string }

@Injectable()
export class PrivyService {
  private client: PrivyClient;

  constructor(private readonly cfg: NavyConfigService) {
    const authKey = cfg.privyAuthorizationKey;
    this.client = authKey
      ? new PrivyClient(cfg.privyAppId, cfg.privyAppSecret, { walletApi: { authorizationPrivateKey: authKey } })
      : new PrivyClient(cfg.privyAppId, cfg.privyAppSecret);
  }

  async verifyAccessToken(token: string): Promise<VerifiedPrivyUser> {
    const claims = await this.client.verifyAuthToken(token);
    const user = await this.client.getUser(claims.userId);
    const solana = user.linkedAccounts.find(
      (a) => a.type === 'wallet' && (a as any).chainType === 'solana',
    ) as any;
    return { userId: claims.userId, wallet: solana?.address };
  }

  /** The user's delegated (session-signer-enabled) Solana embedded wallet, or null. */
  async getDelegatedWallet(privyDid: string): Promise<{ walletId?: string; address: string } | null> {
    const user = await this.client.getUser(privyDid);
    const w = user.linkedAccounts.find(
      (a) => a.type === 'wallet' && (a as any).chainType === 'solana' && (a as any).delegated === true,
    ) as any;
    if (!w?.address) return null;
    return { walletId: w.id ?? undefined, address: w.address };
  }

  /** Sign a server-built tx on the user's delegated embedded wallet. Requires the auth key. */
  async signDelegatedTransaction(args: {
    walletId?: string;
    address: string;
    tx: Transaction;
    idempotencyKey?: string;
  }): Promise<Transaction> {
    if (!this.cfg.privyAuthorizationKey) throw new Error('Delegated signing not configured');
    const target = args.walletId
      ? { walletId: args.walletId }
      : { address: args.address, chainType: 'solana' as const };
    const { signedTransaction } = await this.client.walletApi.solana.signTransaction({
      ...target,
      transaction: args.tx,
      idempotencyKey: args.idempotencyKey,
    } as any);
    if (signedTransaction instanceof Transaction) return signedTransaction;
    return Transaction.from((signedTransaction as VersionedTransaction).serialize());
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test privy.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/wallet/privy.service.ts src/wallet/privy.service.spec.ts
git commit -m "feat(be): PrivyService delegated wallet lookup + delegated signing"
```

---

## Task 7: DelegatedFundingService

**Files:**
- Create: `be/src/farming/delegated-funding.service.ts`
- Test: `be/src/farming/delegated-funding.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `be/src/farming/delegated-funding.service.spec.ts`:

```typescript
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { DelegatedFundingService } from './delegated-funding.service';
import { DelegatedPolicyValidator } from '../wallet/delegated-policy.validator';

function build() {
  const relayer = Keypair.generate();
  const sub = Keypair.generate().publicKey.toBase58();
  const userAddr = Keypair.generate().publicKey.toBase58();
  const chain = {
    relayer,
    connection: {
      getLatestBlockhash: jest.fn().mockResolvedValue({ blockhash: '11111111111111111111111111111111' }),
      sendRawTransaction: jest.fn().mockResolvedValue('sig-123'),
      confirmTransaction: jest.fn().mockResolvedValue({ value: { err: null } }),
    },
  } as any;
  const privy = { signDelegatedTransaction: jest.fn(async ({ tx }) => tx) } as any;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
  const bounds = { reserve: 5_000_000n, fundMin: 10_000_000n, fundMax: 1_000_000_000n };
  const svc = new DelegatedFundingService(privy, chain, audit, new DelegatedPolicyValidator(), bounds);
  return { svc, privy, audit, chain, sub, userAddr };
}

describe('DelegatedFundingService.fundSubwalletFromUser', () => {
  it('builds a bounded transfer to the subwallet, policy-checks, delegated-signs, submits, audits', async () => {
    const { svc, privy, audit, chain, sub, userAddr } = build();
    const res = await svc.fundSubwalletFromUser({
      userId: 'u1', privyDid: 'did:1', walletId: 'wallet-123',
      userAddress: userAddr, subwalletPubkey: sub, amountLamports: 20_000_000n,
    });
    expect(res).toEqual({ txSignature: 'sig-123' });
    expect(privy.signDelegatedTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ walletId: 'wallet-123', address: userAddr }),
    );
    expect(chain.connection.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'farming.delegated.fund' }));
  });

  it('denies + audits + throws when the amount is out of bounds (defense-in-depth)', async () => {
    const { svc, privy, audit, sub, userAddr } = build();
    await expect(svc.fundSubwalletFromUser({
      userId: 'u1', privyDid: 'did:1', walletId: 'w', userAddress: userAddr, subwalletPubkey: sub,
      amountLamports: 2_000_000_000n, // > fundMax
    })).rejects.toThrow(/out of bounds|Policy/);
    expect(privy.signDelegatedTransaction).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'farming.delegated.fund.denied' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test delegated-funding`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `be/src/farming/delegated-funding.service.ts`:

```typescript
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { PrivyService } from '../wallet/privy.service';
import { DelegatedPolicyValidator } from '../wallet/delegated-policy.validator';
import { deriveTxSummary } from '../wallet/tx-summary';
import { AuditService } from '../audit/audit.service';
import { NAVY_ONCHAIN } from '../onchain/onchain.module';
import type { NavyOnchain } from '../onchain/onchain.module';
import { FARM_FUNDING_BOUNDS } from './farming.bounds';
import type { FundingBounds } from './funding.util';

@Injectable()
export class DelegatedFundingService {
  constructor(
    private readonly privy: PrivyService,
    @Inject(NAVY_ONCHAIN) private readonly chain: NavyOnchain,
    private readonly audit: AuditService,
    private readonly policy: DelegatedPolicyValidator,
    @Inject(FARM_FUNDING_BOUNDS) private readonly bounds: FundingBounds,
  ) {}

  async fundSubwalletFromUser(args: {
    userId: string;
    privyDid: string;
    walletId?: string;
    userAddress: string;
    subwalletPubkey: string;
    amountLamports: bigint;
  }): Promise<{ txSignature: string }> {
    // 1. Build the transfer (user embedded wallet -> own subwallet), relayer pays fee.
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: new PublicKey(args.userAddress),
        toPubkey: new PublicKey(args.subwalletPubkey),
        lamports: args.amountLamports,
      }),
    );
    tx.feePayer = this.chain.relayer.publicKey;
    tx.recentBlockhash = (await this.chain.connection.getLatestBlockhash()).blockhash;

    // 2. Defense-in-depth policy check on the ACTUAL built tx.
    const verdict = this.policy.check(deriveTxSummary(tx), {
      subwallet: args.subwalletPubkey,
      minLamports: this.bounds.fundMin,
      maxLamports: this.bounds.fundMax,
    });
    if (!verdict.ok) {
      await this.audit.record({
        actor: `user:${args.userId}`,
        action: 'farming.delegated.fund.denied',
        metadata: { reason: verdict.reason },
      });
      throw new ForbiddenException(`Delegated funding denied: ${verdict.reason}`);
    }

    // 3. Relayer co-signs (fee payer); user authorizes via delegated signing.
    tx.partialSign(this.chain.relayer);
    const idempotencyKey = `fund:${args.subwalletPubkey}:${Math.floor(Date.now() / 60000)}`;
    const signed = await this.privy.signDelegatedTransaction({
      walletId: args.walletId,
      address: args.userAddress,
      tx,
      idempotencyKey,
    });

    // 4. Submit + confirm + audit.
    const raw = signed.serialize({ requireAllSignatures: false, verifySignatures: false });
    const sig = await this.chain.connection.sendRawTransaction(raw);
    await this.chain.connection.confirmTransaction(sig, 'confirmed');
    await this.audit.record({
      actor: `user:${args.userId}`,
      action: 'farming.delegated.fund',
      target: args.subwalletPubkey,
      metadata: { amount: args.amountLamports.toString(), signature: sig },
    });
    return { txSignature: sig };
  }
}
```

- [ ] **Step 4: Create the bounds token file**

Create `be/src/farming/farming.bounds.ts`:

```typescript
export const FARM_FUNDING_BOUNDS = Symbol('FARM_FUNDING_BOUNDS');
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test delegated-funding`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/farming/delegated-funding.service.ts src/farming/delegated-funding.service.spec.ts src/farming/farming.bounds.ts
git commit -m "feat(be): DelegatedFundingService (relayer-paid delegated transfer to subwallet)"
```

---

## Task 8: DelegationService (enable/disable/status/fund-now/auto-fund)

**Files:**
- Create: `be/src/farming/delegation.service.ts`
- Test: `be/src/farming/delegation.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `be/src/farming/delegation.service.spec.ts`:

```typescript
import { ServiceUnavailableException, BadRequestException } from '@nestjs/common';
import { DelegationService } from './delegation.service';

function build(authKey: string | undefined = 'k') {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: 'u1', privyDid: 'did:1', primaryWallet: 'UserAddr', farmDelegationEnabledAt: null, farmDelegationWalletId: null }),
      update: jest.fn().mockResolvedValue({}),
    },
    farmingSubwallet: { findFirst: jest.fn().mockResolvedValue({ id: 's1', pubkey: 'SubAddr', userId: 'u1' }) },
  } as any;
  const cfg = { privyAuthorizationKey: authKey } as any;
  const privy = { getDelegatedWallet: jest.fn().mockResolvedValue({ walletId: 'wallet-123', address: 'UserAddr' }) } as any;
  const funding = { fundSubwalletFromUser: jest.fn().mockResolvedValue({ txSignature: 'sig-1' }) } as any;
  const farming = { createSubwallet: jest.fn().mockResolvedValue({ subwalletId: 's1', address: 'SubAddr' }) } as any;
  const chain = { connection: { getBalance: jest.fn().mockResolvedValue(25_000_000) } } as any;
  const bounds = { reserve: 5_000_000n, fundMin: 10_000_000n, fundMax: 1_000_000_000n };
  const svc = new DelegationService(prisma, cfg, privy, funding, farming, chain, bounds);
  return { svc, prisma, privy, funding, farming };
}

describe('DelegationService', () => {
  it('status reports available=false when no auth key', async () => {
    const { svc } = build(undefined);
    await expect(svc.status('u1')).resolves.toEqual({ available: false, enabled: false });
  });

  it('enable throws ServiceUnavailable without an auth key', async () => {
    const { svc } = build(undefined);
    await expect(svc.enable('u1')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('enable stores the walletId + timestamp when the wallet is delegated', async () => {
    const { svc, prisma } = build('k');
    await svc.enable('u1');
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'u1' },
      data: expect.objectContaining({ farmDelegationWalletId: 'wallet-123' }),
    }));
  });

  it('enable rejects when the wallet is not delegated', async () => {
    const { svc, privy } = build('k');
    privy.getDelegatedWallet.mockResolvedValueOnce(null);
    await expect(svc.enable('u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('fundNow funds the subwallet with the computed amount', async () => {
    const { svc, funding } = build('k');
    // enabled user
    (svc as any).prisma.user.findUnique.mockResolvedValue({ id: 'u1', privyDid: 'did:1', primaryWallet: 'UserAddr', farmDelegationEnabledAt: new Date(), farmDelegationWalletId: 'wallet-123' });
    const res = await svc.fundNow('u1');
    expect(funding.fundSubwalletFromUser).toHaveBeenCalledWith(expect.objectContaining({ amountLamports: 20_000_000n, subwalletPubkey: 'SubAddr' }));
    expect(res).toEqual({ txSignature: 'sig-1' });
  });

  it('fundNow skips when spare balance is insufficient', async () => {
    const { svc, funding } = build('k');
    (svc as any).prisma.user.findUnique.mockResolvedValue({ id: 'u1', privyDid: 'did:1', primaryWallet: 'UserAddr', farmDelegationEnabledAt: new Date(), farmDelegationWalletId: 'wallet-123' });
    (svc as any).chain.connection.getBalance.mockResolvedValue(6_000_000); // spare 1m < fundMin
    const res = await svc.fundNow('u1');
    expect(funding.fundSubwalletFromUser).not.toHaveBeenCalled();
    expect(res).toEqual({ skipped: 'insufficient balance' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test delegation.service`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `be/src/farming/delegation.service.ts`:

```typescript
import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import { PrismaService } from '../prisma/prisma.service';
import { NavyConfigService } from '../config/config.service';
import { PrivyService } from '../wallet/privy.service';
import { DelegatedFundingService } from './delegated-funding.service';
import { FarmingService } from './farming.service';
import { NAVY_ONCHAIN } from '../onchain/onchain.module';
import type { NavyOnchain } from '../onchain/onchain.module';
import { FARM_FUNDING_BOUNDS } from './farming.bounds';
import { computeFundAmount, type FundingBounds } from './funding.util';

@Injectable()
export class DelegationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: NavyConfigService,
    private readonly privy: PrivyService,
    private readonly funding: DelegatedFundingService,
    private readonly farming: FarmingService,
    @Inject(NAVY_ONCHAIN) private readonly chain: NavyOnchain,
    @Inject(FARM_FUNDING_BOUNDS) private readonly bounds: FundingBounds,
  ) {}

  async status(userId: string): Promise<{ available: boolean; enabled: boolean }> {
    const available = !!this.cfg.privyAuthorizationKey;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    return { available, enabled: !!user?.farmDelegationEnabledAt };
  }

  async enable(userId: string): Promise<{ available: boolean; enabled: boolean }> {
    if (!this.cfg.privyAuthorizationKey) throw new ServiceUnavailableException('Delegated signing not configured');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    const dw = await this.privy.getDelegatedWallet(user.privyDid);
    if (!dw) throw new BadRequestException('Wallet is not delegated');
    await this.prisma.user.update({
      where: { id: userId },
      data: { farmDelegationWalletId: dw.walletId ?? null, farmDelegationEnabledAt: new Date() },
    });
    return { available: true, enabled: true };
  }

  async disable(userId: string): Promise<{ available: boolean; enabled: boolean }> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { farmDelegationWalletId: null, farmDelegationEnabledAt: null },
    });
    return { available: !!this.cfg.privyAuthorizationKey, enabled: false };
  }

  /** One-tap: ensure a subwallet exists, then fund it now. */
  async fundNow(userId: string): Promise<{ txSignature: string } | { skipped: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.farmDelegationEnabledAt) throw new BadRequestException('Auto-farm not enabled');
    if (!user.primaryWallet) throw new BadRequestException('No embedded wallet on file');
    let sw = await this.prisma.farmingSubwallet.findFirst({ where: { userId, status: 'active' } });
    if (!sw) {
      const created = await this.farming.createSubwallet(userId, user.primaryWallet);
      sw = await this.prisma.farmingSubwallet.findFirst({ where: { id: created.subwalletId } });
    }
    return this._fund(user, sw!);
  }

  /** Agent path: fund a specific subwallet if its user has auto-farm enabled. */
  async autoFundSubwallet(sw: { id: string; pubkey: string; userId: string }): Promise<{ txSignature: string } | { skipped: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: sw.userId } });
    if (!user?.farmDelegationEnabledAt || !user.primaryWallet || !this.cfg.privyAuthorizationKey) {
      return { skipped: 'not enabled' };
    }
    return this._fund(user, sw);
  }

  private async _fund(
    user: { id: string; privyDid: string; primaryWallet: string | null; farmDelegationWalletId: string | null },
    sw: { id: string; pubkey: string },
  ): Promise<{ txSignature: string } | { skipped: string }> {
    const balance = await this.chain.connection.getBalance(new PublicKey(user.primaryWallet!));
    const amount = computeFundAmount(BigInt(balance), this.bounds);
    if (amount === null) return { skipped: 'insufficient balance' };
    return this.funding.fundSubwalletFromUser({
      userId: user.id,
      privyDid: user.privyDid,
      walletId: user.farmDelegationWalletId ?? undefined,
      userAddress: user.primaryWallet!,
      subwalletPubkey: sw.pubkey,
      amountLamports: amount,
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test delegation.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/farming/delegation.service.ts src/farming/delegation.service.spec.ts
git commit -m "feat(be): DelegationService (enable/disable/status/fund-now/auto-fund)"
```

---

## Task 9: Farming controller — delegation endpoints

**Files:**
- Modify: `be/src/farming/farming.controller.ts`

- [ ] **Step 1: Add the endpoints**

In `be/src/farming/farming.controller.ts`, add `Delete` to the `@nestjs/common` import, import the service, inject it, and add four routes. Add to the constructor and class body:

```typescript
// add Delete to the existing import from '@nestjs/common'
import { Body, Controller, Delete, Get, Post, Req, UseGuards } from '@nestjs/common';
import { DelegationService } from './delegation.service';

// constructor: inject alongside the existing FarmingService
constructor(
  private readonly farming: FarmingService,
  private readonly delegation: DelegationService,
) {}

// routes (add inside the class):
@Get('delegation')
delegationStatus(@Req() req: any) { return this.delegation.status(req.user.sub); }

@Post('delegation')
enableDelegation(@Req() req: any) { return this.delegation.enable(req.user.sub); }

@Delete('delegation')
disableDelegation(@Req() req: any) { return this.delegation.disable(req.user.sub); }

@Post('fund-now')
fundNow(@Req() req: any) { return this.delegation.fundNow(req.user.sub); }
```

- [ ] **Step 2: Typecheck**

Run: `pnpm build`
Expected: fails to resolve `DelegationService` provider until Task 10 wires the module — that's expected. Proceed; a full `pnpm build` gate runs in Task 11 after wiring. (If you prefer, do Task 10 before this step; they commit together conceptually but keep separate commits.)

- [ ] **Step 3: Commit**

```bash
git add src/farming/farming.controller.ts
git commit -m "feat(be): farming delegation endpoints (status/enable/disable/fund-now)"
```

---

## Task 10: Module wiring

**Files:**
- Modify: `be/src/wallet/wallet.module.ts`
- Modify: `be/src/farming/farming.module.ts`
- Modify: `be/.env.example`

- [ ] **Step 1: Export PrivyService from WalletModule**

Replace `be/src/wallet/wallet.module.ts` providers/exports so `PrivyService`, `DelegatedPolicyValidator` are available:

```typescript
import { Module } from '@nestjs/common';
import { PrivyService } from './privy.service';
import { SubwalletService } from './subwallet.service';
import { SigningService } from './signing.service';
import { PolicyValidator } from './policy.validator';
import { DelegatedPolicyValidator } from './delegated-policy.validator';

@Module({
  providers: [PrivyService, SubwalletService, SigningService, PolicyValidator, DelegatedPolicyValidator],
  exports: [SubwalletService, SigningService, PrivyService, DelegatedPolicyValidator],
})
export class WalletModule {}
```

- [ ] **Step 2: Register new providers in FarmingModule**

Update `be/src/farming/farming.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { OnchainModule } from '../onchain/onchain.module';
import { WalletModule } from '../wallet/wallet.module';
import { FarmingService } from './farming.service';
import { FarmingController } from './farming.controller';
import { SaveYieldAdapter } from './save-yield-adapter';
import { FarmingAgentScheduler, FARM_BOUNDS } from './farming-agent.scheduler';
import { DelegatedFundingService } from './delegated-funding.service';
import { DelegationService } from './delegation.service';
import { FARM_FUNDING_BOUNDS } from './farming.bounds';

@Module({
  imports: [OnchainModule, WalletModule],
  controllers: [FarmingController],
  providers: [
    SaveYieldAdapter, FarmingService, FarmingAgentScheduler,
    DelegatedFundingService, DelegationService,
    { provide: FARM_BOUNDS, useValue: {
      rentBuffer: parseInt(process.env.NAVY_FARM_RENT_BUFFER ?? '2000000', 10),
      minDeposit: parseInt(process.env.NAVY_FARM_MIN_DEPOSIT ?? '10000000', 10),
      maxDeposit: parseInt(process.env.NAVY_FARM_MAX_DEPOSIT ?? '1000000000', 10),
    } },
    { provide: FARM_FUNDING_BOUNDS, useValue: {
      reserve: BigInt(process.env.NAVY_FARM_USER_RESERVE ?? '5000000'),
      fundMin: BigInt(process.env.NAVY_FARM_FUND_MIN ?? '10000000'),
      fundMax: BigInt(process.env.NAVY_FARM_FUND_MAX ?? '1000000000'),
    } },
  ],
})
export class FarmingModule {}
```

- [ ] **Step 3: Document env vars**

Append to `be/.env.example`:

```bash
# ─── Delegated farming (Privy session keys) ───
# Authorization private key registered in the Privy dashboard; absent = feature off.
PRIVY_AUTHORIZATION_KEY=
NAVY_FARM_USER_RESERVE=5000000     # lamports always left in the user's embedded wallet
NAVY_FARM_FUND_MIN=10000000        # min spare that triggers a top-up
NAVY_FARM_FUND_MAX=1000000000      # max single top-up
```

- [ ] **Step 4: Typecheck the whole backend**

Run: `pnpm build`
Expected: clean (nest build typechecks all modules incl. the new controller routes).

- [ ] **Step 5: Commit**

```bash
git add src/wallet/wallet.module.ts src/farming/farming.module.ts .env.example
git commit -m "feat(be): wire delegated-funding providers + funding bounds + env"
```

---

## Task 11: Farming agent — auto-fund delegated users

**Files:**
- Modify: `be/src/farming/farming-agent.scheduler.ts`
- Test: `be/src/farming/farming-agent.scheduler.spec.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `be/src/farming/farming-agent.scheduler.spec.ts` (mirror the existing setup style; this focuses on the new delegated call):

```typescript
import { FarmingAgentScheduler } from './farming-agent.scheduler';

describe('FarmingAgentScheduler auto-fund', () => {
  it('auto-funds a low subwallet before depositing', async () => {
    const sw = { id: 's1', pubkey: 'SubAddr', userId: 'u1', status: 'active' };
    const prisma = { farmingSubwallet: { findMany: jest.fn().mockResolvedValue([sw]) } } as any;
    const farming = { depositSubwallet: jest.fn().mockResolvedValue({}), refreshSubwallet: jest.fn().mockResolvedValue({}) } as any;
    const chain = { connection: { getBalance: jest.fn().mockResolvedValue(1_000_000) } } as any; // idle below minDeposit
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
    const bounds = { rentBuffer: 2_000_000, minDeposit: 10_000_000, maxDeposit: 1_000_000_000 };
    const delegation = { autoFundSubwallet: jest.fn().mockResolvedValue({ txSignature: 'sig' }) } as any;

    const agent = new FarmingAgentScheduler(prisma, farming, chain, audit, bounds, delegation);
    await agent.tickOnce();

    expect(delegation.autoFundSubwallet).toHaveBeenCalledWith(expect.objectContaining({ id: 's1', pubkey: 'SubAddr', userId: 'u1' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test farming-agent`
Expected: FAIL — constructor arity mismatch / no `autoFundSubwallet` call.

- [ ] **Step 3: Implement**

Edit `be/src/farming/farming-agent.scheduler.ts`:

1. Import and inject `DelegationService` as the last constructor param:

```typescript
import { DelegationService } from './delegation.service';

// constructor — add as the last parameter:
    @Inject(FARM_BOUNDS) private readonly bounds: FarmBounds,
    private readonly delegation: DelegationService,
```

2. In `tickOnce`, inside the `try`, after reading `idle` and before the deposit check, top up delegated users when idle is low:

```typescript
    const idle = await this.chain.connection.getBalance(new PublicKey(sw.pubkey));
    if (idle < this.bounds.minDeposit) {
      await this.delegation.autoFundSubwallet({ id: sw.id, pubkey: sw.pubkey, userId: sw.userId });
    }
    const depositable = idle - this.bounds.rentBuffer;
    if (depositable >= this.bounds.minDeposit) {
      const amount = BigInt(Math.min(depositable, this.bounds.maxDeposit));
      await this.farming.depositSubwallet(sw, amount);
    }
    await this.farming.refreshSubwallet(sw);
```

(The top-up confirms on-chain this tick; the *next* tick deposits the newly-funded idle. Errors in `autoFundSubwallet` fall through to the existing `catch` → `farming.agent.skip` audit.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test farming-agent`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/farming/farming-agent.scheduler.ts src/farming/farming-agent.scheduler.spec.ts
git commit -m "feat(be): agent auto-funds delegated users' subwallets"
```

---

## Task 12: Client — delegation status helper + API calls

**Files:**
- Create: `expo-wallet/src/lib/account/delegationStatus.ts`
- Test: `expo-wallet/src/lib/account/delegationStatus.test.ts`
- Modify: the client API module (find how `GET /farming` position is called today and mirror it)

- [ ] **Step 1: Write the failing test**

Create `expo-wallet/src/lib/account/delegationStatus.test.ts`:

```typescript
import { delegationUiState } from './delegationStatus';

describe('delegationUiState', () => {
  it('is unavailable when the backend feature is off', () => {
    expect(delegationUiState({ available: false, enabled: false })).toBe('unavailable');
    expect(delegationUiState({ available: false, enabled: true })).toBe('unavailable');
  });
  it('reflects enabled/disabled when available', () => {
    expect(delegationUiState({ available: true, enabled: false })).toBe('off');
    expect(delegationUiState({ available: true, enabled: true })).toBe('on');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `expo-wallet/`): `pnpm test delegationStatus`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `expo-wallet/src/lib/account/delegationStatus.ts`:

```typescript
export interface DelegationStatus { available: boolean; enabled: boolean }
export type DelegationUiState = 'unavailable' | 'off' | 'on';

export function delegationUiState(s: DelegationStatus): DelegationUiState {
  if (!s.available) return 'unavailable';
  return s.enabled ? 'on' : 'off';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test delegationStatus`
Expected: PASS.

- [ ] **Step 5: Add the API calls**

Read the existing client API module that calls the backend for farming (search `expo-wallet/src` for how `GET /farming` / `POST /farming/deposit` are called — it attaches the Navy session bearer). Mirror that exact pattern to add four functions with these contracts:

- `getDelegation(): Promise<{ available: boolean; enabled: boolean }>` → `GET /farming/delegation`
- `enableDelegation(): Promise<{ available: boolean; enabled: boolean }>` → `POST /farming/delegation`
- `disableDelegation(): Promise<{ available: boolean; enabled: boolean }>` → `DELETE /farming/delegation`
- `fundNow(): Promise<{ txSignature: string } | { skipped: string }>` → `POST /farming/fund-now`

Use the same base URL, auth header, and error handling as the sibling farming calls. Do not invent a new HTTP client.

- [ ] **Step 6: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
# stage the two new files plus the exact API module file you edited in Step 5 (name it explicitly — do NOT use a broad glob):
git add src/lib/account/delegationStatus.ts src/lib/account/delegationStatus.test.ts <path/to/the/api/module/you/edited>
git commit -m "feat(expo-wallet): delegation status helper + farming delegation API calls"
```

---

## Task 13: Client — AutoFarmToggle on the Earn screen

**Files:**
- Create: `expo-wallet/src/features/farming/AutoFarmToggle.tsx`
- Modify: `expo-wallet/app/(tabs)/farming.tsx`

**VERIFY BEFORE CODING** in `expo-wallet/node_modules/@privy-io/expo`: `useHeadlessDelegatedActions()` returns `{ delegateWallet, revokeWallets }`; `delegateWallet({ address, chainType: 'solana' })`; `revokeWallets()`. Adapt to the real signatures.

- [ ] **Step 1: Write the component**

Create `expo-wallet/src/features/farming/AutoFarmToggle.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useHeadlessDelegatedActions } from '@privy-io/expo';
import { useMobileSigner } from '@/lib/wallet/useMobileSigner';
import { useToast } from '@/ui/Toast';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { IconBadge } from '@/ui/Bits';
import { colors, space } from '@/ui/theme';
import { getDelegation, enableDelegation, disableDelegation, fundNow } from '@/lib/api/farming';
import { delegationUiState } from '@/lib/account/delegationStatus';

export function AutoFarmToggle() {
  const { address } = useMobileSigner();
  const { delegateWallet, revokeWallets } = useHeadlessDelegatedActions();
  const toast = useToast();
  const [state, setState] = useState<'unavailable' | 'off' | 'on' | 'loading'>('loading');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try { setState(delegationUiState(await getDelegation())); }
    catch { setState('unavailable'); }
  };
  useEffect(() => { refresh(); }, []);

  const enable = async () => {
    if (!address) return;
    setBusy(true);
    try {
      await delegateWallet({ address, chainType: 'solana' });
      await enableDelegation();
      const funded = await fundNow();
      toast('skipped' in funded ? `Auto-farm on (${funded.skipped})` : 'Auto-farm on — funded');
      await refresh();
    } catch (e: unknown) {
      toast(`Could not enable auto-farm: ${e instanceof Error ? e.message : 'try again'}`);
    } finally { setBusy(false); }
  };

  const disable = async () => {
    setBusy(true);
    try {
      await disableDelegation();
      await revokeWallets();
      toast('Auto-farm off');
      await refresh();
    } catch (e: unknown) {
      toast(`Could not disable: ${e instanceof Error ? e.message : 'try again'}`);
    } finally { setBusy(false); }
  };

  if (state === 'unavailable' || state === 'loading') return null;

  return (
    <Card glass compact style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <IconBadge name="sprout" color={colors.textDim} />
        <View style={{ flex: 1 }}>
          <Text variant="body" color={colors.textHi}>Auto-farm</Text>
          <Text variant="caption" color={colors.textDim}>
            Let Navy top up your farming wallet automatically from your balance.
          </Text>
        </View>
      </View>
      {state === 'on'
        ? <Button label="Turn off auto-farm" variant="danger" onPress={disable} loading={busy} />
        : <Button label="Enable auto-farm" onPress={enable} loading={busy} disabled={!address} />}
    </Card>
  );
}
```

Adjust the API import path (`@/lib/api/farming`) to wherever Task 12 added the functions. Verify `IconBadge`, `Card`, `Button`, `Text` props against `src/ui` (as in sub-project A).

- [ ] **Step 2: Mount it on the Earn screen**

In `expo-wallet/app/(tabs)/farming.tsx`, import and render `<AutoFarmToggle />` near the top of the screen content (above or below the position card). Do not restructure existing UI:

```tsx
import { AutoFarmToggle } from '@/features/farming/AutoFarmToggle';
// ...within the screen's scroll content:
<AutoFarmToggle />
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/features/farming/AutoFarmToggle.tsx app/(tabs)/farming.tsx
git commit -m "feat(expo-wallet): AutoFarmToggle (delegate + enable + fund) on Earn screen"
```

---

## Task 14: Full verification pass

**Files:** none.

- [ ] **Step 1: Backend scoped unit suites**

Run each (scoped, to avoid a heavy full run):
```bash
pnpm test config.service
pnpm test tx-summary
pnpm test policy.validator
pnpm test delegated-policy
pnpm test funding.util
pnpm test privy.service
pnpm test delegated-funding
pnpm test delegation.service
pnpm test farming-agent
```
Expected: all PASS.

- [ ] **Step 2: Backend build gate**

Run: `pnpm build`
Expected: clean (typechecks the whole Nest app incl. new modules/routes).

- [ ] **Step 3: Client gates**

From `expo-wallet/`:
```bash
pnpm test delegationStatus
pnpm exec tsc --noEmit
```
Expected: PASS + clean.

- [ ] **Step 4: Document operator + manual E2E steps**

Record in the PR/branch notes (these cannot be auto-run here):
- Privy dashboard: register an authorization keypair, enable delegated actions; set `PRIVY_AUTHORIZATION_KEY` + `NAVY_FARM_*` in `be/.env`.
- Manual E2E (devnet, dev-client): enable auto-farm on the Earn screen → confirm `farmDelegationEnabledAt` set + a `farming.delegated.fund` audit row + on-chain transfer user→subwallet → next agent tick deposits into Save → disable → confirm revoke.

- [ ] **Step 5: Commit any verification fixes**

```bash
git add -A
git commit -m "fix(be,expo-wallet): verification-pass fixes for delegated farming"
```

---

## Self-Review (traceability to spec)

- **Security boundary** (only bounded system-transfer to own subwallet) → Tasks 3, 4, 7 (`DelegatedPolicyValidator` + defense-in-depth check in `DelegatedFundingService`).
- **Off by default** (no auth key → disabled) → Tasks 1, 8 (`status.available`, `enable` throws `ServiceUnavailable`, `autoFundSubwallet` skips), 6 (`signDelegatedTransaction` throws).
- **Delegated signing via server-auth** → Task 6 (`signDelegatedTransaction`), 7 (usage).
- **Gasless relayer fee-payer** → Task 7 (`feePayer = relayer`, `partialSign`).
- **Idempotency** → Task 7 (`idempotencyKey`).
- **Delegation lifecycle** (enable/disable/status/fund-now) → Tasks 8, 9; client toggle → Tasks 12, 13 (`delegateWallet`/`revokeWallets`).
- **Auto-fund + one-tap start + auto-sweep** → Task 11 (agent auto-fund), Task 8/13 (`fundNow` one-tap); auto-sweep = existing subwallet withdraw (unchanged, no task needed).
- **Untouched crown jewels** → no task modifies `signing.service.ts`/`policy.validator.ts`/`crypto`; `tx-summary` change is additive (Task 3).
- **Persistence** → Task 2 (`User` fields).
- **Testing/gates** → Task 14. Live delegated E2E is operator-gated (documented, not auto-run).
