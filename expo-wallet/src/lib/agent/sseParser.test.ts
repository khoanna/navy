import { SseParser } from './sseParser';

describe('SseParser', () => {
  it('emits complete event/data frames as chunks arrive', () => {
    const p = new SseParser();
    const events: any[] = [];
    p.push('event: token\ndata: {"delta":"Hel', (e) => events.push(e));
    expect(events).toEqual([]);
    p.push('lo"}\n\nevent: done\ndata: {"conversationId":"c1"}\n\n', (e) => events.push(e));
    expect(events).toEqual([
      { event: 'token', data: { delta: 'Hello' } },
      { event: 'done', data: { conversationId: 'c1' } },
    ]);
  });
});
