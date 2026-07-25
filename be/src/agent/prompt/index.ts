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
