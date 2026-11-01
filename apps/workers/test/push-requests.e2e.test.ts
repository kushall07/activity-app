/**
 * Push fan-out and request expiry against real Postgres (migrations applied).
 */
import { randomUUID } from 'node:crypto';
import { devices, planRequests, plans, profiles, users } from '@activity/db';
import type { JobEnvelope } from '@activity/shared';
import type { ConfigService } from '@nestjs/config';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import type { Env } from '../src/config/env.js';
import { createDb, createPool, type Database } from '../src/infra/database.js';
import { PushSendHandler } from '../src/jobs/push-send.handler.js';
import type { PushContent, PushResult, PushSender, PushTarget } from '../src/push/push-sender.js';
import { RequestExpirySweeper } from '../src/requests/request-expiry-sweeper.js';

const pool = createPool({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://activity:activity@localhost:5432/activity',
  DATABASE_POOL_MAX: 2,
  DATABASE_SSL: false,
});
const db: Database = createDb(pool);

const job = (payload: unknown): JobEnvelope => ({
  type: 'push.send',
  id: randomUUID(),
  createdAt: new Date().toISOString(),
  payload,
});

async function newUser(gender: 'woman' | 'man' = 'man') {
  const phone = `+9196${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const [u] = await db
    .insert(users)
    .values({ phoneE164: phone, cognitoSub: randomUUID() })
    .returning();
  await db
    .insert(profiles)
    .values({ userId: u!.id, displayName: 'Asha', birthDate: '1995-01-01', gender });
  return u!.id;
}

class ScriptedSender implements PushSender {
  readonly sent: { target: PushTarget; content: PushContent }[] = [];
  constructor(private readonly answer: (t: PushTarget) => PushResult | Error) {}
  async send(target: PushTarget, content: PushContent) {
    this.sent.push({ target, content });
    const r = this.answer(target);
    if (r instanceof Error) throw r;
    return r;
  }
}

afterAll(async () => {
  await pool.end();
});

describe('push.send (e2e)', () => {
  it('sends to every device, stores new endpoints, drops dead tokens and survives one failure', async () => {
    const a = await newUser();
    const b = await newUser();
    const [good, dead, flaky] = ['good', 'dead', 'flaky'].map((k) => `${k}-${randomUUID()}`);
    await db.insert(devices).values([
      { userId: a, platform: 'android', token: good! },
      { userId: a, platform: 'ios', token: dead!, endpointArn: 'arn:old' },
      { userId: b, platform: 'android', token: flaky! },
    ]);
    const sender = new ScriptedSender((t) =>
      t.token === dead
        ? { status: 'invalid' }
        : t.token === flaky
          ? new Error('throttled')
          : { status: 'sent', endpointArn: `arn:new:${t.token}` },
    );
    await new PushSendHandler(db, sender).handle(
      job({
        userIds: [a, b],
        title: 'T',
        body: 'B',
        data: { kind: 'chat.message', chatId: randomUUID() },
      }),
    );
    expect(sender.sent).toHaveLength(3);
    const rows = await db
      .select()
      .from(devices)
      .where(sql`${devices.userId} in (${a}, ${b})`);
    expect(rows.map((r) => r.token).sort()).toEqual([flaky, good].sort());
    expect(rows.find((r) => r.token === good)?.endpointArn).toBe(`arn:new:${good}`);
  });
});

describe('request expiry sweeper (e2e)', () => {
  it('marks pending requests past their expiry as expired, and leaves others alone', async () => {
    const host = await newUser('woman');
    const guest = await newUser();
    const other = await newUser();
    const [plan] = await db
      .insert(plans)
      .values({
        hostId: host,
        activitySlug: 'badminton',
        placeName: 'Court',
        area: 'Koramangala',
        location: sql`ST_SetSRID(ST_MakePoint(77.6245, 12.9352), 4326)::geography` as never,
        startsAt: new Date(Date.now() + 3 * 3600_000),
        durationMinutes: 60,
        seatsTotal: 2,
        wantedGenders: ['man'],
      })
      .returning();
    const [stale, fresh] = await db
      .insert(planRequests)
      .values([
        {
          planId: plan!.id,
          requesterId: guest,
          requesterGender: 'man',
          expiresAt: new Date(Date.now() - 60_000),
        },
        {
          planId: plan!.id,
          requesterId: other,
          requesterGender: 'man',
          expiresAt: new Date(Date.now() + 3600_000),
        },
      ])
      .returning();
    const config = { get: () => 60 } as unknown as ConfigService<Env, true>;
    const expired = await new RequestExpirySweeper(db, config).sweep();
    expect(expired).toBeGreaterThanOrEqual(1);
    const status = async (id: string) =>
      (await db.select().from(planRequests).where(eq(planRequests.id, id)))[0]!.status;
    expect(await status(stale!.id)).toBe('expired');
    expect(await status(fresh!.id)).toBe('pending');
  });
});
