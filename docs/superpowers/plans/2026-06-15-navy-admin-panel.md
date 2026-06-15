# Navy Admin Panel (Merchant Approval) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin review, approve, and reject merchants — approval registers the merchant on-chain via `navy_payments` (dedicated registrar key) so they can receive payments.

**Architecture:** Backend `AdminMerchantsModule` (admin-role) over the existing Prisma DB + a `RegistrarService` that calls `register_merchant`/`set_merchant_active` with a registrar keypair (the program admin authority, distinct from the relayer). Approval is atomic with on-chain registration. The fe admin pages (Next.js, server components) read via the admin session cookie and mutate through proxy route handlers. Pure logic is TDD'd; on-chain calls are integration-tested.

**Tech Stack:** Nest 11 · Prisma 7 · `@coral-xyz/anchor` + `@solana/web3.js` + `@solana/spl-token` · Next.js 16 (App Router) · Jest.

**Scope:** Sub-project 4 of Navy. Implements `docs/superpowers/specs/2026-06-15-navy-admin-panel-design.md`. Reuses foundation admin auth, the gateway's `OnchainModule`/`payments-client`, and the foundation web's session pattern.

---

## File Structure

```
be/
├── prisma/schema.prisma                     # + Merchant.onchainRegisteredAt/onchainRegisterTx/rejectionReason
├── src/onchain/registrar.service.ts         # register/reactivate/deactivate via registrar key
├── src/onchain/registrar.service.spec.ts
├── src/admin-merchants/
│   ├── admin-merchants.service.ts           # list/get/approve/reject
│   ├── admin-merchants.service.spec.ts
│   ├── admin-merchants.controller.ts
│   └── admin-merchants.module.ts
└── .env.example                             # + NAVY_ADMIN_SECRET
fe/
├── src/lib/admin-api.ts                      # adminBackendFetch (cookie -> Bearer) + buildAuthHeaders
├── src/lib/admin-api.spec.ts
├── src/app/api/admin/merchants/[id]/approve/route.ts
├── src/app/api/admin/merchants/[id]/reject/route.ts
├── src/app/admin/merchants/page.tsx          # list
├── src/app/admin/merchants/[id]/page.tsx      # detail
├── src/app/admin/merchants/[id]/Actions.tsx   # approve/reject client buttons
└── src/app/admin/page.tsx                      # MODIFY: link to /admin/merchants
```

---

## Conventions

- be tasks run from `/home/khoa/Desktop/uni/be`; fe tasks from `/home/khoa/Desktop/uni/fe`. Tests: `pnpm test <pattern>`. Postgres: `docker compose up -d` (in be).
- Commit per task. Git identity fallback: `git -c user.name=Navy -c user.email=capydata.xyz@gmail.com commit ...`.
- Reuse: `NAVY_ONCHAIN`/`NavyOnchain` (be/src/onchain/onchain.module.ts), `merchantPda`/`configPda` (be/src/onchain/payments-client.ts), `AuditService`, `JwtGuard`/`RolesGuard`/`Roles`, `PrismaService`. fe: `ACCESS_COOKIE` (fe/src/lib/session.ts), `serverEnv()` (fe/src/lib/env.ts).

---

### Task 1: Prisma — Merchant on-chain registration fields

**Files:** Modify `be/prisma/schema.prisma`; create a migration.

- [ ] **Step 1: Add fields to the `Merchant` model** (keep existing fields)

```prisma
  onchainRegisteredAt DateTime?
  onchainRegisterTx   String?
  rejectionReason     String?
```

- [ ] **Step 2: Migrate**

Run: `docker compose up -d && pnpm prisma migrate dev --name admin_merchant_registration`
Expected: migration applied; client regenerated.

- [ ] **Step 3: Verify**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add be/prisma
git commit -m "feat(be): merchant on-chain registration + rejection-reason fields"
```

---

### Task 2: RegistrarService (register / reactivate / deactivate)

**Files:** Create `be/src/onchain/registrar.service.ts`, `registrar.service.spec.ts`; add `NAVY_ADMIN_SECRET` to `be/.env.example`/`.env`.

- [ ] **Step 1: Add the registrar key env**

Append to `be/.env.example` and `be/.env`:
```
# Program admin authority (registrar) — 64-byte secret JSON array; DISTINCT from the relayer. Dev only.
NAVY_ADMIN_SECRET=[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
```

- [ ] **Step 2: Write the failing test** — `registrar.service.spec.ts`

```ts
import { Keypair, PublicKey } from '@solana/web3.js';
import { RegistrarService } from './registrar.service';

// Build a fake NavyOnchain whose program.methods records calls and whose
// connection.getAccountInfo returns null (not registered) or an object (registered).
function fakeChain(accountInfo: unknown) {
  const calls: any[] = [];
  const builder = (name: string) => (...args: any[]) => {
    calls.push({ name, args });
    return { accounts: () => ({ signers: () => ({ rpc: async () => `sig_${name}` }) }) };
  };
  return {
    chain: {
      programId: new PublicKey('5Y8xeLpLx2BWHHAZkYMfFQjsRPF2H7sUwmrVP9zjc7az'),
      usdcMint: new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'),
      connection: { getAccountInfo: async () => accountInfo },
      program: { methods: { registerMerchant: builder('registerMerchant'), setMerchantActive: builder('setMerchantActive') } },
    } as any,
    calls,
  };
}

const merchant = { id: 'm1', payoutAddress: Keypair.generate().publicKey.toBase58() };

describe('RegistrarService', () => {
  it('registers when the on-chain merchant PDA does not exist', async () => {
    const { chain, calls } = fakeChain(null);
    const svc = new RegistrarService(chain, Keypair.generate());
    const sig = await svc.ensureRegisteredActive(merchant as any);
    expect(sig).toBe('sig_registerMerchant');
    expect(calls.map((c) => c.name)).toEqual(['registerMerchant']);
  });

  it('reactivates when the on-chain merchant PDA already exists', async () => {
    const { chain, calls } = fakeChain({ data: Buffer.alloc(1) });
    const svc = new RegistrarService(chain, Keypair.generate());
    const sig = await svc.ensureRegisteredActive(merchant as any);
    expect(sig).toBe('sig_setMerchantActive');
    expect(calls[0].name).toBe('setMerchantActive');
    expect(calls[0].args[0]).toBe(true);
  });

  it('deactivate calls set_merchant_active(false)', async () => {
    const { chain, calls } = fakeChain({ data: Buffer.alloc(1) });
    const svc = new RegistrarService(chain, Keypair.generate());
    const sig = await svc.deactivate(merchant as any);
    expect(sig).toBe('sig_setMerchantActive');
    expect(calls[0].args[0]).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm test registrar.service`
Expected: FAIL — cannot find `./registrar.service`.

- [ ] **Step 4: Implement `registrar.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { Keypair, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import type { NavyOnchain } from './onchain.module';
import { configPda, merchantPda } from './payments-client';

export interface RegistrarMerchant { id: string; payoutAddress: string }

@Injectable()
export class RegistrarService {
  constructor(private readonly chain: NavyOnchain, private readonly registrar: Keypair) {}

  /** Register the merchant on-chain if absent, else reactivate. Returns the tx signature. */
  async ensureRegisteredActive(m: RegistrarMerchant): Promise<string> {
    const authority = new PublicKey(m.payoutAddress);
    const pda = merchantPda(this.chain.programId, authority);
    const existing = await this.chain.connection.getAccountInfo(pda);
    if (!existing) {
      const payout = await getAssociatedTokenAddress(this.chain.usdcMint, authority);
      return this.chain.program.methods
        .registerMerchant(payout)
        .accounts({ config: configPda(this.chain.programId), merchant: pda, merchantAuthority: authority, admin: this.registrar.publicKey })
        .signers([this.registrar])
        .rpc();
    }
    return this.setActive(authority, true);
  }

  async deactivate(m: RegistrarMerchant): Promise<string> {
    return this.setActive(new PublicKey(m.payoutAddress), false);
  }

  private setActive(authority: PublicKey, active: boolean): Promise<string> {
    return this.chain.program.methods
      .setMerchantActive(active)
      .accounts({ config: configPda(this.chain.programId), merchant: merchantPda(this.chain.programId, authority), admin: this.registrar.publicKey })
      .signers([this.registrar])
      .rpc();
  }
}
```

> Verify the Anchor 0.32 `.methods.xxx(...).accounts({...}).signers([...]).rpc()` builder chain against the installed client (it matches the onchain admin CLI usage). The provider wallet (relayer) is the fee payer; the registrar is an additional signer and the `payer = admin` rent payer for `register_merchant`, so the registrar needs devnet SOL (noted in bring-up). The unit test mocks the whole chain, so it passes regardless of SDK shape; the integration test (Task 8 note) exercises the real call.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm test registrar.service`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add be/src/onchain/registrar.service.ts be/src/onchain/registrar.service.spec.ts be/.env.example
git commit -m "feat(be): RegistrarService — register/reactivate/deactivate via registrar key"
```

---

### Task 3: AdminMerchantsService (list/get/approve/reject)

**Files:** Create `be/src/admin-merchants/admin-merchants.service.ts`, `admin-merchants.service.spec.ts`.

- [ ] **Step 1: Write the failing test** — `admin-merchants.service.spec.ts`

```ts
import { BadRequestException, BadGatewayException, NotFoundException } from '@nestjs/common';
import { AdminMerchantsService } from './admin-merchants.service';

function deps(merchant: any) {
  const prisma = {
    merchant: {
      findMany: jest.fn().mockResolvedValue([merchant]),
      findUnique: jest.fn().mockResolvedValue(merchant),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...merchant, ...data })),
    },
  } as any;
  const registrar = { ensureRegisteredActive: jest.fn().mockResolvedValue('sig123'), deactivate: jest.fn().mockResolvedValue('sigoff') };
  const audit = { record: jest.fn() };
  return { svc: new AdminMerchantsService(prisma, registrar as any, audit as any), prisma, registrar, audit };
}

describe('AdminMerchantsService', () => {
  it('lists by status', async () => {
    const { svc, prisma } = deps({ id: 'm1' });
    await svc.list('pending', 10, 0);
    expect(prisma.merchant.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { approvalStatus: 'pending' } }));
  });

  it('list all omits the status filter', async () => {
    const { svc, prisma } = deps({ id: 'm1' });
    await svc.list('all', 10, 0);
    expect(prisma.merchant.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it('rejects approval when payoutAddress is missing', async () => {
    const { svc } = deps({ id: 'm1', payoutAddress: null, approvalStatus: 'pending' });
    await expect(svc.approve('m1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('approves: registers on-chain then stores status + tx', async () => {
    const { svc, prisma, registrar } = deps({ id: 'm1', payoutAddress: 'PK', approvalStatus: 'pending' });
    const res = await svc.approve('m1');
    expect(registrar.ensureRegisteredActive).toHaveBeenCalled();
    const data = prisma.merchant.update.mock.calls[0][0].data;
    expect(data.approvalStatus).toBe('approved');
    expect(data.onchainRegisterTx).toBe('sig123');
    expect(res.approvalStatus).toBe('approved');
  });

  it('leaves the merchant pending (502) if on-chain registration fails', async () => {
    const { svc, prisma, registrar } = deps({ id: 'm1', payoutAddress: 'PK', approvalStatus: 'pending' });
    registrar.ensureRegisteredActive.mockRejectedValue(new Error('rpc down'));
    await expect(svc.approve('m1')).rejects.toBeInstanceOf(BadGatewayException);
    expect(prisma.merchant.update).not.toHaveBeenCalled();
  });

  it('rejects: sets status + reason and deactivates if registered', async () => {
    const { svc, prisma, registrar } = deps({ id: 'm1', approvalStatus: 'approved', onchainRegisteredAt: new Date() });
    await svc.reject('m1', 'bad docs');
    expect(registrar.deactivate).toHaveBeenCalled();
    const data = prisma.merchant.update.mock.calls[0][0].data;
    expect(data.approvalStatus).toBe('rejected');
    expect(data.rejectionReason).toBe('bad docs');
  });

  it('approve throws 404 for an unknown merchant', async () => {
    const { svc, prisma } = deps(null);
    prisma.merchant.findUnique.mockResolvedValue(null);
    await expect(svc.approve('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test admin-merchants.service`
Expected: FAIL — cannot find `./admin-merchants.service`.

- [ ] **Step 3: Implement `admin-merchants.service.ts`**

```ts
import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RegistrarService } from '../onchain/registrar.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class AdminMerchantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registrar: RegistrarService,
    private readonly audit: AuditService,
  ) {}

  list(status: string, take: number, skip: number) {
    const where = status && status !== 'all' ? { approvalStatus: status } : {};
    return this.prisma.merchant.findMany({ where, take, skip, orderBy: { createdAt: 'desc' } });
  }

  get(id: string) { return this.prisma.merchant.findUnique({ where: { id } }); }

  async approve(id: string) {
    const merchant = await this.prisma.merchant.findUnique({ where: { id } });
    if (!merchant) throw new NotFoundException('Merchant not found');
    if (!merchant.payoutAddress) throw new BadRequestException('Merchant must set a payout address before approval');

    let tx: string;
    try {
      tx = await this.registrar.ensureRegisteredActive({ id: merchant.id, payoutAddress: merchant.payoutAddress });
    } catch (e) {
      throw new BadGatewayException(`On-chain registration failed: ${(e as Error).message}`);
    }
    const updated = await this.prisma.merchant.update({
      where: { id },
      data: { approvalStatus: 'approved', onchainRegisteredAt: new Date(), onchainRegisterTx: tx, rejectionReason: null },
    });
    await this.audit.record({ actor: 'admin', action: 'merchant.approve', target: id, metadata: { tx } });
    return updated;
  }

  async reject(id: string, reason?: string) {
    const merchant = await this.prisma.merchant.findUnique({ where: { id } });
    if (!merchant) throw new NotFoundException('Merchant not found');
    if (merchant.onchainRegisteredAt) {
      try { await this.registrar.deactivate({ id: merchant.id, payoutAddress: merchant.payoutAddress! }); }
      catch (e) { throw new BadGatewayException(`On-chain deactivation failed: ${(e as Error).message}`); }
    }
    const updated = await this.prisma.merchant.update({
      where: { id },
      data: { approvalStatus: 'rejected', rejectionReason: reason ?? null },
    });
    await this.audit.record({ actor: 'admin', action: 'merchant.reject', target: id, metadata: { reason } });
    return updated;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test admin-merchants.service`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add be/src/admin-merchants/admin-merchants.service.ts be/src/admin-merchants/admin-merchants.service.spec.ts
git commit -m "feat(be): AdminMerchantsService approve/reject with atomic on-chain registration"
```

---

### Task 4: Controller + module wiring

**Files:** Create `be/src/admin-merchants/admin-merchants.controller.ts`, `admin-merchants.module.ts`; modify `be/src/app.module.ts`.

- [ ] **Step 1: Implement `admin-merchants.controller.ts`**

```ts
import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AdminMerchantsService } from './admin-merchants.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

class RejectDto { reason?: string; }

@Controller('admin/merchants')
@UseGuards(JwtGuard, RolesGuard)
@Roles('admin')
export class AdminMerchantsController {
  constructor(private readonly merchants: AdminMerchantsService) {}

  @Get()
  list(@Query('status') status = 'pending', @Query('take') take = '50', @Query('skip') skip = '0') {
    return this.merchants.list(status, parseInt(take, 10), parseInt(skip, 10));
  }

  @Get(':id')
  get(@Param('id') id: string) { return this.merchants.get(id); }

  @Post(':id/approve')
  approve(@Param('id') id: string) { return this.merchants.approve(id); }

  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectDto) { return this.merchants.reject(id, dto.reason); }
}
```

- [ ] **Step 2: Implement `admin-merchants.module.ts`** (provides RegistrarService via a factory that parses the registrar key)

```ts
import { Module } from '@nestjs/common';
import { Keypair } from '@solana/web3.js';
import { OnchainModule, NAVY_ONCHAIN } from '../onchain/onchain.module';
import type { NavyOnchain } from '../onchain/onchain.module';
import { RegistrarService } from '../onchain/registrar.service';
import { AdminMerchantsService } from './admin-merchants.service';
import { AdminMerchantsController } from './admin-merchants.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

function parseRegistrar(): Keypair {
  const raw = (process.env.NAVY_ADMIN_SECRET as string).trim();
  if (raw.startsWith('[')) {
    const bytes = Uint8Array.from(JSON.parse(raw));
    try { return Keypair.fromSecretKey(bytes); } catch { return Keypair.fromSeed(bytes.slice(0, 32)); }
  }
  const bs58 = require('bs58');
  return Keypair.fromSecretKey(bs58.decode(raw));
}

@Module({
  imports: [OnchainModule],
  controllers: [AdminMerchantsController],
  providers: [
    {
      provide: RegistrarService,
      inject: [NAVY_ONCHAIN],
      useFactory: (chain: NavyOnchain) => new RegistrarService(chain, parseRegistrar()),
    },
    {
      provide: AdminMerchantsService,
      inject: [PrismaService, RegistrarService, AuditService],
      useFactory: (p: PrismaService, r: RegistrarService, a: AuditService) => new AdminMerchantsService(p, r, a),
    },
  ],
})
export class AdminMerchantsModule {}
```

> `parseRegistrar` mirrors the OnchainModule's `parseSecret` (handles the all-zeros dev placeholder via `fromSeed`). PrismaService/AuditService are global.

- [ ] **Step 3: Wire into `app.module.ts`**

Add `AdminMerchantsModule` to the `AppModule` imports array.

- [ ] **Step 4: Build + full unit suite**

Run: `pnpm build && pnpm test`
Expected: build succeeds; all unit specs pass (foundation + payments + admin-merchants).

- [ ] **Step 5: Commit**

```bash
git add be/src/admin-merchants/admin-merchants.controller.ts be/src/admin-merchants/admin-merchants.module.ts be/src/app.module.ts
git commit -m "feat(be): admin merchants controller + module wiring"
```

---

### Task 5: fe — admin backend fetch helper

**Files:** Create `fe/src/lib/admin-api.ts`, `admin-api.spec.ts`.

- [ ] **Step 1: Write the failing test** — `fe/src/lib/admin-api.spec.ts`

```ts
import { buildAuthHeaders } from './admin-api';

describe('buildAuthHeaders', () => {
  it('sets the Bearer authorization from a token', () => {
    expect(buildAuthHeaders('navy-jwt')).toEqual({ Authorization: 'Bearer navy-jwt', 'Content-Type': 'application/json' });
  });
  it('throws when there is no token', () => {
    expect(() => buildAuthHeaders(undefined)).toThrow(/unauthenticated/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (in fe): `pnpm test admin-api`
Expected: FAIL — cannot find `./admin-api`.

- [ ] **Step 3: Implement `fe/src/lib/admin-api.ts`**

```ts
import { cookies } from 'next/headers';
import { ACCESS_COOKIE } from './session';
import { serverEnv } from './env';

export function buildAuthHeaders(token: string | undefined): Record<string, string> {
  if (!token) throw new Error('unauthenticated: no admin session token');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

/** Server-side fetch to the Navy backend using the admin session cookie as Bearer. */
export async function adminBackendFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  return fetch(`${serverEnv().navyApiUrl}${path}`, { ...init, headers: { ...buildAuthHeaders(token), ...(init?.headers ?? {}) }, cache: 'no-store' });
}
```

- [ ] **Step 4: Run to verify it passes**

Run (in fe): `pnpm test admin-api`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add fe/src/lib/admin-api.ts fe/src/lib/admin-api.spec.ts
git commit -m "feat(fe): adminBackendFetch helper (cookie -> Bearer)"
```

---

### Task 6: fe — merchants list page

**Files:** Create `fe/src/app/admin/merchants/page.tsx`.

- [ ] **Step 1: Implement `page.tsx`** (server component)

```tsx
import Link from 'next/link';
import { adminBackendFetch } from '@/lib/admin-api';

interface Merchant { id: string; email: string; businessName: string; approvalStatus: string; payoutAddress: string | null; onchainRegisteredAt: string | null; }

export default async function MerchantsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const status = (await searchParams).status ?? 'pending';
  const res = await adminBackendFetch(`/admin/merchants?status=${encodeURIComponent(status)}`);
  const merchants: Merchant[] = res.ok ? await res.json() : [];

  return (
    <main style={{ padding: 32, fontFamily: 'sans-serif' }}>
      <h1>Merchants</h1>
      <nav style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        {['pending', 'approved', 'rejected', 'all'].map((s) => (
          <Link key={s} href={`/admin/merchants?status=${s}`} style={{ fontWeight: s === status ? 700 : 400 }}>{s}</Link>
        ))}
      </nav>
      <table cellPadding={8} style={{ borderCollapse: 'collapse' }}>
        <thead><tr><th align="left">Business</th><th align="left">Email</th><th align="left">Status</th><th align="left">Payout</th><th /></tr></thead>
        <tbody>
          {merchants.map((m) => (
            <tr key={m.id} style={{ borderTop: '1px solid #ddd' }}>
              <td>{m.businessName}</td><td>{m.email}</td><td>{m.approvalStatus}</td>
              <td>{m.payoutAddress ? '✓' : '—'}</td>
              <td><Link href={`/admin/merchants/${m.id}`}>review</Link></td>
            </tr>
          ))}
          {merchants.length === 0 && <tr><td colSpan={5}>No merchants.</td></tr>}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

Run (in fe): `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add fe/src/app/admin/merchants/page.tsx
git commit -m "feat(fe): admin merchants list page"
```

---

### Task 7: fe — merchant detail + approve/reject

**Files:** Create `fe/src/app/admin/merchants/[id]/page.tsx`, `Actions.tsx`, and the two route handlers.

- [ ] **Step 1: Implement the approve route handler** — `fe/src/app/api/admin/merchants/[id]/approve/route.ts`

```ts
import { NextResponse } from 'next/server';
import { adminBackendFetch } from '@/lib/admin-api';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const res = await adminBackendFetch(`/admin/merchants/${id}/approve`, { method: 'POST' });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
```

- [ ] **Step 2: Implement the reject route handler** — `fe/src/app/api/admin/merchants/[id]/reject/route.ts`

```ts
import { NextRequest, NextResponse } from 'next/server';
import { adminBackendFetch } from '@/lib/admin-api';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { reason } = await req.json().catch(() => ({ reason: undefined }));
  const res = await adminBackendFetch(`/admin/merchants/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
```

- [ ] **Step 3: Implement `Actions.tsx`** (client buttons)

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Actions({ id, canApprove }: { id: string; canApprove: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function call(action: 'approve' | 'reject', reason?: string) {
    setBusy(true); setError('');
    const res = await fetch(`/api/admin/merchants/${id}/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: action === 'reject' ? JSON.stringify({ reason }) : undefined,
    });
    setBusy(false);
    if (res.ok) router.refresh();
    else setError((await res.json().catch(() => ({})))?.error ?? `Failed (${res.status})`);
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16 }}>
      <button disabled={!canApprove || busy} onClick={() => call('approve')} title={canApprove ? '' : 'Merchant must set a payout address first'}>
        Approve
      </button>
      <button disabled={busy} onClick={() => call('reject', prompt('Rejection reason?') ?? undefined)}>Reject</button>
      {error && <span style={{ color: 'crimson' }}>{error}</span>}
    </div>
  );
}
```

- [ ] **Step 4: Implement the detail page** — `fe/src/app/admin/merchants/[id]/page.tsx`

```tsx
import Link from 'next/link';
import { adminBackendFetch } from '@/lib/admin-api';
import Actions from './Actions';

export default async function MerchantDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await adminBackendFetch(`/admin/merchants/${id}`);
  const m = res.ok ? await res.json() : null;
  if (!m) return <main style={{ padding: 32 }}><p>Merchant not found.</p></main>;

  return (
    <main style={{ padding: 32, fontFamily: 'sans-serif', maxWidth: 640 }}>
      <p><Link href="/admin/merchants">← merchants</Link></p>
      <h1>{m.businessName}</h1>
      <dl>
        <dt>Email</dt><dd>{m.email}</dd>
        <dt>Status</dt><dd><b>{m.approvalStatus}</b></dd>
        <dt>Payout address</dt><dd>{m.payoutAddress ?? <i>not set</i>}</dd>
        <dt>On-chain tx</dt><dd>{m.onchainRegisterTx ? <a href={`https://explorer.solana.com/tx/${m.onchainRegisterTx}?cluster=devnet`} target="_blank">{m.onchainRegisterTx.slice(0, 16)}…</a> : '—'}</dd>
        {m.rejectionReason && (<><dt>Rejection reason</dt><dd>{m.rejectionReason}</dd></>)}
      </dl>
      <Actions id={m.id} canApprove={!!m.payoutAddress} />
    </main>
  );
}
```

- [ ] **Step 5: Typecheck + build**

Run (in fe): `pnpm exec tsc --noEmit && pnpm build`
Expected: no type errors; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add fe/src/app/admin/merchants/[id] fe/src/app/api/admin/merchants
git commit -m "feat(fe): merchant detail page with approve/reject actions"
```

---

### Task 8: fe — dashboard link + final verification + integration note

**Files:** Modify `fe/src/app/admin/page.tsx`.

- [ ] **Step 1: Add a link to the admin dashboard** — in `fe/src/app/admin/page.tsx`, add inside the `<main>` (before `<LogoutButton />`):

```tsx
      <p><a href="/admin/merchants">Manage merchants →</a></p>
```

- [ ] **Step 2: Typecheck + build (fe)**

Run (in fe): `pnpm exec tsc --noEmit && pnpm build`
Expected: no errors; build succeeds.

- [ ] **Step 3: Full unit suite (be + fe)**

Run (in be): `pnpm test` — all pass (foundation + payments + admin-merchants).
Run (in fe): `pnpm test` — all pass (foundation + admin-api).

- [ ] **Step 4: Record the integration + bring-up note** — append to `be/scripts/gateway-bringup.md`:

```markdown

## Admin registrar (sub-project 4)
- NAVY_ADMIN_SECRET must be the program's admin authority keypair (the one that ran `init-config`), as a 64-byte JSON array. Fund it with devnet SOL (it pays rent for register_merchant): `solana airdrop 2 <registrarPubkey> --url devnet`.
- Approving a merchant in the admin UI calls register_merchant (or reactivates) on-chain automatically.
- Integration check (localnet): with the program deployed + config initialized, set NAVY_ADMIN_SECRET to the config admin, create a merchant with a payoutAddress, POST /admin/merchants/:id/approve, then assert the on-chain Merchant PDA exists and active=true (mirror onchain/tests/navy-payments.merchant.ts).
```

- [ ] **Step 5: Commit**

```bash
git add fe/src/app/admin/page.tsx be/scripts/gateway-bringup.md
git commit -m "feat(fe): link merchants admin page; document registrar bring-up"
```

---

## Self-Review

**Spec coverage (spec §→ task):**
- §2 schema additions → Task 1; approval API (list/get/approve/reject, admin-gated) → Tasks 3 (service), 4 (controller+guards).
- §3 RegistrarService (register-or-reactivate, deactivate, payout derivation matching the gateway) + registrar key → Task 2.
- §4 atomic approval (register first, fail→pending 502) → Task 3 (`approve` try/catch order; test asserts no update on failure).
- §5 fe pages + route handlers + dashboard link → Tasks 5 (auth helper), 6 (list), 7 (detail + approve/reject proxies), 8 (link).
- §6 error handling (409 no payout, 404, 502 on-chain fail, reactivate path, 403 non-admin) → Tasks 3, 4 (guards), 2.
- §7 testing (unit for precondition/decision/reject + route-handler auth; integration localnet) → Tasks 2, 3, 5 + Task 8 note.

**Placeholder scan:** Pure-logic tasks (2, 3, 5) ship complete code + real Jest tests. UI/controller/route-handler tasks ship complete code verified by `tsc`/`build`. The integration check is a documented note (needs a live validator) in Task 8 — consistent with the gateway plan's approach.

**Type consistency:** `RegistrarMerchant{id,payoutAddress}` (Task 2) is what `AdminMerchantsService.approve/reject` pass (Task 3). `ensureRegisteredActive`/`deactivate` signatures (2) match their calls (3). `NavyOnchain` fields (`programId`, `usdcMint`, `connection`, `program`) used in Task 2 match the foundation's OnchainModule. `merchantPda`/`configPda` (payments-client) used in 2. `adminBackendFetch`/`buildAuthHeaders` (5) used in 6, 7. Merchant JSON shape (approvalStatus/payoutAddress/onchainRegisterTx/rejectionReason) consistent across backend responses and fe pages.

**Known follow-ups (recorded):** the registrar key is a hot admin authority on devnet — mainnet hardening (multisig / dedicated registrar role) is deferred (spec §8); the localnet integration test is a documented manual gate; the registrar needs its own devnet SOL for rent (bring-up note).
