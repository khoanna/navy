# Navy — Payments On-Chain Program (`navy_payments`) Design Spec

**Date:** 2026-06-13
**Status:** Approved (design)
**Sub-project:** 2 of N in the Navy ecosystem (smart contracts)

---

## 0. Context

Navy is a Solana payment ecosystem (see `2026-06-13-navy-identity-wallet-foundation-design.md`). Sub-project 1 (Identity & Wallet Foundation) is built across backend (Nest), mobile (Expo), and web (Next). This sub-project delivers the **on-chain payment program** that the payment gateway (sub-project 3) will orchestrate.

The mechanism is an **EIP-712-style invoice payment translated to Solana**: a user scans a QR, their mobile wallet shows a **typed invoice** (merchant, USDC amount, invoice id, expiry), and pays in **USDC**, **gasless** (Navy relays the SOL fee). Each invoice is **payable exactly once** (on-chain replay protection), and Navy takes a **configurable fee (default 1%) to an admin treasury**, enforced on-chain.

### Decisions locked during brainstorming
- **Custom Anchor program is warranted** — on-chain replay protection, enforced fee, and registered-merchant payout cannot be done with plain transfers.
- **Invoice model = Approach C (trusted-gateway lazy):** no per-invoice on-chain account creation; the Invoice PDA is created lazily inside `pay_invoice` and its existence is the replay nonce. The program pays the **admin-registered merchant payout** and enforces the fee; Navy (trusted relayer) constructs the gasless transaction. (Approach B — in-program verification of a merchant-signed invoice — is the more trustless future option, recorded in §10.)
- **Fee** lives in an on-chain `Config` PDA, **seeded from backend env `NAVY_FEE_BPS`** (default `100` = 1%); the chain is the source of truth so the fee cannot be bypassed client-side.
- **Merchants register with admin** → an on-chain `Merchant` registry holds the payout address; only the admin authority may register/toggle merchants.
- **Devnet only.** A money-moving program requires a professional audit before mainnet (hard gate, §7).

---

## 1. Scope & boundaries

**In scope:**
- One Anchor program `navy_payments` (Rust) on devnet.
- Instructions: `initialize_config`, `update_config`, `register_merchant`, `set_merchant_active`, `pay_invoice`.
- Generated **IDL + TypeScript client**.
- Minimal off-chain glue: `buildPayInvoiceTx(...)` (unsigned tx, relayer as fee payer) and a backend **relayer helper** (co-sign + submit + await `InvoicePaid`).
- An **admin CLI script** to run `initialize_config`/`update_config`/`register_merchant` from env (`NAVY_FEE_BPS`, `NAVY_TREASURY`, admin keypair).
- Anchor integration tests (localnet).

**Out of scope (later sub-projects):**
- Payment-gateway orchestration: order lifecycle, QR rendering, webhooks, merchant-dashboard wiring → **Payment Gateway** (sub-project 3).
- Admin UI that triggers `register_merchant` on approval → **Admin Panel** sub-project (this sub-project provides the instruction + CLI).
- Mobile typed-invoice display UX → **Mobile Wallet** sub-project (this sub-project defines the invoice schema the wallet renders).
- Mainnet deployment + audit.

---

## 2. Architecture & components

```
Mobile wallet (user)                 Nest backend (Navy relayer)
   │  scans QR (typed invoice)          │  builds pay_invoice tx (relayer = fee payer)
   │  partial-signs (authorize USDC)    │  co-signs as fee payer, submits, indexes events
   ▼                                    ▼
            ┌───────────────────────────────────────┐
            │     navy_payments (Anchor, devnet)     │
            │  Config PDA · Merchant PDA · Invoice PDA│
            │  pay_invoice: split USDC, mark paid     │
            └───────────────────────────────────────┘
                         │ CPI: SPL Token transfers (USDC)
                         ▼
        merchant.payout ATA (amount−fee)  ·  config.treasury ATA (fee)
```

Repo: a new Anchor workspace at **`/home/khoa/Desktop/uni/onchain/`** (Rust program under `programs/navy-payments`, TS tests under `tests/`, generated client published for the backend to import).

---

## 3. On-chain accounts (PDAs)

```
Config   seeds ["config"]
  admin:      Pubkey      // authority that may mutate config + merchants
  treasury:   Pubkey      // USDC token account receiving fees
  usdc_mint:  Pubkey      // the accepted mint (devnet USDC)
  fee_bps:    u16         // 100 = 1%; bounded 0..=1000 (<=10%)
  bump:       u8

Merchant seeds ["merchant", merchant_authority]
  merchant_authority: Pubkey  // identifies the merchant
  payout:             Pubkey  // USDC token account receiving payments
  active:             bool
  bump:               u8

Invoice  seeds ["invoice", merchant_authority, invoice_id]   // invoice_id: [u8; 16]
  payer:   Pubkey
  amount:  u64
  fee:     u64
  paid_at: i64
  bump:    u8
  // Created lazily inside pay_invoice; existence == "already paid" (replay nonce).
```

---

## 4. Instructions

- **`initialize_config(fee_bps: u16, usdc_mint: Pubkey)`** — signer = admin. Creates `Config` (admin = signer, treasury passed as account, usdc_mint, fee_bps). Rejects `fee_bps > 1000`. One-time (init).
- **`update_config(fee_bps: Option<u16>, treasury: Option<Pubkey>)`** — signer must equal `config.admin`. Updates fee/treasury; same bound check.
- **`register_merchant(payout: Pubkey)`** — signer must equal `config.admin`. Creates `Merchant` PDA for a given `merchant_authority`, `active = true`.
- **`set_merchant_active(active: bool)`** — signer = `config.admin`. Toggles a merchant.
- **`pay_invoice(invoice_id: [u8;16], amount: u64, expiry: i64)`** — signers = payer (authorizes the SPL transfer from their USDC ATA) **and** the relayer fee payer. Steps:
  1. Assert `merchant.active`.
  2. Assert `Clock::now <= expiry`.
  3. `init` the `Invoice` PDA (Anchor `init` fails if it already exists → replay protection).
  4. Assert `amount > 0`; `fee = amount.checked_mul(config.fee_bps).unwrap() / 10_000` (checked math).
  5. Assert the payer's token account and merchant payout and treasury are all for `config.usdc_mint`; assert merchant payout ATA == `merchant.payout` and treasury ATA == `config.treasury`.
  6. CPI SPL `transfer`: `amount − fee` → `merchant.payout`; `fee` → `config.treasury` (both from payer's ATA; payer is the authority).
  7. Populate `Invoice { payer, amount, fee, paid_at }`.
  8. `emit!(InvoicePaid { merchant_authority, invoice_id, payer, amount, fee, paid_at })`.

---

## 5. Fee config & gasless relay

- **Env → chain:** the admin CLI reads `NAVY_FEE_BPS` (default 100), `NAVY_TREASURY` (USDC token account), `NAVY_USDC_MINT` (devnet USDC mint), and the admin keypair, and calls `initialize_config`/`update_config`. The program enforces `fee_bps` from the on-chain `Config`.
- **Gasless:** `pay_invoice` is a two-signer transaction. The backend builds it with the **relayer keypair as fee payer**, the mobile wallet **partial-signs** as the payer (authorizing the USDC debit), and the backend co-signs + submits. The user needs **no SOL** (still needs USDC). If the user's USDC ATA or the merchant/treasury ATAs are missing, the backend includes create-ATA instructions (relayer-funded).

---

## 6. Off-chain deliverables

- **IDL + generated TS client** (Anchor) — importable by the Nest backend.
- **`buildPayInvoiceTx({ programId, config, merchantAuthority, payout, treasury, usdcMint, invoiceId, amount, expiry, payer, relayer })`** → an unsigned `Transaction` with the relayer as fee payer and required instructions (incl. ATA creation if needed).
- **Relayer helper** (`submitPayInvoice`) — co-signs with the relayer keypair, sends, confirms, and resolves the `InvoicePaid` event.
- **Admin CLI** (`scripts/admin.ts`) — `init-config`, `update-config`, `register-merchant`, `set-active` from env + admin keypair.

---

## 7. Edge cases & security

- Checked integer math for `fee` (no overflow/underflow); define rounding (integer division floors the fee — favors the payer by ≤ rounding, acceptable).
- Verify all token accounts use `config.usdc_mint`; verify merchant payout ATA == `merchant.payout`, treasury ATA == `config.treasury`.
- Invoice **init-once** (replay protection); reject expired invoices; reject inactive/unregistered merchants; reject `amount == 0`; bound `fee_bps ≤ 1000`.
- Only `config.admin` may run `update_config`, `register_merchant`, `set_merchant_active`.
- **Devnet only.** Mainnet deployment is gated on a **professional security audit** of the program (documented; not in this sub-project).

---

## 8. Testing strategy

Anchor TS integration tests on localnet:
- `initialize_config` sets fee/treasury; rejects `fee_bps > 1000`; non-admin rejected on `update_config`.
- `register_merchant` admin-gated; `set_merchant_active` toggles.
- `pay_invoice` happy path: merchant payout receives `amount − fee`, treasury receives `fee` (exact math for 1% of representative amounts), Invoice PDA created, event emitted.
- **Replay:** paying the same `invoice_id` twice fails on the second.
- Rejections: inactive merchant, unregistered merchant, expired invoice, wrong mint, wrong payout/treasury ATA, `amount == 0`.
- Fee math/rounding for amounts that don't divide evenly; overflow-safety with large `amount`.

---

## 9. Toolchain

Anchor (latest), Rust, Solana CLI, Node/pnpm for tests + client. The implementation plan verifies the installed toolchain and pins versions; if Anchor/Solana/Rust are absent, installing them is the plan's first task.

---

## 10. Deferred / future options

- **Approach B (trustless merchant authorization):** verify a merchant ed25519 signature over the typed invoice inside `pay_invoice` (via the ed25519 program), removing the relayer-trust assumption. Recorded as a future hardening.
- **Refunds / escrow / partial payments** — not needed for instant invoice payment; future.
- **Multi-token support** beyond USDC — future (config currently single `usdc_mint`).
- **Mainnet audit + deployment.**
