import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { activities, chatMembers, chats, messages, photos, plans, profiles } from '@activity/db';
import {
  CHAT_RULES,
  storageKeys,
  type ChatMember,
  type ChatSummary,
  type Message,
  type MessagesResponse,
  type SendMessage,
} from '@activity/shared';
import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import { ApiException } from '../common/errors.js';
import { NotifierService } from '../common/notifier.service.js';
import { RateLimiter } from '../common/rate-limiter.js';
import { StorageService } from '../common/storage.service.js';
import { DRIZZLE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import { RealtimeService } from '../realtime/realtime.service.js';

type MessageRow = typeof messages.$inferSelect;
/** A transaction or the database: chat writes often ride in a request's transaction. */
type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'execute'>;

const notFound = () => new ApiException(HttpStatus.NOT_FOUND, 'not_found', 'Chat not found');

export function toMessage(m: MessageRow): Message {
  return {
    id: m.id,
    chatId: m.chatId,
    senderId: m.senderId,
    kind: m.kind,
    body: m.body,
    clientId: m.clientId,
    createdAt: m.createdAt.toISOString(),
  };
}

/** Effects to run once the transaction that changed a chat has committed. */
export interface ChatChange {
  chatId: string;
  memberIds: string[];
  message: Message | null;
}

/**
 * One chat per plan: the host and everyone accepted. Postgres stores the
 * messages (same database as the membership, so access checks are one indexed
 * lookup); the realtime layer fans them out to open sockets and the workers
 * push to members whose app is closed.
 */
@Injectable()
export class ChatService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly realtime: RealtimeService,
    private readonly notifier: NotifierService,
    private readonly limiter: RateLimiter,
    private readonly storage: StorageService,
  ) {}

  // --- Membership (called inside request/plan transactions) ------------------

  /** Creates the plan's chat if needed and adds the member. Returns the chat id. */
  async join(
    tx: Executor,
    planId: string,
    hostId: string,
    userId: string,
    systemText: string,
  ): Promise<ChatChange> {
    await tx.insert(chats).values({ planId }).onConflictDoNothing();
    const [chat] = await tx.select({ id: chats.id }).from(chats).where(eq(chats.planId, planId));
    const chatId = chat!.id;
    await tx
      .insert(chatMembers)
      .values([
        { chatId, userId: hostId, role: 'host' as const },
        { chatId, userId, role: 'member' as const },
      ])
      .onConflictDoUpdate({
        target: [chatMembers.chatId, chatMembers.userId],
        set: { leftAt: null },
      });
    return this.system(tx, chatId, systemText);
  }

  /** Removes a member (they left the plan). No-op if the plan has no chat yet. */
  async leave(
    tx: Executor,
    planId: string,
    userId: string,
    systemText: string,
  ): Promise<ChatChange | null> {
    const [chat] = await tx.select({ id: chats.id }).from(chats).where(eq(chats.planId, planId));
    if (!chat) return null;
    const change = await this.system(tx, chat.id, systemText);
    await tx
      .update(chatMembers)
      .set({ leftAt: new Date() })
      .where(and(eq(chatMembers.chatId, chat.id), eq(chatMembers.userId, userId)));
    // The member who left still gets this last event so their app refreshes.
    return { ...change, memberIds: [...new Set([...change.memberIds, userId])] };
  }

  /** Posts a system line ("Asha joined") to the plan's chat, if it has one. */
  async announce(tx: Executor, planId: string, text: string): Promise<ChatChange | null> {
    const [chat] = await tx.select({ id: chats.id }).from(chats).where(eq(chats.planId, planId));
    return chat ? this.system(tx, chat.id, text) : null;
  }

  /** Fans out a committed change to open sockets. */
  async broadcast(change: ChatChange | null): Promise<void> {
    if (!change) return;
    if (change.message) {
      await this.realtime.publish(change.memberIds, { type: 'message', message: change.message });
    }
    await this.realtime.publish(change.memberIds, { type: 'chat', chatId: change.chatId });
  }

  private async system(tx: Executor, chatId: string, body: string): Promise<ChatChange> {
    const [row] = await tx.insert(messages).values({ chatId, kind: 'system', body }).returning();
    await tx.update(chats).set({ lastMessageAt: row!.createdAt }).where(eq(chats.id, chatId));
    return { chatId, memberIds: await this.activeMembers(tx, chatId), message: toMessage(row!) };
  }

  private async activeMembers(tx: Executor, chatId: string): Promise<string[]> {
    const rows = await tx
      .select({ userId: chatMembers.userId })
      .from(chatMembers)
      .where(and(eq(chatMembers.chatId, chatId), isNull(chatMembers.leftAt)));
    return rows.map((r) => r.userId);
  }

  /** Throws 404 unless the member is in the chat. Returns everyone in it. */
  private async requireMember(userId: string, chatId: string): Promise<string[]> {
    const members = await this.activeMembers(this.db, chatId);
    if (!members.includes(userId)) throw notFound();
    return members;
  }

  // --- Member-facing API ----------------------------------------------------

  async list(userId: string, onlyChatId?: string): Promise<ChatSummary[]> {
    const lastRead = sql<number>`${chatMembers.lastReadMessageId}`;
    const rows = await this.db
      .select({
        chatId: chats.id,
        planId: plans.id,
        startsAt: plans.startsAt,
        placeName: plans.placeName,
        area: plans.area,
        status: plans.status,
        activity: activities,
        lastMessage: sql<MessageRowJson | null>`(
          select row_to_json(m) from (
            select id, chat_id, sender_id, kind, body, client_id, created_at
            from ${messages} where ${messages.chatId} = ${chats.id}
            order by ${messages.id} desc limit 1
          ) m)`,
        // Capped: the badge shows 99+ anyway, and the count stays an index range scan.
        unread: sql<number>`(
          select count(*)::int from (
            select 1 from ${messages}
            where ${messages.chatId} = ${chats.id} and ${messages.id} > ${lastRead}
              and ${messages.senderId} is distinct from ${userId}::uuid
            limit 100
          ) u)`,
      })
      .from(chatMembers)
      .innerJoin(chats, eq(chats.id, chatMembers.chatId))
      .innerJoin(plans, eq(plans.id, chats.planId))
      .innerJoin(activities, eq(activities.slug, plans.activitySlug))
      .where(
        and(
          eq(chatMembers.userId, userId),
          isNull(chatMembers.leftAt),
          onlyChatId ? eq(chats.id, onlyChatId) : undefined,
        ),
      )
      .orderBy(desc(chats.lastMessageAt))
      .limit(100);

    const members = await this.members(rows.map((r) => r.chatId));
    return rows.map((r) => {
      const ended =
        (r.status === 'open' || r.status === 'full') &&
        r.startsAt.getTime() < Date.now() - 6 * 3600_000;
      return {
        id: r.chatId,
        plan: {
          id: r.planId,
          activity: {
            slug: r.activity.slug,
            name: r.activity.name,
            category: r.activity.category,
            emoji: r.activity.emoji,
            defaultSeats: r.activity.defaultSeats,
          },
          startsAt: r.startsAt.toISOString(),
          placeName: r.placeName,
          area: r.area,
          status: ended ? 'completed' : r.status,
        },
        members: members.get(r.chatId) ?? [],
        lastMessage: r.lastMessage ? fromJson(r.lastMessage) : null,
        unread: r.unread,
      };
    });
  }

  async get(userId: string, chatId: string): Promise<ChatSummary> {
    const [chat] = await this.list(userId, chatId);
    if (!chat) throw notFound();
    return chat;
  }

  async messages(
    userId: string,
    chatId: string,
    q: { before?: number; after?: number; limit: number },
  ): Promise<MessagesResponse> {
    await this.requireMember(userId, chatId);
    const base = eq(messages.chatId, chatId);
    if (q.after !== undefined) {
      const rows = await this.db
        .select()
        .from(messages)
        .where(and(base, gt(messages.id, q.after)))
        .orderBy(asc(messages.id))
        .limit(q.limit + 1);
      return { messages: rows.slice(0, q.limit).map(toMessage), hasMore: rows.length > q.limit };
    }
    const rows = await this.db
      .select()
      .from(messages)
      .where(q.before !== undefined ? and(base, lt(messages.id, q.before)) : base)
      .orderBy(desc(messages.id))
      .limit(q.limit + 1);
    return {
      messages: rows.slice(0, q.limit).reverse().map(toMessage),
      hasMore: rows.length > q.limit,
    };
  }

  /**
   * Stores and delivers a message. Idempotent on (sender, clientId): a retry
   * after a dropped connection returns the original message instead of a copy.
   */
  async send(userId: string, chatId: string, input: SendMessage): Promise<Message> {
    const members = await this.requireMember(userId, chatId);
    await this.limiter.consume(
      `chat:send:${userId}`,
      CHAT_RULES.maxMessagesPerMinute,
      60,
      'You are sending messages very fast. Take a breath and try again.',
    );

    const [inserted] = await this.db
      .insert(messages)
      .values({
        chatId,
        senderId: userId,
        kind: 'text',
        body: input.body,
        clientId: input.clientId,
      })
      .onConflictDoNothing({ target: [messages.senderId, messages.clientId] })
      .returning();
    if (!inserted) {
      const [existing] = await this.db
        .select()
        .from(messages)
        .where(and(eq(messages.senderId, userId), eq(messages.clientId, input.clientId)));
      if (!existing || existing.chatId !== chatId) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'duplicate_client_id',
          'Message id already used',
        );
      }
      return toMessage(existing);
    }

    await Promise.all([
      this.db.update(chats).set({ lastMessageAt: inserted.createdAt }).where(eq(chats.id, chatId)),
      // Sending implies having read everything up to here.
      this.db
        .update(chatMembers)
        .set({ lastReadMessageId: inserted.id })
        .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, userId))),
    ]);
    const message = toMessage(inserted);
    await this.realtime.publish(members, { type: 'message', message });
    await this.pushToOffline(userId, chatId, members, message);
    return message;
  }

  async markRead(userId: string, chatId: string, messageId: number): Promise<void> {
    const members = await this.requireMember(userId, chatId);
    await this.db
      .update(chatMembers)
      .set({ lastReadMessageId: sql`greatest(${chatMembers.lastReadMessageId}, ${messageId})` })
      .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, userId)));
    await this.realtime.publish(members, { type: 'read', chatId, userId, messageId });
  }

  private async pushToOffline(senderId: string, chatId: string, members: string[], m: Message) {
    const others = members.filter((id) => id !== senderId);
    const online = await this.realtime.online(others);
    const offline = others.filter((id) => !online.has(id));
    if (offline.length === 0) return;
    const [info] = await this.db
      .select({ name: profiles.displayName, activity: activities.name })
      .from(chats)
      .innerJoin(plans, eq(plans.id, chats.planId))
      .innerJoin(activities, eq(activities.slug, plans.activitySlug))
      .innerJoin(profiles, eq(profiles.userId, senderId))
      .where(eq(chats.id, chatId));
    await this.notifier.push({
      userIds: offline,
      title: `${info?.name ?? 'New message'} · ${info?.activity ?? 'Chat'}`,
      body: m.body,
      data: { kind: 'chat.message', chatId },
      collapseKey: `chat:${chatId}`,
    });
  }

  private async members(chatIds: string[]): Promise<Map<string, ChatMember[]>> {
    const out = new Map<string, ChatMember[]>();
    if (chatIds.length === 0) return out;
    const rows = await this.db
      .select({
        chatId: chatMembers.chatId,
        userId: chatMembers.userId,
        role: chatMembers.role,
        displayName: profiles.displayName,
        photoPrefix: sql<string | null>`(
          select ${photos.publicPrefix} from ${photos}
          where ${photos.userId} = ${chatMembers.userId} and ${photos.status} = 'approved'
          order by ${photos.position} limit 1)`,
      })
      .from(chatMembers)
      .innerJoin(profiles, eq(profiles.userId, chatMembers.userId))
      .where(and(inArray(chatMembers.chatId, chatIds), isNull(chatMembers.leftAt)))
      .orderBy(asc(chatMembers.joinedAt));
    for (const r of rows) {
      const list = out.get(r.chatId) ?? [];
      list.push({
        userId: r.userId,
        displayName: r.displayName,
        role: r.role,
        photoUrl: r.photoPrefix
          ? this.storage.publicUrl(storageKeys.photoVariant(r.photoPrefix, 'thumb'))
          : null,
      });
      out.set(r.chatId, list);
    }
    return out;
  }
}

interface MessageRowJson {
  id: number | string;
  chat_id: string;
  sender_id: string | null;
  kind: 'text' | 'system';
  body: string;
  client_id: string | null;
  created_at: string;
}

function fromJson(m: MessageRowJson): Message {
  return {
    id: Number(m.id),
    chatId: m.chat_id,
    senderId: m.sender_id,
    kind: m.kind,
    body: m.body,
    clientId: m.client_id,
    createdAt: new Date(m.created_at).toISOString(),
  };
}
