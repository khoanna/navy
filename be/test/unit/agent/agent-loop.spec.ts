import { runAgentLoop } from '../../../src/agent/agent-loop';
import type { ChatMessage } from '../../../src/agent/types';

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
