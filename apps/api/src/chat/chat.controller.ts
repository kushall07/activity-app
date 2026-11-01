import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  markReadSchema,
  messagesQuerySchema,
  sendMessageSchema,
  type ChatsResponse,
  type ChatSummary,
  type Message,
  type MessagesResponse,
} from '@activity/shared';
import type { z } from 'zod';
import { CurrentUser, type AuthUser } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { ChatService } from './chat.service.js';

const uuid = new ParseUUIDPipe({ version: '4' });

/** REST side of chat: history, catch-up and a send fallback when the socket is down. */
@Controller('chats')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser): Promise<ChatsResponse> {
    return { chats: await this.chat.list(user.id) };
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string): Promise<ChatSummary> {
    return this.chat.get(user.id, id);
  }

  @Get(':id/messages')
  messages(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Query(new ZodPipe(messagesQuerySchema)) q: z.output<typeof messagesQuerySchema>,
  ): Promise<MessagesResponse> {
    return this.chat.messages(user.id, id, q);
  }

  @Post(':id/messages')
  send(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(sendMessageSchema)) body: z.output<typeof sendMessageSchema>,
  ): Promise<Message> {
    return this.chat.send(user.id, id, body);
  }

  @Post(':id/read')
  @HttpCode(204)
  async read(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(markReadSchema)) body: z.output<typeof markReadSchema>,
  ): Promise<void> {
    await this.chat.markRead(user.id, id, body.messageId);
  }
}
