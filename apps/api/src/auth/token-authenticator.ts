import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { users } from '@activity/db';
import { eq } from 'drizzle-orm';
import { ApiException } from '../common/errors.js';
import { DRIZZLE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import type { AuthUser } from './decorators.js';
import { OTP_PROVIDER, type OtpProvider } from './otp-provider.js';

/**
 * Access token -> member. Shared by the HTTP guard and the chat WebSocket, so
 * both apply the same rules (expired, deleted and suspended accounts are refused).
 */
@Injectable()
export class TokenAuthenticator {
  constructor(
    @Inject(OTP_PROVIDER) private readonly provider: OtpProvider,
    @Inject(DRIZZLE) private readonly db: Database,
  ) {}

  async authenticate(token: string): Promise<AuthUser> {
    if (!token) throw this.unauthorized('Sign in to continue');
    let sub: string;
    try {
      ({ sub } = await this.provider.verifyAccessToken(token));
    } catch {
      throw this.unauthorized('Session expired');
    }

    const [user] = await this.db
      .select({
        id: users.id,
        phone: users.phoneE164,
        status: users.status,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.cognitoSub, sub))
      .limit(1);
    if (!user || user.status === 'deleted') throw this.unauthorized('Account not found');
    if (user.status === 'suspended') {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'account_suspended',
        'This account is suspended',
      );
    }
    return { id: user.id, sub, phone: user.phone, createdAt: user.createdAt };
  }

  private unauthorized(message: string) {
    return new ApiException(HttpStatus.UNAUTHORIZED, 'unauthorized', message);
  }
}
