# Navy Production Hardening — Design

**Date:** 2026-07-04
**Status:** Approved scope (pending spec review)
**Branch base:** `master`
**Related:** [[navy-audit-2026-07-04]], `2026-06-13-navy-payment-gateway-design.md`, `2026-06-16-navy-farming-agent-design.md`, `2026-06-13-navy-payments-program-design.md`

## Goal

Take the audited Navy system (devnet-deployed, functionally complete) to a **code-level production-ready** state: close the custody and payment-integrity blockers, harden auth/API and the frontends, harden the on-chain program and **re-deploy to devnet (upgrade in place)**, and verify end-to-end.

## Explicit scope decisions (locked with owner)

1. **Scope = full code hardening + devnet redeploy + test.** KMS, mainnet, and external audit are documented gates, not live-provisioned here.
2. **Key custody: leave as-is, document only.** The single `SUBWALLET_MASTER_KEY` protecting both merchant API secrets and subwallet/relayer keys is an **accepted, documented pre-mainnet risk**. No KMS adapter or key-domain separation in this pass. The PolicyValidator rewrite (code, not key custody) still lands.
3. **On-chain: upgrade in place** — keep program id `5Y8xeLpLx2BWHHAZkYMfFQjsRPF2H7sUwmrVP9zjc7az`.
4. **Merchant PDA: adopt stable identity + `set_merchant_payout`** (breaking on devnet; re-register in smoke).
5. **Pay endpoints require the Navy user JWT** (`payment-tx`, `submit`); payer derived from the token.

## Out of scope (documented in `docs/PRODUCTION.md`)

Cloud KMS/HSM provisioning; key-domain separation; mainnet deploy + governance/multisig upgrade authority; third-party program audit; managed-DB/HA infra; real Kamino mainnet yield adapter; KYC/AML/legal.

## Non-negotiable constraints (from CLAUDE.md)

- Devnet only; USDC = `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`; farming uses native SOL.
- Money is `BigInt` in Prisma → serialize to string before returning from Nest.
- `@solana/web3.js` pinned to `1.98.4` via `be` `pnpm.overrides` — do not remove.
- Anchor IDL is a runtime asset (`be/nest-cli.json` assets copy `src/onchain/*.json`); re-copy after `anchor build`.
- web-wallet verified by `next build` (runtime gate), not just `tsc`. tsconfig targets < ES2020 → no `n` BigInt literals.
- Prisma 7 CLI needs `DATABASE_URL` in the shell env for migrate/generate.
- Keep non-UI logic in plain-TS modules for unit-testability.

---

## Workstreams

Each workstream is independently buildable and testable. Verification gate after each: `pnpm build` + `pnpm test` (+ `tsc`/`next build` for frontends). On-chain (E) runs last.

### A · Custody security — PolicyValidator deny-by-default *(P0)*

**Problem:** `deriveTxSummary` only decodes System/SPL `Transfer`; the policy checks program-id + transfer-destination and passes everything else. Allowlisted programs (Save, Token, ATA) can be driven to `Approve`/`CloseAccount`/`SetAuthority` to drain a subwallet. Fail-open.

**Design:** Replace "extract transfer destinations" with **per-instruction shape validation, deny-by-default**.

- New module `be/src/wallet/policy/` with:
  - `instruction-decoders.ts` — pure decoders for each instruction we must allow: SPL-Token (`Transfer`, `TransferChecked`, `SyncNative`, `CloseAccount`→only if destination is the subwallet owner), System (`Transfer`, `CreateAccount` for wSOL ATA), Associated-Token-Account (`Create`/`CreateIdempotent`), and Save/Solend program instructions used by the yield adapter (deposit/withdraw/refresh — identified by discriminator).
  - `policy.validator.ts` — for each top-level instruction: resolve program id → look up an allowed **shape spec** → validate account roles + decode destinations/authorities → assert every fund-moving destination/authority is in the subwallet's allowlist (owner main wallet, subwallet ATAs, Save program-derived accounts). **Any instruction that doesn't match an allowed shape → reject.** Explicitly reject `Approve`/`ApproveChecked`/`SetAuthority`/`Burn`/`MintTo` and unknown SPL-Token opcodes with a clear reason.
  - Reject if the tx has instructions to programs not in the allowlist.
- `SigningService` calls the new validator; behavior on reject unchanged (throw, wipe key).
- **Note on CPI:** top-level Save instructions may CPI-transfer. We constrain by (a) allowlisting only the specific Save instruction discriminators the adapter emits and (b) validating their declared accounts against the allowlist; document that full inner-instruction simulation is a future enhancement.

**Tests:** unit vectors for each allowed shape (pass) and each attack (Approve-delegate, CloseAccount-to-attacker, SetAuthority, transfer-to-non-allowlisted, unknown program, unknown opcode) → all rejected.

### B · Payment integrity *(P0)*

**B1 · Real ChainWatcherService.** Source of truth for settlement.
- On `submit`, after the tx is sent, enqueue the signature for confirmation (fast path already sets `confirming`).
- A watcher (`@Interval` poll + `getSignatureStatuses`, and on boot a reconcile sweep of `confirming` orders) confirms success, fetches the tx, parses the `InvoicePaid` event (via the Anchor `EventParser` over program logs), and reconciles on-chain `amount`/`fee`/`payer`. Only then → `markPaid` (idempotent; `paid` orders are skipped) which fires the webhook. On revert → `failed`.
- Handles out-of-band payers (a valid on-chain payment whose `submit` never returned) via the reconcile sweep keyed by invoice PDA.

**B2 · Durable relayer issued-tx store.**
- Persist the issued message hash (`issuedTxHash`) + `issuedTxExpiresAt` on the `Order` row when `payment-tx` builds a tx.
- `verifyAndSubmit` compares against the persisted hash; on success mark consumed (`issuedTxConsumedAt`); reject re-submit of a consumed/expired order. Remove the in-memory `Map`.

**B3 · Relayer guardrails.**
- Before co-signing: check relayer balance ≥ threshold; enforce a simple per-window issue cap (in-DB counter or timestamp window). Log/emit on low balance. Configurable via env (`NAVY_RELAYER_MIN_BALANCE_SOL`, `NAVY_RELAYER_MAX_ISSUE_PER_MIN`).

### C · Auth & API hardening *(P1)*

- **C1** `app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))`; add `class-validator`/`class-transformer`; decorate every DTO (`@IsString`, `@Matches` for amounts, `@IsInt`/`@Min` for ttl/pagination, etc.).
- **C2** `@nestjs/throttler` global guard with tighter per-route limits on auth + payment endpoints; `helmet` in `main.ts`.
- **C3** Auth lifecycle: the access JWT carries a `sid` (AuthSession id) claim. `POST /auth/refresh` validates the stored `refreshTokenHash`+expiry and **rotates** (new refresh secret, same session). `POST /auth/logout` sets `AuthSession.revokedAt`. `JwtGuard` looks up `sid` and rejects if the session is missing or revoked (one indexed query per request). Validate `accessTtl`/`refreshTtl` are finite positive ints in `NavyConfigService`.
- **C4** TOTP: store `lastTotpStep` per admin, reject replay of the same/earlier step; time-boxed lockout (`lockedUntil`) instead of permanent; count failed password attempts in the same window.
- **C5** Payout challenge: `POST /merchant/payout/challenge` issues `{challenge, nonce, expiresAt}` stored in a `PayoutChallenge` row bound to merchantId; `setPayoutAddress` requires the signed message to equal a live, unconsumed challenge and consumes it.
- **C6** `payment-tx` + `submit` guarded by `JwtGuard`+`@Roles('user')`; `payer` derived from `req.user.walletAddress` (query `payer` ignored). Keep the status/expiry guards added in the audit pass.
- **C7** Response hygiene: a mapper strips `passwordHash`/`totpSecret`/secret columns and `.toString()`s BigInt on every merchant/order/farming response; no raw Prisma rows leave a controller.

### D · Frontend hardening *(P1)*

- **fe**: Origin check helper in mutating route handlers (reject non-app `Origin`); `req.json()` parse guards → 400; mark JWT-decode display-only (comment + keep backend authoritative). Add a `/api/auth/refresh` proxy + refresh-on-expiry so the 30-day refresh cookie is usable.
- **web-wallet**: `NavyPayClient.getPaymentTx`/`submitSignedTx` send `Authorization: Bearer <navyToken>` (from the session); pin the embedded Privy wallet (filter by `walletClientType==='privy'`) and assert the signing address equals the invoice `payer`; `encodeURIComponent` interpolated params; re-validate `orderId` UUID on the pay page; surface server error bodies in toasts.

### E · On-chain hardening + devnet redeploy *(P2, runs last)*

- **E1** `pay_invoice`: type `treasury` and `merchant_payout` as `Account<TokenAccount>` with `token::mint = usdc_mint` (mint-mismatch now fails fast, not silently misroutes). `initialize_config`/`update_config`: constrain `treasury` mint.
- **E2** Minimum invoice amount: on-chain `require!(amount >= MIN_INVOICE_AMOUNT)`; backend enforces the same in `OrdersService.create`.
- **E3** Stable merchant PDA: seed the merchant PDA on a stable 32-byte `merchant_id` (derived from the DB uuid) instead of the payout wallet; store `payout` as a mutable field; add `set_merchant_payout(new_payout)` gated by config admin. Backend passes `merchant_id` consistently in register + pay.
- **E4** Redeploy: `anchor build` → `anchor upgrade` (same id) using the authority keypair (`~/.config/solana/id.json`, 28.7 SOL) → re-copy IDL `onchain/target/idl/*.json` → `be/src/onchain/` → update `be/src/onchain/payments-client.ts` + registrar for the new seeds/accounts → `pnpm build` → **devnet smoke** (re-register a merchant with the new PDA, build+inspect a pay tx) → re-run gated E2E where feasible.

**Migration note:** Config PDA persists; the treasury mint constraint is validated at `pay_invoice` against the existing treasury ATA (already a USDC ATA) so no Config re-init is required. Existing merchant PDAs are orphaned by E3 — acceptable on devnet.

### F · Observability & ops *(code-level P2)*

- Structured request logging (Nest interceptor); **audit both success and failure** for all three auth doors (currently only signup/admin-login-success audited).
- Webhook robustness: add signed `X-Navy-Timestamp` into the HMAC payload, an idempotency id, retry with backoff, and a `WebhookDelivery` row for status/dead-letter.
- `GET /health` (DB + RPC reachability); metric hooks for relayer balance and webhook-failure counts.

---

## Data model changes (Prisma migrations)

- `Order`: `issuedTxHash String?`, `issuedTxExpiresAt DateTime?`, `issuedTxConsumedAt DateTime?`; widen `status` usage to include `confirming`/`failed` (already String).
- `AuthSession`: `revokedAt DateTime?` (JWT carries the session id as `sid`).
- `Admin`/merchant auth: `lastTotpStep Int?`, `lockedUntil DateTime?`, `failedPasswordCount Int @default(0)`.
- New `PayoutChallenge { id, merchantId, nonce, challenge, expiresAt, consumedAt }`.
- New `WebhookDelivery { id, orderId, url, status, attempts, lastError, nextAttemptAt, createdAt }`.
- `Merchant`: `onchainMerchantId Bytes?`/`String?` (stable PDA seed) if not already derivable from `id`.

All new BigInt/secret columns respect the serialize-before-return rule.

## Testing strategy

- **Unit** (jest): PolicyValidator attack/allow vectors; relayer durable-store + re-submit rejection; chain-watcher event reconcile (mock connection/EventParser); DTO validation; TOTP replay/lockout; payout-challenge consume; response mappers; on-chain client seed derivation.
- **E2E** (`test/*.e2e-spec.ts`): auth flow incl. refresh/logout/throttle; merchant onboarding with challenge; payment build now requires auth. Keep localnet/devnet-gated specs gated.
- **Anchor** (`onchain/tests`): mint-constraint rejection, min-amount rejection, `set_merchant_payout`, pay with new PDA.
- **Live devnet smoke** (post-E4): re-register merchant, build + inspect co-signed pay tx against upgraded program; relayer guardrails; `/health`.
- Gates: `be` build+test, `fe`/`web-wallet` `tsc`+`next build`, `onchain` `anchor build`+`anchor test`.

## Rollout / sequencing

A → B → C → D → (verify all backend+frontend green) → E (build, upgrade, re-wire, redeploy, smoke) → F → docs. Commit per workstream on a `feat/production-hardening` branch. Redeploy only after A–D are green so a redeploy failure can't mask code regressions.

## Risks

- **On-chain upgrade** could fail buffer/size checks — mitigate with `solana program write-buffer` + `anchor upgrade`, keep the current build as rollback.
- **C6 + D contract change** — pay flow breaks if the wallet doesn't send the token; covered by updating the client in the same workstream boundary and E2E.
- **PolicyValidator over-restriction** — could reject legitimate Save txs; mitigate by deriving allowed shapes from the actual adapter output and testing against a real buildDeposit/buildWithdraw tx.
- **Scope size** — phased gates keep each change bisectable; workstreams can be delivered/committed independently.
