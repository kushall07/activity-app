/**
 * Login, profile and photo flows against real Postgres + Redis, with the dev OTP
 * provider (no SMS) and in-memory fakes for S3 and SQS. Requires migrations.
 */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  createPhotoUploadResponseSchema,
  meResponseSchema,
  publicProfileSchema,
  startOtpResponseSchema,
  verifyOtpResponseSchema,
} from '@activity/shared';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import { JobsService } from '../src/common/jobs.service.js';
import { StorageService } from '../src/common/storage.service.js';
import { PG_POOL } from '../src/database/database.constants.js';
import { REDIS } from '../src/redis/redis.constants.js';
import { FakeJobs, FakeStorage } from './fakes.js';

const randomPhone = () => `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

describe('Auth, profiles and photos (e2e)', () => {
  let app: NestExpressApplication;
  let pool: pg.Pool;
  const storage = new FakeStorage();
  const jobs = new FakeJobs();
  const http = () => request(app.getHttpServer());

  async function login(phone = randomPhone()) {
    const start = await http().post('/v1/auth/otp/start').send({ phone }).expect(200);
    const { challengeId } = startOtpResponseSchema.parse(start.body);
    const verify = await http()
      .post('/v1/auth/otp/verify')
      .send({ challengeId, code: '000000' })
      .expect(200);
    return { phone, ...verifyOtpResponseSchema.parse(verify.body) };
  }

  /** Stands in for the worker: marks the photo approved with a public prefix. */
  async function approve(photoId: string, userId: string) {
    await pool.query(`update photos set status = 'approved', public_prefix = $2 where id = $1`, [
      photoId,
      `public/photos/${userId}/${photoId}`,
    ]);
  }

  async function addApprovedPhoto(token: string, userId: string) {
    const res = await http()
      .post('/v1/me/photos')
      .auth(token, { type: 'bearer' })
      .send({ contentType: 'image/jpeg', contentLength: 200_000 })
      .expect(201);
    const { photo, upload } = createPhotoUploadResponseSchema.parse(res.body);
    storage.put(upload.fields.key!);
    await http()
      .post(`/v1/me/photos/${photo.id}/complete`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    await approve(photo.id, userId);
    return photo.id;
  }

  const profile = {
    displayName: 'Ananya',
    birthDate: '1996-04-12',
    gender: 'woman',
    intent: 'friends',
    bio: 'Weekend badminton, terrible at karaoke.',
    interests: ['Badminton', 'comedy', 'badminton'],
    neighbourhood: 'Indiranagar',
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(storage)
      .overrideProvider(JobsService)
      .useValue(jobs)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app);
    await app.init();
    pool = app.get<pg.Pool>(PG_POOL);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('phone OTP login', () => {
    it('creates an account on first login and reuses it after', async () => {
      const first = await login();
      expect(first.user.isNew).toBe(true);
      expect(first.accessToken).toBeTruthy();

      // Second login for the same number has to wait out the resend cooldown; clear it.
      await app.get<Redis>(REDIS).del(`cooldown:otp:${first.phone}`);

      const second = await login(first.phone);
      expect(second.user).toEqual({ id: first.user.id, isNew: false });
    });

    it('rejects a wrong code without burning the challenge', async () => {
      const start = await http()
        .post('/v1/auth/otp/start')
        .send({ phone: randomPhone() })
        .expect(200);
      const { challengeId } = startOtpResponseSchema.parse(start.body);
      const wrong = await http()
        .post('/v1/auth/otp/verify')
        .send({ challengeId, code: '123456' })
        .expect(400);
      expect(wrong.body.code).toBe('otp_invalid_code');
      await http().post('/v1/auth/otp/verify').send({ challengeId, code: '000000' }).expect(200);
      // A used challenge cannot be replayed.
      const replay = await http()
        .post('/v1/auth/otp/verify')
        .send({ challengeId, code: '000000' })
        .expect(410);
      expect(replay.body.code).toBe('otp_expired');
    });

    it('locks a challenge after too many wrong codes', async () => {
      const start = await http()
        .post('/v1/auth/otp/start')
        .send({ phone: randomPhone() })
        .expect(200);
      const { challengeId } = startOtpResponseSchema.parse(start.body);
      for (let i = 0; i < 5; i++) {
        await http().post('/v1/auth/otp/verify').send({ challengeId, code: '111111' }).expect(400);
      }
      const locked = await http()
        .post('/v1/auth/otp/verify')
        .send({ challengeId, code: '000000' })
        .expect(410);
      expect(locked.body.code).toBe('otp_too_many_attempts');
    });

    it('enforces the resend cooldown with Retry-After', async () => {
      const phone = randomPhone();
      await http().post('/v1/auth/otp/start').send({ phone }).expect(200);
      const again = await http().post('/v1/auth/otp/start').send({ phone }).expect(429);
      expect(again.body.code).toBe('rate_limited');
      expect(Number(again.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('only accepts supported country codes and valid numbers', async () => {
      const us = await http()
        .post('/v1/auth/otp/start')
        .send({ phone: '+14155550123' })
        .expect(400);
      expect(us.body.code).toBe('phone_not_supported');
      const junk = await http().post('/v1/auth/otp/start').send({ phone: '98765' }).expect(400);
      expect(junk.body.code).toBe('invalid_request');
    });

    it('refreshes tokens and rejects garbage refresh tokens', async () => {
      const { refreshToken } = await login();
      const res = await http().post('/v1/auth/refresh').send({ refreshToken }).expect(200);
      expect(res.body.accessToken).toBeTruthy();
      await http().get('/v1/me').auth(res.body.accessToken, { type: 'bearer' }).expect(200);
      const bad = await http().post('/v1/auth/refresh').send({ refreshToken: 'nope' }).expect(401);
      expect(bad.body.code).toBe('session_expired');
    });

    it('protects routes by default', async () => {
      await http().get('/v1/me').expect(401);
      await http().get('/v1/me').auth('not-a-jwt', { type: 'bearer' }).expect(401);
      await http().get('/health').expect(200);
    });
  });

  describe('profile onboarding', () => {
    it('walks a new member from no profile to a complete, public profile', async () => {
      const { accessToken: token, user } = await login();

      let me = meResponseSchema.parse(
        (await http().get('/v1/me').auth(token, { type: 'bearer' }).expect(200)).body,
      );
      expect(me.onboarding).toEqual({
        hasProfile: false,
        approvedPhotos: 0,
        minPhotos: 3,
        complete: false,
      });

      const saved = await http()
        .put('/v1/me/profile')
        .auth(token, { type: 'bearer' })
        .send(profile)
        .expect(200);
      expect(saved.body.interests).toEqual(['badminton', 'comedy']);
      expect(saved.body.age).toBeGreaterThanOrEqual(18);

      // Not visible to others until it has enough approved photos.
      await http().get(`/v1/users/${user.id}/profile`).auth(token, { type: 'bearer' }).expect(404);

      for (let i = 0; i < 3; i++) await addApprovedPhoto(token, user.id);
      expect(jobs.enqueued.filter((j) => j.type === 'photo.process').length).toBeGreaterThanOrEqual(
        3,
      );

      me = meResponseSchema.parse(
        (await http().get('/v1/me').auth(token, { type: 'bearer' }).expect(200)).body,
      );
      expect(me.onboarding.complete).toBe(true);
      expect(me.photos.map((p) => p.position)).toEqual([0, 1, 2]);
      expect(me.photos[0]?.urls?.full).toMatch(/^https:\/\/cdn\.e2e\.test\/public\/photos\//);

      const viewer = await login();
      const pub = publicProfileSchema.parse(
        (
          await http()
            .get(`/v1/users/${user.id}/profile`)
            .auth(viewer.accessToken, { type: 'bearer' })
            .expect(200)
        ).body,
      );
      expect(pub.displayName).toBe('Ananya');
      expect(pub.photos).toHaveLength(3);
      expect(pub).not.toHaveProperty('birthDate');
      expect(JSON.stringify(pub)).not.toContain(me.user.phone);
    });

    it('rejects under-18 members', async () => {
      const { accessToken } = await login();
      const year = new Date().getUTCFullYear() - 17;
      const res = await http()
        .put('/v1/me/profile')
        .auth(accessToken, { type: 'bearer' })
        .send({ ...profile, birthDate: `${year}-01-01` })
        .expect(400);
      expect(res.body.message).toMatch(/at least 18/);
    });
  });

  describe('photos', () => {
    it('requires the upload to exist before processing', async () => {
      const { accessToken: token } = await login();
      const res = await http()
        .post('/v1/me/photos')
        .auth(token, { type: 'bearer' })
        .send({ contentType: 'image/png', contentLength: 1000 })
        .expect(201);
      const { photo, upload } = createPhotoUploadResponseSchema.parse(res.body);
      expect(upload.fields['Content-Type']).toBe('image/png');
      const missing = await http()
        .post(`/v1/me/photos/${photo.id}/complete`)
        .auth(token, { type: 'bearer' })
        .expect(409);
      expect(missing.body.code).toBe('upload_missing');
    });

    it('rejects oversized and non-image uploads up front', async () => {
      const { accessToken: token } = await login();
      await http()
        .post('/v1/me/photos')
        .auth(token, { type: 'bearer' })
        .send({ contentType: 'image/jpeg', contentLength: 50 * 1024 * 1024 })
        .expect(400);
      await http()
        .post('/v1/me/photos')
        .auth(token, { type: 'bearer' })
        .send({ contentType: 'application/pdf', contentLength: 1000 })
        .expect(400);
    });

    it('caps photos at six', async () => {
      const { accessToken: token, user } = await login();
      for (let i = 0; i < 6; i++) await addApprovedPhoto(token, user.id);
      const res = await http()
        .post('/v1/me/photos')
        .auth(token, { type: 'bearer' })
        .send({ contentType: 'image/jpeg', contentLength: 1000 })
        .expect(409);
      expect(res.body.code).toBe('photo_limit');
    });

    it('reorders, keeps the minimum and deletes stored files', async () => {
      const { accessToken: token, user } = await login();
      const ids = [];
      for (let i = 0; i < 4; i++) ids.push(await addApprovedPhoto(token, user.id));

      const reordered = await http()
        .put('/v1/me/photos/order')
        .auth(token, { type: 'bearer' })
        .send({ photoIds: [...ids].reverse() })
        .expect(200);
      expect(reordered.body.photos.map((p: { id: string }) => p.id)).toEqual([...ids].reverse());

      await http()
        .put('/v1/me/photos/order')
        .auth(token, { type: 'bearer' })
        .send({ photoIds: ids.slice(0, 2) })
        .expect(400);

      const afterDelete = await http()
        .delete(`/v1/me/photos/${ids[0]}`)
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(afterDelete.body.photos).toHaveLength(3);
      expect(afterDelete.body.photos.map((p: { position: number }) => p.position)).toEqual([
        0, 1, 2,
      ]);
      expect(storage.deleted).toContain(`public/photos/${user.id}/${ids[0]}/full.jpg`);

      const blocked = await http()
        .delete(`/v1/me/photos/${ids[1]}`)
        .auth(token, { type: 'bearer' })
        .expect(409);
      expect(blocked.body.code).toBe('min_photos');
    });

    it("cannot touch another member's photos", async () => {
      const owner = await login();
      const photoId = await addApprovedPhoto(owner.accessToken, owner.user.id);
      const other = await login();
      await http()
        .delete(`/v1/me/photos/${photoId}`)
        .auth(other.accessToken, { type: 'bearer' })
        .expect(404);
    });
  });

  describe('selfie verification', () => {
    it('needs a profile and a photo, then queues the check', async () => {
      const { accessToken: token, user } = await login();
      const noProfile = await http()
        .post('/v1/me/verification/selfie')
        .auth(token, { type: 'bearer' })
        .expect(409);
      expect(noProfile.body.code).toBe('needs_profile');

      await http().put('/v1/me/profile').auth(token, { type: 'bearer' }).send(profile).expect(200);
      const noPhotos = await http()
        .post('/v1/me/verification/selfie')
        .auth(token, { type: 'bearer' })
        .expect(409);
      expect(noPhotos.body.code).toBe('needs_photos');

      await addApprovedPhoto(token, user.id);
      const created = await http()
        .post('/v1/me/verification/selfie')
        .auth(token, { type: 'bearer' })
        .expect(201);
      const { verificationId, upload } = created.body;
      expect(upload.fields.key).toBe(`verification/${user.id}/${verificationId}`);
      storage.put(upload.fields.key);

      const done = await http()
        .post(`/v1/me/verification/selfie/${verificationId}/complete`)
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(done.body.status).toBe('processing');
      expect(jobs.enqueued).toContainEqual(
        expect.objectContaining({ type: 'selfie.verify', payload: { verificationId } }),
      );

      const me = meResponseSchema.parse(
        (await http().get('/v1/me').auth(token, { type: 'bearer' }).expect(200)).body,
      );
      expect(me.verification.status).toBe('processing');
    });
  });

  describe('account deletion', () => {
    it('deletes the member and queues storage purge', async () => {
      const { accessToken: token, user } = await login();
      await http().put('/v1/me/profile').auth(token, { type: 'bearer' }).send(profile).expect(200);
      await http().delete('/v1/me').auth(token, { type: 'bearer' }).expect(204);
      await http().get('/v1/me').auth(token, { type: 'bearer' }).expect(401);
      const { rows } = await pool.query('select 1 from profiles where user_id = $1', [user.id]);
      expect(rows).toHaveLength(0);
      expect(jobs.enqueued).toContainEqual(
        expect.objectContaining({ type: 'user.purge', payload: { userId: user.id } }),
      );
    });
  });
});
