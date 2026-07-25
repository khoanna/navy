import type { ToolSchema } from './types';
import { getPortfolio } from './prompt/tools/get-portfolio';
import { getPaymentHistory } from './prompt/tools/get-payment-history';
import { getFarmingSummary } from './prompt/tools/get-farming-summary';
import { getSpendingAnalytics } from './prompt/tools/get-spending-analytics';
import { resolveRecipient } from './prompt/tools/resolve-recipient';
import { buildTransfer } from './prompt/tools/build-transfer';
import { buildFarmingDeposit } from './prompt/tools/build-farming-deposit';
import { buildFarmingWithdraw } from './prompt/tools/build-farming-withdraw';
import { getTokenInfo } from './prompt/tools/get-token-info';
import { getTopCoins } from './prompt/tools/get-top-coins';

const str = { type: 'string' } as const;

export const TOOLS: ToolSchema[] = [
  { type: 'function', function: { name: getPortfolio.name, description: getPortfolio.description, parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: getPaymentHistory.name, description: getPaymentHistory.description, parameters: { type: 'object', properties: { limit: { type: 'number' } }, additionalProperties: false } } },
  { type: 'function', function: { name: getFarmingSummary.name, description: getFarmingSummary.description, parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: getSpendingAnalytics.name, description: getSpendingAnalytics.description, parameters: { type: 'object', properties: { period: { type: 'string', enum: ['day', 'week', 'month'] } }, additionalProperties: false } } },
  { type: 'function', function: { name: resolveRecipient.name, description: resolveRecipient.description, parameters: { type: 'object', properties: { recipient: str }, required: ['recipient'], additionalProperties: false } } },
  { type: 'function', function: { name: buildTransfer.name, description: buildTransfer.description, parameters: { type: 'object', properties: { recipient: { type: 'string', description: 'A @username or a 0x wallet address; pass the @username as-is.' }, amountBase: { type: 'string', description: 'Amount in base units of the asset (USDC 6-decimals, or ETH wei). Must come from the user — never guessed.' }, asset: { type: 'string', enum: ['USDC', 'ETH'], description: 'Which asset to send. Defaults to USDC.' } }, required: ['recipient', 'amountBase'], additionalProperties: false } } },
  { type: 'function', function: { name: buildFarmingDeposit.name, description: buildFarmingDeposit.description, parameters: { type: 'object', properties: { amountBase: str }, required: ['amountBase'], additionalProperties: false } } },
  { type: 'function', function: { name: buildFarmingWithdraw.name, description: buildFarmingWithdraw.description, parameters: { type: 'object', properties: { amount: str }, required: ['amount'], additionalProperties: false } } },
  { type: 'function', function: { name: getTokenInfo.name, description: getTokenInfo.description, parameters: { type: 'object', properties: { query: { type: 'string', description: 'Token name or symbol, e.g. "BTC" or "solana".' } }, required: ['query'], additionalProperties: false } } },
  { type: 'function', function: { name: getTopCoins.name, description: getTopCoins.description, parameters: { type: 'object', properties: { limit: { type: 'number' } }, additionalProperties: false } } },
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
