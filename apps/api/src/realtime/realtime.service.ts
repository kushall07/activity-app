import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import type { ServerFrame } from '@activity/shared';
import type { Redis } from 'ioredis';
import { REDIS } from '../redis/redis.constants.js';

/** One live socket, as the realtime layer sees it. */
export interface Connection {
  readonly id: string;
  readonly userId: string;
  send(frame: ServerFrame): void;
}

interface Envelope {
  userIds: string[];
  frame: ServerFrame;
}

export const REALTIME_CHANNEL = 'realtime:v1';
/** A connection counts as online this long after its last heartbeat. */
const PRESENCE_TTL_MS = 70_000;
const presenceKey = (userId: string) => `presence:${userId}`;

/**
 * Delivers events to members' open sockets, whichever API task holds them.
 * Every task subscribes to one Redis channel and forwards each event to the
 * sockets it holds for the listed members. At launch scale (a few hundred
 * concurrent sockets, tens of messages a second at peak) one channel is plenty;
 * past ~1k events/s move to per-user sharded channels (Redis 7 SSUBSCRIBE).
 *
 * Presence (is the member's app open?) is a sorted set per member of connection
 * ids scored by expiry, refreshed on every heartbeat, so a crashed task's
 * sockets age out on their own. Push notifications for chat skip online members.
 */
@Injectable()
export class RealtimeService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly local = new Map<string, Set<Connection>>();
  private sub: Redis | null = null;

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onModuleInit(): Promise<void> {
    // A subscriber connection cannot run other commands, so it gets its own. It keeps
    // an offline queue so the subscription is (re)established whenever Redis is back.
    this.sub = this.redis.duplicate({
      connectionName: 'activity-api-realtime',
      enableOfflineQueue: true,
      maxRetriesPerRequest: null,
    });
    this.sub.on('error', (err: Error) => this.logger.warn(`Realtime Redis error: ${err.message}`));
    this.sub.on('message', (_channel: string, raw: string) => this.deliver(raw));
    await this.sub.subscribe(REALTIME_CHANNEL).catch((err: unknown) => {
      this.logger.error(`Could not subscribe: ${(err as Error).message}`);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.sub?.quit().catch(() => this.sub?.disconnect());
  }

  register(conn: Connection): void {
    let set = this.local.get(conn.userId);
    if (!set) this.local.set(conn.userId, (set = new Set()));
    set.add(conn);
    void this.touch(conn);
  }

  unregister(conn: Connection): void {
    const set = this.local.get(conn.userId);
    set?.delete(conn);
    if (set?.size === 0) this.local.delete(conn.userId);
    this.redis.zrem(presenceKey(conn.userId), conn.id).catch(() => undefined);
  }

  /** Called on each heartbeat to keep the member marked online. */
  async touch(conn: Connection): Promise<void> {
    const key = presenceKey(conn.userId);
    const now = Date.now();
    await this.redis
      .multi()
      .zadd(key, now + PRESENCE_TTL_MS, conn.id)
      .zremrangebyscore(key, 0, now)
      .pexpire(key, PRESENCE_TTL_MS)
      .exec()
      .catch(() => undefined);
  }

  /** Members with at least one live socket. If Redis is down, assume nobody is (push anyway). */
  async online(userIds: string[]): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    try {
      const pipeline = this.redis.pipeline();
      const now = Date.now();
      for (const id of userIds) pipeline.zcount(presenceKey(id), now, '+inf');
      const results = (await pipeline.exec()) ?? [];
      return new Set(userIds.filter((_, i) => Number(results[i]?.[1] ?? 0) > 0));
    } catch {
      return new Set();
    }
  }

  /** Sends a frame to every open socket of these members, on any task. */
  async publish(userIds: string[], frame: ServerFrame): Promise<void> {
    const envelope: Envelope = { userIds: [...new Set(userIds)], frame };
    const raw = JSON.stringify(envelope);
    try {
      await this.redis.publish(REALTIME_CHANNEL, raw);
    } catch (err) {
      // Redis is down: at least reach the sockets on this task. Clients catch up over
      // REST (GET messages?after=) when they reconnect, so nothing is lost for good.
      this.logger.warn(`Realtime publish failed, delivering locally: ${(err as Error).message}`);
      this.deliver(raw);
    }
  }

  /** Sockets this task holds; exposed for shutdown and tests. */
  connections(): Connection[] {
    return [...this.local.values()].flatMap((s) => [...s]);
  }

  private deliver(raw: string): void {
    let envelope: Envelope;
    try {
      envelope = JSON.parse(raw) as Envelope;
    } catch {
      return;
    }
    for (const userId of envelope.userIds) {
      for (const conn of this.local.get(userId) ?? []) {
        try {
          conn.send(envelope.frame);
        } catch (err) {
          this.logger.debug(`Send to ${conn.id} failed: ${(err as Error).message}`);
        }
      }
    }
  }
}
