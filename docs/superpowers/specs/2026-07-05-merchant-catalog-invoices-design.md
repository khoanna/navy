# Merchant Product Catalog + Line-Item Invoices — Design

**Date:** 2026-07-05
**Status:** Approved (design), pending implementation plan
**Apps touched:** `be/` (Nest + Prisma), `fe/` (merchant dashboard), `web-wallet/` (pay page)

## Problem

The merchant invoice flow is too primitive: a merchant types a raw USDC amount and a free-text
reference. There is no product catalog, no itemization, and no tax/fee handling. Merchants want to:

1. Manage a catalog of **SKUs / products** (name, code, unit price).
2. Build invoices from **line items** (product × quantity) rather than a raw amount.
3. Configure **tax and service charges** once (in Settings) and have every invoice apply them.
4. Have the **order reference auto-generated** (`ORD-…`) instead of typed.
5. Pick expiry from **friendly presets** instead of raw seconds.
6. Attach an optional **description** to an invoice.

## Locked decisions

- **Invoices are SKU-items-only.** Every invoice line references a catalog `Product`. No ad-hoc
  "just type an amount" line. A merchant must have ≥1 product before invoicing; the form guides
  them to create one when the catalog is empty.
- **Tax + fees are merchant-level settings, not per-invoice input.** A merchant configures a list
  of named charges (tax, service charge, …) in Settings; each invoice snapshots the active charges.
- **Single combined spec** (catalog + charges + line-item invoices + pay-page + polish), built as
  one coordinated change.
- **Reference is server-generated**, random `ORD-` + 8 Crockford-base32 chars. Not DB-unique (it is
  a label, not a key). Random over sequential — sequential leaks order volume and needs a counter+lock.
- **Money is authoritative on the backend.** The frontend computes a preview via a shared plain-TS
  helper, but the backend recomputes `subtotal`/charges/`total` from the DB on create and never trusts
  client-supplied totals.
- **On-chain unchanged.** `pay_invoice` charges exactly `order.amount` (= the computed total). Tax and
  fees are off-chain display/breakdown data that roll into that single total. Navy's 1% fee still
  applies to the total.

## Data model (Prisma — `be/prisma/schema.prisma`)

Four new models plus changes to `Order`. New rows are always fully populated; nullable columns exist
only for backward compatibility with historical rows.

### `Product` — the SKU catalog
```prisma
model Product {
  id         String   @id @default(uuid())
  merchantId String
  merchant   Merchant @relation(fields: [merchantId], references: [id])
  name       String
  sku        String?                       // optional merchant-facing code, e.g. "TSHIRT-M"
  unitPrice  BigInt                         // base units (USDC 6dp)
  active     Boolean  @default(true)        // archived products stay referencible by old orders
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}
```

### `MerchantCharge` — tax + service charges (managed in Settings)
```prisma
model MerchantCharge {
  id         String   @id @default(uuid())
  merchantId String
  merchant   Merchant @relation(fields: [merchantId], references: [id])
  name       String                         // "VAT", "Service charge", ...
  mode       String                         // 'percent' | 'fixed'
  value      Int                            // percent → basis points (10% = 1000); fixed → base units
  active     Boolean  @default(true)
  sortOrder  Int      @default(0)           // display + application order
  createdAt  DateTime @default(now())
}
```
`value` is `Int`; fixed charges in base units fit comfortably (a $ fixed fee is small). Percent is bps.

### `OrderItem` — invoice line items (price/name snapshotted)
```prisma
model OrderItem {
  id        String  @id @default(uuid())
  orderId   String
  order     Order   @relation(fields: [orderId], references: [id])
  productId String?                          // nullable so archived/deleted products don't orphan
  name      String                           // snapshot of Product.name at create time
  unitPrice BigInt                            // snapshot of Product.unitPrice at create time
  quantity  Int
}
```

### `OrderCharge` — charges applied to a specific invoice (snapshot)
```prisma
model OrderCharge {
  id      String @id @default(uuid())
  orderId String
  order   Order  @relation(fields: [orderId], references: [id])
  name    String                             // snapshot of MerchantCharge.name
  mode    String                             // 'percent' | 'fixed'
  value   Int                                // snapshot of MerchantCharge.value
  amount  BigInt                             // computed applied amount, base units
}
```

### `Order` — changes
- Add `subtotal BigInt?` — sum of line items (nullable for pre-existing rows).
- Add `description String?`.
- Add relations `items OrderItem[]`, `charges OrderCharge[]`.
- `amount` remains the **total** (= on-chain charge = subtotal + Σ charge amounts).
- `reference` remains required in the DB but is now server-generated.
- The `taxBps` column from the earlier tax-only design is **not** added — replaced by `OrderCharge`.

## Money math (authoritative; all integer base units, BigInt)

```
subtotal = Σ (item.unitPrice × item.quantity)

for each active MerchantCharge (in sortOrder):
    percent → amount = subtotal × value / 10000       // integer floor
    fixed   → amount = value
    snapshot { name, mode, value, amount } → OrderCharge

total = subtotal + Σ charge.amount
```

Rules:
- Percent charges are **all computed on the SKU subtotal** — no compounding (no tax-on-service-charge).
  Documented simplification; compounding/ordering can be a later refinement.
- Integer division floors each percent charge independently.
- `MIN_INVOICE_AMOUNT` (10_000 base units) is checked against **total**.
- `order.amount = total`.

## Shared logic

`computeInvoiceTotals(items, charges)` — a **plain-TS, framework-free** helper implementing the math
above, unit-tested. Mirrored in:
- `be/src/payments/invoice-totals.ts` (authoritative; used by `OrdersService.create`)
- `fe/src/lib/invoice-totals.ts` (client preview in the New Invoice modal)

Both must produce identical results for identical inputs (same integer semantics). Backend is the
source of truth; the fe copy is cosmetic preview only.

## Backend

### Products
- `ProductsController` + `ProductsService` (merchant-scoped, `JwtGuard + RolesGuard + @Roles('merchant')`).
- Routes (dashboard): `GET /merchant/products`, `POST /merchant/products`,
  `PATCH /merchant/products/:id`, `DELETE /merchant/products/:id` (soft archive → `active=false`).
- Validation: `name` non-empty, `unitPrice` positive base-unit string (BigInt), `sku` optional.

### Charges
- `MerchantChargesController` + `MerchantChargesService` (or folded into the merchant module),
  merchant-scoped.
- Routes: `GET /merchant/charges`, `POST /merchant/charges`, `PATCH /merchant/charges/:id`,
  `DELETE /merchant/charges/:id`.
- Validation: `mode ∈ {percent, fixed}`; percent `value` in 0..(cap, e.g. 10000 bps); fixed
  `value ≥ 0`.

### Orders
- `CreateOrderInput` becomes `{ items: [{ productId, quantity }], description?, expiresInSec?, callbackUrl? }`.
  Drops `amount` and `reference`.
- `OrdersService.create`:
  1. Reject empty `items`.
  2. Load referenced products; assert each belongs to `merchantId` and `active` (reject otherwise).
  3. Snapshot each into `OrderItem` (name, unitPrice, quantity); compute `subtotal`.
  4. Load active `MerchantCharge`s (sortOrder); compute + snapshot into `OrderCharge`; compute `total`.
  5. Assert `total ≥ MIN_INVOICE_AMOUNT`.
  6. Generate `reference` = `generateOrderReference()` (`ORD-` + 8 Crockford-base32 from `crypto.randomBytes`).
  7. Create `Order` (+ nested `items`, `charges`) in one transaction. Existing `onchainInvoiceId`
     derivation and QR/payUrl generation are unchanged.
- API-key order path (`orders.controller.ts`) accepts the same `{ items, description? }` shape.
- `serialize()`, the `payment-tx` invoice payload, and order-detail responses include `items`,
  `charges`, `subtotal`, `total`, `description` (all BigInts → strings).

## Frontend — merchant dashboard (`fe/`)

- **New "Products" nav tab** (`/merchant/products`), added to `MERCHANT_NAV` (icon `store` or `orders`).
  - Catalog `DataTable` (name, SKU, unit price, active) with a create/edit `Modal`
    (name, SKU code, unit price, active toggle) and archive action. Reuses the existing `Modal`,
    `Button`, `DataTable`, and input styling from the orders/new-invoice work.
- **Settings → new "Charges" section** (in `/merchant/settings`), below the existing wallet/API panels.
  - List of charges with add/edit/remove (name, percent|fixed, value, active), Navy design language.
- **New Invoice modal** (`NewInvoiceForm.tsx`) reworked:
  - Replace the amount input with a **line-item builder**: add rows, each selecting a `Product` from
    the catalog and a quantity. Show per-line amount.
  - **Live breakdown preview**: Subtotal / each active charge / **Total**, via `computeInvoiceTotals`.
  - Keep Description (memo) + Expiry **preset dropdown** (15 min / 1 hour / 24 hours / 7 days → seconds).
  - Reference input removed; success state shows the generated `ORD-…` reference (labeled) with the QR.
  - Empty catalog → replace the builder with a prompt/link to create a product first.
- **Order detail** (`/merchant/orders/[id]`) — render line items + charge breakdown + subtotal/total.

## Frontend — pay page (`web-wallet/`)

- `/pay/[orderId]` — show the itemized lines and the charge breakdown (Subtotal / charges / Total)
  above the amount card / pay button, sourced from the enriched `payment-tx` invoice payload.
  Follows the restrained list style of the existing wallet screens.

## Expiry presets

Frontend-only mapping (backend already accepts `expiresInSec`): `15 min → 900`, `1 hour → 3600`,
`24 hours → 86400`, `7 days → 604800`. Default `15 min`.

## Testing

- `computeInvoiceTotals` — unit tests in `be` (`invoice-totals.spec.ts`) and `fe`
  (`src/lib/invoice-totals.test.ts`): subtotal, percent charge, fixed charge, mixed, floor rounding,
  `MIN_INVOICE_AMOUNT` boundary.
- `ProductsService` / `MerchantChargesService` specs: merchant scoping, archive, validation.
- `orders.service.spec.ts` updated: create from items, product-ownership rejection, charge snapshotting,
  generated reference, total = on-chain amount.
- Gates: `be` `pnpm test` + `pnpm build`; `fe` `pnpm exec tsc --noEmit` + `pnpm build`;
  `web-wallet` `pnpm exec tsc --noEmit` + `pnpm build`.
- Prisma: `DATABASE_URL=… pnpm prisma migrate dev --name catalog_charges_line_items` then
  `prisma generate`.

## Out of scope / deferred

- Per-product tax rates and product categories.
- Product images / descriptions on the pay page.
- Compounding/ordered tax (tax-on-service-charge).
- Ad-hoc invoice lines (custom amount not tied to a SKU).
- Discounts / coupons.
- Inventory tracking / stock counts.
