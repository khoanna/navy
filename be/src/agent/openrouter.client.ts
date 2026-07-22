import type { ChatMessage, ToolCall, ToolSchema } from './types';

export interface OpenRouterConfig { apiKey: string; model: string; baseUrl: string; }

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
