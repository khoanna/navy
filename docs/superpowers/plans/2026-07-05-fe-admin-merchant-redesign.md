# FE Admin + Merchant Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-house the entire `fe/` admin + merchant app in web-wallet's deep-ocean design system as a desktop sidebar dashboard, and add two read-only aggregate endpoints in `be/` to feed real stat-card + trend-chart Overview pages.

**Architecture:** Port web-wallet's token layer + primitives into `fe/src/ui` (inline-style tokens, no Tailwind); build new desktop primitives (`AppShell`, `Sidebar`, `TopBar`, `StatCard`, `TrendChart`, `DataTable`, `AuthCard`); keep all existing data plumbing (session-proxy, 4s polling) unchanged; add `GET /merchant/stats` and `GET /admin/stats` (Prisma aggregations, no schema change, money as strings).

**Tech Stack:** Next.js 16 (App Router) + React 19 (fe), Nest.js 11 + Prisma 7 (be), Jest. No new runtime deps. Charts are hand-rolled SVG.

**Spec:** `docs/superpowers/specs/2026-07-05-fe-admin-merchant-redesign-design.md`

**Conventions to honor (from CLAUDE.md):**
- Money is `BigInt` in Prisma — serialize to **string** before returning from Nest.
- Keep non-UI logic in plain-TS modules (`fe/src/lib/**`, unit-tested); screens stay thin, verified by `tsc` + `next build`.
- `fe/` jest only runs `src/lib/**/*.test.ts`. `be/` jest runs `*.spec.ts` colocated with source.
- `fe/` gate is `pnpm exec tsc --noEmit` **and** `pnpm build` (build catches bundle issues tsc misses).
- Order status strings: `created`, `awaiting_payment`, `paid`, `expired`, `failed`. Merchant `approvalStatus`: `pending`, `approved`, `rejected`.

---

## File Structure

### Backend (`be/`)
- Create `be/src/common/stats.util.ts` — pure daily-series zero-fill helper (+ `.spec.ts`).
- Create `be/src/merchant/merchant-stats.service.ts` — per-merchant aggregation (+ `.spec.ts`).
- Modify `be/src/merchant/merchant.controller.ts` — add `GET merchant/stats`.
- Modify `be/src/merchant/merchant.module.ts` — provide `MerchantStatsService`.
- Create `be/src/admin-merchants/admin-stats.service.ts` — platform aggregation (+ `.spec.ts`).
- Create `be/src/admin-merchants/admin-stats.controller.ts` — `GET admin/stats`.
- Modify `be/src/admin-merchants/admin-merchants.module.ts` — register both.

### Frontend design system (`fe/src/ui/`)
- Copy from web-wallet: `theme.ts`, `Text.tsx`, `Card.tsx`, `Button.tsx`, `Bits.tsx`, `Icon.tsx`.
- Create: `AppShell.tsx`, `Sidebar.tsx`, `TopBar.tsx`, `StatCard.tsx`, `TrendChart.tsx`, `DataTable.tsx`, `AuthCard.tsx`.
- Modify `fe/src/app/globals.css` — aurora background, resets, animations.

### Frontend logic (`fe/src/lib/dashboard/`)
- `chart.ts` (+ `.test.ts`) — SVG geometry from a series.
- `stats.ts` (+ `.test.ts`) — base-unit→display money formatting, delta.
- `status.ts` (+ `.test.ts`) — status → Pill tone + label.

### Frontend data routes (`fe/src/app/api/`)
- `merchant/stats/route.ts`, `admin/stats/route.ts` — proxy via `sessionBackendFetch`.

### Frontend pages (rewrite presentation, keep data logic)
- `admin/page.tsx`, `admin/merchants/page.tsx`, `admin/merchants/[id]/page.tsx`, `admin/login/page.tsx`
- `merchant/page.tsx`, `merchant/orders/page.tsx`, `merchant/orders/new/page.tsx`, `merchant/orders/[id]/page.tsx`, `merchant/login/page.tsx`

---

## PHASE A — Backend aggregate endpoints

### Task 1: Pure daily-series helper

**Files:**
- Create: `be/src/common/stats.util.ts`
- Test: `be/src/common/stats.util.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// be/src/common/stats.util.spec.ts
import { buildDailySeries } from './stats.util';

describe('buildDailySeries', () => {
  const now = new Date('2026-07-05T12:00:00.000Z');

  it('returns one zero-filled bucket per day, oldest first, amounts as strings', () => {
    const series = buildDailySeries([], now, 3);
    expect(series).toEqual([
      { date: '2026-07-03', amount: '0' },
      { date: '2026-07-04', amount: '0' },
      { date: '2026-07-05', amount: '0' },
    ]);
  });

  it('sums amounts into the UTC day bucket of paidAt', () => {
    const rows = [
      { paidAt: new Date('2026-07-04T09:00:00Z'), amount: 100n },
      { paidAt: new Date('2026-07-04T23:59:00Z'), amount: 250n },
      { paidAt: new Date('2026-07-05T01:00:00Z'), amount: 400n },
    ];
    const series = buildDailySeries(rows, now, 3);
    expect(series.find((p) => p.date === '2026-07-04')!.amount).toBe('350');
    expect(series.find((p) => p.date === '2026-07-05')!.amount).toBe('400');
  });

  it('ignores rows with null paidAt or dates outside the window', () => {
    const rows = [
      { paidAt: null, amount: 999n },
      { paidAt: new Date('2026-06-01T00:00:00Z'), amount: 999n },
    ];
    const series = buildDailySeries(rows, now, 3);
    expect(series.every((p) => p.amount === '0')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd be && pnpm test stats.util`
Expected: FAIL — `Cannot find module './stats.util'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// be/src/common/stats.util.ts
export interface PaidRow {
  paidAt: Date | null;
  amount: bigint;
}

export interface SeriesBucket {
  date: string; // YYYY-MM-DD (UTC)
  amount: string; // base units, stringified
}

function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Zero-filled daily buckets for the last `days` days (inclusive of `now`'s day),
 * oldest first. Sums `amount` of rows whose `paidAt` falls in each UTC day.
 * Money stays BigInt internally and is stringified on the way out (JSON-safe).
 */
export function buildDailySeries(rows: PaidRow[], now: Date, days: number): SeriesBucket[] {
  const totals = new Map<string, bigint>();
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = utcDayKey(d);
    keys.push(key);
    totals.set(key, 0n);
  }
  for (const r of rows) {
    if (!r.paidAt) continue;
    const key = utcDayKey(r.paidAt);
    if (!totals.has(key)) continue;
    totals.set(key, totals.get(key)! + r.amount);
  }
  return keys.map((key) => ({ date: key, amount: totals.get(key)!.toString() }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd be && pnpm test stats.util`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add be/src/common/stats.util.ts be/src/common/stats.util.spec.ts
git commit -m "feat(be): pure daily-series aggregation helper for dashboard stats"
```

---

### Task 2: Merchant stats service

**Files:**
- Create: `be/src/merchant/merchant-stats.service.ts`
- Test: `be/src/merchant/merchant-stats.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// be/src/merchant/merchant-stats.service.spec.ts
import { MerchantStatsService } from './merchant-stats.service';

function deps() {
  const prisma = {
    order: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 1500n } }),
      count: jest
        .fn()
        .mockResolvedValueOnce(3)  // paid
        .mockResolvedValueOnce(2)  // awaiting_payment
        .mockResolvedValueOnce(1), // expired
      findMany: jest.fn().mockResolvedValue([
        { paidAt: new Date('2026-07-05T10:00:00Z'), amount: 1500n },
      ]),
    },
  } as any;
  return { svc: new MerchantStatsService(prisma), prisma };
}

describe('MerchantStatsService', () => {
  it('scopes every query to the merchant and returns string money + counts + 30-pt series', async () => {
    const { svc, prisma } = deps();
    const now = new Date('2026-07-05T12:00:00Z');
    const out = await svc.forMerchant('m1', now);

    expect(out.totalRevenue).toBe('1500');
    expect(out.paidCount).toBe(3);
    expect(out.awaitingCount).toBe(2);
    expect(out.expiredCount).toBe(1);
    expect(out.series).toHaveLength(30);
    expect(out.series[29]).toEqual({ date: '2026-07-05', amount: '1500' });

    // aggregate scoped to this merchant + paid only
    expect(prisma.order.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { merchantId: 'm1', status: 'paid' } }),
    );
    // findMany scoped to merchant + paid
    expect(prisma.order.findMany.mock.calls[0][0].where).toMatchObject({ merchantId: 'm1', status: 'paid' });
  });

  it('treats a null aggregate sum as 0', async () => {
    const { svc, prisma } = deps();
    prisma.order.aggregate.mockResolvedValue({ _sum: { amount: null } });
    const out = await svc.forMerchant('m1', new Date('2026-07-05T12:00:00Z'));
    expect(out.totalRevenue).toBe('0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd be && pnpm test merchant-stats`
Expected: FAIL — `Cannot find module './merchant-stats.service'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// be/src/merchant/merchant-stats.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildDailySeries, SeriesBucket } from '../common/stats.util';

const WINDOW_DAYS = 30;

export interface MerchantStats {
  totalRevenue: string;
  paidCount: number;
  awaitingCount: number;
  expiredCount: number;
  series: SeriesBucket[];
}

@Injectable()
export class MerchantStatsService {
  constructor(private readonly prisma: PrismaService) {}

  async forMerchant(merchantId: string, now: Date = new Date()): Promise<MerchantStats> {
    const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const [agg, paidCount, awaitingCount, expiredCount, paidRows] = await Promise.all([
      this.prisma.order.aggregate({ _sum: { amount: true }, where: { merchantId, status: 'paid' } }),
      this.prisma.order.count({ where: { merchantId, status: 'paid' } }),
      this.prisma.order.count({ where: { merchantId, status: 'awaiting_payment' } }),
      this.prisma.order.count({ where: { merchantId, status: 'expired' } }),
      this.prisma.order.findMany({
        where: { merchantId, status: 'paid', paidAt: { gte: since } },
        select: { paidAt: true, amount: true },
      }),
    ]);
    return {
      totalRevenue: (agg._sum.amount ?? 0n).toString(),
      paidCount,
      awaitingCount,
      expiredCount,
      series: buildDailySeries(paidRows, now, WINDOW_DAYS),
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd be && pnpm test merchant-stats`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add be/src/merchant/merchant-stats.service.ts be/src/merchant/merchant-stats.service.spec.ts
git commit -m "feat(be): merchant dashboard stats service (revenue, counts, 30d series)"
```

---

### Task 3: Wire merchant stats endpoint

**Files:**
- Modify: `be/src/merchant/merchant.controller.ts`
- Modify: `be/src/merchant/merchant.module.ts`

- [ ] **Step 1: Add the provider to the module**

In `be/src/merchant/merchant.module.ts`, import and add `MerchantStatsService` to `providers`. Example (adjust to match the existing array):

```typescript
import { MerchantStatsService } from './merchant-stats.service';
// ...
@Module({
  // ...existing imports (PrismaModule, etc.)
  providers: [/* ...existing... */ MerchantStatsService],
  controllers: [/* ...existing MerchantController... */],
})
export class MerchantModule {}
```

- [ ] **Step 2: Add the endpoint to the controller**

In `be/src/merchant/merchant.controller.ts`, add the import, inject the service, and add the handler:

```typescript
import { Get } from '@nestjs/common'; // add Get to the existing @nestjs/common import
import { MerchantStatsService } from './merchant-stats.service';

// add to constructor params:
//   private readonly stats: MerchantStatsService,

@Get('merchant/stats')
@UseGuards(JwtGuard, RolesGuard)
@Roles('merchant')
async merchantStats(@Req() req: any) {
  return this.stats.forMerchant(req.user.sub);
}
```

- [ ] **Step 3: Verify build (typecheck + Nest DI)**

Run: `cd be && pnpm build`
Expected: build succeeds, no unresolved-provider errors.

- [ ] **Step 4: Run the merchant test suites**

Run: `cd be && pnpm test merchant`
Expected: PASS (existing merchant specs + new stats spec).

- [ ] **Step 5: Commit**

```bash
git add be/src/merchant/merchant.controller.ts be/src/merchant/merchant.module.ts
git commit -m "feat(be): expose GET /merchant/stats (merchant JWT)"
```

---

### Task 4: Admin stats service + endpoint

**Files:**
- Create: `be/src/admin-merchants/admin-stats.service.ts`
- Test: `be/src/admin-merchants/admin-stats.service.spec.ts`
- Create: `be/src/admin-merchants/admin-stats.controller.ts`
- Modify: `be/src/admin-merchants/admin-merchants.module.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// be/src/admin-merchants/admin-stats.service.spec.ts
import { AdminStatsService } from './admin-stats.service';

function deps() {
  const prisma = {
    merchant: {
      count: jest
        .fn()
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(3)  // pending
        .mockResolvedValueOnce(5)  // approved
        .mockResolvedValueOnce(2)  // rejected
        .mockResolvedValueOnce(4), // onchainRegistered
      findMany: jest.fn().mockResolvedValue([{ id: 'm1', businessName: 'Acme', approvalStatus: 'pending', createdAt: new Date() }]),
    },
    order: {
      count: jest.fn().mockResolvedValue(42),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 999n } }),
      findMany: jest
        .fn()
        .mockResolvedValueOnce([{ paidAt: new Date('2026-07-05T10:00:00Z'), amount: 999n }]) // series rows
        .mockResolvedValueOnce([{ id: 'o1', reference: 'r1', amount: 999n, status: 'paid', paidAt: new Date(), payer: 'PK' }]), // recent paid
    },
  } as any;
  return { svc: new AdminStatsService(prisma), prisma };
}

describe('AdminStatsService', () => {
  it('aggregates platform totals with string money and a 30-pt series', async () => {
    const { svc } = deps();
    const out = await svc.platform(new Date('2026-07-05T12:00:00Z'));
    expect(out.merchantsTotal).toBe(10);
    expect(out.pending).toBe(3);
    expect(out.approved).toBe(5);
    expect(out.rejected).toBe(2);
    expect(out.onchainRegistered).toBe(4);
    expect(out.ordersTotal).toBe(42);
    expect(out.volumeTotal).toBe('999');
    expect(out.series).toHaveLength(30);
    expect(out.recentPending[0].businessName).toBe('Acme');
    expect(out.recentPayments[0].amount).toBe('999'); // stringified
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd be && pnpm test admin-stats`
Expected: FAIL — `Cannot find module './admin-stats.service'`.

- [ ] **Step 3: Write the service**

```typescript
// be/src/admin-merchants/admin-stats.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildDailySeries, SeriesBucket } from '../common/stats.util';

const WINDOW_DAYS = 30;

export interface AdminStats {
  merchantsTotal: number;
  pending: number;
  approved: number;
  rejected: number;
  onchainRegistered: number;
  ordersTotal: number;
  volumeTotal: string;
  series: SeriesBucket[];
  recentPending: { id: string; businessName: string; email?: string; createdAt: Date }[];
  recentPayments: { id: string; reference: string; amount: string; status: string; paidAt: Date | null; payer: string | null }[];
}

@Injectable()
export class AdminStatsService {
  constructor(private readonly prisma: PrismaService) {}

  async platform(now: Date = new Date()): Promise<AdminStats> {
    const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const [
      merchantsTotal, pending, approved, rejected, onchainRegistered,
      ordersTotal, agg, seriesRows, recentPending, recentPayments,
    ] = await Promise.all([
      this.prisma.merchant.count(),
      this.prisma.merchant.count({ where: { approvalStatus: 'pending' } }),
      this.prisma.merchant.count({ where: { approvalStatus: 'approved' } }),
      this.prisma.merchant.count({ where: { approvalStatus: 'rejected' } }),
      this.prisma.merchant.count({ where: { onchainRegisteredAt: { not: null } } }),
      this.prisma.order.count(),
      this.prisma.order.aggregate({ _sum: { amount: true }, where: { status: 'paid' } }),
      this.prisma.order.findMany({ where: { status: 'paid', paidAt: { gte: since } }, select: { paidAt: true, amount: true } }),
      this.prisma.merchant.findMany({ where: { approvalStatus: 'pending' }, orderBy: { createdAt: 'desc' }, take: 5 }),
      this.prisma.order.findMany({ where: { status: 'paid' }, orderBy: { paidAt: 'desc' }, take: 6 }),
    ]);
    return {
      merchantsTotal, pending, approved, rejected, onchainRegistered, ordersTotal,
      volumeTotal: (agg._sum.amount ?? 0n).toString(),
      series: buildDailySeries(seriesRows, now, WINDOW_DAYS),
      recentPending: recentPending.map((m: any) => ({ id: m.id, businessName: m.businessName, email: m.email, createdAt: m.createdAt })),
      recentPayments: recentPayments.map((o: any) => ({
        id: o.id, reference: o.reference, amount: o.amount.toString(), status: o.status, paidAt: o.paidAt ?? null, payer: o.payer ?? null,
      })),
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd be && pnpm test admin-stats`
Expected: PASS.

- [ ] **Step 5: Write the controller + register in module**

```typescript
// be/src/admin-merchants/admin-stats.controller.ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminStatsService } from './admin-stats.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('admin/stats')
@UseGuards(JwtGuard, RolesGuard)
@Roles('admin')
export class AdminStatsController {
  constructor(private readonly stats: AdminStatsService) {}

  @Get()
  platform() {
    return this.stats.platform();
  }
}
```

In `be/src/admin-merchants/admin-merchants.module.ts` add `AdminStatsService` to `providers` and `AdminStatsController` to `controllers` (keep existing entries):

```typescript
import { AdminStatsService } from './admin-stats.service';
import { AdminStatsController } from './admin-stats.controller';
// providers: [AdminMerchantsService, AdminStatsService, ...]
// controllers: [AdminMerchantsController, AdminStatsController]
```

- [ ] **Step 6: Verify build + commit**

Run: `cd be && pnpm build && pnpm test admin`
Expected: build succeeds; admin specs pass.

```bash
git add be/src/admin-merchants/admin-stats.service.ts be/src/admin-merchants/admin-stats.service.spec.ts be/src/admin-merchants/admin-stats.controller.ts be/src/admin-merchants/admin-merchants.module.ts
git commit -m "feat(be): expose GET /admin/stats (admin JWT) with platform totals + series"
```

---

## PHASE B — Frontend design-system port

### Task 5: Copy web-wallet tokens + primitives into fe

**Files:**
- Create (copy): `fe/src/ui/theme.ts`, `Text.tsx`, `Card.tsx`, `Button.tsx`, `Bits.tsx`, `Icon.tsx`

- [ ] **Step 1: Copy the files verbatim**

```bash
mkdir -p fe/src/ui
cp web-wallet/src/ui/theme.ts   fe/src/ui/theme.ts
cp web-wallet/src/ui/Text.tsx   fe/src/ui/Text.tsx
cp web-wallet/src/ui/Card.tsx   fe/src/ui/Card.tsx
cp web-wallet/src/ui/Button.tsx fe/src/ui/Button.tsx
cp web-wallet/src/ui/Bits.tsx   fe/src/ui/Bits.tsx
cp web-wallet/src/ui/Icon.tsx   fe/src/ui/Icon.tsx
```

- [ ] **Step 2: Check for cross-file imports these pull in**

Run: `cd fe && grep -Rn "from '\./" src/ui/*.tsx src/ui/*.ts`
Expected: they import only from each other (`./theme`, `./Text`, `./Icon`). If any file imports a web-wallet module NOT in the copy list (e.g. `./Gradient` used by `Button`), copy that file too:

```bash
# only if grep shows it is imported:
cp web-wallet/src/ui/Gradient.tsx fe/src/ui/Gradient.tsx
```

- [ ] **Step 3: Typecheck the ui folder in isolation**

Run: `cd fe && pnpm exec tsc --noEmit`
Expected: no errors originating from `src/ui/*`. (Page errors are fine at this stage — pages are rewritten later.) If `'use client'` is missing on any interactive primitive, it will surface at build time in Task 11; leave as-is for now.

- [ ] **Step 4: Commit**

```bash
git add fe/src/ui
git commit -m "feat(fe): port web-wallet design tokens + core primitives (theme, Text, Card, Button, Bits, Icon)"
```

---

### Task 6: Add desktop icons to the Icon set

**Files:**
- Modify: `fe/src/ui/Icon.tsx`

- [ ] **Step 1: Add missing glyph names**

Open `fe/src/ui/Icon.tsx`. It defines `type IconName = '...'` and a `switch`/map of paths. Add these names to the `IconName` union and a matching 24×24 line-path case for each (round caps, `strokeWidth` inherited). Add `'users'`, `'store'`, `'orders'`, `'key'`, `'chart'` if not already present:

```tsx
// inside the icon path switch, add cases (paths are 24x24, stroke none-filled):
case 'users':
  return (<><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c0-3 2.5-4.6 5.5-4.6S14.5 16 14.5 19" /><path d="M16 6.2a3 3 0 0 1 0 5.6M17.5 19c0-2.3-1-3.8-2.6-4.5" /></>);
case 'store':
  return (<><path d="M4 9.5 5.2 5h13.6L20 9.5" /><path d="M4 9.5v9.5h16V9.5" /><path d="M4 9.5a2.4 2.4 0 0 0 4 0 2.4 2.4 0 0 0 4 0 2.4 2.4 0 0 0 4 0 2.4 2.4 0 0 0 4 0" /><path d="M9.5 19v-4.5h5V19" /></>);
case 'orders':
  return (<><rect x="5" y="3.5" width="14" height="17" rx="2" /><path d="M8.5 8h7M8.5 12h7M8.5 16h4" /></>);
case 'key':
  return (<><circle cx="8" cy="8" r="3.5" /><path d="M10.5 10.5 20 20M16 16l2-2M18 18l1.5-1.5" /></>);
case 'chart':
  return (<><path d="M4 4v16h16" /><path d="M8 15l3-4 3 2 4-6" /></>);
```

> Note: match the exact JSX shape the existing cases use (they may render `<path>` inside a shared `<svg>`). Mirror the neighbouring cases' element style. If a name already exists, skip it.

- [ ] **Step 2: Typecheck**

Run: `cd fe && pnpm exec tsc --noEmit 2>&1 | grep -i icon`
Expected: no Icon-related errors.

- [ ] **Step 3: Commit**

```bash
git add fe/src/ui/Icon.tsx
git commit -m "feat(fe): add users/store/orders/key/chart glyphs to Icon set"
```

---

### Task 7: Global styles — aurora background + resets

**Files:**
- Modify: `fe/src/app/globals.css`

- [ ] **Step 1: Replace globals.css with the Navy desktop base**

Overwrite `fe/src/app/globals.css` with (adapted from web-wallet, minus the phone frame; adds desktop aurora + scrollbar):

```css
:root {
  --bg: #060B17;
  --bg-elevated: #0B1322;
  --surface: #111B2E;
  --text-hi: #F3F7FF;
  --text: #CBD6EC;
  --accent: #4F8CFF;
  --aqua: #2FE0C2;
}

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; min-height: 100%; }

body {
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  background:
    radial-gradient(130% 55% at 85% -5%, rgba(18,58,122,0.55), transparent 45%),
    radial-gradient(120% 50% at 0% 22%, rgba(10,90,107,0.45), transparent 50%),
    var(--bg);
  background-attachment: fixed;
}

button { font: inherit; color: inherit; background: none; border: none; cursor: pointer; }
input, select, textarea { font: inherit; }
a { color: inherit; text-decoration: none; }

::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 999px; }
::-webkit-scrollbar-track { background: transparent; }

@keyframes navy-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes navy-shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
@keyframes spin { to { transform: rotate(360deg); } }
.navy-fade-in { animation: navy-rise 420ms cubic-bezier(0.22,1,0.36,1) both; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; }
}
```

- [ ] **Step 2: Confirm layout.tsx still imports globals.css and drop unused font vars if they break**

Run: `cd fe && grep -n "globals.css\|geist\|Geist" src/app/layout.tsx`
If `layout.tsx` applies Geist font CSS variables to `<body>`, leave them (harmless) — our `body` font-family wins via globals. Do NOT remove the `globals.css` import.

- [ ] **Step 3: Build to confirm CSS compiles**

Run: `cd fe && pnpm build`
Expected: build succeeds (pages may still look unstyled — that's fine; they're rewritten next).

- [ ] **Step 4: Commit**

```bash
git add fe/src/app/globals.css
git commit -m "feat(fe): Navy aurora global background + resets (desktop)"
```

---

## PHASE C — Frontend pure helpers (TDD)

### Task 8: Chart geometry helper

**Files:**
- Create: `fe/src/lib/dashboard/chart.ts`
- Test: `fe/src/lib/dashboard/chart.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// fe/src/lib/dashboard/chart.test.ts
import { buildChartGeometry } from './chart';

describe('buildChartGeometry', () => {
  it('maps values into [0,height] with max at the top (y small) and returns paths', () => {
    const g = buildChartGeometry([{ date: 'a', value: 0 }, { date: 'b', value: 10 }], 100, 40, 4);
    expect(g.points).toHaveLength(2);
    // first point x = pad, last point x = width - pad
    expect(g.points[0].x).toBeCloseTo(4);
    expect(g.points[1].x).toBeCloseTo(96);
    // value 10 (max) sits near the top => smaller y than value 0
    expect(g.points[1].y).toBeLessThan(g.points[0].y);
    expect(g.linePath.startsWith('M')).toBe(true);
    expect(g.areaPath.endsWith('Z')).toBe(true);
  });

  it('renders a flat baseline when all values are zero (no divide-by-zero)', () => {
    const g = buildChartGeometry([{ date: 'a', value: 0 }, { date: 'b', value: 0 }], 100, 40, 4);
    expect(g.points.every((p) => Number.isFinite(p.y))).toBe(true);
    expect(g.max).toBe(0);
  });

  it('handles a single point without NaN', () => {
    const g = buildChartGeometry([{ date: 'a', value: 5 }], 100, 40, 4);
    expect(g.points).toHaveLength(1);
    expect(Number.isFinite(g.points[0].x)).toBe(true);
  });

  it('returns empty paths for an empty series', () => {
    const g = buildChartGeometry([], 100, 40, 4);
    expect(g.points).toHaveLength(0);
    expect(g.linePath).toBe('');
    expect(g.areaPath).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd fe && pnpm test chart`
Expected: FAIL — cannot find `./chart`.

- [ ] **Step 3: Write the implementation**

```typescript
// fe/src/lib/dashboard/chart.ts
export interface SeriesPoint {
  date: string;
  value: number;
}

export interface ChartGeometry {
  points: { x: number; y: number }[];
  linePath: string;
  areaPath: string;
  max: number;
}

/**
 * Pure SVG geometry for a trend chart. Values map into a [pad, height-pad] band,
 * the series max at the top. Guards empty/single/all-zero series against NaN.
 */
export function buildChartGeometry(series: SeriesPoint[], width: number, height: number, pad = 0): ChartGeometry {
  if (series.length === 0) return { points: [], linePath: '', areaPath: '', max: 0 };

  const max = series.reduce((m, p) => Math.max(m, p.value), 0);
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const stepX = series.length > 1 ? innerW / (series.length - 1) : 0;

  const points = series.map((p, i) => {
    const x = pad + (series.length > 1 ? stepX * i : innerW / 2);
    const ratio = max > 0 ? p.value / max : 0;
    const y = pad + innerH - ratio * innerH;
    return { x, y };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
  const baseY = (height - pad).toFixed(2);
  const areaPath =
    points.length > 0
      ? `M${points[0].x.toFixed(2)} ${baseY} ` +
        points.map((p) => `L${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ') +
        ` L${points[points.length - 1].x.toFixed(2)} ${baseY} Z`
      : '';

  return { points, linePath, areaPath, max };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd fe && pnpm test chart`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add fe/src/lib/dashboard/chart.ts fe/src/lib/dashboard/chart.test.ts
git commit -m "feat(fe): pure SVG chart-geometry helper for trend charts"
```

---

### Task 9: Money formatting + delta helper

**Files:**
- Create: `fe/src/lib/dashboard/stats.ts`
- Test: `fe/src/lib/dashboard/stats.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// fe/src/lib/dashboard/stats.test.ts
import { formatUsdc, pctDelta } from './stats';

describe('formatUsdc', () => {
  it('formats base-unit strings (6 decimals) into grouped USDC, trimming trailing zeros', () => {
    expect(formatUsdc('1500000')).toBe('1.5');
    expect(formatUsdc('1000000')).toBe('1');
    expect(formatUsdc('1234567')).toBe('1.234567');
    expect(formatUsdc('0')).toBe('0');
    expect(formatUsdc('1000000000')).toBe('1,000');
  });

  it('is safe on large values (no float precision loss)', () => {
    expect(formatUsdc('123456789000000')).toBe('123,456,789');
  });
});

describe('pctDelta', () => {
  it('computes a rounded percentage change, guarding a zero base', () => {
    expect(pctDelta(150, 100)).toBe(50);
    expect(pctDelta(80, 100)).toBe(-20);
    expect(pctDelta(5, 0)).toBe(null); // undefined base -> no delta
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd fe && pnpm test dashboard/stats`
Expected: FAIL — cannot find `./stats`.

- [ ] **Step 3: Write the implementation (string math, no floats)**

```typescript
// fe/src/lib/dashboard/stats.ts
const USDC_DECIMALS = 6;

/** Format a base-unit integer string (6 decimals) as a grouped USDC amount. Pure string math. */
export function formatUsdc(baseUnits: string): string {
  const neg = baseUnits.startsWith('-');
  const digits = (neg ? baseUnits.slice(1) : baseUnits).replace(/\D/g, '') || '0';
  const padded = digits.padStart(USDC_DECIMALS + 1, '0');
  const whole = padded.slice(0, padded.length - USDC_DECIMALS);
  const frac = padded.slice(padded.length - USDC_DECIMALS).replace(/0+$/, '');
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = frac ? `${groupedWhole}.${frac}` : groupedWhole;
  return neg && body !== '0' ? `-${body}` : body;
}

/** Rounded percentage change from `base` to `current`; null when base is 0/undefined. */
export function pctDelta(current: number, base: number): number | null {
  if (!base) return null;
  return Math.round(((current - base) / base) * 100);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd fe && pnpm test dashboard/stats`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fe/src/lib/dashboard/stats.ts fe/src/lib/dashboard/stats.test.ts
git commit -m "feat(fe): USDC formatting + delta helpers for dashboard stats"
```

---

### Task 10: Status → Pill tone helper

**Files:**
- Create: `fe/src/lib/dashboard/status.ts`
- Test: `fe/src/lib/dashboard/status.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// fe/src/lib/dashboard/status.test.ts
import { statusTone } from './status';

describe('statusTone', () => {
  it('maps known payment/merchant statuses to tones + human labels', () => {
    expect(statusTone('paid')).toEqual({ tone: 'success', label: 'Paid' });
    expect(statusTone('approved')).toEqual({ tone: 'success', label: 'Approved' });
    expect(statusTone('awaiting_payment')).toEqual({ tone: 'warning', label: 'Awaiting payment' });
    expect(statusTone('pending')).toEqual({ tone: 'warning', label: 'Pending' });
    expect(statusTone('expired')).toEqual({ tone: 'danger', label: 'Expired' });
    expect(statusTone('rejected')).toEqual({ tone: 'danger', label: 'Rejected' });
    expect(statusTone('failed')).toEqual({ tone: 'danger', label: 'Failed' });
  });

  it('falls back to a neutral tone + title-cased label for unknown statuses', () => {
    expect(statusTone('created')).toEqual({ tone: 'neutral', label: 'Created' });
    expect(statusTone('some_new_state')).toEqual({ tone: 'neutral', label: 'Some new state' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd fe && pnpm test dashboard/status`
Expected: FAIL — cannot find `./status`.

- [ ] **Step 3: Write the implementation**

```typescript
// fe/src/lib/dashboard/status.ts
export type PillTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent';

const MAP: Record<string, { tone: PillTone; label: string }> = {
  paid: { tone: 'success', label: 'Paid' },
  approved: { tone: 'success', label: 'Approved' },
  awaiting_payment: { tone: 'warning', label: 'Awaiting payment' },
  pending: { tone: 'warning', label: 'Pending' },
  expired: { tone: 'danger', label: 'Expired' },
  rejected: { tone: 'danger', label: 'Rejected' },
  failed: { tone: 'danger', label: 'Failed' },
};

function titleCase(s: string): string {
  const words = s.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function statusTone(status: string): { tone: PillTone; label: string } {
  return MAP[status] ?? { tone: 'neutral', label: titleCase(status) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd fe && pnpm test dashboard/status`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fe/src/lib/dashboard/status.ts fe/src/lib/dashboard/status.test.ts
git commit -m "feat(fe): status -> Pill tone/label helper"
```

---

## PHASE D — Frontend desktop primitives

> All components below are client components (they use hooks/interaction). Start each file with `'use client';`. They style via inline `style={{}}` using tokens from `../ui/theme` (import `{ colors, space, radius, gradients, type }`). Verify the exact export names in `fe/src/ui/theme.ts` after the Task 5 copy and match them.

### Task 11: Sidebar + TopBar + AppShell

**Files:**
- Create: `fe/src/ui/Sidebar.tsx`, `fe/src/ui/TopBar.tsx`, `fe/src/ui/AppShell.tsx`

- [ ] **Step 1: Write `Sidebar.tsx`**

```tsx
// fe/src/ui/Sidebar.tsx
'use client';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { colors, space, radius, gradients } from './theme';
import { Text } from './Text';
import { Icon, IconName } from './Icon';

export interface NavItem { href: string; label: string; icon: IconName; }
export interface Identity { title: string; subtitle: string; }

export function Sidebar({ items, identity, onLogout }: { items: NavItem[]; identity: Identity; onLogout?: () => void }) {
  const pathname = usePathname();
  return (
    <aside style={{ width: 248, flexShrink: 0, display: 'flex', flexDirection: 'column', padding: space.xl, gap: space.xs, borderRight: `1px solid ${colors.border}`, background: 'rgba(11,19,34,0.55)', backdropFilter: 'blur(14px)', position: 'sticky', top: 0, height: '100dvh' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, padding: `${space.sm}px ${space.sm}px ${space.xl}px` }}>
        <div style={{ width: 34, height: 34, borderRadius: radius.md, background: `linear-gradient(135deg, ${gradients.ocean[0]}, ${gradients.ocean[1]})`, display: 'grid', placeItems: 'center' }}>
          <Icon name="wallet" size={18} color={colors.onAccent} />
        </div>
        <Text variant="h3" color={colors.textHi}>Navy</Text>
      </div>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: space.xs }}>
        {items.map((it) => {
          const active = pathname === it.href || (it.href !== '/' && pathname?.startsWith(it.href + '/'));
          return (
            <Link key={it.href} href={it.href} style={{ display: 'flex', alignItems: 'center', gap: space.md, padding: `${space.md}px ${space.md}px`, borderRadius: radius.md, background: active ? `linear-gradient(135deg, ${gradients.ocean[0]}, ${gradients.ocean[1]})` : 'transparent', color: active ? colors.onAccent : colors.textDim, boxShadow: active ? '0 6px 16px rgba(23,196,168,0.28)' : undefined }}>
              <Icon name={it.icon} size={20} color={active ? colors.onAccent : colors.textDim} />
              <Text variant="bodyStrong" color={active ? colors.onAccent : colors.text}>{it.label}</Text>
            </Link>
          );
        })}
      </nav>
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: space.sm, paddingTop: space.lg, borderTop: `1px solid ${colors.border}` }}>
        <div style={{ padding: `${space.sm}px ${space.md}px` }}>
          <Text variant="bodyStrong" color={colors.textHi}>{identity.title}</Text>
          <Text variant="caption" dim>{identity.subtitle}</Text>
        </div>
        {onLogout && (
          <button onClick={onLogout} style={{ display: 'flex', alignItems: 'center', gap: space.md, padding: `${space.md}px`, borderRadius: radius.md, color: colors.danger }}>
            <Icon name="logout" size={20} color={colors.danger} />
            <Text variant="bodyStrong" color={colors.danger}>Log out</Text>
          </button>
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Write `TopBar.tsx`**

```tsx
// fe/src/ui/TopBar.tsx
'use client';
import { colors, space } from './theme';
import { Text } from './Text';

export function TopBar({ eyebrow, title, right }: { eyebrow?: string; title: string; right?: React.ReactNode }) {
  return (
    <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.lg, padding: `${space.xl}px 0 ${space.lg}px`, marginBottom: space.lg, borderBottom: `1px solid ${colors.border}` }}>
      <div>
        {eyebrow && <Text variant="label" upper dim style={{ marginBottom: 4 }}>{eyebrow}</Text>}
        <Text variant="h1" color={colors.textHi}>{title}</Text>
      </div>
      {right && <div style={{ display: 'flex', alignItems: 'center', gap: space.md }}>{right}</div>}
    </header>
  );
}
```

- [ ] **Step 3: Write `AppShell.tsx`**

```tsx
// fe/src/ui/AppShell.tsx
'use client';
import { colors, space } from './theme';
import { Sidebar, NavItem, Identity } from './Sidebar';

export function AppShell({ items, identity, onLogout, children }: { items: NavItem[]; identity: Identity; onLogout?: () => void; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', minHeight: '100dvh', color: colors.text }}>
      <Sidebar items={items} identity={identity} onLogout={onLogout} />
      <main className="navy-fade-in" style={{ flex: 1, minWidth: 0, maxWidth: 1360, margin: '0 auto', width: '100%', padding: `0 ${space.xxxl}px ${space.huge}px` }}>
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck (props + token names)**

Run: `cd fe && pnpm exec tsc --noEmit 2>&1 | grep -iE "ui/(Sidebar|TopBar|AppShell)"`
Expected: no errors. If a token name mismatch appears (e.g. `gradients.ocean` shape), open `src/ui/theme.ts` and adjust the reference to the real export.

- [ ] **Step 5: Commit**

```bash
git add fe/src/ui/Sidebar.tsx fe/src/ui/TopBar.tsx fe/src/ui/AppShell.tsx
git commit -m "feat(fe): AppShell + Sidebar + TopBar desktop chrome"
```

---

### Task 12: StatCard + TrendChart + DataTable + AuthCard

**Files:**
- Create: `fe/src/ui/StatCard.tsx`, `fe/src/ui/TrendChart.tsx`, `fe/src/ui/DataTable.tsx`, `fe/src/ui/AuthCard.tsx`

- [ ] **Step 1: Write `StatCard.tsx`**

```tsx
// fe/src/ui/StatCard.tsx
'use client';
import { colors, space, radius, gradients } from './theme';
import { Text } from './Text';
import { Pill, IconBadge } from './Bits';
import { IconName } from './Icon';

export function StatCard({ label, value, icon, delta, featured, onClick }: {
  label: string; value: string; icon?: IconName; delta?: string | null; featured?: boolean; onClick?: () => void;
}) {
  const base: React.CSSProperties = {
    borderRadius: radius.xl, padding: space.xxl, display: 'flex', flexDirection: 'column', gap: space.md,
    cursor: onClick ? 'pointer' : 'default', minHeight: 132,
  };
  const style: React.CSSProperties = featured
    ? { ...base, background: `linear-gradient(135deg, ${gradients.ocean[0]}, ${gradients.ocean[1]})`, boxShadow: '0 12px 28px rgba(79,140,255,0.35)' }
    : { ...base, background: colors.surface, border: `1px solid ${colors.border}` };
  const labelColor = featured ? 'rgba(4,17,31,0.7)' : colors.textDim;
  const valueColor = featured ? colors.onAccent : colors.textHi;
  return (
    <div onClick={onClick} style={style}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="label" upper style={{ color: labelColor }}>{label}</Text>
        {icon && <IconBadge name={icon} color={featured ? colors.onAccent : colors.accent} size={38} />}
      </div>
      <Text variant="h1" numeric color={valueColor}>{value}</Text>
      {delta != null && <Pill label={delta} tone={featured ? 'neutral' : 'success'} />}
    </div>
  );
}
```

- [ ] **Step 2: Write `TrendChart.tsx`**

```tsx
// fe/src/ui/TrendChart.tsx
'use client';
import { colors, space, radius, gradients } from './theme';
import { Text } from './Text';
import { buildChartGeometry, SeriesPoint } from '../lib/dashboard/chart';

export function TrendChart({ title, series, height = 220 }: { title: string; series: SeriesPoint[]; height?: number }) {
  const W = 900, H = height, PAD = 10;
  const g = buildChartGeometry(series, W, H, PAD);
  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.xl, padding: space.xxl }}>
      <Text variant="h3" color={colors.textHi} style={{ marginBottom: space.lg }}>{title}</Text>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height }}>
        <defs>
          <linearGradient id="navy-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={gradients.ocean[1]} stopOpacity="0.35" />
            <stop offset="100%" stopColor={gradients.ocean[1]} stopOpacity="0" />
          </linearGradient>
        </defs>
        {g.areaPath && <path d={g.areaPath} fill="url(#navy-area)" />}
        {g.linePath && <path d={g.linePath} fill="none" stroke={colors.aqua} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />}
      </svg>
    </div>
  );
}
```

- [ ] **Step 3: Write `DataTable.tsx`**

```tsx
// fe/src/ui/DataTable.tsx
'use client';
import { colors, space, radius } from './theme';
import { Text } from './Text';

export interface Column<T> { key: string; header: string; render: (row: T) => React.ReactNode; align?: 'left' | 'right'; }

export function DataTable<T>({ columns, rows, empty = 'Nothing here yet' }: { columns: Column<T>[]; rows: T[]; empty?: string }) {
  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.xl, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns.length}, 1fr)`, padding: `${space.md}px ${space.xxl}px`, borderBottom: `1px solid ${colors.border}` }}>
        {columns.map((c) => (
          <Text key={c.key} variant="label" upper dim style={{ textAlign: c.align ?? 'left' }}>{c.header}</Text>
        ))}
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: space.huge, textAlign: 'center' }}><Text variant="caption" dim>{empty}</Text></div>
      ) : (
        rows.map((row, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: `repeat(${columns.length}, 1fr)`, alignItems: 'center', padding: `${space.lg}px ${space.xxl}px`, borderBottom: i < rows.length - 1 ? `1px solid ${colors.border}` : undefined }}>
            {columns.map((c) => (
              <div key={c.key} style={{ textAlign: c.align ?? 'left', minWidth: 0 }}>{c.render(row)}</div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write `AuthCard.tsx`**

```tsx
// fe/src/ui/AuthCard.tsx
'use client';
import { colors, space, radius, gradients } from './theme';
import { Text } from './Text';
import { Icon } from './Icon';

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: space.xl }}>
      <div className="navy-fade-in" style={{ width: '100%', maxWidth: 420, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.xxl, padding: space.xxxl, display: 'flex', flexDirection: 'column', gap: space.lg }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: space.sm }}>
          <div style={{ width: 34, height: 34, borderRadius: radius.md, background: `linear-gradient(135deg, ${gradients.ocean[0]}, ${gradients.ocean[1]})`, display: 'grid', placeItems: 'center' }}>
            <Icon name="wallet" size={18} color={colors.onAccent} />
          </div>
          <Text variant="h3" color={colors.textHi}>Navy</Text>
        </div>
        <div>
          <Text variant="h1" color={colors.textHi}>{title}</Text>
          {subtitle && <Text variant="caption" dim style={{ marginTop: 4 }}>{subtitle}</Text>}
        </div>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck**

Run: `cd fe && pnpm exec tsc --noEmit 2>&1 | grep -iE "ui/(StatCard|TrendChart|DataTable|AuthCard)"`
Expected: no errors. Reconcile any token/prop name mismatches against the real `theme.ts` / `Bits.tsx` / `Text.tsx` signatures.

- [ ] **Step 6: Commit**

```bash
git add fe/src/ui/StatCard.tsx fe/src/ui/TrendChart.tsx fe/src/ui/DataTable.tsx fe/src/ui/AuthCard.tsx
git commit -m "feat(fe): StatCard, TrendChart, DataTable, AuthCard primitives"
```

---

## PHASE E — Frontend data routes

### Task 13: Stats proxy route handlers

**Files:**
- Create: `fe/src/app/api/merchant/stats/route.ts`
- Create: `fe/src/app/api/admin/stats/route.ts`

- [ ] **Step 1: Inspect an existing proxy handler for the exact pattern**

Run: `cd fe && cat src/app/api/merchant/orders/route.ts`
Note the imports (`sessionBackendFetch` from `@/lib/session-backend` or relative), the `NextResponse` usage, error/status forwarding, and `export const dynamic`/`runtime` if present. Mirror it exactly.

- [ ] **Step 2: Write `merchant/stats/route.ts`** (mirroring the observed pattern)

```typescript
// fe/src/app/api/merchant/stats/route.ts
import { NextResponse } from 'next/server';
import { sessionBackendFetch } from '@/lib/session-backend';

export async function GET() {
  const res = await sessionBackendFetch('/merchant/stats');
  const body = await res.text();
  return new NextResponse(body, { status: res.status, headers: { 'content-type': 'application/json' } });
}
```

> If the existing handler imports `sessionBackendFetch` by a relative path or wraps errors differently, copy that shape instead. Keep it identical to the sibling handler.

- [ ] **Step 3: Write `admin/stats/route.ts`**

```typescript
// fe/src/app/api/admin/stats/route.ts
import { NextResponse } from 'next/server';
import { sessionBackendFetch } from '@/lib/session-backend';

export async function GET() {
  const res = await sessionBackendFetch('/admin/stats');
  const body = await res.text();
  return new NextResponse(body, { status: res.status, headers: { 'content-type': 'application/json' } });
}
```

- [ ] **Step 4: Typecheck**

Run: `cd fe && pnpm exec tsc --noEmit 2>&1 | grep -i "api/\(merchant\|admin\)/stats"`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add fe/src/app/api/merchant/stats/route.ts fe/src/app/api/admin/stats/route.ts
git commit -m "feat(fe): proxy route handlers for merchant/admin stats"
```

---

## PHASE F — Overview pages

### Task 14: Merchant Overview page

**Files:**
- Modify: `fe/src/app/merchant/page.tsx`
- Reference (do not rewrite): `fe/src/app/merchant/ApiKeyPanel.tsx`, `fe/src/app/merchant/WalletConnectClient.tsx`

- [ ] **Step 1: Read the current page to preserve its data + logout logic**

Run: `cd fe && cat src/app/merchant/page.tsx`
Identify: how it's rendered (server vs client), how logout is triggered (existing `LogoutButton`/fetch to `/api/auth/logout`), and how `ApiKeyPanel` / `WalletConnect` are mounted. Preserve all of that.

- [ ] **Step 2: Rewrite the page as a client Overview inside AppShell**

Replace the page body with a client component that fetches `/api/merchant/stats`, renders the hero + stat cards + chart + recent orders (polling every 4s) + the existing panels. Full implementation:

```tsx
// fe/src/app/merchant/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/ui/AppShell';
import { TopBar } from '@/ui/TopBar';
import { StatCard } from '@/ui/StatCard';
import { TrendChart } from '@/ui/TrendChart';
import { DataTable, Column } from '@/ui/DataTable';
import { Text } from '@/ui/Text';
import { Pill } from '@/ui/Bits';
import { colors, space } from '@/ui/theme';
import { formatUsdc } from '@/lib/dashboard/stats';
import { statusTone } from '@/lib/dashboard/status';
import type { NavItem } from '@/ui/Sidebar';
import ApiKeyPanel from './ApiKeyPanel';
import WalletConnectClient from './WalletConnectClient';

const NAV: NavItem[] = [
  { href: '/merchant', label: 'Overview', icon: 'chart' },
  { href: '/merchant/orders', label: 'Orders', icon: 'orders' },
  { href: '/merchant/orders/new', label: 'New Invoice', icon: 'plus' },
];

interface Stats { totalRevenue: string; paidCount: number; awaitingCount: number; expiredCount: number; series: { date: string; amount: string }[]; }
interface Order { id: string; reference: string; amount: string; status: string; }

export default function MerchantOverview() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [s, o] = await Promise.all([
          fetch('/api/merchant/stats').then((r) => (r.ok ? r.json() : Promise.reject())),
          fetch('/api/merchant/orders?status=all&take=6').then((r) => (r.ok ? r.json() : [])),
        ]);
        if (!alive) return;
        setStats(s); setOrders(o);
      } catch { if (alive) setErr(true); }
    };
    load();
    const t = setInterval(load, 4000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const logout = async () => { await fetch('/api/auth/logout', { method: 'POST' }); router.push('/merchant/login'); };

  const cols: Column<Order>[] = [
    { key: 'ref', header: 'Reference', render: (o) => <Text variant="bodyStrong" color={colors.textHi}>{o.reference}</Text> },
    { key: 'amt', header: 'Amount', align: 'right', render: (o) => <Text variant="body" numeric>{formatUsdc(o.amount)} USDC</Text> },
    { key: 'st', header: 'Status', align: 'right', render: (o) => { const t = statusTone(o.status); return <Pill label={t.label} tone={t.tone} />; } },
  ];

  const series = (stats?.series ?? []).map((p) => ({ date: p.date, value: Number(p.amount) / 1_000_000 }));

  return (
    <AppShell items={NAV} identity={{ title: 'Merchant', subtitle: 'Dashboard' }} onLogout={logout}>
      <TopBar eyebrow="Merchant" title="Overview" />
      {err && <div style={{ marginBottom: space.lg }}><Text variant="caption" color={colors.danger}>Couldn’t load metrics — showing what we have.</Text></div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: space.lg, marginBottom: space.xl }}>
        <StatCard featured label="Total revenue" value={`${formatUsdc(stats?.totalRevenue ?? '0')} USDC`} delta={stats ? `${stats.paidCount} paid` : null} />
        <StatCard label="Paid" value={String(stats?.paidCount ?? 0)} icon="check" />
        <StatCard label="Awaiting" value={String(stats?.awaitingCount ?? 0)} icon="clock" />
        <StatCard label="Expired" value={String(stats?.expiredCount ?? 0)} icon="bolt" />
      </div>
      <div style={{ marginBottom: space.xl }}>
        <TrendChart title="Paid volume · last 30 days" series={series} />
      </div>
      <div style={{ marginBottom: space.xl }}>
        <Text variant="h3" color={colors.textHi} style={{ marginBottom: space.md }}>Recent orders</Text>
        <DataTable columns={cols} rows={orders} empty="No orders yet" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: space.lg }}>
        <ApiKeyPanel />
        <WalletConnectClient />
      </div>
    </AppShell>
  );
}
```

> Adjust the import paths of `ApiKeyPanel` / `WalletConnectClient` and their prop requirements to match their real signatures (from Step 1). If a panel is a default vs named export, match it. If the `@/` alias is not configured, use relative paths (`../../ui/...`).

- [ ] **Step 3: Typecheck + build**

Run: `cd fe && pnpm exec tsc --noEmit && pnpm build`
Expected: build succeeds. Fix any import/prop mismatches surfaced.

- [ ] **Step 4: Commit**

```bash
git add fe/src/app/merchant/page.tsx
git commit -m "feat(fe): merchant Overview — hero, stat cards, trend chart, recent orders, panels"
```

---

### Task 15: Admin Overview page

**Files:**
- Modify: `fe/src/app/admin/page.tsx`

- [ ] **Step 1: Read the current admin landing page**

Run: `cd fe && cat src/app/admin/page.tsx`
Preserve logout + any redirect logic.

- [ ] **Step 2: Rewrite as the admin Overview inside AppShell**

```tsx
// fe/src/app/admin/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/ui/AppShell';
import { TopBar } from '@/ui/TopBar';
import { StatCard } from '@/ui/StatCard';
import { TrendChart } from '@/ui/TrendChart';
import { DataTable, Column } from '@/ui/DataTable';
import { Text } from '@/ui/Text';
import { Pill } from '@/ui/Bits';
import { colors, space } from '@/ui/theme';
import { formatUsdc } from '@/lib/dashboard/stats';
import { statusTone } from '@/lib/dashboard/status';
import type { NavItem } from '@/ui/Sidebar';

const NAV: NavItem[] = [
  { href: '/admin', label: 'Overview', icon: 'chart' },
  { href: '/admin/merchants', label: 'Merchants', icon: 'store' },
];

interface AdminStats {
  merchantsTotal: number; pending: number; approved: number; rejected: number; onchainRegistered: number;
  ordersTotal: number; volumeTotal: string; series: { date: string; amount: string }[];
  recentPending: { id: string; businessName: string; createdAt: string }[];
  recentPayments: { id: string; reference: string; amount: string; status: string }[];
}

export default function AdminOverview() {
  const router = useRouter();
  const [s, setS] = useState<AdminStats | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const data = await fetch('/api/admin/stats').then((r) => (r.ok ? r.json() : Promise.reject()));
        if (alive) setS(data);
      } catch { if (alive) setErr(true); }
    };
    load();
    const t = setInterval(load, 8000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const logout = async () => { await fetch('/api/auth/logout', { method: 'POST' }); router.push('/admin/login'); };

  const pendingCols: Column<{ id: string; businessName: string }>[] = [
    { key: 'name', header: 'Business', render: (m) => <Text variant="bodyStrong" color={colors.textHi}>{m.businessName}</Text> },
    { key: 'act', header: 'Review', align: 'right', render: (m) => <Link href={`/admin/merchants/${m.id}`}><Text variant="bodyStrong" color={colors.accent}>Review →</Text></Link> },
  ];
  const payCols: Column<{ reference: string; amount: string; status: string }>[] = [
    { key: 'ref', header: 'Reference', render: (o) => <Text variant="bodyStrong" color={colors.textHi}>{o.reference}</Text> },
    { key: 'amt', header: 'Amount', align: 'right', render: (o) => <Text variant="body" numeric>{formatUsdc(o.amount)} USDC</Text> },
    { key: 'st', header: 'Status', align: 'right', render: (o) => { const t = statusTone(o.status); return <Pill label={t.label} tone={t.tone} />; } },
  ];

  const series = (s?.series ?? []).map((p) => ({ date: p.date, value: Number(p.amount) / 1_000_000 }));

  return (
    <AppShell items={NAV} identity={{ title: 'Admin', subtitle: 'Platform' }} onLogout={logout}>
      <TopBar eyebrow="Admin" title="Overview" />
      {err && <div style={{ marginBottom: space.lg }}><Text variant="caption" color={colors.danger}>Couldn’t load metrics.</Text></div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: space.lg, marginBottom: space.xl }}>
        <StatCard label="Merchants" value={String(s?.merchantsTotal ?? 0)} icon="store" />
        <StatCard label="Pending" value={String(s?.pending ?? 0)} icon="clock" onClick={() => router.push('/admin/merchants?status=pending')} />
        <StatCard label="Approved / on-chain" value={`${s?.approved ?? 0} / ${s?.onchainRegistered ?? 0}`} icon="shield" />
        <StatCard featured label="Total volume" value={`${formatUsdc(s?.volumeTotal ?? '0')} USDC`} delta={s ? `${s.ordersTotal} orders` : null} />
      </div>
      <div style={{ marginBottom: space.xl }}>
        <TrendChart title="Platform volume · last 30 days" series={series} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: space.lg }}>
        <div>
          <Text variant="h3" color={colors.textHi} style={{ marginBottom: space.md }}>Pending review</Text>
          <DataTable columns={pendingCols} rows={s?.recentPending ?? []} empty="No pending merchants" />
        </div>
        <div>
          <Text variant="h3" color={colors.textHi} style={{ marginBottom: space.md }}>Recent payments</Text>
          <DataTable columns={payCols} rows={s?.recentPayments ?? []} empty="No payments yet" />
        </div>
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 3: Typecheck + build**

Run: `cd fe && pnpm exec tsc --noEmit && pnpm build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add fe/src/app/admin/page.tsx
git commit -m "feat(fe): admin Overview — platform stat cards, volume chart, pending + recent lists"
```

---

## PHASE G — Restyle inner pages + logins

> These are presentation swaps: keep the exact data fetching, polling, form submission, and auth logic already in each file; only replace the JSX/markup with Navy primitives. For each: read the file first, then re-house it. Wrap admin/merchant authenticated pages in `<AppShell items={NAV} ...>` (reuse the `NAV` arrays from Tasks 14/15 — extract each to a small shared module `fe/src/ui/nav.ts` exporting `ADMIN_NAV` and `MERCHANT_NAV` to stay DRY).

### Task 16: Extract shared NAV config

**Files:**
- Create: `fe/src/ui/nav.ts`
- Modify: `fe/src/app/merchant/page.tsx`, `fe/src/app/admin/page.tsx` (import from `nav.ts`)

- [ ] **Step 1: Create `nav.ts`**

```typescript
// fe/src/ui/nav.ts
import type { NavItem } from './Sidebar';

export const ADMIN_NAV: NavItem[] = [
  { href: '/admin', label: 'Overview', icon: 'chart' },
  { href: '/admin/merchants', label: 'Merchants', icon: 'store' },
];

export const MERCHANT_NAV: NavItem[] = [
  { href: '/merchant', label: 'Overview', icon: 'chart' },
  { href: '/merchant/orders', label: 'Orders', icon: 'orders' },
  { href: '/merchant/orders/new', label: 'New Invoice', icon: 'plus' },
];
```

- [ ] **Step 2: Replace the inline `NAV` consts in the two Overview pages with imports**

In `admin/page.tsx`: delete the local `NAV` and `import { ADMIN_NAV } from '@/ui/nav';`, use `items={ADMIN_NAV}`.
In `merchant/page.tsx`: same with `MERCHANT_NAV`.

- [ ] **Step 3: Typecheck + commit**

Run: `cd fe && pnpm exec tsc --noEmit`

```bash
git add fe/src/ui/nav.ts fe/src/app/admin/page.tsx fe/src/app/merchant/page.tsx
git commit -m "refactor(fe): shared ADMIN_NAV/MERCHANT_NAV config"
```

---

### Task 17: Restyle admin merchants list

**Files:**
- Modify: `fe/src/app/admin/merchants/page.tsx`

- [ ] **Step 1: Read the file** — `cd fe && cat src/app/admin/merchants/page.tsx`. Note: server or client? how it reads the `status` query param and fetches `/api/admin/merchants?status=`. Preserve that.

- [ ] **Step 2: Re-house in AppShell + DataTable + status filter chips**

Keep the data fetch identical; render results through `DataTable` with columns Business / Email / Status (`Pill` via `statusTone(approvalStatus)`) / Payout (registered ✓ or —) / Review link. Render the status filter as a row of pill buttons (`pending`/`approved`/`rejected`/`all`) that update the query (same mechanism the current page uses — `Link`s or `router.push`). Wrap everything in `<AppShell items={ADMIN_NAV} identity={{title:'Admin',subtitle:'Platform'}} onLogout={...}>` and a `<TopBar eyebrow="Admin" title="Merchants" />`. Use `colors`, `space` for layout. For the payout column: `row.payoutAddress ? '✓ registered' : '—'` rendered with `Text` (success color when present).

- [ ] **Step 3: Typecheck + build** — `cd fe && pnpm exec tsc --noEmit && pnpm build`. Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add fe/src/app/admin/merchants/page.tsx
git commit -m "feat(fe): restyle admin merchants list (DataTable + status pills)"
```

---

### Task 18: Restyle admin merchant detail

**Files:**
- Modify: `fe/src/app/admin/merchants/[id]/page.tsx`
- Reference: `fe/src/app/admin/merchants/[id]/Actions.tsx` (keep its approve/reject logic; restyle its buttons to `Button` primitives)

- [ ] **Step 1: Read both files.** Preserve the approve/reject API calls, the Approve-disabled-without-payout rule, and the on-chain tx explorer link.

- [ ] **Step 2: Re-house detail as `Field` rows in a `Card`.** Wrap in `AppShell` + `TopBar eyebrow="Merchant" title={businessName}`. Render: email, status (`Pill`), payout address (`Field mono`), on-chain tx (link to Solana explorer, keep existing URL), rejection reason (if any, `colors.danger`). In `Actions.tsx`, swap raw `<button>`s for `<Button variant="primary" label="Approve" .../>` and `<Button variant="danger" label="Reject" .../>`, keeping the exact click handlers and the `disabled={!payoutAddress}` logic.

- [ ] **Step 3: Typecheck + build.**

- [ ] **Step 4: Commit**

```bash
git add "fe/src/app/admin/merchants/[id]/page.tsx" "fe/src/app/admin/merchants/[id]/Actions.tsx"
git commit -m "feat(fe): restyle admin merchant detail (Field rows + Button actions)"
```

---

### Task 19: Restyle merchant orders list

**Files:**
- Modify: `fe/src/app/merchant/orders/page.tsx`

- [ ] **Step 1: Read the file.** Preserve the 4s polling and the `status` filter fetch to `/api/merchant/orders?status=`.

- [ ] **Step 2: Re-house in AppShell + DataTable.** Columns: Reference / Amount (`formatUsdc` + ` USDC`) / Status (`Pill`) / View (`Link` to `/merchant/orders/[id]`). Status filter chips (`all`/`awaiting_payment`/`paid`/`expired`) using the page's existing filter mechanism. `TopBar eyebrow="Merchant" title="Orders"` with a "New invoice" `Button` on the right (`right={...}` prop) linking to `/merchant/orders/new`.

- [ ] **Step 3: Typecheck + build.**

- [ ] **Step 4: Commit**

```bash
git add fe/src/app/merchant/orders/page.tsx
git commit -m "feat(fe): restyle merchant orders list (DataTable + polling preserved)"
```

---

### Task 20: Restyle create-invoice + order detail

**Files:**
- Modify: `fe/src/app/merchant/orders/new/page.tsx`
- Modify: `fe/src/app/merchant/orders/[id]/page.tsx`

- [ ] **Step 1: Read both.** Preserve: `money.ts` validation on the amount, the create POST, the QR/payUrl/orderId success render, the 409 "not approved" handling; and the detail page's 4s polling that stops on terminal status.

- [ ] **Step 2: Restyle create form.** Wrap in `AppShell` + `TopBar title="New invoice"`. Inputs inside a `Card`; use styled `<input>`s (bgElevated background, `borderStrong` border, `radius.md`, `colors.text`); submit via `<Button label="Create invoice" loading={...} />`. Keep validation + error text (`colors.danger`). On success render the QR image + payUrl + orderId in a result `Card` with a copy control.

- [ ] **Step 3: Restyle order detail.** Wrap in `AppShell` + `TopBar title={reference}`. `Field` rows for amount, status (`Pill`, live), payer (`mono`), tx signature (explorer link). Keep the polling effect verbatim.

- [ ] **Step 4: Typecheck + build.**

- [ ] **Step 5: Commit**

```bash
git add fe/src/app/merchant/orders/new/page.tsx "fe/src/app/merchant/orders/[id]/page.tsx"
git commit -m "feat(fe): restyle create-invoice + order detail"
```

---

### Task 21: Restyle login pages (AuthCard)

**Files:**
- Modify: `fe/src/app/admin/login/page.tsx`
- Modify: `fe/src/app/merchant/login/page.tsx`

- [ ] **Step 1: Read both.** Preserve ALL auth logic: admin email+password+TOTP submit, merchant login/signup toggle + businessName field, redirects on success, error display.

- [ ] **Step 2: Re-house each form in `<AuthCard title=... subtitle=...>`** (no AppShell — login has no sidebar). Replace raw inputs with styled inputs (same style as Task 20 Step 2) and the submit with `<Button>`. Keep field names, state, and submit handlers exactly. Admin: title "Admin sign in". Merchant: title toggles "Sign in" / "Create merchant account".

- [ ] **Step 3: Typecheck + build.**

- [ ] **Step 4: Commit**

```bash
git add fe/src/app/admin/login/page.tsx fe/src/app/merchant/login/page.tsx
git commit -m "feat(fe): restyle admin + merchant login in AuthCard"
```

---

### Task 22: Restyle the public landing (`/`)

**Files:**
- Modify: `fe/src/app/page.tsx`

- [ ] **Step 1: Read it.** It links to `/admin/login` and `/merchant/login`.

- [ ] **Step 2: Re-house in an `AuthCard`-style centered panel** with two `Button`s (Admin / Merchant) linking to the two logins. Title "Navy", subtitle "Payments back-office". Keep the links identical.

- [ ] **Step 3: Typecheck + build. Commit.**

```bash
git add fe/src/app/page.tsx
git commit -m "feat(fe): restyle public landing with Navy AuthCard"
```

---

## PHASE H — Final verification

### Task 23: Full verification sweep

- [ ] **Step 1: Backend — full unit suite + build**

Run: `cd be && pnpm test && pnpm build`
Expected: all specs PASS (including `stats.util`, `merchant-stats`, `admin-stats`); build clean.

- [ ] **Step 2: Frontend — logic tests, typecheck, and the real build gate**

Run: `cd fe && pnpm test && pnpm exec tsc --noEmit && pnpm build`
Expected: `lib/dashboard/*` tests PASS; `tsc` clean; **`next build` succeeds** (no `@solana/web3.js` Buffer/crypto bundle errors from the re-housed `WalletConnect`). If a Buffer/crypto error appears, add the polyfill per CLAUDE.md (`resolve.fallback` in `next.config.ts` or a client `globalThis.Buffer ??= Buffer`) and rebuild.

- [ ] **Step 3: Manual smoke (requires `be` up + DB) — optional but recommended**

Run `cd be && pnpm start` and `cd fe && pnpm dev`, then in a browser:
- `/admin/login` and `/merchant/login` render in AuthCard; auth still works.
- Admin Overview: stat cards populated, chart draws, pending/recent lists render, sidebar active state on `/admin`.
- Merchant Overview: hero revenue + cards, chart, recent orders update, API + Payout panels functional.
- Merchant orders list still live-updates every 4s; create-invoice produces a QR; order detail polls to `paid`.

- [ ] **Step 4: Confirm the diff is presentation + additive-endpoints only**

Run: `git diff --stat main -- be/` — should show only the new stats files + module/controller wiring (no schema, no payment/auth logic changes).

- [ ] **Step 5: Final commit (if any fixups) + summary**

```bash
git add -A && git commit -m "chore(fe): dashboard redesign verification fixups" || echo "nothing to fix up"
```

---

## Self-Review Notes (author)

- **Spec coverage:** design-system port (Tasks 5-7,11-12) ✓; sidebar shell (11) ✓; admin/merchant Overviews with stat cards + chart + lists (14-15) ✓; restyled inner pages + logins (17-22) ✓; two read-only backend endpoints, money-as-string, no schema change (1-4) ✓; pure-logic helpers unit-tested (8-10) ✓; verification incl. `next build` gate (23) ✓.
- **Types consistent:** `SeriesBucket {date, amount:string}` (be) → mapped to `SeriesPoint {date, value:number}` (fe chart) at the page boundary; `formatUsdc` takes base-unit strings everywhere; `statusTone` returns `{tone,label}` used identically in both Overviews.
- **No placeholders:** backend services, pure helpers, and all new UI primitives have complete code; page-restyle tasks give explicit preserve-the-logic instructions plus full code for the two centerpiece Overviews.
- **Known adaptation points flagged inline:** exact `theme.ts` export shapes, `sessionBackendFetch` import path, `ApiKeyPanel`/`WalletConnectClient` export style, and the `@/` alias — each step says to reconcile against the real file.
