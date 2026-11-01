import {
  CreatePlatformEndpointCommand,
  PublishCommand,
  SetEndpointAttributesCommand,
  type SNSClient,
} from '@aws-sdk/client-sns';
import { Logger } from '@nestjs/common';

export interface PushTarget {
  platform: 'ios' | 'android';
  token: string;
  endpointArn: string | null;
  userId: string;
}

export interface PushContent {
  title: string;
  body: string;
  data: Record<string, string>;
  collapseKey?: string;
}

/**
 * `sent` (with the endpoint to remember), or `invalid` when the OS says the
 * token is dead (app uninstalled, token rotated): the caller drops the device.
 */
export type PushResult = { status: 'sent'; endpointArn: string | null } | { status: 'invalid' };

export interface PushSender {
  send(target: PushTarget, content: PushContent): Promise<PushResult>;
}

export const PUSH_SENDER = Symbol('PUSH_SENDER');

/**
 * Amazon SNS mobile push: one platform application per OS (FCM for Android,
 * APNs for iOS), one endpoint per device token, created lazily on first send.
 */
export class SnsPushSender implements PushSender {
  private readonly logger = new Logger(SnsPushSender.name);

  constructor(
    private readonly sns: SNSClient,
    private readonly apps: { android?: string; ios?: string },
    /** `APNS` in production, `APNS_SANDBOX` for development builds. */
    private readonly apnsPlatform: 'APNS' | 'APNS_SANDBOX',
  ) {}

  async send(target: PushTarget, content: PushContent): Promise<PushResult> {
    const appArn = target.platform === 'ios' ? this.apps.ios : this.apps.android;
    if (!appArn) {
      this.logger.debug(`No SNS platform application for ${target.platform}; skipping push`);
      return { status: 'sent', endpointArn: target.endpointArn };
    }
    let endpointArn = target.endpointArn ?? (await this.createEndpoint(appArn, target));
    try {
      await this.publish(endpointArn, target.platform, content);
    } catch (err) {
      const name = (err as Error).name;
      if (name === 'EndpointDisabledException') return { status: 'invalid' };
      if (name !== 'NotFoundException') throw err;
      // The endpoint was deleted on the SNS side; make a fresh one and retry once.
      endpointArn = await this.createEndpoint(appArn, target);
      await this.publish(endpointArn, target.platform, content);
    }
    return { status: 'sent', endpointArn };
  }

  /**
   * CreatePlatformEndpoint is idempotent for the same token and attributes. If the
   * token already has an endpoint with other attributes, SNS names it in the error;
   * we take it over and re-enable it.
   */
  private async createEndpoint(appArn: string, target: PushTarget): Promise<string> {
    try {
      const res = await this.sns.send(
        new CreatePlatformEndpointCommand({
          PlatformApplicationArn: appArn,
          Token: target.token,
          CustomUserData: target.userId,
        }),
      );
      return res.EndpointArn!;
    } catch (err) {
      const existing = /Endpoint (arn:aws:sns:[^ ]+) already exists/.exec(
        (err as Error).message,
      )?.[1];
      if (!existing) throw err;
      await this.sns.send(
        new SetEndpointAttributesCommand({
          EndpointArn: existing,
          Attributes: { Token: target.token, Enabled: 'true', CustomUserData: target.userId },
        }),
      );
      return existing;
    }
  }

  private async publish(endpointArn: string, platform: 'ios' | 'android', c: PushContent) {
    const message =
      platform === 'android'
        ? {
            GCM: JSON.stringify({
              fcmV1Message: {
                message: {
                  notification: { title: c.title, body: c.body },
                  data: c.data,
                  android: {
                    priority: 'high',
                    ...(c.collapseKey
                      ? { collapse_key: c.collapseKey, notification: { tag: c.collapseKey } }
                      : {}),
                  },
                },
              },
            }),
          }
        : {
            [this.apnsPlatform]: JSON.stringify({
              aps: {
                alert: { title: c.title, body: c.body },
                sound: 'default',
                ...(c.collapseKey ? { 'thread-id': c.collapseKey } : {}),
              },
              ...c.data,
            }),
          };
    await this.sns.send(
      new PublishCommand({
        TargetArn: endpointArn,
        MessageStructure: 'json',
        Message: JSON.stringify(message),
        MessageAttributes: c.collapseKey
          ? {
              'AWS.SNS.MOBILE.APNS.COLLAPSE_ID': { DataType: 'String', StringValue: c.collapseKey },
            }
          : undefined,
      }),
    );
  }
}

/** Local development: log instead of sending. */
export class LogPushSender implements PushSender {
  private readonly logger = new Logger('Push');
  readonly sent: { target: PushTarget; content: PushContent }[] = [];

  async send(target: PushTarget, content: PushContent): Promise<PushResult> {
    this.sent.push({ target, content });
    this.logger.log(
      `[push:${target.platform}] ${target.userId}: ${content.title} — ${content.body}`,
    );
    return { status: 'sent', endpointArn: target.endpointArn };
  }
}
