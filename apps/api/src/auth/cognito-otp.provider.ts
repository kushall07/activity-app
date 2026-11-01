import { createHmac } from 'node:crypto';
import {
  AdminDeleteUserCommand,
  CodeMismatchException,
  CognitoIdentityProviderClient,
  ConfirmSignUpCommand,
  ExpiredCodeException,
  InitiateAuthCommand,
  NotAuthorizedException,
  RespondToAuthChallengeCommand,
  RevokeTokenCommand,
  SignUpCommand,
  TooManyFailedAttemptsException,
  UserNotConfirmedException,
  UserNotFoundException,
  type AuthenticationResultType,
} from '@aws-sdk/client-cognito-identity-provider';
import type { AuthTokens } from '@activity/shared';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { OtpError, type OtpProvider } from './otp-provider.js';

export interface CognitoConfig {
  region: string;
  userPoolId: string;
  clientId: string;
  clientSecret: string;
}

type Flow = 'sign_in' | 'sign_up';
interface State {
  flow: Flow;
  session: string;
}

/** Cognito's default auth session lifetime; the pool is configured for 5 min, so this is conservative. */
const SESSION_SECONDS = 180;
/** Our refresh token wraps Cognito's with the user's sub, which SECRET_HASH needs on refresh. */
const REFRESH_PREFIX = 'c1.';

/**
 * Passwordless phone login with Cognito "choice-based" auth (USER_AUTH + SMS_OTP).
 *
 * - Existing user: InitiateAuth(USER_AUTH, SMS_OTP) -> RespondToAuthChallenge(code).
 * - New user: SignUp (Cognito texts a confirmation code) -> ConfirmSignUp(code) ->
 *   InitiateAuth with the confirmation session, which signs in without a second SMS.
 *
 * The API is a confidential app client (client secret), so the mobile app never talks
 * to Cognito directly and every OTP send goes through our rate limits.
 */
export class CognitoOtpProvider implements OtpProvider {
  private readonly client: CognitoIdentityProviderClient;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly issuer: string;

  constructor(
    private readonly cfg: CognitoConfig,
    client?: CognitoIdentityProviderClient,
  ) {
    this.client = client ?? new CognitoIdentityProviderClient({ region: cfg.region });
    this.issuer = `https://cognito-idp.${cfg.region}.amazonaws.com/${cfg.userPoolId}`;
    this.jwks = createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`));
  }

  async start(phone: string) {
    try {
      const res = await this.client.send(
        new InitiateAuthCommand({
          ClientId: this.cfg.clientId,
          AuthFlow: 'USER_AUTH',
          AuthParameters: {
            USERNAME: phone,
            PREFERRED_CHALLENGE: 'SMS_OTP',
            SECRET_HASH: this.secretHash(phone),
          },
        }),
      );
      if (res.ChallengeName !== 'SMS_OTP' || !res.Session) {
        throw new Error(`Unexpected Cognito challenge ${res.ChallengeName ?? 'none'}`);
      }
      return this.state({ flow: 'sign_in', session: res.Session });
    } catch (err) {
      if (err instanceof UserNotConfirmedException) {
        // Signed up earlier but never entered the code: holds no data, so start over.
        await this.client.send(
          new AdminDeleteUserCommand({ UserPoolId: this.cfg.userPoolId, Username: phone }),
        );
        return this.signUp(phone);
      }
      if (err instanceof UserNotFoundException) return this.signUp(phone);
      throw err;
    }
  }

  async verify(phone: string, code: string, rawState: string) {
    const state = JSON.parse(rawState) as State;
    try {
      let result: AuthenticationResultType | undefined;
      if (state.flow === 'sign_in') {
        const res = await this.client.send(
          new RespondToAuthChallengeCommand({
            ClientId: this.cfg.clientId,
            ChallengeName: 'SMS_OTP',
            Session: state.session,
            ChallengeResponses: {
              USERNAME: phone,
              SMS_OTP_CODE: code,
              SECRET_HASH: this.secretHash(phone),
            },
          }),
        );
        result = res.AuthenticationResult;
      } else {
        const confirmed = await this.client.send(
          new ConfirmSignUpCommand({
            ClientId: this.cfg.clientId,
            Username: phone,
            ConfirmationCode: code,
            Session: state.session,
            SecretHash: this.secretHash(phone),
          }),
        );
        const res = await this.client.send(
          new InitiateAuthCommand({
            ClientId: this.cfg.clientId,
            AuthFlow: 'USER_AUTH',
            Session: confirmed.Session,
            AuthParameters: { USERNAME: phone, SECRET_HASH: this.secretHash(phone) },
          }),
        );
        result = res.AuthenticationResult;
      }
      if (!result?.AccessToken || !result.RefreshToken) {
        throw new Error('Cognito returned no tokens');
      }
      const { sub } = await this.verifyAccessToken(result.AccessToken);
      return {
        sub,
        tokens: {
          accessToken: result.AccessToken,
          refreshToken: `${REFRESH_PREFIX}${sub}.${result.RefreshToken}`,
          expiresIn: result.ExpiresIn ?? 3600,
        },
      };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const { sub, token } = this.unwrap(refreshToken);
    try {
      const res = await this.client.send(
        new InitiateAuthCommand({
          ClientId: this.cfg.clientId,
          AuthFlow: 'REFRESH_TOKEN_AUTH',
          AuthParameters: { REFRESH_TOKEN: token, SECRET_HASH: this.secretHash(sub) },
        }),
      );
      const result = res.AuthenticationResult;
      if (!result?.AccessToken) throw new Error('Cognito returned no access token');
      return {
        accessToken: result.AccessToken,
        // Present only when refresh-token rotation is on; otherwise keep using the old one.
        refreshToken: result.RefreshToken
          ? `${REFRESH_PREFIX}${sub}.${result.RefreshToken}`
          : refreshToken,
        expiresIn: result.ExpiresIn ?? 3600,
      };
    } catch (err) {
      if (err instanceof NotAuthorizedException) {
        throw new OtpError('invalid_refresh_token', 'Session expired, please log in again');
      }
      throw err;
    }
  }

  async revoke(refreshToken: string): Promise<void> {
    const { token } = this.unwrap(refreshToken);
    await this.client.send(
      new RevokeTokenCommand({
        ClientId: this.cfg.clientId,
        ClientSecret: this.cfg.clientSecret,
        Token: token,
      }),
    );
  }

  async deleteUser(sub: string): Promise<void> {
    try {
      await this.client.send(
        new AdminDeleteUserCommand({ UserPoolId: this.cfg.userPoolId, Username: sub }),
      );
    } catch (err) {
      if (!(err instanceof UserNotFoundException)) throw err;
    }
  }

  async verifyAccessToken(token: string) {
    const { payload } = await jwtVerify(token, this.jwks, { issuer: this.issuer });
    if (payload.token_use !== 'access' || payload.client_id !== this.cfg.clientId || !payload.sub) {
      throw new Error('Not an access token for this app');
    }
    return { sub: payload.sub };
  }

  private async signUp(phone: string) {
    const res = await this.client.send(
      new SignUpCommand({
        ClientId: this.cfg.clientId,
        Username: phone,
        SecretHash: this.secretHash(phone),
        UserAttributes: [{ Name: 'phone_number', Value: phone }],
      }),
    );
    if (!res.Session) throw new Error('Cognito SignUp returned no session');
    return this.state({ flow: 'sign_up', session: res.Session });
  }

  private state(s: State) {
    return { state: JSON.stringify(s), expiresIn: SESSION_SECONDS };
  }

  private unwrap(refreshToken: string): { sub: string; token: string } {
    if (!refreshToken.startsWith(REFRESH_PREFIX)) {
      throw new OtpError('invalid_refresh_token', 'Session expired, please log in again');
    }
    const rest = refreshToken.slice(REFRESH_PREFIX.length);
    const dot = rest.indexOf('.');
    if (dot <= 0)
      throw new OtpError('invalid_refresh_token', 'Session expired, please log in again');
    return { sub: rest.slice(0, dot), token: rest.slice(dot + 1) };
  }

  private secretHash(username: string): string {
    return createHmac('sha256', this.cfg.clientSecret)
      .update(username + this.cfg.clientId)
      .digest('base64');
  }

  private mapError(err: unknown): unknown {
    if (err instanceof CodeMismatchException) {
      return new OtpError('invalid_code', 'That code is not right');
    }
    if (err instanceof ExpiredCodeException) {
      return new OtpError('expired', 'That code has expired, request a new one');
    }
    if (err instanceof TooManyFailedAttemptsException) {
      return new OtpError('too_many_attempts', 'Too many wrong codes, request a new one');
    }
    // An expired or already-used session surfaces as NotAuthorized.
    if (err instanceof NotAuthorizedException) {
      return new OtpError('expired', 'That code has expired, request a new one');
    }
    return err;
  }
}
