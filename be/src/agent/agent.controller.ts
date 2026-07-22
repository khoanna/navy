import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AgentService, type StreamSink } from './agent.service';
import { ConversationService } from './conversation.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, IsNotEmpty, MaxLength } from 'class-validator';

class ChatDto {
  @IsString() @IsNotEmpty() @MaxLength(2000) message!: string;
  @IsOptional() @IsString() conversationId?: string;
}

@Controller('agent')
@UseGuards(JwtGuard, RolesGuard)
@Roles('user')
export class AgentController {
  constructor(private readonly agent: AgentService, private readonly conversations: ConversationService) {}

  @Post('chat')
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async chat(@Req() req: any, @Body() dto: ChatDto, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const sink: StreamSink = {
      token: (t) => send('token', { delta: t }),
      toolStart: (name) => send('tool_start', { name }),
      toolResult: (name, result) => send('tool_result', { name, result }),
    };
    try {
      const conversationId = await this.agent.chat(req.user.sub, req.user.walletAddress, dto.message, dto.conversationId, sink);
      send('done', { conversationId });
    } catch (e) {
      send('error', { message: (e as Error).message || 'assistant error' });
    } finally {
      res.end();
    }
  }

  @Get('conversations')
  list(@Req() req: any) { return this.conversations.listForUser(req.user.sub); }

  @Get('conversations/:id')
  async one(@Req() req: any, @Param('id') id: string) {
    await this.conversations.getOrCreate(req.user.sub, id);
    return this.conversations.history(id);
  }
}
