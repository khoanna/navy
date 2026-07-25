import { Inject, Injectable } from '@nestjs/common';
import { NavyConfigService } from '../config/config.service';
import { ConversationService } from './conversation.service';
import { AgentToolsService } from './agent-tools.service';
import { OpenRouterClient } from './openrouter.client';
import { runAgentLoop } from './agent-loop';
import { dispatchTool } from './tool-dispatch';
import { trimMessages } from './context-window';
import { TOOLS } from './tool-schemas';
import { buildSystemPrompt, detectPromptContext } from './prompt';
import type { ChatMessage } from './types';

/** Names of every tool referenced by the assistant messages already in this conversation. */
function priorToolNames(messages: ChatMessage[]): string[] {
  const names: string[] = [];
  for (const m of messages) {
    if (m.role === 'assistant' && m.tool_calls) for (const c of m.tool_calls) names.push(c.function.name);
  }
  return names;
}

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

    // Inject a freshly-composed system prompt each turn (never persisted), so we can append
    // domain detail (farming/market) only when the turn touches it. Drop any legacy stored
    // system message so old conversations pick up the current prompt too.
    const history = prior.filter((m) => m.role !== 'system');
    const ctx = detectPromptContext(userText, priorToolNames(history));
    const systemMsg: ChatMessage = { role: 'system', content: buildSystemPrompt(ctx) };
    const userMsg: ChatMessage = { role: 'user', content: userText };
    const seed = trimMessages([systemMsg, ...history, userMsg], this.cfg.agentContextTokenBudget);

    await this.conversations.append(convo.id, userMsg);

    const handlers = this.tools.forUser(userId, walletAddress, userText);
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
