/**
 * Job handlers against real Postgres (migrations applied) with an in-memory
 * object store and fake Rekognition.
 */
import { randomUUID } from 'node:crypto';
import { photos, profiles, selfieVerifications, users } from '@activity/db';
import { storageKeys, type JobEnvelope } from '@activity/shared';
import type { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/config/env.js';
import { createDb, createPool, type Database } from '../src/infra/database.js';
import { PhotoProcessHandler } from '../src/jobs/photo-process.handler.js';
import { SelfieVerifyHandler } from '../src/jobs/selfie-verify.handler.js';
import { UserPurgeHandler } from '../src/jobs/user-purge.handler.js';
import { PlanIndexer } from '../src/search/plan-indexer.js';
import { FakeModeration, MemoryStore } from './fakes.js';

const pool = createPool({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://activity:activity@localhost:5432/activity',
  DATABASE_POOL_MAX: 2,
  DATABASE_SSL: false,
});
const db: Database = createDb(pool);
const config = { get: () => 95 } as unknown as ConfigService<Env, true>;

const job = (type: string, payload: unknown): JobEnvelope => ({
  type,
  id: randomUUID(),
  createdAt: new Date().toISOString(),
  payload,
});

const jpeg = (w = 1200, h = 1200) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#4a7' } })
    .withExif({ IFD3: { GPSLatitudeRef: 'N' } })
    .jpeg()
    .toBuffer();

describe('worker job handlers (e2e)', () => {
  let store: MemoryStore;
  let moderation: FakeModeration;
  let userId: string;

  async function processingPhoto(body?: Buffer) {
    const id = randomUUID();
    const uploadKey = storageKeys.photoUpload(userId, id);
    await db.insert(photos).values({ id, userId, uploadKey, position: 0, status: 'processing' });
    if (body) await store.put(uploadKey, body, 'image/jpeg');
    return { id, uploadKey };
  }

  const photoRow = async (id: string) =>
    (await db.select().from(photos).where(eq(photos.id, id)))[0]!;

  beforeAll(async () => {
    await pool.query('select 1');
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    store = new MemoryStore();
    moderation = new FakeModeration();
    const phone = `+9197${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    const [u] = await db
      .insert(users)
      .values({ phoneE164: phone, cognitoSub: randomUUID() })
      .returning();
    userId = u!.id;
    await db.insert(profiles).values({
      userId,
      displayName: 'Rohan',
      birthDate: '1994-02-03',
      gender: 'man',
    });
  });

  describe('photo.process', () => {
    it('publishes full + thumb without EXIF and deletes the upload', async () => {
      const handler = new PhotoProcessHandler(db, store, moderation);
      const { id, uploadKey } = await processingPhoto(await jpeg(2400, 1800));
      await handler.handle(job('photo.process', { photoId: id }));

      const row = await photoRow(id);
      expect(row.status).toBe('approved');
      expect(row.publicPrefix).toBe(`public/photos/${userId}/${id}`);
      expect([row.width, row.height]).toEqual([1600, 1200]);

      const full = store.objects.get(`${row.publicPrefix}/full.jpg`)!;
      expect(full.cacheControl).toMatch(/immutable/);
      expect((await sharp(full.body).metadata()).exif).toBeUndefined();
      expect(store.objects.has(`${row.publicPrefix}/thumb.jpg`)).toBe(true);
      expect(store.objects.has(uploadKey)).toBe(false);

      // Redelivery is a no-op.
      await handler.handle(job('photo.process', { photoId: id }));
      expect((await photoRow(id)).status).toBe('approved');
    });

    it('rejects photos that fail moderation and keeps nothing public', async () => {
      moderation.nextLabels = [{ name: 'Explicit Nudity', parent: 'Explicit', confidence: 98 }];
      const handler = new PhotoProcessHandler(db, store, moderation);
      const { id } = await processingPhoto(await jpeg());
      await handler.handle(job('photo.process', { photoId: id }));

      const row = await photoRow(id);
      expect(row.status).toBe('rejected');
      expect(row.rejectionReason).toMatch(/community guidelines/);
      expect(row.moderationLabels).toEqual(moderation.nextLabels);
      expect(store.objects.size).toBe(0);
    });

    it('rejects files that are not images', async () => {
      const handler = new PhotoProcessHandler(db, store, moderation);
      const { id } = await processingPhoto(Buffer.from('not an image'));
      await handler.handle(job('photo.process', { photoId: id }));
      expect((await photoRow(id)).status).toBe('rejected');
    });
  });

  describe('selfie.verify', () => {
    async function setup() {
      const handler = new PhotoProcessHandler(db, store, moderation);
      const photo = await processingPhoto(await jpeg());
      await handler.handle(job('photo.process', { photoId: photo.id }));
      const id = randomUUID();
      const uploadKey = storageKeys.selfieUpload(userId, id);
      await db.insert(selfieVerifications).values({ id, userId, uploadKey, status: 'processing' });
      await store.put(uploadKey, await jpeg(900, 1200), 'image/jpeg');
      return { id, uploadKey, photo };
    }

    const verification = async (id: string) =>
      (await db.select().from(selfieVerifications).where(eq(selfieVerifications.id, id)))[0]!;
    const verifiedAt = async () =>
      (await db.select().from(profiles).where(eq(profiles.userId, userId)))[0]!.verifiedAt;

    it('verifies a matching selfie and deletes it', async () => {
      const { id, uploadKey, photo } = await setup();
      await new SelfieVerifyHandler(db, store, moderation, config).handle(
        job('selfie.verify', { verificationId: id }),
      );
      expect((await verification(id)).status).toBe('verified');
      expect(await verifiedAt()).toBeInstanceOf(Date);
      expect(moderation.compared).toEqual([`public/photos/${userId}/${photo.id}/full.jpg`]);
      expect(store.objects.has(uploadKey)).toBe(false);
    });

    it('fails a selfie that does not match, still deleting it', async () => {
      const { id, uploadKey } = await setup();
      moderation.similarity = 60;
      await new SelfieVerifyHandler(db, store, moderation, config).handle(
        job('selfie.verify', { verificationId: id }),
      );
      const row = await verification(id);
      expect(row.status).toBe('failed');
      expect(row.similarity).toBe(60);
      expect(await verifiedAt()).toBeNull();
      expect(store.objects.has(uploadKey)).toBe(false);
    });

    it('fails when there is not exactly one face', async () => {
      const { id } = await setup();
      moderation.faces = 2;
      await new SelfieVerifyHandler(db, store, moderation, config).handle(
        job('selfie.verify', { verificationId: id }),
      );
      expect((await verification(id)).failureReason).toMatch(/only you/);
    });
  });

  describe('user.purge', () => {
    it("deletes every object under the user's prefixes only", async () => {
      await store.put(`incoming/${userId}/a`, Buffer.from('x'), 'image/jpeg');
      await store.put(`public/photos/${userId}/p/full.jpg`, Buffer.from('x'), 'image/jpeg');
      await store.put(`verification/${userId}/v`, Buffer.from('x'), 'image/jpeg');
      await store.put(`public/photos/someone-else/p/full.jpg`, Buffer.from('x'), 'image/jpeg');
      await new UserPurgeHandler(store, new PlanIndexer(db, null, 0)).handle(
        job('user.purge', { userId }),
      );
      expect([...store.objects.keys()]).toEqual(['public/photos/someone-else/p/full.jpg']);
    });
  });
});
