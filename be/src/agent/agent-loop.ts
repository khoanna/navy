import type { ChatMessage } from './types';

export interface AgentLoopArgs {
  messages: ChatMessage[];
  callModel: (messages: ChatMessage[]) => Promise<ChatMessage>;
  runTool: (name: string, argsJson: string) => Promise<unknown>;
  maxIterations: number;
}

/** Server-side tool loop: call → run tool_calls → append role:'tool' → repeat until a plain assistant message. */
export async function runAgentLoop(a: AgentLoopArgs): Promise<ChatMessage[]> {
  const messages = [...a.messages];
  for (let i = 0; i < a.maxIterations; i++) {
    const assistant = await a.callModel(messages);
    messages.push(assistant);
    const calls = assistant.role === 'assistant' ? assistant.tool_calls : undefined;
    if (!calls || calls.length === 0) return messages;
    for (const tc of calls) {
      const result = await a.runTool(tc.function.name, tc.function.arguments);
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
    }
  }
  messages.push({ role: 'assistant', content: "I couldn't finish that in time — please try rephrasing." });
  return messages;
}
