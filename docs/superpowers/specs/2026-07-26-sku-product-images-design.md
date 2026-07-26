# SKU Product Images via Cloudinary — Design

**Date:** 2026-07-26
**Status:** Approved (design), pending implementation plan

## Purpose

Merchants create and manage SKU products in the merchant dashboard (`fe/src/app/merchant/products`). Today a product is just `{ name, sku?, unitPrice, active }`. This adds a **product image**: uploaded when a SKU is created, displayed as a thumbnail in the dashboard for easier management, and replaceable when editing. Images are stored on **Cloudinary**.

## Locked decisions

- **Upload flow: signed, through the backend.** Browser sends the file → `fe` proxy → `be` (NestJS) → `be` uploads the buffer to Cloudinary using the API secret → returns the URL. The Cloudinary secret never leaves the server; `be` owns validation and size limits. No unsigned upload preset.
- **Image is required on create.** Every new SKU must include an image before it can be saved. Editing can replace the image.
- **Constraints:** accept `image/jpeg`, `image/png`, `image/webp`; max **5 MB**. Violations rejected with HTTP 400.
- The user has a Cloudinary account (cloud name + API key + secret) to populate in `be/.env`.

## Data model

`be/prisma/schema.prisma` — extend `Product`:

```
model Product {
  id            String   @id @default(uuid())
  merchantId    String
  merchant      Merchant @relation(fields: [merchantId], references: [id])
  name          String
  sku           String?
  unitPrice     BigInt
  imageUrl      String?   // Cloudinary secure_url; nullable in DB for pre-existing rows, required at the API for new products
  imagePublicId String?   // Cloudinary public_id — needed to delete/replace the old asset
  active        Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

New migration via `pnpm prisma migrate dev --name product_image` (with `DATABASE_URL` in the shell env per the Prisma 7 gotcha). Columns are nullable so existing rows migrate cleanly; the *API layer* enforces required-on-create.

## Backend (`be/`)

### CloudinaryModule / CloudinaryService
- New module wrapping the `cloudinary` npm SDK (add to `pnpm.onlyBuiltDependencies` if it has a native build; it does not, but verify on install).
- `uploadImage(buffer, filename): Promise<{ url, publicId }>` — uploads to a `navy/products` folder, returns `secure_url` + `public_id`.
- `deleteImage(publicId): Promise<void>` — best-effort destroy; failures logged, non-fatal.
- Config via three new `ConfigService` getters: `cloudinaryCloudName`, `cloudinaryApiKey`, `cloudinaryApiSecret` (required env vars `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`). SDK configured once at module init.

### products.controller.ts
- `POST /merchant/products` and `PATCH /merchant/products/:id` switch from JSON to **multipart**, using `@UseInterceptors(FileInterceptor('image'))` + `@UploadedFile()`. `FileInterceptor` uses memory storage (buffer), with `limits.fileSize = 5 MB` and a `fileFilter` restricting mime types to jpeg/png/webp → 400 on violation.
- Text fields (`name`, `sku`, `unitPrice`) arrive as multipart form fields (strings); parse `unitPrice` to BigInt as today. Keep DTO validation.

### products.service.ts
- **Create:** an uploaded image is required → if absent, 400. Upload to Cloudinary, then persist `imageUrl` + `imagePublicId` with the product. Upload happens **before** the DB write; a Cloudinary failure → 502 and no row is created.
- **Update:** if a new image is provided, upload the new one, persist the new url/publicId, then best-effort delete the *old* `imagePublicId`. If no image in the PATCH, leave the existing image untouched.
- Serialize `imageUrl` (and keep the existing `unitPrice → string` BigInt serialization) in all responses. `imagePublicId` need not be exposed to the client.

## Frontend (`fe/`)

### ProductForm.tsx
- Add a file `<input type="file" accept="image/jpeg,image/png,image/webp">` with a live client-side preview (`URL.createObjectURL`). Required on create (disable submit until a file is chosen); optional on edit (empty = keep current image, show current thumbnail).
- Submit builds a `FormData` (file under key `image` + `name`/`sku`/`unitPrice`) instead of JSON. `unitPrice` still computed via `usdcInputToBaseUnits()`.
- Client-side pre-validation of type/size (mirror the 5 MB / mime rules) for a fast error before hitting the network; the backend remains authoritative.

### Proxy routes
- `api/merchant/products/route.ts` (POST) and `api/merchant/products/[id]/route.ts` (PATCH) forward the multipart body through to `be`. Add a **multipart-aware variant** of the session-backend helper that attaches the JWT Bearer but does **not** set `Content-Type: application/json` — let fetch set the multipart boundary. GET/DELETE unchanged.

### products/page.tsx
- Add a thumbnail column to the DataTable, rendering `imageUrl` (small `<img>` / `next/image`) with a neutral placeholder fallback for rows lacking an image.

## Error handling

| Case | Behavior |
|---|---|
| Bad mime type / >5 MB | 400, no upload, no DB write |
| Missing image on create | 400 |
| Cloudinary upload fails | 502, no DB write (upload precedes persist) |
| Old-asset delete fails on replace | Logged, non-fatal; new image already saved |

## Testing

Per the repo convention (keep non-UI logic in plain-TS, unit-test that; verify UI/SDK via `tsc`/`build`):
- **Unit-testable (jest):** a framework-free file-validation helper (mime + size) reused by client pre-validation and the backend `fileFilter`; the `FormData` builder in `fe/src/lib`.
- **Verified via `tsc`/`build`:** `CloudinaryService`, the multipart controller, `ProductForm`, and the proxy routes (chain SDK / HTTP / React not unit-tested here).
- Manual: create a SKU with an image, confirm the thumbnail renders in the dashboard and the asset lands in Cloudinary; edit to replace the image and confirm the old asset is removed.

## Out of scope (YAGNI)

- Multiple images / galleries per product.
- Client-side cropping/resizing (Cloudinary transformations can be applied at render time via URL params later if wanted).
- Backfilling images for pre-existing image-less products.
