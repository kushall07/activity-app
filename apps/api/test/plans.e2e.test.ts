/**
 * Posting plans and the Explore feed against real Postgres + PostGIS and Redis.
 * The feed cases run twice: on the PostGIS path, and on OpenSearch when
 * OPENSEARCH_URL is set (docker compose / CI), so both paths give the same answers.
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  activitiesResponseSchema,
  feedResponseSchema,
  planSchema,
  startOtpResponseSchema,
  verifyOtpResponseSchema,
  type CreatePlanRequest,
  type Plan,
} from '@activity/shared';
import {
  createSearchClient,
  ensurePlansIndex,
  indexPlan,
  deletePlan,
  isSearchable,
  PLANS_ALIAS,
  toPlanDocument,
  type SearchClient,
} from '@activity/search';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import { JobsService } from '../src/common/jobs.service.js';
import { StorageService } from '../src/common/storage.service.js';
import { PG_POOL } from '../src/database/database.constants.js';
import { SEARCH_CLIENT } from '../src/plans/search.module.js';
import { FakeJobs, FakeStorage } from './fakes.js';

const OPENSEARCH_URL = process.env.OPENSEARCH_URL;
const randomPhone = () => `+9199${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const hours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

type Mode = 'postgres' | 'opensearch' | 'opensearch-down';

function suite(mode: Mode) {
  describe(`plans and feed (${mode})`, () => {
    let app: NestExpressApplication;
    let pool: pg.Pool;
    let search: SearchClient | null = null;
    const jobs = new FakeJobs();
    const http = () => request(app.getHttpServer());

    // Each run works around its own random spot in Bengaluru, so leftovers from
    // earlier runs (the test DB is shared) are out of range.
    const base = { lat: 12.78 + Math.random() * 0.4, lng: 77.36 + Math.random() * 0.45 };
    const near = (dLatKm = 0) => ({ lat: base.lat + dLatKm / 111, lng: base.lng });

    /** Stands in for the worker: syncs every plan whose version is not indexed yet. */
    async function syncIndex() {
      if (mode !== 'opensearch' || !search) return;
      const { rows } = await pool.query(`
        select p.*, a.category, ST_Y(p.location::geometry) as lat, ST_X(p.location::geometry) as lng
        from plans p join activities a on a.slug = p.activity_slug
        where p.version > p.indexed_version`);
      for (const r of rows) {
        const row = {
          id: r.id,
          hostId: r.host_id,
          activitySlug: r.activity_slug,
          category: r.category,
          lat: Number(r.lat),
          lng: Number(r.lng),
          startsAt: r.starts_at,
          durationMinutes: r.duration_minutes,
          status: r.status,
          seatsTotal: r.seats_total,
          seatsTaken: r.seats_taken,
          wantedGenders: parsePgArray(r.wanted_genders),
          ageMin: r.age_min,
          ageMax: r.age_max,
          intent: r.intent,
          verifiedOnly: r.verified_only,
          costPerPersonInr: r.cost_per_person_inr,
          skillLevel: r.skill_level,
          createdAt: r.created_at,
        };
        if (isSearchable(row)) await indexPlan(search, toPlanDocument(row), r.version);
        else await deletePlan(search, r.id);
        await pool.query('update plans set indexed_version = $2 where id = $1', [r.id, r.version]);
      }
      await search.indices.refresh({ index: PLANS_ALIAS });
    }

    interface Member {
      token: string;
      id: string;
    }

    async function member(opts: {
      gender: 'woman' | 'man' | 'nonbinary';
      birthDate?: string;
      verified?: boolean;
      photos?: number;
    }): Promise<Member> {
      const phone = randomPhone();
      const start = await http().post('/v1/auth/otp/start').send({ phone }).expect(200);
      const { challengeId } = startOtpResponseSchema.parse(start.body);
      const verify = await http()
        .post('/v1/auth/otp/verify')
        .send({ challengeId, code: '000000' })
        .expect(200);
      const { accessToken, user } = verifyOtpResponseSchema.parse(verify.body);
      await pool.query(
        `insert into profiles (user_id, display_name, birth_date, gender, verified_at)
         values ($1, $2, $3, $4, $5)`,
        [
          user.id,
          `Member ${user.id.slice(0, 4)}`,
          opts.birthDate ?? '1996-01-01',
          opts.gender,
          opts.verified === false ? null : new Date(),
        ],
      );
      for (let i = 0; i < (opts.photos ?? 3); i++) {
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
      return { token: accessToken, id: user.id };
    }

    const plan = (overrides: Partial<CreatePlanRequest> = {}): CreatePlanRequest => ({
      activitySlug: 'badminton',
      place: { name: 'Community court', area: 'Koramangala', ...near() },
      startsAt: hours(26),
      durationMinutes: 90,
      seatsTotal: 3,
      wantedGenders: ['woman', 'man'],
      skillLevel: 'intermediate',
      costSplit: 'split_equally',
      costPerPersonInr: 300,
      note: 'Doubles, bring your own racket.',
      ...overrides,
    });

    async function post(host: Member, body: CreatePlanRequest, status = 201) {
      const res = await http().post('/v1/plans').auth(host.token, { type: 'bearer' }).send(body);
      expect(res.status, JSON.stringify(res.body)).toBe(status);
      await syncIndex();
      return res;
    }

    async function feed(viewer: Member, query: Record<string, string | number> = {}) {
      const res = await http()
        .get('/v1/plans')
        .query({ lat: base.lat, lng: base.lng, radiusKm: 2, ...query })
        .auth(viewer.token, { type: 'bearer' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return feedResponseSchema.parse(res.body);
    }
    const ids = (plans: Plan[]) => plans.map((p) => p.id);

    let host: Member;

    beforeAll(async () => {
      let builder = Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(StorageService)
        .useValue(new FakeStorage())
        .overrideProvider(JobsService)
        .useValue(jobs);
      if (mode === 'opensearch') {
        search = createSearchClient({ node: OPENSEARCH_URL!, auth: 'none', region: 'ap-south-1' });
        await ensurePlansIndex(search, 0);
        builder = builder.overrideProvider(SEARCH_CLIENT).useValue(search);
      } else if (mode === 'postgres') {
        builder = builder.overrideProvider(SEARCH_CLIENT).useValue(null);
      } else if (mode === 'opensearch-down') {
        builder = builder.overrideProvider(SEARCH_CLIENT).useValue(
          createSearchClient({
            node: 'http://127.0.0.1:1',
            auth: 'none',
            region: 'ap-south-1',
            requestTimeoutMs: 300,
          }),
        );
      }
      app = (await builder.compile()).createNestApplication<NestExpressApplication>({
        logger: false,
      });
      configureApp(app);
      await app.init();
      pool = app.get<pg.Pool>(PG_POOL);
      host = await member({ gender: 'woman', birthDate: '1994-06-01' });
    });

    afterAll(async () => {
      await app?.close();
      await search?.close();
    });

    describe('catalogue', () => {
      it('lists the launch activities', async () => {
        const res = await http()
          .get('/v1/activities')
          .auth(host.token, { type: 'bearer' })
          .expect(200);
        const { activities } = activitiesResponseSchema.parse(res.body);
        expect(activities.map((a) => a.slug)).toEqual(
          expect.arrayContaining(['badminton', 'table-tennis', 'comedy', 'pottery', 'dinner']),
        );
        expect(res.headers['cache-control']).toMatch(/max-age/);
      });
    });

    describe('posting', () => {
      it('posts a plan at a named place and returns it', async () => {
        const res = await post(host, plan());
        const created = planSchema.parse(res.body);
        expect(created).toMatchObject({
          activity: { slug: 'badminton', category: 'sport' },
          place: { venueId: null, name: 'Community court', area: 'Koramangala' },
          seats: { total: 3, taken: 0, open: 3 },
          status: 'open',
          isMine: true,
          host: { userId: host.id, gender: 'woman', verified: true },
        });
        expect(created.host.photoUrl).toMatch(/thumb\.jpg$/);
        expect(created.place.lat).toBeCloseTo(base.lat, 5);
        if (mode === 'opensearch') {
          expect(jobs.enqueued).toContainEqual(
            expect.objectContaining({
              type: 'plan.index',
              payload: { planId: created.id, version: 1 },
            }),
          );
        }
      });

      it('uses a listed venue for the place', async () => {
        const { rows } = await pool.query(
          `insert into venues (name, area, location, activity_slugs)
           values ('Smash Arena', 'HSR Layout', ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, '{badminton}')
           returning id`,
          [base.lat, base.lng],
        );
        const venueId = rows[0].id as string;
        const venues = await http()
          .get('/v1/venues')
          .query({ q: 'smash', activity: 'badminton', lat: base.lat, lng: base.lng })
          .auth(host.token, { type: 'bearer' })
          .expect(200);
        expect(venues.body.venues[0]).toMatchObject({ id: venueId, distanceKm: 0 });

        const res = await post(host, plan({ place: null, venueId }));
        expect(res.body.place).toMatchObject({ venueId, name: 'Smash Arena', area: 'HSR Layout' });
      });

      it('requires a verified, complete profile', async () => {
        const unverified = await member({ gender: 'man', verified: false });
        const res = await post(unverified, plan(), 403);
        expect(res.body.code).toBe('verification_required');

        const noPhotos = await member({ gender: 'man', photos: 1 });
        expect((await post(noPhotos, plan(), 403)).body.code).toBe('profile_incomplete');
      });

      it('rejects contact details, bad times and places outside Bengaluru', async () => {
        const phone = await post(host, plan({ note: 'WhatsApp me on 98765 43210' }), 400);
        expect(phone.body.message).toMatch(/phone numbers/);
        const soon = await post(host, plan({ startsAt: hours(0.1) }), 400);
        expect(soon.body.code).toBe('invalid_start_time');
        const far = await post(
          host,
          plan({ place: { name: 'Somewhere', area: 'Koramangala', lat: 19.07, lng: 72.87 } }),
          400,
        );
        expect(far.body.message).toMatch(/Bengaluru/);
        const mix = await post(host, plan({ seatsTotal: 3, genderMix: { woman: 1, man: 1 } }), 400);
        expect(mix.body.message).toMatch(/add up/);
      });

      it('caps upcoming plans per host', async () => {
        const busy = await member({ gender: 'man' });
        for (let i = 0; i < 5; i++) await post(busy, plan({ startsAt: hours(30 + i) }));
        const res = await post(busy, plan(), 409);
        expect(res.body.code).toBe('too_many_plans');
      });
    });

    describe('Explore feed', () => {
      let forWomen: Plan;
      let verifiedOnly: Plan;
      let comedy: Plan;
      let viewer: Member;

      beforeAll(async () => {
        viewer = await member({ gender: 'woman', birthDate: '1997-03-03' });
        forWomen = planSchema.parse(
          (
            await post(
              host,
              plan({ wantedGenders: ['woman'], ageMin: 25, ageMax: 35, startsAt: hours(5) }),
            )
          ).body,
        );
        verifiedOnly = planSchema.parse(
          (await post(host, plan({ verifiedOnly: true, startsAt: hours(6), intent: 'friends' })))
            .body,
        );
        comedy = planSchema.parse(
          (
            await post(
              host,
              plan({
                activitySlug: 'comedy',
                place: { name: 'Corner club', area: 'Indiranagar', ...near(1.5) },
                startsAt: hours(48),
                costSplit: 'each_pays_own',
                costPerPersonInr: 800,
                intent: 'date',
              }),
            )
          ).body,
        );
      });

      it('shows plans to the audience the host chose', async () => {
        const seen = ids((await feed(viewer)).plans);
        expect(seen).toEqual(expect.arrayContaining([forWomen.id, verifiedOnly.id, comedy.id]));

        const man = await member({ gender: 'man' });
        expect(ids((await feed(man)).plans)).not.toContain(forWomen.id);

        const older = await member({ gender: 'woman', birthDate: '1980-01-01' });
        expect(ids((await feed(older)).plans)).not.toContain(forWomen.id);

        const unverified = await member({ gender: 'woman', verified: false });
        const unverifiedSees = ids((await feed(unverified)).plans);
        expect(unverifiedSees).not.toContain(verifiedOnly.id);
        expect(unverifiedSees).toContain(forWomen.id);
      });

      it('never shows the host their own plans', async () => {
        expect(ids((await feed(host)).plans)).not.toContain(forWomen.id);
      });

      it('filters by distance, activity, category, time, intent and budget', async () => {
        const within1km = ids((await feed(viewer, { radiusKm: 1 })).plans);
        expect(within1km).toContain(forWomen.id);
        expect(within1km).not.toContain(comedy.id); // 1.5 km north

        expect(ids((await feed(viewer, { activities: 'comedy' })).plans)).toEqual([comedy.id]);
        expect(ids((await feed(viewer, { categories: 'show' })).plans)).toEqual([comedy.id]);
        expect(ids((await feed(viewer, { from: hours(24) })).plans)).toEqual(
          expect.arrayContaining([comedy.id]),
        );
        expect(ids((await feed(viewer, { to: hours(10) })).plans)).not.toContain(comedy.id);

        const friends = ids((await feed(viewer, { intent: 'friends' })).plans);
        expect(friends).toContain(verifiedOnly.id);
        expect(friends).toContain(forWomen.id); // intent "either" matches both
        expect(friends).not.toContain(comedy.id);

        const budget = ids((await feed(viewer, { maxCostInr: 500 })).plans);
        expect(budget).toContain(forWomen.id);
        expect(budget).not.toContain(comedy.id);
      });

      it('sorts by start time or distance', async () => {
        const soonest = (await feed(viewer)).plans;
        const starts = soonest.map((p) => Date.parse(p.startsAt));
        expect(starts).toEqual([...starts].sort((a, b) => a - b));

        const nearest = (await feed(viewer, { sort: 'nearest' })).plans;
        const dists = nearest.map((p) => p.distanceKm!);
        expect(dists).toEqual([...dists].sort((a, b) => a - b));
        expect(nearest.at(-1)!.id).toBe(comedy.id);
        expect(nearest.at(-1)!.distanceKm).toBeCloseTo(1.5, 1);
      });

      it('pages with a stable cursor', async () => {
        for (const sort of ['soonest', 'nearest'] as const) {
          const all = ids((await feed(viewer, { sort, limit: 50 })).plans);
          expect(all.length).toBeGreaterThanOrEqual(3);
          const paged: string[] = [];
          let cursor: string | null = null;
          do {
            const page = await feed(viewer, { sort, limit: 2, ...(cursor ? { cursor } : {}) });
            paged.push(...ids(page.plans));
            cursor = page.nextCursor;
          } while (cursor);
          expect(paged).toEqual(all);
        }
      });

      it('rejects a tampered cursor', async () => {
        const res = await http()
          .get('/v1/plans')
          .query({ lat: base.lat, lng: base.lng, cursor: 'not-a-cursor' })
          .auth(viewer.token, { type: 'bearer' })
          .expect(400);
        expect(res.body.code).toBe('invalid_cursor');
      });

      it('needs a complete profile to browse', async () => {
        const incomplete = await member({ gender: 'man', photos: 0 });
        const res = await http()
          .get('/v1/plans')
          .query({ lat: base.lat, lng: base.lng })
          .auth(incomplete.token, { type: 'bearer' })
          .expect(403);
        expect(res.body.code).toBe('profile_incomplete');
      });
    });

    describe('details, edits and cancelling', () => {
      // A host of their own: the shared host is at the cap on upcoming plans by now.
      let editor: Member;
      beforeAll(async () => {
        editor = await member({ gender: 'woman', birthDate: '1993-09-09' });
      });

      it('shows details to the audience only', async () => {
        const p = planSchema.parse(
          (await post(editor, plan({ wantedGenders: ['woman'], startsAt: hours(8) }))).body,
        );
        const woman = await member({ gender: 'woman' });
        const man = await member({ gender: 'man' });
        const seen = await http()
          .get(`/v1/plans/${p.id}`)
          .query(near(1))
          .auth(woman.token, { type: 'bearer' })
          .expect(200);
        expect(seen.body).toMatchObject({ id: p.id, isMine: false });
        expect(seen.body.distanceKm).toBeCloseTo(1, 1);
        await http().get(`/v1/plans/${p.id}`).auth(man.token, { type: 'bearer' }).expect(404);
        const own = await http()
          .get(`/v1/plans/${p.id}`)
          .auth(editor.token, { type: 'bearer' })
          .expect(200);
        expect(own.body.isMine).toBe(true);
      });

      it('lets the editor edit, re-validating the merged plan', async () => {
        const p = planSchema.parse((await post(editor, plan({ startsAt: hours(9) }))).body);
        const viewer = await member({ gender: 'woman' });
        expect(ids((await feed(viewer)).plans)).toContain(p.id);

        const edited = await http()
          .patch(`/v1/plans/${p.id}`)
          .auth(editor.token, { type: 'bearer' })
          .send({ seatsTotal: 1, wantedGenders: ['man'], note: 'Singles instead' })
          .expect(200);
        expect(edited.body).toMatchObject({ seats: { total: 1 }, wantedGenders: ['man'] });
        await syncIndex();
        expect(ids((await feed(viewer)).plans)).not.toContain(p.id);

        const bad = await http()
          .patch(`/v1/plans/${p.id}`)
          .auth(editor.token, { type: 'bearer' })
          .send({ ageMin: 40, ageMax: 30 })
          .expect(400);
        expect(bad.body.message).toMatch(/Age range/);

        await http()
          .patch(`/v1/plans/${p.id}`)
          .auth(viewer.token, { type: 'bearer' })
          .send({ note: 'hijack' })
          .expect(404);
        await http()
          .patch(`/v1/plans/${p.id}`)
          .auth(editor.token, { type: 'bearer' })
          .send({ activitySlug: 'tennis' })
          .expect(400);
      });

      it('cancels a plan, hides it and lists it under past plans', async () => {
        const p = planSchema.parse((await post(editor, plan({ startsAt: hours(10) }))).body);
        const viewer = await member({ gender: 'man' });
        expect(ids((await feed(viewer)).plans)).toContain(p.id);

        const res = await http()
          .post(`/v1/plans/${p.id}/cancel`)
          .auth(editor.token, { type: 'bearer' })
          .expect(200);
        expect(res.body.status).toBe('cancelled');
        await syncIndex();
        expect(ids((await feed(viewer)).plans)).not.toContain(p.id);
        await http().get(`/v1/plans/${p.id}`).auth(viewer.token, { type: 'bearer' }).expect(404);
        // Idempotent.
        await http()
          .post(`/v1/plans/${p.id}/cancel`)
          .auth(editor.token, { type: 'bearer' })
          .expect(200);
        await http()
          .patch(`/v1/plans/${p.id}`)
          .auth(editor.token, { type: 'bearer' })
          .send({ note: 'back on?' })
          .expect(409);

        const upcoming = await http()
          .get('/v1/me/plans')
          .auth(editor.token, { type: 'bearer' })
          .expect(200);
        expect(ids(upcoming.body.plans)).not.toContain(p.id);
        const past = await http()
          .get('/v1/me/plans')
          .query({ scope: 'past' })
          .auth(editor.token, { type: 'bearer' })
          .expect(200);
        expect(ids(past.body.plans)).toContain(p.id);
      });
    });
  });
}

/** node-postgres returns enum arrays as the raw literal, e.g. `{woman,man}`. */
function parsePgArray(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[];
  return String(v).replace(/^{|}$/g, '').split(',').filter(Boolean);
}

suite('postgres');
if (OPENSEARCH_URL) {
  suite('opensearch');
  suite('opensearch-down');
}
