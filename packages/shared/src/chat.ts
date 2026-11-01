import { z } from 'zod';
import { activitySchema } from './plans.js';

export const CHAT_RULES = {
  messageMaxLength: 1000,
  pageSize: 50,
  /** Messages per member per minute, across all chats. */
  maxMessagesPerMinute: 30,
  /** A new socket must authenticate within this many ms. */
  authTimeoutMs: 10_000,
  /** Server ping interval; keeps the ALB (60 s idle timeout) from closing quiet sockets. */
  heartbeatMs: 25_000,
} as const;

export const messageSchema = z.object({
  id: z.number().int(),
  chatId: z.string().uuid(),
  senderId: z.string().uuid().nullable(),
  kind: z.enum(['text', 'system']),
  body: z.string(),
  clientId: z.string().uuid().nullable(),
  createdAt: z.string(),
});

export const chatMemberSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  photoUrl: z.string().url().nullable(),
  role: z.enum(['host', 'member']),
});

export const chatSummarySchema = z.object({
  id: z.string().uuid(),
  plan: z.object({
    id: z.string().uuid(),
    activity: activitySchema,
    startsAt: z.string(),
    placeName: z.string(),
    area: z.string(),
    status: z.string(),
  }),
  members: z.array(chatMemberSchema),
  lastMessage: messageSchema.nullable(),
  unread: z.number().int(),
});

export const chatsResponseSchema = z.object({ chats: z.array(chatSummarySchema) });

export const messagesQuerySchema = z
  .object({
    /** Older page: messages with id < before. */
    before: z.coerce.number().int().positive().optional(),
    /** Catch-up after a reconnect: messages with id > after, oldest first. */
    after: z.coerce.number().int().min(0).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(CHAT_RULES.pageSize),
  })
  .refine((q) => q.before === undefined || q.after === undefined, {
    message: 'Use before or after, not both',
  });

/** Messages oldest first. `hasMore` says whether another page exists in the asked direction. */
export const messagesResponseSchema = z.object({
  messages: z.array(messageSchema),
  hasMore: z.boolean(),
});

export const sendMessageSchema = z.object({
  clientId: z.string().uuid(),
  body: z.string().trim().min(1).max(CHAT_RULES.messageMaxLength),
});

export const markReadSchema = z.object({ messageId: z.number().int().min(0) });

// --- WebSocket protocol -------------------------------------------------------
// Client -> server frames.
export const clientFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth'), token: z.string().min(1) }),
  z.object({ type: z.literal('send'), chatId: z.string().uuid(), ...sendMessageSchema.shape }),
  z.object({ type: z.literal('read'), chatId: z.string().uuid(), messageId: z.number().int() }),
  z.object({ type: z.literal('ping') }),
]);

// Server -> client frames.
export const serverFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), userId: z.string().uuid() }),
  z.object({ type: z.literal('message'), message: messageSchema }),
  /** Reply to `send`: the stored message, matched by clientId. */
  z.object({ type: z.literal('ack'), clientId: z.string().uuid(), message: messageSchema }),
  z.object({
    type: z.literal('read'),
    chatId: z.string().uuid(),
    userId: z.string().uuid(),
    messageId: z.number().int(),
  }),
  /** Members changed (someone joined or left) or the plan changed: refetch the chat. */
  z.object({ type: z.literal('chat'), chatId: z.string().uuid() }),
  z.object({
    type: z.literal('error'),
    code: z.string(),
    message: z.string(),
    clientId: z.string().uuid().optional(),
  }),
  z.object({ type: z.literal('pong') }),
]);

export type Message = z.infer<typeof messageSchema>;
export type ChatMember = z.infer<typeof chatMemberSchema>;
export type ChatSummary = z.infer<typeof chatSummarySchema>;
export type ChatsResponse = z.infer<typeof chatsResponseSchema>;
export type MessagesResponse = z.infer<typeof messagesResponseSchema>;
export type SendMessage = z.infer<typeof sendMessageSchema>;
export type ClientFrame = z.infer<typeof clientFrameSchema>;
export type ServerFrame = z.infer<typeof serverFrameSchema>;
