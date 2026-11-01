import { describe, expect, it } from 'vitest';
import type { SNSClient } from '@aws-sdk/client-sns';
import { SnsPushSender, type PushTarget } from './push-sender.js';

type Sent = { name: string; input: Record<string, unknown> };

/** Records SNS commands and answers them from a script. */
function fakeSns(answer: (cmd: Sent) => unknown) {
  const sent: Sent[] = [];
  const client = {
    send: async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const entry = { name: cmd.constructor.name, input: cmd.input };
      sent.push(entry);
      const result = answer(entry);
      if (result instanceof Error) throw result;
      return result;
    },
  } as unknown as SNSClient;
  return { client, sent };
}

const snsError = (name: string, message = name) => Object.assign(new Error(message), { name });

const android: PushTarget = {
  platform: 'android',
  token: 'fcm-token-1234',
  endpointArn: null,
  userId: 'u1',
};
const ios: PushTarget = {
  platform: 'ios',
  token: 'apns-token-1234',
  endpointArn: 'arn:ep/ios',
  userId: 'u1',
};
const content = {
  title: 'Hi',
  body: 'There',
  data: { kind: 'chat.message', chatId: 'c1' },
  collapseKey: 'chat:c1',
};
const apps = { android: 'arn:app/fcm', ios: 'arn:app/apns' };

describe('SnsPushSender', () => {
  it('creates an endpoint on first send and publishes an FCM v1 payload', async () => {
    const { client, sent } = fakeSns((c) =>
      c.name === 'CreatePlatformEndpointCommand' ? { EndpointArn: 'arn:ep/new' } : {},
    );
    const result = await new SnsPushSender(client, apps, 'APNS').send(android, content);
    expect(result).toEqual({ status: 'sent', endpointArn: 'arn:ep/new' });
    expect(sent.map((s) => s.name)).toEqual(['CreatePlatformEndpointCommand', 'PublishCommand']);
    const message = JSON.parse(sent[1]!.input.Message as string);
    const fcm = JSON.parse(message.GCM).fcmV1Message.message;
    expect(fcm.notification).toEqual({ title: 'Hi', body: 'There' });
    expect(fcm.data).toEqual(content.data);
    expect(fcm.android.collapse_key).toBe('chat:c1');
  });

  it('publishes an APNs payload to an existing endpoint', async () => {
    const { client, sent } = fakeSns(() => ({}));
    await new SnsPushSender(client, apps, 'APNS_SANDBOX').send(ios, content);
    expect(sent).toHaveLength(1);
    const message = JSON.parse(sent[0]!.input.Message as string);
    const apns = JSON.parse(message.APNS_SANDBOX);
    expect(apns.aps.alert).toEqual({ title: 'Hi', body: 'There' });
    expect(apns.chatId).toBe('c1');
  });

  it('takes over an endpoint that already exists for the token', async () => {
    const { client, sent } = fakeSns((c) =>
      c.name === 'CreatePlatformEndpointCommand'
        ? snsError(
            'InvalidParameterException',
            'Invalid parameter: Token Reason: Endpoint arn:aws:sns:ap-south-1:1:endpoint/GCM/app/abc already exists with the same Token, but different attributes.',
          )
        : {},
    );
    const result = await new SnsPushSender(client, apps, 'APNS').send(android, content);
    expect(result).toEqual({
      status: 'sent',
      endpointArn: 'arn:aws:sns:ap-south-1:1:endpoint/GCM/app/abc',
    });
    expect(sent.map((s) => s.name)).toEqual([
      'CreatePlatformEndpointCommand',
      'SetEndpointAttributesCommand',
      'PublishCommand',
    ]);
  });

  it('reports dead tokens so the device can be dropped', async () => {
    const { client } = fakeSns(() => snsError('EndpointDisabledException'));
    expect(await new SnsPushSender(client, apps, 'APNS').send(ios, content)).toEqual({
      status: 'invalid',
    });
  });

  it('skips platforms without a platform application', async () => {
    const { client, sent } = fakeSns(() => ({}));
    await new SnsPushSender(client, {}, 'APNS').send(android, content);
    expect(sent).toHaveLength(0);
  });
});
