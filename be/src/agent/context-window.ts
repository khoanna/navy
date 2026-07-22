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
