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

    await this.conversations.append(convo.id, userMsg);
    if (prior.length === 0) await this.conversations.append(convo.id, { role: 'system', content: SYSTEM_PROMPT });

    const handlers = this.tools.forUser(userId, walletAddress);
    const priorLen = seed.length;

    const finalMessages = await runAgentLoop({
      messages: seed,
      maxIterations: this.cfg.agentMaxIterations,
      callModel: (messages) => this.client.streamChat(messages, TOOLS, sink.token),
      runTool: async (name, argsJson) => {
        sink.toolStart(name);
        const result = await dispatchTool(name, argsJson, handlers);
        sink.toolResult(name, result);
        return result;
      },
    });

    for (const m of finalMessages.slice(priorLen)) await this.conversations.append(convo.id, m);
    return convo.id;
  }
}
