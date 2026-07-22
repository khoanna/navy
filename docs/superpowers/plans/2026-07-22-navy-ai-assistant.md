# Navy AI Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A conversational AI assistant in the expo-wallet ("Assistant" tab) that uses OpenRouter tool-calling to answer wallet questions, render portfolio/analytics charts, and **propose** farming deposit/withdraw and gasless USDC transfers that the user confirms and signs.

**Architecture:** New `be/src/agent` Nest BFF holds the OpenRouter key and runs a server-side tool loop (call → `tool_calls` → execute → append `role:"tool"` → repeat until `stop`), streaming the final answer to the app over SSE. Tool registry/dispatch/loop/trimming are framework-free plain-TS (unit-tested); handlers reuse existing services (portfolio/orders/farming) + Plan 1's `TransferService`. The app renders an Assistant chat that shows tool chips, inline cards/charts, and inline confirm cards that sign via the existing Privy `useMobileSigner`.

**Tech Stack:** Nest.js 11, ethers v6, OpenRouter chat-completions (SSE), Prisma 7, Expo/React Native (expo/fetch streaming, react-native-svg), Jest.

**Depends on:** `2026-07-22-navy-transfer-username.md` (the transfer rails + `TransferService`).

---

## Prerequisites

- Plan 1 merged (username + `TransferService` + `Transfer` model).
- An OpenRouter account + API key. For the free-model verification (Phase F), pick a currently-available **free model that supports tools** from `https://openrouter.ai/models?supported_parameters=tools&max_price=0` (e.g. `google/gemini-2.0-flash-exp:free` at time of writing — availability changes; the loop is model-agnostic).

## File Structure

**Backend (create) — `be/src/agent/`:**
- `types.ts` — ChatMessage / ToolCall / tool-result types (pure).
- `tool-schemas.ts` — the `TOOLS` array (OpenAI/OpenRouter function schema) + `validateArgs` (pure, tested).
- `tool-dispatch.ts` — parse+validate+route to a handler map, structured errors (pure, tested).
- `agent-loop.ts` — pure orchestration loop (tested with fakes).
- `context-window.ts` — message trimming to a token budget (pure, tested).
- `analytics.ts` — pure spend-series shaping for charts (tested).
- `openrouter.client.ts` — streaming chat-completions client (typecheck).
- `agent-tools.service.ts` — builds the real handler map from services (typecheck).
- `conversation.service.ts` — persist conversations/messages (typecheck).
- `agent.service.ts` — glue: load history → loop (with streaming callModel) → persist (typecheck).
- `agent.controller.ts` — SSE `POST /agent/chat`, `GET /agent/conversations`, `GET /agent/conversations/:id`.
- `agent.module.ts` — wiring.

**Backend (modify):**
- `be/prisma/schema.prisma` — `AgentConversation` + `AgentMessage`.
- `be/src/config/config.service.ts` — OpenRouter env getters.
- `be/src/app.module.ts` — register `AgentModule`.
- `be/scripts/agent-e2e.mjs` — free-model tool-calling proof (create).

**Expo (create):**
- `src/lib/agent/sseParser.ts` — pure SSE frame parser (tested).
- `src/lib/agent/chatReducer.ts` — pure chat state reducer (tested).
- `src/lib/agent/agentClient.ts` — SSE consumer via `expo/fetch` (typecheck).
- `src/lib/transfer/transferClient.ts` — build/submit transfer REST (tested).
- `src/lib/transfer/transferFlow.ts` — build → sign → submit (pure orchestration, tested).
- `src/features/assistant/PortfolioCard.tsx`, `ChartCard.tsx`, `TransferConfirmCard.tsx`, `FarmingConfirmCard.tsx`.
- `app/(tabs)/assistant.tsx` — the chat screen.

**Expo (modify):**
- `app/(tabs)/_layout.tsx` — add the Assistant tab.

---

## Phase D — Agent backend

### Task D1: Conversation Prisma models + migrate

**Files:** Modify `be/prisma/schema.prisma`

- [ ] **Step 1: Add models**

```prisma
model AgentConversation {
  id        String         @id @default(uuid())
  userId    String
  title     String?
  createdAt DateTime       @default(now())
  updatedAt DateTime       @updatedAt
  messages  AgentMessage[]

  @@index([userId, updatedAt])
}

model AgentMessage {
  id             String            @id @default(uuid())
  conversationId String
  conversation   AgentConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  role           String            // system|user|assistant|tool
  content        String?           // may be null on an assistant message that only has tool_calls
  toolCalls      Json?             // serialized ToolCall[] for assistant messages
  toolCallId     String?           // set on role=tool messages
  createdAt      DateTime          @default(now())

  @@index([conversationId, createdAt])
}
```

- [ ] **Step 2: Migrate**

Run: `cd be && DATABASE_URL="$DATABASE_URL" pnpm prisma migrate dev --name add_agent_conversations`
Expected: applied + client regenerated.

- [ ] **Step 3: Commit**

```bash
git add be/prisma/schema.prisma be/prisma/migrations
git commit -m "feat(be): AgentConversation + AgentMessage models"
```

### Task D2: Agent message + tool types

**Files:** Create `be/src/agent/types.ts`

- [ ] **Step 1: Implement** (no test — pure type declarations)

```ts
// be/src/agent/types.ts
export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string }; // arguments is a JSON string
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

/** How the app should render a tool's result. */
export type ToolDisplay =
  | { kind: 'card' }
  | { kind: 'chart'; chartType: 'line' | 'bar' | 'pie' }
  | { kind: 'action'; action: 'transfer' | 'farming_deposit' | 'farming_withdraw' };

export interface ToolResult {
  display?: ToolDisplay;
  [k: string]: unknown;
}

export interface ToolSchema {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;
export type ToolHandlers = Record<string, ToolHandler>;
```

- [ ] **Step 2: Commit**

```bash
git add be/src/agent/types.ts
git commit -m "feat(be): agent chat/tool types"
```

### Task D3: Tool schemas + arg validation

**Files:** Create `be/src/agent/tool-schemas.ts`; Test `be/src/agent/tool-schemas.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { TOOLS, TOOL_NAMES, validateArgs } from './tool-schemas';

describe('tool-schemas', () => {
  it('exposes the expected tool names', () => {
    expect(TOOL_NAMES.sort()).toEqual([
      'build_farming_deposit', 'build_farming_withdraw', 'build_transfer',
      'get_farming_summary', 'get_payment_history', 'get_portfolio',
      'get_spending_analytics', 'resolve_recipient',
    ].sort());
  });
  it('every tool is a valid function schema', () => {
    for (const t of TOOLS) {
      expect(t.type).toBe('function');
      expect(typeof t.function.name).toBe('string');
      expect(t.function.parameters).toBeDefined();
    }
  });
  it('validateArgs enforces required params for build_transfer', () => {
    expect(validateArgs('build_transfer', { recipient: '@linh', amountBase: '1000000' }).ok).toBe(true);
    expect(validateArgs('build_transfer', { recipient: '@linh' }).ok).toBe(false);
    expect(validateArgs('build_transfer', { recipient: '@linh', amountBase: 12 }).ok).toBe(false); // must be string
  });
  it('validateArgs rejects an unknown tool', () => {
    expect(validateArgs('nope', {}).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run** `cd be && pnpm test tool-schemas.spec` → FAIL.

- [ ] **Step 3: Implement**

```ts
// be/src/agent/tool-schemas.ts
import type { ToolSchema } from './types';

const str = { type: 'string' } as const;

export const TOOLS: ToolSchema[] = [
  { type: 'function', function: { name: 'get_portfolio', description: "Get the user's USDC + ETH balances and farming position.", parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'get_payment_history', description: "List the user's recent paid orders.", parameters: { type: 'object', properties: { limit: { type: 'number' } }, additionalProperties: false } } },
  { type: 'function', function: { name: 'get_farming_summary', description: "Get the user's Compound farming position and earnings.", parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'get_spending_analytics', description: 'Aggregate the user spending into a chart-ready series.', parameters: { type: 'object', properties: { period: { type: 'string', enum: ['day', 'week', 'month'] } }, additionalProperties: false } } },
  { type: 'function', function: { name: 'resolve_recipient', description: 'Resolve a @username or 0x address to a wallet address.', parameters: { type: 'object', properties: { recipient: str }, required: ['recipient'], additionalProperties: false } } },
  { type: 'function', function: { name: 'build_transfer', description: 'Build a gasless USDC transfer proposal for the user to confirm and sign. amountBase is USDC base units (6 decimals).', parameters: { type: 'object', properties: { recipient: str, amountBase: str }, required: ['recipient', 'amountBase'], additionalProperties: false } } },
  { type: 'function', function: { name: 'build_farming_deposit', description: 'Propose supplying USDC to the Compound farming vault. amountBase = 6-decimal base units.', parameters: { type: 'object', properties: { amountBase: str }, required: ['amountBase'], additionalProperties: false } } },
  { type: 'function', function: { name: 'build_farming_withdraw', description: 'Propose withdrawing from the farming vault. amount = base units or the literal "all".', parameters: { type: 'object', properties: { amount: str }, required: ['amount'], additionalProperties: false } } },
];

export const TOOL_NAMES = TOOLS.map((t) => t.function.name);

/** Minimal required+type validation (avoids a JSON-schema dep). Returns structured errors. */
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

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add be/src/agent/tool-schemas.ts be/src/agent/tool-schemas.spec.ts
git commit -m "feat(be): agent tool schemas + arg validation"
```

### Task D4: Tool dispatch

**Files:** Create `be/src/agent/tool-dispatch.ts`; Test `be/src/agent/tool-dispatch.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { dispatchTool } from './tool-dispatch';

describe('dispatchTool', () => {
  const handlers = {
    resolve_recipient: async (a: any) => ({ address: '0xabc', input: a.recipient }),
    boom: async () => { throw new Error('kaboom'); },
  } as any;

  it('parses JSON args, validates, and calls the handler', async () => {
    const r = await dispatchTool('resolve_recipient', JSON.stringify({ recipient: '@linh' }), handlers);
    expect(r).toEqual({ address: '0xabc', input: '@linh' });
  });
  it('returns a structured error on invalid JSON', async () => {
    const r = await dispatchTool('resolve_recipient', '{bad', handlers);
    expect(r).toHaveProperty('error');
  });
  it('returns a structured error on validation failure', async () => {
    const r: any = await dispatchTool('resolve_recipient', JSON.stringify({}), handlers);
    expect(r.error).toMatch(/missing required/);
  });
  it('captures a thrown handler error instead of throwing', async () => {
    // register a fake tool name that exists in schema? use build_farming_withdraw with a throwing handler
    const r: any = await dispatchTool('build_farming_withdraw', JSON.stringify({ amount: 'all' }),
      { build_farming_withdraw: async () => { throw new Error('kaboom'); } } as any);
    expect(r.error).toMatch(/kaboom/);
  });
});
```

- [ ] **Step 2: Run** `cd be && pnpm test tool-dispatch.spec` → FAIL.

- [ ] **Step 3: Implement**

```ts
// be/src/agent/tool-dispatch.ts
import { validateArgs } from './tool-schemas';
import type { ToolHandlers, ToolResult } from './types';

/** Parse the model-supplied JSON args, validate, route to a handler. Never throws — returns {error}. */
export async function dispatchTool(name: string, argsJson: string, handlers: ToolHandlers): Promise<ToolResult> {
  let args: Record<string, unknown>;
  try { args = argsJson?.trim() ? JSON.parse(argsJson) : {}; }
  catch { return { error: `invalid JSON arguments for ${name}` }; }

  const v = validateArgs(name, args);
  if (!v.ok) return { error: `invalid arguments for ${name}: ${v.errors.join('; ')}` };

  const handler = handlers[name];
  if (!handler) return { error: `no handler for tool ${name}` };

  try { return await handler(args); }
  catch (e) { return { error: (e as Error).message || `tool ${name} failed` }; }
}
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add be/src/agent/tool-dispatch.ts be/src/agent/tool-dispatch.spec.ts
git commit -m "feat(be): agent tool dispatch with structured errors"
```

### Task D5: Pure agent loop

**Files:** Create `be/src/agent/agent-loop.ts`; Test `be/src/agent/agent-loop.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { runAgentLoop } from './agent-loop';
import type { ChatMessage } from './types';

describe('runAgentLoop', () => {
  it('executes tool calls then returns on a plain assistant message', async () => {
    const scripted: ChatMessage[] = [
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_portfolio', arguments: '{}' } }] },
      { role: 'assistant', content: 'You have 100 USDC.' },
    ];
    let call = 0;
    const callModel = jest.fn(async () => scripted[call++]);
    const runTool = jest.fn(async () => ({ usdc: '100' }));
    const out = await runAgentLoop({ messages: [{ role: 'user', content: 'balance?' }], callModel, runTool, maxIterations: 5 });
    expect(runTool).toHaveBeenCalledWith('get_portfolio', '{}');
    const last = out[out.length - 1];
    expect(last).toEqual({ role: 'assistant', content: 'You have 100 USDC.' });
    // a tool result message was appended between the two assistant messages
    expect(out.some((m) => m.role === 'tool' && m.tool_call_id === 'c1')).toBe(true);
  });
  it('stops at maxIterations with a fallback assistant message', async () => {
    const callModel = jest.fn(async () => ({ role: 'assistant', content: null, tool_calls: [{ id: 'x', type: 'function', function: { name: 'get_portfolio', arguments: '{}' } }] }) as ChatMessage);
    const runTool = jest.fn(async () => ({}));
    const out = await runAgentLoop({ messages: [{ role: 'user', content: 'loop' }], callModel, runTool, maxIterations: 3 });
    expect(callModel).toHaveBeenCalledTimes(3);
    expect(out[out.length - 1].role).toBe('assistant');
  });
});
```

- [ ] **Step 2: Run** `cd be && pnpm test agent-loop.spec` → FAIL.

- [ ] **Step 3: Implement**

```ts
// be/src/agent/agent-loop.ts
import type { ChatMessage } from './types';

export interface AgentLoopArgs {
  messages: ChatMessage[];
  /** Calls the model with the running transcript; returns the assistant message (optionally with tool_calls). */
  callModel: (messages: ChatMessage[]) => Promise<ChatMessage>;
  /** Executes one tool call; returns a JSON-serializable result. */
  runTool: (name: string, argsJson: string) => Promise<unknown>;
  maxIterations: number;
}

/** Server-side tool loop: call → run tool_calls → append role:'tool' → repeat until a plain assistant message. */
export async function runAgentLoop(a: AgentLoopArgs): Promise<ChatMessage[]> {
  const messages = [...a.messages];
  for (let i = 0; i < a.maxIterations; i++) {
    const assistant = await a.callModel(messages);
    messages.push(assistant);
    const calls = assistant.role === 'assistant' ? assistant.tool_calls : undefined;
    if (!calls || calls.length === 0) return messages; // finish_reason: stop
    for (const tc of calls) {
      const result = await a.runTool(tc.function.name, tc.function.arguments);
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
    }
  }
  messages.push({ role: 'assistant', content: "I couldn't finish that in time — please try rephrasing." });
  return messages;
}
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add be/src/agent/agent-loop.ts be/src/agent/agent-loop.spec.ts
git commit -m "feat(be): pure server-side agent tool loop"
```

### Task D6: Context-window trimming

**Files:** Create `be/src/agent/context-window.ts`; Test `be/src/agent/context-window.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { trimMessages, estimateTokens } from './context-window';
import type { ChatMessage } from './types';

describe('context-window', () => {
  it('estimateTokens grows with length', () => {
    expect(estimateTokens('a'.repeat(400))).toBeGreaterThan(estimateTokens('a'.repeat(40)));
  });
  it('keeps the system message and drops oldest turns past the budget', () => {
    const msgs: ChatMessage[] = [
      { role: 'system', content: 'SYS' },
      ...Array.from({ length: 20 }, (_, i) => ({ role: 'user', content: 'x'.repeat(400) + i }) as ChatMessage),
      { role: 'user', content: 'latest question' },
    ];
    const out = trimMessages(msgs, 500);
    expect(out[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(out[out.length - 1].content).toBe('latest question');
    expect(out.length).toBeLessThan(msgs.length);
  });
});
```

- [ ] **Step 2: Run** `cd be && pnpm test context-window.spec` → FAIL.

- [ ] **Step 3: Implement**

```ts
// be/src/agent/context-window.ts
import type { ChatMessage } from './types';

/** Rough token estimate (~4 chars/token) — good enough for trimming, avoids a tokenizer dep. */
export function estimateTokens(text: string | null | undefined): number {
  return Math.ceil((text?.length ?? 0) / 4);
}

function msgTokens(m: ChatMessage): number {
  const content = 'content' in m ? m.content : '';
  return estimateTokens(content) + 4;
}

/** Keep the system message (if first) + the most recent messages that fit under `budgetTokens`. */
export function trimMessages(messages: ChatMessage[], budgetTokens: number): ChatMessage[] {
  if (messages.length === 0) return messages;
  const system = messages[0]?.role === 'system' ? messages[0] : null;
  const rest = system ? messages.slice(1) : messages;
  const kept: ChatMessage[] = [];
  let used = system ? msgTokens(system) : 0;
  for (let i = rest.length - 1; i >= 0; i--) {
    const t = msgTokens(rest[i]);
    if (used + t > budgetTokens && kept.length > 0) break;
    kept.unshift(rest[i]);
    used += t;
  }
  return system ? [system, ...kept] : kept;
}
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add be/src/agent/context-window.ts be/src/agent/context-window.spec.ts
git commit -m "feat(be): agent context-window trimming"
```

### Task D7: Spending analytics shaping

**Files:** Create `be/src/agent/analytics.ts`; Test `be/src/agent/analytics.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { spendingSeries } from './analytics';

describe('spendingSeries', () => {
  const orders = [
    { amount: '1000000', createdAt: new Date('2026-07-20T10:00:00Z'), status: 'paid' },
    { amount: '2000000', createdAt: new Date('2026-07-20T14:00:00Z'), status: 'paid' },
    { amount: '5000000', createdAt: new Date('2026-07-21T09:00:00Z'), status: 'paid' },
    { amount: '9000000', createdAt: new Date('2026-07-21T09:00:00Z'), status: 'awaiting_payment' }, // excluded
  ];
  it('buckets paid orders per day and sums base units', () => {
    const s = spendingSeries(orders as any, 'day');
    expect(s.labels).toEqual(['2026-07-20', '2026-07-21']);
    expect(s.values).toEqual(['3000000', '5000000']);
    expect(s.totalBase).toBe('8000000');
    expect(s.count).toBe(3);
  });
});
```

- [ ] **Step 2: Run** `cd be && pnpm test analytics.spec` → FAIL.

- [ ] **Step 3: Implement**

```ts
// be/src/agent/analytics.ts
export interface SpendOrder { amount: string | bigint; createdAt: Date; status: string }
export interface SpendSeries { labels: string[]; values: string[]; totalBase: string; count: number; period: string }

const PAID = new Set(['paid', 'confirmed']);

function bucketKey(d: Date, period: 'day' | 'week' | 'month'): string {
  const iso = d.toISOString();
  if (period === 'month') return iso.slice(0, 7);          // YYYY-MM
  if (period === 'week') {                                  // ISO-ish: year-week by day-of-year/7
    const day = iso.slice(0, 10);
    return day; // week bucketing kept simple = per-day label; callers pass 'day' for charts
  }
  return iso.slice(0, 10);                                  // YYYY-MM-DD
}

/** Sum paid orders into an ordered, chart-ready series (base units as strings to preserve precision). */
export function spendingSeries(orders: SpendOrder[], period: 'day' | 'week' | 'month' = 'day'): SpendSeries {
  const buckets = new Map<string, bigint>();
  let total = 0n; let count = 0;
  for (const o of orders) {
    if (!PAID.has(o.status)) continue;
    const amt = BigInt(o.amount);
    const key = bucketKey(o.createdAt, period);
    buckets.set(key, (buckets.get(key) ?? 0n) + amt);
    total += amt; count += 1;
  }
  const labels = [...buckets.keys()].sort();
  const values = labels.map((l) => buckets.get(l)!.toString());
  return { labels, values, totalBase: total.toString(), count, period };
}
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add be/src/agent/analytics.ts be/src/agent/analytics.spec.ts
git commit -m "feat(be): pure spending-analytics series shaping"
```

### Task D8: OpenRouter streaming client

**Files:** Create `be/src/agent/openrouter.client.ts`; Modify `be/src/config/config.service.ts`

- [ ] **Step 1: Add config getters** in `NavyConfigService`:

```ts
  // --- OpenRouter (AI assistant) ---
  get openRouterApiKey(): string { return this.req('OPENROUTER_API_KEY'); }
  get openRouterModel(): string { return this.env.OPENROUTER_MODEL ?? 'google/gemini-2.5-flash'; }
  get openRouterBaseUrl(): string { return this.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1'; }
  get agentMaxIterations(): number { const n = parseInt(this.env.AGENT_MAX_ITERATIONS ?? '8', 10); return Number.isFinite(n) && n > 0 ? n : 8; }
  get agentContextTokenBudget(): number { const n = parseInt(this.env.AGENT_CONTEXT_TOKENS ?? '6000', 10); return Number.isFinite(n) && n > 0 ? n : 6000; }
```

- [ ] **Step 2: Implement the client** (typecheck only; network I/O). It exposes one method that calls chat-completions with `stream:true`, forwards text deltas via an `onToken` callback, accumulates `tool_calls` deltas, and returns the assembled assistant message.

```ts
// be/src/agent/openrouter.client.ts
import type { ChatMessage, ToolCall, ToolSchema } from './types';

export interface OpenRouterConfig { apiKey: string; model: string; baseUrl: string; }

/** Accumulates streamed tool_call deltas keyed by index into complete ToolCall[]. */
function assembleToolCalls(acc: Map<number, any>): ToolCall[] {
  return [...acc.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => ({
    id: v.id, type: 'function', function: { name: v.name, arguments: v.arguments ?? '' },
  }));
}

export class OpenRouterClient {
  constructor(private readonly cfg: OpenRouterConfig, private readonly fetchImpl: typeof fetch = fetch) {}

  /** Stream one assistant turn. Calls onToken for each text delta; returns the final assistant message. */
  async streamChat(messages: ChatMessage[], tools: ToolSchema[], onToken: (t: string) => void): Promise<ChatMessage> {
    const res = await this.fetchImpl(`${this.cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.cfg.apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'Navy Wallet Assistant',
      },
      body: JSON.stringify({ model: this.cfg.model, messages, tools, tool_choice: 'auto', stream: true }),
    });
    if (!res.ok || !res.body) throw new Error(`OpenRouter error ${res.status}: ${await res.text().catch(() => '')}`);

    const reader = (res.body as any).getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    const toolAcc = new Map<number, any>();

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n');
      buffer = frames.pop() ?? '';
      for (const line of frames) {
        const s = line.trim();
        if (!s.startsWith('data:')) continue;
        const data = s.slice(5).trim();
        if (data === '[DONE]') continue;
        let json: any;
        try { json = JSON.parse(data); } catch { continue; }
        const delta = json.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.content) { content += delta.content; onToken(delta.content); }
        for (const tc of delta.tool_calls ?? []) {
          const cur = toolAcc.get(tc.index) ?? { id: tc.id, name: '', arguments: '' };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name = tc.function.name;
          if (tc.function?.arguments) cur.arguments += tc.function.arguments;
          toolAcc.set(tc.index, cur);
        }
      }
    }
    const tool_calls = toolAcc.size ? assembleToolCalls(toolAcc) : undefined;
    return { role: 'assistant', content: content || null, ...(tool_calls ? { tool_calls } : {}) };
  }
}
```

- [ ] **Step 3: Typecheck** `cd be && pnpm build` → succeeds.

- [ ] **Step 4: Commit**

```bash
git add be/src/agent/openrouter.client.ts be/src/config/config.service.ts
git commit -m "feat(be): OpenRouter streaming client + config"
```

### Task D9: Tool handlers service

**Files:** Create `be/src/agent/agent-tools.service.ts`

This wires each tool name to a concrete handler over existing services. Reuses: `NAVY_EVM` (balances), `OrdersService.listForPayer`, `FarmingService.getPosition/deposit/withdraw`, `TransferService.buildAuthorization`, `UserService.resolveUsername`, `spendingSeries`.

- [ ] **Step 1: Implement**

```ts
// be/src/agent/agent-tools.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { NAVY_EVM, type NavyEvm } from '../evm/evm.module';
import { OrdersService } from '../payments/orders.service';
import { FarmingService } from '../farming/farming.service';
import { TransferService } from '../transfer/transfer.service';
import { UserService } from '../user/user.service';
import { spendingSeries } from './analytics';
import type { ToolHandlers } from './types';

@Injectable()
export class AgentToolsService {
  constructor(
    @Inject(NAVY_EVM) private readonly chain: NavyEvm,
    private readonly orders: OrdersService,
    private readonly farming: FarmingService,
    private readonly transfers: TransferService,
    private readonly users: UserService,
  ) {}

  /** Build the handler map bound to one authenticated user. */
  forUser(userId: string, walletAddress: string): ToolHandlers {
    return {
      get_portfolio: async () => {
        const [ethWei, usdc] = await Promise.all([
          this.chain.provider.getBalance(walletAddress),
          this.chain.usdc.balanceOf(walletAddress) as Promise<bigint>,
        ]);
        let farming: any = null;
        try { farming = await this.farming.getPosition(userId); } catch { /* no subwallet yet */ }
        return { display: { kind: 'card' }, usdcBase: usdc.toString(), ethWei: ethWei.toString(), farming };
      },
      get_payment_history: async (a) => {
        const limit = typeof a.limit === 'number' ? Math.min(a.limit, 50) : 20;
        const list = await this.orders.listForPayer(walletAddress, { take: limit, skip: 0 });
        return { display: { kind: 'card' }, orders: list };
      },
      get_farming_summary: async () => {
        let position: any = null;
        try { position = await this.farming.getPosition(userId); } catch { /* none */ }
        return { display: { kind: 'card' }, position };
      },
      get_spending_analytics: async (a) => {
        const period = (a.period as any) ?? 'day';
        const list: any[] = await this.orders.listForPayer(walletAddress, { take: 200, skip: 0 });
        const orders = list.map((o) => ({ amount: o.amount, createdAt: new Date(o.createdAt ?? o.paidAt ?? Date.now()), status: o.status }));
        const series = spendingSeries(orders, period);
        return { display: { kind: 'chart', chartType: 'bar' }, ...series };
      },
      resolve_recipient: async (a) => {
        const r = await this.users.resolveUsername(String(a.recipient));
        if (r) return { display: { kind: 'card' }, ...r };
        // fall through to address parse handled client-side; report unresolved
        return { display: { kind: 'card' }, address: null, note: 'not a known @username; treat as raw address if it is 0x…' };
      },
      build_transfer: async (a) => {
        const res = await this.transfers.buildAuthorization(userId, walletAddress, String(a.recipient), BigInt(String(a.amountBase)));
        return { display: { kind: 'action', action: 'transfer' }, ...res };
      },
      build_farming_deposit: async (a) => {
        return { display: { kind: 'action', action: 'farming_deposit' }, amountBase: String(a.amountBase) };
      },
      build_farming_withdraw: async (a) => {
        return { display: { kind: 'action', action: 'farming_withdraw' }, amount: String(a.amount) };
      },
    };
  }
}
```

> Note: `build_farming_deposit/withdraw` return a *proposal* only; the app calls the existing `/farming/deposit` `/farming/withdraw` endpoints after user confirmation (no signature needed — the subwallet signs server-side). `build_transfer` returns typed data the app signs.

- [ ] **Step 2: Typecheck** `cd be && pnpm build` → succeeds (verify `OrdersService.listForPayer` return shape; adapt field access if needed).

- [ ] **Step 3: Commit**

```bash
git add be/src/agent/agent-tools.service.ts
git commit -m "feat(be): agent tool handlers over existing services"
```

### Task D10: Conversation persistence service

**Files:** Create `be/src/agent/conversation.service.ts`

- [ ] **Step 1: Implement**

```ts
// be/src/agent/conversation.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { ChatMessage } from './types';

@Injectable()
export class ConversationService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreate(userId: string, conversationId?: string) {
    if (conversationId) {
      const c = await this.prisma.agentConversation.findUnique({ where: { id: conversationId } });
      if (!c || c.userId !== userId) throw new BadRequestException('Conversation not found');
      return c;
    }
    return this.prisma.agentConversation.create({ data: { userId } });
  }

  /** Load prior messages as ChatMessage[] (oldest first). */
  async history(conversationId: string): Promise<ChatMessage[]> {
    const rows = await this.prisma.agentMessage.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } });
    return rows.map((r) => {
      if (r.role === 'tool') return { role: 'tool', tool_call_id: r.toolCallId!, content: r.content ?? '' };
      if (r.role === 'assistant') return { role: 'assistant', content: r.content, tool_calls: (r.toolCalls as any) ?? undefined };
      return { role: r.role as 'system' | 'user', content: r.content ?? '' };
    });
  }

  async append(conversationId: string, m: ChatMessage) {
    await this.prisma.agentMessage.create({
      data: {
        conversationId,
        role: m.role,
        content: 'content' in m ? m.content ?? null : null,
        toolCalls: m.role === 'assistant' && m.tool_calls ? (m.tool_calls as any) : undefined,
        toolCallId: m.role === 'tool' ? m.tool_call_id : undefined,
      },
    });
    await this.prisma.agentConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
  }

  listForUser(userId: string) {
    return this.prisma.agentConversation.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' }, take: 30 });
  }
}
```

- [ ] **Step 2: Typecheck + commit**

Run `cd be && pnpm build` → succeeds.

```bash
git add be/src/agent/conversation.service.ts
git commit -m "feat(be): agent conversation persistence"
```

### Task D11: Agent service (glue) + system prompt

**Files:** Create `be/src/agent/agent.service.ts`

- [ ] **Step 1: Implement** — loads history, trims, runs the loop with a streaming `callModel` (each round emits tokens + tool events through a sink), and persists new messages.

```ts
// be/src/agent/agent.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { NavyConfigService } from '../config/config.service';
import { ConversationService } from './conversation.service';
import { AgentToolsService } from './agent-tools.service';
import { OpenRouterClient } from './openrouter.client';
import { runAgentLoop } from './agent-loop';
import { dispatchTool } from './tool-dispatch';
import { trimMessages } from './context-window';
import { TOOLS } from './tool-schemas';
import type { ChatMessage } from './types';

const SYSTEM_PROMPT = `You are Navy Assistant, an in-wallet AI for a USDC payment wallet on Ethereum Sepolia.
You can read the user's balances, payment history, and farming position, and you can PROPOSE actions:
sending USDC (gasless) and farming deposits/withdrawals. You NEVER move funds yourself — every action tool
returns a proposal the user must confirm and sign in the app. Amounts are USDC base units (6 decimals):
1 USDC = 1000000. Use get_portfolio before proposing a transfer or deposit if you are unsure of the balance.
Be concise. Never claim a transfer or deposit has happened — only that a proposal is ready to confirm.`;

/** A sink the controller provides to forward streaming events to the HTTP response. */
export interface StreamSink {
  token: (t: string) => void;
  toolStart: (name: string) => void;
  toolResult: (name: string, result: unknown) => void;
}

@Injectable()
export class AgentService {
  private readonly client: OpenRouterClient;
  constructor(
    private readonly cfg: NavyConfigService,
    private readonly conversations: ConversationService,
    private readonly tools: AgentToolsService,
  ) {
    this.client = new OpenRouterClient({ apiKey: cfg.openRouterApiKey, model: cfg.openRouterModel, baseUrl: cfg.openRouterBaseUrl });
  }

  /** Run one user turn; returns the conversationId. Streams via the sink. */
  async chat(userId: string, walletAddress: string, userText: string, conversationId: string | undefined, sink: StreamSink): Promise<string> {
    const convo = await this.conversations.getOrCreate(userId, conversationId);
    const prior = await this.conversations.history(convo.id);

    const base: ChatMessage[] = prior.length && prior[0].role === 'system'
      ? prior
      : [{ role: 'system', content: SYSTEM_PROMPT }, ...prior];
    const userMsg: ChatMessage = { role: 'user', content: userText };
    const seed = trimMessages([...base, userMsg], this.cfg.agentContextTokenBudget);

    await this.conversations.append(convo.id, userMsg);
    if (prior.length === 0) await this.conversations.append(convo.id, { role: 'system', content: SYSTEM_PROMPT });

    const handlers = this.tools.forUser(userId, walletAddress);
    const priorLen = seed.length;

    const finalMessages = await runAgentLoop({
      messages: seed,
      maxIterations: this.cfg.agentMaxIterations,
      callModel: (messages) => this.client.streamChat(messages, TOOLS, sink.token),
      runTool: async (name, argsJson) => {
        sink.toolStart(name);
        const result = await dispatchTool(name, argsJson, handlers);
        sink.toolResult(name, result);
        return result;
      },
    });

    // Persist everything produced this turn (skip the seed we already had).
    for (const m of finalMessages.slice(priorLen)) await this.conversations.append(convo.id, m);
    return convo.id;
  }
}
```

- [ ] **Step 2: Typecheck + commit**

Run `cd be && pnpm build` → succeeds.

```bash
git add be/src/agent/agent.service.ts
git commit -m "feat(be): agent orchestration service + system prompt"
```

### Task D12: Agent controller (SSE) + module + app wiring

**Files:** Create `be/src/agent/agent.controller.ts`, `be/src/agent/agent.module.ts`; Modify `be/src/app.module.ts`

- [ ] **Step 1: Controller** — SSE via a raw `Res` response (write `event:`/`data:` frames).

```ts
// be/src/agent/agent.controller.ts
import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AgentService, type StreamSink } from './agent.service';
import { ConversationService } from './conversation.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, IsNotEmpty, MaxLength } from 'class-validator';

class ChatDto {
  @IsString() @IsNotEmpty() @MaxLength(2000) message!: string;
  @IsOptional() @IsString() conversationId?: string;
}

@Controller('agent')
@UseGuards(JwtGuard, RolesGuard)
@Roles('user')
export class AgentController {
  constructor(private readonly agent: AgentService, private readonly conversations: ConversationService) {}

  @Post('chat')
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async chat(@Req() req: any, @Body() dto: ChatDto, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const sink: StreamSink = {
      token: (t) => send('token', { delta: t }),
      toolStart: (name) => send('tool_start', { name }),
      toolResult: (name, result) => send('tool_result', { name, result }),
    };
    try {
      const conversationId = await this.agent.chat(req.user.sub, req.user.walletAddress, dto.message, dto.conversationId, sink);
      send('done', { conversationId });
    } catch (e) {
      send('error', { message: (e as Error).message || 'assistant error' });
    } finally {
      res.end();
    }
  }

  @Get('conversations')
  list(@Req() req: any) { return this.conversations.listForUser(req.user.sub); }

  @Get('conversations/:id')
  async one(@Req() req: any, @Param('id') id: string) {
    await this.conversations.getOrCreate(req.user.sub, id); // authorizes ownership
    return this.conversations.history(id);
  }
}
```

- [ ] **Step 2: Module**

```ts
// be/src/agent/agent.module.ts
import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { AgentToolsService } from './agent-tools.service';
import { ConversationService } from './conversation.service';
import { PaymentsModule } from '../payments/payments.module';
import { FarmingModule } from '../farming/farming.module';
import { TransferModule } from '../transfer/transfer.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [PaymentsModule, FarmingModule, TransferModule, UserModule],
  controllers: [AgentController],
  providers: [AgentService, AgentToolsService, ConversationService],
})
export class AgentModule {}
```

> Ensure `PaymentsModule` exports `OrdersService`, `FarmingModule` exports `FarmingService`, `TransferModule` exports `TransferService`, `UserModule` exports `UserService`. Add to their `exports` arrays if missing.

- [ ] **Step 3: Register `AgentModule`** in `be/src/app.module.ts` imports.

- [ ] **Step 4: Set env** in `be/.env`: `OPENROUTER_API_KEY=...`, optionally `OPENROUTER_MODEL=...`.

- [ ] **Step 5: Typecheck + boot smoke**

Run: `cd be && pnpm build` → succeeds. Then `pnpm start` and confirm no DI errors at boot.

- [ ] **Step 6: Commit**

```bash
git add be/src/agent/agent.controller.ts be/src/agent/agent.module.ts be/src/app.module.ts
git commit -m "feat(be): agent SSE controller + module wiring"
```

---

## Phase E — Expo Assistant chat

### Task E1: Transfer REST client + flow (app)

**Files:** Create `src/lib/transfer/transferClient.ts`, `src/lib/transfer/transferFlow.ts`; Tests alongside.

- [ ] **Step 1: Write the failing test for the flow**

```ts
// expo-wallet/src/lib/transfer/transferFlow.test.ts
import { runTransferFlow } from './transferFlow';

describe('runTransferFlow', () => {
  it('builds, signs the typed data, then submits and returns the result', async () => {
    const client = {
      build: jest.fn(async () => ({ transferId: 't1', typedData: { domain: {}, types: {}, primaryType: 'TransferWithAuthorization', message: {} }, recipient: { address: '0xabc', username: 'linh' }, amount: '1000000' })),
      submit: jest.fn(async () => ({ txHash: '0xhash', status: 'confirmed' })),
    };
    const signTypedData = jest.fn(async () => '0xsig');
    const out = await runTransferFlow(client as any, signTypedData, { recipient: '@linh', amountBase: '1000000' });
    expect(client.build).toHaveBeenCalledWith('@linh', '1000000');
    expect(signTypedData).toHaveBeenCalled();
    expect(client.submit).toHaveBeenCalledWith('t1', '0xsig');
    expect(out).toEqual({ txHash: '0xhash', status: 'confirmed', recipient: { address: '0xabc', username: 'linh' }, amount: '1000000' });
  });
});
```

- [ ] **Step 2: Run** `cd expo-wallet && pnpm test transferFlow.test` → FAIL.

- [ ] **Step 3: Implement client + flow**

```ts
// expo-wallet/src/lib/transfer/transferClient.ts
import type { Eip712TypedData } from '@/lib/pay/navyPayClient';

export interface TransferBuildResult {
  transferId: string;
  typedData: Eip712TypedData;
  recipient: { address: string; username: string | null };
  amount: string;
}

export class TransferClient {
  constructor(
    private readonly baseUrl: string,
    private readonly authedFetch: (url: string, init?: RequestInit) => Promise<Response>,
  ) {}
  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.authedFetch(`${this.baseUrl}${path}`, {
      ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`transfer ${path} failed (${res.status})`);
    return (await res.json()) as T;
  }
  build(recipient: string, amountBase: string) {
    return this.json<TransferBuildResult>('/transfer/authorization', { method: 'POST', body: JSON.stringify({ recipient, amountBase }) });
  }
  submit(transferId: string, signature: string) {
    return this.json<{ txHash: string; status: string }>('/transfer/submit', { method: 'POST', body: JSON.stringify({ transferId, signature }) });
  }
}
```

```ts
// expo-wallet/src/lib/transfer/transferFlow.ts
import type { TransferClient } from './transferClient';
import type { Eip712TypedData } from '@/lib/pay/navyPayClient';

export interface TransferFlowInput { recipient: string; amountBase: string }
export interface TransferFlowResult { txHash: string; status: string; recipient: { address: string; username: string | null }; amount: string }

/** build → sign the EIP-712 typed data → submit. Pure orchestration (signer + client injected). */
export async function runTransferFlow(
  client: Pick<TransferClient, 'build' | 'submit'>,
  signTypedData: (td: Eip712TypedData) => Promise<string>,
  input: TransferFlowInput,
): Promise<TransferFlowResult> {
  const built = await client.build(input.recipient, input.amountBase);
  const signature = await signTypedData(built.typedData);
  const res = await client.submit(built.transferId, signature);
  return { txHash: res.txHash, status: res.status, recipient: built.recipient, amount: built.amount };
}
```

- [ ] **Step 4: Run** `cd expo-wallet && pnpm test transferFlow.test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add expo-wallet/src/lib/transfer/
git commit -m "feat(expo): transfer client + build/sign/submit flow"
```

### Task E2: Pure SSE parser

**Files:** Create `src/lib/agent/sseParser.ts`; Test alongside.

- [ ] **Step 1: Write the failing test**

```ts
// expo-wallet/src/lib/agent/sseParser.test.ts
import { SseParser } from './sseParser';

describe('SseParser', () => {
  it('emits complete event/data frames as chunks arrive', () => {
    const p = new SseParser();
    const events: any[] = [];
    p.push('event: token\ndata: {"delta":"Hel', (e) => events.push(e));
    expect(events).toEqual([]); // incomplete
    p.push('lo"}\n\nevent: done\ndata: {"conversationId":"c1"}\n\n', (e) => events.push(e));
    expect(events).toEqual([
      { event: 'token', data: { delta: 'Hello' } },
      { event: 'done', data: { conversationId: 'c1' } },
    ]);
  });
});
```

- [ ] **Step 2: Run** `cd expo-wallet && pnpm test sseParser.test` → FAIL.

- [ ] **Step 3: Implement**

```ts
// expo-wallet/src/lib/agent/sseParser.ts
export interface SseEvent { event: string; data: any }

/** Incremental SSE frame parser: feed it raw text chunks, get parsed {event,data} frames. */
export class SseParser {
  private buffer = '';
  push(chunk: string, emit: (e: SseEvent) => void): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n\n')) !== -1) {
      const frame = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      let event = 'message';
      const dataLines: string[] = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length === 0) continue;
      try { emit({ event, data: JSON.parse(dataLines.join('\n')) }); } catch { /* skip malformed */ }
    }
  }
}
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add expo-wallet/src/lib/agent/sseParser.ts expo-wallet/src/lib/agent/sseParser.test.ts
git commit -m "feat(expo): incremental SSE parser"
```

### Task E3: Pure chat reducer

**Files:** Create `src/lib/agent/chatReducer.ts`; Test alongside.

- [ ] **Step 1: Write the failing test**

```ts
// expo-wallet/src/lib/agent/chatReducer.test.ts
import { chatReducer, initialChat, ChatAction } from './chatReducer';

function apply(actions: ChatAction[]) { return actions.reduce(chatReducer, initialChat()); }

describe('chatReducer', () => {
  it('appends a user message and an empty streaming assistant bubble', () => {
    const s = apply([{ type: 'send', text: 'hi' }]);
    expect(s.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(s.streaming).toBe(true);
  });
  it('accumulates token deltas into the assistant bubble', () => {
    const s = apply([{ type: 'send', text: 'hi' }, { type: 'token', delta: 'He' }, { type: 'token', delta: 'llo' }]);
    const last = s.messages[s.messages.length - 1];
    expect(last.role === 'assistant' && last.text).toBe('Hello');
  });
  it('records a tool chip on tool_start and its result on tool_result', () => {
    const s = apply([
      { type: 'send', text: 'x' },
      { type: 'tool_start', name: 'get_portfolio' },
      { type: 'tool_result', name: 'get_portfolio', result: { display: { kind: 'card' }, usdcBase: '100' } },
    ]);
    expect(s.messages.some((m) => m.role === 'tool' && m.name === 'get_portfolio' && m.result)).toBe(true);
  });
  it('marks streaming false on done', () => {
    const s = apply([{ type: 'send', text: 'x' }, { type: 'done', conversationId: 'c1' }]);
    expect(s.streaming).toBe(false);
    expect(s.conversationId).toBe('c1');
  });
});
```

- [ ] **Step 2: Run** `cd expo-wallet && pnpm test chatReducer.test` → FAIL.

- [ ] **Step 3: Implement**

```ts
// expo-wallet/src/lib/agent/chatReducer.ts
export type ChatMessageVM =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string }
  | { role: 'tool'; name: string; result?: any };

export interface ChatState {
  messages: ChatMessageVM[];
  streaming: boolean;
  conversationId?: string;
  error?: string;
}

export type ChatAction =
  | { type: 'send'; text: string }
  | { type: 'token'; delta: string }
  | { type: 'tool_start'; name: string }
  | { type: 'tool_result'; name: string; result: any }
  | { type: 'done'; conversationId?: string }
  | { type: 'error'; message: string };

export function initialChat(): ChatState { return { messages: [], streaming: false }; }

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'send':
      return { ...state, streaming: true, error: undefined,
        messages: [...state.messages, { role: 'user', text: action.text }, { role: 'assistant', text: '' }] };
    case 'token': {
      const msgs = [...state.messages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'assistant') { msgs[i] = { role: 'assistant', text: (msgs[i] as any).text + action.delta }; break; }
      }
      return { ...state, messages: msgs };
    }
    case 'tool_start': {
      // insert the tool chip BEFORE the trailing streaming assistant bubble
      const msgs = [...state.messages];
      const insertAt = msgs.length - 1; // before the assistant bubble
      msgs.splice(Math.max(insertAt, 0), 0, { role: 'tool', name: action.name });
      return { ...state, messages: msgs };
    }
    case 'tool_result': {
      const msgs = [...state.messages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'tool' && (msgs[i] as any).name === action.name && !(msgs[i] as any).result) {
          msgs[i] = { role: 'tool', name: action.name, result: action.result }; break;
        }
      }
      return { ...state, messages: msgs };
    }
    case 'done':
      return { ...state, streaming: false, conversationId: action.conversationId ?? state.conversationId };
    case 'error':
      return { ...state, streaming: false, error: action.message };
    default:
      return state;
  }
}
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add expo-wallet/src/lib/agent/chatReducer.ts expo-wallet/src/lib/agent/chatReducer.test.ts
git commit -m "feat(expo): pure chat reducer (streaming, tool chips)"
```

### Task E4: Agent SSE client (expo/fetch streaming)

**Files:** Create `src/lib/agent/agentClient.ts`

- [ ] **Step 1: Implement** using `expo/fetch` (streaming body). Typecheck-verified (streaming I/O; the parsing is already unit-tested via `SseParser`).

```ts
// expo-wallet/src/lib/agent/agentClient.ts
import { fetch as expoFetch } from 'expo/fetch';
import { SseParser, type SseEvent } from './sseParser';

/** POST /agent/chat and stream SSE frames. Auth token attached by the caller-supplied header getter. */
export async function streamAgentChat(
  baseUrl: string,
  accessToken: string,
  body: { message: string; conversationId?: string },
  onEvent: (e: SseEvent) => void,
): Promise<void> {
  const res = await expoFetch(`${baseUrl}/agent/chat`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error(`agent chat failed (${res.status})`);
  const reader = (res.body as any).getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }), onEvent);
  }
}
```

> Verify against installed `expo` types that `expo/fetch` exposes a streaming `res.body.getReader()` on SDK 54 (per `expo-wallet/AGENTS.md`, check the `.d.ts`). If not available, fall back to `XMLHttpRequest` with `onprogress` feeding `parser.push`.

- [ ] **Step 2: Typecheck** `cd expo-wallet && pnpm exec tsc --noEmit` → no errors.

- [ ] **Step 3: Commit**

```bash
git add expo-wallet/src/lib/agent/agentClient.ts
git commit -m "feat(expo): streaming agent SSE client"
```

### Task E5: Tool-result renderers

**Files:** Create `src/features/assistant/PortfolioCard.tsx`, `ChartCard.tsx`, `TransferConfirmCard.tsx`, `FarmingConfirmCard.tsx`

- [ ] **Step 1: Implement the renderers** (Navy theme; typecheck-verified). Each takes the tool `result` object.
  - `PortfolioCard` — renders `usdcBase`/`ethWei`/`farming` from `get_portfolio`/`get_farming_summary` results using `usdcBaseToDisplay`/`weiToEth` from `@/lib/wallet/balances`.
  - `ChartCard` — takes `{ labels, values, chartType }`; draws bars/line with `react-native-svg` (already a dep). Keep it a simple bar chart scaled to the max value.
  - `TransferConfirmCard` — props `{ result }` where `result` has `{ transferId, typedData, recipient, amount }`; shows recipient (@username · short address) + amount + "Gasless · $0.00 fee" + a `SlideToConfirm`. On confirm it calls a passed `onConfirm()`.
  - `FarmingConfirmCard` — shows the proposed deposit/withdraw amount + `SlideToConfirm`, calls `onConfirm()`.

Example (TransferConfirmCard skeleton — mirror Option A from the design):

```tsx
// expo-wallet/src/features/assistant/TransferConfirmCard.tsx
import React, { useState } from 'react';
import { View } from 'react-native';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { SlideToConfirm } from '@/ui/SlideToConfirm';
import { usdcBaseToDisplay } from '@/lib/wallet/balances';
import { short } from '@/lib/wallet/identicon';
import { colors, space } from '@/ui/theme';

export function TransferConfirmCard({ result, onConfirm }: { result: any; onConfirm: () => Promise<void> }) {
  const [status, setStatus] = useState<'idle' | 'signing' | 'done' | 'error'>('idle');
  const r = result.recipient ?? {};
  const label = r.username ? `@${r.username} · ${short(r.address)}` : short(r.address);
  const go = async () => { setStatus('signing'); try { await onConfirm(); setStatus('done'); } catch { setStatus('error'); } };
  return (
    <Card style={{ borderColor: colors.accent, borderWidth: 1, gap: space.sm }}>
      <Text variant="label" upper color={colors.textMute}>Confirm transfer · gasless</Text>
      <Text variant="body" color={colors.text}>To {label}</Text>
      <Text variant="h2" color={colors.textHi}>{usdcBaseToDisplay(result.amount)} USDC</Text>
      <Text variant="caption" muted>Network fee $0.00 (relayed) · you sign, the assistant never moves funds</Text>
      {status === 'done' ? <Text variant="bodyStrong" color={colors.aqua}>Sent ✓</Text>
        : status === 'error' ? <Text variant="bodyStrong" color={colors.danger}>Failed — try again</Text>
        : <SlideToConfirm label="Slide to sign" onConfirm={go} />}
    </Card>
  );
}
```

> Check `SlideToConfirm`'s actual prop names in `src/ui/SlideToConfirm.tsx` and adapt (`label`/`onConfirm` may differ).

- [ ] **Step 2: Typecheck** `cd expo-wallet && pnpm exec tsc --noEmit` → no errors.

- [ ] **Step 3: Commit**

```bash
git add expo-wallet/src/features/assistant/
git commit -m "feat(expo): assistant tool-result renderers"
```

### Task E6: Assistant tab + screen

**Files:** Create `app/(tabs)/assistant.tsx`; Modify `app/(tabs)/_layout.tsx`

- [ ] **Step 1: Add the tab** in `_layout.tsx` — a `<Tabs.Screen name="assistant" options={{ title: 'Assistant', tabBarIcon: ({color,size}) => <Icon name="..." color={color} size={size} /> }} />` (pick an existing `IconName` such as a sparkle/chat glyph; check `src/ui/Icon.tsx` for available names — reuse a suitable one). Place it before Settings.

- [ ] **Step 2: Build the chat screen** wiring the pieces:
  - `useReducer(chatReducer, undefined, initialChat)`.
  - Input box + send button → `dispatch({type:'send', text})` then `streamAgentChat(getEnv().navyApiUrl, token, { message, conversationId }, (e) => dispatchFromEvent(e))`.
  - Map SSE events to reducer actions: `token`→`token`, `tool_start`→`tool_start`, `tool_result`→`tool_result`, `done`→`done`, `error`→`error`.
  - Render `state.messages`: `user`/`assistant` bubbles; `tool` messages render via a `<ToolMessage>` that switches on `result.display`:
    - `display.kind==='card'` + portfolio-shaped → `<PortfolioCard>`.
    - `display.kind==='chart'` → `<ChartCard>`.
    - `display.kind==='action' && action==='transfer'` → `<TransferConfirmCard result={result} onConfirm={...}>` where `onConfirm` runs `runTransferFlow(new TransferClient(base, authedFetch), signTypedData, { recipient: result.recipient.address, amountBase: result.amount })` — but since the backend already built+persisted the authorization, instead sign `result.typedData` directly via `useMobileSigner().signTypedData` and call `TransferClient.submit(result.transferId, signature)`. (Use `submit` directly — do NOT re-`build`, the proposal already exists.)
    - `display.kind==='action' && action==='farming_deposit'|'farming_withdraw'` → `<FarmingConfirmCard>` whose `onConfirm` calls `FarmingClient.deposit(token, result.amountBase)` / `.withdraw(token, result.amount)`.
  - While `state.streaming`, show a typing indicator on the trailing assistant bubble.

> Because the transfer authorization is already built server-side by `build_transfer`, the confirm path is: `signTypedData(result.typedData)` → `transferClient.submit(result.transferId, signature)`. Keep `runTransferFlow` for any future app-initiated (non-agent) transfer entry point.

- [ ] **Step 3: Typecheck** `cd expo-wallet && pnpm exec tsc --noEmit` → no errors.

- [ ] **Step 4: Commit**

```bash
git add expo-wallet/app/(tabs)/assistant.tsx expo-wallet/app/(tabs)/_layout.tsx
git commit -m "feat(expo): Assistant tab + streaming chat screen"
```

---

## Phase F — Verification with a free OpenRouter model

### Task F1: Free-model tool-calling proof script

**Files:** Create `be/scripts/agent-e2e.mjs`

- [ ] **Step 1: Implement** a standalone script that calls OpenRouter directly with the real `TOOLS` array and asserts the free model actually returns `tool_calls` for a wallet question — proving tool-calling works on the chosen free model before running the full app.

```js
// be/scripts/agent-e2e.mjs  (run: node be/scripts/agent-e2e.mjs)
import 'dotenv/config';

const key = process.env.OPENROUTER_API_KEY;
const model = process.env.OPENROUTER_FREE_MODEL || 'google/gemini-2.0-flash-exp:free';
const base = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

const tools = [
  { type: 'function', function: { name: 'get_portfolio', description: "Get the user's USDC + ETH balances and farming position.", parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'build_transfer', description: 'Build a gasless USDC transfer proposal. amountBase is base units (6 decimals).', parameters: { type: 'object', properties: { recipient: { type: 'string' }, amountBase: { type: 'string' } }, required: ['recipient', 'amountBase'], additionalProperties: false } } },
];

async function ask(message) {
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, tools, tool_choice: 'auto', messages: [
      { role: 'system', content: 'You are a wallet assistant. Use tools; amounts are base units (1 USDC = 1000000).' },
      { role: 'user', content: message },
    ] }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return (await res.json()).choices[0].message;
}

const m1 = await ask("What's my balance?");
if (!m1.tool_calls?.some((t) => t.function.name === 'get_portfolio')) throw new Error('expected get_portfolio tool_call, got: ' + JSON.stringify(m1));
console.log('OK get_portfolio tool_call produced');

const m2 = await ask('Send 5 USDC to @linh');
const bt = m2.tool_calls?.find((t) => t.function.name === 'build_transfer');
if (!bt) throw new Error('expected build_transfer tool_call, got: ' + JSON.stringify(m2));
const args = JSON.parse(bt.function.arguments);
if (args.amountBase !== '5000000') console.warn('WARN model amountBase =', args.amountBase, '(expected 5000000 — check system prompt clarity)');
console.log('OK build_transfer tool_call produced:', args);
console.log('Free model', model, 'supports tool-calling ✓');
```

- [ ] **Step 2: Run**

Run: `cd be && OPENROUTER_API_KEY=... OPENROUTER_FREE_MODEL=google/gemini-2.0-flash-exp:free node scripts/agent-e2e.mjs`
Expected: prints both `OK ... tool_call produced` lines. If the free model does not support tools (error or no `tool_calls`), pick another free tool-capable model from `https://openrouter.ai/models?supported_parameters=tools&max_price=0` and re-run.

- [ ] **Step 3: Commit**

```bash
git add be/scripts/agent-e2e.mjs
git commit -m "test(be): free-model OpenRouter tool-calling proof"
```

### Task F2: End-to-end app smoke (free model)

- [ ] **Step 1: Configure** `be/.env` with `OPENROUTER_API_KEY` and `OPENROUTER_MODEL=<free tool-capable model>` (the one proven in F1). Start `pnpm start` (be) with Postgres up + relayer funded.

- [ ] **Step 2: Run the app** (EAS dev client per `expo-wallet/AGENTS.md`), log in, open the **Assistant** tab, and verify each path:
  - "What's my balance?" → a `get_portfolio` tool chip appears, then a `PortfolioCard`, then a prose summary streams in.
  - "Show my spending" → `get_spending_analytics` chip → a `ChartCard` bar chart.
  - "Send 1 USDC to @<your test handle>" → a `TransferConfirmCard` appears → slide to sign (Privy) → submits → shows Sent ✓, and the recipient's on-chain USDC balance increases.
  - "Deposit 1 USDC to farming" → `FarmingConfirmCard` → confirm → `/farming/deposit` succeeds.

- [ ] **Step 3: Confirm streaming + persistence** — reload the app, reopen the Assistant, and verify the conversation reloads from `GET /agent/conversations`.

- [ ] **Step 4: Record results** — note the free model used and any tool-arg quirks (e.g. base-unit mistakes) in `be/scripts/gateway-bringup.md` under a new "AI Assistant bring-up" section.

- [ ] **Step 5: Commit** (docs only)

```bash
git add be/scripts/gateway-bringup.md
git commit -m "docs(be): AI Assistant bring-up + free-model verification notes"
```

---

## Verification (whole plan)

- [ ] `cd be && pnpm test` — all agent unit tests (schemas, dispatch, loop, context-window, analytics) pass.
- [ ] `cd be && pnpm build` — typechecks; `pnpm start` boots with no DI errors.
- [ ] `cd be && node scripts/agent-e2e.mjs` — free model produces `get_portfolio` + `build_transfer` tool calls.
- [ ] `cd expo-wallet && pnpm test && pnpm exec tsc --noEmit` — pass.
- [ ] Manual app smoke (Task F2) — portfolio, chart, transfer sign+submit, farming deposit all work against the free model.

## Self-Review notes (addressed)

- **Spec coverage:** Assistant tab ✓; OpenRouter tool loop server-side ✓; SSE streaming ✓; DB-persisted conversations ✓; tools-only wallet state ✓; read tools (portfolio/history/farming/analytics/resolve) ✓; action tools (transfer/farming deposit/withdraw) as proposals signed by the human ✓; server-computed charts (no render_chart tool) ✓; context trimming + iteration cap + rate limit ✓; inline confirm card (Option A) ✓; free-model verification ✓.
- **Type consistency:** `ChatMessage`/`ToolCall`/`ToolResult`/`ToolDisplay` shared across loop, dispatch, handlers, controller; `TransferBuildResult`/`runTransferFlow` match Plan 1's `TransferService` return shape (`{transferId, typedData, recipient, amount}`); reducer actions match the SSE event names emitted by the controller (`token`/`tool_start`/`tool_result`/`done`/`error`).
- **Deferred/uncertain:** free-model availability changes over time — the plan links the live filter list rather than hard-coding a model that may vanish; `expo/fetch` streaming is verified against installed SDK-54 types with an XHR fallback noted.
```
