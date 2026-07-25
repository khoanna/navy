import {
  getFarmingSummary,
  buildFarmingDeposit,
  buildFarmingWithdraw,
  getTokenInfo,
  getTopCoins,
} from './tools';

/** Which optional detail blocks are relevant for this turn. */
export interface PromptContext {
  farming?: boolean;
  market?: boolean;
}

const FARMING_HINTS = /\b(farm|farming|yield|apy|apr|compound|comet|supply|deposit|stake|earn|withdraw)\b/i;
const MARKET_HINTS =
  /\b(price|priced|market|marketcap|coin|coins|token|trending|top|btc|eth|bitcoin|ethereum|sol|solana|worth of|chart|ath)\b/i;

const FARMING_TOOLS = new Set([getFarmingSummary.name, buildFarmingDeposit.name, buildFarmingWithdraw.name]);
const MARKET_TOOLS = new Set([getTokenInfo.name, getTopCoins.name]);

/**
 * Decide which detail blocks to include from the user's message plus the tools already
 * used in this conversation (so the context stays "sticky" across follow-up turns).
 */
export function detectPromptContext(userText: string, priorToolNames: readonly string[] = []): PromptContext {
  const text = userText ?? '';
  const farming = FARMING_HINTS.test(text) || priorToolNames.some((n) => FARMING_TOOLS.has(n));
  const market = MARKET_HINTS.test(text) || priorToolNames.some((n) => MARKET_TOOLS.has(n));
  return { farming, market };
}
