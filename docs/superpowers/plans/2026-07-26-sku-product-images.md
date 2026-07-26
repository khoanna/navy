# SKU Product Images via Cloudinary — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let merchants attach an image to each SKU product (required on create, replaceable on edit), uploaded through the backend to Cloudinary, and shown as a thumbnail in the merchant products dashboard.

**Architecture:** Browser sends multipart (image + fields) → `fe` proxy forwards it verbatim → `be` NestJS controller (`FileInterceptor`, memory storage) validates type/size, a `CloudinaryService` uploads the buffer with the API secret and returns `{ url, publicId }`, and `ProductsService` persists `imageUrl`/`imagePublicId`. On edit-with-new-image the old Cloudinary asset is best-effort deleted. The Cloudinary secret never leaves `be`.

**Tech Stack:** NestJS 11 + Prisma 7 (Postgres) + `cloudinary` SDK + `@nestjs/platform-express` (`FileInterceptor`/multer) on the backend; Next.js 16 App Router + React 19 on the frontend. Plain-TS validation/build helpers are unit-tested (jest); SDK/controller/UI verified via `tsc`/`build`.

Spec: `docs/superpowers/specs/2026-07-26-sku-product-images-design.md`

**Conventions to honor (from CLAUDE.md):**
- Money is `BigInt` in Prisma; serialize to string before returning from Nest.
- Prisma 7 CLI needs `DATABASE_URL` in the shell env: prefix migrate/generate commands.
- Keep non-UI logic in plain-TS modules (no framework/SDK imports) so it's unit-testable.
- pnpm 10 blocks native postinstall; `cloudinary` and `multer` have no native build, so no `onlyBuiltDependencies` change is needed — but confirm the install succeeds.
- Run `pnpm` inside each app dir (`be/`, `fe/`) — not at the repo root.

All work happens on the existing branch `feat/sku-product-images`.

---

## File Structure

**Backend (`be/`)**
- `prisma/schema.prisma` — add `imageUrl`, `imagePublicId` to `Product` (modify).
- `src/products/product-image.validation.ts` — plain-TS: allowed mimes, max size, `validateProductImage()` (create).
- `src/products/product-image.validation.spec.ts` — unit tests (create).
- `src/cloudinary/cloudinary.service.ts` — SDK wrapper: `uploadImage`, `deleteImage` (create).
- `src/cloudinary/cloudinary.module.ts` — provides/exports `CloudinaryService` (create).
- `src/config/config.service.ts` — three Cloudinary getters (modify).
- `src/products/products.controller.ts` — multipart create/update via `FileInterceptor` (modify).
- `src/products/products.service.ts` — image fields in create/update + serialize (modify).
- `src/products/products.module.ts` — import `CloudinaryModule` (modify).
- `.env.example` — Cloudinary vars (modify or create if absent).

**Frontend (`fe/`)**
- `src/lib/product-image.ts` — plain-TS: client-side mime/size validation + `buildProductFormData()` (create).
- `src/lib/product-image.test.ts` — unit tests (create).
- `src/lib/session-backend.ts` — add `sessionBackendFetchRaw` (no forced JSON content-type) (modify).
- `src/app/api/merchant/products/route.ts` — POST forwards multipart (modify).
- `src/app/api/merchant/products/[id]/route.ts` — PATCH forwards multipart (modify).
- `src/app/merchant/products/ProductForm.tsx` — file input + preview + FormData submit (modify).
- `src/app/merchant/products/page.tsx` — thumbnail column + `imageUrl` on `ProductRow` (modify).

---

## Task 1: Backend — Prisma schema + migration

**Files:**
- Modify: `be/prisma/schema.prisma` (Product model, ~lines 157-167)

- [ ] **Step 1: Add the two columns**

In `be/prisma/schema.prisma`, edit the `Product` model to add `imageUrl` and `imagePublicId` right after `unitPrice`:

```prisma
model Product {
  id            String   @id @default(uuid())
  merchantId    String
  merchant      Merchant @relation(fields: [merchantId], references: [id])
  name          String
  sku           String?
  unitPrice     BigInt
  imageUrl      String?
  imagePublicId String?
  active        Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

- [ ] **Step 2: Create the migration (regenerates the client)**

Run (Postgres must be up: `docker compose up -d`; DB is on `:5433/navy_payments`):

```bash
cd be && DATABASE_URL="postgresql://postgres:postgres@localhost:5433/navy_payments" pnpm prisma migrate dev --name product_image
```

Expected: a new migration folder under `be/prisma/migrations/*product_image`, output ending in "Your database is now in sync with your schema" and the Prisma client regenerating. (If your local `DATABASE_URL` differs, use the value from `be/.env`.)

- [ ] **Step 3: Commit**

```bash
git add be/prisma/schema.prisma be/prisma/migrations
git commit -m "feat(be): add imageUrl/imagePublicId to Product"
```

---

## Task 2: Backend — Cloudinary config getters

**Files:**
- Modify: `be/src/config/config.service.ts`

- [ ] **Step 1: Add three getters**

In `be/src/config/config.service.ts`, add after the CoinGecko getters (end of the class, before the closing `}`):

```ts
  // --- Cloudinary (product images) ---
  get cloudinaryCloudName(): string { return this.req('CLOUDINARY_CLOUD_NAME'); }
  get cloudinaryApiKey(): string { return this.req('CLOUDINARY_API_KEY'); }
  get cloudinaryApiSecret(): string { return this.req('CLOUDINARY_API_SECRET'); }
```

These use the existing `req()` helper, so a missing var throws at first access (consistent with other required vars).

- [ ] **Step 2: Typecheck**

```bash
cd be && pnpm build
```

Expected: builds without type errors. (This also compiles the whole project; if it fails on the new getters, fix before continuing.)

- [ ] **Step 3: Commit**

```bash
git add be/src/config/config.service.ts
git commit -m "feat(be): Cloudinary config getters"
```

---

## Task 3: Backend — image validation helper (plain-TS, TDD)

**Files:**
- Create: `be/src/products/product-image.validation.ts`
- Test: `be/src/products/product-image.validation.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `be/src/products/product-image.validation.spec.ts`:

```ts
import {
  ALLOWED_IMAGE_MIMES,
  MAX_IMAGE_BYTES,
  validateProductImage,
} from './product-image.validation';

describe('validateProductImage', () => {
  it('accepts a small jpeg', () => {
    expect(validateProductImage({ mimetype: 'image/jpeg', size: 1024 })).toEqual({ ok: true });
  });

  it('accepts png and webp', () => {
    expect(validateProductImage({ mimetype: 'image/png', size: 1 }).ok).toBe(true);
    expect(validateProductImage({ mimetype: 'image/webp', size: 1 }).ok).toBe(true);
  });

  it('rejects a disallowed mime type', () => {
    const r = validateProductImage({ mimetype: 'image/gif', size: 1024 });
    expect(r).toEqual({ ok: false, error: 'Image must be JPEG, PNG, or WebP' });
  });

  it('rejects a file over the size limit', () => {
    const r = validateProductImage({ mimetype: 'image/jpeg', size: MAX_IMAGE_BYTES + 1 });
    expect(r).toEqual({ ok: false, error: 'Image must be 5 MB or smaller' });
  });

  it('rejects an empty file', () => {
    const r = validateProductImage({ mimetype: 'image/jpeg', size: 0 });
    expect(r).toEqual({ ok: false, error: 'Image is empty' });
  });

  it('exposes the allowed mimes and max size constants', () => {
    expect(ALLOWED_IMAGE_MIMES).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    expect(MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

```bash
cd be && pnpm test product-image.validation
```

Expected: FAIL — cannot find module `./product-image.validation`.

- [ ] **Step 3: Implement the helper**

Create `be/src/products/product-image.validation.ts`:

```ts
// Framework-free image validation shared by the multipart fileFilter and the
// controller guard. No NestJS/multer imports so it stays unit-testable.
export const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

export type ImageValidation = { ok: true } | { ok: false; error: string };

/** Validate an uploaded image's mime type and byte size. */
export function validateProductImage(file: { mimetype: string; size: number }): ImageValidation {
  if (!ALLOWED_IMAGE_MIMES.includes(file.mimetype as (typeof ALLOWED_IMAGE_MIMES)[number])) {
    return { ok: false, error: 'Image must be JPEG, PNG, or WebP' };
  }
  if (file.size <= 0) return { ok: false, error: 'Image is empty' };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: 'Image must be 5 MB or smaller' };
  return { ok: true };
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd be && pnpm test product-image.validation
```

Expected: PASS (6 assertions/specs green).

- [ ] **Step 5: Commit**

```bash
git add be/src/products/product-image.validation.ts be/src/products/product-image.validation.spec.ts
git commit -m "feat(be): product image validation helper"
```

---

## Task 4: Backend — CloudinaryService + module

**Files:**
- Create: `be/src/cloudinary/cloudinary.service.ts`
- Create: `be/src/cloudinary/cloudinary.module.ts`

- [ ] **Step 1: Install the SDK**

```bash
cd be && pnpm add cloudinary multer && pnpm add -D @types/multer
```

Expected: all install cleanly (no native build step). `@types/multer` provides the `Express.Multer.File` type used by the controller. `multer` is `FileInterceptor`'s runtime engine — `@nestjs/platform-express` declares it, but under pnpm's strict resolution it may not be resolvable from `be/`'s root, so add it explicitly to be safe. If `pnpm build` later warns that `multer` needs a build script, add `"multer"` to `pnpm.onlyBuiltDependencies` in `be/package.json` and reinstall (per the CLAUDE.md pnpm-10 gotcha) — but multer is pure JS and normally needs no build.

- [ ] **Step 2: Write the service**

Create `be/src/cloudinary/cloudinary.service.ts`:

```ts
import { Injectable, Logger, BadGatewayException } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { NavyConfigService } from '../config/config.service';

export interface UploadedImage { url: string; publicId: string; }

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);

  constructor(private readonly config: NavyConfigService) {
    cloudinary.config({
      cloud_name: this.config.cloudinaryCloudName,
      api_key: this.config.cloudinaryApiKey,
      api_secret: this.config.cloudinaryApiSecret,
      secure: true,
    });
  }

  /** Upload an image buffer to the navy/products folder. Throws 502 on failure. */
  async uploadImage(buffer: Buffer): Promise<UploadedImage> {
    try {
      const res = await new Promise<{ secure_url: string; public_id: string }>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'navy/products', resource_type: 'image' },
          (err, result) => {
            if (err || !result) return reject(err ?? new Error('empty Cloudinary result'));
            resolve(result as { secure_url: string; public_id: string });
          },
        );
        stream.end(buffer);
      });
      return { url: res.secure_url, publicId: res.public_id };
    } catch (err) {
      this.logger.error(`Cloudinary upload failed: ${(err as Error).message}`);
      throw new BadGatewayException('Image upload failed');
    }
  }

  /** Best-effort delete of a previously uploaded asset. Never throws. */
  async deleteImage(publicId: string): Promise<void> {
    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
    } catch (err) {
      this.logger.warn(`Cloudinary delete failed for ${publicId}: ${(err as Error).message}`);
    }
  }
}
```

- [ ] **Step 3: Write the module**

Create `be/src/cloudinary/cloudinary.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { CloudinaryService } from './cloudinary.service';

@Module({ providers: [CloudinaryService], exports: [CloudinaryService] })
export class CloudinaryModule {}
```

`NavyConfigService` is `@Global()`, so no config import is needed here.

- [ ] **Step 4: Typecheck**

```bash
cd be && pnpm build
```

Expected: builds without type errors.

- [ ] **Step 5: Commit**

```bash
git add be/src/cloudinary be/package.json be/pnpm-lock.yaml
git commit -m "feat(be): CloudinaryService (upload/delete)"
```

---

## Task 5: Backend — multipart controller + service image logic

**Files:**
- Modify: `be/src/products/products.module.ts`
- Modify: `be/src/products/products.service.ts`
- Modify: `be/src/products/products.controller.ts`

- [ ] **Step 1: Import CloudinaryModule into ProductsModule**

Replace `be/src/products/products.module.ts` with:

```ts
import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';

@Module({ imports: [CloudinaryModule], controllers: [ProductsController], providers: [ProductsService] })
export class ProductsModule {}
```

- [ ] **Step 2: Extend the service to handle image fields**

Edit `be/src/products/products.service.ts`. Update the input interfaces, `serialize`, `create`, and `update`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateProductInput { name: string; sku?: string | null; unitPrice: bigint; imageUrl: string; imagePublicId: string; }
export interface UpdateProductInput { name?: string; sku?: string | null; unitPrice?: bigint; active?: boolean; imageUrl?: string; imagePublicId?: string; }

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  private serialize(p: any) {
    return { id: p.id, name: p.name, sku: p.sku ?? null, unitPrice: p.unitPrice.toString(), imageUrl: p.imageUrl ?? null, active: p.active };
  }

  async listForMerchant(merchantId: string) {
    const rows = await this.prisma.product.findMany({ where: { merchantId }, orderBy: { createdAt: 'desc' } });
    return rows.map((p) => this.serialize(p));
  }

  async create(merchantId: string, input: CreateProductInput) {
    const p = await this.prisma.product.create({
      data: {
        merchantId, name: input.name, sku: input.sku ?? null, unitPrice: input.unitPrice,
        imageUrl: input.imageUrl, imagePublicId: input.imagePublicId,
      },
    });
    return this.serialize(p);
  }

  private async own(merchantId: string, id: string) {
    const p = await this.prisma.product.findFirst({ where: { id, merchantId } });
    if (!p) throw new NotFoundException('Product not found');
    return p;
  }

  /** Returns the old imagePublicId when the image is being replaced, so the caller can delete the old asset. */
  async update(merchantId: string, id: string, input: UpdateProductInput): Promise<{ product: any; replacedPublicId: string | null }> {
    const existing = await this.own(merchantId, id);
    const data: any = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.sku !== undefined) data.sku = input.sku;
    if (input.unitPrice !== undefined) data.unitPrice = input.unitPrice;
    if (input.active !== undefined) data.active = input.active;
    let replacedPublicId: string | null = null;
    if (input.imageUrl !== undefined && input.imagePublicId !== undefined) {
      data.imageUrl = input.imageUrl;
      data.imagePublicId = input.imagePublicId;
      replacedPublicId = existing.imagePublicId ?? null;
    }
    const p = await this.prisma.product.update({ where: { id }, data });
    return { product: this.serialize(p), replacedPublicId };
  }

  async archive(merchantId: string, id: string) {
    await this.own(merchantId, id);
    const p = await this.prisma.product.update({ where: { id }, data: { active: false } });
    return this.serialize(p);
  }
}
```

Note: `update` now returns `{ product, replacedPublicId }` — the controller unwraps it. `archive` and `create` still return the serialized product directly.

- [ ] **Step 3: Rewrite the controller for multipart**

Replace `be/src/products/products.controller.ts` with:

```ts
import {
  BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Req,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProductsService } from './products.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { parsePositiveAmount } from '../common/amount.util';
import { validateProductImage, MAX_IMAGE_BYTES } from './product-image.validation';

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

// Reject unsupported types early at the multer layer; size is capped via limits below.
const fileInterceptor = FileInterceptor('image', {
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter: (_req, file, cb) => {
    const r = validateProductImage({ mimetype: file.mimetype, size: 1 });
    cb(r.ok ? null : new BadRequestException(r.error), r.ok);
  },
});

@Controller('merchant/products')
@UseGuards(JwtGuard, RolesGuard)
@Roles('merchant')
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  @Get()
  list(@Req() req: any) { return this.products.listForMerchant(req.user.sub); }

  @Post()
  @UseInterceptors(fileInterceptor)
  async create(@Req() req: any, @Body() dto: CreateProductDto, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Product image is required');
    const check = validateProductImage({ mimetype: file.mimetype, size: file.size });
    if (!check.ok) throw new BadRequestException(check.error);
    const { url, publicId } = await this.cloudinary.uploadImage(file.buffer);
    return this.products.create(req.user.sub, {
      name: dto.name, sku: dto.sku ?? null, unitPrice: parsePositiveAmount(dto.unitPrice, 'unitPrice'),
      imageUrl: url, imagePublicId: publicId,
    });
  }

  @Patch(':id')
  @UseInterceptors(fileInterceptor)
  async update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateProductDto, @UploadedFile() file?: Express.Multer.File) {
    let imageUrl: string | undefined;
    let imagePublicId: string | undefined;
    if (file) {
      const check = validateProductImage({ mimetype: file.mimetype, size: file.size });
      if (!check.ok) throw new BadRequestException(check.error);
      const uploaded = await this.cloudinary.uploadImage(file.buffer);
      imageUrl = uploaded.url;
      imagePublicId = uploaded.publicId;
    }
    const { product, replacedPublicId } = await this.products.update(req.user.sub, id, {
      name: dto.name, sku: dto.sku,
      unitPrice: dto.unitPrice !== undefined ? parsePositiveAmount(dto.unitPrice, 'unitPrice') : undefined,
      active: dto.active, imageUrl, imagePublicId,
    });
    if (replacedPublicId) await this.cloudinary.deleteImage(replacedPublicId);
    return product;
  }

  @Delete(':id')
  archive(@Req() req: any, @Param('id') id: string) { return this.products.archive(req.user.sub, id); }
}
```

Notes: multipart form fields arrive as strings, so `unitPrice`/`sku`/`name` DTO validation is unchanged. `active` from a multipart field would be a string — but the current fe edit flow doesn't send `active` via this form (archive is a separate DELETE), so it stays optional and untouched here.

- [ ] **Step 4: Typecheck / build**

```bash
cd be && pnpm build
```

Expected: builds without type errors. If `Express.Multer.File` is unresolved, confirm `@types/multer` installed in Task 4 Step 1.

- [ ] **Step 5: Run the products unit tests (if any) + validation test**

```bash
cd be && pnpm test products
```

Expected: existing product tests (if present) still pass; the validation spec passes. If there are no product service tests, only the validation spec runs — that's fine.

- [ ] **Step 6: Commit**

```bash
git add be/src/products
git commit -m "feat(be): multipart product create/update with Cloudinary upload"
```

---

## Task 6: Frontend — image helper (plain-TS, TDD)

**Files:**
- Create: `fe/src/lib/product-image.ts`
- Test: `fe/src/lib/product-image.test.ts`

- [ ] **Step 1: Write the failing test**

Create `fe/src/lib/product-image.test.ts`:

```ts
import { validateImageFile, MAX_IMAGE_BYTES, ALLOWED_IMAGE_MIMES } from './product-image';

const fakeFile = (type: string, size: number): File =>
  ({ type, size, name: 'x' } as unknown as File);

describe('validateImageFile', () => {
  it('accepts a small jpeg/png/webp', () => {
    expect(validateImageFile(fakeFile('image/jpeg', 1024))).toBeNull();
    expect(validateImageFile(fakeFile('image/png', 1024))).toBeNull();
    expect(validateImageFile(fakeFile('image/webp', 1024))).toBeNull();
  });

  it('rejects a disallowed type', () => {
    expect(validateImageFile(fakeFile('image/gif', 1024))).toBe('Image must be JPEG, PNG, or WebP');
  });

  it('rejects a file over 5 MB', () => {
    expect(validateImageFile(fakeFile('image/jpeg', MAX_IMAGE_BYTES + 1))).toBe('Image must be 5 MB or smaller');
  });

  it('rejects an empty file', () => {
    expect(validateImageFile(fakeFile('image/jpeg', 0))).toBe('Image is empty');
  });

  it('exposes constants matching the backend', () => {
    expect(ALLOWED_IMAGE_MIMES).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    expect(MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

```bash
cd fe && pnpm test product-image
```

Expected: FAIL — cannot find module `./product-image`.

- [ ] **Step 3: Implement the helper**

Create `fe/src/lib/product-image.ts`:

```ts
// Framework-free client-side image validation. Mirrors be's product-image.validation.ts.
// Returns an error string, or null when the file is acceptable.
export const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

export function validateImageFile(file: File): string | null {
  if (!ALLOWED_IMAGE_MIMES.includes(file.type as (typeof ALLOWED_IMAGE_MIMES)[number])) {
    return 'Image must be JPEG, PNG, or WebP';
  }
  if (file.size <= 0) return 'Image is empty';
  if (file.size > MAX_IMAGE_BYTES) return 'Image must be 5 MB or smaller';
  return null;
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd fe && pnpm test product-image
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fe/src/lib/product-image.ts fe/src/lib/product-image.test.ts
git commit -m "feat(fe): client-side product image validation helper"
```

---

## Task 7: Frontend — multipart proxy passthrough

**Files:**
- Modify: `fe/src/lib/session-backend.ts`
- Modify: `fe/src/app/api/merchant/products/route.ts`
- Modify: `fe/src/app/api/merchant/products/[id]/route.ts`

- [ ] **Step 1: Add a raw (non-JSON) backend fetch helper**

Edit `fe/src/lib/session-backend.ts` — add a second exported function that attaches the Bearer token but does NOT set `Content-Type` (so the forwarded multipart boundary is preserved):

```ts
import { cookies } from 'next/headers';
import { ACCESS_COOKIE } from './session';
import { serverEnv } from './env';

export function buildAuthHeaders(token: string | undefined): Record<string, string> {
  if (!token) throw new Error('unauthenticated: no session token');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export async function sessionBackendFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  return fetch(`${serverEnv().navyApiUrl}${path}`, { ...init, headers: { ...buildAuthHeaders(token), ...(init?.headers ?? {}) }, cache: 'no-store' });
}

/** Like sessionBackendFetch but WITHOUT a forced JSON content-type — for forwarding multipart bodies. */
export async function sessionBackendFetchRaw(path: string, init?: RequestInit): Promise<Response> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) throw new Error('unauthenticated: no session token');
  return fetch(`${serverEnv().navyApiUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
}
```

- [ ] **Step 2: Forward multipart on POST**

Replace `fe/src/app/api/merchant/products/route.ts` with:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { sessionBackendFetch, sessionBackendFetchRaw } from '@/lib/session-backend';
import { guardOrigin } from '@/lib/request-guards';

export async function GET() {
  const res = await sessionBackendFetch('/merchant/products');
  return NextResponse.json(await res.json().catch(() => ([])), { status: res.status });
}

export async function POST(req: NextRequest) {
  const rejected = guardOrigin(req);
  if (rejected) return rejected;
  const form = await req.formData();
  const res = await sessionBackendFetchRaw('/merchant/products', { method: 'POST', body: form });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
```

Note: passing a `FormData` as `body` lets `fetch` set the multipart `Content-Type` (with boundary) itself — do not set it manually.

- [ ] **Step 3: Forward multipart on PATCH**

Replace `fe/src/app/api/merchant/products/[id]/route.ts` with:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { sessionBackendFetch, sessionBackendFetchRaw } from '@/lib/session-backend';
import { guardOrigin } from '@/lib/request-guards';

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rejected = guardOrigin(req);
  if (rejected) return rejected;
  const { id } = await ctx.params;
  const form = await req.formData();
  const res = await sessionBackendFetchRaw(`/merchant/products/${id}`, { method: 'PATCH', body: form });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rejected = guardOrigin(req);
  if (rejected) return rejected;
  const { id } = await ctx.params;
  const res = await sessionBackendFetch(`/merchant/products/${id}`, { method: 'DELETE' });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
```

`sessionBackendFetch` (JSON) is still used by GET and DELETE, so keep both imports.

- [ ] **Step 4: Typecheck**

```bash
cd fe && pnpm exec tsc --noEmit
```

Expected: no type errors. (`parseJson` is no longer imported in these two routes — that's fine; it remains used elsewhere.)

- [ ] **Step 5: Commit**

```bash
git add fe/src/lib/session-backend.ts fe/src/app/api/merchant/products/route.ts "fe/src/app/api/merchant/products/[id]/route.ts"
git commit -m "feat(fe): forward multipart product uploads through the proxy"
```

---

## Task 8: Frontend — ProductForm file input + preview + FormData submit

**Files:**
- Modify: `fe/src/app/merchant/products/ProductForm.tsx`

- [ ] **Step 1: Rewrite ProductForm**

Replace `fe/src/app/merchant/products/ProductForm.tsx` with:

```tsx
'use client';
import { useState } from 'react';
import { usdcInputToBaseUnits } from '@/lib/money';
import { formatUsdc } from '@/lib/dashboard/stats';
import { validateImageFile, ALLOWED_IMAGE_MIMES } from '@/lib/product-image';
import { Button } from '@/ui/Button';
import { Text } from '@/ui/Text';
import { useToast } from '@/ui/Toast';
import { mapError } from '@/lib/mapError';
import { NavyApiError } from '@/lib/navyApi';
import { detailOf } from '@/lib/httpError';
import { colors, space, radius } from '@/ui/theme';

const inputStyle: React.CSSProperties = {
  background: colors.bgElevated, border: `1px solid ${colors.borderStrong}`,
  borderRadius: radius.md, color: colors.text, padding: '12px 14px', outline: 'none', width: '100%',
};

export interface ProductRow { id: string; name: string; sku: string | null; unitPrice: string; imageUrl: string | null; active: boolean; }

export function ProductForm({ initial, onSaved }: { initial?: ProductRow; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? '');
  const [sku, setSku] = useState(initial?.sku ?? '');
  const [price, setPrice] = useState(initial ? formatUsdc(initial.unitPrice) : '');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(initial?.imageUrl ?? null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError('');
    const f = e.target.files?.[0] ?? null;
    if (!f) { setFile(null); setPreview(initial?.imageUrl ?? null); return; }
    const err = validateImageFile(f);
    if (err) { setError(err); setFile(null); return; }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setError('');
    let unitPrice: string;
    try { unitPrice = usdcInputToBaseUnits(price); } catch (err) { setError((err as Error).message); return; }
    if (unitPrice === '0') { setError('Price must be greater than 0'); return; }
    if (!name.trim()) { setError('Name is required'); return; }
    if (!initial && !file) { setError('Product image is required'); return; }

    const form = new FormData();
    form.append('name', name.trim());
    if (sku.trim()) form.append('sku', sku.trim());
    form.append('unitPrice', unitPrice);
    if (file) form.append('image', file);

    setSaving(true);
    try {
      const res = initial
        ? await fetch(`/api/merchant/products/${initial.id}`, { method: 'PATCH', body: form })
        : await fetch('/api/merchant/products', { method: 'POST', body: form });
      if (!res.ok) throw new NavyApiError('save product failed', res.status, await detailOf(res));
      toast(initial ? 'Product updated' : 'Product added', 'success');
      onSaved();
    } catch (err) {
      setError(mapError(err).detail);
    } finally {
      setSaving(false);
    }
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
      <div style={{ display: 'grid', gap: space.xs }}>
        <Text variant="label" muted upper>{initial ? 'Product image (leave empty to keep current)' : 'Product image'}</Text>
        {preview && (
          <img src={preview} alt="preview" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: radius.md, border: `1px solid ${colors.borderStrong}` }} />
        )}
        <input type="file" accept={ALLOWED_IMAGE_MIMES.join(',')} onChange={onPickFile} style={{ ...inputStyle, padding: '8px 10px' }} />
      </div>
      <div style={{ marginTop: space.sm }}><Button label={initial ? 'Save changes' : 'Add product'} loading={saving} /></div>
      {error && <Text variant="caption" color={colors.danger}>{error}</Text>}
    </form>
  );
}
```

Key changes: `ProductRow` gains `imageUrl`; a validated file input with live preview; submit builds `FormData` (no JSON `Content-Type`); image required on create, optional on edit.

- [ ] **Step 2: Typecheck**

```bash
cd fe && pnpm exec tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add fe/src/app/merchant/products/ProductForm.tsx
git commit -m "feat(fe): product image upload with preview in ProductForm"
```

---

## Task 9: Frontend — thumbnail column in the products table

**Files:**
- Modify: `fe/src/app/merchant/products/page.tsx`

- [ ] **Step 1: Add a thumbnail column**

In `fe/src/app/merchant/products/page.tsx`, add an image column as the first entry in the `cols` array (before the `name` column). Insert this object at the start of the `const cols: Column<ProductRow>[] = [` array:

```tsx
    { key: 'img', header: '', render: (p) => (
      p.imageUrl
        ? <img src={p.imageUrl} alt={p.name} style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 8, border: `1px solid ${colors.borderStrong}` }} />
        : <div style={{ width: 40, height: 40, borderRadius: 8, background: colors.bgElevated, border: `1px solid ${colors.borderStrong}` }} aria-hidden />
    ) },
```

The placeholder `<div>` covers any pre-existing image-less rows. `colors` is already imported in this file.

- [ ] **Step 2: Typecheck**

```bash
cd fe && pnpm exec tsc --noEmit
```

Expected: no type errors. `ProductRow` (imported from `./ProductForm`) already includes `imageUrl` from Task 8, so `p.imageUrl` typechecks.

- [ ] **Step 3: Build the frontend**

```bash
cd fe && pnpm build
```

Expected: `next build` succeeds.

- [ ] **Step 4: Commit**

```bash
git add fe/src/app/merchant/products/page.tsx
git commit -m "feat(fe): product image thumbnail column in dashboard"
```

---

## Task 10: Env documentation

**Files:**
- Modify: `be/.env.example` (create if it does not exist)

- [ ] **Step 1: Document the Cloudinary env vars**

Append to `be/.env.example` (check first whether the file exists with `ls be/.env.example`; if not, create it):

```
# Cloudinary (merchant product images)
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

- [ ] **Step 2: Add the real values to `be/.env` (local, not committed)**

The user has a Cloudinary account. Add the three real values to `be/.env` (this file is gitignored — do NOT commit it). The backend will throw on first product create/update if they're missing.

- [ ] **Step 3: Commit the example**

```bash
git add be/.env.example
git commit -m "docs(be): document Cloudinary env vars"
```

---

## Task 11: Final verification

- [ ] **Step 1: Backend unit tests + build**

```bash
cd be && pnpm test product-image && pnpm build
```

Expected: validation spec passes; build clean.

- [ ] **Step 2: Frontend tests + typecheck + build**

```bash
cd fe && pnpm test product-image && pnpm exec tsc --noEmit && pnpm build
```

Expected: helper spec passes; no type errors; `next build` succeeds.

- [ ] **Step 3: Manual smoke test (requires `be` running + Cloudinary creds in `be/.env`)**

Start Postgres and `be` (per the running-be-server memory: use a background run, DB on `:5433`), start `fe` (`pnpm dev`), log in as a merchant, then:
1. Add a product with a JPEG/PNG/WebP under 5 MB → confirm it saves and the thumbnail shows in the table.
2. Try a `.gif` or a >5 MB file → confirm a clear client-side error and no save.
3. Try to add a product with no image → confirm "Product image is required".
4. Edit an existing product, upload a replacement image → confirm the new thumbnail shows and (in the Cloudinary console) the old asset was removed.

- [ ] **Step 4: Confirm no stray uncommitted changes**

```bash
git status
```

Expected: clean tree (all work committed).

---

## Self-Review Notes

- **Spec coverage:** data model (Task 1), backend-signed upload (Tasks 4–5), required-on-create + replace-on-edit (Task 5 + Task 8), 5 MB / JPEG-PNG-WebP limits (Tasks 3, 6, 5), thumbnail display + placeholder (Task 9), error handling 400/502 (Tasks 5, 4), config/env (Tasks 2, 10), testing split (Tasks 3, 6 unit; rest via tsc/build) — all mapped.
- **Type consistency:** `validateProductImage` (be) returns `{ok, error}`; `validateImageFile` (fe) returns `string | null` — intentionally different shapes for their call sites, both covered by tests. `update()` service return shape `{ product, replacedPublicId }` is consumed only by the controller (Task 5 Step 3). `ProductRow` gains `imageUrl` in Task 8 and is consumed in Task 9.
- **No placeholders:** every code step contains full code.
