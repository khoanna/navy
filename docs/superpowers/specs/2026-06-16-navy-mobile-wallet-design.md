# Navy — Mobile Wallet (Balances, Scan-to-Pay, History) Design Spec

**Date:** 2026-06-16
**Status:** Approved (design)
**Sub-project:** 6 of N in the Navy ecosystem (mobile wallet)

---

## 0. Context

Sub-project 1 built the Expo app's auth + Privy embedded Solana wallet + Navy JWT session (`mobile/`). The payment gateway exposes a Navy-custom QR (`navy://pay/:orderId`) and **public** pay endpoints: `GET /v1/orders/:id/payment-tx?payer=<pubkey>` (backend builds the gasless `pay_invoice` tx, relayer = fee payer, partial-signs) and `POST /v1/orders/:id/submit { signedTx }` (relayer co-signs + submits). This sub-project gives the user wallet its core consumer features: **balances, scan-to-pay, and payment history**.

### Decisions locked during brainstorming
- **Scope = all three** (balances + scan-to-pay + history).
- **History from a new backend endpoint** `GET /user/payments` (Navy JWT, scoped to the JWT's `walletAddress`).
- **Gasless requires `signTransaction` (sign-only)** on the Privy wallet — the relayer is the fee payer and submits; the wallet must NOT `signAndSendTransaction`.
- Circle devnet USDC mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (6 decimals).
- Devnet only.

---

## 1. Scope & boundaries

**In scope:**
- Backend: `GET /user/payments` + `OrdersService.listForPayer`.
- Mobile logic (TDD): `payUrl` parser, `balances` (fetch + format), `NavyPayClient` (order/payment-tx/submit/history), `payFlow` orchestrator.
- Mobile screens: home/balances, scan (expo-camera), confirm-pay, history.

**Out of scope (later/other):**
- Farming agent / subwallet (sub-project 7).
- Sending arbitrary transfers, swaps, receiving via address QR, fiat on-ramp.
- Push notifications, multi-account, mainnet.
- New gateway pay endpoints (reuse existing public `payment-tx`/`submit`).

---

## 2. Backend — payment history endpoint

`GET /user/payments` behind `JwtGuard + RolesGuard @Roles('user')`. The Navy JWT carries `walletAddress` (the Privy embedded wallet, set at user auth). The handler reads `req.user.walletAddress` (never the query) and returns that wallet's paid orders.

New `OrdersService.listForPayer(payerAddress: string, { take=50, skip=0 })`:
```
prisma.order.findMany({ where: { payer: payerAddress, status: 'paid' }, orderBy: { paidAt: 'desc' }, take, skip, include: { merchant: { select: { businessName: true } } } })
→ map to { orderId: id, reference, amount: amount.toString(), status, paidAt, txSignature, merchant: businessName }
```
A new `UserPaymentsController` (`/user/payments`) or a method on an existing user controller. Returns `[]` when the wallet has no payments.

---

## 3. Mobile — logic modules (plain TS, TDD, no React Native imports)

- **`src/pay/payUrl.ts`** — `parsePayUrl(url: string): string` → returns the orderId from `navy://pay/<uuid>`; throws on a non-Navy/invalid URL.
- **`src/wallet/balances.ts`**:
  - `lamportsToSol(n: number): string`, `usdcBaseToDisplay(n: bigint|string): string` (÷ 1e6).
  - `fetchBalances(connection, owner: PublicKey, usdcMint: PublicKey): Promise<{ solLamports: number; usdcBase: string }>` — `getBalance` for SOL; derive the owner's USDC ATA and `getTokenAccountBalance`, catching "could not find account" → `'0'`.
- **`src/pay/navyPayClient.ts`** — `NavyPayClient(baseUrl, fetchImpl?)`:
  - `getOrder(id) → { orderId, status, amount, reference }`
  - `getPaymentTx(id, payer) → { tx: base64, invoice }`
  - `submitSignedTx(id, signedTxB64) → { txSignature, status }`
  - `getUserPayments(navyAccessToken) → Payment[]` (Bearer the Navy JWT).
- **`src/pay/payFlow.ts`** — `payInvoice({ orderId, payer, client, signTransaction })`: `client.getPaymentTx → Transaction.from(base64) → signTransaction(tx) → client.submitSignedTx(orderId, signed)`. `signTransaction` is an injected `(tx) => Promise<Transaction>` so the flow is testable with a fake signer (independent of Privy/RN).

---

## 4. Mobile — screens (thin, Privy-wired; typecheck + manual smoke)

- **Home / balances** (default after login): SOL + USDC (via `fetchBalances`), wallet address (copyable), a **"Scan to pay"** button, and a few recent payments (from `getUserPayments`).
- **Scan** (`expo-camera` barcode scanner): on a `navy://pay/:id` QR → `parsePayUrl` → navigate to confirm.
- **Confirm-pay:** `client.getOrder(id)` shows amount/reference/status; **Pay** runs `payFlow.payInvoice` with `signTransaction` from the Privy provider; on success shows the tx + returns home; balances refresh.
- **History:** full list from `getUserPayments`.

Navigation via the existing expo-router structure (the post-login route becomes the balances home).

---

## 5. Privy signing integration

`const wallet = useEmbeddedSolanaWallet(); const provider = await wallet.getProvider();` then `provider.signTransaction(tx)` to add the user's signature to the relayer-partial-signed tx, **without submitting**. The signed tx is re-serialized to base64 and POSTed to `/submit` (the relayer co-signs as fee payer and submits — gasless). Confirm the exact provider method/shape against the installed `@privy-io/expo` types; if `signTransaction` isn't exposed on the provider, use the documented sign-only path for the installed version (do NOT use `signAndSendTransaction`, which would break gasless).

---

## 6. Data flow (scan-to-pay)

```
Scan navy://pay/:id → parsePayUrl → orderId
  → client.getOrder(id)            [confirm screen: amount, reference, status]
  → client.getPaymentTx(id, myWalletPubkey)   [relayer-partial-signed, base64]
  → Transaction.from(base64) → provider.signTransaction(tx)  [+ user signature]
  → client.submitSignedTx(id, signedBase64)   [relayer co-signs + submits] → txSignature
  → success screen; balances + history refresh
```

---

## 7. Error handling & edge cases

- Non-Navy / malformed QR → "Not a Navy invoice".
- Order not found / expired / already paid → show status, disable Pay.
- No USDC ATA or insufficient USDC → the program rejects at submit → "Fund your wallet with devnet USDC first" (Circle faucet). Balances treat a missing USDC ATA as `0`.
- Privy signing cancelled by the user → return to confirm, no submit.
- RPC / network error → surfaced with a retry.
- Session expired (`401` from `/user/payments`) → re-auth via the existing Privy/session flow.

---

## 8. Testing strategy

- **Unit (mobile):** `parsePayUrl` (valid/invalid), balance formatters + `fetchBalances` (mocked connection incl. missing-ATA→0), `NavyPayClient` methods (mocked fetch), `payFlow.payInvoice` (fake signer + mocked client asserts getPaymentTx→sign→submit order).
- **Unit (be):** `listForPayer` scoping (`where.payer` + status), `GET /user/payments` returns the JWT wallet's payments only.
- **Screens:** typecheck; manual device smoke — create an invoice in the merchant panel, scan its QR in the app, pay (gasless), see it `paid` + appear in history; balances reflect the spend.

---

## 9. Deferred / future

- Sending transfers, receive-QR, swaps, fiat on-ramp.
- Push notifications on payment, multi-wallet, address book.
- On-chain history enrichment; pagination/infinite scroll.
- The farming subwallet UI (sub-project 7).
- Mainnet.
