import type { AuthTokens } from '@activity/shared';

/**
 * Phone-OTP identity provider. Cognito in AWS; a local stand-in for development
 * and tests. The API never stores passwords or OTPs itself.
 */
export interface OtpProvider {
  /** Sends a code to `phone`. Returns provider state to keep server-side until verify. */
  start(phone: string): Promise<{ state: string; expiresIn: number }>;
  /** Checks the code. Throws OtpError on a wrong or expired code. */
  verify(phone: string, code: string, state: string): Promise<{ sub: string; tokens: AuthTokens }>;
  refresh(refreshToken: string): Promise<AuthTokens>;
  revoke(refreshToken: string): Promise<void>;
  deleteUser(sub: string): Promise<void>;
  /** Verifies an access token and returns its subject. Throws on anything invalid. */
  verifyAccessToken(token: string): Promise<{ sub: string }>;
}

export const OTP_PROVIDER = Symbol('OTP_PROVIDER');

export class OtpError extends Error {
  constructor(
    readonly reason: 'invalid_code' | 'expired' | 'invalid_refresh_token' | 'too_many_attempts',
    message: string,
  ) {
    super(message);
    this.name = 'OtpError';
  }
}
