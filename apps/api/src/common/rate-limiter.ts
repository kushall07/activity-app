import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../redis/redis.constants.js';
import { ApiException } from './errors.js';

/**
 * Fixed-window counters in Redis, shared by every API task. Used for abuse
 * controls where a per-task in-memory limit would be meaningless (OTP sends
 * cost real money and are a classic SMS-pumping fraud target).
 */
@Injectable()
export class RateLimiter {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Counts a hit and throws 429 once `limit` is exceeded within `windowSeconds`. */
  async consume(key: string, limit: number, windowSeconds: number, message: string): Promise<void> {
    const redisKey = `ratelimit:${key}`;
    const results = await this.redis
      .multi()
      .incr(redisKey)
      .expire(redisKey, windowSeconds, 'NX')
      .ttl(redisKey)
      .exec();
    const count = Number(results?.[0]?.[1] ?? 0);
    const ttl = Number(results?.[2]?.[1] ?? windowSeconds);
    if (count > limit) {
      throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, 'rate_limited', message, {
        'retry-after': String(Math.max(ttl, 1)),
      });
    }
  }

  /** Returns false (and the remaining seconds) if the cooldown key is still set; otherwise sets it. */
  async cooldown(
    key: string,
    seconds: number,
  ): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
    const redisKey = `cooldown:${key}`;
    const set = await this.redis.set(redisKey, '1', 'EX', seconds, 'NX');
    if (set === 'OK') return { ok: true };
    const ttl = await this.redis.ttl(redisKey);
    return { ok: false, retryAfter: Math.max(ttl, 1) };
  }
}
