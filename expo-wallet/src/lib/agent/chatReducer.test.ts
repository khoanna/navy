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
