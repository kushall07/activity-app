import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { AuthTokens } from '@activity/shared';
import { jwtVerify, SignJWT } from 'jose';
import { OtpError, type OtpProvider } from './otp-provider.js';

const ISSUER = 'activity-dev';
const ACCESS_TTL_SECONDS = 3600;
const REFRESH_TTL_SECONDS = 30 * 24 * 3600;

/**
 * Local-only provider: no SMS, the code is always DEV_OTP_CODE, tokens are HS256
 * JWTs. Env validation refuses it when NODE_ENV=production.
 */
export class DevOtpProvider implements OtpProvider {
  private readonly logger = new Logger(DevOtpProvider.name);
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly code: string,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  async start(phone: string) {
    this.logger.log(`Dev OTP for ${phone}: ${this.code}`);
    return { state: 'dev', expiresIn: 180 };
  }

  async verify(phone: string, code: string) {
    if (code !== this.code) throw new OtpError('invalid_code', 'That code is not right');
    const sub = `dev-${createHash('sha256').update(phone).digest('hex').slice(0, 32)}`;
    return { sub, tokens: await this.issue(sub) };
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const sub = await this.subject(refreshToken, 'refresh').catch(() => {
      throw new OtpError('invalid_refresh_token', 'Session expired, please log in again');
    });
    return this.issue(sub);
  }

  async revoke(): Promise<void> {}

  async deleteUser(): Promise<void> {}

  async verifyAccessToken(token: string) {
    return { sub: await this.subject(token, 'access') };
  }

  private async subject(token: string, use: 'access' | 'refresh'): Promise<string> {
    const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, algorithms: ['HS256'] });
    if (payload.token_use !== use || !payload.sub) throw new Error('wrong token type');
    return payload.sub;
  }

  private async issue(sub: string): Promise<AuthTokens> {
    const sign = (use: string, ttl: number) =>
      new SignJWT({ token_use: use })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(sub)
        .setIssuer(ISSUER)
        .setIssuedAt()
        .setExpirationTime(`${ttl}s`)
        .sign(this.key);
    return {
      accessToken: await sign('access', ACCESS_TTL_SECONDS),
      refreshToken: await sign('refresh', REFRESH_TTL_SECONDS),
      expiresIn: ACCESS_TTL_SECONDS,
    };
  }
}
