# Agent prompt

This folder is the single home for everything the Navy assistant tells the model:
the system prompt (as composable fragments) and each tool's model-facing description.
Nothing here imports Nest or chain SDKs — it's plain strings, so it stays easy to audit
and unit-test.

## How the system prompt is built

`index.ts` exports `buildSystemPrompt(ctx)`. It joins the always-on fragments with blank
lines, in this order (order matters — invariants sit high because models weight early
tokens most; tone sits last):

1. `identity.ts` — who the assistant is
2. `invariants.ts` — absolute safety rules
3. `tool-routing.ts` — which tool for which intent
4. `discipline.ts` — tool-use + sending-money rules
5. `format-tone.ts` — output format and tone

Then it appends conditional detail blocks from `context/` only when the turn touches that
domain, decided by `detect-context.ts` (keyword match on the message + tools already used
this conversation). This keeps the always-loaded prompt small — "progressive disclosure".

## Tool descriptions

Each tool's model-facing "use when…" prose lives in `tools/<tool>.ts` as a `ToolCard`
(`{ name, description }`, typed by `tools/types.ts`). `tools/index.ts` re-exports them all,
and `../tool-schemas.ts` pairs each card with its `parameters` JSON-schema. `detect-context.ts`
derives its farming/market tool sets from the card `name`s, so tool names have one source of truth.

## How to change things

- **Edit a rule:** change the relevant fragment string. That's it.
- **Add an always-on section:** create `my-section.ts` exporting a string, then add it to the
  `BASE` array in `index.ts`.
- **Add a conditional block:** create `context/my-topic.ts`, add a flag to `PromptContext`
  in `detect-context.ts`, set that flag from keywords/tools in `detectPromptContext`, and
  append it in `buildSystemPrompt`.
- **Add a tool:** create `tools/<tool>.ts` (`export const x: ToolCard = { name, description }`),
  re-export it from `tools/index.ts`, then pair it with a `parameters` JSON-schema in
  `../tool-schemas.ts`.

Rule of thumb: **prose the model reads lives here; parameter contracts and handler logic do
not** (those stay in `../tool-schemas.ts` and `../agent-tools.service.ts`).
