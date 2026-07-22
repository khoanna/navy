import type { ToolSchema } from './types';

const str = { type: 'string' } as const;

export const TOOLS: ToolSchema[] = [
  { type: 'function', function: { name: 'get_portfolio', description: "Get the user's USDC + ETH balances and farming position.", parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'get_payment_history', description: "List the user's recent paid orders.", parameters: { type: 'object', properties: { limit: { type: 'number' } }, additionalProperties: false } } },
  { type: 'function', function: { name: 'get_farming_summary', description: "Get the user's Compound farming position and earnings.", parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'get_spending_analytics', description: 'Aggregate the user spending into a chart-ready series.', parameters: { type: 'object', properties: { period: { type: 'string', enum: ['day', 'week', 'month'] } }, additionalProperties: false } } },
  { type: 'function', function: { name: 'resolve_recipient', description: 'Resolve a @username or 0x address to a wallet address.', parameters: { type: 'object', properties: { recipient: str }, required: ['recipient'], additionalProperties: false } } },
  { type: 'function', function: { name: 'build_transfer', description: 'Build a gasless USDC transfer proposal for the user to confirm and sign. amountBase is USDC base units (6 decimals).', parameters: { type: 'object', properties: { recipient: str, amountBase: str }, required: ['recipient', 'amountBase'], additionalProperties: false } } },
  { type: 'function', function: { name: 'build_farming_deposit', description: 'Propose supplying USDC to the Compound farming vault. amountBase = 6-decimal base units.', parameters: { type: 'object', properties: { amountBase: str }, required: ['amountBase'], additionalProperties: false } } },
  { type: 'function', function: { name: 'build_farming_withdraw', description: 'Propose withdrawing from the farming vault. amount = base units or the literal "all".', parameters: { type: 'object', properties: { amount: str }, required: ['amount'], additionalProperties: false } } },
];

export const TOOL_NAMES = TOOLS.map((t) => t.function.name);

export function validateArgs(name: string, args: Record<string, unknown>): { ok: boolean; errors: string[] } {
  const tool = TOOLS.find((t) => t.function.name === name);
  if (!tool) return { ok: false, errors: [`unknown tool: ${name}`] };
  const params = tool.function.parameters as any;
  const required: string[] = params.required ?? [];
  const props: Record<string, any> = params.properties ?? {};
  const errors: string[] = [];
  for (const r of required) if (args[r] === undefined || args[r] === null) errors.push(`missing required: ${r}`);
  for (const [k, v] of Object.entries(args)) {
    const spec = props[k];
    if (!spec) { if (params.additionalProperties === false) errors.push(`unexpected: ${k}`); continue; }
    if (spec.type === 'string' && typeof v !== 'string') errors.push(`${k} must be a string`);
    if (spec.type === 'number' && typeof v !== 'number') errors.push(`${k} must be a number`);
    if (spec.enum && !spec.enum.includes(v as any)) errors.push(`${k} must be one of ${spec.enum.join(',')}`);
  }
  return { ok: errors.length === 0, errors };
}
