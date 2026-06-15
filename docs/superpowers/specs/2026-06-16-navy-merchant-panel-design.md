# Navy — Merchant Panel (Orders Dashboard) Design Spec

**Date:** 2026-06-16
**Status:** Approved (design)
**Sub-project:** 5 of N in the Navy ecosystem (merchant panel)

---

## 0. Context

Navy's foundation (merchant auth/dashboard with API-key issuance + wallet-adapter payout), the `navy_payments` program, the payment gateway (order engine + HMAC `/v1/orders` server-to-server API + on-chain watcher + webhooks), and the admin panel are built. This sub-project gives merchants a **browser dashboard to create and track invoices/orders**.

The gateway's order API is **HMAC-authenticated** (api_key + signature) for server-to-server integration; the browser dashboard cannot HMAC-sign (it doesn't hold the raw secret). So the panel adds **session-authenticated** merchant order endpoints (merchant JWT) that reuse the gateway's `OrdersService`, leaving the HMAC API untouched.

### Decisions locked during brainstorming
- **Add session-auth merchant order endpoints** (create/list/get), behind `JwtGuard + RolesGuard @Roles('merchant')`, scoped to `req.user.sub`.
- **Scope = backend endpoints + fe pages + reorganized dashboard** (Orders / API keys / Payout).
- **Interval polling** for live order status (`awaiting → paid`) — chosen knowingly over manual refresh for the live-checkout UX.
- **Block order creation for unapproved merchants** (`409`).
- **Merchant-scoped** list/get (a merchant only ever sees their own orders).
- Devnet only.

---

## 1. Scope & boundaries

**In scope:**
- Backend `MerchantOrdersController` (`/merchant/orders`) + `OrdersService.listForMerchant`/`getForMerchant`.
- fe pages: `/merchant/orders` (list, polling), `/merchant/orders/new` (create → QR), `/merchant/orders/[id]` (detail, polling); reorganized `/merchant` dashboard with Orders + API keys + Payout sections.
- Next route handlers proxying the backend with the merchant session cookie.

**Out of scope:**
- The HMAC `/v1/orders` server-to-server API (already built; untouched).
- Mobile scan-to-pay (sub-project 6), farming (7).
- Refunds, order editing/cancel, CSV export, analytics.
- Real-time push (SSE/websocket) — polling only.

---

## 2. Backend — session order endpoints

`MerchantOrdersController` at `/merchant/orders`, guarded by `JwtGuard + RolesGuard` `@Roles('merchant')`; the merchant id is always `req.user.sub` (identity never taken from the body).

- `POST /merchant/orders` — body `{ amount: string, reference: string, expiresInSec?: number }`. **Precondition:** the merchant's `approvalStatus === 'approved'` → else `409` (an unapproved merchant's invoice can't be paid on-chain). Delegates to `OrdersService.create(merchantId, { amount: BigInt(amount), reference, expiresInSec })`. Returns `{ orderId, payUrl, qr, amount, expiresAt, status }`.
- `GET /merchant/orders?status=&take=&skip=` — `OrdersService.listForMerchant(merchantId, { status?, take, skip })` (filters by `merchantId` + optional status). Returns an array of `{ id, reference, amount, status, createdAt, paidAt }`.
- `GET /merchant/orders/:id` — `OrdersService.getForMerchant(merchantId, id)` → returns the order or `404` if it isn't this merchant's.

New `OrdersService` methods (extend the existing service from the gateway):
```
listForMerchant(merchantId, { status?, take=50, skip=0 })  // prisma.order.findMany scoped by merchantId (+status)
getForMerchant(merchantId, id)                              // findFirst({ where: { id, merchantId } }) or null
```
A small `assertApproved(merchantId)` check (reuse the merchant's `approvalStatus`) gates `POST`.

---

## 3. fe — merchant pages + dashboard

- **`/merchant`** dashboard reorganized into three sections:
  - **Orders** — a "New invoice" button + a few recent orders (link to the full list).
  - **API keys** — the existing `ApiKeyPanel`.
  - **Payout** — the existing `WalletConnect`.
- **`/merchant/orders`** — list (reference, amount, status, created); a client component that **polls `GET /api/merchant/orders` every ~4s** so newly-paid orders update live; "New invoice" → `/merchant/orders/new`.
- **`/merchant/orders/new`** — form (amount in USDC, reference, optional expiry) → `POST /api/merchant/orders` → on success **renders the QR (data-URL) + payUrl + orderId** for the merchant to present to a customer, with a link to the order detail.
- **`/merchant/orders/[id]`** — detail: amount, reference, **status (live-polled every ~4s while non-terminal)**, payer, tx signature (devnet explorer link), and the QR. Polling stops once `paid`/`expired`/`failed`.
- **Next route handlers** proxy the backend with the merchant session cookie Bearer: `POST /api/merchant/orders`, `GET /api/merchant/orders`, `GET /api/merchant/orders/[id]`. Reuses the session→Bearer fetch helper from the admin panel, **generalized to `sessionBackendFetch`** in `fe/src/lib` (role-agnostic: forwards the `ACCESS_COOKIE` token as Bearer).

---

## 4. Data flow (create → pay → see-paid)

```
merchant login → /merchant → New invoice → POST /api/merchant/orders → backend create → { orderId, qr }
   merchant shows the QR
customer scans (Navy mobile wallet, sub-project 6) → pays via navy_payments (gasless)
   gateway watcher marks order 'paid' + fires HMAC webhook to the merchant server
merchant's /merchant/orders[/:id] poll → status flips to 'paid' (payer + tx shown)
```

---

## 5. Error handling & edge cases

- Create while not approved → `409` (UI: "your account isn't approved yet").
- `amount ≤ 0` → `400` (OrdersService already validates).
- `GET`/list scoped to the merchant; another merchant's order → `404`.
- Order past `expiresAt` → shown as `expired` (the watcher's `expireStale` sets it; the detail page reflects it and stops polling).
- Session expired (`401` from the backend through the proxy) → fe redirects to `/merchant/login`.
- Invalid amount input (non-numeric) → client-side validation + backend `400`.

---

## 6. Testing strategy

- **Unit (be):** `listForMerchant` scoping (`where.merchantId`), `getForMerchant` ownership (returns null/!=merchant → controller 404), `POST` approval precondition (`409`), delegation to `OrdersService.create`. Reuse existing `OrdersService.create` tests.
- **fe:** `sessionBackendFetch` (cookie→Bearer) unit test (generalized helper); the create-form submit + the polling hook logic (light unit, mocked fetch + timers). Route-handler proxy auth.
- **Manual smoke:** log in as an approved merchant → create an invoice → QR renders → simulate a payment via the gateway (or the localnet harness) → the list/detail flips to `paid`.

---

## 7. Deferred / future

- Real-time status via SSE/websocket (replace polling).
- Order cancel/expire-now, refunds (needs a program/gateway change).
- Order search/filter/sort, CSV export, revenue analytics.
- Email receipts to the customer.
