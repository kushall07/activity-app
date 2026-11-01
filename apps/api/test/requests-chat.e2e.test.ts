/**
 * "I'm in" requests, the host's stack, seats, chat (REST + WebSocket) and push
 * fan-out, against real Postgres + PostGIS and Redis.
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  chatsResponseSchema,
  messagesResponseSchema,
  myRequestsResponseSchema,
  planRequestsResponseSchema,
  planSchema,
  requestDecisionResponseSchema,
  serverFrameSchema,
  startOtpResponseSchema,
  verifyOtpResponseSchema,
  type CreatePlanRequest,
  type Plan,
  type PushSendPayload,
  type ServerFrame,
} from '@activity/shared';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import { JobsService } from '../src/common/jobs.service.js';
import { StorageService } from '../src/common/storage.service.js';
import { PG_POOL } from '../src/database/database.constants.js';
import { SEARCH_CLIENT } from '../src/plans/search.module.js';
import { REDIS } from '../src/redis/redis.constants.js';
import { FakeJobs, FakeStorage } from './fakes.js';

const randomPhone = () => `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const hours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

interface Member {
  token: string;
  id: string;
  name: string;
}

describe('requests, matching and chat', () => {
  let app: NestExpressApplication;
  let pool: pg.Pool;
  let redis: Redis;
  let wsUrl: string;
  const jobs = new FakeJobs();
  const http = () => request(app.getHttpServer());
  const base = { lat: 12.8 + Math.random() * 0.35, lng: 77.4 + Math.random() * 0.4 };

  async function member(opts: {
    gender: 'woman' | 'man' | 'nonbinary';
    verified?: boolean;
    neighbourhood?: string;
    interests?: string[];
  }): Promise<Member> {
    const phone = randomPhone();
    const start = await http().post('/v1/auth/otp/start').send({ phone }).expect(200);
    const { challengeId } = startOtpResponseSchema.parse(start.body);
    const verify = await http()
      .post('/v1/auth/otp/verify')
      .send({ challengeId, code: '000000' })
      .expect(200);
    const { accessToken, user } = verifyOtpResponseSchema.parse(verify.body);
    const name = `M${user.id.slice(0, 5)}`;
    await pool.query(
      `insert into profiles (user_id, display_name, birth_date, gender, verified_at, neighbourhood, interests, intent)
       values ($1, $2, '1995-05-05', $3, $4, $5, $6, 'friends')`,
      [
        user.id,
        name,
        opts.gender,
        opts.verified === false ? null : new Date(),
        opts.neighbourhood ?? null,
        opts.interests ?? [],
      ],
    );
    for (let i = 0; i < 3; i++) {
      const photoId = randomUUID();
      await pool.query(
        `insert into photos (id, user_id, position, status, upload_key, public_prefix)
         values ($1, $2, $3, 'approved', $4, $5)`,
        [
          photoId,
          user.id,
          i,
          `incoming/${user.id}/${photoId}`,
          `public/photos/${user.id}/${photoId}`,
        ],
      );
    }
    return { token: accessToken, id: user.id, name };
  }

  const auth = (m: Member) => [m.token, { type: 'bearer' as const }] as const;

  const planBody = (o: Partial<CreatePlanRequest> = {}): CreatePlanRequest => ({
    activitySlug: 'table-tennis',
    place: { name: 'Club tables', area: 'Koramangala', ...base },
    startsAt: hours(30),
    durationMinutes: 90,
    seatsTotal: 1,
    wantedGenders: ['woman', 'man'],
    skillLevel: 'intermediate',
    intent: 'friends',
    ...o,
  });

  async function postPlan(host: Member, o: Partial<CreatePlanRequest> = {}): Promise<Plan> {
    const res = await http()
      .post('/v1/plans')
      .auth(...auth(host))
      .send(planBody(o));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return planSchema.parse(res.body);
  }

  async function ask(m: Member, planId: string, body: object = {}, status = 201) {
    const res = await http()
      .post(`/v1/plans/${planId}/requests`)
      .auth(...auth(m))
      .send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    return res.body;
  }

  async function decide(host: Member, requestId: string, action: string, status = 200) {
    const res = await http()
      .post(`/v1/requests/${requestId}/${action}`)
      .auth(...auth(host));
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    return res.body;
  }

  const pushes = () =>
    jobs.enqueued.filter((j) => j.type === 'push.send').map((j) => j.payload as PushSendPayload);
  const clearRateLimits = async (m: Member) => redis.del(`ratelimit:requests:create:${m.id}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(new FakeStorage())
      .overrideProvider(JobsService)
      .useValue(jobs)
      .overrideProvider(SEARCH_CLIENT)
      .useValue(null)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    wsUrl = `ws://127.0.0.1:${port}/v1/ws`;
    pool = app.get<pg.Pool>(PG_POOL);
    redis = app.get<Redis>(REDIS);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe("I'm in", () => {
    it('sends a scored request the host sees in their stack, and pushes the host', async () => {
      const host = await member({ gender: 'woman' });
      const plan = await postPlan(host);
      const near = await member({
        gender: 'man',
        neighbourhood: 'Koramangala',
        interests: ['table tennis'],
      });
      const far = await member({ gender: 'man', neighbourhood: 'Yelahanka', verified: false });

      const res = requestDecisionResponseSchema.parse(
        await ask(near, plan.id, { message: 'Up for a few games!', skillLevel: 'intermediate' }),
      );
      expect(res.request.status).toBe('pending');
      expect(res.plan?.myRequest).toMatchObject({ id: res.request.id, status: 'pending' });
      await ask(far, plan.id, { skillLevel: 'beginner' });

      expect(pushes()).toContainEqual(
        expect.objectContaining({
          userIds: [host.id],
          title: `${near.name} wants to join`,
          data: { kind: 'request.new', planId: plan.id },
        }),
      );

      const stack = planRequestsResponseSchema.parse(
        (
          await http()
            .get(`/v1/plans/${plan.id}/requests`)
            .auth(...auth(host))
            .expect(200)
        ).body,
      );
      expect(stack.pending.map((r) => r.requester.userId)).toEqual([near.id, far.id]);
      expect(stack.pending[0]!.score).toBeGreaterThan(stack.pending[1]!.score);
      expect(stack.pending[0]!.reasons).toContain('Also intermediate');
      expect(stack.pending[0]!.message).toBe('Up for a few games!');
      expect(stack.pending[0]!.requester.photoUrls).toHaveLength(3);
      expect(stack.pending[0]!.requester).not.toHaveProperty('phone');

      const hostView = planSchema.parse(
        (
          await http()
            .get(`/v1/plans/${plan.id}`)
            .auth(...auth(host))
            .expect(200)
        ).body,
      );
      expect(hostView.pendingRequests).toBe(2);

      // Only the host can see the stack.
      await http()
        .get(`/v1/plans/${plan.id}/requests`)
        .auth(...auth(near))
        .expect(404);
    });

    it('applies the hard filters', async () => {
      const host = await member({ gender: 'woman' });
      const womenOnly = await postPlan(host, { wantedGenders: ['woman'] });
      const verifiedOnly = await postPlan(host, { verifiedOnly: true, startsAt: hours(31) });
      const man = await member({ gender: 'man' });
      const unverified = await member({ gender: 'woman', verified: false });

      expect((await ask(man, womenOnly.id, {}, 404)).code).toBe('not_found');
      expect((await ask(unverified, verifiedOnly.id, {}, 404)).code).toBe('not_found');
      expect((await ask(host, womenOnly.id, {}, 400)).code).toBe('own_plan');

      const woman = await member({ gender: 'woman' });
      await ask(woman, womenOnly.id);
      expect((await ask(woman, womenOnly.id, {}, 409)).code).toBe('already_requested');
    });

    it('caps requests per day', async () => {
      const host = await member({ gender: 'woman' });
      const eager = await member({ gender: 'man' });
      await clearRateLimits(eager);
      for (let i = 0; i < 5; i++) {
        const p = await postPlan(host, { startsAt: hours(40 + i) });
        await ask(eager, p.id);
      }
      const sixth = await member({ gender: 'woman' }).then((h) => postPlan(h));
      expect((await ask(eager, sixth.id, {}, 429)).code).toBe('rate_limited');
    });
  });

  describe('host decisions and seats', () => {
    it('accepting takes a seat, fills the plan, opens a chat and pushes the member', async () => {
      const host = await member({ gender: 'woman' });
      const plan = await postPlan(host, { seatsTotal: 1 });
      const a = await member({ gender: 'man' });
      const b = await member({ gender: 'woman' });
      const ra = requestDecisionResponseSchema.parse(await ask(a, plan.id));
      const rb = requestDecisionResponseSchema.parse(await ask(b, plan.id));

      const accepted = requestDecisionResponseSchema.parse(
        await decide(host, ra.request.id, 'accept'),
      );
      expect(accepted.plan).toMatchObject({ status: 'full', seats: { taken: 1, open: 0 } });
      expect(accepted.plan?.chatId).toBeTruthy();
      const chatId = accepted.plan!.chatId!;

      expect(pushes()).toContainEqual(
        expect.objectContaining({
          userIds: [a.id],
          title: "You're in! 🎉",
          data: { kind: 'request.accepted', planId: plan.id, chatId },
        }),
      );

      // Full: the other request cannot be accepted, and the plan leaves the feed.
      expect((await decide(host, rb.request.id, 'accept', 409)).code).toBe('plan_full');

      const memberView = planSchema.parse(
        (
          await http()
            .get(`/v1/plans/${plan.id}`)
            .auth(...auth(a))
            .expect(200)
        ).body,
      );
      expect(memberView).toMatchObject({ chatId, myRequest: { status: 'accepted' } });

      const { rows } = await pool.query(
        'select seats_taken, status, version from plans where id = $1',
        [plan.id],
      );
      // The version bump is what gets the search index (and its sweeper) to pick up the change.
      expect(rows[0]).toMatchObject({ seats_taken: 1, status: 'full', version: 2 });

      const mine = myRequestsResponseSchema.parse(
        (
          await http()
            .get('/v1/me/requests')
            .auth(...auth(a))
            .expect(200)
        ).body,
      );
      expect(mine.requests[0]).toMatchObject({ status: 'accepted', chatId, plan: { id: plan.id } });
    });

    it('never oversells seats when the host taps accept on several requests at once', async () => {
      const host = await member({ gender: 'woman' });
      const plan = await postPlan(host, { seatsTotal: 2, activitySlug: 'badminton' });
      const people = await Promise.all([0, 1, 2, 3, 4].map(() => member({ gender: 'man' })));
      const ids: string[] = [];
      for (const p of people)
        ids.push(requestDecisionResponseSchema.parse(await ask(p, plan.id)).request.id);

      const results = await Promise.all(
        ids.map((id) =>
          http()
            .post(`/v1/requests/${id}/accept`)
            .auth(...auth(host)),
        ),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(2);
      expect(results.filter((r) => r.status === 409)).toHaveLength(3);
      const { rows } = await pool.query('select seats_taken, status from plans where id = $1', [
        plan.id,
      ]);
      expect(rows[0]).toMatchObject({ seats_taken: 2, status: 'full' });
    });

    it('respects seats per gender on group plans', async () => {
      const host = await member({ gender: 'woman' });
      const plan = await postPlan(host, {
        activitySlug: 'badminton',
        seatsTotal: 3,
        genderMix: { woman: 2, man: 1 },
      });
      const m1 = await member({ gender: 'man' });
      const m2 = await member({ gender: 'man' });
      const r1 = requestDecisionResponseSchema.parse(await ask(m1, plan.id));
      const r2 = requestDecisionResponseSchema.parse(await ask(m2, plan.id));
      await decide(host, r1.request.id, 'accept');
      expect((await decide(host, r2.request.id, 'accept', 409)).code).toBe('no_seat_for_gender');
      const m3 = await member({ gender: 'man' });
      expect((await ask(m3, plan.id, {}, 409)).code).toBe('no_seat_for_gender');
    });

    it('declines quietly and hides the plan from that member', async () => {
      const host = await member({ gender: 'woman' });
      const plan = await postPlan(host);
      const m = await member({ gender: 'man' });
      const r = requestDecisionResponseSchema.parse(await ask(m, plan.id));
      const before = pushes().length;
      await decide(host, r.request.id, 'decline');
      expect(pushes()).toHaveLength(before);
      expect((await decide(host, r.request.id, 'accept', 409)).code).toBe('request_closed');

      const feed = await http()
        .get('/v1/plans')
        .query({ ...base, radiusKm: 1 })
        .auth(...auth(m))
        .expect(200);
      expect(feed.body.plans.map((p: Plan) => p.id)).not.toContain(plan.id);
    });

    it('auto-accepts verified members when the host turned it on', async () => {
      const host = await member({ gender: 'woman' });
      const plan = await postPlan(host, {
        autoAccept: true,
        seatsTotal: 2,
        activitySlug: 'badminton',
      });
      const verified = await member({ gender: 'man' });
      const unverified = await member({ gender: 'man', verified: false });
      const v = requestDecisionResponseSchema.parse(await ask(verified, plan.id));
      expect(v.request.status).toBe('accepted');
      expect(v.plan?.chatId).toBeTruthy();
      const u = requestDecisionResponseSchema.parse(await ask(unverified, plan.id));
      expect(u.request.status).toBe('pending');
    });

    it('expired requests cannot be accepted', async () => {
      const host = await member({ gender: 'woman' });
      const plan = await postPlan(host);
      const m = await member({ gender: 'man' });
      const r = requestDecisionResponseSchema.parse(await ask(m, plan.id));
      await pool.query(
        `update plan_requests set expires_at = now() - interval '1 minute' where id = $1`,
        [r.request.id],
      );
      expect((await decide(host, r.request.id, 'accept', 409)).code).toBe('request_expired');
    });

    it('leaving frees the seat; cancelling closes waiting requests and tells members', async () => {
      const host = await member({ gender: 'woman' });
      const plan = await postPlan(host, { seatsTotal: 1 });
      const a = await member({ gender: 'man' });
      const b = await member({ gender: 'man' });
      const ra = requestDecisionResponseSchema.parse(await ask(a, plan.id));
      const rb = requestDecisionResponseSchema.parse(await ask(b, plan.id));
      const { plan: full } = requestDecisionResponseSchema.parse(
        await decide(host, ra.request.id, 'accept'),
      );
      const chatId = full!.chatId!;

      const left = requestDecisionResponseSchema.parse(await decide(a, ra.request.id, 'withdraw'));
      expect(left.plan).toMatchObject({ status: 'open', seats: { taken: 0 } });
      await http()
        .get(`/v1/chats/${chatId}/messages`)
        .auth(...auth(a))
        .expect(404);
      const history = messagesResponseSchema.parse(
        (
          await http()
            .get(`/v1/chats/${chatId}/messages`)
            .auth(...auth(host))
            .expect(200)
        ).body,
      );
      expect(history.messages.map((m) => m.body)).toEqual([
        `${a.name} joined the plan.`,
        `${a.name} left the plan.`,
      ]);

      // The seat is free again, so b can be accepted; then the host cancels.
      await decide(host, rb.request.id, 'accept');
      const c = await member({ gender: 'woman' });
      expect((await ask(c, plan.id, {}, 409)).code).toBe('plan_full');
      await http()
        .post(`/v1/plans/${plan.id}/cancel`)
        .auth(...auth(host))
        .expect(200);
      expect(pushes()).toContainEqual(
        expect.objectContaining({
          userIds: [b.id],
          data: { kind: 'plan.cancelled', planId: plan.id },
        }),
      );
      const after = messagesResponseSchema.parse(
        (
          await http()
            .get(`/v1/chats/${chatId}/messages`)
            .auth(...auth(b))
            .expect(200)
        ).body,
      );
      expect(after.messages.at(-1)).toMatchObject({
        kind: 'system',
        body: 'The host cancelled this plan.',
      });
    });

    it('blocking hides plans both ways and declines waiting requests', async () => {
      const host = await member({ gender: 'woman' });
      const plan = await postPlan(host);
      const m = await member({ gender: 'man' });
      const r = requestDecisionResponseSchema.parse(await ask(m, plan.id));
      await http()
        .post('/v1/blocks')
        .auth(...auth(host))
        .send({ userId: m.id })
        .expect(204);
      await http()
        .get(`/v1/plans/${plan.id}`)
        .auth(...auth(m))
        .expect(404);
      const stack = planRequestsResponseSchema.parse(
        (
          await http()
            .get(`/v1/plans/${plan.id}/requests`)
            .auth(...auth(host))
            .expect(200)
        ).body,
      );
      expect(stack.pending.map((p) => p.id)).not.toContain(r.request.id);
      await http()
        .delete(`/v1/blocks/${m.id}`)
        .auth(...auth(host))
        .expect(204);
      await http()
        .get(`/v1/plans/${plan.id}`)
        .auth(...auth(m))
        .expect(200);
    });
  });

  describe('chat', () => {
    let host: Member;
    let guest: Member;
    let outsider: Member;
    let chatId: string;

    beforeAll(async () => {
      host = await member({ gender: 'woman' });
      guest = await member({ gender: 'man' });
      outsider = await member({ gender: 'man' });
      const plan = await postPlan(host);
      const r = requestDecisionResponseSchema.parse(await ask(guest, plan.id));
      chatId = requestDecisionResponseSchema.parse(await decide(host, r.request.id, 'accept')).plan!
        .chatId!;
    });

    /** A connected, authenticated socket that records every frame. */
    async function connect(m: Member) {
      const ws = new WebSocket(wsUrl);
      const frames: ServerFrame[] = [];
      const waiters: { match: (f: ServerFrame) => boolean; resolve: (f: ServerFrame) => void }[] =
        [];
      ws.on('message', (raw) => {
        const frame = serverFrameSchema.parse(JSON.parse(raw.toString()));
        frames.push(frame);
        for (const w of [...waiters]) {
          if (w.match(frame)) {
            waiters.splice(waiters.indexOf(w), 1);
            w.resolve(frame);
          }
        }
      });
      const next = (match: (f: ServerFrame) => boolean) =>
        new Promise<ServerFrame>((resolve, reject) => {
          const seen = frames.find(match);
          if (seen) return resolve(seen);
          const t = setTimeout(() => reject(new Error('timed out waiting for frame')), 5000);
          waiters.push({ match, resolve: (f) => (clearTimeout(t), resolve(f)) });
        });
      await new Promise((resolve) => ws.once('open', resolve));
      ws.send(JSON.stringify({ type: 'auth', token: m.token }));
      await next((f) => f.type === 'ready');
      return { ws, frames, next, send: (f: object) => ws.send(JSON.stringify(f)) };
    }

    it('lists the chat with members and the join line', async () => {
      const res = chatsResponseSchema.parse(
        (
          await http()
            .get('/v1/chats')
            .auth(...auth(guest))
            .expect(200)
        ).body,
      );
      const chat = res.chats.find((c) => c.id === chatId)!;
      expect(chat.members.map((m) => m.userId).sort()).toEqual([host.id, guest.id].sort());
      expect(chat.lastMessage).toMatchObject({
        kind: 'system',
        body: `${guest.name} joined the plan.`,
      });
      expect(chat.plan.activity.slug).toBe('table-tennis');
      await http()
        .get(`/v1/chats/${chatId}`)
        .auth(...auth(outsider))
        .expect(404);
    });

    it('delivers messages over the socket, acks the sender and skips push for online members', async () => {
      const h = await connect(host);
      const g = await connect(guest);
      const clientId = randomUUID();
      const before = pushes().length;
      g.send({ type: 'send', chatId, clientId, body: 'See you at 7!' });

      const ack = await g.next((f) => f.type === 'ack');
      expect(ack).toMatchObject({ type: 'ack', clientId, message: { body: 'See you at 7!' } });
      const delivered = await h.next(
        (f) => f.type === 'message' && f.message.clientId === clientId,
      );
      expect(delivered).toMatchObject({ message: { senderId: guest.id, chatId } });
      expect(pushes()).toHaveLength(before);

      // A retry with the same clientId returns the same message, not a copy.
      g.send({ type: 'send', chatId, clientId, body: 'See you at 7!' });
      const again = (await g.next(
        (f) => f.type === 'ack' && f !== ack && f.clientId === clientId,
      )) as Extract<ServerFrame, { type: 'ack' }>;
      expect(again.message.id).toBe((ack as Extract<ServerFrame, { type: 'ack' }>).message.id);

      h.send({ type: 'read', chatId, messageId: again.message.id });
      await g.next((f) => f.type === 'read' && f.userId === host.id);
      const list = chatsResponseSchema.parse(
        (
          await http()
            .get('/v1/chats')
            .auth(...auth(host))
            .expect(200)
        ).body,
      );
      expect(list.chats.find((c) => c.id === chatId)?.unread).toBe(0);

      h.ws.close();
      g.ws.close();
    });

    it('pushes members who are offline, via REST send', async () => {
      // Make sure the host has no live sockets left from the previous test.
      await redis.del(`presence:${host.id}`);
      const res = await http()
        .post(`/v1/chats/${chatId}/messages`)
        .auth(...auth(guest))
        .send({ clientId: randomUUID(), body: 'Running 5 min late' })
        .expect(201);
      expect(res.body).toMatchObject({ body: 'Running 5 min late', senderId: guest.id });
      expect(pushes().at(-1)).toMatchObject({
        userIds: [host.id],
        body: 'Running 5 min late',
        data: { kind: 'chat.message', chatId },
        collapseKey: `chat:${chatId}`,
      });

      const unread = chatsResponseSchema.parse(
        (
          await http()
            .get('/v1/chats')
            .auth(...auth(host))
            .expect(200)
        ).body,
      );
      expect(unread.chats.find((c) => c.id === chatId)?.unread).toBe(1);
    });

    it('pages history and catches up after a given id', async () => {
      const all = messagesResponseSchema.parse(
        (
          await http()
            .get(`/v1/chats/${chatId}/messages`)
            .auth(...auth(host))
            .expect(200)
        ).body,
      );
      expect(all.messages.length).toBeGreaterThanOrEqual(3);
      const first = all.messages[0]!.id;
      const after = messagesResponseSchema.parse(
        (
          await http()
            .get(`/v1/chats/${chatId}/messages`)
            .query({ after: first })
            .auth(...auth(host))
            .expect(200)
        ).body,
      );
      expect(after.messages.map((m) => m.id)).toEqual(all.messages.slice(1).map((m) => m.id));
      const older = messagesResponseSchema.parse(
        (
          await http()
            .get(`/v1/chats/${chatId}/messages`)
            .query({ before: all.messages[1]!.id, limit: 1 })
            .auth(...auth(host))
            .expect(200)
        ).body,
      );
      expect(older.messages.map((m) => m.id)).toEqual([first]);
    });

    it('refuses sockets that do not authenticate, and outsiders', async () => {
      const bad = new WebSocket(wsUrl);
      await new Promise((r) => bad.once('open', r));
      bad.send(JSON.stringify({ type: 'auth', token: 'not-a-token' }));
      const code = await new Promise<number>((r) => bad.once('close', (c) => r(c)));
      expect(code).toBe(4401);

      const o = await connect(outsider);
      const clientId = randomUUID();
      o.send({ type: 'send', chatId, clientId, body: 'hi' });
      expect(await o.next((f) => f.type === 'error')).toMatchObject({
        code: 'not_found',
        clientId,
      });
      o.ws.close();
    });
  });
});
