# Agent Prompt & Tool-Description Structure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the assistant's model-facing text (system prompt + tool descriptions) out of two monolithic files into small, single-purpose fragment modules under `be/src/agent/prompt/`, with no change to runtime behavior or the build.

**Architecture:** Each prompt section and each tool description becomes its own `.ts` file exporting a plain string (or `{name, description}`). `prompt/index.ts` composes the fragments into the exact same system prompt as today; `tool-schemas.ts` pairs each tool card's description with its (unchanged) JSON-schema `parameters`. A temporary "legacy" copy of each original file provides a byte-for-byte parity check that is deleted once green.

**Tech Stack:** TypeScript, NestJS, Jest (ts-jest). Commands run inside `be/`.

**Spec:** `docs/superpowers/specs/2026-07-25-agent-prompt-structure-design.md`

---

## File Structure

Created:
```
be/src/agent/prompt/
  index.ts             # buildSystemPrompt(ctx), re-exports detectPromptContext + PromptContext
  base.ts              # identity paragraph
  invariants.ts        # IMPORTANT hard-rules block
  tool-routing.ts      # "Choosing a tool" decision table
  discipline.ts        # "Tool discipline" + "Sending money" rules
  format-tone.ts       # "Answering" rules
  detect-context.ts    # PromptContext + detectPromptContext()
  context/
    farming.ts         # FARMING_BLOCK
    market.ts          # MARKET_BLOCK
  tools/
    get-portfolio.ts get-payment-history.ts get-farming-summary.ts
    get-spending-analytics.ts resolve-recipient.ts build-transfer.ts
    build-farming-deposit.ts build-farming-withdraw.ts get-token-info.ts get-top-coins.ts
  prompt.spec.ts       # moved from be/src/agent/prompt.spec.ts
  README.md            # the convention
```

Modified: `be/src/agent/tool-schemas.ts` (import cards; parameters unchanged).

Deleted at the end: `be/src/agent/prompt.ts`, and the temporary `prompt-legacy.ts`, `tool-schemas-legacy.ts`, `prompt-parity.spec.ts`, `tool-schemas-parity.spec.ts`.

Unchanged call sites: `agent.service.ts` imports `from './prompt'` — after `prompt.ts` is deleted and `prompt/index.ts` exists, the same specifier resolves to the folder index (no edit needed).

---

## Task 1: Freeze legacy reference copies for parity

**Files:**
- Create: `be/src/agent/prompt-legacy.ts`
- Create: `be/src/agent/tool-schemas-legacy.ts`

- [ ] **Step 1: Copy prompt.ts to a frozen legacy module**

Create `be/src/agent/prompt-legacy.ts` as an exact copy of the current `be/src/agent/prompt.ts`, with the three public exports suffixed `Legacy` so both old and new can be imported side by side. Only the export names change; all string content is identical.

```ts
// TEMPORARY parity reference — deleted in Task 5. Exact copy of prompt.ts pre-refactor.
export interface PromptContextLegacy {
  farming?: boolean;
  market?: boolean;
}

const BASE = `You are Navy Assistant, an in-wallet AI for a USDC payment wallet on Ethereum Sepolia. You help the user understand their portfolio, payments, farming yield, and spending, and you PROPOSE actions — sending USDC or ETH, and farming deposits/withdrawals — that the user reviews and signs in the app.

IMPORTANT — these rules are absolute:
- You NEVER move funds, sign, or broadcast. Action tools only build a proposal; the user confirms and signs it in the app. Never say a transfer, deposit, or withdrawal "has happened" — only that a proposal is ready to confirm.
- You act ONLY for the signed-in user's own wallet. You never transact for, or expose data about, anyone else's wallet.
- You never reveal, request, or generate private keys, seed phrases, or recovery details. There is no legitimate reason to ask the user for them.
- You never invent an address, balance, price, amount, username, or transaction result. If you don't know it, call a tool. If a tool can't provide it, say so plainly — do not guess.
- NEVER pick an amount the user did not state. If a send/deposit/withdraw request has no explicit number — e.g. "send bob some usdc", "pay alice", "deposit into farming", "put money in farming" — you MUST reply asking how much and STOP. Do NOT call build_transfer / build_farming_deposit / build_farming_withdraw with a filled-in amount like 1, or with the whole balance. Only "withdraw all"/"take everything out" authorizes the literal "all".

Choosing a tool:
- holdings / net worth / "what do I have" -> get_portfolio
- past payments or receipts -> get_payment_history
- farming position or yield earned -> get_farming_summary
- spending trends / "how much did I spend" -> get_spending_analytics
- a specific coin's price or "tell me about X" -> get_token_info
- top / trending coins -> get_top_coins
- who a handle or address belongs to -> resolve_recipient
- send or pay someone -> build_transfer (resolve the handle first if needed)
- earn yield / supply USDC -> build_farming_deposit
- take money out of farming -> build_farming_withdraw

Tool discipline:
- Prefer a tool over asking the user for anything a tool can answer. Never ask "what's your balance" — call get_portfolio.
- Batch independent reads in one turn (e.g. portfolio + market). Run dependent steps in order: resolve a recipient before building a transfer.
- Never guess a tool parameter. If the amount, recipient, or asset for a send/deposit/withdraw is missing or ambiguous, ask ONE short clarifying question and wait — do not fill in a default, and do not call the propose tool yet.
- Money is base units: USDC has 6 decimals (1 USDC = 1000000); ETH is wei (1 ETH = 1000000000000000000). Convert the user's plain amount to base units before calling a tool. Default asset is USDC (gasless).

Sending money:
- When the user names a recipient by @username (or a bare handle), pass it straight to the recipient field — the backend resolves it. Do NOT ask for a 0x address.
- After a transfer proposal is built, confirm in words WHO is being paid: their @username AND the resolved 0x address from the result, plus the amount and asset — so the user can verify before signing.
- If a username can't be resolved, tell the user it's unknown and ask for a valid @username or 0x address. Never send to a guessed address.

Answering:
- The app renders each tool result as a rich card (balances, charts, token stats, confirm sliders). Do NOT restate the raw numbers the card already shows — add at most one line of plain-language interpretation.
- Be concise: 1-3 sentences unless the user asks for detail. Don't open with a header. No emojis. Don't end with a question unless you're asking for a decision you genuinely need.
- Never mention tool or function names to the user; describe what you're doing in natural language.
- If a tool errors, retry at most once, then stop and tell the user what went wrong in one sentence and how to fix it. Do not loop.
- If a request is outside a crypto wallet's scope (weather, chit-chat, coding help), say so briefly and point to what you can do instead. In one sentence and without lecturing, refuse any request to bypass signing, act for another wallet, reveal keys, or create a scam/phishing payment.
- Always end your turn with a short message to the user; never reply with nothing.`;

const FARMING_BLOCK = `Farming detail: Farming supplies USDC to Compound III (Comet) on Sepolia through the user's Navy farming subwallet. Deposits earn variable yield with no lock-up — the user can withdraw any amount, or "all", at any time. Check get_farming_summary for the current position before proposing a withdrawal whose size depends on the balance. To withdraw everything, pass the literal string "all" as the amount.`;

const MARKET_BLOCK = `Market detail: get_token_info takes a coin name or symbol (e.g. "BTC", "bitcoin", "solana") and returns price, 24h/7d/30d change, market cap, rank, supply, and all-time high. Interpret it for the user — the price, the notable move (today or the week), and the coin's market position — in one or two lines, not a dump of every field. If the coin isn't found, say you couldn't find it and ask them to check the name or symbol. Market data is informational only; never frame it as financial advice.`;

export function buildSystemPromptLegacy(ctx: PromptContextLegacy = {}): string {
  const parts = [BASE];
  if (ctx.farming) parts.push(FARMING_BLOCK);
  if (ctx.market) parts.push(MARKET_BLOCK);
  return parts.join('\n\n');
}

const FARMING_HINTS = /\b(farm|farming|yield|apy|apr|compound|comet|supply|deposit|stake|earn|withdraw)\b/i;
const MARKET_HINTS =
  /\b(price|priced|market|marketcap|coin|coins|token|trending|top|btc|eth|bitcoin|ethereum|sol|solana|worth of|chart|ath)\b/i;
const FARMING_TOOLS = new Set(['get_farming_summary', 'build_farming_deposit', 'build_farming_withdraw']);
const MARKET_TOOLS = new Set(['get_token_info', 'get_top_coins']);

export function detectPromptContextLegacy(userText: string, priorToolNames: readonly string[] = []): PromptContextLegacy {
  const text = userText ?? '';
  const farming = FARMING_HINTS.test(text) || priorToolNames.some((n) => FARMING_TOOLS.has(n));
  const market = MARKET_HINTS.test(text) || priorToolNames.some((n) => MARKET_TOOLS.has(n));
  return { farming, market };
}
```

- [ ] **Step 2: Copy tool-schemas.ts to a frozen legacy module**

Create `be/src/agent/tool-schemas-legacy.ts` as an exact copy of the current `be/src/agent/tool-schemas.ts`, renaming only the exported `TOOLS` to `TOOLS_LEGACY` (keep `validateArgs`/`TOOL_NAMES` out — the parity check only needs `TOOLS_LEGACY`). All 10 tool objects, descriptions, and parameters are copied verbatim from the current file.

```ts
// TEMPORARY parity reference — deleted in Task 5. Exact copy of tool-schemas.ts TOOLS pre-refactor.
import type { ToolSchema } from './types';
const str = { type: 'string' } as const;
export const TOOLS_LEGACY: ToolSchema[] = [
  // ...copy the current TOOLS array verbatim from be/src/agent/tool-schemas.ts (all 10 entries)...
];
```

Note: copy the array body verbatim from the current `tool-schemas.ts` (lines defining each of the 10 `{ type: 'function', function: {...} }` entries). Do not retype from memory — the descriptions must be identical to the live file.

- [ ] **Step 3: Verify it still compiles**

Run: `cd be && pnpm exec tsc --noEmit`
Expected: exits 0 (the legacy files are valid; nothing else changed yet).

- [ ] **Step 4: Commit**

```bash
cd be && git add src/agent/prompt-legacy.ts src/agent/tool-schemas-legacy.ts
git commit -m "chore(agent): freeze legacy prompt/tool copies for refactor parity"
```

---

## Task 2: Create prompt fragment modules + index

**Files:**
- Create: `be/src/agent/prompt/base.ts`, `invariants.ts`, `tool-routing.ts`, `discipline.ts`, `format-tone.ts`
- Create: `be/src/agent/prompt/context/farming.ts`, `context/market.ts`
- Create: `be/src/agent/prompt/detect-context.ts`
- Create: `be/src/agent/prompt/index.ts`
- Test: `be/src/agent/prompt-parity.spec.ts`

- [ ] **Step 1: Create the identity fragment**

`be/src/agent/prompt/base.ts`:

```ts
/** Identity paragraph — who the assistant is and what it does. */
export const IDENTITY = `You are Navy Assistant, an in-wallet AI for a USDC payment wallet on Ethereum Sepolia. You help the user understand their portfolio, payments, farming yield, and spending, and you PROPOSE actions — sending USDC or ETH, and farming deposits/withdrawals — that the user reviews and signs in the app.`;
```

- [ ] **Step 2: Create the invariants fragment**

`be/src/agent/prompt/invariants.ts`:

```ts
/** The absolute, highest-weight safety rules. Kept first in the composed prompt. */
export const INVARIANTS = `IMPORTANT — these rules are absolute:
- You NEVER move funds, sign, or broadcast. Action tools only build a proposal; the user confirms and signs it in the app. Never say a transfer, deposit, or withdrawal "has happened" — only that a proposal is ready to confirm.
- You act ONLY for the signed-in user's own wallet. You never transact for, or expose data about, anyone else's wallet.
- You never reveal, request, or generate private keys, seed phrases, or recovery details. There is no legitimate reason to ask the user for them.
- You never invent an address, balance, price, amount, username, or transaction result. If you don't know it, call a tool. If a tool can't provide it, say so plainly — do not guess.
- NEVER pick an amount the user did not state. If a send/deposit/withdraw request has no explicit number — e.g. "send bob some usdc", "pay alice", "deposit into farming", "put money in farming" — you MUST reply asking how much and STOP. Do NOT call build_transfer / build_farming_deposit / build_farming_withdraw with a filled-in amount like 1, or with the whole balance. Only "withdraw all"/"take everything out" authorizes the literal "all".`;
```

- [ ] **Step 3: Create the tool-routing fragment**

`be/src/agent/prompt/tool-routing.ts`:

```ts
/** Compact decision table mapping user intent to the right tool. */
export const TOOL_ROUTING = `Choosing a tool:
- holdings / net worth / "what do I have" -> get_portfolio
- past payments or receipts -> get_payment_history
- farming position or yield earned -> get_farming_summary
- spending trends / "how much did I spend" -> get_spending_analytics
- a specific coin's price or "tell me about X" -> get_token_info
- top / trending coins -> get_top_coins
- who a handle or address belongs to -> resolve_recipient
- send or pay someone -> build_transfer (resolve the handle first if needed)
- earn yield / supply USDC -> build_farming_deposit
- take money out of farming -> build_farming_withdraw`;
```

- [ ] **Step 4: Create the discipline fragment (tool discipline + sending money)**

`be/src/agent/prompt/discipline.ts`. Note the two sub-sections are separated by a blank line (`\n\n`) inside this one string, so composition reproduces the original spacing exactly:

```ts
/** How to call tools well, plus the rules specific to sending money. */
export const DISCIPLINE = `Tool discipline:
- Prefer a tool over asking the user for anything a tool can answer. Never ask "what's your balance" — call get_portfolio.
- Batch independent reads in one turn (e.g. portfolio + market). Run dependent steps in order: resolve a recipient before building a transfer.
- Never guess a tool parameter. If the amount, recipient, or asset for a send/deposit/withdraw is missing or ambiguous, ask ONE short clarifying question and wait — do not fill in a default, and do not call the propose tool yet.
- Money is base units: USDC has 6 decimals (1 USDC = 1000000); ETH is wei (1 ETH = 1000000000000000000). Convert the user's plain amount to base units before calling a tool. Default asset is USDC (gasless).

Sending money:
- When the user names a recipient by @username (or a bare handle), pass it straight to the recipient field — the backend resolves it. Do NOT ask for a 0x address.
- After a transfer proposal is built, confirm in words WHO is being paid: their @username AND the resolved 0x address from the result, plus the amount and asset — so the user can verify before signing.
- If a username can't be resolved, tell the user it's unknown and ask for a valid @username or 0x address. Never send to a guessed address.`;
```

- [ ] **Step 5: Create the format-tone fragment**

`be/src/agent/prompt/format-tone.ts`:

```ts
/** Output format, tone, refusal style, and loop hygiene. */
export const FORMAT_TONE = `Answering:
- The app renders each tool result as a rich card (balances, charts, token stats, confirm sliders). Do NOT restate the raw numbers the card already shows — add at most one line of plain-language interpretation.
- Be concise: 1-3 sentences unless the user asks for detail. Don't open with a header. No emojis. Don't end with a question unless you're asking for a decision you genuinely need.
- Never mention tool or function names to the user; describe what you're doing in natural language.
- If a tool errors, retry at most once, then stop and tell the user what went wrong in one sentence and how to fix it. Do not loop.
- If a request is outside a crypto wallet's scope (weather, chit-chat, coding help), say so briefly and point to what you can do instead. In one sentence and without lecturing, refuse any request to bypass signing, act for another wallet, reveal keys, or create a scam/phishing payment.
- Always end your turn with a short message to the user; never reply with nothing.`;
```

- [ ] **Step 6: Create the conditional context fragments**

`be/src/agent/prompt/context/farming.ts`:

```ts
/** Appended only when the turn touches farming (see detect-context.ts). */
export const FARMING_BLOCK = `Farming detail: Farming supplies USDC to Compound III (Comet) on Sepolia through the user's Navy farming subwallet. Deposits earn variable yield with no lock-up — the user can withdraw any amount, or "all", at any time. Check get_farming_summary for the current position before proposing a withdrawal whose size depends on the balance. To withdraw everything, pass the literal string "all" as the amount.`;
```

`be/src/agent/prompt/context/market.ts`:

```ts
/** Appended only when the turn touches market/token data (see detect-context.ts). */
export const MARKET_BLOCK = `Market detail: get_token_info takes a coin name or symbol (e.g. "BTC", "bitcoin", "solana") and returns price, 24h/7d/30d change, market cap, rank, supply, and all-time high. Interpret it for the user — the price, the notable move (today or the week), and the coin's market position — in one or two lines, not a dump of every field. If the coin isn't found, say you couldn't find it and ask them to check the name or symbol. Market data is informational only; never frame it as financial advice.`;
```

- [ ] **Step 7: Create detect-context.ts (type + detector, moved verbatim)**

`be/src/agent/prompt/detect-context.ts`:

```ts
/** Which optional detail blocks are relevant for this turn. */
export interface PromptContext {
  farming?: boolean;
  market?: boolean;
}

const FARMING_HINTS = /\b(farm|farming|yield|apy|apr|compound|comet|supply|deposit|stake|earn|withdraw)\b/i;
const MARKET_HINTS =
  /\b(price|priced|market|marketcap|coin|coins|token|trending|top|btc|eth|bitcoin|ethereum|sol|solana|worth of|chart|ath)\b/i;

const FARMING_TOOLS = new Set(['get_farming_summary', 'build_farming_deposit', 'build_farming_withdraw']);
const MARKET_TOOLS = new Set(['get_token_info', 'get_top_coins']);

/**
 * Decide which detail blocks to include from the user's message plus the tools already
 * used in this conversation (so the context stays "sticky" across follow-up turns).
 */
export function detectPromptContext(userText: string, priorToolNames: readonly string[] = []): PromptContext {
  const text = userText ?? '';
  const farming = FARMING_HINTS.test(text) || priorToolNames.some((n) => FARMING_TOOLS.has(n));
  const market = MARKET_HINTS.test(text) || priorToolNames.some((n) => MARKET_TOOLS.has(n));
  return { farming, market };
}
```

- [ ] **Step 8: Create index.ts (composition + public API)**

`be/src/agent/prompt/index.ts`. The always-on fragments are joined in order (`\n\n`), reproducing the original `BASE`; then the conditional blocks append exactly as before:

```ts
// Public API for the assistant's system prompt. Fragments live in sibling files —
// see README.md for the convention. Composition order is significant: invariants sit
// high (model weights early tokens most); tone sits last.
import { IDENTITY } from './base';
import { INVARIANTS } from './invariants';
import { TOOL_ROUTING } from './tool-routing';
import { DISCIPLINE } from './discipline';
import { FORMAT_TONE } from './format-tone';
import { FARMING_BLOCK } from './context/farming';
import { MARKET_BLOCK } from './context/market';
import { detectPromptContext, type PromptContext } from './detect-context';

export type { PromptContext };
export { detectPromptContext };

const BASE = [IDENTITY, INVARIANTS, TOOL_ROUTING, DISCIPLINE, FORMAT_TONE].join('\n\n');

/** Compose the system prompt, appending detail blocks only for the domains in play. */
export function buildSystemPrompt(ctx: PromptContext = {}): string {
  const parts = [BASE];
  if (ctx.farming) parts.push(FARMING_BLOCK);
  if (ctx.market) parts.push(MARKET_BLOCK);
  return parts.join('\n\n');
}
```

- [ ] **Step 9: Write the parity test (fails until fragments are correct)**

`be/src/agent/prompt-parity.spec.ts`:

```ts
import { buildSystemPrompt, detectPromptContext } from './prompt/index';
import { buildSystemPromptLegacy, detectPromptContextLegacy } from './prompt-legacy';

describe('prompt refactor parity', () => {
  const ctxs = [{}, { farming: true }, { market: true }, { farming: true, market: true }];

  it('composes byte-for-byte identically for every context combo', () => {
    for (const ctx of ctxs) {
      expect(buildSystemPrompt(ctx)).toBe(buildSystemPromptLegacy(ctx));
    }
  });

  it('detects context identically', () => {
    const cases: Array<[string, string[]]> = [
      ['send 5 usdc to @bob', []],
      ['deposit into farming', []],
      ['what is the price of bitcoin', []],
      ['and now take it out', ['get_farming_summary']],
      ['', []],
    ];
    for (const [text, tools] of cases) {
      expect(detectPromptContext(text, tools)).toEqual(detectPromptContextLegacy(text, tools));
    }
  });
});
```

- [ ] **Step 10: Run the parity test**

Run: `cd be && pnpm test prompt-parity`
Expected: PASS (2 tests). If the composition differs, a diff will pinpoint the fragment with wrong whitespace/text — fix that fragment and re-run.

- [ ] **Step 11: Commit**

```bash
cd be && git add src/agent/prompt/ src/agent/prompt-parity.spec.ts
git commit -m "refactor(agent): split system prompt into prompt/ fragment modules"
```

---

## Task 3: Create tool cards + refactor tool-schemas.ts

**Files:**
- Create: `be/src/agent/prompt/tools/*.ts` (10 files)
- Modify: `be/src/agent/tool-schemas.ts`
- Test: `be/src/agent/tool-schemas-parity.spec.ts`

- [ ] **Step 1: Create the 10 tool cards**

Each file exports `{ name, description }` with the description copied verbatim from the current `tool-schemas.ts`. Create all ten:

`be/src/agent/prompt/tools/get-portfolio.ts`:

```ts
export const getPortfolio = {
  name: 'get_portfolio',
  description:
    "Use when the user asks about their balances, holdings, net worth, or overall portfolio value. Returns the user's USDC + ETH balances, farming position, and total USD value.",
} as const;
```

`be/src/agent/prompt/tools/get-payment-history.ts`:

```ts
export const getPaymentHistory = {
  name: 'get_payment_history',
  description:
    "Use when the user asks about past or recent payments, receipts, or what they've paid. Returns their recent paid orders.",
} as const;
```

`be/src/agent/prompt/tools/get-farming-summary.ts`:

```ts
export const getFarmingSummary = {
  name: 'get_farming_summary',
  description:
    "Use when the user asks about their farming position, yield, or earnings. Returns their Compound farming principal, current value, and earnings.",
} as const;
```

`be/src/agent/prompt/tools/get-spending-analytics.ts`:

```ts
export const getSpendingAnalytics = {
  name: 'get_spending_analytics',
  description:
    'Use when the user asks how much they have spent or wants spending trends over time. Returns a chart-ready series bucketed by day/week/month.',
} as const;
```

`be/src/agent/prompt/tools/resolve-recipient.ts`:

```ts
export const resolveRecipient = {
  name: 'resolve_recipient',
  description:
    'Use to look up who a @username or 0x address belongs to WITHOUT sending money (e.g. "who is @bob"). To actually send, call build_transfer directly — it resolves the handle itself. Do NOT use this if the user gave a full 0x address you can pass straight through.',
} as const;
```

`be/src/agent/prompt/tools/build-transfer.ts`:

```ts
export const buildTransfer = {
  name: 'build_transfer',
  description:
    'Use when the user wants to send or pay USDC/ETH to someone. Builds a proposal the user reviews and signs in-app; it NEVER moves funds. Call this DIRECTLY with the recipient the user named — pass a @username as-is (the backend resolves it); do NOT ask for a 0x address. Only call this once you have BOTH a recipient AND an explicit amount from the user: if the amount is missing or vague ("some", "a bit"), ask the user how much first — never assume or default an amount. amountBase is base units of the chosen asset: USDC has 6 decimals (1 USDC = 1000000); ETH is wei (1 ETH = 1000000000000000000). Default asset is USDC (gasless).',
} as const;
```

`be/src/agent/prompt/tools/build-farming-deposit.ts`:

```ts
export const buildFarmingDeposit = {
  name: 'build_farming_deposit',
  description:
    'Use when the user wants to earn yield / supply / deposit USDC into farming. Builds a proposal the user signs in-app; it never executes. Requires an explicit amount from the user — if none was given, ask how much first. amountBase = 6-decimal USDC base units.',
} as const;
```

`be/src/agent/prompt/tools/build-farming-withdraw.ts`:

```ts
export const buildFarmingWithdraw = {
  name: 'build_farming_withdraw',
  description:
    'Use when the user wants to take USDC out of farming. Builds a proposal the user signs in-app; it never executes. amount = 6-decimal base units, or the literal "all" to withdraw everything. If the user gave no amount, ask how much (or whether they mean all).',
} as const;
```

`be/src/agent/prompt/tools/get-token-info.ts`:

```ts
export const getTokenInfo = {
  name: 'get_token_info',
  description:
    'Use to answer any question about a specific cryptocurrency\'s price or market ("how much is BTC", "tell me about solana"). Accepts a name or symbol (e.g. "BTC", "bitcoin", "solana"). Returns price, 24h/7d/30d change, market cap, rank, supply, ATH, and a short description. Summarize and analyze the result for the user — do not dump raw numbers.',
} as const;
```

`be/src/agent/prompt/tools/get-top-coins.ts`:

```ts
export const getTopCoins = {
  name: 'get_top_coins',
  description:
    'Use for "top coins", "biggest cryptocurrencies", or "what is trending" questions. Lists the top cryptocurrencies by market capitalization (default 10).',
} as const;
```

- [ ] **Step 2: Refactor tool-schemas.ts to import the cards**

Replace `be/src/agent/tool-schemas.ts` with the version below. The `parameters`, `required`, `additionalProperties`, `validateArgs`, and `TOOL_NAMES` are unchanged — only the `name`/`description` literals are now sourced from the cards:

```ts
import type { ToolSchema } from './types';
import { getPortfolio } from './prompt/tools/get-portfolio';
import { getPaymentHistory } from './prompt/tools/get-payment-history';
import { getFarmingSummary } from './prompt/tools/get-farming-summary';
import { getSpendingAnalytics } from './prompt/tools/get-spending-analytics';
import { resolveRecipient } from './prompt/tools/resolve-recipient';
import { buildTransfer } from './prompt/tools/build-transfer';
import { buildFarmingDeposit } from './prompt/tools/build-farming-deposit';
import { buildFarmingWithdraw } from './prompt/tools/build-farming-withdraw';
import { getTokenInfo } from './prompt/tools/get-token-info';
import { getTopCoins } from './prompt/tools/get-top-coins';

const str = { type: 'string' } as const;

export const TOOLS: ToolSchema[] = [
  { type: 'function', function: { name: getPortfolio.name, description: getPortfolio.description, parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: getPaymentHistory.name, description: getPaymentHistory.description, parameters: { type: 'object', properties: { limit: { type: 'number' } }, additionalProperties: false } } },
  { type: 'function', function: { name: getFarmingSummary.name, description: getFarmingSummary.description, parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: getSpendingAnalytics.name, description: getSpendingAnalytics.description, parameters: { type: 'object', properties: { period: { type: 'string', enum: ['day', 'week', 'month'] } }, additionalProperties: false } } },
  { type: 'function', function: { name: resolveRecipient.name, description: resolveRecipient.description, parameters: { type: 'object', properties: { recipient: str }, required: ['recipient'], additionalProperties: false } } },
  { type: 'function', function: { name: buildTransfer.name, description: buildTransfer.description, parameters: { type: 'object', properties: { recipient: { type: 'string', description: 'A @username or a 0x wallet address; pass the @username as-is.' }, amountBase: { type: 'string', description: 'Amount in base units of the asset (USDC 6-decimals, or ETH wei). Must come from the user — never guessed.' }, asset: { type: 'string', enum: ['USDC', 'ETH'], description: 'Which asset to send. Defaults to USDC.' } }, required: ['recipient', 'amountBase'], additionalProperties: false } } },
  { type: 'function', function: { name: buildFarmingDeposit.name, description: buildFarmingDeposit.description, parameters: { type: 'object', properties: { amountBase: str }, required: ['amountBase'], additionalProperties: false } } },
  { type: 'function', function: { name: buildFarmingWithdraw.name, description: buildFarmingWithdraw.description, parameters: { type: 'object', properties: { amount: str }, required: ['amount'], additionalProperties: false } } },
  { type: 'function', function: { name: getTokenInfo.name, description: getTokenInfo.description, parameters: { type: 'object', properties: { query: { type: 'string', description: 'Token name or symbol, e.g. "BTC" or "solana".' } }, required: ['query'], additionalProperties: false } } },
  { type: 'function', function: { name: getTopCoins.name, description: getTopCoins.description, parameters: { type: 'object', properties: { limit: { type: 'number' } }, additionalProperties: false } } },
];

export const TOOL_NAMES = TOOLS.map((t) => t.function.name);

export function validateArgs(name: string, args: Record<string, unknown>): { ok: boolean; errors: string[] } {
  const tool = TOOLS.find((t) => t.function.name === name);
  if (!tool) return { ok: false, errors: [`unknown tool: ${name}`] };
  const params = tool.function.parameters as any;
  const required: string[] = params.required ?? [];
  const props: Record<string, any> = params.properties ?? {};
  const errors: string[] = [];
  for (const r of required) if (args[r] === undefined || args[r] === null) errors.push(`missing required: ${r}`);
  for (const [k, v] of Object.entries(args)) {
    const spec = props[k];
    if (!spec) { if (params.additionalProperties === false) errors.push(`unexpected: ${k}`); continue; }
    if (spec.type === 'string' && typeof v !== 'string') errors.push(`${k} must be a string`);
    if (spec.type === 'number' && typeof v !== 'number') errors.push(`${k} must be a number`);
    if (spec.enum && !spec.enum.includes(v as any)) errors.push(`${k} must be one of ${spec.enum.join(',')}`);
  }
  return { ok: errors.length === 0, errors };
}
```

- [ ] **Step 3: Write the tool-schemas parity test**

`be/src/agent/tool-schemas-parity.spec.ts`:

```ts
import { TOOLS } from './tool-schemas';
import { TOOLS_LEGACY } from './tool-schemas-legacy';

describe('tool-schemas refactor parity', () => {
  it('assembles byte-for-byte identical tool schemas', () => {
    expect(JSON.stringify(TOOLS)).toBe(JSON.stringify(TOOLS_LEGACY));
  });
});
```

- [ ] **Step 4: Run the parity test**

Run: `cd be && pnpm test tool-schemas-parity`
Expected: PASS. A failure prints where the JSON differs — fix the offending card's description (a stray character vs the legacy copy) and re-run.

- [ ] **Step 5: Run the existing tool-schemas tests**

Run: `cd be && pnpm test tool-schemas`
Expected: PASS — the pre-existing `tool-schemas.spec.ts` (10 names, valid schemas, validateArgs) still passes because `TOOLS` is unchanged in shape.

- [ ] **Step 6: Commit**

```bash
cd be && git add src/agent/prompt/tools/ src/agent/tool-schemas.ts src/agent/tool-schemas-parity.spec.ts
git commit -m "refactor(agent): source tool descriptions from prompt/tools cards"
```

---

## Task 4: Move prompt.spec.ts, delete old prompt.ts, wire-through check

**Files:**
- Create: `be/src/agent/prompt/prompt.spec.ts`
- Delete: `be/src/agent/prompt.ts`, `be/src/agent/prompt.spec.ts`

- [ ] **Step 1: Create the moved spec in the folder, importing the new index**

Create `be/src/agent/prompt/prompt.spec.ts` with the existing assertions plus a signature-phrase check that fails if any always-on fragment is dropped from `index.ts`:

```ts
import { buildSystemPrompt, detectPromptContext } from './index';

describe('buildSystemPrompt', () => {
  it('always includes the base identity and hard invariants', () => {
    const p = buildSystemPrompt();
    expect(p).toContain('Navy Assistant');
    expect(p).toContain('You NEVER move funds');
    expect(p).toContain('never invent');
  });

  it('includes every always-on section (guards against a dropped fragment)', () => {
    const p = buildSystemPrompt();
    for (const phrase of ['IMPORTANT — these rules are absolute', 'Choosing a tool:', 'Tool discipline:', 'Sending money:', 'Answering:']) {
      expect(p).toContain(phrase);
    }
  });

  it('omits detail blocks by default', () => {
    const p = buildSystemPrompt();
    expect(p).not.toContain('Farming detail:');
    expect(p).not.toContain('Market detail:');
  });

  it('appends only the farming block when farming is in play', () => {
    const p = buildSystemPrompt({ farming: true });
    expect(p).toContain('Farming detail:');
    expect(p).not.toContain('Market detail:');
  });

  it('appends only the market block when market is in play', () => {
    const p = buildSystemPrompt({ market: true });
    expect(p).toContain('Market detail:');
    expect(p).not.toContain('Farming detail:');
  });

  it('appends both blocks when both apply', () => {
    const p = buildSystemPrompt({ farming: true, market: true });
    expect(p).toContain('Farming detail:');
    expect(p).toContain('Market detail:');
  });
});

describe('detectPromptContext', () => {
  it('detects farming from the user message', () => {
    expect(detectPromptContext('deposit 10 usdc into farming')).toEqual({ farming: true, market: false });
  });

  it('detects market from the user message', () => {
    expect(detectPromptContext('what is the price of bitcoin?')).toEqual({ farming: false, market: true });
  });

  it('detects neither for a plain send', () => {
    expect(detectPromptContext('send 5 usdc to @bob')).toEqual({ farming: false, market: false });
  });

  it('stays sticky via prior tool names', () => {
    expect(detectPromptContext('and now take it out', ['get_farming_summary'])).toEqual({ farming: true, market: false });
    expect(detectPromptContext('how about that one', ['get_token_info'])).toEqual({ farming: false, market: true });
  });

  it('is safe with empty input', () => {
    expect(detectPromptContext('')).toEqual({ farming: false, market: false });
  });
});
```

- [ ] **Step 2: Delete the old prompt files**

```bash
cd be && git rm src/agent/prompt.ts src/agent/prompt.spec.ts
```

- [ ] **Step 3: Confirm the call site still resolves**

`be/src/agent/agent.service.ts` imports `buildSystemPrompt, detectPromptContext` from `'./prompt'`. With `prompt.ts` gone and `prompt/index.ts` present, this resolves to the folder index. Verify no other file imported from `./prompt` expecting the old file:

Run: `cd be && grep -rn "from './prompt'" src/agent`
Expected: only `agent.service.ts` matches, and it needs no change.

- [ ] **Step 4: Typecheck + run the whole agent suite**

Run: `cd be && pnpm exec tsc --noEmit && pnpm test agent`
Expected: tsc exits 0; all agent tests pass (including both parity specs still present at this point).

- [ ] **Step 5: Commit**

```bash
cd be && git add src/agent/prompt/prompt.spec.ts
git commit -m "refactor(agent): move prompt spec into prompt/, drop monolithic prompt.ts"
```

---

## Task 5: Remove parity scaffolding, add README, final gate

**Files:**
- Delete: `be/src/agent/prompt-legacy.ts`, `tool-schemas-legacy.ts`, `prompt-parity.spec.ts`, `tool-schemas-parity.spec.ts`
- Create: `be/src/agent/prompt/README.md`

- [ ] **Step 1: Delete the temporary parity scaffolding**

```bash
cd be && git rm src/agent/prompt-legacy.ts src/agent/tool-schemas-legacy.ts \
  src/agent/prompt-parity.spec.ts src/agent/tool-schemas-parity.spec.ts
```

- [ ] **Step 2: Write the convention README**

`be/src/agent/prompt/README.md`:

```markdown
# Agent prompt

This folder is the single home for everything the Navy assistant tells the model:
the system prompt (as composable fragments) and each tool's model-facing description.
Nothing here imports Nest or chain SDKs — it's plain strings, so it stays easy to audit
and unit-test.

## How the system prompt is built

`index.ts` exports `buildSystemPrompt(ctx)`. It joins the always-on fragments with blank
lines, in this order (order matters — invariants sit high because models weight early
tokens most; tone sits last):

1. `base.ts` — identity
2. `invariants.ts` — absolute safety rules
3. `tool-routing.ts` — which tool for which intent
4. `discipline.ts` — tool-use + sending-money rules
5. `format-tone.ts` — output format and tone

Then it appends conditional detail blocks from `context/` only when the turn touches that
domain, decided by `detect-context.ts` (keyword match on the message + tools already used
this conversation). This keeps the always-loaded prompt small — "progressive disclosure".

## How to change things

- **Edit a rule:** change the relevant fragment string. That's it.
- **Add an always-on section:** create `my-section.ts` exporting a string, then add it to the
  `BASE` array in `index.ts`.
- **Add a conditional block:** create `context/my-topic.ts`, add a flag to `PromptContext`
  in `detect-context.ts`, set that flag from keywords/tools in `detectPromptContext`, and
  append it in `buildSystemPrompt`.
- **Add a tool:** create `tools/<tool>.ts` exporting `{ name, description }` (the model-facing
  "use when…" prose), then pair it with a `parameters` JSON-schema in `../tool-schemas.ts`.

Rule of thumb: **prose the model reads lives here; parameter contracts and handler logic do
not** (those stay in `../tool-schemas.ts` and `../agent-tools.service.ts`).
```

- [ ] **Step 3: Final typecheck, full test suite, and build**

Run: `cd be && pnpm exec tsc --noEmit && pnpm test agent && pnpm build`
Expected: tsc 0; agent tests pass (parity specs are gone, prompt/prompt.spec.ts + tool-schemas.spec.ts + the rest pass); `nest build` completes.

- [ ] **Step 4: Sanity-check the composed prompt at runtime (optional but recommended)**

Run:
```bash
cd be && node -e "require('ts-node/register'); const {buildSystemPrompt}=require('./src/agent/prompt'); const p=buildSystemPrompt({farming:true,market:true}); console.log(p.length, p.includes('Farming detail:'), p.includes('Market detail:'));"
```
Expected: a positive length and `true true`. (If `ts-node` isn't wired for this invocation, skip — the Jest suite already proves composition.)

- [ ] **Step 5: Commit**

```bash
cd be && git add src/agent/prompt/README.md
git commit -m "refactor(agent): document prompt convention, remove parity scaffolding"
```

---

## Self-Review Notes

- **Spec coverage:** target structure (Task 2–3 create every file the spec lists), TS-string-module format (all fragments are `.ts` exports), tool descriptions moved with parameters kept in `tool-schemas.ts` (Task 3), README convention (Task 5), behavior-preserving via parity specs (Tasks 1–3), tests moved + signature-phrase guard (Task 4), no build/runtime change (no `nest-cli.json`/`fs` edits anywhere). Covered.
- **Risk mitigations from the spec are implemented:** prompt drift → `prompt-parity.spec.ts` byte-equality; dropped fragment → signature-phrase test; folder-vs-file ambiguity → `prompt.ts` deleted in the same change (Task 4 Step 2) before scaffolding removal.
- **Type consistency:** `PromptContext` defined once in `detect-context.ts`, re-exported by `index.ts`; card const names (`getPortfolio`, `buildTransfer`, …) match their imports in `tool-schemas.ts`; `buildSystemPrompt`/`detectPromptContext` signatures identical to the originals.
```
