# Navy AI Assistant — Design

**Date:** 2026-07-22
**Status:** Approved (brainstorm) → ready for planning
**Apps touched:** `be/` (new `agent` + transfer + username work), `expo-wallet/` (Assistant tab, chat UI, @username settings)

## 1. Overview

A conversational AI assistant embedded in the **expo-wallet** (the end-user payer app), reached via a new **"Assistant" tab** in the bottom tab bar. It uses **OpenRouter** for the LLM and **tool calling** to:

- Answer questions about the user's wallet (balances, farming, spending).
- Render **portfolio summaries, analytics, and charts** natively.
- **Propose** fund-moving actions — **farming deposit/withdraw** and **gasless USDC transfers** — which the user reviews, confirms, and signs.

**Core security invariant:** the LLM never moves funds. Action tools only produce structured proposals / EIP-712 typed data; every fund movement requires a **human signature** through the existing Privy embedded-wallet flow (`useMobileSigner`). The agent is read-scoped to the authenticated user.

### In scope
- Read/analytics tools + native chart rendering.
- Farming deposit/withdraw **proposals** (reusing the existing farming flow).
- **Gasless USDC transfer** (EIP-3009 `transferWithAuthorization` + relayer) to a **0x address** or an **opt-in @username**.
- **@username** setup UI in expo-wallet Settings + backend directory lookup.
- DB-persisted conversations; SSE token streaming.

### Explicitly out of scope
- Pay-invoice-via-chat (the agent does not touch invoices/orders as a payer).
- ETH transfers and arbitrary ERC-20 transfers (USDC only this version).
- Multimodal / image-based data extraction (text-driven only).
- Any agent auto-execution of transactions.

## 2. Architecture

New **`be/src/agent`** Nest module (a BFF), guarded by the Navy user JWT (`JwtGuard + RolesGuard + @Roles('user')`).

- Holds `OPENROUTER_API_KEY`; calls `https://openrouter.ai/api/v1/chat/completions` with `OPENROUTER_MODEL` (env-configurable, sensible default; model-agnostic design).
- Runs the **tool loop** server-side (OpenRouter/OpenAI tool-calling protocol):
  1. Call the model with `messages` + `tools`.
  2. If `finish_reason === "tool_calls"`, dispatch each requested tool, append the assistant message and one `role:"tool"` message per call (matching `tool_call_id`).
  3. Repeat until `finish_reason === "stop"`, bounded by an **iteration cap**.
- **Streams** the final assistant text to the app over **SSE** (proxying OpenRouter's SSE). Tool-running states are emitted as SSE events so the app can show "Reading portfolio…" chips.
- Tool implementations reuse existing services (farming, orders/DB) and a new transfer service — all scoped to `req.user`.

**Isolation for testability:** the tool **registry, dispatch, and argument validation** live in framework-free plain-TS modules under `be/src/agent/tools/*` (no Nest decorators, no chain-SDK imports at the pure layer), following the established Navy pattern (`deriveTxSummary`, `fe/src/lib`, `expo-wallet/src/lib`). The Nest controller and the OpenRouter HTTP client stay thin.

## 3. Tools

Tools are grouped by how their results are handled.

### Read tools (execute fully server-side, return data scoped to `req.user`)

| Tool | Returns |
|---|---|
| `get_portfolio` | USDC balance + ETH balance (gas) + farming position (principal, current value, unrealized yield) in one call |
| `get_payment_history` | The user's paid orders from the DB: amount, merchant, date, status |
| `get_farming_summary` | Compound (Comet) position + current APY + earnings-to-date |
| `get_spending_analytics` | Server-computed spend series by period/merchant, **display-tagged** for a chart |
| `resolve_recipient` | `@username` or `0x…` → validated `{address, label}` or a "not found" result |

### Action tools (agent *proposes*; app renders a confirm card; user signs)

| Tool | Returns |
|---|---|
| `build_farming_deposit` | Proposal payload the app renders as a confirm card (amount to supply) |
| `build_farming_withdraw` | Proposal payload (amount or "all") |
| `build_transfer` | EIP-712 `TransferWithAuthorization` typed data (USDC domain) + a persisted single-use nonce |

### Charts — deliberately server-computed

The model does **not** fabricate chart numbers. Read/analytics tools return **server-computed series** carrying a display hint (`display: { kind: 'chart' | 'card', chartType: 'line' | 'bar' | 'pie' }`); the app renders natively with `react-native-svg`. This keeps money/analytics values accurate and auditable. There is **no** separate `render_chart` tool — a model-authored chart tool would invite hallucinated data.

## 4. Transfer + @username (net-new backend)

### @username directory
- Add `username String? @unique` to the `User` model (Prisma). Stored lowercased; validated `^[a-z0-9_]{3,20}$`.
- Endpoints: check-availability, set, and clear the username. A user is **only discoverable if they opt in** by setting one.
- `resolve_recipient` / transfer lookup resolves `@username → User.primaryWallet` for active users only, returning **only** the wallet address + display handle (no other PII), enumeration-guarded by requiring an exact handle.

### Gasless USDC transfer
Mirrors the existing payment security model, but stands alone (does **not** route through `NavyPayments`; `transferWithAuthorization` is a function on the Circle USDC token itself):

1. `GET /transfer/authorization` `{recipient, amount}` — resolves the recipient (address or @username), asserts sufficient balance + no self-transfer + active recipient, builds the EIP-712 `TransferWithAuthorization` typed data over the **USDC domain** (read `name`/`version` from chain per the existing gotcha), and **persists its digest as a durable single-use nonce**.
2. App signs via `useMobileSigner` (`eth_signTypedData_v4`).
3. `POST /transfer/submit` `{signature, …}` — recovers the signer, asserts `signer === req.user.walletAddress`, CAS-consumes the nonce, and the **relayer** submits `usdc.transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, sig)` (relayer pays gas from the existing float).
4. A watcher reconciles the on-chain receipt and records the transfer; a revert resets the nonce (re-submittable) — the same self-healing pattern as payments.

**Guards:** sufficient USDC balance, no self-transfer, recipient is an active Navy user or a valid checksummed address, **payer must be a plain EOA** (Circle USDC rejects EIP-3009 from a 7702 smart account — the existing gotcha).

## 5. Context & persistence

- **DB-stored conversations:** new `AgentConversation` + `AgentMessage` Prisma models storing `role`, `content`, serialized `tool_calls`, and `tool_call_id`. Chats survive app restarts; the backend owns the context window.
- **Wallet state via tools only** — no per-turn wallet snapshot injection. The system prompt describes Navy, the available tools, and the safety rules (never claim to have moved funds; always propose + require a signature).
- **Context-window management:** when history exceeds a token budget, the backend trims oldest turns while retaining the system prompt and a rolling summary.
- **Cost/abuse guards:** iteration cap per request + a per-user rate limit on the agent endpoint.

## 6. Response UX

- **Assistant tab** → full-screen chat rendered in the Navy theme.
- **Streaming** tokens via SSE; **tool-running chips** ("Reading portfolio…") shown while the loop executes.
- **Read results → inline cards** (portfolio summary, farming summary). **Analytics → inline charts** (`react-native-svg`).
- **Action proposals → inline confirm card (chosen pattern)** with slide-to-sign, reusing the existing `SlideToConfirm` component; signing routes through `useMobileSigner`. The card always shows recipient/amount/"gasless — $0.00 fee" and a short "the assistant never moves funds — you sign" reassurance.
- **@username** claim/edit + availability check lives in **Settings**.

## 7. Error handling

- Tool errors return a structured `{ error }` result to the model, which apologizes / asks the user to retry — the loop never crashes.
- Transfer/farming submits that revert on-chain reset cleanly (self-healing, same as payments) and the confirm card surfaces a clear failure + retry.
- Insufficient balance, unknown @username, and self-transfer are caught **before** a proposal is made.
- LLM/network/OpenRouter errors surface in the chat as a retriable error state.

## 8. Testing

- **Plain-TS unit tests** for: tool registry/dispatch, tool-argument validation, chart-data shaping, username validation, transfer-authorization building, and context-trimming.
- **Screens/controllers** verified via `tsc --noEmit` + `build` (UI/Privy/chain not unit-testable, per repo convention).
- A **standalone live-Sepolia script** (in the spirit of `be/scripts/evm-e2e.mjs`) proves the gasless USDC transfer relay end-to-end against a deployed contract + funded relayer.

## 9. Non-goals & mainnet gates

Inherits Navy's deferred mainnet gates (KMS/HSM for keys, ERC-4337 paymaster, distributed rate-limits, professional audit — see `docs/PRODUCTION.md`).

**Prompt-injection posture:** the blast radius is bounded because (a) every read tool is scoped to the authenticated user, and (b) **all fund movement requires a human signature** on typed data the user can read. A malicious instruction in conversation cannot exfiltrate funds or read another user's data.

## 10. Open items for the plan

- Exact system-prompt wording + the JSON Schema for each tool's arguments.
- The token budget / trimming thresholds and rolling-summary strategy.
- SSE event schema between `be/` and the app (token deltas vs tool-status events) and the `expo/fetch` streaming consumer on Expo SDK 54.
- Rate-limit numbers and iteration cap.
- Default `OPENROUTER_MODEL` value.
