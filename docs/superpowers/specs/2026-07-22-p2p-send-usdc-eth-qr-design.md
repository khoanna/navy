# Peer-to-Peer Send (USDC + ETH) + Scan-to-Send — Design

**Date:** 2026-07-22
**Status:** Approved (brainstorm) → ready for planning
**Builds on:** the gasless USDC transfer rails + AI assistant (branch `feat/ai-assistant`: `Transfer` model, `TransferService`, `useMobileSigner`, agent `build_transfer`).
**Apps touched:** `be/` (Transfer.asset, resolve + eth-record endpoints, agent asset param), `expo-wallet/` (Send screen, scanner branch, ETH broadcast, error-mapper, confirm-card ETH path).

## 1. Overview

A first-class **Send** flow: send **USDC (gasless)** or **ETH (native)** to a friend, with the recipient supplied by **@username**, a **pasted 0x address**, or a **scanned address QR**. The Scan tab recognizes address QRs (raw `0x…` or EIP-681) and opens Send prefilled; pay-invoice QRs still open the invoice unchanged. All failures map to clear, human-readable messages shown on the confirm card **and** fed back to the AI assistant when it proposed the send. The assistant's send tool gains an `asset` param so it can propose ETH sends too.

### In scope
- A Send screen (asset toggle USDC|ETH, amount, MAX, live balances, gasless-vs-gas fee treatment).
- Scanner branch: address QR → Send; invoice QR → pay (unchanged).
- `useMobileSigner.sendTransaction` for ETH broadcast via the Privy embedded wallet.
- Backend: `Transfer.asset` column, `GET /transfer/resolve`, `POST /transfer/eth/record`.
- Assistant `asset` param on `build_transfer` + an error-feedback loop into chat.
- A shared, unit-tested error-mapper (`sendErrors`).

### Out of scope
- Arbitrary ERC-20 tokens (no token discovery/allowlist).
- Embedding a requested amount in the **receive** QR (address-only QR).
- Gasless ETH sponsorship (needs an ERC-4337 paymaster — a mainnet gate).
- On-ramp / funding changes.

## 2. Two send paths (core architecture)

**USDC — gasless, existing rails (unchanged).** `GET /transfer/authorization {recipient, amountBase}` → user signs the EIP-712 `TransferWithAuthorization` via `useMobileSigner.signTypedData` → `POST /transfer/submit {transferId, signature}` → relayer submits `usdc.transferWithAuthorization`, watcher reconciles. The Send UI simply drives this flow.

**ETH — native, client-broadcast.** Native ETH cannot be gasless (no EIP-3009 for native value). `useMobileSigner` gains `sendTransaction({ to, valueWei })` → Privy embedded wallet `eth_sendTransaction` (the plain-EOA wallet pays its own gas from its ETH) → returns a `txHash`. The app then calls **`POST /transfer/eth/record { to, amountWei, txHash }`**, which inserts a `Transfer` row (`asset:'ETH'`, `status:'confirming'`, `txHash`). The **existing** `TransferWatcherService.sweepConfirming` already reconciles `confirming` rows via `getTransactionReceipt` → `confirmed`/`failed`, so ETH settles into unified history with **no new watcher**.

Rationale: the two assets have fundamentally different trust/gas models, so they use different rails but converge on one `Transfer` table + one watcher + one history.

## 3. Data model & backend

- **`Transfer.asset`** — new column `String @default("USDC")` holding `'USDC' | 'ETH'`. USDC rows keep `nonce`/`digest`/`validBefore` (EIP-3009); ETH rows leave those null and are recorded post-broadcast with `txHash`. History returns `asset` so USDC + ETH interleave. `amount` remains base units: USDC = 6-decimal, ETH = wei (interpret by `asset`).
- **`GET /transfer/resolve?recipient=`** → `{ address, username: string | null }` — reuses `parseRecipient` + `UserService.resolveUsername`. The Send UI needs the resolved address up-front (required for ETH, where the client broadcasts; convenient for display on USDC). Returns a 400 for an unknown @username / invalid input. Guarded `@Roles('user')`, throttled.
- **`POST /transfer/eth/record { to, amountWei, txHash }`** — validates `to` (0x address), `amountWei` (positive integer string), `txHash` (0x-32-byte); inserts an ETH `Transfer` row scoped to `req.user` (`fromUserId`, `fromAddress = req.user.walletAddress`, `asset:'ETH'`, `status:'confirming'`). No signature to verify — the wallet already broadcast, and the tx is self-authorizing on-chain. Idempotent on `txHash` (unique) so a double-report is a no-op. Guarded `@Roles('user')`, throttled.
- The USDC `buildAuthorization`/`submit` are unchanged except `buildAuthorization` sets `asset:'USDC'` explicitly.

## 4. Client: Send screen, scanner, error-mapper

- **`app/send.tsx`** — a stack route (not a bottom tab) reachable from (a) a new **Send** quick-action on Home, (b) the Scan result, (c) the assistant confirm card's "open in Send" affordance. Reads `?to=` (address or @username) and optional `?asset=`/`?amount=`. Renders: recipient row (resolved @username · short address, with a source pill), asset toggle (USDC|ETH), a large amount input, live balance + **MAX** (ETH MAX subtracts a small gas reserve so the tx can pay gas), the fee bar (USDC: "gasless · $0.00 (relayed)"; ETH: "network fee ~gas · paid from your ETH"), and a `SlideToConfirm`. On confirm: USDC → `runTransferFlow` (build→sign→submit); ETH → `sendTransaction` + `POST /transfer/eth/record`.
- **`src/lib/pay/parseSendTarget.ts`** (pure, unit-tested) — decodes a scanned/pasted string into a send target: a raw `0x…` (validated via `ethers.isAddress`, checksummed) or an EIP-681 `ethereum:0x…@11155111?value=<wei>` URI → `{ address, amountWei?: string }`; returns null for anything else. The scanner tries `parsePayUrl` first (invoice), then `parseSendTarget` (send), else shows "unrecognized code".
- **`src/lib/pay/useCameraScanner.ts`** — extended to add an `onSend(target)` callback branch alongside the existing `onOrder`/`onInvalid`; the Scan screen navigates to `/send?to=<address>` (and `?amount=` if present) on a send target.
- **`src/lib/wallet/sendErrors.ts`** (pure, unit-tested) — `mapSendError(raw): { title, detail }` turning raw errors into friendly text: insufficient USDC, **not enough ETH for gas / out-of-gas**, user-rejected signature, expired authorization, on-chain revert, relayer unavailable/underfunded, RPC/network, invalid recipient, unknown. Consumed by the Send screen **and** the chat confirm cards.

## 5. Assistant: ETH + error-feedback loop

- **`build_transfer` gains `asset` (`'USDC' | 'ETH'`, default `'USDC'`).** For `asset:'ETH'` the tool handler resolves the recipient, checks the ETH balance covers amount + a gas estimate, and returns a proposal `{ display:{kind:'action', action:'transfer'}, asset:'ETH', to, amountWei, recipient }` (no typed data). For `asset:'USDC'` it behaves exactly as today. The tool description states amounts: USDC in base units (1 USDC = 1e6), ETH in wei (1 ETH = 1e18).
- **`TransferConfirmCard`** branches on `result.asset`: USDC → sign `typedData` + `submit` (unchanged); ETH → `useMobileSigner.sendTransaction({ to: result.to, valueWei: result.amountWei })` then `POST /transfer/eth/record`.
- **Error-feedback loop:** when an agent-proposed send's confirm fails, the chat screen sends a follow-up turn to `/agent/chat` conveying the mapped error (e.g. "The ETH send failed: not enough ETH to cover gas."), so the assistant explains it and suggests a fix. Same `mapSendError` as the UI. This satisfies "the agent should hand error messages back to the user."

## 6. Error handling, testing, non-goals

- **Errors** everywhere pass through `sendErrors.mapSendError`. The confirm card / Send screen show a Failed state with the friendly title+detail and a retry; agent-proposed failures additionally surface in chat via the feedback loop.
- **Testing:**
  - Pure unit tests: `parseSendTarget` (raw + EIP-681 + rejects), `sendErrors.mapSendError` (each mapped case), the ETH-record DTO validation, `resolve` behavior, and `Transfer.asset` history mapping.
  - Screens / Privy / chain: `tsc --noEmit` + build gates (not unit-testable per repo convention).
  - A standalone **live-Sepolia script** (`be/scripts/eth-send-e2e.mjs`) proves an ETH send + `POST /transfer/eth/record` + watcher reconciliation end-to-end.
  - **Full end-to-end** on a running backend + free-model assistant: "Send 0.001 ETH to @<handle>" → proposal → broadcast → record → history; plus the USDC path and a scan-to-send.
- **Non-goals / mainnet gates:** ERC-20s, gasless ETH (4337 paymaster), on-ramp — unchanged deferrals from `docs/PRODUCTION.md`.

## 7. Open items for the plan

- Exact gas reserve for ETH MAX (a small fixed reserve, e.g. enough for a 21000-gas transfer at a padded gas price) and where it's computed (client via provider `estimateGas`/`getFeeData`).
- The precise follow-up-turn wording the app sends to the assistant on a failed agent-proposed send.
- Whether the Home Send quick-action replaces or joins the existing Receive · Pay · Earn row (a 4th tile).
- `eth_sendTransaction` param shape verified against the installed `@privy-io/expo` provider types (value as hex wei, `from` set).
