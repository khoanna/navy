# Merchant Product Catalog + Line-Item Invoices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let merchants manage a product/SKU catalog, configure tax + service charges once in Settings, and build invoices from line items (product × quantity) with an auto-generated `ORD-…` reference — everything itemized on the merchant order detail and the payer's pay page.

**Architecture:** New Prisma models (`Product`, `MerchantCharge`, `OrderItem`, `OrderCharge`) plus `Order` columns. A shared plain-TS `computeInvoiceTotals` helper is the single source of money math, mirrored in `be` (authoritative) and `fe` (preview). Backend gains merchant-scoped CRUD for products and charges, and reworks order creation to accept `{ items, description? }`, snapshotting product prices and applied charges. Frontend adds a Products page, a Charges section in Settings, and a line-item invoice builder; the web-wallet pay page renders the itemized breakdown.

**Tech Stack:** Nest.js 11 + Prisma 7 (Postgres, BigInt money), Next.js 16 App Router (React 19), Jest, class-validator.

**Spec:** `docs/superpowers/specs/2026-07-05-merchant-catalog-invoices-design.md`

---

## File Structure

**Backend (`be/`)**
- `prisma/schema.prisma` — modify: add 4 models + `Order` columns.
- `src/payments/invoice-totals.ts` — create: shared money math (authoritative copy).
- `src/payments/invoice-totals.spec.ts` — create: unit tests.
- `src/payments/order-reference.ts` — create: `generateOrderReference()`.
- `src/products/products.service.ts` / `products.controller.ts` / `products.module.ts` — create: catalog CRUD.
- `src/products/products.service.spec.ts` — create.
- `src/merchant/merchant-charges.service.ts` / `merchant-charges.controller.ts` — create: charges CRUD (wired into `MerchantModule`).
- `src/merchant/merchant-charges.service.spec.ts` — create.
- `src/payments/orders.service.ts` — modify: `create` takes items+charges; `serialize`/detail include breakdown.
- `src/payments/orders.service.spec.ts` — modify.
- `src/payments/merchant-orders.controller.ts` — modify: new DTO.
- `src/payments/orders.controller.ts` — modify: API-key create DTO + public order payload.
- `src/app.module.ts` — modify: register `ProductsModule`.

**Frontend (`fe/`)**
- `src/lib/invoice-totals.ts` + `src/lib/invoice-totals.test.ts` — create: mirror helper + tests.
- `src/ui/nav.ts` — modify: add Products tab.
- `src/app/merchant/products/page.tsx` + `ProductForm.tsx` — create: catalog page.
- `src/app/api/merchant/products/route.ts` + `[id]/route.ts` — create: proxy routes.
- `src/app/api/merchant/charges/route.ts` + `[id]/route.ts` — create: proxy routes.
- `src/app/merchant/settings/ChargesPanel.tsx` — create; wire into `settings/page.tsx`.
- `src/app/merchant/orders/NewInvoiceForm.tsx` — modify: line-item builder.
- `src/app/merchant/orders/[id]/page.tsx` — modify: itemized detail.

**Web-wallet (`web-wallet/`)**
- `src/app/pay/[orderId]/page.tsx` — modify: itemized breakdown.

---

## Phase 1 — Backend data model

### Task 1: Prisma schema — new models + Order columns

**Files:**
- Modify: `be/prisma/schema.prisma`

- [ ] **Step 1: Add the four new models** at the end of `schema.prisma`:

```prisma
model Product {
  id         String   @id @default(uuid())
  merchantId String
  merchant   Merchant @relation(fields: [merchantId], references: [id])
  name       String
  sku        String?
  unitPrice  BigInt
  active     Boolean  @default(true)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}

model MerchantCharge {
  id         String   @id @default(uuid())
  merchantId String
  merchant   Merchant @relation(fields: [merchantId], references: [id])
  name       String
  mode       String
  value      Int
  active     Boolean  @default(true)
  sortOrder  Int      @default(0)
  createdAt  DateTime @default(now())
}

model OrderItem {
  id        String @id @default(uuid())
  orderId   String
  order     Order  @relation(fields: [orderId], references: [id])
  productId String?
  name      String
  unitPrice BigInt
  quantity  Int
}

model OrderCharge {
  id      String @id @default(uuid())
  orderId String
  order   Order  @relation(fields: [orderId], references: [id])
  name    String
  mode    String
  value   Int
  amount  BigInt
}
```

- [ ] **Step 2: Add columns + relations to `Order`.** In the `model Order` block, add after `reference`:

```prisma
  subtotal         BigInt?
  description      String?
```
and add near the `webhooks` relation line:
```prisma
  items            OrderItem[]
  charges          OrderCharge[]
```

- [ ] **Step 3: Add back-relations to `Merchant`.** In `model Merchant`, add:
```prisma
  products         Product[]
  chargeSettings   MerchantCharge[]
```

- [ ] **Step 4: Run the migration.**

Run: `DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2-)" pnpm prisma migrate dev --name catalog_charges_line_items`
Expected: migration created + applied; Prisma client regenerated.

- [ ] **Step 5: Verify the client picks up new models.**

Run: `pnpm prisma generate && pnpm build`
Expected: build succeeds (no unknown-model errors).

- [ ] **Step 6: Commit.**

```bash
git add be/prisma/schema.prisma be/prisma/migrations
git commit -m "feat(be): schema for product catalog, charges, order line items"
```

---

## Phase 2 — Shared money math

### Task 2: `computeInvoiceTotals` helper (backend, authoritative)

**Files:**
- Create: `be/src/payments/invoice-totals.ts`
- Test: `be/src/payments/invoice-totals.spec.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { computeInvoiceTotals } from './invoice-totals';

describe('computeInvoiceTotals', () => {
  it('sums line items into subtotal', () => {
    const r = computeInvoiceTotals(
      [{ unitPrice: 1_000_000n, quantity: 2 }, { unitPrice: 500_000n, quantity: 1 }],
      [],
    );
    expect(r.subtotal).toBe(2_500_000n);
    expect(r.total).toBe(2_500_000n);
    expect(r.charges).toEqual([]);
  });

  it('applies a percent charge on the subtotal (floored)', () => {
    const r = computeInvoiceTotals(
      [{ unitPrice: 1_000_001n, quantity: 1 }],
      [{ name: 'VAT', mode: 'percent', value: 1000 }], // 10%
    );
    expect(r.charges[0].amount).toBe(100_000n); // floor(1_000_001 * 1000 / 10000)
    expect(r.total).toBe(1_100_001n);
  });

  it('applies a fixed charge as a flat base-unit amount', () => {
    const r = computeInvoiceTotals(
      [{ unitPrice: 1_000_000n, quantity: 1 }],
      [{ name: 'Service', mode: 'fixed', value: 250_000 }],
    );
    expect(r.charges[0].amount).toBe(250_000n);
    expect(r.total).toBe(1_250_000n);
  });

  it('applies multiple charges independently on the subtotal', () => {
    const r = computeInvoiceTotals(
      [{ unitPrice: 2_000_000n, quantity: 1 }],
      [{ name: 'VAT', mode: 'percent', value: 1000 }, { name: 'Svc', mode: 'fixed', value: 100_000 }],
    );
    expect(r.total).toBe(2_000_000n + 200_000n + 100_000n);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

Run: `pnpm test invoice-totals`
Expected: FAIL — cannot find module './invoice-totals'.

- [ ] **Step 3: Implement the helper.**

```ts
export type ChargeMode = 'percent' | 'fixed';
export interface TotalsItem { unitPrice: bigint; quantity: number; }
export interface TotalsCharge { name: string; mode: ChargeMode; value: number; }
export interface AppliedCharge { name: string; mode: ChargeMode; value: number; amount: bigint; }
export interface InvoiceTotals { subtotal: bigint; charges: AppliedCharge[]; total: bigint; }

/**
 * Authoritative invoice money math. All integer base units (USDC 6dp).
 * Percent charges compute on the SKU subtotal (no compounding); fixed charges
 * add a flat base-unit amount. Integer division floors each percent charge.
 */
export function computeInvoiceTotals(items: TotalsItem[], charges: TotalsCharge[]): InvoiceTotals {
  const subtotal = items.reduce((s, it) => s + it.unitPrice * BigInt(it.quantity), 0n);
  const applied: AppliedCharge[] = charges.map((c) => ({
    name: c.name,
    mode: c.mode,
    value: c.value,
    amount: c.mode === 'percent' ? (subtotal * BigInt(c.value)) / 10000n : BigInt(c.value),
  }));
  const total = applied.reduce((s, c) => s + c.amount, subtotal);
  return { subtotal, charges: applied, total };
}
```

- [ ] **Step 4: Run to verify it passes.**

Run: `pnpm test invoice-totals`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit.**

```bash
git add be/src/payments/invoice-totals.ts be/src/payments/invoice-totals.spec.ts
git commit -m "feat(be): shared invoice totals helper (subtotal + charges)"
```

### Task 3: `generateOrderReference()`

**Files:**
- Create: `be/src/payments/order-reference.ts`
- Test: `be/src/payments/order-reference.spec.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { generateOrderReference } from './order-reference';

describe('generateOrderReference', () => {
  it('produces an ORD- prefixed 8-char Crockford-base32 code', () => {
    const ref = generateOrderReference();
    expect(ref).toMatch(/^ORD-[0-9A-HJKMNP-TV-Z]{8}$/);
  });
  it('is effectively unique across many calls', () => {
    const set = new Set(Array.from({ length: 1000 }, () => generateOrderReference()));
    expect(set.size).toBe(1000);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

Run: `pnpm test order-reference`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement.**

```ts
import { randomBytes } from 'crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32 (no I,L,O,U)

/** Random human-facing order reference: `ORD-` + 8 Crockford-base32 chars (40 bits). */
export function generateOrderReference(): string {
  const bytes = randomBytes(5); // 40 bits → 8 base32 chars
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  let out = '';
  for (let i = 0; i < 8; i++) {
    out = ALPHABET[Number(bits & 31n)] + out;
    bits >>= 5n;
  }
  return `ORD-${out}`;
}
```

- [ ] **Step 4: Run to verify it passes.**

Run: `pnpm test order-reference`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add be/src/payments/order-reference.ts be/src/payments/order-reference.spec.ts
git commit -m "feat(be): auto-generated ORD- order reference"
```

---

## Phase 3 — Backend Products CRUD

### Task 4: ProductsService

**Files:**
- Create: `be/src/products/products.service.ts`
- Test: `be/src/products/products.service.spec.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { ProductsService } from './products.service';
import { NotFoundException } from '@nestjs/common';

const prisma = {
  product: {
    findMany: jest.fn(),
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
} as any;

describe('ProductsService', () => {
  let svc: ProductsService;
  beforeEach(() => { jest.clearAllMocks(); svc = new ProductsService(prisma); });

  it('creates a product scoped to the merchant, serializing BigInt price', async () => {
    prisma.product.create.mockResolvedValue({ id: 'p1', merchantId: 'm1', name: 'Tee', sku: 'T', unitPrice: 1_000_000n, active: true });
    const r = await svc.create('m1', { name: 'Tee', sku: 'T', unitPrice: 1_000_000n });
    expect(prisma.product.create).toHaveBeenCalledWith({ data: { merchantId: 'm1', name: 'Tee', sku: 'T', unitPrice: 1_000_000n } });
    expect(r.unitPrice).toBe('1000000');
  });

  it('lists a merchant’s products', async () => {
    prisma.product.findMany.mockResolvedValue([{ id: 'p1', merchantId: 'm1', name: 'Tee', sku: null, unitPrice: 1_000_000n, active: true }]);
    const r = await svc.listForMerchant('m1');
    expect(prisma.product.findMany).toHaveBeenCalledWith({ where: { merchantId: 'm1' }, orderBy: { createdAt: 'desc' } });
    expect(r[0].unitPrice).toBe('1000000');
  });

  it('rejects update of a product not owned by the merchant', async () => {
    prisma.product.findFirst.mockResolvedValue(null);
    await expect(svc.update('m1', 'pX', { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('archives via update active=false', async () => {
    prisma.product.findFirst.mockResolvedValue({ id: 'p1', merchantId: 'm1' });
    prisma.product.update.mockResolvedValue({ id: 'p1', merchantId: 'm1', name: 'Tee', sku: null, unitPrice: 1_000_000n, active: false });
    const r = await svc.archive('m1', 'p1');
    expect(prisma.product.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { active: false } });
    expect(r.active).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

Run: `pnpm test products.service`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement.**

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateProductInput { name: string; sku?: string | null; unitPrice: bigint; }
export interface UpdateProductInput { name?: string; sku?: string | null; unitPrice?: bigint; active?: boolean; }

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  private serialize(p: any) {
    return { id: p.id, name: p.name, sku: p.sku ?? null, unitPrice: p.unitPrice.toString(), active: p.active };
  }

  async listForMerchant(merchantId: string) {
    const rows = await this.prisma.product.findMany({ where: { merchantId }, orderBy: { createdAt: 'desc' } });
    return rows.map((p) => this.serialize(p));
  }

  async create(merchantId: string, input: CreateProductInput) {
    const p = await this.prisma.product.create({
      data: { merchantId, name: input.name, sku: input.sku ?? null, unitPrice: input.unitPrice },
    });
    return this.serialize(p);
  }

  private async own(merchantId: string, id: string) {
    const p = await this.prisma.product.findFirst({ where: { id, merchantId } });
    if (!p) throw new NotFoundException('Product not found');
    return p;
  }

  async update(merchantId: string, id: string, input: UpdateProductInput) {
    await this.own(merchantId, id);
    const data: any = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.sku !== undefined) data.sku = input.sku;
    if (input.unitPrice !== undefined) data.unitPrice = input.unitPrice;
    if (input.active !== undefined) data.active = input.active;
    const p = await this.prisma.product.update({ where: { id }, data });
    return this.serialize(p);
  }

  async archive(merchantId: string, id: string) {
    await this.own(merchantId, id);
    const p = await this.prisma.product.update({ where: { id }, data: { active: false } });
    return this.serialize(p);
  }
}
```

- [ ] **Step 4: Run to verify it passes.**

Run: `pnpm test products.service`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit.**

```bash
git add be/src/products/products.service.ts be/src/products/products.service.spec.ts
git commit -m "feat(be): products (SKU catalog) service"
```

### Task 5: ProductsController + module

**Files:**
- Create: `be/src/products/products.controller.ts`
- Create: `be/src/products/products.module.ts`
- Modify: `be/src/app.module.ts`

- [ ] **Step 1: Write the controller.**

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ProductsService } from './products.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { parsePositiveAmount } from '../common/amount.util';

class CreateProductDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @IsOptional() sku?: string;
  @IsString() @Matches(/^\d+$/, { message: 'unitPrice must be a base-unit integer string' }) unitPrice!: string;
}
class UpdateProductDto {
  @IsString() @IsOptional() @IsNotEmpty() name?: string;
  @IsString() @IsOptional() sku?: string;
  @IsString() @IsOptional() @Matches(/^\d+$/, { message: 'unitPrice must be a base-unit integer string' }) unitPrice?: string;
  @IsBoolean() @IsOptional() active?: boolean;
}

@Controller('merchant/products')
@UseGuards(JwtGuard, RolesGuard)
@Roles('merchant')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(@Req() req: any) {
    return this.products.listForMerchant(req.user.sub);
  }

  @Post()
  create(@Req() req: any, @Body() dto: CreateProductDto) {
    return this.products.create(req.user.sub, { name: dto.name, sku: dto.sku ?? null, unitPrice: parsePositiveAmount(dto.unitPrice, 'unitPrice') });
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.products.update(req.user.sub, id, {
      name: dto.name,
      sku: dto.sku,
      unitPrice: dto.unitPrice !== undefined ? parsePositiveAmount(dto.unitPrice, 'unitPrice') : undefined,
      active: dto.active,
    });
  }

  @Delete(':id')
  archive(@Req() req: any, @Param('id') id: string) {
    return this.products.archive(req.user.sub, id);
  }
}
```

- [ ] **Step 2: Write the module.**

```ts
import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';

@Module({ controllers: [ProductsController], providers: [ProductsService] })
export class ProductsModule {}
```

- [ ] **Step 3: Register in `app.module.ts`.** Add `import { ProductsModule } from './products/products.module';` and add `ProductsModule` to the `imports: [...]` array of `AppModule`.

- [ ] **Step 4: Build to verify wiring.**

Run: `pnpm build`
Expected: PASS (PrismaService is global or already provided app-wide; if Nest reports it can't resolve `PrismaService`, add `PrismaModule` to `ProductsModule` imports — check how `MerchantModule` gets it).

- [ ] **Step 5: Commit.**

```bash
git add be/src/products be/src/app.module.ts
git commit -m "feat(be): products controller + module (merchant CRUD)"
```

---

## Phase 4 — Backend Charges CRUD

### Task 6: MerchantChargesService

**Files:**
- Create: `be/src/merchant/merchant-charges.service.ts`
- Test: `be/src/merchant/merchant-charges.service.spec.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { MerchantChargesService } from './merchant-charges.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

const prisma = {
  merchantCharge: { findMany: jest.fn(), create: jest.fn(), findFirst: jest.fn(), update: jest.fn(), delete: jest.fn() },
} as any;

describe('MerchantChargesService', () => {
  let svc: MerchantChargesService;
  beforeEach(() => { jest.clearAllMocks(); svc = new MerchantChargesService(prisma); });

  it('creates a percent charge', async () => {
    prisma.merchantCharge.create.mockResolvedValue({ id: 'c1', name: 'VAT', mode: 'percent', value: 1000, active: true, sortOrder: 0 });
    const r = await svc.create('m1', { name: 'VAT', mode: 'percent', value: 1000 });
    expect(prisma.merchantCharge.create).toHaveBeenCalledWith({ data: { merchantId: 'm1', name: 'VAT', mode: 'percent', value: 1000, sortOrder: 0 } });
    expect(r.value).toBe(1000);
  });

  it('rejects an invalid mode', async () => {
    await expect(svc.create('m1', { name: 'x', mode: 'bogus' as any, value: 1 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a percent value over 10000 bps', async () => {
    await expect(svc.create('m1', { name: 'x', mode: 'percent', value: 10001 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a negative value', async () => {
    await expect(svc.create('m1', { name: 'x', mode: 'fixed', value: -1 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects update of a charge not owned', async () => {
    prisma.merchantCharge.findFirst.mockResolvedValue(null);
    await expect(svc.update('m1', 'cX', { name: 'y' })).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

Run: `pnpm test merchant-charges.service`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement.**

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type ChargeMode = 'percent' | 'fixed';
export interface CreateChargeInput { name: string; mode: ChargeMode; value: number; sortOrder?: number; }
export interface UpdateChargeInput { name?: string; mode?: ChargeMode; value?: number; active?: boolean; sortOrder?: number; }

@Injectable()
export class MerchantChargesService {
  constructor(private readonly prisma: PrismaService) {}

  private validate(mode: ChargeMode | undefined, value: number | undefined) {
    if (mode !== undefined && mode !== 'percent' && mode !== 'fixed') throw new BadRequestException('mode must be percent or fixed');
    if (value !== undefined) {
      if (!Number.isInteger(value) || value < 0) throw new BadRequestException('value must be a non-negative integer');
      if (mode === 'percent' && value > 10000) throw new BadRequestException('percent value must be ≤ 10000 bps');
    }
  }

  private serialize(c: any) {
    return { id: c.id, name: c.name, mode: c.mode, value: c.value, active: c.active, sortOrder: c.sortOrder };
  }

  async listForMerchant(merchantId: string) {
    const rows = await this.prisma.merchantCharge.findMany({ where: { merchantId }, orderBy: { sortOrder: 'asc' } });
    return rows.map((c) => this.serialize(c));
  }

  /** Active charges in application order — used by order creation. */
  async activeForMerchant(merchantId: string) {
    return this.prisma.merchantCharge.findMany({ where: { merchantId, active: true }, orderBy: { sortOrder: 'asc' } });
  }

  async create(merchantId: string, input: CreateChargeInput) {
    this.validate(input.mode, input.value);
    const c = await this.prisma.merchantCharge.create({
      data: { merchantId, name: input.name, mode: input.mode, value: input.value, sortOrder: input.sortOrder ?? 0 },
    });
    return this.serialize(c);
  }

  private async own(merchantId: string, id: string) {
    const c = await this.prisma.merchantCharge.findFirst({ where: { id, merchantId } });
    if (!c) throw new NotFoundException('Charge not found');
    return c;
  }

  async update(merchantId: string, id: string, input: UpdateChargeInput) {
    const existing = await this.own(merchantId, id);
    this.validate(input.mode ?? (existing.mode as ChargeMode), input.value);
    const data: any = {};
    for (const k of ['name', 'mode', 'value', 'active', 'sortOrder'] as const) {
      if (input[k] !== undefined) data[k] = input[k];
    }
    const c = await this.prisma.merchantCharge.update({ where: { id }, data });
    return this.serialize(c);
  }

  async remove(merchantId: string, id: string) {
    await this.own(merchantId, id);
    await this.prisma.merchantCharge.delete({ where: { id } });
    return { ok: true };
  }
}
```

- [ ] **Step 4: Run to verify it passes.**

Run: `pnpm test merchant-charges.service`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit.**

```bash
git add be/src/merchant/merchant-charges.service.ts be/src/merchant/merchant-charges.service.spec.ts
git commit -m "feat(be): merchant charges (tax/fee) service"
```

### Task 7: MerchantChargesController + module wiring

**Files:**
- Create: `be/src/merchant/merchant-charges.controller.ts`
- Modify: `be/src/merchant/merchant.module.ts`

- [ ] **Step 1: Write the controller.**

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { MerchantChargesService } from './merchant-charges.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

class CreateChargeDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsIn(['percent', 'fixed']) mode!: 'percent' | 'fixed';
  @IsInt() @Min(0) value!: number;
  @IsInt() @IsOptional() sortOrder?: number;
}
class UpdateChargeDto {
  @IsString() @IsOptional() @IsNotEmpty() name?: string;
  @IsIn(['percent', 'fixed']) @IsOptional() mode?: 'percent' | 'fixed';
  @IsInt() @Min(0) @IsOptional() value?: number;
  @IsBoolean() @IsOptional() active?: boolean;
  @IsInt() @IsOptional() sortOrder?: number;
}

@Controller('merchant/charges')
@UseGuards(JwtGuard, RolesGuard)
@Roles('merchant')
export class MerchantChargesController {
  constructor(private readonly charges: MerchantChargesService) {}

  @Get()
  list(@Req() req: any) { return this.charges.listForMerchant(req.user.sub); }

  @Post()
  create(@Req() req: any, @Body() dto: CreateChargeDto) { return this.charges.create(req.user.sub, dto); }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateChargeDto) { return this.charges.update(req.user.sub, id, dto); }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) { return this.charges.remove(req.user.sub, id); }
}
```

- [ ] **Step 2: Wire into `merchant.module.ts`.** Add imports and register:

```ts
import { MerchantChargesService } from './merchant-charges.service';
import { MerchantChargesController } from './merchant-charges.controller';
```
Update the decorator to:
```ts
@Module({
  controllers: [MerchantController, MerchantChargesController],
  providers: [MerchantService, ApiKeyService, MerchantStatsService, MerchantChargesService],
  exports: [MerchantChargesService],
})
export class MerchantModule {}
```

- [ ] **Step 3: Build.**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add be/src/merchant/merchant-charges.controller.ts be/src/merchant/merchant.module.ts
git commit -m "feat(be): merchant charges controller + module wiring"
```

---

## Phase 5 — Backend order creation rework

### Task 8: OrdersService.create from line items

**Files:**
- Modify: `be/src/payments/orders.service.ts`
- Modify: `be/src/payments/orders.service.spec.ts`
- Modify: `be/src/payments/payments.module.ts`

- [ ] **Step 1: Update the failing test** — replace the create-related tests in `orders.service.spec.ts` with the new item-based shape. The service constructor gains a `MerchantChargesService` and a `ProductsService`-free direct prisma read; we inject `charges` and read products via `prisma.product`. New tests:

```ts
// Add to the existing prisma mock: product.findMany, order.create nested
// Construct: new OrdersService(prisma, audit, 'https://pay.navy/pay', 100, charges)
// where `charges` = { activeForMerchant: jest.fn() }

it('creates an order from line items, snapshotting price + applying charges', async () => {
  prisma.merchant.findUnique.mockResolvedValue({ id: 'm1', approvalStatus: 'approved' });
  prisma.product.findMany.mockResolvedValue([
    { id: 'p1', merchantId: 'm1', name: 'Tee', unitPrice: 1_000_000n, active: true },
  ]);
  charges.activeForMerchant.mockResolvedValue([{ name: 'VAT', mode: 'percent', value: 1000, active: true }]);
  prisma.order.create.mockResolvedValue({ id: 'o1', reference: 'ORD-XXXXXXXX', amount: 1_100_000n, expiresAt: new Date(), status: 'awaiting_payment' });

  const res = await svc.createForMerchant('m1', { items: [{ productId: 'p1', quantity: 1 }] });

  const data = prisma.order.create.mock.calls[0][0].data;
  expect(data.amount).toBe(1_100_000n);      // subtotal 1_000_000 + 10% VAT
  expect(data.subtotal).toBe(1_000_000n);
  expect(data.reference).toMatch(/^ORD-/);
  expect(data.items.create).toEqual([{ productId: 'p1', name: 'Tee', unitPrice: 1_000_000n, quantity: 1 }]);
  expect(data.charges.create).toEqual([{ name: 'VAT', mode: 'percent', value: 1000, amount: 100_000n }]);
  expect(res.orderId).toBe('o1');
});

it('rejects items referencing a product not owned or inactive', async () => {
  prisma.merchant.findUnique.mockResolvedValue({ id: 'm1', approvalStatus: 'approved' });
  prisma.product.findMany.mockResolvedValue([]); // p1 not found for this merchant
  charges.activeForMerchant.mockResolvedValue([]);
  await expect(svc.createForMerchant('m1', { items: [{ productId: 'p1', quantity: 1 }] })).rejects.toThrow(/product/i);
});

it('rejects an empty items list', async () => {
  prisma.merchant.findUnique.mockResolvedValue({ id: 'm1', approvalStatus: 'approved' });
  await expect(svc.createForMerchant('m1', { items: [] })).rejects.toThrow(/at least one/i);
});

it('rejects when total is below MIN_INVOICE_AMOUNT', async () => {
  prisma.merchant.findUnique.mockResolvedValue({ id: 'm1', approvalStatus: 'approved' });
  prisma.product.findMany.mockResolvedValue([{ id: 'p1', merchantId: 'm1', name: 'Cheap', unitPrice: 100n, active: true }]);
  charges.activeForMerchant.mockResolvedValue([]);
  await expect(svc.createForMerchant('m1', { items: [{ productId: 'p1', quantity: 1 }] })).rejects.toThrow(/at least/i);
});
```

- [ ] **Step 2: Run to verify it fails.**

Run: `pnpm test orders.service`
Expected: FAIL — new constructor arg / `items` shape not implemented.

- [ ] **Step 3: Rework `orders.service.ts`.** Update imports, the input type, constructor, and `create`:

```ts
import { computeInvoiceTotals } from './invoice-totals';
import { generateOrderReference } from './order-reference';
import { MerchantChargesService } from '../merchant/merchant-charges.service';

export interface OrderLineInput { productId: string; quantity: number; }
export interface CreateOrderInput { items: OrderLineInput[]; description?: string; callbackUrl?: string; expiresInSec?: number; }
```

Constructor — add the charges service as the last param:
```ts
constructor(
  private readonly prisma: PrismaService,
  private readonly audit: AuditService,
  private readonly payBaseUrl: string,
  private readonly feeBps: number,
  private readonly charges: MerchantChargesService,
) {}
```

Replace `create`:
```ts
async create(merchantId: string, input: CreateOrderInput) {
  if (!input.items || input.items.length === 0) throw new BadRequestException('An invoice needs at least one item');
  for (const it of input.items) {
    if (!Number.isInteger(it.quantity) || it.quantity <= 0) throw new BadRequestException('quantity must be a positive integer');
  }

  const ids = [...new Set(input.items.map((i) => i.productId))];
  const products = await this.prisma.product.findMany({ where: { id: { in: ids }, merchantId, active: true } });
  const byId = new Map(products.map((p) => [p.id, p]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) throw new BadRequestException(`Unknown or inactive product(s): ${missing.join(', ')}`);

  const lineSnapshots = input.items.map((i) => {
    const p = byId.get(i.productId)!;
    return { productId: p.id, name: p.name, unitPrice: p.unitPrice as bigint, quantity: i.quantity };
  });

  const chargeRows = await this.charges.activeForMerchant(merchantId);
  const totals = computeInvoiceTotals(
    lineSnapshots.map((l) => ({ unitPrice: l.unitPrice, quantity: l.quantity })),
    chargeRows.map((c) => ({ name: c.name, mode: c.mode as 'percent' | 'fixed', value: c.value })),
  );

  if (totals.total < MIN_INVOICE_AMOUNT) {
    throw new BadRequestException(`Invoice total must be at least ${MIN_INVOICE_AMOUNT} base units`);
  }

  const id = randomUUID();
  const onchainInvoiceId = invoiceIdToHex(orderIdToInvoiceId(id));
  const expiresAt = new Date(Date.now() + (input.expiresInSec ?? 900) * 1000);
  const reference = generateOrderReference();

  const order = await this.prisma.order.create({
    data: {
      id, merchantId, reference, amount: totals.total, subtotal: totals.subtotal,
      description: input.description ?? null, feeBps: this.feeBps, status: 'awaiting_payment',
      onchainInvoiceId, callbackUrl: input.callbackUrl ?? null, expiresAt,
      items: { create: lineSnapshots },
      charges: { create: totals.charges.map((c) => ({ name: c.name, mode: c.mode, value: c.value, amount: c.amount })) },
    },
  });

  await this.audit.record({ actor: `merchant:${merchantId}`, action: 'order.create', target: id });
  const payUrl = `${this.payBaseUrl}/${order.id}`;
  const qr = await QRCode.toDataURL(payUrl);
  return { orderId: order.id, reference, payUrl, qr, subtotal: totals.subtotal.toString(), amount: order.amount.toString(), expiresAt, status: order.status };
}
```

- [ ] **Step 4: Update `payments.module.ts`** so the `OrdersService` factory injects `MerchantChargesService`. First `import { MerchantModule } from '../merchant/merchant.module';` and `import { MerchantChargesService } from '../merchant/merchant-charges.service';`, add `MerchantModule` to `imports`, then update the provider:

```ts
{
  provide: OrdersService,
  inject: [PrismaService, AuditService, MerchantChargesService],
  useFactory: (p: PrismaService, a: AuditService, c: MerchantChargesService) =>
    new OrdersService(p, a, process.env.NAVY_PAY_BASE_URL ?? 'https://pay.navy/pay', parseInt(process.env.NAVY_FEE_BPS ?? '100', 10), c),
},
```

- [ ] **Step 5: Run to verify tests pass.**

Run: `pnpm test orders.service`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add be/src/payments/orders.service.ts be/src/payments/orders.service.spec.ts be/src/payments/payments.module.ts
git commit -m "feat(be): build orders from line items + apply merchant charges"
```

### Task 9: Enrich order read payloads + update DTOs

**Files:**
- Modify: `be/src/payments/orders.service.ts` (`serialize`, `getForMerchant`, public order read)
- Modify: `be/src/payments/merchant-orders.controller.ts`
- Modify: `be/src/payments/orders.controller.ts`

- [ ] **Step 1: Include items + charges in reads.** In `orders.service.ts`, change `getForMerchant` to include relations and enrich `serialize`:

```ts
async getForMerchant(merchantId: string, id: string) {
  const o = await this.prisma.order.findFirst({ where: { id, merchantId }, include: { items: true, charges: true } });
  if (!o) throw new NotFoundException('Order not found');
  return this.serialize(o);
}
```

Extend `serialize` to emit the breakdown (guard for list rows that don't include relations):
```ts
private serialize(o: any) {
  return {
    id: o.id, reference: o.reference, amount: o.amount.toString(),
    subtotal: o.subtotal != null ? o.subtotal.toString() : null,
    description: o.description ?? null, status: o.status,
    createdAt: o.createdAt, paidAt: o.paidAt ?? null, payer: o.payer ?? null, txSignature: o.txSignature ?? null,
    items: (o.items ?? []).map((it: any) => ({ name: it.name, unitPrice: it.unitPrice.toString(), quantity: it.quantity })),
    charges: (o.charges ?? []).map((c: any) => ({ name: c.name, mode: c.mode, value: c.value, amount: c.amount.toString() })),
  };
}
```

- [ ] **Step 2: Enrich the public order read** used by the pay page. Find the `GET /v1/orders/:id` handler in `orders.controller.ts` (returns `{ orderId, status, amount, reference, paidAt }`). Load with relations and add the breakdown fields. Change the service `get` (or the controller read) to `include: { items: true, charges: true }` and return `subtotal`, `description`, `items`, `charges` (BigInts → strings) alongside the existing fields.

- [ ] **Step 3: Update the dashboard create DTO** in `merchant-orders.controller.ts`:

```ts
import { IsArray, IsInt, IsOptional, IsPositive, IsString, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class OrderLineDto {
  @IsUUID() productId!: string;
  @IsInt() @IsPositive() quantity!: number;
}
class CreateOrderDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => OrderLineDto) items!: OrderLineDto[];
  @IsString() @IsOptional() description?: string;
  @IsInt() @IsPositive() @IsOptional() expiresInSec?: number;
}
```
And the handler:
```ts
create(@Req() req: any, @Body() dto: CreateOrderDto) {
  return this.orders.createForMerchant(req.user.sub, { items: dto.items, description: dto.description, expiresInSec: dto.expiresInSec });
}
```

- [ ] **Step 4: Update the API-key create DTO** in `orders.controller.ts` the same way (items + description; drop `amount`/`reference`), forwarding to `orders.create(merchantId, { items, description, ... })`.

- [ ] **Step 5: Build + full test.**

Run: `pnpm build && pnpm test`
Expected: PASS. (Fix any other callers of the old `{ amount, reference }` create shape the compiler flags.)

- [ ] **Step 6: Commit.**

```bash
git add be/src/payments
git commit -m "feat(be): itemized order read payloads + item-based create DTOs"
```

---

## Phase 6 — Frontend shared helper + proxy routes

### Task 10: `fe` invoice-totals mirror

**Files:**
- Create: `fe/src/lib/invoice-totals.ts`
- Test: `fe/src/lib/invoice-totals.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { computeInvoiceTotals } from './invoice-totals';

it('mirrors backend math: subtotal + percent + fixed', () => {
  const r = computeInvoiceTotals(
    [{ unitPrice: 2_000_000n, quantity: 1 }],
    [{ name: 'VAT', mode: 'percent', value: 1000 }, { name: 'Svc', mode: 'fixed', value: 100_000 }],
  );
  expect(r.subtotal).toBe(2_000_000n);
  expect(r.charges.map((c) => c.amount)).toEqual([200_000n, 100_000n]);
  expect(r.total).toBe(2_300_000n);
});
```

- [ ] **Step 2: Run to verify it fails.**

Run: `pnpm test invoice-totals`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement** — identical logic to the backend helper (copy `be/src/payments/invoice-totals.ts` verbatim into `fe/src/lib/invoice-totals.ts`; the code has no framework imports).

- [ ] **Step 4: Run to verify it passes.**

Run: `pnpm test invoice-totals`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add fe/src/lib/invoice-totals.ts fe/src/lib/invoice-totals.test.ts
git commit -m "feat(fe): mirror invoice-totals helper for live preview"
```

### Task 11: `fe` proxy routes for products + charges

**Files:**
- Create: `fe/src/app/api/merchant/products/route.ts`
- Create: `fe/src/app/api/merchant/products/[id]/route.ts`
- Create: `fe/src/app/api/merchant/charges/route.ts`
- Create: `fe/src/app/api/merchant/charges/[id]/route.ts`

- [ ] **Step 1: Products collection route** (`products/route.ts`):

```ts
import { NextRequest, NextResponse } from 'next/server';
import { sessionBackendFetch } from '@/lib/session-backend';
import { guardOrigin, parseJson } from '@/lib/request-guards';

export async function GET() {
  const res = await sessionBackendFetch('/merchant/products');
  return NextResponse.json(await res.json().catch(() => ([])), { status: res.status });
}

export async function POST(req: NextRequest) {
  const rejected = guardOrigin(req);
  if (rejected) return rejected;
  const parsed = await parseJson(req);
  if (!parsed.ok) return parsed.response;
  const res = await sessionBackendFetch('/merchant/products', { method: 'POST', body: JSON.stringify(parsed.body) });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
```

- [ ] **Step 2: Products item route** (`products/[id]/route.ts`) — PATCH + DELETE. Note App Router param signature:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { sessionBackendFetch } from '@/lib/session-backend';
import { guardOrigin, parseJson } from '@/lib/request-guards';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rejected = guardOrigin(req);
  if (rejected) return rejected;
  const { id } = await params;
  const parsed = await parseJson(req);
  if (!parsed.ok) return parsed.response;
  const res = await sessionBackendFetch(`/merchant/products/${id}`, { method: 'PATCH', body: JSON.stringify(parsed.body) });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rejected = guardOrigin(req);
  if (rejected) return rejected;
  const { id } = await params;
  const res = await sessionBackendFetch(`/merchant/products/${id}`, { method: 'DELETE' });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
```

- [ ] **Step 3: Charges routes** — copy Steps 1–2 replacing `products` → `charges` in both paths and backend URLs.

- [ ] **Step 4: Verify the param signature** against the installed Next docs (App Router route handlers). Confirm `params` is a Promise in this version by checking an existing dynamic route handler under `fe/src/app/api`; if none uses a dynamic segment, read `node_modules/next/dist/docs` per `fe/AGENTS.md`. Adjust if the installed version passes `params` synchronously.

- [ ] **Step 5: Typecheck.**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add fe/src/app/api/merchant/products fe/src/app/api/merchant/charges
git commit -m "feat(fe): proxy routes for products + charges"
```

---

## Phase 7 — Frontend Products page

### Task 12: Products catalog page

**Files:**
- Create: `fe/src/app/merchant/products/ProductForm.tsx`
- Create: `fe/src/app/merchant/products/page.tsx`
- Modify: `fe/src/ui/nav.ts`

- [ ] **Step 1: Add the nav tab** in `nav.ts`, in `MERCHANT_NAV`, after Orders:
```ts
  { href: '/merchant/products', label: 'Products', icon: 'store' },
```

- [ ] **Step 2: Write `ProductForm.tsx`** — the modal body for create/edit:

```tsx
'use client';
import { useState } from 'react';
import { usdcInputToBaseUnits } from '@/lib/money';
import { formatUsdc } from '@/lib/dashboard/stats';
import { Button } from '@/ui/Button';
import { Text } from '@/ui/Text';
import { colors, space, radius } from '@/ui/theme';

const inputStyle: React.CSSProperties = {
  background: colors.bgElevated, border: `1px solid ${colors.borderStrong}`,
  borderRadius: radius.md, color: colors.text, padding: '12px 14px', outline: 'none', width: '100%',
};

export interface ProductRow { id: string; name: string; sku: string | null; unitPrice: string; active: boolean; }

export function ProductForm({ initial, onSaved }: { initial?: ProductRow; onSaved: () => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [sku, setSku] = useState(initial?.sku ?? '');
  const [price, setPrice] = useState(initial ? formatUsdc(initial.unitPrice) : '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setError('');
    let unitPrice: string;
    try { unitPrice = usdcInputToBaseUnits(price); } catch (err) { setError((err as Error).message); return; }
    if (unitPrice === '0') { setError('Price must be greater than 0'); return; }
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    const body = JSON.stringify({ name: name.trim(), sku: sku.trim() || undefined, unitPrice });
    const res = initial
      ? await fetch(`/api/merchant/products/${initial.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body })
      : await fetch('/api/merchant/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    setSaving(false);
    if (res.ok) onSaved(); else setError(`Failed (${res.status})`);
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: space.md }}>
      <div style={{ display: 'grid', gap: space.xs }}>
        <Text variant="label" muted upper>Name</Text>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. T-shirt (M)" style={inputStyle} />
      </div>
      <div style={{ display: 'grid', gap: space.xs }}>
        <Text variant="label" muted upper>SKU code (optional)</Text>
        <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="e.g. TSHIRT-M" style={inputStyle} />
      </div>
      <div style={{ display: 'grid', gap: space.xs }}>
        <Text variant="label" muted upper>Unit price (USDC)</Text>
        <input value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value)} placeholder="0.00" style={inputStyle} />
      </div>
      <div style={{ marginTop: space.sm }}><Button label={initial ? 'Save changes' : 'Add product'} loading={saving} /></div>
      {error && <Text variant="caption" color={colors.danger}>{error}</Text>}
    </form>
  );
}
```

- [ ] **Step 3: Write `page.tsx`** — the catalog list with add/edit/archive:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/ui/AppShell';
import { TopBar } from '@/ui/TopBar';
import { DataTable, Column } from '@/ui/DataTable';
import { Button } from '@/ui/Button';
import { Text } from '@/ui/Text';
import { Pill } from '@/ui/Bits';
import { Modal } from '@/ui/Modal';
import { colors, space } from '@/ui/theme';
import { MERCHANT_NAV } from '@/ui/nav';
import { formatUsdc } from '@/lib/dashboard/stats';
import { ProductForm, ProductRow } from './ProductForm';

export default function Products() {
  const router = useRouter();
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = async () => {
    const res = await fetch('/api/merchant/products');
    if (res.ok) setRows(await res.json());
  };
  useEffect(() => { reload(); }, []);

  const logout = async () => { await fetch('/api/auth/logout', { method: 'POST' }); router.push('/merchant/login'); };
  const archive = async (id: string) => { await fetch(`/api/merchant/products/${id}`, { method: 'DELETE' }); reload(); };
  const closeAndReload = () => { setCreating(false); setEditing(null); reload(); };

  const cols: Column<ProductRow>[] = [
    { key: 'name', header: 'Name', render: (p) => <Text variant="bodyStrong" color={colors.textHi}>{p.name}</Text> },
    { key: 'sku', header: 'SKU', render: (p) => <Text variant="body" dim>{p.sku ?? '—'}</Text> },
    { key: 'price', header: 'Unit price', align: 'right', render: (p) => <Text variant="body" numeric>{formatUsdc(p.unitPrice)} USDC</Text> },
    { key: 'st', header: 'Status', align: 'right', render: (p) => <Pill label={p.active ? 'Active' : 'Archived'} tone={p.active ? 'success' : 'neutral'} /> },
    { key: 'act', header: '', align: 'right', render: (p) => (
      <div style={{ display: 'flex', gap: space.sm, justifyContent: 'flex-end' }}>
        <Button label="Edit" variant="ghost" full={false} onPress={() => setEditing(p)} />
        {p.active && <Button label="Archive" variant="danger" full={false} onPress={() => archive(p.id)} />}
      </div>
    ) },
  ];

  return (
    <AppShell items={MERCHANT_NAV} identity={{ title: 'Merchant', subtitle: 'Dashboard' }} onLogout={logout}>
      <TopBar eyebrow="Merchant" title="Products" right={<div style={{ minWidth: 160 }}><Button label="Add product" icon="plus" full onPress={() => setCreating(true)} /></div>} />
      <DataTable columns={cols} rows={rows} empty="No products yet — add one to start invoicing." />
      <Modal open={creating} title="Add product" onClose={() => setCreating(false)}>
        <ProductForm onSaved={closeAndReload} />
      </Modal>
      <Modal open={!!editing} title="Edit product" onClose={() => setEditing(null)}>
        {editing && <ProductForm initial={editing} onSaved={closeAndReload} />}
      </Modal>
    </AppShell>
  );
}
```

- [ ] **Step 4: Typecheck.** Confirm `Pill` accepts `tone="neutral"` and `Button` supports `full={false}` (both verified in `src/ui/Bits.tsx` / `Button.tsx`).

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add fe/src/app/merchant/products fe/src/ui/nav.ts
git commit -m "feat(fe): merchant products catalog page"
```

---

## Phase 8 — Frontend Settings charges section

### Task 13: Charges panel in Settings

**Files:**
- Create: `fe/src/app/merchant/settings/ChargesPanel.tsx`
- Modify: `fe/src/app/merchant/settings/page.tsx`

- [ ] **Step 1: Write `ChargesPanel.tsx`.**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { usdcInputToBaseUnits } from '@/lib/money';
import { formatUsdc } from '@/lib/dashboard/stats';
import { Button } from '@/ui/Button';
import { Text } from '@/ui/Text';
import { colors, space, radius } from '@/ui/theme';

interface Charge { id: string; name: string; mode: 'percent' | 'fixed'; value: number; active: boolean; sortOrder: number; }
const inputStyle: React.CSSProperties = { background: colors.bgElevated, border: `1px solid ${colors.borderStrong}`, borderRadius: radius.md, color: colors.text, padding: '10px 12px', outline: 'none' };

function describe(c: Charge) {
  return c.mode === 'percent' ? `${(c.value / 100).toFixed(2)}%` : `${formatUsdc(String(c.value))} USDC`;
}

export function ChargesPanel() {
  const [rows, setRows] = useState<Charge[]>([]);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'percent' | 'fixed'>('percent');
  const [val, setVal] = useState('');
  const [error, setError] = useState('');

  const reload = async () => { const r = await fetch('/api/merchant/charges'); if (r.ok) setRows(await r.json()); };
  useEffect(() => { reload(); }, []);

  async function add(e?: React.FormEvent) {
    e?.preventDefault();
    setError('');
    let value: number;
    if (mode === 'percent') {
      const pct = Number(val);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) { setError('Enter a percentage between 0 and 100'); return; }
      value = Math.round(pct * 100); // → basis points
    } else {
      try { value = Number(usdcInputToBaseUnits(val)); } catch (err) { setError((err as Error).message); return; }
    }
    if (!name.trim()) { setError('Name is required'); return; }
    const res = await fetch('/api/merchant/charges', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), mode, value }) });
    if (res.ok) { setName(''); setVal(''); reload(); } else setError(`Failed (${res.status})`);
  }
  const remove = async (id: string) => { await fetch(`/api/merchant/charges/${id}`, { method: 'DELETE' }); reload(); };

  return (
    <div>
      <Text variant="h3" color={colors.textHi} style={{ display: 'block', marginBottom: space.xs }}>Taxes & fees</Text>
      <Text variant="caption" dim style={{ display: 'block', marginBottom: space.md }}>Applied automatically to every invoice’s subtotal.</Text>
      <div style={{ display: 'grid', gap: space.sm, marginBottom: space.lg }}>
        {rows.length === 0 && <Text variant="caption" dim>No charges configured.</Text>}
        {rows.map((c) => (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `${space.sm}px ${space.md}px`, border: `1px solid ${colors.border}`, borderRadius: radius.md }}>
            <Text variant="bodyStrong" color={colors.textHi}>{c.name}</Text>
            <div style={{ display: 'flex', alignItems: 'center', gap: space.md }}>
              <Text variant="body" numeric>{describe(c)}</Text>
              <Button label="Remove" variant="danger" full={false} onPress={() => remove(c.id)} />
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={add} style={{ display: 'flex', gap: space.sm, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. VAT)" style={inputStyle} />
        <select value={mode} onChange={(e) => setMode(e.target.value as 'percent' | 'fixed')} style={inputStyle}>
          <option value="percent">Percent (%)</option>
          <option value="fixed">Fixed (USDC)</option>
        </select>
        <input value={val} inputMode="decimal" onChange={(e) => setVal(e.target.value)} placeholder={mode === 'percent' ? '10' : '1.00'} style={{ ...inputStyle, width: 120 }} />
        <Button label="Add" full={false} />
      </form>
      {error && <Text variant="caption" color={colors.danger} style={{ display: 'block', marginTop: space.sm }}>{error}</Text>}
    </div>
  );
}
```

- [ ] **Step 2: Mount it in `settings/page.tsx`.** Add `import { ChargesPanel } from './ChargesPanel';` and a new section after the API credentials block:

```tsx
      <div style={{ marginBottom: space.xl }}>
        <ChargesPanel />
      </div>
```

- [ ] **Step 3: Typecheck.**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add fe/src/app/merchant/settings
git commit -m "feat(fe): taxes & fees management in merchant settings"
```

---

## Phase 9 — Frontend line-item invoice builder

### Task 14: Rework NewInvoiceForm to a line-item builder

**Files:**
- Modify: `fe/src/app/merchant/orders/NewInvoiceForm.tsx`

- [ ] **Step 1: Replace the form body.** New behavior: load products + charges on mount; let the merchant add product lines with quantities; show a live Subtotal/charges/Total preview; submit `{ items, description, expiresInSec }`. Full component:

```tsx
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { formatUsdc } from '@/lib/dashboard/stats';
import { computeInvoiceTotals } from '@/lib/invoice-totals';
import { Button } from '@/ui/Button';
import { Text } from '@/ui/Text';
import { colors, space, radius } from '@/ui/theme';

const inputStyle: React.CSSProperties = { background: colors.bgElevated, border: `1px solid ${colors.borderStrong}`, borderRadius: radius.md, color: colors.text, padding: '12px 14px', outline: 'none', width: '100%' };

interface Product { id: string; name: string; unitPrice: string; active: boolean; }
interface Charge { name: string; mode: 'percent' | 'fixed'; value: number; active: boolean; }
interface Line { productId: string; quantity: number; }

const EXPIRY_PRESETS: { label: string; seconds: number }[] = [
  { label: '15 minutes', seconds: 900 }, { label: '1 hour', seconds: 3600 },
  { label: '24 hours', seconds: 86400 }, { label: '7 days', seconds: 604800 },
];

export function NewInvoiceForm({ onCreated }: { onCreated?: () => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [description, setDescription] = useState('');
  const [expiresInSec, setExpiresInSec] = useState(900);
  const [result, setResult] = useState<{ orderId: string; reference: string; qr: string; payUrl: string } | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    fetch('/api/merchant/products').then((r) => r.ok ? r.json() : []).then((all: Product[]) => setProducts(all.filter((p) => p.active)));
    fetch('/api/merchant/charges').then((r) => r.ok ? r.json() : []).then((c: Charge[]) => setCharges(c));
  }, []);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const totals = useMemo(() => computeInvoiceTotals(
    lines.filter((l) => byId.has(l.productId)).map((l) => ({ unitPrice: BigInt(byId.get(l.productId)!.unitPrice), quantity: l.quantity })),
    charges.filter((c) => c.active).map((c) => ({ name: c.name, mode: c.mode, value: c.value })),
  ), [lines, charges, byId]);

  const addLine = () => { if (products[0]) setLines((ls) => [...ls, { productId: products[0].id, quantity: 1 }]); };
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const removeLine = (i: number) => setLines((ls) => ls.filter((_, j) => j !== i));

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      setError(''); setResult(null);
      if (lines.length === 0) { setError('Add at least one product'); return; }
      setSubmitting(true);
      const res = await fetch('/api/merchant/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: lines, description: description || undefined, expiresInSec }),
      });
      const body = await res.json();
      setSubmitting(false);
      if (res.ok) { setResult({ orderId: body.orderId, reference: body.reference, qr: body.qr, payUrl: body.payUrl }); onCreated?.(); }
      else setError(body.error ?? (res.status === 409 ? 'Your account is not approved yet' : `Failed (${res.status})`));
    } finally { submittingRef.current = false; }
  }

  if (result) {
    return (
      <div style={{ display: 'grid', gap: space.md, justifyItems: 'start' }}>
        <Text variant="body" dim>Invoice <Text variant="mono" color={colors.textHi}>{result.reference}</Text> created. Show this QR to your customer:</Text>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={result.qr} alt="payment QR" width={220} height={220} style={{ borderRadius: radius.md, background: '#fff', padding: space.sm }} />
        <div style={{ wordBreak: 'break-all' }}><Text variant="mono" color={colors.text}>{result.payUrl}</Text></div>
        <Link href={`/merchant/orders/${result.orderId}`}><Text variant="bodyStrong" color={colors.accent}>Track this order →</Text></Link>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div style={{ display: 'grid', gap: space.md, justifyItems: 'start' }}>
        <Text variant="body" dim>You need a product before you can invoice.</Text>
        <Link href="/merchant/products"><Text variant="bodyStrong" color={colors.accent}>Go to Products →</Text></Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: space.md }}>
      <div style={{ display: 'grid', gap: space.sm }}>
        <Text variant="label" muted upper>Items</Text>
        {lines.map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: space.sm, alignItems: 'center' }}>
            <select value={l.productId} onChange={(e) => setLine(i, { productId: e.target.value })} style={{ ...inputStyle, flex: 1 }}>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name} — {formatUsdc(p.unitPrice)} USDC</option>)}
            </select>
            <input type="number" min={1} value={l.quantity} onChange={(e) => setLine(i, { quantity: Math.max(1, parseInt(e.target.value || '1', 10)) })} style={{ ...inputStyle, width: 80 }} />
            <Button label="✕" variant="ghost" full={false} onPress={() => removeLine(i)} />
          </div>
        ))}
        <Button label="Add item" variant="secondary" icon="plus" full={false} onPress={addLine} />
      </div>

      <div style={{ display: 'grid', gap: space.xs }}>
        <Text variant="label" muted upper>Description (optional)</Text>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this for?" style={inputStyle} />
      </div>

      <div style={{ display: 'grid', gap: space.xs }}>
        <Text variant="label" muted upper>Expires in</Text>
        <select value={expiresInSec} onChange={(e) => setExpiresInSec(parseInt(e.target.value, 10))} style={inputStyle}>
          {EXPIRY_PRESETS.map((p) => <option key={p.seconds} value={p.seconds}>{p.label}</option>)}
        </select>
      </div>

      <div style={{ display: 'grid', gap: space.xs, padding: space.md, border: `1px solid ${colors.border}`, borderRadius: radius.md }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><Text variant="body" dim>Subtotal</Text><Text variant="body" numeric>{formatUsdc(totals.subtotal.toString())} USDC</Text></div>
        {totals.charges.map((c, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}><Text variant="body" dim>{c.name}</Text><Text variant="body" numeric>{formatUsdc(c.amount.toString())} USDC</Text></div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><Text variant="bodyStrong" color={colors.textHi}>Total</Text><Text variant="bodyStrong" color={colors.textHi} numeric>{formatUsdc(totals.total.toString())} USDC</Text></div>
      </div>

      <Button label="Create invoice" loading={submitting} />
      {error && <Text variant="caption" color={colors.danger}>{error}</Text>}
    </form>
  );
}
```

- [ ] **Step 2: Typecheck.**

Run: `pnpm exec tsc --noEmit`
Expected: PASS. (Confirm `Button` `variant="secondary"` exists — it does per the `Variant` union.)

- [ ] **Step 3: Commit.**

```bash
git add fe/src/app/merchant/orders/NewInvoiceForm.tsx
git commit -m "feat(fe): line-item invoice builder with live totals"
```

### Task 15: Itemized merchant order detail

**Files:**
- Modify: `fe/src/app/merchant/orders/[id]/page.tsx`

- [ ] **Step 1: Extend the `Order` interface** in that file to include the breakdown:
```ts
interface OrderItemRow { name: string; unitPrice: string; quantity: number; }
interface OrderChargeRow { name: string; mode: string; value: number; amount: string; }
interface Order { id: string; reference: string; amount: string; status: string; payer: string | null; txSignature: string | null; subtotal: string | null; description: string | null; items: OrderItemRow[]; charges: OrderChargeRow[]; }
```

- [ ] **Step 2: Render items + charges.** Below the existing Amount `Field`, add (using the file's existing `Text`/`colors`/`space` imports and `formatUsdc`):
```tsx
{order.description && <Field label="Description" value={order.description} />}
<div style={{ marginTop: space.lg }}>
  <Text variant="label" upper dim style={{ display: 'block', marginBottom: space.sm }}>Items</Text>
  {order.items.map((it, i) => (
    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: space.xs }}>
      <Text variant="body">{it.name} × {it.quantity}</Text>
      <Text variant="body" numeric>{formatUsdc(it.unitPrice)} USDC</Text>
    </div>
  ))}
  {order.charges.map((c, i) => (
    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: space.xs }}>
      <Text variant="body" dim>{c.name}</Text>
      <Text variant="body" numeric>{formatUsdc(c.amount)} USDC</Text>
    </div>
  ))}
</div>
```
(Guard for older paid orders whose `items`/`charges` may be empty arrays — the `.map` over `[]` renders nothing, which is fine.)

- [ ] **Step 3: Typecheck.**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add fe/src/app/merchant/orders/\[id\]/page.tsx
git commit -m "feat(fe): itemized merchant order detail"
```

---

## Phase 10 — Web-wallet pay page

### Task 16: Itemized breakdown on the pay page

**Files:**
- Modify: `web-wallet/src/app/pay/[orderId]/page.tsx`

- [ ] **Step 1: Extend the `Order` type** near the top of the file:
```ts
type OrderItem = { name: string; unitPrice: string; quantity: number };
type OrderCharge = { name: string; amount: string };
type Order = { amount: string; reference: string; status: string; subtotal: string | null; description: string | null; items: OrderItem[]; charges: OrderCharge[] };
```
Ensure `NavyPayClient.getOrder` returns these fields (it deserializes the enriched `GET /v1/orders/:id` payload from Task 9 — no client change needed if it passes the JSON through; otherwise widen its return type).

- [ ] **Step 2: Render the breakdown** above the amount card (reusing `Text`, `usdcBaseToDisplay`, `colors`, `space`). Insert before the `<Gradient ... amountCard>` block:
```tsx
{order.items?.length > 0 && (
  <div style={{ width: '100%', marginBottom: `${space.lg}px` }}>
    {order.items.map((it, i) => (
      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: `${space.xs}px` }}>
        <Text dim>{it.name} × {it.quantity}</Text>
        <Text numeric>{usdcBaseToDisplay(String(BigInt(it.unitPrice) * BigInt(it.quantity)))} USDC</Text>
      </div>
    ))}
    {order.charges?.map((c, i) => (
      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: `${space.xs}px` }}>
        <Text dim>{c.name}</Text>
        <Text numeric>{usdcBaseToDisplay(c.amount)} USDC</Text>
      </div>
    ))}
  </div>
)}
{order.description && <Text dim center style={{ marginBottom: `${space.md}px` }}>{order.description}</Text>}
```

- [ ] **Step 3: Typecheck.**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Build (runtime gate for web-wallet).**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add web-wallet/src/app/pay/\[orderId\]/page.tsx
git commit -m "feat(web-wallet): itemized pay-page breakdown"
```

---

## Phase 11 — Full verification

### Task 17: End-to-end gates

- [ ] **Step 1: Backend.**

Run: `cd be && pnpm test && pnpm build`
Expected: all suites PASS; build clean.

- [ ] **Step 2: Frontend.**

Run: `cd fe && pnpm test && pnpm exec tsc --noEmit && pnpm build`
Expected: PASS.

- [ ] **Step 3: Web-wallet.**

Run: `cd web-wallet && pnpm test && pnpm exec tsc --noEmit && pnpm build`
Expected: PASS.

- [ ] **Step 4: Manual smoke (optional but recommended).** With `be` + `fe` running: create a product, add a 10% "VAT" charge in Settings, create an invoice from that product, confirm the modal total = subtotal + VAT, open the pay URL and confirm the breakdown renders.

- [ ] **Step 5: Final commit (if any lint/format fixups).**

```bash
git add -A && git commit -m "chore: verification fixups for catalog + line-item invoices"
```

---

## Self-Review Notes

- **Spec coverage:** Products CRUD (T4–5), charges CRUD (T6–7, T13), line-item invoices (T8–9, T14), auto `ORD-` reference (T3, used in T8), expiry presets (T14), description (T8/T9/T14/T15/T16), pay-page breakdown (T16), shared math (T2/T10). All spec sections mapped.
- **Type consistency:** `computeInvoiceTotals(items, charges)` signature identical in be/fe; `AppliedCharge.amount: bigint`; order create input `{ items, description?, expiresInSec? }` consistent across service, DTOs, and fe fetch body; charge `value` is bps for percent everywhere; product `unitPrice` is a base-unit string over the wire, BigInt in the DB.
- **Known verification points flagged inline:** App Router `params` Promise signature (T11 S4), `PrismaService` resolution in `ProductsModule` (T5 S4), `NavyPayClient.getOrder` return width (T16 S1).
