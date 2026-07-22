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
