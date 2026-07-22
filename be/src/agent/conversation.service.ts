import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { ChatMessage } from './types';

@Injectable()
export class ConversationService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreate(userId: string, conversationId?: string) {
    if (conversationId) {
      const c = await this.prisma.agentConversation.findUnique({ where: { id: conversationId } });
      if (!c || c.userId !== userId) throw new BadRequestException('Conversation not found');
      return c;
    }
    return this.prisma.agentConversation.create({ data: { userId } });
  }

  /** Load prior messages as ChatMessage[] (oldest first). */
  async history(conversationId: string): Promise<ChatMessage[]> {
    const rows = await this.prisma.agentMessage.findMany({ where: { conversationId }, orderBy: { seq: 'asc' } });
    return rows.map((r) => {
      if (r.role === 'tool') return { role: 'tool', tool_call_id: r.toolCallId!, content: r.content ?? '' };
      if (r.role === 'assistant') return { role: 'assistant', content: r.content, tool_calls: (r.toolCalls as any) ?? undefined };
      return { role: r.role as 'system' | 'user', content: r.content ?? '' };
    });
  }

  async append(conversationId: string, m: ChatMessage) {
    await this.prisma.agentMessage.create({
      data: {
        conversationId,
        role: m.role,
        content: 'content' in m ? m.content ?? null : null,
        toolCalls: m.role === 'assistant' && m.tool_calls ? (m.tool_calls as any) : undefined,
        toolCallId: m.role === 'tool' ? m.tool_call_id : undefined,
      },
    });
    await this.prisma.agentConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
  }

  listForUser(userId: string) {
    return this.prisma.agentConversation.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' }, take: 30 });
  }
}
