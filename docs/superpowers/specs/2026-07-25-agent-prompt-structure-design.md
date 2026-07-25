# Design: Modular agent prompt & tool-description structure

**Date:** 2026-07-25
**Status:** Approved (design)
**Area:** `be/src/agent` — the in-wallet AI assistant
**Related:** `docs/superpowers/specs/2026-07-22-navy-ai-assistant-design.md`

## Problem

The assistant's model-facing text currently lives as inline template literals:

- `be/src/agent/prompt.ts` — the system prompt (`BASE`) plus two conditional blocks (`FARMING_BLOCK`, `MARKET_BLOCK`), `buildSystemPrompt()`, and `detectPromptContext()`, all in one 82-line file.
- `be/src/agent/tool-schemas.ts` — 10 tools whose long, model-facing `description` strings sit inline next to their JSON-schema `parameters`.

This mixes prose that we tune often (what the model is told) with machine contracts we change rarely (parameter schemas), in files that will keep growing as tools and rules are added. It is harder than it should be to audit "what exactly does the assistant tell the model" and to add a new rule, a new conditional context block, or a new tool without editing a large monolithic file.

## Goal

Move the model-facing text into small, single-purpose files under one folder, so it is easy to **audit** (read one thing in one place), **scale** (add a fragment/tool without touching a monolith), and **edit in the future** (a documented convention anyone can follow). Do this **without changing runtime behavior or the build**.

## Non-goals

- No change to the composed prompt's meaning. The assembled system prompt stays semantically identical to what is live today, so the already-verified E2E behavior is unchanged.
- No build/runtime machinery. Fragments are plain TypeScript string modules imported normally — no `fs` reads, no `nest-cli.json` asset-copy rule, no `dist` path resolution. (Real-`.md`-at-runtime and md→codegen were considered and rejected for this reason.)
- No reorganization of the rest of `be/src/agent` (loop, dispatch, conversation, controller). Out of scope.
- No change to `amount-guard.ts`, `context-window.ts`, `analytics.ts`, or the tool handlers.

## Approach

Chosen format: **one `.ts` file per fragment, each exporting a plain string constant**, composed by code. This keeps everything type-checked and unit-testable as ordinary imports, with zero build or runtime risk. (Alternatives — literal `.md` read at runtime, or `.md` authored + codegen to `.ts` — were rejected: both add path-resolution/asset-copy or a codegen step that can drift, for no behavioral gain.)

Chosen scope: **system prompt + tool descriptions + a README** documenting the convention.

## Target structure

```
be/src/agent/prompt/
  README.md            # the convention (see below)
  index.ts             # public API: buildSystemPrompt(ctx), detectPromptContext(), PromptContext
  base.ts              # identity paragraph
  invariants.ts        # the IMPORTANT hard-rules block (never moves funds, never invent amounts, ...)
  tool-routing.ts      # the "which tool" decision table
  discipline.ts        # tool-use discipline + sending-money rules
  format-tone.ts       # answering / format / tone rules
  detect-context.ts    # keyword + prior-tool signals -> { farming, market }
  context/
    farming.ts         # appended only when farming is in play
    market.ts          # appended only when market/token is in play
  tools/               # one card per tool: { name, description } (model-facing "when to use" prose)
    get-portfolio.ts
    get-payment-history.ts
    get-farming-summary.ts
    get-spending-analytics.ts
    resolve-recipient.ts
    build-transfer.ts
    build-farming-deposit.ts
    build-farming-withdraw.ts
    get-token-info.ts
    get-top-coins.ts
  prompt.spec.ts       # moved here; imports fragments + asserts composition
```

`be/src/agent/prompt.ts` is deleted; `be/src/agent/prompt.spec.ts` moves into the folder.

## Components & responsibilities

- **`base.ts`, `invariants.ts`, `tool-routing.ts`, `discipline.ts`, `format-tone.ts`** — each exports one `const` string holding exactly the section it names. Concatenated in this order they reproduce the current `BASE` prompt verbatim (same text, split at section boundaries).
- **`context/farming.ts`, `context/market.ts`** — each exports one `const` string; these are today's `FARMING_BLOCK` / `MARKET_BLOCK`, unchanged.
- **`detect-context.ts`** — exports the `PromptContext` interface and `detectPromptContext(userText, priorToolNames?) -> PromptContext`, moved verbatim from the current file (keyword regexes + prior-tool sets). `index.ts` re-exports `PromptContext` so consumers import both the type and the builders from `./prompt`.
- **`index.ts`** — the only file other modules import. Exports:
  - `PromptContext`
  - `buildSystemPrompt(ctx: PromptContext = {}): string` — joins the always-on fragments with `\n\n`, then appends `context/farming` when `ctx.farming` and `context/market` when `ctx.market` (identical logic to today).
  - `detectPromptContext` (re-export).
- **`tools/<tool>.ts`** — each exports a small object `{ name, description }` where `description` is the model-facing "use when…" prose currently inline in `tool-schemas.ts`. The `parameters` JSON-schema and `required`/`additionalProperties` stay in `tool-schemas.ts`.
- **`tool-schemas.ts`** — imports the 10 cards and assembles `TOOLS` by pairing each card's `name` + `description` with its `parameters`. `validateArgs`, `TOOL_NAMES`, and the exported `TOOLS` shape are unchanged. Consumers (`agent.service.ts`, `tool-dispatch.ts`) are untouched.

## Data flow (unchanged)

`agent.service.chat()` → `detectPromptContext(userText, priorToolNames)` → `buildSystemPrompt(ctx)` → injected as the fresh system message each turn → `runAgentLoop` with `TOOLS`. Only the *source* of the strings moves; the flow and the produced strings do not.

## Call-site impact

- `agent.service.ts`: import path changes from `'./prompt'` (file) to `'./prompt'` (folder index) — **no code change** (Node/TS resolve a folder's `index.ts` for the same specifier).
- `tool-schemas.ts`: gains 10 imports from `./prompt/tools/*`; its exported API is unchanged.
- Everything else: no change.

## Testing

- **`prompt/prompt.spec.ts`** (moved): keeps the existing `buildSystemPrompt` / `detectPromptContext` assertions (base contains identity + invariants; blocks appended only when flagged; detection from message + prior tools). Add one assertion that the composed base contains each section's signature phrase, so an accidentally-dropped fragment fails a test.
- **`tool-schemas.spec.ts`** (unchanged): still asserts 10 tool names, valid function schemas, and `validateArgs` behavior — green because assembled schemas are identical.
- Gate: `pnpm test agent` and `pnpm build` must pass. No new E2E needed because the composed prompt and tool schemas are byte-for-byte equivalent to the current live version (verified by a one-off string-equality check during implementation, then discarded).

## README convention (`prompt/README.md`)

Documents, for future editors:
- Purpose: this folder is the single home for everything the assistant tells the model.
- Fragments are plain exported strings; `index.ts` composes them. Order matters (invariants first for weight, tone last).
- **Add an always-on rule:** create/edit a fragment `.ts`, include it in `index.ts`'s base list.
- **Add a conditional block:** add `context/<name>.ts`, append it in `buildSystemPrompt` under a new `PromptContext` flag, and add its trigger keywords/tools in `detect-context.ts`.
- **Add a tool:** add `tools/<tool>.ts` (`{ name, description }`), then pair it with a `parameters` schema in `tool-schemas.ts`.
- Rule of thumb: prose the model reads lives here; parameter contracts and handler logic do not.

## Risks & mitigations

- **Accidental prompt drift during the split.** Mitigation: assemble fragments to equal the current `BASE`/blocks exactly, checked once by string equality against the pre-refactor constants before deleting them.
- **Fragment omitted from `index.ts`.** Mitigation: the added signature-phrase test fails if a section is missing.
- **Folder-vs-file import ambiguity** (a stray `prompt.ts` left beside `prompt/`). Mitigation: delete `prompt.ts` in the same change; TS resolves the folder index cleanly once the file is gone.

## Rollout

Single mechanical change, no migration, no data or API impact. Revert = restore the two original files.
