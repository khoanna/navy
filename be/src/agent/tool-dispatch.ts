import { validateArgs } from './tool-schemas';
import type { ToolHandlers, ToolResult } from './types';

export async function dispatchTool(name: string, argsJson: string, handlers: ToolHandlers): Promise<ToolResult> {
  let args: Record<string, unknown>;
  try { args = argsJson?.trim() ? JSON.parse(argsJson) : {}; }
  catch { return { error: `invalid JSON arguments for ${name}` }; }

  const v = validateArgs(name, args);
  if (!v.ok) return { error: `invalid arguments for ${name}: ${v.errors.join('; ')}` };

  const handler = handlers[name];
  if (!handler) return { error: `no handler for tool ${name}` };

  try { return await handler(args); }
  catch (e) { return { error: (e as Error).message || `tool ${name} failed` }; }
}
