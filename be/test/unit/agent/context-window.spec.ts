import { trimMessages, estimateTokens } from '../../../src/agent/context-window';
import type { ChatMessage } from '../../../src/agent/types';

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
  it('never returns a leading orphan tool message when the budget splits a tool-call group', () => {
    const msgs: ChatMessage[] = [
      { role: 'system', content: 'SYS' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_portfolio', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: '{"usdc":"100"}' },
      { role: 'assistant', content: 'You have 100 USDC.' },
      { role: 'user', content: 'and my ETH?' },
    ];
    // A tiny budget that forces dropping the oldest assistant(tool_calls) but might keep its tool reply.
    const out = trimMessages(msgs, 20);
    const firstNonSystem = out.find((m) => m.role !== 'system');
    expect(firstNonSystem?.role).not.toBe('tool');
  });
});
