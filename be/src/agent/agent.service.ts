import { Inject, Injectable } from '@nestjs/common';
import { NavyConfigService } from '../config/config.service';
import { ConversationService } from './conversation.service';
import { AgentToolsService } from './agent-tools.service';
import { OpenRouterClient } from './openrouter.client';
import { runAgentLoop } from './agent-loop';
import { dispatchTool } from './tool-dispatch';
import { trimMessages } from './context-window';
import { TOOLS } from './tool-schemas';
import type { ChatMessage } from './types';

const SYSTEM_PROMPT = `You are Navy Assistant, an in-wallet AI for a USDC payment wallet on Ethereum Sepolia.
You can read the user's balances, payment history, and farming position, and you can PROPOSE actions:
sending USDC (gasless) and farming deposits/withdrawals. You NEVER move funds yourself — every action tool
returns a proposal the user must confirm and sign in the app. Amounts are USDC base units (6 decimals):
1 USDC = 1000000. Use get_portfolio before proposing a transfer or deposit if you are unsure of the balance.
When the user names a recipient by @username, pass it directly as the recipient to build_transfer — the
backend resolves usernames, so do NOT ask the user for a raw 0x address.
When a transfer proposal is ready, ALWAYS confirm the recipient's resolved wallet address (the tool
result's recipient.address) alongside their @username, plus the amount and asset, so the user can verify
who they are paying before signing.
If a tool returns an error, tell the user what went wrong in one short sentence and how to fix it.
Always end your turn with a short message to the user — never reply with nothing.
You can also look up any cryptocurrency's market data with get_token_info and top coins with get_top_coins.
When you present token data, give a brief analysis (price, today's move, market position) in plain language —
do not just list raw numbers.
Be concise. Never claim a transfer or deposit has happened — only that a proposal is ready to confirm.`;

/** A sink the controller provides to forward streaming events to the HTTP response. */
export interface StreamSink {
  token: (t: string) => void;
  toolStart: (name: string) => void;
  toolResult: (name: string, result: unknown) => void;
}

@Injectable()
export class AgentService {
  private readonly client: OpenRouterClient;
  constructor(
    private readonly cfg: NavyConfigService,
    private readonly conversations: ConversationService,
    private readonly tools: AgentToolsService,
  ) {
    this.client = new OpenRouterClient({ apiKey: cfg.openRouterApiKey, model: cfg.openRouterModel, baseUrl: cfg.openRouterBaseUrl });
  }

  /** Run one user turn; returns the conversationId. Streams via the sink. */
  async chat(userId: string, walletAddress: string, userText: string, conversationId: string | undefined, sink: StreamSink): Promise<string> {
    if (!this.cfg.openRouterApiKey) throw new Error('AI assistant is not configured (OPENROUTER_API_KEY missing)');

    const convo = await this.conversations.getOrCreate(userId, conversationId);
    const prior = await this.conversations.history(convo.id);

    const base: ChatMessage[] = prior.length && prior[0].role === 'system'
      ? prior
      : [{ role: 'system', content: SYSTEM_PROMPT }, ...prior];
    const userMsg: ChatMessage = { role: 'user', content: userText };
    const seed = trimMessages([...base, userMsg], this.cfg.agentContextTokenBudget);

    if (prior.length === 0) await this.conversations.append(convo.id, { role: 'system', content: SYSTEM_PROMPT });
    await this.conversations.append(convo.id, userMsg);

    const handlers = this.tools.forUser(userId, walletAddress);
    const priorLen = seed.length;

    // Track the last tool error so we can surface it if the model ends the turn with no text
    // (some models return an empty assistant message after a tool error).
    let lastToolError: string | null = null;

    const finalMessages = await runAgentLoop({
      messages: seed,
      maxIterations: this.cfg.agentMaxIterations,
      callModel: (messages) => this.client.streamChat(messages, TOOLS, sink.token),
      runTool: async (name, argsJson) => {
        sink.toolStart(name);
        const result = await dispatchTool(name, argsJson, handlers);
        if (result && typeof (result as any).error === 'string') lastToolError = (result as any).error;
        sink.toolResult(name, result);
        return result;
      },
    });

    // Guarantee the user always sees a message. If the model produced an empty final reply,
    // synthesize one — surfacing the last tool error when there was one.
    const last = finalMessages[finalMessages.length - 1];
    if (last && last.role === 'assistant' && !(last.content ?? '').trim()) {
      const fallback = lastToolError
        ? `I couldn't complete that: ${lastToolError}`
        : "Sorry, I couldn't put together a response. Could you rephrase that?";
      sink.token(fallback);
      (last as { content: string | null }).content = fallback;
    }

    for (const m of finalMessages.slice(priorLen)) await this.conversations.append(convo.id, m);
    return convo.id;
  }
}
