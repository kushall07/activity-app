import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { users } from '@activity/db';
import { eq } from 'drizzle-orm';
import { ApiException } from '../common/errors.js';
import { DRIZZLE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import { IS_PUBLIC, type AuthedRequest } from './decorators.js';
import { OTP_PROVIDER, type OtpProvider } from './otp-provider.js';

/**
 * Global guard: every route needs a valid access token unless marked @Public().
 * Tokens are verified locally (JWKS cached in memory), then mapped to our user row.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(OTP_PROVIDER) private readonly provider: OtpProvider,
    @Inject(DRIZZLE) private readonly db: Database,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
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
    req.user = { id: user.id, sub, phone: user.phone, createdAt: user.createdAt };
    return true;
  }

  private unauthorized(message: string) {
    return new ApiException(HttpStatus.UNAUTHORIZED, 'unauthorized', message);
  }
}
