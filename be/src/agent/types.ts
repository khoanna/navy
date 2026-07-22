export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export type ToolDisplay =
  | { kind: 'card' }
  | { kind: 'token' }
  | { kind: 'chart'; chartType: 'line' | 'bar' | 'pie' }
  | { kind: 'action'; action: 'transfer' | 'farming_deposit' | 'farming_withdraw' };

export interface ToolResult {
  display?: ToolDisplay;
  [k: string]: unknown;
}

export interface ToolSchema {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;
export type ToolHandlers = Record<string, ToolHandler>;
