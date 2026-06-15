# Navy Merchant Panel (Orders Dashboard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give merchants a browser dashboard to create invoices (QR) and track their orders' live status, via session-authenticated endpoints that reuse the gateway's `OrdersService`.

**Architecture:** Backend extends `OrdersService` with merchant-scoped methods and adds a session-guarded `MerchantOrdersController` (`/merchant/orders`). The fe adds merchant order pages (create→QR, list, detail) that poll the backend through Next route handlers using the merchant session cookie. Pure logic (merchant scoping, approval precondition, the session fetch helper) is TDD'd; pages are typecheck/build-verified.

**Tech Stack:** Nest 11 · Prisma 7 · Next.js 16 (App Router) · React 19 · Jest.

**Scope:** Sub-project 5 of Navy. Implements `docs/superpowers/specs/2026-06-16-navy-merchant-panel-design.md`. Reuses the gateway `OrdersService`, foundation merchant auth, and the admin panel's session→Bearer fetch pattern.

---

## File Structure

```
be/
├── src/payments/orders.service.ts            # MODIFY: + createForMerchant/listForMerchant/getForMerchant
├── src/payments/orders.service.spec.ts        # MODIFY: + new tests
├── src/payments/merchant-orders.controller.ts # NEW
└── src/payments/payments.module.ts            # MODIFY: register the controller
fe/
├── src/lib/session-backend.ts                 # NEW: sessionBackendFetch + buildAuthHeaders (generalized)
├── src/lib/session-backend.test.ts            # NEW
├── src/lib/admin-api.ts                        # MODIFY: re-export from session-backend
├── src/app/api/merchant/orders/route.ts        # NEW: POST create, GET list
├── src/app/api/merchant/orders/[id]/route.ts   # NEW: GET one
├── src/app/merchant/orders/page.tsx            # NEW: list (polling)
├── src/app/merchant/orders/new/page.tsx        # NEW: create form -> QR
├── src/app/merchant/orders/[id]/page.tsx        # NEW: detail (polling)
└── src/app/merchant/page.tsx                    # MODIFY: Orders section
```

---

## Conventions

- be tasks from `/home/khoa/Desktop/uni/be`; fe tasks from `/home/khoa/Desktop/uni/fe`. Tests: `pnpm test <pattern>`. Postgres: `docker compose up -d` (be).
- Commit per task. Git identity fallback: `git -c user.name=Navy -c user.email=capydata.xyz@gmail.com commit ...`.
- Reuse: `OrdersService` (be/src/payments/orders.service.ts, `create(merchantId,{amount,reference,callbackUrl?,expiresInSec?})`), `JwtGuard`/`RolesGuard`/`Roles`, `PrismaService`; fe `ACCESS_COOKIE` (session.ts), `serverEnv()`.

---

### Task 1: OrdersService — merchant-scoped methods

**Files:** Modify `be/src/payments/orders.service.ts`, `orders.service.spec.ts`.

- [ ] **Step 1: Add failing tests** to `orders.service.spec.ts` (inside the existing describe)

```ts
import { ConflictException, NotFoundException } from '@nestjs/common';

describe('OrdersService merchant-scoped', () => {
  function make(merchant: any, orders: any[] = []) {
    const prisma = {
      merchant: { findUnique: jest.fn().mockResolvedValue(merchant) },
      order: {
        create: jest.fn().mockResolvedValue({ id: 'o1', amount: 1000000n, status: 'awaiting_payment', expiresAt: new Date() }),
        findMany: jest.fn().mockResolvedValue(orders),
        findFirst: jest.fn().mockResolvedValue(orders[0] ?? null),
      },
    } as any;
    const audit = { record: jest.fn() } as any;
    return { svc: new OrdersService(prisma, audit, 'navy://pay', 100), prisma };
  }

  it('createForMerchant rejects an unapproved merchant with 409', async () => {
    const { svc } = make({ id: 'm1', approvalStatus: 'pending' });
    await expect(svc.createForMerchant('m1', { amount: 1000000n, reference: 'R' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('createForMerchant creates when approved', async () => {
    const { svc, prisma } = make({ id: 'm1', approvalStatus: 'approved' });
    const res = await svc.createForMerchant('m1', { amount: 1000000n, reference: 'R' });
    expect(prisma.order.create).toHaveBeenCalled();
    expect(res.orderId).toBe('o1');
  });

  it('listForMerchant scopes by merchantId and serializes amount to string', async () => {
    const row = { id: 'o1', reference: 'R', amount: 1000000n, status: 'paid', createdAt: new Date(), paidAt: new Date() };
    const { svc, prisma } = make({ id: 'm1', approvalStatus: 'approved' }, [row]);
    const out = await svc.listForMerchant('m1', { take: 50, skip: 0 });
    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { merchantId: 'm1' } }));
    expect(out[0].amount).toBe('1000000');
  });

  it('listForMerchant adds a status filter when provided', async () => {
    const { svc, prisma } = make({ id: 'm1', approvalStatus: 'approved' }, []);
    await svc.listForMerchant('m1', { status: 'paid', take: 50, skip: 0 });
    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { merchantId: 'm1', status: 'paid' } }));
  });

  it('getForMerchant returns the order serialized when owned', async () => {
    const row = { id: 'o1', merchantId: 'm1', reference: 'R', amount: 1000000n, status: 'awaiting_payment', createdAt: new Date(), paidAt: null, payer: null, txSignature: null };
    const { svc } = make({ id: 'm1', approvalStatus: 'approved' }, [row]);
    const out = await svc.getForMerchant('m1', 'o1');
    expect(out!.amount).toBe('1000000');
  });

  it('getForMerchant throws 404 when not owned/missing', async () => {
    const { svc, prisma } = make({ id: 'm1', approvalStatus: 'approved' }, []);
    prisma.order.findFirst.mockResolvedValue(null);
    await expect(svc.getForMerchant('m1', 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test orders.service`
Expected: FAIL — `createForMerchant`/`listForMerchant`/`getForMerchant` undefined.

- [ ] **Step 3: Add the methods to `orders.service.ts`** (append inside the class; add the imports)

Add to the imports at the top:
```ts
import { ConflictException, NotFoundException } from '@nestjs/common';
```
Add a serializer + the three methods inside the `OrdersService` class:
```ts
  private serialize(o: any) {
    return {
      id: o.id, reference: o.reference, amount: o.amount.toString(), status: o.status,
      createdAt: o.createdAt, paidAt: o.paidAt ?? null, payer: o.payer ?? null, txSignature: o.txSignature ?? null,
    };
  }

  async createForMerchant(merchantId: string, input: CreateOrderInput) {
    const merchant = await this.prisma.merchant.findUnique({ where: { id: merchantId } });
    if (!merchant || merchant.approvalStatus !== 'approved') {
      throw new ConflictException('Merchant is not approved');
    }
    return this.create(merchantId, input);
  }

  async listForMerchant(merchantId: string, opts: { status?: string; take: number; skip: number }) {
    const where: any = { merchantId };
    if (opts.status && opts.status !== 'all') where.status = opts.status;
    const rows = await this.prisma.order.findMany({ where, take: opts.take, skip: opts.skip, orderBy: { createdAt: 'desc' } });
    return rows.map((o) => this.serialize(o));
  }

  async getForMerchant(merchantId: string, id: string) {
    const o = await this.prisma.order.findFirst({ where: { id, merchantId } });
    if (!o) throw new NotFoundException('Order not found');
    return this.serialize(o);
  }
```
(`CreateOrderInput` is already exported from this file; `create` already exists.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test orders.service`
Expected: PASS (existing + 6 new).

- [ ] **Step 5: Commit**

```bash
git add be/src/payments/orders.service.ts be/src/payments/orders.service.spec.ts
git commit -m "feat(be): merchant-scoped order methods (create/list/get)"
```

---

### Task 2: MerchantOrdersController + module wiring

**Files:** Create `be/src/payments/merchant-orders.controller.ts`; modify `be/src/payments/payments.module.ts`.

- [ ] **Step 1: Implement `merchant-orders.controller.ts`**

```ts
import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

class CreateOrderDto { amount!: string; reference!: string; expiresInSec?: number; }

@Controller('merchant/orders')
@UseGuards(JwtGuard, RolesGuard)
@Roles('merchant')
export class MerchantOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  create(@Req() req: any, @Body() dto: CreateOrderDto) {
    return this.orders.createForMerchant(req.user.sub, {
      amount: BigInt(dto.amount), reference: dto.reference, expiresInSec: dto.expiresInSec,
    });
  }

  @Get()
  list(@Req() req: any, @Query('status') status?: string, @Query('take') take = '50', @Query('skip') skip = '0') {
    return this.orders.listForMerchant(req.user.sub, { status, take: parseInt(take, 10), skip: parseInt(skip, 10) });
  }

  @Get(':id')
  get(@Req() req: any, @Param('id') id: string) {
    return this.orders.getForMerchant(req.user.sub, id);
  }
}
```

- [ ] **Step 2: Register the controller in `payments.module.ts`**

Add `MerchantOrdersController` to the `controllers` array of `PaymentsModule` (import it at top). `OrdersService` is already provided there.

- [ ] **Step 3: Build + full unit suite**

Run: `pnpm build && pnpm test`
Expected: build succeeds; all unit specs pass.

- [ ] **Step 4: Commit**

```bash
git add be/src/payments/merchant-orders.controller.ts be/src/payments/payments.module.ts
git commit -m "feat(be): session-authenticated merchant orders controller"
```

---

### Task 3: fe — generalized sessionBackendFetch

**Files:** Create `fe/src/lib/session-backend.ts`, `session-backend.test.ts`; modify `fe/src/lib/admin-api.ts`.

- [ ] **Step 1: Write the failing test** — `fe/src/lib/session-backend.test.ts`

```ts
import { buildAuthHeaders } from './session-backend';

describe('buildAuthHeaders', () => {
  it('sets Bearer from the session token', () => {
    expect(buildAuthHeaders('jwt')).toEqual({ Authorization: 'Bearer jwt', 'Content-Type': 'application/json' });
  });
  it('throws without a token', () => {
    expect(() => buildAuthHeaders(undefined)).toThrow(/unauthenticated/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (fe): `pnpm test session-backend`
Expected: FAIL — cannot find `./session-backend`.

- [ ] **Step 3: Implement `fe/src/lib/session-backend.ts`**

```ts
import { cookies } from 'next/headers';
import { ACCESS_COOKIE } from './session';
import { serverEnv } from './env';

export function buildAuthHeaders(token: string | undefined): Record<string, string> {
  if (!token) throw new Error('unauthenticated: no session token');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

/** Server-side fetch to the Navy backend using the session cookie as Bearer (any role). */
export async function sessionBackendFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  return fetch(`${serverEnv().navyApiUrl}${path}`, { ...init, headers: { ...buildAuthHeaders(token), ...(init?.headers ?? {}) }, cache: 'no-store' });
}
```

- [ ] **Step 4: Re-point `fe/src/lib/admin-api.ts`** to the generalized helper (keep its named exports for the admin pages)

```ts
export { buildAuthHeaders, sessionBackendFetch } from './session-backend';
export { sessionBackendFetch as adminBackendFetch } from './session-backend';
```

- [ ] **Step 5: Run tests + typecheck**

Run (fe): `pnpm test session-backend && pnpm exec tsc --noEmit`
Expected: PASS (2 tests); no type errors (admin pages still import `adminBackendFetch`).

> If the old `fe/src/lib/admin-api.spec.ts`/`admin-api.test.ts` imported `buildAuthHeaders` from `./admin-api`, it still resolves via the re-export — leave it. Both test files pass.

- [ ] **Step 6: Commit**

```bash
git add fe/src/lib/session-backend.ts fe/src/lib/session-backend.test.ts fe/src/lib/admin-api.ts
git commit -m "feat(fe): generalize session->Bearer fetch as sessionBackendFetch"
```

---

### Task 4: fe — merchant order route handlers

**Files:** Create `fe/src/app/api/merchant/orders/route.ts`, `fe/src/app/api/merchant/orders/[id]/route.ts`.

- [ ] **Step 1: Implement `fe/src/app/api/merchant/orders/route.ts`** (POST create, GET list)

```ts
import { NextRequest, NextResponse } from 'next/server';
import { sessionBackendFetch } from '@/lib/session-backend';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const res = await sessionBackendFetch('/merchant/orders', { method: 'POST', body: JSON.stringify(body) });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

export async function GET(req: NextRequest) {
  const qs = req.nextUrl.search; // includes ?status=...
  const res = await sessionBackendFetch(`/merchant/orders${qs}`);
  return NextResponse.json(await res.json().catch(() => ([])), { status: res.status });
}
```

- [ ] **Step 2: Implement `fe/src/app/api/merchant/orders/[id]/route.ts`** (GET one)

```ts
import { NextResponse } from 'next/server';
import { sessionBackendFetch } from '@/lib/session-backend';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const res = await sessionBackendFetch(`/merchant/orders/${id}`);
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
```

- [ ] **Step 3: Typecheck**

Run (fe): `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add fe/src/app/api/merchant/orders
git commit -m "feat(fe): merchant order route handlers (create/list/get)"
```

---

### Task 5: fe — create-invoice page (form → QR)

**Files:** Create `fe/src/app/merchant/orders/new/page.tsx`.

- [ ] **Step 1: Implement `new/page.tsx`** (client component)

```tsx
'use client';
import { useState } from 'react';
import Link from 'next/link';

export default function NewOrder() {
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [expiresInSec, setExpiresInSec] = useState('900');
  const [result, setResult] = useState<{ orderId: string; qr: string; payUrl: string } | null>(null);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setResult(null);
    // amount is USDC with 6 decimals; convert a decimal string to base units.
    const baseUnits = BigInt(Math.round(parseFloat(amount || '0') * 1_000_000)).toString();
    if (baseUnits === '0') { setError('Enter an amount greater than 0'); return; }
    const res = await fetch('/api/merchant/orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: baseUnits, reference, expiresInSec: parseInt(expiresInSec, 10) }),
    });
    const body = await res.json();
    if (res.ok) setResult({ orderId: body.orderId, qr: body.qr, payUrl: body.payUrl });
    else setError(body.error ?? (res.status === 409 ? 'Your account is not approved yet' : `Failed (${res.status})`));
  }

  return (
    <main style={{ padding: 32, maxWidth: 480, fontFamily: 'sans-serif' }}>
      <p><Link href="/merchant/orders">← orders</Link></p>
      <h1>New invoice</h1>
      {!result && (
        <form onSubmit={submit} style={{ display: 'grid', gap: 8 }}>
          <input placeholder="amount (USDC)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <input placeholder="reference / order id" value={reference} onChange={(e) => setReference(e.target.value)} />
          <input placeholder="expires in seconds" value={expiresInSec} onChange={(e) => setExpiresInSec(e.target.value)} />
          <button type="submit">Create invoice</button>
          {error && <p style={{ color: 'crimson' }}>{error}</p>}
        </form>
      )}
      {result && (
        <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
          <p>Invoice <code>{result.orderId}</code> created. Show this QR to your customer:</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={result.qr} alt="payment QR" width={220} height={220} />
          <p style={{ wordBreak: 'break-all' }}><code>{result.payUrl}</code></p>
          <Link href={`/merchant/orders/${result.orderId}`}>Track this order →</Link>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

Run (fe): `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add fe/src/app/merchant/orders/new/page.tsx
git commit -m "feat(fe): create-invoice page rendering the payment QR"
```

---

### Task 6: fe — orders list page (polling)

**Files:** Create `fe/src/app/merchant/orders/page.tsx`.

- [ ] **Step 1: Implement `orders/page.tsx`** (client component, polls every 4s)

```tsx
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Order { id: string; reference: string; amount: string; status: string; createdAt: string; }

export default function Orders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [status, setStatus] = useState('all');

  useEffect(() => {
    let active = true;
    const load = async () => {
      const res = await fetch(`/api/merchant/orders?status=${status}`);
      if (active && res.ok) setOrders(await res.json());
    };
    load();
    const t = setInterval(load, 4000);
    return () => { active = false; clearInterval(t); };
  }, [status]);

  return (
    <main style={{ padding: 32, fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Orders</h1>
        <Link href="/merchant/orders/new"><button>New invoice</button></Link>
      </div>
      <nav style={{ display: 'flex', gap: 12, margin: '12px 0' }}>
        {['all', 'awaiting_payment', 'paid', 'expired'].map((s) => (
          <button key={s} onClick={() => setStatus(s)} style={{ fontWeight: s === status ? 700 : 400 }}>{s}</button>
        ))}
      </nav>
      <table cellPadding={8} style={{ borderCollapse: 'collapse' }}>
        <thead><tr><th align="left">Reference</th><th align="left">Amount (USDC)</th><th align="left">Status</th><th /></tr></thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} style={{ borderTop: '1px solid #ddd' }}>
              <td>{o.reference}</td>
              <td>{(Number(o.amount) / 1_000_000).toFixed(2)}</td>
              <td>{o.status}</td>
              <td><Link href={`/merchant/orders/${o.id}`}>view</Link></td>
            </tr>
          ))}
          {orders.length === 0 && <tr><td colSpan={4}>No orders.</td></tr>}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

Run (fe): `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add fe/src/app/merchant/orders/page.tsx
git commit -m "feat(fe): merchant orders list with interval polling"
```

---

### Task 7: fe — order detail page (polling)

**Files:** Create `fe/src/app/merchant/orders/[id]/page.tsx`.

- [ ] **Step 1: Implement `[id]/page.tsx`** (client component; polls until terminal)

```tsx
'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';

interface Order { id: string; reference: string; amount: string; status: string; payer: string | null; txSignature: string | null; }
const TERMINAL = ['paid', 'expired', 'failed'];

export default function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [order, setOrder] = useState<Order | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const res = await fetch(`/api/merchant/orders/${id}`);
      if (!active) return;
      if (res.ok) {
        const o: Order = await res.json();
        setOrder(o);
        if (TERMINAL.includes(o.status)) clearInterval(t);
      }
    };
    load();
    const t = setInterval(load, 4000);
    return () => { active = false; clearInterval(t); };
  }, [id]);

  if (!order) return <main style={{ padding: 32 }}><p>Loading…</p></main>;
  return (
    <main style={{ padding: 32, fontFamily: 'sans-serif', maxWidth: 560 }}>
      <p><Link href="/merchant/orders">← orders</Link></p>
      <h1>Order {order.reference}</h1>
      <dl>
        <dt>Amount (USDC)</dt><dd>{(Number(order.amount) / 1_000_000).toFixed(2)}</dd>
        <dt>Status</dt><dd><b>{order.status}</b></dd>
        <dt>Payer</dt><dd>{order.payer ?? '—'}</dd>
        <dt>Tx</dt><dd>{order.txSignature ? <a href={`https://explorer.solana.com/tx/${order.txSignature}?cluster=devnet`} target="_blank">{order.txSignature.slice(0, 16)}…</a> : '—'}</dd>
      </dl>
    </main>
  );
}
```

> `use(params)` unwraps the Next 16 params Promise in a client component. If the installed React/Next typing prefers `React.use`, import `use` from `react` (shown). Verify with `tsc`.

- [ ] **Step 2: Typecheck + build**

Run (fe): `pnpm exec tsc --noEmit && pnpm build`
Expected: no errors; build succeeds.

- [ ] **Step 3: Commit**

```bash
git add fe/src/app/merchant/orders/[id]/page.tsx
git commit -m "feat(fe): merchant order detail with live polling"
```

---

### Task 8: fe — dashboard Orders section + final verification

**Files:** Modify `fe/src/app/merchant/page.tsx`.

- [ ] **Step 1: Add an Orders section** to `fe/src/app/merchant/page.tsx` — insert this as the FIRST `<section>` inside the `<main>` (before the existing "API credentials" section), and add `import Link from 'next/link';` at the top if absent:

```tsx
      <section style={{ marginBottom: 24 }}>
        <h2>Orders</h2>
        <p>Create invoices and track payments.</p>
        <Link href="/merchant/orders"><button>Open orders</button></Link>
      </section>
```

- [ ] **Step 2: Typecheck + build (fe)**

Run (fe): `pnpm exec tsc --noEmit && pnpm build`
Expected: no errors; build succeeds.

- [ ] **Step 3: Full suites (be + fe)**

Run (be): `docker compose up -d && pnpm test` — all pass.
Run (fe): `pnpm test` — all pass.

- [ ] **Step 4: Commit**

```bash
git add fe/src/app/merchant/page.tsx
git commit -m "feat(fe): add Orders section to the merchant dashboard"
```

---

## Self-Review

**Spec coverage (spec §→ task):**
- §2 session order endpoints (create w/ approval `409`, list, get ownership `404`) → Tasks 1 (service), 2 (controller + guards).
- §3 fe pages (list-poll, new→QR, detail-poll) + dashboard reorg + route handlers + `sessionBackendFetch` → Tasks 3 (helper), 4 (handlers), 5 (new), 6 (list), 7 (detail), 8 (dashboard).
- §4 data flow → exercised by Tasks 5–7 (create→QR; detail polls to `paid`).
- §5 error handling (409 unapproved, 400 zero, 404 not-owned, 401 redirect) → Tasks 1, 2 (guard), 5 (client surfaces 409).
- §6 testing (merchant scoping, approval precondition, sessionBackendFetch) → Tasks 1, 3.

**Placeholder scan:** Pure-logic tasks (1, 3) ship complete code + real tests. Controller + pages ship complete code verified by `tsc`/`build`. **BigInt serialization** is handled (the `serialize()` helper maps `amount` to a string so Nest can JSON-encode order rows — without it, returning a raw `Order` with a `BigInt amount` throws "Do not know how to serialize a BigInt"). No TBD/placeholder steps.

**Type consistency:** `createForMerchant`/`listForMerchant`/`getForMerchant` signatures (Task 1) match the controller calls (Task 2). `CreateOrderInput` (existing OrdersService export) used in Task 1. `serialize()` output shape (`{id,reference,amount:string,status,createdAt,paidAt,payer,txSignature}`) matches the fe `Order` interfaces (Tasks 6, 7). `sessionBackendFetch`/`buildAuthHeaders` (Task 3) used by the route handlers (4) and re-exported for admin pages. Route-handler paths (`/api/merchant/orders[...]`) match the fe fetch calls (5, 6, 7).

**Known follow-ups (recorded):** polling is client-interval (spec chose it over manual; SSE deferred); the create form converts a decimal USDC string to 6-decimal base units client-side (a shared money util could be factored later); list/detail amounts are divided by 1e6 for display.
