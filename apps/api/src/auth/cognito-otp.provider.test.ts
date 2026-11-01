import { createHmac } from 'node:crypto';
import {
  CodeMismatchException,
  type CognitoIdentityProviderClient,
  UserNotConfirmedException,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { describe, expect, it, vi } from 'vitest';
import { CognitoOtpProvider } from './cognito-otp.provider.js';
import { OtpError } from './otp-provider.js';

const cfg = {
  region: 'ap-south-1',
  userPoolId: 'ap-south-1_pool',
  clientId: 'client',
  clientSecret: 'shh',
};
const phone = '+919876543210';
const hash = (u: string) =>
  createHmac('sha256', 'shh')
    .update(u + 'client')
    .digest('base64');
const exception = <T>(Ctor: new (o: { message: string; $metadata: object }) => T) =>
  new Ctor({ message: 'x', $metadata: {} });

/** Fake SDK client: responds by command class name and records every call. */
function fakeClient(responses: Record<string, (input: Record<string, unknown>) => unknown>) {
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  const send = vi.fn(
    async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const name = cmd.constructor.name;
      calls.push({ name, input: cmd.input });
      const handler = responses[name];
      if (!handler) throw new Error(`unexpected ${name}`);
      return handler(cmd.input);
    },
  );
  return { client: { send } as unknown as CognitoIdentityProviderClient, calls };
}

function provider(responses: Parameters<typeof fakeClient>[0]) {
  const { client, calls } = fakeClient(responses);
  const p = new CognitoOtpProvider(cfg, client);
  vi.spyOn(p, 'verifyAccessToken').mockResolvedValue({ sub: 'sub-123' });
  return { p, calls };
}

const tokens = { AuthenticationResult: { AccessToken: 'at', RefreshToken: 'rt', ExpiresIn: 3600 } };

describe('CognitoOtpProvider', () => {
  it('signs in an existing user with SMS_OTP', async () => {
    const { p, calls } = provider({
      InitiateAuthCommand: () => ({ ChallengeName: 'SMS_OTP', Session: 'sess-1' }),
      RespondToAuthChallengeCommand: () => tokens,
    });
    const { state } = await p.start(phone);
    expect(calls[0]?.input).toMatchObject({
      AuthFlow: 'USER_AUTH',
      AuthParameters: { USERNAME: phone, PREFERRED_CHALLENGE: 'SMS_OTP', SECRET_HASH: hash(phone) },
    });

    const result = await p.verify(phone, '123456', state);
    expect(calls[1]?.input).toMatchObject({
      ChallengeName: 'SMS_OTP',
      Session: 'sess-1',
      ChallengeResponses: { USERNAME: phone, SMS_OTP_CODE: '123456' },
    });
    expect(result).toEqual({
      sub: 'sub-123',
      tokens: { accessToken: 'at', refreshToken: 'c1.sub-123.rt', expiresIn: 3600 },
    });
  });

  it('signs up a new number and signs in with the confirmation session (one SMS)', async () => {
    let initiate = 0;
    const { p, calls } = provider({
      InitiateAuthCommand: () => {
        initiate += 1;
        if (initiate === 1) throw exception(UserNotFoundException);
        return tokens;
      },
      SignUpCommand: () => ({ Session: 'signup-sess' }),
      ConfirmSignUpCommand: () => ({ Session: 'confirm-sess' }),
    });
    const { state } = await p.start(phone);
    expect(calls.map((c) => c.name)).toEqual(['InitiateAuthCommand', 'SignUpCommand']);

    await p.verify(phone, '654321', state);
    expect(calls[2]).toMatchObject({
      name: 'ConfirmSignUpCommand',
      input: { ConfirmationCode: '654321', Session: 'signup-sess', SecretHash: hash(phone) },
    });
    expect(calls[3]).toMatchObject({
      name: 'InitiateAuthCommand',
      input: { AuthFlow: 'USER_AUTH', Session: 'confirm-sess' },
    });
  });

  it('restarts sign-up for a number that never confirmed', async () => {
    const { p, calls } = provider({
      InitiateAuthCommand: () => {
        throw exception(UserNotConfirmedException);
      },
      AdminDeleteUserCommand: () => ({}),
      SignUpCommand: () => ({ Session: 's' }),
    });
    await p.start(phone);
    expect(calls.map((c) => c.name)).toEqual([
      'InitiateAuthCommand',
      'AdminDeleteUserCommand',
      'SignUpCommand',
    ]);
  });

  it('maps a wrong code to OtpError(invalid_code)', async () => {
    const { p } = provider({
      RespondToAuthChallengeCommand: () => {
        throw exception(CodeMismatchException);
      },
    });
    const state = JSON.stringify({ flow: 'sign_in', session: 's' });
    await expect(p.verify(phone, '000000', state)).rejects.toEqual(
      expect.objectContaining({ reason: 'invalid_code' }),
    );
  });

  it('refreshes with the SECRET_HASH of the wrapped sub', async () => {
    const { p, calls } = provider({
      InitiateAuthCommand: () => ({
        AuthenticationResult: { AccessToken: 'at2', ExpiresIn: 3600 },
      }),
    });
    const out = await p.refresh('c1.sub-123.cognito.refresh.token');
    expect(calls[0]?.input).toMatchObject({
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      AuthParameters: { REFRESH_TOKEN: 'cognito.refresh.token', SECRET_HASH: hash('sub-123') },
    });
    expect(out.refreshToken).toBe('c1.sub-123.cognito.refresh.token');
    await expect(p.refresh('garbage')).rejects.toBeInstanceOf(OtpError);
  });
});
