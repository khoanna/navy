# Navy — Payment Gateway (Engine) Design Spec

**Date:** 2026-06-13
**Status:** Approved (design)
**Sub-project:** 3 of N in the Navy ecosystem (payment gateway)

---

## 0. Context

Navy is a Solana payment ecosystem. Sub-project 1 (Identity & Wallet Foundation) and sub-project 2 (`navy_payments` Anchor program) are built. This sub-project is the **ZaloPay-style payment gateway engine**: a merchant's server creates an order via the Navy API, the user's Navy mobile wallet scans a QR and pays USDC through `navy_payments` (gasless, relayer-submitted), and on the on-chain `InvoicePaid` event Navy marks the order paid and fires an HMAC-signed webhook to the merchant. Funds settle directly to the merchant payout on-chain (the program's atomic 99/1 split), so "settlement" is status + webhook.

### Decisions locked during brainstorming
- **Scope = backend engine + protocol only** (in `be/`), plus a one-time **devnet bring-up** of `navy_payments`. No UI — the merchant dashboard (sub-project 5) and mobile scan-to-pay (sub-project 6) consume these endpoints later.
- **QR = Navy-custom** (the paying wallet is the Navy mobile app): QR encodes a Navy pay URL; the app builds/sign/submits via Navy endpoints reusing the `onchain/client` helpers.
- **Backend builds the transaction** (relayer co-signs only the tx it built) — the relayer never co-signs an arbitrary client-supplied tx.
- **USDC = Circle devnet USDC**, mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (6 decimals); test users fund via Circle's faucet (faucet.circle.com → Solana Devnet).
- Reuses the foundation's **HMAC merchant API keys** and merchant records (`approvalStatus`, `payout_address`).

---

## 1. Scope & boundaries

**In scope (all in `be/`, a new `payments/` area + a one-time onchain bring-up):**
- Order lifecycle API (create/get) authenticated by merchant HMAC API keys.
- Navy-custom QR / payment-request format.
- `OnchainModule` wrapping `navy_payments` (IDL + relayer keypair + Config/treasury/USDC).
- `RelayerService`: build the gasless `pay_invoice` tx; co-sign + submit the user-signed tx.
- `ChainWatcherService`: confirm signatures, decode `InvoicePaid`, mark orders paid; periodic reconciliation + order expiry.
- `WebhookService`: HMAC-signed merchant callbacks with retry/backoff.
- Devnet bring-up: deploy `navy_payments`, init `Config` (Circle devnet USDC, fee, treasury), `register_merchant` for approved merchants.

**Out of scope (later sub-projects):**
- Merchant dashboard UI (order list, manual invoice creation) → **Merchant Panel** (sub-project 5).
- Mobile scan-to-pay UI → **Mobile Wallet** (sub-project 6).
- Mainnet deployment + program audit.
- Refunds, partial payments, multi-currency.

---

## 2. Architecture & components

```
Merchant server ──POST /v1/orders (HMAC)──▶ OrdersModule ──▶ Order(created)
                                                  │ returns orderId + QR (navy://pay/:id)
Navy mobile wallet ──scan QR──▶ GET /v1/orders/:id/payment-tx?payer=PK
                                                  │ RelayerService builds pay_invoice tx,
                                                  │ partial-signs as relayer (fee payer)
        ◀── serialized partial tx + typed invoice ┘
   user signs (wallet) ──POST /v1/orders/:id/submit { signedTx }──▶
                                                  │ verify tx == issued, relayer submits
                                                  ▼
                                  navy_payments (devnet) pay_invoice
                                                  │ emits InvoicePaid
                          ChainWatcherService confirms + decodes ──▶ Order(paid)
                                                  │
                          WebhookService ──HMAC POST──▶ merchant callback_url
```

Backend modules: `OrdersModule` (controller + service + entity), `OnchainModule` (program client + relayer), `RelayerService`, `ChainWatcherService`, `WebhookService`. Each is a focused, independently testable unit; the on-chain tx-building/PDA helpers are reused from `onchain/client` (imported by `OnchainModule`).

---

## 3. Order lifecycle & data model

States: `created → awaiting_payment → confirming → paid`; terminal alternates `expired`, `failed`.

New Prisma entities (extend the existing schema in `be/prisma/schema.prisma`):

```
Order(
  id              uuid pk,
  merchant_id     fk Merchant,
  reference       string,        // merchant's own invoice reference
  amount          bigint,        // USDC base units (6 decimals)
  fee_bps         int,           // snapshot of Config.fee_bps at create time
  status          enum,          // created|awaiting_payment|confirming|paid|expired|failed
  onchain_invoice_id  string,    // 16-byte hex; derived from order id (the Invoice PDA nonce)
  tx_signature    string?,
  payer           string?,       // user pubkey once paid
  callback_url    string?,
  expires_at      timestamptz,
  created_at      timestamptz,
  paid_at         timestamptz?
)

WebhookDelivery(
  id          uuid pk,
  order_id    fk Order,
  url         string,
  status      enum,              // pending|delivered|failed
  attempts    int,
  last_error  string?,
  delivered_at timestamptz?
)
```

The on-chain `invoice_id [u8;16]` = the order UUID's 16 bytes, giving a 1:1 Order ↔ Invoice PDA mapping (the PDA is the pay-once nonce).

---

## 4. Merchant order API (HMAC-authenticated)

- `POST /v1/orders` — merchant server. Auth: `api_key` header + `X-Navy-Signature` = HMAC-SHA256 of the raw body with the merchant's `api_secret` (reuses foundation `ApiKeyService.verify`). Body `{ amount, reference, callbackUrl?, expiresInSec? }`. Preconditions: merchant `approved` + on-chain registered. Snapshots `fee_bps` from Config. Returns `{ orderId, payUrl, qr (PNG data-URL), amount, expiresAt, status }`.
- `GET /v1/orders/:id` — order status (HMAC or a merchant session).

`payUrl` = `navy://pay/<orderId>` with an `https://<host>/pay/<orderId>` fallback; `qr` encodes `payUrl`.

---

## 5. Pay flow (Navy-custom; backend builds the tx)

1. **Build:** Mobile → `GET /v1/orders/:id/payment-tx?payer=<userPubkey>`. Backend (RelayerService) builds the `pay_invoice` tx from the order's params (program id, Config, merchant_authority, payout, treasury, USDC mint, `invoice_id`, amount, `expiry = order.expires_at`), sets `feePayer = relayer`, **partial-signs as relayer**, sets a fresh blockhash, and returns `{ tx: base64(partialTx), invoice: { merchant, amount, reference, expiresAt } }`. Order → `awaiting_payment`. The issued tx (its message bytes) is cached server-side keyed by order id.
2. **Sign:** The wallet shows the typed invoice, the user signs the tx (adds the user signature).
3. **Submit:** Mobile → `POST /v1/orders/:id/submit { signedTx: base64 }`. Backend **verifies** the submitted tx's message bytes equal the cached issued tx (so the relayer only ever co-signed what it built) and that the user signature is present and valid, then submits the raw tx. Order → `confirming`; returns `{ txSignature }`.

**Security rationale:** the relayer pays SOL + the Invoice PDA rent, so it must never sign arbitrary instructions. Building server-side and accepting back only the identical tx (plus the user's signature) makes it impossible for a client to get the relayer to sign anything unexpected.

---

## 6. Watcher / reconciliation

- On submit, confirm the signature (`confirmed` commitment); on success, fetch the tx, decode the `InvoicePaid` event from program logs (via the Anchor `EventParser`/IDL), set `payer`, `tx_signature`, `paid_at`, status `paid`, and enqueue the webhook.
- **Reconciliation sweep** (interval, e.g. 15s): for `confirming` orders, re-check the signature (covers a dropped submit response); for `awaiting_payment` past `expires_at`, set `expired`. Idempotent — re-confirming an already-`paid` order is a no-op.

---

## 7. Webhooks

On `paid`, `POST` to `callback_url`:
```
{ orderId, reference, amount, fee, payer, txSignature, status: "paid", paidAt }
```
Header `X-Navy-Signature: hmac_sha256(rawBody, merchant.api_secret)`. Retry with exponential backoff (up to 5 attempts), recording `WebhookDelivery`. Idempotent: the merchant may also poll `GET /v1/orders/:id`. (No `api_secret` is sent in the body; the merchant verifies the HMAC with their stored secret.)

---

## 8. Devnet bring-up

- `anchor deploy` `navy_payments` to devnet (program id `5Y8xeLpLx2BWHHAZkYMfFQjsRPF2H7sUwmrVP9zjc7az`).
- Init `Config` via the admin CLI: `NAVY_FEE_BPS=100`, `NAVY_USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (Circle devnet USDC), `NAVY_TREASURY` = a Navy-controlled USDC ATA for that mint.
- The **relayer keypair** is a funded devnet account (SOL for fees/rent); its secret is a backend env (`NAVY_RELAYER_SECRET`), never exposed.
- On merchant approval, `register_merchant(merchant_authority = merchant payout wallet pubkey, payout = its USDC ATA for the Circle mint)` — mapping the foundation's off-chain merchant payout to the on-chain `Merchant`. (Admin-triggered; this sub-project provides the wiring/script; the dashboard button is sub-project 5.)
- Test users obtain devnet USDC from Circle's faucet; devnet SOL for the relayer from the Solana airdrop.

---

## 9. Error handling & edge cases

- Order expired at pay time → program rejects via `expiry` (`InvoiceExpired`); gateway marks `failed`/`expired`.
- Double submit → Invoice PDA already exists → program rejects; gateway treats an already-`paid` order idempotently.
- Merchant not approved / not on-chain registered → `409` at order create.
- Submitted tx ≠ issued tx → `400`, no relayer signature.
- Confirmation timeout → reconciliation retries; persistent failure → `failed` after a bound.
- Relayer low on SOL → health alert (logged/metric).
- Webhook endpoint down → retry queue; surfaced via `WebhookDelivery.status`.
- Amount = 0 or below a configured minimum → `400`.

---

## 10. Testing strategy

- **Unit:** order HMAC auth; order-id ↔ `invoice_id` derivation; issued-vs-submitted tx-match validation; webhook HMAC signing; fee-bps snapshot; order state transitions; expiry logic.
- **Integration (localnet with the deployed program, mirroring the `onchain` harness):** create order → `payment-tx` → user signs → `submit` → watcher confirms → assert order `paid` + `InvoicePaid` decoded + webhook POSTed to a local sink with a valid HMAC. Replay/expired/inactive-merchant rejections surface as order `failed`.
- Devnet smoke (manual): real Circle devnet USDC end to end.

---

## 11. Deferred / future

- Merchant dashboard + mobile pay UIs (sub-projects 5, 6).
- Refunds, partial/over-payment handling, multi-token.
- Solana Pay transaction-request compatibility for third-party wallets.
- Mainnet deploy + audit; replace the relayer-trust model with in-program merchant-signature verification (Approach B from the payments spec) if desired.
