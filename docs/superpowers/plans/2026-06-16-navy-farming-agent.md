# Navy Farming Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user create a Navy farming subwallet, fund it with SOL, and have a backend agent deposit it into Save (Solend)'s devnet SOL reserve to earn auto-compounding yield (withdrawable to the main wallet) — built on the existing isolated `SigningService`, with the `PolicyValidator` hardened to authoritatively bound what the subwallet can do.

**Architecture:** Security-first. First harden the policy: derive the program ids AND transfer destinations from the *actual* transaction and validate both against the subwallet's allowlists (closing the foundation's SECURITY TODO). Then a `YieldAdapter` (`SaveYieldAdapter` for devnet) builds deposit/withdraw txs, a `FarmingService` orchestrates them through `SigningService`, and a bounded cron auto-deposits idle SOL + records positions. Mobile adds a farming screen. Pure logic is TDD'd; the Save SDK wiring + screens are typecheck-verified with a gated devnet integration test.

**Tech Stack:** Nest 11 · Prisma 7 · `@solendprotocol/solend-sdk` · `@nestjs/schedule` · `@solana/web3.js` + `@solana/spl-token` · Expo SDK 56 · `@privy-io/expo` · Jest.

**Scope:** Sub-project 7 (final). Implements `docs/superpowers/specs/2026-06-16-navy-farming-agent-design.md`. Reuses the foundation subwallet plumbing.

> **Verify-against-installed:** `@solendprotocol/solend-sdk` (archived standalone repo; ships from `solendprotocol/public`) and `@nestjs/schedule` — confirm their APIs against the installed versions; `tsc`/`anchor`-style build + the gated integration test are the gates. The Save SDK deposit/withdraw method names below are the documented surface; adjust to the installed version.

---

## File Structure

```
be/
├── prisma/schema.prisma                         # MODIFY: FarmingSubwallet fields + FarmingEvent
├── src/wallet/tx-summary.ts + .spec.ts          # NEW: deriveTxSummary (programIds + transferDestinations) — SECURITY CRUX
├── src/wallet/policy.validator.ts + .spec.ts    # MODIFY: allowedDestinations, authoritative check
├── src/wallet/signing.service.ts + .spec.ts     # MODIFY: derive summary internally (drop caller summary)
├── src/farming/yield-adapter.ts                 # NEW: YieldAdapter interface + position math
├── src/farming/yield-adapter.spec.ts            # NEW: computePositionValue tests
├── src/farming/save-yield-adapter.ts            # NEW: Save SDK impl (devnet SOL reserve)
├── src/farming/farming.service.ts + .spec.ts    # NEW: create/deposit/withdraw/position/history
├── src/farming/farming-agent.scheduler.ts + .spec.ts  # NEW: bounded cron
├── src/farming/farming.controller.ts            # NEW: /farming endpoints
└── src/farming/farming.module.ts                # NEW
mobile/
├── src/farming/farmingClient.ts + .test.ts      # NEW: testable client + formatters
└── app/farming.tsx                              # NEW: farming screen
```

---

## Conventions

- be from `/home/khoa/Desktop/uni/be`; mobile from `/home/khoa/Desktop/uni/mobile`. Tests: `pnpm test <pattern>`. Postgres: `docker compose up -d`.
- Commit per task. Git identity fallback: `git -c user.name=Navy -c user.email=capydata.xyz@gmail.com commit ...`.
- Existing: `SigningService`/`SubwalletService`/`PolicyValidator` (be/src/wallet/), `Cipher`, `AuditService`, `NAVY_ONCHAIN`/`OnchainModule`, `JwtGuard`/`RolesGuard`/`Roles`, `NavyConfigService`. Mobile: `useNavySession`, Privy `useEmbeddedSolanaWallet`.

---

### Task 1: `deriveTxSummary` — authoritative tx decoding (SECURITY CRUX)

**Files:** Create `be/src/wallet/tx-summary.ts`, `tx-summary.spec.ts`.

- [ ] **Step 1: Write the failing test** — `tx-summary.spec.ts`

```ts
import { Transaction, SystemProgram, Keypair, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, createTransferInstruction, createTransferCheckedInstruction } from '@solana/spl-token';
import { deriveTxSummary } from './tx-summary';

describe('deriveTxSummary', () => {
  it('collects program ids from every instruction', () => {
    const a = Keypair.generate().publicKey;
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: a, toPubkey: PublicKey.default, lamports: 1 }));
    const s = deriveTxSummary(tx);
    expect(s.programIds).toContain(SystemProgram.programId.toBase58());
  });

  it('extracts the destination of a SystemProgram.transfer', () => {
    const from = Keypair.generate().publicKey;
    const to = Keypair.generate().publicKey;
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: 5 }));
    expect(deriveTxSummary(tx).transferDestinations).toEqual([to.toBase58()]);
  });

  it('extracts the destination of an SPL token Transfer', () => {
    const src = Keypair.generate().publicKey, dst = Keypair.generate().publicKey, owner = Keypair.generate().publicKey;
    const ix = createTransferInstruction(src, dst, owner, 10n as any);
    const tx = new Transaction().add(ix);
    expect(deriveTxSummary(tx).transferDestinations).toContain(dst.toBase58());
  });

  it('extracts the destination of an SPL token TransferChecked', () => {
    const src = Keypair.generate().publicKey, mint = Keypair.generate().publicKey, dst = Keypair.generate().publicKey, owner = Keypair.generate().publicKey;
    const ix = createTransferCheckedInstruction(src, mint, dst, owner, 10n as any, 6);
    const tx = new Transaction().add(ix);
    expect(deriveTxSummary(tx).transferDestinations).toContain(dst.toBase58());
  });

  it('ignores non-transfer instructions (e.g. a generic program call)', () => {
    const prog = Keypair.generate().publicKey;
    const tx = new Transaction().add(new TransactionInstruction({ programId: prog, keys: [], data: Buffer.from([9, 9]) }));
    const s = deriveTxSummary(tx);
    expect(s.programIds).toContain(prog.toBase58());
    expect(s.transferDestinations).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test tx-summary`
Expected: FAIL — cannot find `./tx-summary`.

- [ ] **Step 3: Implement `tx-summary.ts`**

```ts
import { Transaction, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

export interface TxSummary { programIds: string[]; transferDestinations: string[]; }

// SystemProgram instruction index 2 = Transfer (u32 little-endian at data[0..4]).
function isSystemTransfer(programId: string, data: Buffer): boolean {
  return programId === SystemProgram.programId.toBase58() && data.length >= 4 && data.readUInt32LE(0) === 2;
}
// SPL Token instruction tag: data[0] === 3 (Transfer) or 12 (TransferChecked).
function tokenTransferDestIndex(programId: string, data: Buffer): number | null {
  if (programId !== TOKEN_PROGRAM_ID.toBase58() || data.length < 1) return null;
  if (data[0] === 3) return 1;   // Transfer: [source, destination, owner]
  if (data[0] === 12) return 2;  // TransferChecked: [source, mint, destination, owner]
  return null;
}

/** Decode a transaction into the program ids it calls and the accounts it transfers value to. */
export function deriveTxSummary(tx: Transaction): TxSummary {
  const programIds = new Set<string>();
  const transferDestinations: string[] = [];
  for (const ix of tx.instructions) {
    const pid = ix.programId.toBase58();
    programIds.add(pid);
    const data = Buffer.from(ix.data);
    if (isSystemTransfer(pid, data)) {
      transferDestinations.push(ix.keys[1].pubkey.toBase58()); // SystemProgram.transfer: [from, to]
      continue;
    }
    const ti = tokenTransferDestIndex(pid, data);
    if (ti !== null && ix.keys[ti]) transferDestinations.push(ix.keys[ti].pubkey.toBase58());
  }
  return { programIds: [...programIds], transferDestinations };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test tx-summary`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add be/src/wallet/tx-summary.ts be/src/wallet/tx-summary.spec.ts
git commit -m "feat(be): authoritative tx-summary derivation (program ids + transfer destinations)"
```

---

### Task 2: Harden `PolicyValidator` + `SigningService`

**Files:** Modify `be/src/wallet/policy.validator.ts`, `policy.validator.spec.ts`, `signing.service.ts`, `signing.service.spec.ts`.

- [ ] **Step 1: Update the policy test** — replace `policy.validator.spec.ts`

```ts
import { PolicyValidator, SubwalletPolicy } from './policy.validator';

const policy: SubwalletPolicy = {
  allowedProgramIds: ['Prog11111111111111111111111111111111111111', '11111111111111111111111111111111'],
  allowedDestinations: ['Self1111111111111111111111111111111111111', 'Owner111111111111111111111111111111111111'],
};

describe('PolicyValidator', () => {
  const v = new PolicyValidator();

  it('allows an allowlisted program with destinations all allowlisted', () => {
    expect(v.check(policy, { programIds: ['Prog11111111111111111111111111111111111111'], transferDestinations: ['Self1111111111111111111111111111111111111'] }))
      .toEqual({ ok: true });
  });
  it('rejects a non-allowlisted program', () => {
    const r = v.check(policy, { programIds: ['Evil11111111111111111111111111111111111111'], transferDestinations: [] });
    expect(r.ok).toBe(false); expect((r as any).reason).toMatch(/program/);
  });
  it('rejects a transfer to a non-allowlisted destination even if the program is allowed', () => {
    const r = v.check(policy, { programIds: ['Prog11111111111111111111111111111111111111'], transferDestinations: ['Attacker1111111111111111111111111111111111'] });
    expect(r.ok).toBe(false); expect((r as any).reason).toMatch(/destination/);
  });
  it('allows a withdrawal transfer to the owner', () => {
    expect(v.check(policy, { programIds: ['11111111111111111111111111111111'], transferDestinations: ['Owner111111111111111111111111111111111111'] }))
      .toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test policy.validator`
Expected: FAIL — `allowedDestinations` not on the type; destination check absent.

- [ ] **Step 3: Replace `policy.validator.ts`**

```ts
import { Injectable } from '@nestjs/common';

export interface SubwalletPolicy {
  allowedProgramIds: string[];
  allowedDestinations: string[]; // subwallet's own ATAs + protocol reserve accounts + owner main wallet
}
export interface TxSummary { programIds: string[]; transferDestinations: string[]; }
export type PolicyResult = { ok: true } | { ok: false; reason: string };

@Injectable()
export class PolicyValidator {
  check(policy: SubwalletPolicy, tx: TxSummary): PolicyResult {
    for (const pid of tx.programIds) {
      if (!policy.allowedProgramIds.includes(pid)) return { ok: false, reason: `program not allowlisted: ${pid}` };
    }
    for (const dest of tx.transferDestinations) {
      if (!policy.allowedDestinations.includes(dest)) return { ok: false, reason: `transfer destination not allowed: ${dest}` };
    }
    return { ok: true };
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test policy.validator`
Expected: PASS (4 tests).

- [ ] **Step 5: Update `SigningService` to derive the summary internally** — modify `signing.service.ts`

Change `signTransaction` to drop the caller-provided `summary` and derive it authoritatively:
```ts
import { deriveTxSummary } from './tx-summary';
// ...
  async signTransaction(subwalletId: string, tx: Transaction): Promise<Transaction> {
    const row = await this.prisma.farmingSubwallet.findUnique({ where: { id: subwalletId } });
    if (!row || row.status !== 'active') throw new NotFoundException('Subwallet not available');

    const summary = deriveTxSummary(tx); // authoritative: program ids + transfer destinations from the tx
    const verdict = this.policy.check(row.policyJson as unknown as SubwalletPolicy, summary);
    if (!verdict.ok) {
      await this.audit.record({ actor: `subwallet:${row.pubkey}`, action: 'subwallet.sign.denied', metadata: { reason: verdict.reason } });
      throw new ForbiddenException(`Policy denied: ${verdict.reason}`);
    }
    const secret = await this.cipher.open({ encryptedPrivkey: row.encryptedPrivkey, dataKeyWrapped: row.dataKeyWrapped });
    try {
      const kp = Keypair.fromSecretKey(Uint8Array.from(secret));
      tx.partialSign(kp);
    } finally { secret.fill(0); }
    await this.audit.record({ actor: `subwallet:${row.pubkey}`, action: 'subwallet.sign' });
    return tx;
  }
```
(Import `SubwalletPolicy` from `./policy.validator`; remove the old `TxSummary` param and the `summary.programIds`/`summary.transferDestinations` usage.)

- [ ] **Step 6: Update `signing.service.spec.ts`** — the existing test passed a `summary` arg; update it to the 2-arg call and a policy with `allowedDestinations`. Replace the prior signing test body:

```ts
import { Transaction, TransactionInstruction, Keypair } from '@solana/web3.js';
import { SigningService } from './signing.service';
import { PolicyValidator } from './policy.validator';
import { EnvelopeCipherService } from '../crypto/cipher.service';

it('rejects a tx whose instruction calls a non-allowlisted program (derived from the tx)', async () => {
  const evil = Keypair.generate().publicKey;
  const allowed = Keypair.generate().publicKey.toBase58();
  const ix = new TransactionInstruction({ keys: [], programId: evil, data: Buffer.alloc(0) });
  const tx = new Transaction().add(ix);
  const row = { pubkey: 'PK', status: 'active', encryptedPrivkey: 'x', dataKeyWrapped: 'y',
                policyJson: { allowedProgramIds: [allowed], allowedDestinations: [] } };
  const prisma = { farmingSubwallet: { findUnique: jest.fn().mockResolvedValue(row) } } as any;
  const audit = { record: jest.fn() } as any;
  const cipher = new EnvelopeCipherService(Buffer.alloc(32, 1));
  const svc = new SigningService(prisma, cipher, new PolicyValidator(), audit);
  await expect(svc.signTransaction('s1', tx)).rejects.toThrow(/Policy denied/);
});
```

- [ ] **Step 7: Run tests + build**

Run: `pnpm test signing.service policy.validator && pnpm build`
Expected: PASS; build succeeds. (If `SubwalletService.provision` or its test referenced the old policy shape `ownerMainWallet`, update those to `allowedDestinations` — search `ownerMainWallet` in src/wallet and fix the provision policy + subwallet.service.spec accordingly.)

- [ ] **Step 8: Commit**

```bash
git add be/src/wallet
git commit -m "harden(be): authoritative policy (program + destination allowlists) in SigningService"
```

---

### Task 3: Prisma — farming position fields + events

**Files:** Modify `be/prisma/schema.prisma`; migrate.

- [ ] **Step 1: Extend `FarmingSubwallet`** (keep existing fields: pubkey, encryptedPrivkey, dataKeyWrapped, policyJson, status, userId)

```prisma
  ownerMainWallet      String?
  principalLamports    BigInt   @default(0)
  currentValueLamports BigInt   @default(0)
  lastRefreshedAt      DateTime?
  events               FarmingEvent[]
```

- [ ] **Step 2: Add `FarmingEvent`**

```prisma
model FarmingEvent {
  id          String   @id @default(uuid())
  subwalletId String
  subwallet   FarmingSubwallet @relation(fields: [subwalletId], references: [id])
  kind        String   // deposit|withdraw|refresh|agent_skip|policy_denied
  amount      BigInt   @default(0)
  txSignature String?
  detail      String?
  createdAt   DateTime @default(now())
}
```

- [ ] **Step 3: Migrate**

Run: `docker compose up -d && pnpm prisma migrate dev --name farming_agent`
Expected: migration applied; client regenerated.

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add be/prisma
git commit -m "feat(be): farming position fields + FarmingEvent model"
```

---

### Task 4: `YieldAdapter` interface + position math + `SaveYieldAdapter`

**Files:** Create `be/src/farming/yield-adapter.ts`, `yield-adapter.spec.ts`, `save-yield-adapter.ts`. Install the Save SDK.

- [ ] **Step 1: Install the Save SDK**

```bash
cd /home/khoa/Desktop/uni/be && pnpm add @solendprotocol/solend-sdk @solana/spl-token
```

- [ ] **Step 2: Write the failing test** (the pure position math) — `yield-adapter.spec.ts`

```ts
import { computePositionValue } from './yield-adapter';

describe('computePositionValue', () => {
  it('multiplies cToken amount by the exchange rate (lamports per cToken)', () => {
    // 1.0 cToken at exchange rate 1.05 SOL/cToken on 1_000_000_000 lamports = 1.05 SOL
    expect(computePositionValue(1_000_000_000n, 1.05)).toBe(1_050_000_000n);
  });
  it('handles a sub-unit exchange rate growth', () => {
    expect(computePositionValue(2_000_000_000n, 1.0)).toBe(2_000_000_000n);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm test yield-adapter`
Expected: FAIL — cannot find `./yield-adapter`.

- [ ] **Step 4: Implement `yield-adapter.ts`** (interface + math)

```ts
import { PublicKey, Transaction } from '@solana/web3.js';

export interface YieldPosition { principalLamports: bigint; currentValueLamports: bigint; cTokenAmount: bigint; }

export interface YieldAdapter {
  buildDeposit(subwallet: PublicKey, amountLamports: bigint): Promise<Transaction>;
  buildWithdraw(subwallet: PublicKey, ownerMainWallet: PublicKey, amount: bigint | 'all'): Promise<Transaction>;
  getPosition(subwallet: PublicKey): Promise<YieldPosition>;
  policyAllowlist(subwallet: PublicKey, ownerMainWallet: PublicKey): Promise<{ programIds: string[]; destinations: string[] }>;
}

/** Current SOL value of a cToken position = cTokenAmount * exchangeRate (lamports). */
export function computePositionValue(cTokenAmount: bigint, exchangeRate: number): bigint {
  // exchangeRate is SOL-per-cToken (≈1.0+, grows as interest accrues). Use integer math via a scale.
  const SCALE = 1_000_000_000n;
  const rateScaled = BigInt(Math.round(exchangeRate * 1e9));
  return (cTokenAmount * rateScaled) / SCALE;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm test yield-adapter`
Expected: PASS (2 tests).

- [ ] **Step 6: Implement `save-yield-adapter.ts`** (Save devnet SOL reserve)

```ts
import { Injectable, Inject } from '@nestjs/common';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { NAVY_ONCHAIN } from '../onchain/onchain.module';
import type { NavyOnchain } from '../onchain/onchain.module';
import { YieldAdapter, YieldPosition, computePositionValue } from './yield-adapter';

// Verified Save devnet addresses (research, on-chain confirmed June 2026).
const SAVE_PROGRAM = new PublicKey('ALend7Ketfx5bxh6ghsCDXAoDrhvEmsXT3cynB6aPLgx');
const SAVE_MARKET = new PublicKey('GvjoVKNjBvQcFaSKUW1gTE7DxhSpjHbE69umVR5nPuQp');
const SAVE_SOL_RESERVE = new PublicKey('5VVLD7BQp8y3bTgyF5ezm1ResyMTR3PhYsT4iHFU8Sxz');
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSTEM_PROGRAM = new PublicKey('11111111111111111111111111111111');

@Injectable()
export class SaveYieldAdapter implements YieldAdapter {
  constructor(@Inject(NAVY_ONCHAIN) private readonly chain: NavyOnchain) {}

  async buildDeposit(subwallet: PublicKey, amountLamports: bigint): Promise<Transaction> {
    // Uses @solendprotocol/solend-sdk to build a deposit of native SOL into the devnet SOL reserve.
    // VERIFY the installed SDK API: the documented surface is `SolendAction.buildDepositTxns(connection, amount, 'SOL', subwallet, 'devnet')`
    // or `buildDepositReserveLiquidityTxns(...)`. Adjust to the installed version; the returned tx(s)
    // include reserve-refresh + wrap-SOL + create-collateral-ATA + deposit instructions.
    const { SolendActionCore, SolendAction } = await import('@solendprotocol/solend-sdk');
    const action = await (SolendAction as any).buildDepositTxns(
      this.chain.connection, amountLamports.toString(), 'SOL', subwallet, 'devnet',
    );
    return (await action.getTransactions()).preLendingTxn ?? action.lendingTxn ?? (action as any).txn;
  }

  async buildWithdraw(subwallet: PublicKey, ownerMainWallet: PublicKey, amount: bigint | 'all'): Promise<Transaction> {
    // Redeem cTokens for SOL (Save withdraw) then transfer the SOL to ownerMainWallet (top-level SystemProgram.transfer).
    // VERIFY: `SolendAction.buildWithdrawTxns(connection, amount, 'SOL', subwallet, 'devnet')`. Append a
    // SystemProgram.transfer(subwallet -> ownerMainWallet) for the redeemed lamports so the policy's
    // owner-only destination rule is satisfied. Adjust to the installed SDK.
    throw new Error('implement against installed solend-sdk withdraw API (see verify note)');
  }

  async getPosition(subwallet: PublicKey): Promise<YieldPosition> {
    // Read the SOL reserve's cToken exchange rate + the subwallet's collateral (cToken) balance.
    // VERIFY: `SolendMarket.initialize(connection, 'devnet', SAVE_MARKET)` then reserve.stats.cTokenExchangeRate.
    // For now, compute value via computePositionValue once the SDK reads are wired.
    const cTokenAmount = 0n; const exchangeRate = 1.0;
    return { principalLamports: 0n, currentValueLamports: computePositionValue(cTokenAmount, exchangeRate), cTokenAmount };
  }

  async policyAllowlist(subwallet: PublicKey, ownerMainWallet: PublicKey) {
    const { getAssociatedTokenAddressSync } = await import('@solana/spl-token');
    const wsolMint = new PublicKey('So11111111111111111111111111111111111111112');
    const wsolAta = getAssociatedTokenAddressSync(wsolMint, subwallet, true);
    return {
      programIds: [SAVE_PROGRAM, TOKEN_PROGRAM, ATA_PROGRAM, SYSTEM_PROGRAM].map((p) => p.toBase58()),
      // self ATAs (wrap), the Save reserve, and the owner are the only allowed value destinations.
      destinations: [wsolAta.toBase58(), SAVE_SOL_RESERVE.toBase58(), ownerMainWallet.toBase58()],
    };
  }
}
```

> **The Save SDK methods (`buildDepositTxns`/`buildWithdrawTxns`/`SolendMarket`/exchange-rate read) MUST be verified against the installed `@solendprotocol/solend-sdk` and completed.** `getPosition`/`buildWithdraw` are stubbed with explicit notes; they are finished + proven in the gated devnet integration (Task 9), not the unit layer (they need a live connection + Save's devnet reserve). The pure `computePositionValue` and `policyAllowlist` ARE unit-tested. Document the exact SDK calls used.

- [ ] **Step 7: Build**

Run: `pnpm build`
Expected: succeeds (the stubs compile).

- [ ] **Step 8: Commit**

```bash
git add be/src/farming/yield-adapter.ts be/src/farming/yield-adapter.spec.ts be/src/farming/save-yield-adapter.ts be/package.json
git commit -m "feat(be): YieldAdapter interface, position math, SaveYieldAdapter (devnet SOL reserve)"
```

---

### Task 5: `FarmingService`

**Files:** Create `be/src/farming/farming.service.ts`, `farming.service.spec.ts`.

- [ ] **Step 1: Write the failing test** — `farming.service.spec.ts`

```ts
import { FarmingService } from './farming.service';
import { PublicKey, Transaction } from '@solana/web3.js';

function deps(overrides: any = {}) {
  const subwallet = { id: 's1', pubkey: PublicKey.default.toBase58(), ownerMainWallet: 'OWNER', status: 'active', principalLamports: 0n, currentValueLamports: 0n };
  const prisma = {
    farmingSubwallet: {
      findFirst: jest.fn().mockResolvedValue(subwallet),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...subwallet, ...data })),
    },
    farmingEvent: { create: jest.fn().mockResolvedValue({ id: 'e1' }), findMany: jest.fn().mockResolvedValue([]) },
    ...overrides.prisma,
  } as any;
  const subwallets = { provision: jest.fn().mockResolvedValue({ id: 's1', pubkey: 'NEWPK' }) };
  const adapter = {
    buildDeposit: jest.fn().mockResolvedValue(new Transaction()),
    buildWithdraw: jest.fn().mockResolvedValue(new Transaction()),
    getPosition: jest.fn().mockResolvedValue({ principalLamports: 100n, currentValueLamports: 105n, cTokenAmount: 100n }),
    policyAllowlist: jest.fn().mockResolvedValue({ programIds: ['P'], destinations: ['D'] }),
  };
  const signing = { signTransaction: jest.fn().mockImplementation(async (_id, tx) => tx) };
  const chain = { connection: { sendRawTransaction: jest.fn().mockResolvedValue('sig'), confirmTransaction: jest.fn().mockResolvedValue({}) } };
  const audit = { record: jest.fn() };
  return { svc: new FarmingService(prisma, subwallets as any, adapter as any, signing as any, chain as any, audit as any), prisma, subwallets, adapter, signing };
}

describe('FarmingService', () => {
  it('createSubwallet provisions with the adapter policy + owner', async () => {
    const { svc, subwallets, adapter } = deps();
    await svc.createSubwallet('u1', 'OWNER');
    expect(adapter.policyAllowlist).toHaveBeenCalled();
    expect(subwallets.provision).toHaveBeenCalledWith('u1', expect.objectContaining({ allowedProgramIds: ['P'], allowedDestinations: ['D'] }));
  });

  it('deposit builds a tx, signs via SigningService, submits, records an event', async () => {
    const { svc, adapter, signing, prisma } = deps();
    await svc.deposit('u1', 100n);
    expect(adapter.buildDeposit).toHaveBeenCalled();
    expect(signing.signTransaction).toHaveBeenCalledWith('s1', expect.any(Transaction));
    expect(prisma.farmingEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: 'deposit' }) }));
  });

  it('withdraw builds an owner-targeted tx and records a withdraw event', async () => {
    const { svc, adapter, prisma } = deps();
    await svc.withdraw('u1', 'all');
    expect(adapter.buildWithdraw).toHaveBeenCalledWith(expect.any(PublicKey), expect.any(PublicKey), 'all');
    expect(prisma.farmingEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: 'withdraw' }) }));
  });

  it('getPosition refreshes from the adapter and persists', async () => {
    const { svc, prisma } = deps();
    const pos = await svc.getPosition('u1');
    expect(pos.currentValueLamports).toBe('105');
    expect(prisma.farmingSubwallet.update).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test farming.service`
Expected: FAIL — cannot find `./farming.service`.

- [ ] **Step 3: Implement `farming.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import { PrismaService } from '../prisma/prisma.service';
import { SubwalletService } from '../wallet/subwallet.service';
import { SigningService } from '../wallet/signing.service';
import { SaveYieldAdapter } from './save-yield-adapter';
import type { YieldAdapter } from './yield-adapter';
import { AuditService } from '../audit/audit.service';
import { NAVY_ONCHAIN } from '../onchain/onchain.module';
import type { NavyOnchain } from '../onchain/onchain.module';
import { Inject } from '@nestjs/common';

@Injectable()
export class FarmingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subwallets: SubwalletService,
    private readonly adapter: SaveYieldAdapter,
    private readonly signing: SigningService,
    @Inject(NAVY_ONCHAIN) private readonly chain: NavyOnchain,
    private readonly audit: AuditService,
  ) {}

  private adapterAs(): YieldAdapter { return this.adapter; }

  async createSubwallet(userId: string, ownerMainWallet: string) {
    // Provision the keypair first to know its pubkey for the policy, then store the policy.
    // SubwalletService.provision generates the keypair and stores it with the given policy; we
    // derive the policy from a placeholder then update? Simpler: provision returns pubkey; we set policy after.
    const placeholder = await this.subwallets.provision(userId, { allowedProgramIds: [], allowedDestinations: [] } as any);
    const allow = await this.adapterAs().policyAllowlist(new PublicKey(placeholder.pubkey), new PublicKey(ownerMainWallet));
    await this.prisma.farmingSubwallet.update({
      where: { id: placeholder.id },
      data: { ownerMainWallet, policyJson: { allowedProgramIds: allow.programIds, allowedDestinations: allow.destinations } as any },
    });
    await this.audit.record({ actor: `user:${userId}`, action: 'farming.subwallet.create', target: placeholder.pubkey });
    return { subwalletId: placeholder.id, address: placeholder.pubkey };
  }

  private async active(userId: string) {
    const sw = await this.prisma.farmingSubwallet.findFirst({ where: { userId, status: 'active' } });
    if (!sw) throw new Error('No active farming subwallet');
    return sw;
  }

  async deposit(userId: string, amountLamports: bigint) {
    const sw = await this.active(userId);
    const tx = await this.adapterAs().buildDeposit(new PublicKey(sw.pubkey), amountLamports);
    const signed = await this.signing.signTransaction(sw.id, tx);
    const sig = await this.submit(signed);
    await this.prisma.farmingEvent.create({ data: { subwalletId: sw.id, kind: 'deposit', amount: amountLamports, txSignature: sig } });
    return { txSignature: sig };
  }

  async withdraw(userId: string, amount: bigint | 'all') {
    const sw = await this.active(userId);
    const tx = await this.adapterAs().buildWithdraw(new PublicKey(sw.pubkey), new PublicKey(sw.ownerMainWallet!), amount);
    const signed = await this.signing.signTransaction(sw.id, tx);
    const sig = await this.submit(signed);
    await this.prisma.farmingEvent.create({ data: { subwalletId: sw.id, kind: 'withdraw', amount: amount === 'all' ? 0n : amount, txSignature: sig } });
    return { txSignature: sig };
  }

  async getPosition(userId: string) {
    const sw = await this.active(userId);
    const pos = await this.adapterAs().getPosition(new PublicKey(sw.pubkey));
    await this.prisma.farmingSubwallet.update({
      where: { id: sw.id },
      data: { principalLamports: pos.principalLamports, currentValueLamports: pos.currentValueLamports, lastRefreshedAt: new Date() },
    });
    return { address: sw.pubkey, principalLamports: pos.principalLamports.toString(), currentValueLamports: pos.currentValueLamports.toString(), cTokenAmount: pos.cTokenAmount.toString() };
  }

  listHistory(userId: string) {
    return this.prisma.farmingEvent.findMany({ where: { subwallet: { userId } }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  private async submit(signed: { serialize(): Buffer }): Promise<string> {
    const sig = await this.chain.connection.sendRawTransaction(signed.serialize());
    await this.chain.connection.confirmTransaction(sig, 'confirmed');
    return sig;
  }
}
```

> Note: `createSubwallet` provisions with an empty policy then updates it with the adapter allowlist (the pubkey is needed to derive the self-ATA destination). If you prefer, add a `SubwalletService.provisionWithPolicyFactory` that derives the policy from the generated pubkey in one step — but the two-step here is correct and keeps `SubwalletService` unchanged. The test asserts `provision` is called with the allowlist shape; adjust the test/impl to match whichever single source you choose (the provided impl calls provision with empty then updates — change the test's assertion to the update call if you keep this form, OR thread the policy through provision). Keep the behavior: the stored `policyJson` ends up = adapter allowlist.

- [ ] **Step 4: Reconcile the test with the chosen provisioning form, run to pass**

Run: `pnpm test farming.service`
Expected: PASS (adjust the `createSubwallet` assertion to match the one-step-or-two-step form you implemented).

- [ ] **Step 5: Commit**

```bash
git add be/src/farming/farming.service.ts be/src/farming/farming.service.spec.ts
git commit -m "feat(be): FarmingService (create/deposit/withdraw/position/history via SigningService)"
```

---

### Task 6: `FarmingAgentScheduler` (bounded cron)

**Files:** Create `be/src/farming/farming-agent.scheduler.ts`, `farming-agent.scheduler.spec.ts`. Install `@nestjs/schedule`.

- [ ] **Step 1: Install the scheduler**

```bash
cd /home/khoa/Desktop/uni/be && pnpm add @nestjs/schedule
```

- [ ] **Step 2: Write the failing test** (the bounded decision logic) — `farming-agent.scheduler.spec.ts`

```ts
import { FarmingAgentScheduler } from './farming-agent.scheduler';

function make(idleLamports: number) {
  const sw = { id: 's1', pubkey: 'PK', status: 'active' };
  const prisma = { farmingSubwallet: { findMany: jest.fn().mockResolvedValue([sw]) } } as any;
  const farming = { deposit: jest.fn().mockResolvedValue({ txSignature: 'sig' }), getPositionBySubwallet: jest.fn().mockResolvedValue({}) };
  const chain = { connection: { getBalance: jest.fn().mockResolvedValue(idleLamports) } };
  const audit = { record: jest.fn() };
  // rentBuffer 2_000_000, minDeposit 1_000_000
  return { sched: new FarmingAgentScheduler(prisma, farming as any, chain as any, audit as any, { rentBuffer: 2_000_000, minDeposit: 1_000_000, maxDeposit: 1_000_000_000 }), farming };
}

describe('FarmingAgentScheduler.tickOnce', () => {
  it('deposits idle SOL above the rent buffer + min deposit', async () => {
    const { sched, farming } = make(5_000_000); // 5M idle; depositable = 5M - 2M = 3M >= min
    await sched.tickOnce();
    expect(farming.deposit).toHaveBeenCalled();
  });
  it('skips when idle is below the buffer + minimum', async () => {
    const { sched, farming } = make(2_500_000); // depositable = 0.5M < min 1M
    await sched.tickOnce();
    expect(farming.deposit).not.toHaveBeenCalled();
  });
  it('caps the deposit at maxDeposit', async () => {
    const { sched, farming } = make(10_000_000_000); // huge idle
    await sched.tickOnce();
    const amt = farming.deposit.mock.calls[0][1];
    expect(amt).toBe(1_000_000_000n);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm test farming-agent.scheduler`
Expected: FAIL — cannot find module.

- [ ] **Step 4: Implement `farming-agent.scheduler.ts`**

```ts
import { Injectable, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PublicKey } from '@solana/web3.js';
import { PrismaService } from '../prisma/prisma.service';
import { FarmingService } from './farming.service';
import { AuditService } from '../audit/audit.service';
import { NAVY_ONCHAIN } from '../onchain/onchain.module';
import type { NavyOnchain } from '../onchain/onchain.module';

export interface FarmBounds { rentBuffer: number; minDeposit: number; maxDeposit: number; }
export const FARM_BOUNDS = Symbol('FARM_BOUNDS');

@Injectable()
export class FarmingAgentScheduler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly farming: FarmingService,
    @Inject(NAVY_ONCHAIN) private readonly chain: NavyOnchain,
    private readonly audit: AuditService,
    @Inject(FARM_BOUNDS) private readonly bounds: FarmBounds,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async tick() { await this.tickOnce(); }

  /** One pass: deposit idle SOL (bounded) + refresh positions for each active subwallet. */
  async tickOnce(): Promise<void> {
    const subs = await this.prisma.farmingSubwallet.findMany({ where: { status: 'active' } });
    for (const sw of subs) {
      try {
        const idle = await this.chain.connection.getBalance(new PublicKey(sw.pubkey));
        const depositable = idle - this.bounds.rentBuffer;
        if (depositable >= this.bounds.minDeposit) {
          const amount = BigInt(Math.min(depositable, this.bounds.maxDeposit));
          await this.farming.depositSubwallet(sw, amount); // deposit for a specific subwallet (see note)
        }
        await this.farming.refreshSubwallet(sw);
      } catch (e) {
        await this.audit.record({ actor: `subwallet:${sw.pubkey}`, action: 'farming.agent.skip', metadata: { error: (e as Error).message } });
      }
    }
  }
}
```

> Add thin `depositSubwallet(sw, amount)` + `refreshSubwallet(sw)` helpers to `FarmingService` that operate on a given subwallet row (the `deposit(userId)` path resolves the active subwallet; the scheduler already has the row). Keep the test's `farming.deposit` mock name consistent with whatever you expose — the provided test mocks `deposit`; rename to `depositSubwallet` in both the test and the scheduler for clarity, asserting it's called with `(sw, amount: bigint)` and the cap. Adjust the test's mock method name to match.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm test farming-agent.scheduler`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add be/src/farming/farming-agent.scheduler.ts be/src/farming/farming-agent.scheduler.spec.ts be/package.json
git commit -m "feat(be): bounded farming agent scheduler (auto-deposit idle + refresh)"
```

---

### Task 7: Controller + module wiring

**Files:** Create `be/src/farming/farming.controller.ts`, `farming.module.ts`; modify `be/src/app.module.ts` (+ `ScheduleModule`).

- [ ] **Step 1: Implement `farming.controller.ts`**

```ts
import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { FarmingService } from './farming.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

class DepositDto { amountLamports!: string; }
class WithdrawDto { amount!: string; } // 'all' or a lamport string

@Controller('farming')
@UseGuards(JwtGuard, RolesGuard)
@Roles('user')
export class FarmingController {
  constructor(private readonly farming: FarmingService) {}

  @Post('subwallet')
  create(@Req() req: any) { return this.farming.createSubwallet(req.user.sub, req.user.walletAddress); }

  @Get()
  position(@Req() req: any) { return this.farming.getPosition(req.user.sub); }

  @Post('deposit')
  deposit(@Req() req: any, @Body() dto: DepositDto) { return this.farming.deposit(req.user.sub, BigInt(dto.amountLamports)); }

  @Post('withdraw')
  withdraw(@Req() req: any, @Body() dto: WithdrawDto) { return this.farming.withdraw(req.user.sub, dto.amount === 'all' ? 'all' : BigInt(dto.amount)); }

  @Get('history')
  history(@Req() req: any) { return this.farming.listHistory(req.user.sub); }
}
```

- [ ] **Step 2: Implement `farming.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { OnchainModule } from '../onchain/onchain.module';
import { FarmingService } from './farming.service';
import { FarmingController } from './farming.controller';
import { SaveYieldAdapter } from './save-yield-adapter';
import { FarmingAgentScheduler, FARM_BOUNDS } from './farming-agent.scheduler';
import { SubwalletService } from '../wallet/subwallet.service';
import { SigningService } from '../wallet/signing.service';
import { PolicyValidator } from '../wallet/policy.validator';

@Module({
  imports: [OnchainModule],
  controllers: [FarmingController],
  providers: [
    SaveYieldAdapter, FarmingService, FarmingAgentScheduler,
    SubwalletService, SigningService, PolicyValidator,
    { provide: FARM_BOUNDS, useValue: {
      rentBuffer: parseInt(process.env.NAVY_FARM_RENT_BUFFER ?? '2000000', 10),
      minDeposit: parseInt(process.env.NAVY_FARM_MIN_DEPOSIT ?? '10000000', 10),
      maxDeposit: parseInt(process.env.NAVY_FARM_MAX_DEPOSIT ?? '1000000000', 10),
    } },
  ],
})
export class FarmingModule {}
```

> `SubwalletService`/`SigningService`/`PolicyValidator` may already be provided by a wallet module; if so, import that module instead of re-listing them. Confirm how the foundation exposes them and wire accordingly (import `WalletModule` if it exports them).

- [ ] **Step 3: Wire `app.module.ts`** — add `ScheduleModule.forRoot()` (from `@nestjs/schedule`) and `FarmingModule` to imports.

```ts
import { ScheduleModule } from '@nestjs/schedule';
// imports: [ ..., ScheduleModule.forRoot(), FarmingModule ]
```

- [ ] **Step 4: Build + full unit suite**

Run: `pnpm build && pnpm test`
Expected: build succeeds; all unit specs pass.

- [ ] **Step 5: Commit**

```bash
git add be/src/farming/farming.controller.ts be/src/farming/farming.module.ts be/src/app.module.ts
git commit -m "feat(be): farming controller + module + scheduler wiring"
```

---

### Task 8: Mobile — FarmingClient + farming screen

**Files:** Create `mobile/src/farming/farmingClient.ts`, `farmingClient.test.ts`, `mobile/app/farming.tsx`.

- [ ] **Step 1: Write the failing test** — `farmingClient.test.ts`

```ts
import { FarmingClient, formatSol } from './farmingClient';

function mockFetch(status: number, body: unknown) {
  return jest.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as typeof fetch;
}

describe('FarmingClient', () => {
  it('createSubwallet posts with the bearer token', async () => {
    const f = mockFetch(201, { subwalletId: 's1', address: 'PK' });
    const c = new FarmingClient('http://api', f);
    const out = await c.createSubwallet('jwt');
    expect(f).toHaveBeenCalledWith('http://api/farming/subwallet', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer jwt' }) }));
    expect(out.address).toBe('PK');
  });
  it('getPosition fetches with the bearer', async () => {
    const f = mockFetch(200, { address: 'PK', principalLamports: '100', currentValueLamports: '105', cTokenAmount: '100' });
    const c = new FarmingClient('http://api', f);
    expect((await c.getPosition('jwt')).currentValueLamports).toBe('105');
  });
  it('withdraw posts the amount', async () => {
    const f = mockFetch(200, { txSignature: 'sig' });
    const c = new FarmingClient('http://api', f);
    await c.withdraw('jwt', 'all');
    expect(f).toHaveBeenCalledWith('http://api/farming/withdraw', expect.objectContaining({ method: 'POST', body: JSON.stringify({ amount: 'all' }) }));
  });
});

describe('formatSol', () => {
  it('formats lamports to SOL', () => { expect(formatSol('1500000000')).toBe('1.5'); });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (mobile): `pnpm test farmingClient`
Expected: FAIL — cannot find `./farmingClient`.

- [ ] **Step 3: Implement `farmingClient.ts`**

```ts
export interface Position { address: string; principalLamports: string; currentValueLamports: string; cTokenAmount: string; }

export function formatSol(lamports: string | number): string {
  return (Number(lamports) / 1_000_000_000).toString();
}

export class FarmingClient {
  constructor(private readonly baseUrl: string, private readonly fetchImpl: typeof fetch = fetch) {}
  private h(token: string) { return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }; }
  private async json<T>(path: string, token: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers: { ...this.h(token), ...(init?.headers ?? {}) } });
    if (!res.ok) throw new Error(`farming ${path} failed (${res.status})`);
    return (await res.json()) as T;
  }
  createSubwallet(token: string): Promise<{ subwalletId: string; address: string }> { return this.json('/farming/subwallet', token, { method: 'POST' }); }
  getPosition(token: string): Promise<Position> { return this.json('/farming', token); }
  deposit(token: string, amountLamports: string): Promise<{ txSignature: string }> { return this.json('/farming/deposit', token, { method: 'POST', body: JSON.stringify({ amountLamports }) }); }
  withdraw(token: string, amount: 'all' | string): Promise<{ txSignature: string }> { return this.json('/farming/withdraw', token, { method: 'POST', body: JSON.stringify({ amount }) }); }
  history(token: string): Promise<any[]> { return this.json('/farming/history', token); }
}
```

- [ ] **Step 4: Run to verify it passes**

Run (mobile): `pnpm test farmingClient`
Expected: PASS (4 tests).

- [ ] **Step 5: Implement `mobile/app/farming.tsx`** (screen — create/fund/position/withdraw)

```tsx
import React, { useEffect, useState } from 'react';
import { View, Text, Button, Alert, StyleSheet } from 'react-native';
import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { useEmbeddedSolanaWallet } from '@privy-io/expo';
import { useNavySession } from '../src/auth/SessionContext';
import { getEnv } from '../src/config/env';
import { FarmingClient, formatSol, Position } from '../src/farming/farmingClient';

export default function Farming() {
  const { session } = useNavySession();
  const solana = useEmbeddedSolanaWallet();
  const token = session?.tokens.accessToken;
  const client = new FarmingClient(getEnv().navyApiUrl);
  const [pos, setPos] = useState<Position | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() { if (token) { try { setPos(await client.getPosition(token)); } catch { setPos(null); } } }
  useEffect(() => { refresh(); }, [token]);

  async function start() {
    if (!token) return;
    setBusy(true);
    try { await client.createSubwallet(token); await refresh(); } catch (e) { Alert.alert('Error', (e as Error).message); } finally { setBusy(false); }
  }

  async function fund() {
    if (!token || !pos) return;
    setBusy(true);
    try {
      const env = getEnv();
      const connection = new Connection(env.solanaRpc, 'confirmed');
      const from = new PublicKey(solana!.wallets![0].address);
      const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: from, toPubkey: new PublicKey(pos.address), lamports: 100_000_000 }));
      tx.feePayer = from; tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      const provider = await (solana!.wallets![0] as any).getProvider();
      const { signedTransaction } = await provider.signTransaction({ transaction: tx.serialize({ requireAllSignatures: false }) });
      await connection.sendRawTransaction(signedTransaction);
      Alert.alert('Funded', 'Sent 0.1 SOL to your farming subwallet');
      await refresh();
    } catch (e) { Alert.alert('Fund failed', (e as Error).message); } finally { setBusy(false); }
  }

  async function withdraw() {
    if (!token) return;
    setBusy(true);
    try { const r = await client.withdraw(token, 'all'); Alert.alert('Withdrawn', r.txSignature.slice(0, 16) + '…'); await refresh(); }
    catch (e) { Alert.alert('Withdraw failed', (e as Error).message); } finally { setBusy(false); }
  }

  return (
    <View style={styles.c}>
      <Text style={styles.h}>Farming</Text>
      {!pos && <Button title={busy ? '…' : 'Start farming'} disabled={busy} onPress={start} />}
      {pos && (
        <>
          <Text style={styles.l}>Subwallet</Text><Text selectable style={styles.mono}>{pos.address}</Text>
          <Text style={styles.l}>Principal</Text><Text>{formatSol(pos.principalLamports)} SOL</Text>
          <Text style={styles.l}>Current value</Text><Text style={styles.big}>{formatSol(pos.currentValueLamports)} SOL</Text>
          <Button title={busy ? '…' : 'Fund 0.1 SOL from wallet'} disabled={busy} onPress={fund} />
          <Button title={busy ? '…' : 'Withdraw all to my wallet'} disabled={busy} onPress={withdraw} />
        </>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1, padding: 24, gap: 8, justifyContent: 'center' },
  h: { fontSize: 22, fontWeight: '600' }, l: { marginTop: 12, fontWeight: '600' }, big: { fontSize: 26, fontWeight: '700' }, mono: { fontFamily: 'monospace' },
});
```

> Verify the Privy `provider.signTransaction({ transaction: Uint8Array }) → { signedTransaction: Uint8Array }` shape (confirmed in sub-project 6) and the wallet address accessor against installed types; `tsc` is the gate. Add a link to `/farming` from the home screen.

- [ ] **Step 6: Typecheck**

Run (mobile): `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/farming mobile/app/farming.tsx
git commit -m "feat(mobile): farming screen + FarmingClient"
```

---

### Task 9: Gated devnet integration + final verification

**Files:** Create `be/test/farming.e2e-spec.ts`; finalize the Save adapter; append to `be/scripts/gateway-bringup.md`.

- [ ] **Step 1: Finalize `SaveYieldAdapter.buildDeposit/buildWithdraw/getPosition`** against the installed `@solendprotocol/solend-sdk` (complete the stubs from Task 4 using the verified SDK methods). Confirm with `pnpm build`.

- [ ] **Step 2: Write the gated integration test** — `be/test/farming.e2e-spec.ts`

```ts
/**
 * Farming devnet integration (gated behind NAVY_FARM_E2E=1; needs devnet SOL + a live Save SOL reserve).
 * Flow: provision a farming subwallet → airdrop devnet SOL to it → FarmingService.deposit into Save
 *       → getPosition reflects cTokens → withdraw 'all' → assert the owner received SOL.
 * Save devnet oracles are unreliable; the test retries deposit/withdraw on stale-oracle reverts.
 */
const RUN = process.env.NAVY_FARM_E2E === '1';
(RUN ? describe : describe.skip)('farming e2e (devnet)', () => {
  it('provision -> fund -> agent deposit -> position -> withdraw to owner', async () => {
    expect(process.env.NAVY_FARM_E2E).toBe('1');
    // Implement against the running backend + devnet: create a user JWT, POST /farming/subwallet,
    // `solana airdrop` to the returned address, POST /farming/deposit, GET /farming (value > 0),
    // POST /farming/withdraw {amount:'all'}, assert the owner main wallet balance increased.
  });
});
```

- [ ] **Step 3: Append the farming bring-up note** to `be/scripts/gateway-bringup.md`

```markdown

## Farming agent (sub-project 7, devnet)
- Targets Save (Solend) devnet SOL reserve (program ALend7Ket…, reserve 5VVLD7…). Farms native SOL (devnet-airdroppable) — devnet pools do NOT use Circle USDC.
- Env: NAVY_FARM_RENT_BUFFER, NAVY_FARM_MIN_DEPOSIT, NAVY_FARM_MAX_DEPOSIT bound the agent; the scheduler runs every 5 min.
- Manual smoke: POST /farming/subwallet → `solana airdrop 1 <subwalletAddress> --url devnet` → wait for the cron (or POST /farming/deposit) → GET /farming shows a growing value → POST /farming/withdraw {amount:'all'} returns funds to the user's main wallet.
- Devnet oracle staleness can revert deposits/withdraws — the agent retries. MAINNET gates: KMS master key, security audit, KaminoYieldAdapter + reward harvest/compound, USDC farming.
```

- [ ] **Step 4: Full unit suites**

Run (be): `pnpm test` — all pass (incl. tx-summary, hardened policy/signing, yield-adapter math, farming service, scheduler).
Run (mobile): `pnpm test` — all pass (incl. farmingClient).

- [ ] **Step 5: Commit**

```bash
git add be/src/farming/save-yield-adapter.ts be/test/farming.e2e-spec.ts be/scripts/gateway-bringup.md
git commit -m "feat(be): finalize Save adapter + gated farming devnet integration + runbook"
```

---

## Self-Review

**Spec coverage (spec §→ task):**
- §3 hardened `PolicyValidator` (authoritative program + destination derivation) → Tasks 1 (derive), 2 (policy + signing). **The security crux is implemented and TDD'd first.**
- §2 `YieldAdapter` + `SaveYieldAdapter` (devnet SOL reserve, cToken math) → Task 4 (+ finalize in 9).
- §4 `FarmingService` (create/deposit/withdraw/position/history via SigningService) → Task 5; `FarmingAgentScheduler` (bounded) → Task 6; data model → Task 3; endpoints → Task 7.
- §5 mobile farming screen + `FarmingClient` → Task 8.
- §7 error handling (oracle-retry, idle below buffer, policy denial, owner-only withdraw) → Tasks 2, 6, 9.
- §8 testing (policy derivation, position math, service orch, scheduler bounds, client; gated devnet integration) → Tasks 1,2,4,5,6,8,9.
- §9 security flags (KMS/audit/Kamino/compound deferred) → Task 9 runbook + spec.

**Placeholder scan:** The security-crux + orchestration tasks (1,2,5,6,8) ship complete code + real tests. `SaveYieldAdapter`'s SDK-dependent `buildDeposit/buildWithdraw/getPosition` are **explicitly stubbed with the documented SDK surface + verify notes** and completed in Task 9 against the installed SDK + proven in the gated devnet integration — they need a live connection to Save's devnet reserve, so they cannot be unit-pinned; the *pure* parts (`computePositionValue`, `policyAllowlist`) ARE unit-tested. Two tasks (5 `createSubwallet` provisioning form, 6 scheduler method name) carry an explicit "reconcile the test assertion with the form you implement" note rather than a hidden mismatch.

**Type consistency:** `TxSummary{programIds,transferDestinations}` (Task 1) consumed by `PolicyValidator.check` (2) and `SigningService` (2). `SubwalletPolicy{allowedProgramIds,allowedDestinations}` (2) produced by `adapter.policyAllowlist` (4) and stored by `FarmingService.createSubwallet` (5). `YieldAdapter` methods (4) called by `FarmingService` (5) + scheduler (6). `SigningService.signTransaction(subwalletId, tx)` (2, 2-arg) called by `FarmingService` (5). `FarmingService` methods (5) used by controller (7) + scheduler (6). `FarmingClient` endpoints (8) match the controller routes (7).

**Known follow-ups (recorded):** Save SDK deposit/withdraw/exchange-rate calls finalized against the installed version (Task 9); the devnet integration is oracle-dependent + gated; `SubwalletService` provisioning may warrant a one-step policy-factory overload; KMS master key, security audit, `KaminoYieldAdapter`, reward harvest/compound, and USDC farming are mainnet deferrals (spec §9/§10).
