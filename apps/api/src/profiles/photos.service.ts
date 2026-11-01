import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { photos, users } from '@activity/db';
import {
  JOB_TYPES,
  PROFILE_RULES,
  storageKeys,
  type CreatePhotoUploadResponse,
  type CreateUploadRequest,
  type Photo,
  type PhotoProcessPayload,
} from '@activity/shared';
import { and, asc, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import { ApiException } from '../common/errors.js';
import { JobsService } from '../common/jobs.service.js';
import { StorageService } from '../common/storage.service.js';
import { DRIZZLE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';

/** An upload slot nobody used within this window is discarded. */
const STALE_UPLOAD_MINUTES = 15;

type PhotoRow = typeof photos.$inferSelect;

@Injectable()
export class PhotosService {
  private readonly logger = new Logger(PhotosService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
  ) {}

  /** The member's photos in display order, excluding unused upload slots. */
  async list(userId: string): Promise<Photo[]> {
    const rows = await this.db
      .select()
      .from(photos)
      .where(and(eq(photos.userId, userId), ne(photos.status, 'awaiting_upload')))
      .orderBy(asc(photos.position), asc(photos.createdAt));
    return rows.map((r) => this.toDto(r));
  }

  async approvedCount(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(photos)
      .where(and(eq(photos.userId, userId), eq(photos.status, 'approved')));
    return row?.n ?? 0;
  }

  /** Reserves a photo slot and returns a presigned POST for the upload. */
  async createUpload(userId: string, req: CreateUploadRequest): Promise<CreatePhotoUploadResponse> {
    const id = randomUUID();
    const uploadKey = storageKeys.photoUpload(userId, id);

    const row = await this.db.transaction(async (tx) => {
      // Serialise slot allocation per user so parallel requests cannot exceed the limit.
      await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
      await tx
        .delete(photos)
        .where(
          and(
            eq(photos.userId, userId),
            eq(photos.status, 'awaiting_upload'),
            lt(photos.createdAt, sql`now() - make_interval(mins => ${STALE_UPLOAD_MINUTES})`),
          ),
        );
      const [stats] = await tx
        .select({
          active: sql<number>`count(*)::int`,
          nextPosition: sql<number>`coalesce(max(${photos.position}) + 1, 0)::int`,
        })
        .from(photos)
        .where(and(eq(photos.userId, userId), ne(photos.status, 'rejected')));
      if ((stats?.active ?? 0) >= PROFILE_RULES.maxPhotos) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'photo_limit',
          `You can have up to ${PROFILE_RULES.maxPhotos} photos. Remove one first.`,
        );
      }
      const [inserted] = await tx
        .insert(photos)
        .values({ id, userId, uploadKey, position: stats?.nextPosition ?? 0 })
        .returning();
      return inserted!;
    });

    const upload = await this.storage.createUpload(
      uploadKey,
      req.contentType,
      PROFILE_RULES.maxPhotoBytes,
    );
    return { photo: this.toDto(row), upload };
  }

  /** Client finished uploading: confirm the object exists and queue processing. Idempotent. */
  async complete(userId: string, photoId: string): Promise<Photo> {
    const row = await this.get(userId, photoId);
    if (row.status !== 'awaiting_upload') return this.toDto(row);

    const head = await this.storage.head(row.uploadKey);
    if (!head) {
      throw new ApiException(HttpStatus.CONFLICT, 'upload_missing', 'Upload not found, try again');
    }
    const [updated] = await this.db
      .update(photos)
      .set({ status: 'processing' })
      .where(and(eq(photos.id, photoId), eq(photos.status, 'awaiting_upload')))
      .returning();
    const payload: PhotoProcessPayload = { photoId };
    await this.jobs.enqueue(
      JOB_TYPES.photoProcess,
      payload,
      `${JOB_TYPES.photoProcess}:${photoId}`,
    );
    return this.toDto(updated ?? row);
  }

  async reorder(userId: string, photoIds: string[]): Promise<Photo[]> {
    await this.db.transaction(async (tx) => {
      const current = await tx
        .select({ id: photos.id })
        .from(photos)
        .where(and(eq(photos.userId, userId), inArray(photos.status, ['processing', 'approved'])));
      const currentIds = new Set(current.map((r) => r.id));
      const same =
        currentIds.size === photoIds.length &&
        new Set(photoIds).size === photoIds.length &&
        photoIds.every((id) => currentIds.has(id));
      if (!same) {
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          'invalid_order',
          'Send every current photo exactly once',
        );
      }
      for (const [position, id] of photoIds.entries()) {
        await tx.update(photos).set({ position }).where(eq(photos.id, id));
      }
    });
    return this.list(userId);
  }

  async remove(userId: string, photoId: string): Promise<Photo[]> {
    const row = await this.get(userId, photoId);
    if (row.status === 'approved') {
      const approved = await this.approvedCount(userId);
      // Once a profile is live it must keep the minimum; add a replacement first.
      if (approved === PROFILE_RULES.minPhotos) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'min_photos',
          `Your profile needs at least ${PROFILE_RULES.minPhotos} photos. Add another before removing this one.`,
        );
      }
    }
    await this.db.delete(photos).where(and(eq(photos.id, photoId), eq(photos.userId, userId)));
    const keys = [row.uploadKey];
    if (row.publicPrefix) {
      keys.push(
        storageKeys.photoVariant(row.publicPrefix, 'full'),
        storageKeys.photoVariant(row.publicPrefix, 'thumb'),
      );
    }
    // Best effort: the row is gone, so the photo is no longer served; lifecycle rules clean up the rest.
    await this.storage.deleteObjects(keys).catch((err: Error) => {
      this.logger.warn(`Could not delete objects for photo ${photoId}: ${err.message}`);
    });
    await this.compactPositions(userId);
    return this.list(userId);
  }

  toDto(row: PhotoRow): Photo {
    return {
      id: row.id,
      position: row.position,
      status: row.status,
      urls:
        row.status === 'approved' && row.publicPrefix
          ? {
              full: this.storage.publicUrl(storageKeys.photoVariant(row.publicPrefix, 'full')),
              thumb: this.storage.publicUrl(storageKeys.photoVariant(row.publicPrefix, 'thumb')),
            }
          : null,
      rejectionReason: row.rejectionReason,
    };
  }

  private async get(userId: string, photoId: string): Promise<PhotoRow> {
    const [row] = await this.db
      .select()
      .from(photos)
      .where(and(eq(photos.id, photoId), eq(photos.userId, userId)))
      .limit(1);
    if (!row) throw new ApiException(HttpStatus.NOT_FOUND, 'not_found', 'Photo not found');
    return row;
  }

  private async compactPositions(userId: string): Promise<void> {
    await this.db.execute(sql`
      update ${photos} p set position = o.rn - 1
      from (
        select id, row_number() over (order by position, created_at) as rn
        from ${photos}
        where user_id = ${userId} and (status <> 'awaiting_upload' or created_at > now() - interval '15 minutes')
      ) o
      where p.id = o.id and p.position <> o.rn - 1
    `);
  }
}
