import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { users } from '@activity/db';
import {
  JOB_TYPES,
  type AuthTokens,
  type StartOtpResponse,
  type UserPurgePayload,
  type VerifyOtpResponse,
} from '@activity/shared';
import { eq, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { ApiException } from '../common/errors.js';
import { JobsService } from '../common/jobs.service.js';
import { RateLimiter } from '../common/rate-limiter.js';
import type { Env } from '../config/env.js';
import { DRIZZLE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import { REDIS } from '../redis/redis.constants.js';
import type { AuthUser } from './decorators.js';
import { OTP_PROVIDER, OtpError, type OtpProvider } from './otp-provider.js';

const RESEND_AFTER_SECONDS = 30;
const MAX_ATTEMPTS_PER_CHALLENGE = 5;

interface Challenge {
  phone: string;
  state: string;
  attempts: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly allowedPrefixes: string[];

  constructor(
    @Inject(OTP_PROVIDER) private readonly provider: OtpProvider,
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly limiter: RateLimiter,
    private readonly jobs: JobsService,
    private readonly config: ConfigService<Env, true>,
  ) {
    this.allowedPrefixes = config
      .get('ALLOWED_PHONE_PREFIXES', { infer: true })
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
  }

  async start(phone: string, ip: string): Promise<StartOtpResponse> {
    if (!this.allowedPrefixes.some((p) => phone.startsWith(p))) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'phone_not_supported',
        'We only support Indian mobile numbers for now',
      );
    }
    // Cheapest, widest check first so a blocked client never spends a number's quota.
    await this.limiter.consume(
      `otp:ip:${ip}`,
      this.config.get('OTP_MAX_PER_IP_PER_HOUR', { infer: true }),
      3600,
      'Too many codes requested. Try again later.',
    );

    const cooldown = await this.limiter.cooldown(`otp:${phone}`, RESEND_AFTER_SECONDS);
    if (!cooldown.ok) {
      throw new ApiException(
        HttpStatus.TOO_MANY_REQUESTS,
        'rate_limited',
        `Wait ${cooldown.retryAfter}s before requesting another code`,
        { 'retry-after': String(cooldown.retryAfter) },
      );
    }
    await this.limiter.consume(
      `otp:phone:${phone}`,
      this.config.get('OTP_MAX_PER_PHONE_PER_HOUR', { infer: true }),
      3600,
      'Too many codes requested for this number. Try again later.',
    );
    const { state, expiresIn } = await this.provider.start(phone);
    const challengeId = randomUUID();
    const challenge: Challenge = { phone, state, attempts: 0 };
    await this.redis.set(this.key(challengeId), JSON.stringify(challenge), 'EX', expiresIn);
    return { challengeId, expiresIn, resendAfter: RESEND_AFTER_SECONDS };
  }

  async verify(challengeId: string, code: string): Promise<VerifyOtpResponse> {
    const key = this.key(challengeId);
    const raw = await this.redis.get(key);
    if (!raw)
      throw this.otpError(new OtpError('expired', 'That code has expired, request a new one'));
    const challenge = JSON.parse(raw) as Challenge;

    challenge.attempts += 1;
    if (challenge.attempts > MAX_ATTEMPTS_PER_CHALLENGE) {
      await this.redis.del(key);
      throw this.otpError(
        new OtpError('too_many_attempts', 'Too many wrong codes, request a new one'),
      );
    }
    await this.redis.set(key, JSON.stringify(challenge), 'KEEPTTL');

    let result: Awaited<ReturnType<OtpProvider['verify']>>;
    try {
      result = await this.provider.verify(challenge.phone, code, challenge.state);
    } catch (err) {
      if (err instanceof OtpError) {
        if (err.reason !== 'invalid_code') await this.redis.del(key);
        throw this.otpError(err);
      }
      throw err;
    }
    await this.redis.del(key);

    // xmax = 0 only for freshly inserted rows: tells us whether this is a new account.
    const [row] = await this.db
      .insert(users)
      .values({ phoneE164: challenge.phone, cognitoSub: result.sub })
      .onConflictDoUpdate({ target: users.phoneE164, set: { cognitoSub: result.sub } })
      .returning({ id: users.id, status: users.status, inserted: sql<boolean>`(xmax = 0)` });
    if (!row) throw new Error('User upsert returned no row');
    if (row.status === 'suspended') {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'account_suspended',
        'This account is suspended',
      );
    }
    return { ...result.tokens, user: { id: row.id, isNew: row.inserted } };
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    try {
      return await this.provider.refresh(refreshToken);
    } catch (err) {
      if (err instanceof OtpError) {
        throw new ApiException(HttpStatus.UNAUTHORIZED, 'session_expired', err.message);
      }
      throw err;
    }
  }

  async logout(refreshToken: string): Promise<void> {
    try {
      await this.provider.revoke(refreshToken);
    } catch (err) {
      // Logging out must always succeed on the device; a bad token is already useless.
      this.logger.warn(`Token revoke failed: ${(err as Error).message}`);
    }
  }

  /** Account deletion (required by the App Store and Play Store). */
  async deleteAccount(user: AuthUser): Promise<void> {
    await this.provider.deleteUser(user.sub);
    await this.db.delete(users).where(eq(users.id, user.id));
    const payload: UserPurgePayload = { userId: user.id };
    await this.jobs.enqueue(JOB_TYPES.userPurge, payload, `${JOB_TYPES.userPurge}:${user.id}`);
  }

  private key(challengeId: string) {
    return `otp:challenge:${challengeId}`;
  }

  private otpError(err: OtpError): ApiException {
    const status = err.reason === 'invalid_code' ? HttpStatus.BAD_REQUEST : HttpStatus.GONE;
    return new ApiException(status, `otp_${err.reason}`, err.message);
  }
}
